import { runPayloadFile } from "./triagePayload.js";

type DecisionType = "answer" | "escalate" | "contradiction";

const testCases: Array<{ fileName: string; expected: DecisionType }> = [
  { fileName: "backpack_zip_ng1001.json", expected: "escalate" },
  { fileName: "return_35_days_ng1002.json", expected: "contradiction" },
  { fileName: "gift_cash_ng1003.json", expected: "escalate" },
  { fileName: "damaged_photos_policy_only.json", expected: "answer" },
];

async function testPayloads(): Promise<void> {
  let failed = false;

  for (const testCase of testCases) {
    try {
      const result = await runPayloadFile(`sample_payloads/${testCase.fileName}`);
      const status = result.decision_type === testCase.expected ? "PASS" : "FAIL";
      console.log(`${status} ${testCase.fileName} expected ${testCase.expected} got ${result.decision_type}`);
      if (status === "FAIL") failed = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`FAIL ${testCase.fileName} expected ${testCase.expected} got error: ${message}`);
      failed = true;
    }
  }

  if (failed) process.exitCode = 1;
}

testPayloads().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
