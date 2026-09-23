# Architecture

## Ingestion path

Ingestion is an offline, privileged operation. `src/ingestPolicies.ts` reads only direct `.md` files in `policies/`; it neither walks the repository nor accesses `answer_key/`. Each file is validated, split at numbered section headings, and embedded with Voyage AI using `voyage-4-lite`, `input_type: document`, and 1024 dimensions.

Each section is stored as one row in `public.policy_chunks`. Its deterministic `chunk_key` combines document ID, version, and section number, allowing safe reruns through an upsert. The Supabase secret key is appropriate only for this trusted server-side process and must never be exposed to browsers or customers.

## Runtime retrieval path

At runtime, the customer query is embedded with the same model and dimension but with `input_type: query`. The query vector is passed to `public.match_policy_chunks`, which ranks stored chunks by pgvector cosine distance and returns the closest sections with provenance and similarity.

Retrieval supplies evidence; it does not make a final support decision. The runtime triage layer passes retrieved policy sections and verified order context to Claude, requires citations to returned chunks, and routes ambiguous, conflicting, or high-risk cases for human review.

Before Claude is called, a deterministic evidence gate checks retrieved chunks for multiple versions of the same document section (same `document_id` plus `section_number`). If conflicting versions are present, the system forces `decision_type = contradiction`. Claude may explain that contradiction, but it cannot override it: any model output with a different decision type is rejected locally before the response is accepted.

## Customer and case flow

The runtime business flow is:

```text
Customer
  -> Case
  -> Interactions from any channel
  -> Technical request executions (request_id)
  -> RAG plus verified order context
  -> Decision, information request, or escalation
  -> Case status updated
  -> Customer status response
```

`customer_id`, `case_id`, `request_id`, and `order_id` have separate meanings. A customer can have multiple cases; one case can have many channel-independent interactions; and each interaction or retry can have a different technical `request_id`. The communication channel never owns the case.

`case_reference` is a short, human-friendly reference for support conversations and future self-service. Customers are not required to remember it: exact customer identifiers can locate their open cases. Possession of a case reference is not proof of identity, so a referenced case is continued only when an exact customer identifier or the exact case order also matches.

Customer identity resolution is deterministic. The service normalizes email by trimming and lowercasing, normalizes phone numbers to digits while preserving a leading `+`, and compares external customer IDs exactly after trimming. It never performs fuzzy name matching and never asks the language model to resolve identity. The current mock order source exposes only `customer_name`, which is not a safe exact identity signal; `order_id` is therefore used only as exact case context until a stable order customer identifier is available.

Without a case reference, the service finds the exact customer and considers their non-resolved cases. An exact `order_id` strongly filters those cases. One candidate returns `needs_case_confirmation`, multiple candidates return `needs_case_selection`, and no candidate creates a new case. No interaction is attached until the caller sends the selected reference explicitly as `confirm_case_reference`. `new_issue: true` always creates another case rather than silently merging issues. Future trusted channel/thread mappings may confirm continuity automatically, but no such connector exists yet.

Cases support `open`, `awaiting_customer`, `action_pending`, `escalated`, and `resolved`. A clear, final ineligibility or other decision with no remaining work can resolve a case. Eligibility that still requires an external return, refund, replacement, cancellation, or other execution moves to `action_pending`. Missing required customer evidence uses `awaiting_customer`; contradictions and judgment cases use `escalated`. If the triage result cannot establish whether execution remains, the case stays open rather than guessing. A resolved-case follow-up is history and preserves the resolved status unless the caller explicitly supplies `reopen_case: true`; only that explicit path reopens it as escalated.

## Service targets and consequential actions

`decision_due_at` is calculated at case creation using `CUSTOMER_RESPONSE_TAT_HOURS`, defaulting to 24 hours. This is the Customer Response / Decision TAT: the customer should receive a substantive decision or status update within that window. It is not an Action Execution / Fulfilment TAT. Courier pickup, refund settlement, replacement dispatch, and similar downstream work can follow separate operational targets that are not defined here.

Consequential action categories include returns, full or partial refunds, cancellations, replacements, store credit, discounts or compensation, warranty actions, delivery-address changes, account identity changes, unauthorized payments, payment disputes, and chargebacks. These categories do not automatically require a human decision when authoritative policy and verified facts determine eligibility. Actual external writes—issuing money, cancelling orders, changing delivery details, dispatching inventory, or changing accounts—remain outside this milestone and behind human approval.

The checked-in SQL adds `customers`, `cases`, and `case_events`, and links `triage_runs` to `request_id` and `case_id`. The application repository keeps case matching independent from Supabase so it can be tested in memory. The Supabase adapter currently performs the related writes sequentially; a future database RPC can make customer/case/event/triage persistence transactional if production load requires an atomic boundary.

No email, phone, WhatsApp, Gorgias, Zendesk, Shopify, or other omnichannel connector is implemented. No live Shopify or other external write action is performed.

## Reliability boundaries

- Only `policies/` is an ingestion source. `answer_key/` is validation-only and excluded by construction.
- Document and section metadata remain attached to every chunk for traceability.
- Ingestion failures produce a non-zero exit code and identify the affected file.
- The embedding model, dimension, and document/query input types must stay aligned.
- Secrets belong in environment variables; `.env` is ignored by Git.
- The RPC returns ranked evidence without imposing an unvalidated similarity threshold.
- Multiple versions of the same retrieved policy section trigger a deterministic contradiction constraint before the model runs.
- Model output that violates a deterministic evidence constraint is rejected locally rather than accepted as a valid triage decision.
- Customer identity and case matching happen before RAG and never rely on model judgment.
- A request ID is technical trace context and is not inserted into customer-facing drafts.
