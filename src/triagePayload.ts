import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CaseIdentityConflictError,
  CaseNotFoundError,
  CustomerIdentityConflictError,
  type CaseService,
  type CustomerIdentityInput,
} from "./caseManagement.js";
import { getDefaultCaseService } from "./supabaseCaseRepository.js";
import { runTriage } from "./triageTicket.js";

export interface TriagePayload {
  source?: string;
  customer_query: string;
  order_id?: string;
  case_reference?: string;
  confirm_case_reference?: string;
  customer?: CustomerIdentityInput;
  external_message_id?: string;
  new_issue?: boolean;
  reopen_case?: boolean;
}

export class PayloadValidationError extends Error {}
export { CaseIdentityConflictError, CaseNotFoundError, CustomerIdentityConflictError };

export interface PayloadRequestContext {
  requestId: string;
  caseService?: CaseService;
}

type TriageResult = Awaited<ReturnType<typeof runTriage>>;
export type ManagedPayloadResult = TriageResult
  | { case_resolution: "needs_case_selection"; cases: import("./caseManagement.js").CaseSelectionOption[] }
  | { case_resolution: "needs_case_confirmation"; case: import("./caseManagement.js").CaseSelectionOption }
  | (TriageResult & {
      case_resolution: "selected";
      case_reference: string;
      case_status: import("./caseManagement.js").CaseStatus;
      decision_due_at: string;
    });

function validateOptionalString(value: unknown, field: string): void {
  if (value !== undefined && (typeof value !== "string" || !value.trim())) {
    throw new PayloadValidationError(`${field} must be a non-empty string when provided.`);
  }
}

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
  validateOptionalString(payload.case_reference, "case_reference");
  validateOptionalString(payload.confirm_case_reference, "confirm_case_reference");
  if (payload.case_reference && payload.confirm_case_reference) {
    throw new PayloadValidationError("Provide case_reference or confirm_case_reference, not both.");
  }
  validateOptionalString(payload.external_message_id, "external_message_id");
  if (payload.new_issue !== undefined && typeof payload.new_issue !== "boolean") {
    throw new PayloadValidationError("new_issue must be a boolean when provided.");
  }
  if (payload.reopen_case !== undefined && typeof payload.reopen_case !== "boolean") {
    throw new PayloadValidationError("reopen_case must be a boolean when provided.");
  }
  if (payload.reopen_case && !payload.case_reference && !payload.confirm_case_reference) {
    throw new PayloadValidationError("reopen_case requires case_reference or confirm_case_reference.");
  }
  if (payload.reopen_case && payload.new_issue) {
    throw new PayloadValidationError("reopen_case and new_issue cannot both be true.");
  }
  if (payload.customer !== undefined) {
    if (!payload.customer || typeof payload.customer !== "object" || Array.isArray(payload.customer)) {
      throw new PayloadValidationError("customer must be an object when provided.");
    }
    const customer = payload.customer as CustomerIdentityInput;
    validateOptionalString(customer.external_customer_id, "customer.external_customer_id");
    validateOptionalString(customer.email, "customer.email");
    validateOptionalString(customer.phone, "customer.phone");
    if (customer.phone !== undefined && !/\d/.test(customer.phone)) {
      throw new PayloadValidationError("customer.phone must contain at least one digit.");
    }
  }

  return payload as TriagePayload;
}

export function runPayload(value: unknown): Promise<TriageResult>;
export function runPayload(value: unknown, context: PayloadRequestContext): Promise<ManagedPayloadResult>;
export async function runPayload(value: unknown, context?: PayloadRequestContext): Promise<ManagedPayloadResult> {
  const payload = validatePayload(value);
  if (!context) {
    return runTriage(payload.customer_query.trim(), payload.order_id?.trim(), { source: payload.source ?? null });
  }

  const caseService = context.caseService ?? getDefaultCaseService();
  const resolution = await caseService.resolve({
    case_reference: payload.case_reference,
    confirm_case_reference: payload.confirm_case_reference,
    customer: payload.customer,
    order_id: payload.order_id?.trim(),
    new_issue: payload.new_issue,
    reopen_case: payload.reopen_case,
  });
  if (resolution.outcome === "needs_case_confirmation") {
    return { case_resolution: "needs_case_confirmation" as const, case: resolution.case };
  }
  if (resolution.outcome === "needs_case_selection") {
    return { case_resolution: "needs_case_selection" as const, cases: resolution.cases };
  }

  await caseService.recordInteraction(resolution, {
    request_id: context.requestId,
    source: payload.source?.trim() || "api",
    external_message_id: payload.external_message_id?.trim() || null,
    event_type: resolution.reopened ? "case_reopened" : "interaction_received",
  });
  const result = await runTriage(
    payload.customer_query.trim(),
    payload.order_id?.trim(),
    { source: payload.source ?? null },
    { requestId: context.requestId, caseId: resolution.case.id },
  );
  const informationRequired = result.information_required === true;
  const updatedCase = await caseService.recordInteraction(resolution, {
    request_id: context.requestId,
    source: payload.source?.trim() || "api",
    external_message_id: null,
    event_type: informationRequired ? "information_requested" : "triage_completed",
    decision_type: result.decision_type,
    confidence: result.confidence,
    action_status: result.action_status ?? "unclear",
  });
  return {
    ...result,
    case_resolution: "selected" as const,
    case_reference: updatedCase.case_reference,
    case_status: updatedCase.status,
    decision_due_at: updatedCase.decision_due_at,
  };
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
