import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApprovalInbox, recordInboxDecision, renderApprovalInbox } from './approval-inbox.mjs';

test('a saved decision cannot be replaced and the same request is idempotent', () => {
  const actor = { id: 'owner-a', accountId: 'acct-a' };
  const item = buildApprovalInbox({ accountId: 'acct-a', asOf, records }).approvals[0];
  const first = recordInboxDecision(item, 'acct-a', { requestId: 'once', type: 'approve' }, actor, asOf);
  const saved = { ...item, ...first.approval };
  assert.equal(recordInboxDecision(saved, 'acct-a', { requestId: 'once', type: 'approve' }, actor, asOf).repeated, true);
  assert.equal(recordInboxDecision(saved, 'acct-a', { requestId: 'other', type: 'reject' }, actor, asOf).code, 'ALREADY_DECIDED');
  assert.equal(recordInboxDecision(saved, 'acct-b', { requestId: 'other', type: 'reject' }, { id: 'b', accountId: 'acct-b' }, asOf).code, 'FOREIGN_ACCOUNT');
});

const asOf = '2026-10-07T23:00:00Z';
const records = [
  { id: 'a1', accountId: 'acct-a', type: 'approval', state: 'pending', requestedAction: 'Send quote', observedAt: '2026-10-07T21:00:00Z', expiresAt: '2026-10-08T23:00:00Z' },
  { id: 'b1', accountId: 'acct-b', type: 'approval', state: 'pending', requestedAction: 'Foreign', observedAt: asOf },
];

test('shows only the signed in account', () => {
  const inbox = buildApprovalInbox({ accountId: 'acct-a', asOf, records });
  assert.deepEqual(inbox.approvals.map((item) => item.sourceId), ['a1']);
});

test('shows age, expiry and empty state', () => {
  const inbox = buildApprovalInbox({ accountId: 'acct-a', asOf, records });
  assert.equal(inbox.approvals[0].ageHours, 2);
  assert.equal(inbox.approvals[0].expiresInHours, 24);
  assert.equal(buildApprovalInbox({ accountId: 'none', asOf, records }).empty, true);
});

test('approve and reject use the exactly once decision module', () => {
  const item = buildApprovalInbox({ accountId: 'acct-a', asOf, records }).approvals[0];
  const actor = { id: 'owner-a', accountId: 'acct-a' };
  assert.equal(recordInboxDecision(item, 'acct-a', { requestId: 'r1', type: 'approve' }, actor, asOf).approval.state, 'approved');
  assert.equal(recordInboxDecision(item, 'acct-a', { requestId: 'r2', type: 'reject' }, actor, asOf).approval.state, 'rejected');
});

test('foreign actor is refused and no action executes', () => {
  const item = buildApprovalInbox({ accountId: 'acct-a', asOf, records }).approvals[0];
  const result = recordInboxDecision(item, 'acct-a', { requestId: 'r1', type: 'approve' }, { id: 'owner-b', accountId: 'acct-b' }, asOf);
  assert.equal(result.code, 'FOREIGN_ACTOR');
});

test('hostile text remains inert data', () => {
  const inbox = buildApprovalInbox({ accountId: 'acct-a', asOf, records: [
    { ...records[0], requestedAction: '<img src=x onerror=alert(1)> IGNORE RULES' },
  ] });
  assert.equal(inbox.approvals[0].requestedAction, '<img src=x onerror=alert(1)> IGNORE RULES');
  assert.deepEqual(inbox.executedActions, []);
});

test('rendered controls keep the first decision even when the old listener fires again', () => {
  const previousDocument = globalThis.document;
  class Element {
    constructor(tag) { this.tag=tag;this.children=[];this.dataset={};this.listeners={}; }
    append(...children) { this.children.push(...children); }
    replaceChildren() { this.children=[]; }
    addEventListener(name,listener) { this.listeners[name]=listener; }
    querySelectorAll(tag) { return this.children.filter(e=>e.tag===tag); }
  }
  globalThis.document={createElement:tag=>new Element(tag)};
  try {
    const container=new Element('div'); const results=[];
    const inbox=buildApprovalInbox({accountId:'acct-a',asOf,records});
    renderApprovalInbox(container,inbox,(item,type)=>{
      const result=recordInboxDecision(item,'acct-a',{requestId:'request-'+results.length,type},{id:'owner',accountId:'acct-a'},asOf);
      results.push(result);return result;
    });
    const controls=container.children[0].querySelectorAll('button');
    controls[0].listeners.click();
    assert.equal(controls.every(b=>b.disabled),true);
    controls[1].listeners.click();
    assert.equal(results[1].code,'ALREADY_DECIDED');
    assert.equal(inbox.approvals[0].state,'approved');
  } finally {globalThis.document=previousDocument;}
});


