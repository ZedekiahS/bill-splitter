import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {createDraftStore,draftScope,draftKey,draftWriter} from '../public/scripts/expense-drafts.mjs';
const scope=draftScope('api','alice','trip');
const draft=(changes={})=>({key:draftKey(scope),scope,title:'未完成住宿',options:{},form:{fields:{amount:'1.',title:'住宿'},receipts:[{dataUrl:'data:image/png;base64,AAAA'}]},...changes});
test('drafts persist incomplete input and attachments across store instances',async()=>{
  const factory=new IDBFactory(),first=createDraftStore(factory),record=await first.put(draft());
  const reopened=createDraftStore(factory),saved=await reopened.get(record.key);
  assert.deepEqual(saved.form,record.form);assert.equal(saved.form.fields.amount,'1.');assert.equal(saved.revision,record.revision);
});
test('account, ledger, mode and editor identities isolate drafts',async()=>{
  const store=createDraftStore(new IDBFactory());await store.put(draft());
  for(const other of [draftScope('api','bob','trip'),draftScope('api','alice','home'),draftScope('demo','alice','trip')])assert.deepEqual(await store.list(other),[]);
  const keys=[{}, {expenseId:'a'},{expenseId:'b'},{templateMode:true},{templateMode:true,templateId:'a'},{initial:{id:'a'},occurrence:{date:'2026-11-01'}},{initial:{id:'a'},occurrence:{date:'2026-11-02'}}].map(options=>draftKey(scope,options));
  assert.equal(new Set(keys).size,keys.length);
});
test('concurrent tabs cannot replace or delete a newer draft',async()=>{
  const store=createDraftStore(new IDBFactory()),first=await store.put(draft());
  const outcomes=await Promise.allSettled([store.put(draft({title:'A'}),first.revision),store.put(draft({title:'B'}),first.revision)]);
  assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,1);
  await assert.rejects(store.remove(first.key,first.revision),/另一个页面/);
  assert.ok(await store.get(first.key));
});
test('writer serializes rapid edits and clears only after a successful commit',async()=>{
  const store=createDraftStore(new IDBFactory()),writer=draftWriter(store,draft());
  for(let index=0;index<12;index++)writer.save(draft({title:String(index)}));
  await writer.flush();assert.equal((await store.get(draft().key)).title,'11');
  await writer.clear();await writer.save(draft({title:'late pagehide'}));assert.equal(await store.get(draft().key),null);
});
test('quota failures are reported and do not erase the previously saved draft',async()=>{
  const statuses=[];let deleted=false;
  const writer=draftWriter({put:async()=>{throw Error('QuotaExceeded');},remove:async()=>{deleted=true;}},draft(),(...status)=>statuses.push(status));
  await writer.save(draft());assert.equal(statuses.at(-1)[0],'error');
  await writer.save(draft({title:'more input'}));assert.equal(statuses.at(-1)[0],'error');
  await assert.rejects(writer.clear());assert.equal(deleted,false);
});
test('an uncertain submission retains its idempotency key and payload signature on reopen',async()=>{
  const store=createDraftStore(new IDBFactory()),attempt={key:crypto.randomUUID(),signature:'same command'};
  await store.put(draft({attempt}));assert.deepEqual((await store.get(draft().key)).attempt,attempt);
});
