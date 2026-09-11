# Korra n8n production contract

## Workflow 1: Korra Approval Gated Intake

Workflow ID: `J78JNcLYLI83YOmv`

### Public webhook

* Method: `POST`
* Production URL: `https://automation-testing.app.n8n.cloud/webhook/korra-intake`
* Response mode: respond using the Respond to Webhook node
* Accept JSON fields: `full_name`, `business`, `email`, `phone`, `sms_consent`, `workflow_bottleneck`, `monthly_inquiry_volume`, `idempotency_key`
* Read `x-idempotency-key` from the incoming header. Fall back to the body value.

### Normalize

Send this JSON to the intake Edge Function:

```json
{
  "organization_id": "66ca277b-3084-4b8d-863a-ac567ed3ab3f",
  "source": "korra_web",
  "full_name": "{{$json.body.full_name}}",
  "business": "{{$json.body.business}}",
  "email": "{{$json.body.email}}",
  "phone": "{{$json.body.phone}}",
  "sms_consent": "{{$json.body.sms_consent === true}}",
  "request": "{{$json.body.workflow_bottleneck}}",
  "monthly_inquiry_volume": "{{$json.body.monthly_inquiry_volume}}",
  "idempotency_key": "{{$json.headers['x-idempotency-key'] || $json.body.idempotency_key}}"
}
```

### Intake Edge Function request

* Method: `POST`
* URL: `https://tnglirnfemphhndwfgbs.supabase.co/functions/v1/relay-intake`
* Credential name: `Korra Supabase Edge Auth`
* Credential type: n8n Custom Auth
* Credential headers: `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` and `x-relayops-secret: <RELAYOPS_WEBHOOK_SECRET>`
* Header: `Content-Type: application/json`
* Header: `x-idempotency-key: {{$json.idempotency_key}}`
* Timeout: 20000 milliseconds
* Retry on failure: enabled, 3 attempts, 5000 milliseconds between attempts

### Intake response

Return the Edge Function body unchanged. Required fields are:

```json
{
  "ok": true,
  "duplicate": false,
  "submission_id": "uuid",
  "tester_id": "uuid",
  "lead_id": "uuid",
  "action_id": "uuid",
  "status": "approval_required",
  "next_step": "string",
  "receipt": {
    "acknowledgment": "queued",
    "approval": "queued",
    "sms": "queued or skipped"
  }
}
```

Do not rebuild or select only part of this response. The current production gap is caused by dropping `submission_id`, `duplicate`, `next_step`, and `receipt`.

Branching:

1. HTTP 200 or 201: return the exact body.
2. HTTP 400: return 400 with the safe validation error.
3. HTTP 401: stop and alert the operator. Do not retry until the credential is corrected.
4. HTTP 500: retry up to 3 times. If still failing, return 502 and retain the Edge Function audit failure.
5. When `duplicate` is true: return normally and do not create or send anything else in this workflow.

## Workflow 2: Korra Lifecycle Delivery

### Trigger

Use a Schedule Trigger every 5 minutes.

### Claim due messages

* Method: `POST`
* URL: `https://tnglirnfemphhndwfgbs.supabase.co/functions/v1/lifecycle-worker`
* Credential: `Korra Supabase Edge Auth`
* Body: `{}`
* Timeout: 20000 milliseconds
* Do not retry this claim request inside the HTTP node. Let the next schedule run recover it.
* Response fields: `messages` array and `claimed` count

Split out `messages`. For every item, use `id` as the execution correlation key and `idempotency_key` as the provider idempotency key when the provider supports it.

### Email branches

Credential name: `Korra Gmail OAuth2`

The connected Google account must be `rick.automation.testing@gmail.com`.

1. `tester_acknowledgment`

   Recipient: `recipient`

   Subject: `payload.subject`

   Body must include `payload.first_name`, `payload.app_url`, each item in `payload.steps`, `payload.feedback_url`, and `payload.safety`.

2. `tester_followup`

   Recipient: `recipient`

   Subject: `payload.subject`

   Body must include `payload.app_url` and `payload.feedback_url`.

3. `approval_request`

   Recipient: `recipient`

   Subject: `payload.subject`

   Body must include `payload.summary`, `payload.suggested_reply`, and the secure `payload.approval_url`. State that nothing runs until this specific action is approved.

4. `approval_result`

   Recipient: `recipient`

   Body must include `payload.decision` and `payload.action_id`.

### SMS branch

Run only when `channel` is `sms` and `message_kind` is `approval_request`.

Credential name: `Korra Twilio API`

Send to `recipient` from the configured Twilio number. Include the action ID and `payload.approval_url`. Use `idempotency_key` as the provider correlation value when supported.

Do not enable approval by SMS reply until the provider webhook securely correlates the sender, action, and one time request. The secure link is the approval mechanism now.

### Persist success

Use the same service role credential against Supabase REST:

* Method: `PATCH`
* URL: `https://tnglirnfemphhndwfgbs.supabase.co/rest/v1/outbound_messages?id=eq.{{$json.id}}`
* Headers: `apikey: <SUPABASE_SERVICE_ROLE_KEY>`, `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`, `Content-Type: application/json`, `Prefer: return=minimal`
* Body:

```json
{
  "status": "sent",
  "provider": "gmail or twilio",
  "provider_message_id": "{{$json.provider_message_id}}",
  "attempt_count": "{{$json.attempt_count + 1}}",
  "sent_at": "{{$now}}",
  "last_error": null,
  "updated_at": "{{$now}}"
}
```

Also update the linked tester acknowledgment or followup status, or the linked approval request email or SMS status, to `sent`.

### Persist failure

Continue the workflow on provider error and patch the message:

```json
{
  "status": "failed",
  "attempt_count": "{{$json.attempt_count + 1}}",
  "next_retry_at": "5 minutes after attempt 1, 15 minutes after attempt 2, null after attempt 3",
  "last_error": "sanitized provider error",
  "updated_at": "{{$now}}"
}
```

After attempt 3, keep status `failed`, alert the operator, and do not send again. Never store credential values or full provider responses in `last_error`.

## Approval execution gate

A separate continuation may select only actions where all of these conditions are true:

* `agent_actions.status = approved`
* `agent_actions.risk = approval_required`
* `approval_requests.decision = approved`
* `approval_requests.decided_at is not null`
* `agent_actions.executed_at is null`

Rejected, pending, expired, and already executed actions must stop.

After the approved action succeeds, update `agent_actions.status` to `executed` and set `executed_at`. On failure, update `status` to `failed`, store a sanitized error, and notify the operator. No high impact action may bypass this branch.
