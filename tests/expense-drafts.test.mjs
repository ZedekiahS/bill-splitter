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


const {expenseForm,reconcileExpenseDraft,resolveExpenseDraft}=await import('../public/scripts/expense-recovery.mjs');
const original={id:'expense',version:1,title:'Dinner',date:'2026-11-06',note:'',amountCents:10000,payerMemberId:'a',shares:{a:2500,b:2500},items:[],receipts:[],repaid:{a:0,b:0}};
function correction(){return {options:{expenseId:'expense',initial:structuredClone(original)},form:expenseForm(original),attempt:{key:'old'}};}
test('new expense, each source template and continuous entry keep separate drafts',()=>{
  const keys=[{}, {sourceTemplateId:'rent'}, {sourceTemplateId:'food'}, {templateMode:true,templateId:'rent'}, {entryId:'next'}].map(o=>draftKey(scope,o));
  assert.equal(new Set(keys).size,5);
});
test('recovery keeps my title and another member note without replacing either',()=>{
  const record=correction();record.form.fields.title='Dinner corrected';
  const latest={...original,version:2,note:'Other member note'};
  const groups=reconcileExpenseDraft(record,latest);
  assert.equal(groups.some(row=>row.conflict),false);
  const next=resolveExpenseDraft(record,latest,groups);
  assert.equal(next.form.fields.title,'Dinner corrected');assert.equal(next.form.fields.note,latest.note);
  assert.equal(next.options.initial.version,2);assert.equal(next.attempt,null);
  assert.equal(record.options.initial.version,1);
});
test('overlapping changes require an explicit field choice, without losing unrelated edits',()=>{
  const record=correction();record.form.fields.title='Mine';record.form.fields.note='My note';
  const latest={...original,version:3,title:'Theirs'};
  const groups=reconcileExpenseDraft(record,latest);assert.equal(groups.find(row=>row.key==='title').conflict,true);
  const next=resolveExpenseDraft(record,latest,groups,{title:'current'});
  assert.equal(next.form.fields.title,'Theirs');assert.equal(next.form.fields.note,'My note');
});
test('implicit payer remainder is compared as actual consumption, without false conflicts',()=>{
  const record=correction();record.form.splitType='percent';record.form['data-percent']={a:'25',b:'25'};
  const groups=reconcileExpenseDraft(record,{...original,version:2,note:'New'});
  assert.equal(groups.find(row=>row.key==='financial').changed,false);
});
test('payment locks prevent stale draft financial edits and retain metadata',()=>{
  const record=correction();record.form.fields.amount='110.00';record.form['data-share-amount'].a='85.00';record.form.fields.note='My note';
  const latest={...original,version:2,repaid:{b:1000}};
  const groups=reconcileExpenseDraft(record,latest);
  assert.equal(groups.find(row=>row.key==='financial').restricted,true);
  assert.throws(()=>resolveExpenseDraft(record,latest,groups,{financial:'mine'}),/已收款/);
  const next=resolveExpenseDraft(record,latest,groups);
  assert.equal(next.form.fields.amount,'100.00');assert.equal(next.form.fields.note,'My note');
});
test('incomplete amounts and uploaded receipts survive review without coercion',()=>{
  const record=correction();record.form.fields.amount='1.';record.form.receipts=[{name:'my.png',dataUrl:'data:image/png;base64,AA=='}];
  const latest={...original,version:2,note:'Other note'};
  const next=resolveExpenseDraft(record,latest,reconcileExpenseDraft(record,latest));
  assert.equal(next.form.fields.amount,'1.');assert.deepEqual(next.form.receipts,record.form.receipts);assert.equal(next.form.fields.note,'Other note');
});
test('concurrent receipt replacements are exposed as a conflict',()=>{
  const record=correction();record.form.receipts=[{id:'mine',name:'mine.png'}];
  const latest={...original,version:2,receipts:[{id:'remote',name:'remote.png'}]};
  const groups=reconcileExpenseDraft(record,latest);assert.equal(groups.find(row=>row.key==='receipts').conflict,true);
  assert.deepEqual(resolveExpenseDraft(record,latest,groups,{receipts:'current'}).form.receipts,latest.receipts);
});

const {completePercentages}=await import('../public/scripts/percentage-entry.mjs');
test('percentage entry starts equal and automatically completes the unedited shares',()=>{
  assert.deepEqual(completePercentages(['a','b'],{a:'60',b:'50'},['a']),{a:'60',b:'40.00'});
  assert.deepEqual(completePercentages(['a','b','c'],{},[]),{a:'33.34',b:'33.33',c:'33.33'});
  assert.deepEqual(completePercentages(['a','b','c'],{a:'60',b:'33.33',c:'33.33'},['a']),{a:'60',b:'20.00',c:'20.00'});
  assert.deepEqual(completePercentages(['a','b','c'],{a:'60',b:'30',c:'20'},['a','b']),{a:'60',b:'30',c:'10.00'});
  assert.deepEqual(completePercentages(['a','b','c'],{a:'33.34',b:'25',c:'25'},['b','c']),{a:'50.00',b:'25',c:'25'});
});
test('automatic percentages never produce negative values or round away manual inputs',()=>{
  assert.equal(completePercentages(['a','b','c'],{a:'70',b:'40'},['a','b']),null);
  assert.equal(completePercentages(['a','b'],{a:''},['a']),null);
  assert.equal(completePercentages(['a','b'],{a:'33.333'},['a']),null);
  const result=completePercentages(['a','b','c','d'],{a:'0.01'},['a']);
  assert.equal(result.a,'0.01');assert.equal(Object.values(result).reduce((sum,value)=>sum+Math.round(Number(value)*100),0),10000);
});
