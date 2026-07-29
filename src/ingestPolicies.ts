import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { parsePolicy } from "./parsePolicies.js";
import { createEmbeddings } from "./voyage.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policiesDirectory = path.join(projectRoot, "policies");
const FILE_DELAY_MS = 25_000;

async function ingest(): Promise<void> {
  const supabase = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const voyageApiKey = requireEnv("VOYAGE_API_KEY");
  // Only this exact directory is listed; answer_key and subdirectories are never traversed.
  const entries = await readdir(policiesDirectory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => entry.name).sort();
  if (!files.length) throw new Error(`No Markdown policies found in ${policiesDirectory}`);

  let succeeded = 0;
  let failed = 0;
  for (const [index, fileName] of files.entries()) {
    try {
      const policy = parsePolicy(await readFile(path.join(policiesDirectory, fileName), "utf8"), fileName);
      const inputs = policy.sections.map((section) =>
        `${policy.metadata.documentTitle}\n${section.sectionNumber}. ${section.sectionTitle}\n\n${section.content}`);
      const embeddings = await createEmbeddings(inputs, "document", voyageApiKey);
      const rows = policy.sections.map((section, index) => ({
        chunk_key: `${policy.metadata.documentId}:${policy.metadata.documentVersion}:${section.sectionNumber}`,
        document_id: policy.metadata.documentId,
        document_title: policy.metadata.documentTitle,
        document_version: policy.metadata.documentVersion,
        effective_date: policy.metadata.effectiveDate,
        section_number: section.sectionNumber,
        section_title: section.sectionTitle,
        content: section.content,
        embedding: embeddings[index]!,
        metadata: { source_file: fileName, document_type: policy.metadata.documentType,
          embedding_model: "voyage-4-lite", embedding_dimension: 1024 },
      }));
      const { error } = await supabase.from("policy_chunks").upsert(rows, { onConflict: "chunk_key" });
      if (error) throw new Error(`Supabase upsert failed: ${error.message}`);
      succeeded++;
      console.log(`OK   ${fileName}: upserted ${rows.length} sections`);
    } catch (error) {
      failed++;
      console.error(`FAIL ${fileName}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (index < files.length - 1) {
        console.log("Waiting 25 seconds before the next policy file...");
        await new Promise((resolve) => setTimeout(resolve, FILE_DELAY_MS));
      }
    }
  }
  console.log(`\nIngestion complete: ${succeeded} files succeeded, ${failed} failed.`);
  if (failed) process.exitCode = 1;
}

ingest().catch((error) => {
  console.error(`Fatal ingestion error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
