import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createTriageServer } from "./server.js";

const successfulResult = {
  decision_type: "answer" as const,
  confidence: "high" as const,
  customer_response_draft: "Test response",
  order_id: null,
  order_context: null,
  cited_sources: [],
};

async function withServer(run: (url: string) => Promise<void>): Promise<void> {
  const server = createTriageServer(async () => successfulResult);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("POST /triage generates and exposes a request ID", async () => {
  await withServer(async (url) => {
    const response = await fetch(`${url}/triage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customer_query: "A test query" }),
    });
    const body = await response.json() as { request_id: string };

    assert.equal(response.status, 200);
    assert.match(body.request_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(response.headers.get("x-request-id"), body.request_id);
  });
});

test("POST /triage preserves an incoming request ID", async () => {
  await withServer(async (url) => {
    const response = await fetch(`${url}/triage`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "caller-request-123" },
      body: JSON.stringify({ customer_query: "A test query" }),
    });
    const body = await response.json() as { request_id: string };

    assert.equal(response.headers.get("x-request-id"), "caller-request-123");
    assert.equal(body.request_id, "caller-request-123");
  });
});

test("handled failures expose the same request ID", async () => {
  await withServer(async (url) => {
    const response = await fetch(`${url}/triage`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "failed-request-456" },
      body: "not-json",
    });
    const body = await response.json() as { request_id: string; error: string };

    assert.equal(response.status, 400);
    assert.equal(response.headers.get("x-request-id"), "failed-request-456");
    assert.equal(body.request_id, "failed-request-456");
    assert.ok(body.error);
  });
});

test("successful managed responses expose case information", async () => {
  const server = createTriageServer(async () => ({
    ...successfulResult,
    case_resolution: "selected" as const,
    case_reference: "CASE-7K4M2Q",
    case_status: "open" as const,
    decision_due_at: "2026-09-04T10:00:00.000Z",
  }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/triage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ customer_query: "A test query" }),
    });
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.case_reference, "CASE-7K4M2Q");
    assert.equal(body.case_status, "open");
    assert.equal(body.decision_due_at, "2026-09-04T10:00:00.000Z");
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("ambiguous cases return needs_case_selection without triage output", async () => {
  const server = createTriageServer(async () => ({
    case_resolution: "needs_case_selection" as const,
    cases: [{
      case_reference: "CASE-7K4M2Q",
      status: "open" as const,
      order_id: "ORDER-1",
      summary: "Support issue for order ORDER-1",
      created_at: "2026-09-03T10:00:00.000Z",
    }],
  }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/triage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ customer_query: "A test query" }),
    });
    const body = await response.json() as { status: string; cases: unknown[] };
    assert.equal(response.status, 200);
    assert.equal(body.status, "needs_case_selection");
    assert.equal(body.cases.length, 1);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("one existing case returns needs_case_confirmation", async () => {
  const server = createTriageServer(async () => ({
    case_resolution: "needs_case_confirmation" as const,
    case: {
      case_reference: "CASE-7K4M2Q",
      status: "open" as const,
      order_id: "ORDER-1",
      summary: "Support issue for order ORDER-1",
      created_at: "2026-09-03T10:00:00.000Z",
    },
  }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/triage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ customer_query: "A test query" }),
    });
    const body = await response.json() as { status: string; case: { summary: string } };
    assert.equal(response.status, 200);
    assert.equal(body.status, "needs_case_confirmation");
    assert.equal(body.case.summary, "Support issue for order ORDER-1");
  } finally {
    server.close();
    await once(server, "close");
  }
});
