# Korra approval gated lifecycle

The only in scope n8n workflow is `Korra — Approval-Gated Intake` (`J78JNcLYLI83YOmv`). Deanna named workflows and `Business Concierge MVP` remain unrelated assignment material.

## Public path

1. The website posts to same origin `POST /api/intake` with an idempotency key.
2. The server relay validates and forwards to `KORRA_N8N_WEBHOOK_URL`.
3. n8n normalizes the intake and calls the Supabase `relay-intake` Edge Function.
4. The Edge Function upserts the tester, deduplicates the intake, creates the lead, prepares a private draft, and logs a proposed action.
5. The Edge Function creates expiring approval and feedback links and queues acknowledgment, approval, and follow up delivery records.
6. n8n sends only queued messages, records provider identifiers or failures, and retries within the configured attempt limit.
7. The website displays the exact next step and safety boundary immediately.
8. Approved actions may continue only after an unexpired secure decision changes the action to `approved`.

## Required safety state

* Lead status is `awaiting_approval`.
* Action risk is `approval_required`.
* Action status remains `proposed` until a valid approval decision.
* `executed_at` remains empty until an approved action actually finishes.
* Duplicate intake cannot create duplicate outbound messages because every message has a unique idempotency key.
