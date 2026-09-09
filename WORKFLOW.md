# Korra approval-gated intake

The only in-scope n8n workflow is `Korra — Approval-Gated Intake` (`J78JNcLYLI83YOmv`). Deanna-named workflows and `Business Concierge MVP` are unrelated assignment material and must not be reused or counted as Korra activity.

## Public path

1. The website posts to same-origin `POST /api/intake`.
2. The server-side relay validates and forwards to the Vercel environment variable `KORRA_N8N_WEBHOOK_URL`.
3. The n8n webhook normalizes the intake and calls the Supabase `relay-intake` Edge Function.
4. The Edge Function creates a lead, asks OpenAI to classify and draft, and logs a proposed action.
5. n8n rejects any response claiming an external message was sent or an action was executed.
6. The website displays a safe receipt without triggering a follow-up.

## Required outcome

- lead status: `awaiting_approval`
- action type: `draft_lead_reply`
- risk: `approval_required`
- action status: `proposed`
- `approved_at`: empty
- `executed_at`: empty

## Deployment gate

The n8n workflow is intentionally left unpublished until Brodrick approves activation. Until it is published and `KORRA_N8N_WEBHOOK_URL` is configured in Vercel, the public form returns a safe temporary-unavailable error and cannot trigger downstream work.

