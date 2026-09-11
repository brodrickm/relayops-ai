# Korra

Production source for the Korra public site, approval gated intake relay, brand assets, lifecycle services, and message templates.

## Production flow

`POST /api/intake` validates the public form and relays only to `KORRA_N8N_WEBHOOK_URL`. The n8n workflow calls the Supabase `relay-intake` Edge Function, which creates or updates the tester lifecycle record, deduplicates repeated intake, prepares a private deterministic draft, creates an expiring approval request, and queues tester acknowledgment, owner approval, and tester follow up messages. It does not execute external actions before approval.

Production lifecycle state is recorded in `testers`, `intake_submissions`, `outbound_messages`, `approval_requests`, `tester_feedback`, and `lifecycle_events`. The private `korra_owner_attention` view shows approvals, failures, and the next best action.

Public token protected Edge Functions:

* `approval-action` records one approve or reject decision before expiry.
* `tester-feedback` captures structured tester feedback and cancels pending follow up.

The `lifecycle-worker` endpoint claims due messages for n8n delivery and retry handling. It requires the existing relay secret and Supabase authorization.

Required Vercel environment variable:

`KORRA_N8N_WEBHOOK_URL=https://automation-testing.app.n8n.cloud/webhook/korra-intake`

Optional SMS approval delivery requires Twilio account credentials, a Twilio sender number, the owner phone number, and explicit owner SMS consent. Without all four, SMS remains recorded as skipped and is never reported as sent.
