# Synthetic approval store for independent review

LOAFWISE SENIOR 20261008 001. OpenAI Senior Developer owns backend files only; existing root modules remain unchanged. Node 22+ with node:sqlite required.

Run from repository root: node --no-warnings --test staging/story-002/backend/approval-store.test.mjs

The injected resolveSession must be server controlled. This is a synthetic SQLite reference, not real authentication, CSRF protection or a Supabase integration. Decisions are recorded and never executed. Conditional transactions and durable request records preserve same-intent replay after restart and reject changed-intent reuse.

V5 fixes the missing browser decision timestamp using decisionRecord.decidedAt, with null for pending items. Eight local regressions pass; 12 independent store probes pass. V4 revised frontend adapter integration passes 23 checks separately. V5 frontend integration and independent acceptance remain pending. The standalone Drive package imports ../source/decide.mjs; this repository file imports the identical existing ../decide.mjs.

Open limitations: payload minimization and edit schema; silent 100-row cap and ordering; synchronous lock blocking mitigated to 100 ms; root direct-call date validation; real session/CSRF, Supabase and full staging. No production release, provider call or spend.

Rollback: close this draft PR or revert its backend-only commit(s) before any approved integration. No database migration or production data change occurred. Keep the immutable v4 candidate for comparison.
