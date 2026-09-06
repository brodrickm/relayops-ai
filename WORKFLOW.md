# Lead Relay workflow

`relay-intake` accepts a guarded lead webhook, saves the lead, asks OpenAI to classify and draft a response, then saves that response as an `approval_required` action. It never sends the reply.

Required server-side secrets:

- `OPENAI_API_KEY`
- `RELAYOPS_WEBHOOK_SECRET`
- Supabase-provided `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`

The endpoint is intentionally unusable until the two custom secrets are configured. Keep external sending in a separate executor that accepts only an explicitly approved `agent_actions` record.

