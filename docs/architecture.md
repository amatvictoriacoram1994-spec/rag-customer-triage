# Architecture

## Ingestion path

Ingestion is an offline, privileged operation. `src/ingestPolicies.ts` reads only direct `.md` files in `policies/`; it neither walks the repository nor accesses `answer_key/`. Each file is validated, split at numbered section headings, and embedded with Voyage AI using `voyage-4-lite`, `input_type: document`, and 1024 dimensions.

Each section is stored as one row in `public.policy_chunks`. Its deterministic `chunk_key` combines document ID, version, and section number, allowing safe reruns through an upsert. The Supabase secret key is appropriate only for this trusted server-side process and must never be exposed to browsers or customers.

## Runtime retrieval path

At runtime, the customer query is embedded with the same model and dimension but with `input_type: query`. The query vector is passed to `public.match_policy_chunks`, which ranks stored chunks by pgvector cosine distance and returns the closest sections with provenance and similarity.

Retrieval supplies evidence; it does not make a final support decision. A later n8n workflow can pass the retrieved policy sections and ticket context to Claude, require citations to returned chunks, and route ambiguous, conflicting, or high-risk cases for human review.

## Reliability boundaries

- Only `policies/` is an ingestion source. `answer_key/` is validation-only and excluded by construction.
- Document and section metadata remain attached to every chunk for traceability.
- Ingestion failures produce a non-zero exit code and identify the affected file.
- The embedding model, dimension, and document/query input types must stay aligned.
- Secrets belong in environment variables; `.env` is ignored by Git.
- The RPC returns ranked evidence without imposing an unvalidated similarity threshold.
