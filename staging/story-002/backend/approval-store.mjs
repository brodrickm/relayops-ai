import { DatabaseSync } from 'node:sqlite';
import { decide } from '../decide.mjs';
import { createHash } from 'node:crypto';

// Synthetic reference only. resolveSession must be server controlled, never a request body.
export function openStore(path, resolveSession) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout=100; CREATE TABLE IF NOT EXISTS approvals(account TEXT,id TEXT,body TEXT,PRIMARY KEY(account,id)); CREATE TABLE IF NOT EXISTS requests(account TEXT,key TEXT,intent TEXT,result TEXT,PRIMARY KEY(account,key));');
  const canonical = x => JSON.stringify(x,(_,v)=>v && typeof v==='object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])) : v);
  const validInstant = value => {
    if (typeof value !== 'string') return false;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
    if (!match) return false;
    const [,year,month,day,hour,minute,second,,sign,offsetHour='0',offsetMinute='0'] = match;
    const y=Number(year), mo=Number(month), d=Number(day), h=Number(hour), mi=Number(minute), s=Number(second), oh=Number(offsetHour), om=Number(offsetMinute);
    const daysInMonth = new Date(Date.UTC(y,mo,0)).getUTCDate();
    return mo>=1 && mo<=12 && d>=1 && d<=daysInMonth && h<=23 && mi<=59 && s<=59 &&
      (!sign || (oh<=14 && om<=59 && (oh<14 || om===0))) && !Number.isNaN(Date.parse(value));
  };
  const storeError = (message, cause) => Object.assign(new Error(message,{cause}),{code:'STORE_FAILURE'});
  const browserApproval = a => ({id:a.id,state:a.state,payload:a.payload,expiresAt:a.expiresAt,decidedAt:a.decisionRecord?.decidedAt ?? null});
  return {
    listApprovals(sessionHandle) {
      const actor=resolveSession(sessionHandle);
      if(!actor?.id || !actor?.accountId) return {ok:false,code:'UNAUTHENTICATED'};
      try {return {ok:true,approvals:db.prepare('SELECT body FROM approvals WHERE account=? ORDER BY id LIMIT 100').all(actor.accountId).map(r=>browserApproval(JSON.parse(r.body)))};}
      catch(error){throw storeError('approval read failed',error);}
    },
    submitBrowser(sessionHandle,input,now) {
      const r=this.submit(sessionHandle,input,now);
      if(!r.ok) return r;
      const d=r.record;
      return {ok:true,repeated:r.repeated??false,approval:browserApproval(r.approval),record:{requestId:d.requestId,approvalId:d.approvalId,decision:d.decision,decidedAt:d.decidedAt,executed:d.executed}};
    },
    seed(a) { db.prepare('INSERT INTO approvals VALUES(?,?,?)').run(a.accountId,a.id,JSON.stringify(a)); },
    submit(sessionHandle, input, now) {
      const actor = resolveSession(sessionHandle);
      if (!actor?.id || !actor?.accountId) return {ok:false,code:'UNAUTHENTICATED'};
      if (typeof input?.approvalId !== 'string' || input.approvalId.trim()==='' || input.approvalId.length>128 || typeof input?.requestId !== 'string' || input.requestId.trim()==='' || input.requestId.length>128) return {ok:false,code:'INVALID_REQUEST'};
      if(input.type==='edit' && Object.values(input.changes??{}).some(v=>typeof v==='string' && v.trim()==='')) return {ok:false,code:'INVALID_EDIT'};
      if (!validInstant(now)) return {ok:false,code:'INVALID_NOW'};
      let intent;
      try { intent=createHash('sha256').update(canonical({id:input.approvalId,actor:actor.id,type:input.type,changes:input.changes??null})).digest('hex'); }
      catch { return {ok:false,code:'INVALID_REQUEST'}; }
      let begun=false;
      try {
        db.exec('BEGIN IMMEDIATE'); begun=true;
        const row=db.prepare('SELECT body FROM approvals WHERE account=? AND id=?').get(actor.accountId,input.approvalId);
        if (!row) { db.exec('ROLLBACK'); return {ok:false,code:'NOT_AVAILABLE'}; }
        const prior=db.prepare('SELECT intent,result FROM requests WHERE account=? AND key=?').get(actor.accountId,input.requestId);
        if(prior) { db.exec('ROLLBACK'); return prior.intent===intent ? {...JSON.parse(prior.result),repeated:true} : {ok:false,code:'REQUEST_ID_CONFLICT'}; }
        const approval=JSON.parse(row.body);
        if (approval.expiresAt != null && !validInstant(approval.expiresAt)) {db.exec('ROLLBACK'); return {ok:false,code:'INVALID_EXPIRY'};}
        const result=decide(approval,{type:input.type,requestId:input.requestId,changes:input.changes},actor,now);
        if(!result.ok) { db.exec('ROLLBACK'); return result; }
        const changed=db.prepare('UPDATE approvals SET body=? WHERE account=? AND id=? AND body=?').run(JSON.stringify(result.approval),actor.accountId,input.approvalId,row.body);
        if(changed.changes!==1) throw new Error('conditional write lost');
        db.prepare('INSERT INTO requests VALUES(?,?,?,?)').run(actor.accountId,input.requestId,intent,JSON.stringify(result));
        db.exec('COMMIT'); return result;
      } catch(error) {
        try { if(begun) db.exec('ROLLBACK'); }
        catch(rollbackError) { throw storeError('approval transaction and rollback failed',new AggregateError([error,rollbackError])); }
        throw storeError('approval transaction failed',error);
      }
    },
    close(){db.close();}
  };
}
