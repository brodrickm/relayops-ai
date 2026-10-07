// LOAFWISE STORY 20261006 001: record approval decisions exactly once.
// Pure module. No I/O, no clock reads, no network, never executes the requested action.

export const DECISIONS = Object.freeze(['approve', 'reject', 'edit']);
const STATE_FOR = Object.freeze({ approve: 'approved', reject: 'rejected', edit: 'edited' });

const fail = (code, reason) => Object.freeze({ ok: false, code, reason });
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
};

export function decide(approval, decision, actor, now) {
  if (!approval || typeof approval !== 'object') return fail('INVALID_APPROVAL', 'approval missing');
  if (!nonEmpty(approval.id) || !nonEmpty(approval.accountId)) return fail('INVALID_APPROVAL', 'approval id or accountId missing');
  if (!decision || typeof decision !== 'object') return fail('INVALID_DECISION', 'decision missing');
  if (!nonEmpty(decision.requestId)) return fail('MISSING_REQUEST_ID', 'decision.requestId required for exactly once recording');
  if (!actor || !nonEmpty(actor.id) || !nonEmpty(actor.accountId)) return fail('INVALID_ACTOR', 'actor id and accountId required');
  if (actor.accountId !== approval.accountId) return fail('FOREIGN_ACTOR', 'actor belongs to another account');
  const nowMs = Date.parse(now);
  if (!nonEmpty(now) || Number.isNaN(nowMs)) return fail('INVALID_NOW', 'now must be an ISO timestamp');

  const prior = approval.decisionRecord;
  if (prior) {
    if (prior.requestId === decision.requestId) return Object.freeze({ ok: true, repeated: true, approval, record: prior });
    return fail('ALREADY_DECIDED', `approval already ${approval.state}`);
  }
  if (approval.state !== 'pending') return fail('NOT_PENDING', `approval is ${approval.state ?? 'unknown'}`);

  if (approval.expiresAt !== undefined && approval.expiresAt !== null) {
    const exp = Date.parse(approval.expiresAt);
    if (Number.isNaN(exp)) return fail('INVALID_EXPIRY', 'expiresAt unreadable; refusing rather than guessing');
    if (nowMs >= exp) return fail('EXPIRED', 'approval expired before decision');
  }

  if (!DECISIONS.includes(decision.type)) return fail('INVALID_DECISION', 'type must be approve, reject or edit');
  let afterPayload = clone(approval.payload);
  if (decision.type === 'edit') {
    if (!decision.changes || typeof decision.changes !== 'object' || Array.isArray(decision.changes) || Object.keys(decision.changes).length === 0) return fail('INVALID_EDIT', 'edit requires a non empty changes object');
    afterPayload = { ...(afterPayload ?? {}), ...clone(decision.changes) };
  }

  const before = { state: approval.state, payload: clone(approval.payload) };
  const after = { state: STATE_FOR[decision.type], payload: afterPayload };
  const record = deepFreeze({ requestId: decision.requestId, approvalId: approval.id, accountId: approval.accountId, actor: actor.id, decision: decision.type, decidedAt: new Date(nowMs).toISOString(), before, after, executed: false });
  const next = deepFreeze({ ...clone(approval), state: after.state, payload: clone(afterPayload), decisionRecord: record });
  return Object.freeze({ ok: true, repeated: false, approval: next, record });
}
