import assert from "node:assert/strict";
import test from "node:test";
import {
  CaseIdentityConflictError,
  CaseService,
  InMemoryCaseRepository,
  type CaseResolution,
} from "./caseManagement.js";

const NOW = new Date("2026-09-03T10:00:00.000Z");

function fixture() {
  const repository = new InMemoryCaseRepository();
  let referenceNumber = 1;
  const service = new CaseService(repository, {
    now: () => new Date(NOW),
    generateReference: () => `CASE-AAAAA${++referenceNumber}`,
  });
  return { repository, service };
}

function selected(resolution: CaseResolution) {
  assert.equal(resolution.outcome, "selected");
  return resolution;
}

test("first interaction creates a customer, unique case reference, and 24-hour deadline", async () => {
  const { repository, service } = fixture();
  const first = selected(await service.resolve({ customer: { email: " User@Example.COM " } }));
  const second = selected(await service.resolve({ customer: { email: "second@example.com" }, new_issue: true }));

  assert.equal(repository.customers.length, 2);
  assert.equal(first.customer.normalized_email, "user@example.com");
  assert.match(first.case.case_reference, /^CASE-[2-9A-HJ-NP-Z]{6}$/);
  assert.notEqual(first.case.case_reference, second.case.case_reference);
  assert.equal(first.case.decision_due_at, "2026-09-04T10:00:00.000Z");
});

test("valid case reference continues one case across channels and request IDs", async () => {
  const { repository, service } = fixture();
  const initial = selected(await service.resolve({ customer: { external_customer_id: "CUST-001" } }));
  const followUp = selected(await service.resolve({
    case_reference: initial.case.case_reference,
    customer: { external_customer_id: "CUST-001" },
  }));

  assert.equal(followUp.case.id, initial.case.id);
  await service.recordInteraction(followUp, {
    request_id: "REQ-001", source: "email", external_message_id: "EMAIL-1", event_type: "interaction_received",
  });
  await service.recordInteraction(followUp, {
    request_id: "REQ-002", source: "whatsapp", external_message_id: "WA-1", event_type: "interaction_received",
  });
  assert.deepEqual(repository.events.map(({ source, request_id }) => ({ source, request_id })), [
    { source: "email", request_id: "REQ-001" },
    { source: "whatsapp", request_id: "REQ-002" },
  ]);
});

test("one open case requires confirmation and confirmed case continues", async () => {
  const { repository, service } = fixture();
  const first = selected(await service.resolve({ customer: { phone: "+1 (555) 0100" }, order_id: "ORDER-1" }));
  const unresolved = await service.resolve({ customer: { phone: "+15550100" }, order_id: "ORDER-1" });
  assert.equal(unresolved.outcome, "needs_case_confirmation");
  assert.equal(repository.events.length, 0);
  if (unresolved.outcome !== "needs_case_confirmation") return;
  assert.equal(unresolved.case.summary, "Support issue for order ORDER-1");

  const confirmed = selected(await service.resolve({
    confirm_case_reference: unresolved.case.case_reference,
    customer: { phone: "+15550100" },
    order_id: "ORDER-1",
  }));
  assert.equal(confirmed.case.id, first.case.id);
  assert.equal(confirmed.created, false);
});

test("multiple plausible open cases require explicit selection", async () => {
  const { service } = fixture();
  await service.resolve({ customer: { email: "customer@example.com" }, new_issue: true });
  await service.resolve({ customer: { email: "customer@example.com" }, new_issue: true });
  const resolution = await service.resolve({ customer: { email: "customer@example.com" } });
  assert.equal(resolution.outcome, "needs_case_selection");
  if (resolution.outcome === "needs_case_selection") assert.equal(resolution.cases.length, 2);
});

test("identity mismatch cannot attach an interaction to another customer's case", async () => {
  const { service } = fixture();
  const first = selected(await service.resolve({ customer: { email: "owner@example.com" } }));
  await assert.rejects(
    service.resolve({ case_reference: first.case.case_reference, customer: { email: "attacker@example.com" } }),
    CaseIdentityConflictError,
  );
});

