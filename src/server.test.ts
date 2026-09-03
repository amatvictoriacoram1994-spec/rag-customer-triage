import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createTriageServer } from "./server.js";
import type { runPayload } from "./triagePayload.js";

const successfulResult = {
  decision_type: "answer",
  confidence: 0.9,
  customer_response_draft: "Test response",
  escalation_reason: null,
  order_id: null,
  order_context: null,
  cited_sources: [],
} as unknown as Awaited<ReturnType<typeof runPayload>>;

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
