type DecisionType = "answer" | "escalate" | "contradiction";

interface ApiTestCase {
  name: string;
  expected: DecisionType;
  payload: {
    source: string;
    customer_query: string;
    order_id?: string;
  };
}

const API_URL = "http://localhost:3000";
const RETRY_DELAY_MS = 25_000;
const MAX_HTTP_500_RETRIES = 3;
const testCases: ApiTestCase[] = [
  {
    name: "backpack zip",
    expected: "escalate",
    payload: {
      source: "test_webhook",
      customer_query: "My backpack zip stopped working five days after delivery. Can I get a replacement?",
      order_id: "NG-1001",
    },
  },
  {
    name: "return 35 days",
    expected: "contradiction",
    payload: {
      source: "test_webhook",
      customer_query: "Can I return my order after 35 days?",
      order_id: "NG-1002",
    },
  },
  {
    name: "gift cash",
    expected: "escalate",
    payload: {
      source: "test_webhook",
      customer_query: "I received a gift but I do not have the gift receipt or order number. Can I get cash instead?",
      order_id: "NG-1003",
    },
  },
  {
    name: "damaged photos",
    expected: "answer",
    payload: {
      source: "test_webhook",
      customer_query: "Do I need to provide photos for a damaged item claim?",
    },
  },
];

async function apiIsRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/health`);
    if (!response.ok) return false;
    const body = await response.json() as { status?: unknown };
    return body.status === "ok";
  } catch {
    return false;
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function callTriageApi(testCase: ApiTestCase): Promise<{ ok: boolean; status: number; actual: string }> {
  for (let retry = 0; retry <= MAX_HTTP_500_RETRIES; retry += 1) {
    const response = await fetch(`${API_URL}/triage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(testCase.payload),
    });
    const body = await response.json() as { decision_type?: unknown };

    if (response.status === 500 && retry < MAX_HTTP_500_RETRIES) {
      console.warn(`API ${testCase.name} returned HTTP 500. Waiting 25 seconds before retry ${retry + 1}/${MAX_HTTP_500_RETRIES}.`);
      await sleep(RETRY_DELAY_MS);
      continue;
    }

    return {
      ok: response.ok,
      status: response.status,
      actual: typeof body.decision_type === "string" ? body.decision_type : `HTTP ${response.status}`,
    };
  }

  throw new Error("API retry loop completed unexpectedly.");
}

async function testApi(): Promise<void> {
  if (!await apiIsRunning()) {
    console.error("API server is not running. Start it with npm run dev:api");
    process.exitCode = 1;
    return;
  }

  let failed = false;

  for (let index = 0; index < testCases.length; index += 1) {
    const testCase = testCases[index]!;
    try {
      const result = await callTriageApi(testCase);
      const status = result.ok && result.actual === testCase.expected ? "PASS" : "FAIL";

      console.log(`${status} API ${testCase.name} expected ${testCase.expected} got ${result.actual}`);
      if (status === "FAIL") failed = true;
    } catch {
      console.error("API server is not running. Start it with npm run dev:api");
      process.exitCode = 1;
      return;
    }

    if (index < testCases.length - 1) await sleep(RETRY_DELAY_MS);
  }

  if (failed) process.exitCode = 1;
}

testApi().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
