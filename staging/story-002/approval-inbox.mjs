import { buildProfileContext } from './profile-context.mjs';
import { decide } from './decide.mjs';

const hoursBetween = (later, earlier) => Math.max(0, Math.floor((Date.parse(later) - Date.parse(earlier)) / 3600000));

export function buildApprovalInbox(input) {
  const context = buildProfileContext(input);
  if (context.status !== 'ok') return context;
  return {
    status: 'ok',
    accountId: context.accountId,
    empty: context.approvals.length === 0,
    approvals: context.approvals.map((approval) => ({
      ...approval,
      ageHours: approval.observedAt ? hoursBetween(context.asOf, approval.observedAt) : null,
      expiresInHours: approval.expiresAt ? hoursBetween(approval.expiresAt, context.asOf) : null,
      expired: approval.expiresAt ? Date.parse(approval.expiresAt) <= Date.parse(context.asOf) : false,
    })),
    executedActions: [],
  };
}

export function recordInboxDecision(item, accountId, decision, actor, now) {
  const approval = {
    id: item.sourceId ?? item.id,
    accountId: item.accountId ?? accountId,
    state: item.state,
    expiresAt: item.expiresAt,
    decisionRecord: item.decisionRecord,
    payload: { requestedAction: item.requestedAction },
  };
  if (accountId !== approval.accountId) return { ok: false, code: 'FOREIGN_ACCOUNT' };
  return decide(approval, decision, actor, now);
}

export function renderApprovalInbox(container, inbox, onDecision) {
  container.replaceChildren();
  if (inbox.status !== 'ok') {
    const error = document.createElement('p');
    error.textContent = 'Approvals are unavailable.';
    container.append(error);
    return;
  }
  if (inbox.empty) {
    const empty = document.createElement('p');
    empty.textContent = 'No approvals need your attention.';
    container.append(empty);
    return;
  }
  for (const approval of inbox.approvals) {
    const card = document.createElement('article');
    const title = document.createElement('h2');
    title.textContent = approval.requestedAction ?? 'Approval request';
    const meta = document.createElement('p');
    meta.textContent = `Age: ${approval.ageHours ?? 'unknown'} hours. Expires in: ${approval.expiresInHours ?? 'unknown'} hours. Source: ${approval.sourceId ?? 'unknown'}.`;
    if (approval.stale) meta.dataset.stale = 'true';
    card.append(title, meta);
    for (const type of ['approve', 'reject']) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = type === 'approve' ? 'Approve' : 'Reject';
      button.addEventListener('click', () => {
        const result = onDecision(approval, type);
        if (result?.ok) {
          Object.assign(approval, result.approval);
          for (const control of card.querySelectorAll('button')) control.disabled = true;
        }
      });
      card.append(button);
    }
    container.append(card);
  }
}

