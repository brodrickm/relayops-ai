# CONVERSATION002 synthetic reference

Run `node --test conversation.test.mjs` with Node 18 or later. No dependencies, network calls, model calls, transcription or speech synthesis are used.

This deterministic reference demonstrates twelve conversation boundary scenarios. It is not connected to existing approval modules, storage, messaging, authentication or audio services. Trusted context flags are a test seam, not authentication. Deduplication is memory only and must become durable before integration. No transcript is an authorization credential. Output audio preference is metadata only; no audio is generated.

PM scope: only staging/conversation-001/* on an isolated branch in brodrickm/relayops-ai after access verification. Root approval, STORY002 backend and Claude frontend files remain allocated to their owners. Integration needs Security and independent QA acceptance, trusted server identity, durable event and action writes, signed webhook verification, media URL controls, bounded retention, budget reservation, receipts and provider selection. Real voice and carrier acceptance are open.

Rollback: discard this isolated fixture folder or close an eventual draft PR. No production rollback, migrations or credential changes are needed because none occurred.
