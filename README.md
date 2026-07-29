# Nivara Goods RAG Customer Triage

TypeScript scaffold for ingesting Nivara Goods policy sections into Supabase pgvector and retrieving relevant sections for a customer query.

## Safety boundary

The ingestion script reads only direct Markdown files in `policies/`. It does not recursively scan the repository and never reads or ingests `answer_key/`, which is reserved for internal validation.

## Prerequisites

- Node.js 20 or newer
- A Supabase project with pgvector enabled and the existing `public.policy_chunks` table
- A Voyage AI API key with access to `voyage-4-lite`

## Setup

1. Run `npm install`.
2. Copy `.env.example` to `.env` and provide `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `VOYAGE_API_KEY`. Keep `.env` private; the Supabase secret key is server-side only.
3. Run [`sql/match_policy_chunks.sql`](sql/match_policy_chunks.sql) in the Supabase SQL editor.

## Ingest policies

```bash
npm run ingest
```

Each numbered section becomes one row. The deterministic key is `<document-id>:<version>:<section-number>`, so rerunning ingestion updates the same chunks. Headers must include `Document ID` and `Version`; `Effective Date` and `Document Type` are optional. Numbered sections may be plain (`3. Return Window`) or Markdown-prefixed (`## 3. Return Window`).

## Search policies

```bash
npm run search -- "Can I return an item after 30 days?"
```

This embeds the query with Voyage's `query` input type, calls the `match_policy_chunks` RPC, and prints the top five chunks with provenance, similarity, and a content preview.

## Validate locally

```bash
npm run typecheck
```

See [`docs/architecture.md`](docs/architecture.md) for the ingestion/runtime boundary.
