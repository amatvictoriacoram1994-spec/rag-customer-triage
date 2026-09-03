import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PayloadValidationError, runPayload } from "./triagePayload.js";

const MAX_BODY_BYTES = 1_000_000;

class BodyTooLargeError extends Error {}

function sendJson(response: ServerResponse, statusCode: number, body: unknown, requestId?: string): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...(requestId ? { "x-request-id": requestId } : {}),
  });
  response.end(JSON.stringify(body));
}

function getRequestId(request: IncomingMessage): string {
  const header = request.headers["x-request-id"];
  const value = Array.isArray(header) ? header[0] : header;
  return value?.trim() ? value : randomUUID();
}

function logLifecycle(event: "request_started" | "request_completed" | "request_failed", fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, ...fields }));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new BodyTooLargeError("Request body is too large.");
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

export function createTriageServer(runner: typeof runPayload = runPayload) {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    if (request.method !== "POST" || url.pathname !== "/triage") {
      sendJson(response, 404, { error: "Not found." });
      return;
    }

    const requestId = getRequestId(request);
    const lifecycle = {
      request_id: requestId,
      route: url.pathname,
      method: request.method,
    };
    const startedAt = performance.now();
    logLifecycle("request_started", lifecycle);

    try {
      const body = await readBody(request);
      const payload = JSON.parse(body) as unknown;
      const result = await runner(payload);
      sendJson(response, 200, {
        request_id: requestId,
        status: "success",
        decision_type: result.decision_type,
        confidence: result.confidence,
        customer_response_draft: result.customer_response_draft,
        escalation_reason: result.escalation_reason ?? null,
        order: {
          order_id: result.order_id,
          customer_name: result.order_context?.customer_name ?? null,
        },
        citations: result.cited_sources,
        logged: true,
        raw_result: result,
      }, requestId);
      logLifecycle("request_completed", {
        ...lifecycle,
        duration_ms: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      let statusCode = 500;
      let message = "Triage failed.";
      if (error instanceof SyntaxError || error instanceof PayloadValidationError) {
        statusCode = 400;
        message = error.message;
      } else if (error instanceof BodyTooLargeError) {
        statusCode = 413;
        message = error.message;
      }

      sendJson(response, statusCode, { request_id: requestId, error: message }, requestId);
      logLifecycle("request_failed", {
        ...lifecycle,
        duration_ms: Math.round(performance.now() - startedAt),
      });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  if (!Number.isInteger(port) || port <= 0) throw new Error("PORT must be a positive integer.");

  createTriageServer().listen(port, "0.0.0.0", () => {
    console.log(`Triage API listening on http://localhost:${port}`);
  });
}
