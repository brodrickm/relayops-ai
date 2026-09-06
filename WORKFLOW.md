# Korra intake workflow

`korra-intake` accepts a guarded lead webhook, saves the request, asks OpenAI to classify and draft a response, then saves that response as an `approval_required` action. It never sends the reply automatically.

Required server-side secrets:

- `OPENAI_API_KEY`
- `KORRA_WEBHOOK_SECRET`
- Supabase-provided `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`

The endpoint is intentionally unusable until the custom secrets are configured. Keep external sending in a separate executor that accepts only an explicitly approved `agent_actions` record.

## Approval rule

Korra may summarize, classify, draft, log, and recommend next steps without approval. Korra must request approval before sending external messages, spending money, changing account access, using sensitive data, or changing business rules.
