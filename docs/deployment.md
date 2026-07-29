# Deployment

This API can be hosted as a Node.js web service on platforms such as Render. It does not use Docker.

## Environment variables

Configure these values in the hosting provider's environment-variable settings:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `VOYAGE_API_KEY`
- `ANTHROPIC_API_KEY`

Do not commit real credentials. The included `.env.example` contains placeholders only. The hosting platform supplies `PORT`; the API falls back to port `3000` when running locally.

## Service commands

- Build command: `npm install && npm run typecheck`
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

`customer_query` is required and `order_id` is optional.

The API currently uses mock Shopify-shaped order context from Supabase. It is not connected to a real Shopify store.
