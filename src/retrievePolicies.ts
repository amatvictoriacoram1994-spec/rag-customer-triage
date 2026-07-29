import { createClient } from "@supabase/supabase-js";
import { createEmbeddings } from "./voyage.js";

export interface PolicyMatch {
  document_title: string;
  document_version: string;
  section_number: number;
  section_title: string;
  content: string;
  similarity: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export async function retrievePolicies(query: string, matchCount = 5): Promise<PolicyMatch[]> {
  const [queryEmbedding] = await createEmbeddings([query], "query", requireEnv("VOYAGE_API_KEY"));
  const supabase = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("match_policy_chunks", {
    query_embedding: queryEmbedding,
    match_count: matchCount,
  });
  if (error) throw new Error(`Supabase search failed: ${error.message}`);
  return (data ?? []) as PolicyMatch[];
}
