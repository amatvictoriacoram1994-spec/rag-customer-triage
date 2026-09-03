import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { CaseService, normalizeCustomerIdentity } from "./caseManagement.js";
import { SupabaseCaseRepository } from "./supabaseCaseRepository.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function testCasesLive(): Promise<void> {
  const supabase = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const repository = new SupabaseCaseRepository(supabase);
  const service = new CaseService(repository, { responseTatHours: 24 });
  const suffix = randomUUID();
  const externalCustomerId = `LIVE-SMOKE-${suffix}`;
  const requestIds = [`LIVE-SMOKE-REQ-${randomUUID()}`, `LIVE-SMOKE-REQ-${randomUUID()}`];
  let customerId: string | undefined;
  let caseId: string | undefined;
  let caseReference: string | undefined;
  const cleanupErrors: string[] = [];
  let testError: unknown;

  try {
    const createdAt = new Date().toISOString();
    const customer = await repository.createCustomer(normalizeCustomerIdentity({
      external_customer_id: externalCustomerId,
    }), createdAt);
    customerId = customer.id;

    const foundCustomers = await repository.findCustomers(normalizeCustomerIdentity({
      external_customer_id: externalCustomerId,
    }));
    assert.equal(foundCustomers.length, 1);
    assert.equal(foundCustomers[0]!.id, customer.id);

    const resolution = await service.resolve({
      customer: { external_customer_id: externalCustomerId },
      order_id: `LIVE-SMOKE-ORDER-${suffix}`,
      new_issue: true,
    });
    assert.equal(resolution.outcome, "selected");
    if (resolution.outcome !== "selected") throw new Error("Expected a newly selected case.");
    caseId = resolution.case.id;
    caseReference = resolution.case.case_reference;

    assert.match(caseReference, /^CASE-[2-9A-HJ-NP-Z]{6}$/);
    const dueDeltaMs = new Date(resolution.case.decision_due_at).getTime()
      - new Date(resolution.case.created_at).getTime();
    assert.ok(Math.abs(dueDeltaMs - 24 * 60 * 60 * 1000) < 1_000);

    const openCases = await repository.listOpenCases(customer.id);
    assert.ok(openCases.some((candidate) => candidate.id === caseId));

    await repository.addCaseEvent({
      case_id: caseId,
      request_id: requestIds[0]!,
      source: "email",
      external_message_id: `LIVE-SMOKE-MSG-${randomUUID()}`,
      event_type: "interaction_received",
    }, new Date().toISOString());
    await repository.addCaseEvent({
      case_id: caseId,
      request_id: requestIds[1]!,
      source: "phone",
      external_message_id: `LIVE-SMOKE-MSG-${randomUUID()}`,
      event_type: "interaction_received",
    }, new Date().toISOString());

    const { data: events, error: eventsError } = await supabase.from("case_events")
      .select("case_id, request_id, source").eq("case_id", caseId).in("request_id", requestIds);
    if (eventsError) throw new Error(`Failed to verify case events: ${eventsError.message}`);
    assert.equal(events.length, 2);
    assert.ok(events.every((event) => event.case_id === caseId));
    assert.deepEqual(new Set(events.map((event) => event.request_id)), new Set(requestIds));
    assert.deepEqual(new Set(events.map((event) => event.source)), new Set(["email", "phone"]));

    await repository.updateCase(caseId, {
      status: "action_pending",
      updated_at: new Date().toISOString(),
      resolved_at: null,
    });
    const updatedCase = await repository.getCaseByReference(caseReference);
    assert.equal(updatedCase?.status, "action_pending");
  } catch (error) {
    testError = error;
  } finally {
    if (caseId) {
      const { error } = await supabase.from("case_events").delete().eq("case_id", caseId);
      if (error) cleanupErrors.push(`case_events: ${error.message}`);
      const { error: caseError } = await supabase.from("cases").delete().eq("id", caseId);
      if (caseError) cleanupErrors.push(`case: ${caseError.message}`);
    }
    if (customerId) {
      const { error } = await supabase.from("customers").delete().eq("id", customerId);
      if (error) cleanupErrors.push(`customer: ${error.message}`);
    }
  }

  if (testError || cleanupErrors.length) {
    const testMessage = testError instanceof Error ? testError.message : testError ? String(testError) : "none";
    throw new Error(`Live case smoke test failed. Test error: ${testMessage}. Cleanup errors: ${cleanupErrors.join("; ") || "none"}.`);
  }

  console.log(JSON.stringify({
    status: "PASS",
    temporary_records: { customers: 1, cases: 1, case_events: 2 },
    case_reference: caseReference,
    request_ids_distinct: requestIds[0] !== requestIds[1],
    cleanup: "complete",
  }));
}

testCasesLive().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
