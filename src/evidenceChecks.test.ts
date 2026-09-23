import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDecisionMatchesEvidenceConstraint,
  findPolicyVersionConflicts,
  forcedDecisionForPolicyVersionConflicts,
} from "./evidenceChecks.js";
import type { PolicyMatch } from "./retrievePolicies.js";

function match(
  documentId: string,
  version: string,
  sectionNumber: number,
  title = "Returns Policy",
): PolicyMatch {
  return {
    document_id: documentId,
    document_title: title,
    document_version: version,
    effective_date: null,
    section_number: sectionNumber,
    section_title: "Return Window",
    content: "Test policy content",
    similarity: 0.95,
  };
}

test("detects conflicting versions of the same document section", () => {
  const conflicts = findPolicyVersionConflicts([
    match("POL-RET-001", "1.0", 3),
    match("POL-RET-001", "0.9", 3),
  ]);

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]!.document_id, "POL-RET-001");
  assert.equal(conflicts[0]!.section_number, 3);
  assert.deepEqual(new Set(conflicts[0]!.versions), new Set(["1.0", "0.9"]));
  assert.equal(forcedDecisionForPolicyVersionConflicts(conflicts), "contradiction");
});

test("does not flag repeated evidence from the same version", () => {
  const conflicts = findPolicyVersionConflicts([
    match("POL-RET-001", "1.0", 3),
    match("POL-RET-001", "1.0", 3),
  ]);

  assert.equal(conflicts.length, 0);
  assert.equal(forcedDecisionForPolicyVersionConflicts(conflicts), undefined);
});

test("does not treat different sections as a version conflict", () => {
  const conflicts = findPolicyVersionConflicts([
    match("POL-RET-001", "1.0", 3),
    match("POL-RET-001", "0.9", 4),
  ]);

  assert.equal(conflicts.length, 0);
});

test("hard enforcement rejects a model answer when contradiction is forced", () => {
  assert.throws(
    () => assertDecisionMatchesEvidenceConstraint("answer", "contradiction"),
    /violated deterministic evidence constraint/,
  );
});

test("hard enforcement accepts the required contradiction decision", () => {
  assert.doesNotThrow(() =>
    assertDecisionMatchesEvidenceConstraint("contradiction", "contradiction"),
  );
});
