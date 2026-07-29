import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { PayloadValidationError, runPayload } from "./triagePayload.js";

const MAX_BODY_BYTES = 1_000_000;

class BodyTooLargeError extends Error {}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
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

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (request.method !== "POST" || url.pathname !== "/triage") {
    sendJson(response, 404, { error: "Not found." });
    return;
  }

  try {
    const body = await readBody(request);
    const payload = JSON.parse(body) as unknown;
    const result = await runPayload(payload);
    sendJson(response, 200, {
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
    });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof PayloadValidationError) {
      sendJson(response, 400, { error: error.message });
    } else if (error instanceof BodyTooLargeError) {
      sendJson(response, 413, { error: error.message });
    } else {
      console.error(error);
      sendJson(response, 500, { error: "Triage failed." });
    }
  }
});

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
if (!Number.isInteger(port) || port <= 0) throw new Error("PORT must be a positive integer.");

server.listen(port, "0.0.0.0", () => {
  console.log(`Triage API listening on http://localhost:${port}`);
});
