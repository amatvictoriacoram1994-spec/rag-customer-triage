# Deployment

This API can be hosted as a Node.js web service on platforms such as Render. It does not use Docker.

## Environment variables

Configure these values in the hosting provider's environment-variable settings:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `VOYAGE_API_KEY`
- `ANTHROPIC_API_KEY`
- `CUSTOMER_RESPONSE_TAT_HOURS` (optional; defaults to `24`)

Do not commit real credentials. The included `.env.example` contains placeholders only. The hosting platform supplies `PORT`; the API falls back to port `3000` when running locally.

## Service commands

- Build command: `npm install && npm run build`
- Start command: `npm start`

The server binds to `0.0.0.0` so the hosting platform can route public traffic to it.

## Endpoints

- Health check: `GET /health`
- Triage: `POST /triage`

Example triage body:

```json
{
  "source": "test_webhook",
  "customer_query": "My backpack zip stopped working five days after delivery. Can I get a replacement?",
  "order_id": "NG-1001"
}
```

`customer_query` is required. Existing `source` and `order_id` inputs remain compatible. The API also accepts optional channel-independent case context:

```json
{
  "source": "email",
  "customer_query": "I am following up about my damaged backpack.",
  "order_id": "NG-1001",
  "confirm_case_reference": "CASE-7K4M2Q",
  "customer": {
    "external_customer_id": "CUST-001",
    "email": "customer@example.com",
    "phone": "+1 555 0100"
  },
  "external_message_id": "email-provider-message-id",
  "new_issue": false,
  "reopen_case": false
}
```

Apply `sql/customer_case_foundation.sql` before deploying this API version. Set `CUSTOMER_RESPONSE_TAT_HOURS` to a positive number if the default 24-hour customer decision/status target needs to change. This target does not promise completion of refunds, pickup, replacement dispatch, or other fulfilment work.

Use either `case_reference` for a known case or `confirm_case_reference` to confirm the candidate returned by the API; clients normally send only one. A single plausible active case returns `needs_case_confirmation`, while several return `needs_case_selection`. Both contain only safe summaries and identifiers, and neither attaches the interaction. `new_issue: true` creates another case. `reopen_case: true` requires a referenced case and explicitly reopens a resolved case as escalated.

Successful triage responses include `case_reference`, `case_status`, `decision_due_at`, `information_required`, and `action_status`. `action_status` distinguishes no remaining execution, pending downstream execution, and an unclear state. `request_id` remains technical trace metadata and must not be copied automatically into customer-facing drafts.

The API currently uses mock Shopify-shaped order context from Supabase. It is not connected to a real Shopify store.