test("new_issue creates a second case for the same customer", async () => {
  const { service } = fixture();
  const first = selected(await service.resolve({ customer: { external_customer_id: "CUST-002" } }));
  const second = selected(await service.resolve({ customer: { external_customer_id: "CUST-002" }, new_issue: true }));
  assert.equal(second.customer.id, first.customer.id);
  assert.notEqual(second.case.id, first.case.id);

  const third = selected(await service.resolve({
    case_reference: first.case.case_reference,
    customer: { external_customer_id: "CUST-002" },
    new_issue: true,
  }));
  assert.equal(third.customer.id, first.customer.id);
  assert.notEqual(third.case.id, first.case.id);
});

test("a resolved follow-up stays resolved unless reopening is explicit", async () => {
  const { service } = fixture();
  const initial = selected(await service.resolve({ customer: { email: "dispute@example.com" } }));
  const resolved = await service.recordInteraction(initial, {
    request_id: "REQ-RESOLVE", source: "api", external_message_id: null,
    event_type: "triage_completed", decision_type: "answer", confidence: "high", action_status: "none",
  });
  assert.equal(resolved.status, "resolved");

  const followUp = selected(await service.resolve({
    case_reference: initial.case.case_reference,
    customer: { email: "dispute@example.com" },
  }));
  assert.equal(followUp.reopened, false);
  assert.equal(followUp.case.status, "resolved");
  const afterHistory = await service.recordInteraction(followUp, {
    request_id: "REQ-HISTORY", source: "api", external_message_id: null,
    event_type: "triage_completed", decision_type: "escalate", confidence: "low",
  });
  assert.equal(afterHistory.status, "resolved");

  const reopened = selected(await service.resolve({
    case_reference: initial.case.case_reference,
    customer: { email: "dispute@example.com" },
    reopen_case: true,
  }));
  assert.equal(reopened.reopened, true);
  assert.equal(reopened.case.status, "escalated");
  assert.equal(reopened.case.resolved_at, null);
});

test("decision outcome distinguishes action pending from final resolution", async () => {
  const { service } = fixture();
  const pendingCase = selected(await service.resolve({ customer: { email: "pending@example.com" } }));
  const pending = await service.recordInteraction(pendingCase, {
    request_id: "REQ-PENDING", source: "api", external_message_id: null,
    event_type: "triage_completed", decision_type: "answer", confidence: "high", action_status: "pending",
  });
  assert.equal(pending.status, "action_pending");

  const finalCase = selected(await service.resolve({ customer: { email: "final@example.com" } }));
  const resolved = await service.recordInteraction(finalCase, {
    request_id: "REQ-FINAL", source: "api", external_message_id: null,
    event_type: "triage_completed", decision_type: "answer", confidence: "high", action_status: "none",
  });
  assert.equal(resolved.status, "resolved");
});

test("case reference collision is retried around the insert", async () => {
  const repository = new InMemoryCaseRepository();
  const references = ["CASE-AAAAA2", "CASE-AAAAA2", "CASE-AAAAA3"];
  const service = new CaseService(repository, {
    now: () => new Date(NOW),
    generateReference: () => references.shift()!,
  });
  const first = selected(await service.resolve({ customer: { email: "first@example.com" } }));
  const second = selected(await service.resolve({ customer: { email: "second@example.com" } }));
  assert.equal(first.case.case_reference, "CASE-AAAAA2");
  assert.equal(second.case.case_reference, "CASE-AAAAA3");
});

test("missing evidence can place a case into awaiting_customer without escalation", async () => {
  const { service } = fixture();
  const initial = selected(await service.resolve({ customer: { email: "evidence@example.com" } }));
  const updated = await service.recordInteraction(initial, {
    request_id: "REQ-INFO", source: "api", external_message_id: null, event_type: "information_requested",
  });
  assert.equal(updated.status, "awaiting_customer");
});
