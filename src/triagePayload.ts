import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runTriage } from "./triageTicket.js";

interface TriagePayload {
  source?: string;
  customer_query: string;
  order_id?: string;
}

export class PayloadValidationError extends Error {}

function validatePayload(value: unknown): TriagePayload {
  if (!value || typeof value !== "object") throw new PayloadValidationError("Payload must be a JSON object.");

  const payload = value as Partial<TriagePayload>;
  if (typeof payload.customer_query !== "string" || !payload.customer_query.trim()) {
    throw new PayloadValidationError("Payload must include a non-empty customer_query.");
  }
  if (payload.order_id !== undefined && (typeof payload.order_id !== "string" || !payload.order_id.trim())) {
    throw new PayloadValidationError("order_id must be a non-empty string when provided.");
  }
  if (payload.source !== undefined && typeof payload.source !== "string") {
    throw new PayloadValidationError("source must be a string when provided.");
  }

  return payload as TriagePayload;
}

export async function runPayload(value: unknown) {
  const payload = validatePayload(value);
  return runTriage(
    payload.customer_query.trim(),
    payload.order_id?.trim(),
    { source: payload.source ?? null },
  );
}

export async function runPayloadFile(filePath: string) {
  return runPayload(JSON.parse(await readFile(filePath, "utf8")));
}

async function triagePayload(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) throw new Error("Usage: npm run triage:payload -- path/to/payload.json");

  const result = await runPayloadFile(filePath);
  console.log(JSON.stringify(result, null, 2));
  console.log("Logged triage run to Supabase.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  triagePayload().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
