import { DatabaseSync } from 'node:sqlite';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from './approval-store.mjs';
const now='2026-10-09T05:00:00Z';
const sessions={a:{id:'owner',accountId:'A'},b:{id:'other',accountId:'B'}};
const resolve=x=>sessions[x];
test('scoped browser reads and decisions exclude identity and reject blank edits',()=>{
const s=openStore(':memory:',resolve);try{
s.seed({id:'one',accountId:'A',state:'pending',payload:{note:'safe'}});
s.seed({id:'other',accountId:'B',state:'pending',payload:{note:'other'}});
assert.equal(s.listApprovals('bad').code,'UNAUTHENTICATED');
assert.deepEqual(s.listApprovals('a').approvals.map(a=>a.id),['one']);
const i={approvalId:'one',requestId:'r',type:'edit',changes:{note:''}};
assert.equal(s.submit('a',i,now).code,'INVALID_EDIT');
assert.equal(s.submit('a',{...i,approvalId:'x'.repeat(129)},now).code,'INVALID_REQUEST');
const r=s.submitBrowser('a',{...i,type:'approve',changes:undefined},now);
assert.equal(r.ok,true);assert.equal(r.record.executed,false);
assert.equal(JSON.stringify(r).includes('accountId'),false);assert.equal(JSON.stringify(r).includes('actor'),false);
assert.equal(s.submitBrowser('a',{...i,type:'approve',changes:undefined},now).repeated,true);
}finally{s.close();}});
test('decision timestamp survives browser projection, replay and reload without exposing the audit record',()=>{
 const dir=mkdtempSync(join(tmpdir(),'loafwise-time-')); const path=join(dir,'db'); let s=openStore(path,resolve);
 try {
  s.seed({id:'one',accountId:'A',state:'pending',payload:{x:1}});
  assert.equal(s.listApprovals('a').approvals[0].decidedAt,null);
  const input={approvalId:'one',requestId:'timestamp',type:'approve'};
  const first=s.submitBrowser('a',input,now);
  assert.equal(first.approval.decidedAt,first.record.decidedAt);
  assert.equal(Object.hasOwn(first.approval,'decisionRecord'),false);
  const expected=first.record.decidedAt;
  s.close(); s=openStore(path,resolve);
  assert.equal(s.listApprovals('a').approvals[0].decidedAt,expected);
  assert.equal(s.submitBrowser('a',input,now).approval.decidedAt,expected);
  assert.equal(s.listApprovals('b').approvals.length,0);
 } finally {s.close();rmSync(dir,{recursive:true});}
});
test('durable replay after restart, changed intent and cross approval key refused',()=>{
 const dir=mkdtempSync(join(tmpdir(),'loafwise-'));const path=join(dir,'test.sqlite');let s=openStore(path,resolve);
 try {s.seed({id:'one',accountId:'A',state:'pending',payload:{x:1}});s.seed({id:'two',accountId:'A',state:'pending',payload:{x:2}});
 const input={approvalId:'one',requestId:'r',type:'approve'};assert.equal(s.submit('a',input,now).ok,true);s.close();s=openStore(path,resolve);
 assert.equal(s.submit('a',input,now).repeated,true);
 assert.equal(s.submit('a',{...input,type:'reject'},now).code,'REQUEST_ID_CONFLICT');
 assert.equal(s.submit('a',{...input,approvalId:'two'},now).code,'REQUEST_ID_CONFLICT');
 assert.equal(s.submit('a',{...input,requestId:'second'},now).code,'ALREADY_DECIDED');
 } finally {s.close();rmSync(dir,{recursive:true});}
});
test('server session binds account; forged body cannot select another account',()=>{
const s=openStore(':memory:',resolve);try{s.seed({id:'one',accountId:'A',state:'pending',payload:{x:1}});
const i={approvalId:'one',requestId:'r',type:'approve',accountId:'A',actor:{id:'owner',accountId:'A'}};
assert.equal(s.submit('b',i,now).code,'NOT_AVAILABLE');assert.equal(s.submit('bad',i,now).code,'UNAUTHENTICATED');assert.equal(s.submit('a',i,now).ok,true);
}finally{s.close();}});
test('two connections competing for one approval record only one decision',()=>{
const dir=mkdtempSync(join(tmpdir(),'loafwise-'));const path=join(dir,'test.sqlite');const a=openStore(path,resolve),b=openStore(path,resolve);
try{a.seed({id:'one',accountId:'A',state:'pending',payload:{x:1}});
assert.equal(a.submit('a',{approvalId:'one',requestId:'r1',type:'approve'},now).ok,true);
assert.equal(b.submit('a',{approvalId:'one',requestId:'r2',type:'reject'},now).code,'ALREADY_DECIDED');
}finally{a.close();b.close();rmSync(dir,{recursive:true});}});
test('strict instant and string request identifiers are required before replay lookup',()=>{
 const s=openStore(':memory:',resolve);try{s.seed({id:'one',accountId:'A',state:'pending',payload:{x:1}});
 const base={approvalId:'one',requestId:'1',type:'approve'};
 assert.equal(s.submit('a',base,'2026-02-30T05:00:00Z').code,'INVALID_NOW');
 assert.equal(s.submit('a',base,'2026-10-09T05:00:00').code,'INVALID_NOW');
 assert.equal(s.submit('a',{...base,requestId:1},now).code,'INVALID_REQUEST');
 assert.equal(s.submit('a',base,'2026-10-09T05:00:00-05:00').ok,true);
 assert.equal(s.submit('a',{...base,requestId:'1.0'},now).code,'ALREADY_DECIDED');
 }finally{s.close();}
});

test('invalid expiry and oversized keys do not decide; closed handle faults are coded',()=>{
const s=openStore(':memory:',resolve);s.seed({id:'one',accountId:'A',state:'pending',payload:{x:1},expiresAt:'2026-02-30T05:00:00Z'});
const i={approvalId:'one',requestId:'r',type:'approve'};
assert.equal(s.submit('a',{...i,requestId:'x'.repeat(129)},now).code,'INVALID_REQUEST');
assert.equal(s.submit('a',i,now).code,'INVALID_EXPIRY');
s.close();assert.throws(()=>s.submit('a',i,now),e=>e.code==='STORE_FAILURE'&&!e.message.includes('SQLite'));
});

test('locked BEGIN is coded STORE_FAILURE and same-key retry succeeds once',()=>{
const dir=mkdtempSync(join(tmpdir(),'loafwise-lock-'));const path=join(dir,'db');const s=openStore(path,resolve),lock=new DatabaseSync(path);
try{s.seed({id:'one',accountId:'A',state:'pending',payload:{x:1}});lock.exec('BEGIN IMMEDIATE');
const i={approvalId:'one',requestId:'r',type:'approve'};
assert.throws(()=>s.submit('a',i,now),e=>e.code==='STORE_FAILURE');lock.exec('ROLLBACK');
assert.equal(s.submit('a',i,now).ok,true);assert.equal(s.submit('a',i,now).repeated,true);
}finally{lock.close();s.close();rmSync(dir,{recursive:true});}
});
