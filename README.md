# Korra

Production source for the Korra public site, approval-gated intake relay, brand assets, and email templates.

## Brand rules

- Public-facing brand: exact Direction 1 artwork in `assets/korra-direction-1.svg` and `.png`.
- Assistant states only: Direction 2 icon for idle, listening, thinking, and ready.
- Locked palette: Ink `#0F172A`, Electric Blue `#3B82F6`, Indigo `#6366F1`, Purple `#A855F7`, Cyan `#22D3EE`, Background `#FAFAF8`.

## Intake flow

`POST /api/intake` validates the public form and relays only to `KORRA_N8N_WEBHOOK_URL`. The n8n workflow calls the Supabase Edge Function, which creates an `awaiting_approval` lead and a `proposed` `draft_lead_reply` action with `approval_required` risk. It does not send messages or execute external actions.

Required Vercel environment variable:

`KORRA_N8N_WEBHOOK_URL=https://automation-testing.app.n8n.cloud/webhook/korra-intake`

The n8n workflow must be separately approved and published before the production webhook will accept submissions.

