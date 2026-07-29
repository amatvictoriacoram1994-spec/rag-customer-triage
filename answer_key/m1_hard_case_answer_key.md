NIVARA GOODS

RAG CUSTOMER TRIAGE SYSTEM
HARD CASE ANSWER KEY

Internal testing document

IMPORTANT:
This document must never be included in the ingestion workflow or stored as searchable policy content in Supabase. It contains expected system behaviour used only for validation.


CASE 1: CONTRADICTORY RETURN WINDOWS

Test query:

“I received my order 35 days ago. Am I still allowed to return it?”

Relevant sources:

Source 1:
Returns and Exchanges Policy
Document ID: POL-RET-001
Version: 1.0
Section 3: Return Window

Relevant rule:
Eligible products may be returned within 45 calendar days of the recorded delivery date.

Source 2:
Returns Policy Archive Copy
Document ID: POL-RET-001
Version: 0.9
Section 3: Return Window

Relevant rule:
Eligible products may be returned within 30 calendar days of the recorded delivery date.

Expected system behaviour:

• Retrieve both relevant sections.
• Explicitly state that the available policy documents conflict.
• Cite both documents and both sections.
• Do not tell the customer that the return is approved or rejected.
• Escalate the case for human review.


CASE 2: INFORMATION GAP

Test query:

“I received a Nivara bottle as a gift, but I have no gift receipt, no order number, and I cannot contact the purchaser. Can I return it and receive cash?”

Relevant source:
Gift Orders and Gift Returns Policy
Section 6: Proof of Gift Purchase
Section 9: Refunds for Gift Returns
Section 15: Exceptions and Human Review

Expected system behaviour:

• Explain that the available documents do not provide enough information to confirm eligibility.
• Do not invent an alternative verification process.
• Do not promise cash, store credit, exchange, or rejection.
• Cite the relevant gift-policy sections.
• Escalate the case for human review.


CASE 3: AMBIGUOUS POLICY OVERLAP

Test query:

“My backpack zip stopped working five days after delivery. Should I return it, request a warranty repair, or ask for a replacement?”

Potentially relevant sources:
Returns and Exchanges Policy, Product Warranty Policy, Damaged or Defective Items Policy, and Replacement and Spare Parts Policy.

Expected system behaviour:

• Retrieve relevant sections from more than one policy.
• Explain that multiple policies may apply.
• Avoid selecting a return, repair, refund, or replacement automatically.
• Request relevant evidence if appropriate.
• Escalate for human review before confirming a resolution.
• Cite the relevant documents and sections.


VALIDATION LABELS

Case 1:
Expected classification: contradiction
Expected action: human_escalation

Case 2:
Expected classification: insufficient_information
Expected action: human_escalation

Case 3:
Expected classification: ambiguous_overlap
Expected action: human_escalation


INGESTION EXCLUSION

The answer_key folder must be excluded from document ingestion.

Only documents inside the policies folder should enter the policy vector database.
