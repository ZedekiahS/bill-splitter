import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStore } from '../public/scripts/ledger-store.mjs';
import { memberBalances } from '../public/scripts/ledger-core.mjs';
import { dueOccurrences, itemizedShares } from '../public/scripts/expense-features.mjs';
const OWNER = {uid:'features-owner',displayName:'Zed'}, ALICE={uid:'features-alice',displayName:'Alice'};
const DAY='2026-01-31';
function storage() { const values=new Map(); return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)}; }
async function fixture() {
  const memory=storage(), store=createStore({mode:'demo',storage:memory,user:OWNER});
  const id=await store.createLedger({title:'House',currency:'CNY',ownerName:'Zed'});
  const alice=await store.addMember(id,'Alice');
  const payload={title:'Rent',date:DAY,amountCents:10001,payerMemberId:'owner',shares:{owner:5001,[alice]:5000},note:'Monthly housing',frequency:'monthly',startDate:DAY};
  return {memory,store,id,alice,payload};
}
async function approve(f) {
  const invite=await f.store.createInvite(f.id,f.alice);
  const store=createStore({mode:'demo',storage:f.memory,user:ALICE});
  await store.claimInvite(invite); await f.store.approveClaim(invite,ALICE.uid); return store;
}

test('template creation and due projection never add expenses or change balances',async()=>{
  const f=await fixture(); await f.store.saveTemplate(f.id,f.payload);
  const s=await f.store.loadLedger(f.id);
  assert.equal(s.expenses.length,0); assert.deepEqual(memberBalances(s).map(r=>r.balanceCents),[0,0]);
  assert.deepEqual(dueOccurrences(s.templates,s.occurrences,'2026-03-31').map(r=>r.date),[DAY,'2026-02-28','2026-03-31']);
});
test('templates persist, edit, pause, resume and archive without deleting history',async()=>{
  const f=await fixture(), key=await f.store.saveTemplate(f.id,f.payload);
  const copy=createStore({mode:'demo',storage:f.memory,user:OWNER});
  await copy.saveTemplate(f.id,{...f.payload,title:'Updated rent'},key);
  await copy.setTemplateStatus(f.id,key,'paused');
  let s=await f.store.loadLedger(f.id); assert.equal(s.templates[0].title,'Updated rent');
  assert.equal(dueOccurrences(s.templates,s.occurrences,'2026-03-31').length,0);
  await f.store.setTemplateStatus(f.id,key,'active'); s=await copy.loadLedger(f.id);
  assert.equal(dueOccurrences(s.templates,s.occurrences,'2026-03-31').length,3);
  await f.store.setTemplateStatus(f.id,key,'archived'); s=await copy.loadLedger(f.id);
  assert.equal(s.templates.length,1); assert.equal(dueOccurrences(s.templates,s.occurrences,'2026-03-31').length,0);
});
test('confirming an occurrence atomically consumes its date and cannot charge twice after reversal',async()=>{
  const f=await fixture(), key=await f.store.saveTemplate(f.id,f.payload);
  const payload={...f.payload,sourceTemplateId:key,sourceDate:DAY};
  const expenseId=await f.store.addExpense(f.id,payload);
  let s=await f.store.loadLedger(f.id); assert.equal(s.expenses.length,1); assert.equal(s.occurrences[0].expenseId,expenseId);
  await assert.rejects(f.store.addExpense(f.id,payload),/已经处理/);
  await f.store.reverseExpense(f.id,expenseId);
  await assert.rejects(f.store.addExpense(f.id,payload),/已经处理/);
  s=await f.store.loadLedger(f.id); assert.deepEqual(memberBalances(s).map(r=>r.balanceCents),[0,0]);
  assert.equal(dueOccurrences(s.templates,s.occurrences,DAY).length,0);
});
test('skipping is persistent and never creates a monetary record',async()=>{
  const f=await fixture(), key=await f.store.saveTemplate(f.id,f.payload);
  await f.store.skipOccurrence(f.id,key,DAY);
  await assert.rejects(f.store.addExpense(f.id,{...f.payload,sourceTemplateId:key,sourceDate:DAY}),/已经处理/);
  const s=await f.store.loadLedger(f.id); assert.equal(s.expenses.length,0); assert.equal(s.occurrences[0].status,'skipped');
  assert.equal(dueOccurrences(s.templates,s.occurrences,DAY).length,0);
});
test('future, off-schedule and paused occurrences reject without consuming their dates',async()=>{
  const f=await fixture(), key=await f.store.saveTemplate(f.id,f.payload);
  for (const date of ['2026-02-27','2099-01-31']) await assert.rejects(f.store.skipOccurrence(f.id,key,date),/尚未到期/);
  await f.store.setTemplateStatus(f.id,key,'paused');
  await assert.rejects(f.store.addExpense(f.id,{...f.payload,sourceTemplateId:key,sourceDate:DAY}),/尚未到期/);
  const s=await f.store.loadLedger(f.id); assert.equal(s.expenses.length,0); assert.equal(s.occurrences.length,0);
});
test('a member cannot manage or consume another creator template, nor impersonate its payer',async()=>{
  const f=await fixture(), key=await f.store.saveTemplate(f.id,f.payload), alice=await approve(f);
  await assert.rejects(alice.saveTemplate(f.id,{...f.payload,payerMemberId:f.alice},key),/模板创建者/);
  await assert.rejects(alice.setTemplateStatus(f.id,key,'paused'),/模板创建者/);
  await assert.rejects(alice.skipOccurrence(f.id,key,DAY),/模板创建者/);
  await assert.rejects(alice.saveTemplate(f.id,f.payload),/自己垫付/);
  const own=await alice.saveTemplate(f.id,{...f.payload,payerMemberId:f.alice});
  await alice.skipOccurrence(f.id,own,DAY);
  await f.store.setTemplateStatus(f.id,own,'paused');
  const outsider=createStore({mode:'demo',storage:f.memory,user:{uid:'outsider'}});
  await assert.rejects(outsider.loadLedger(f.id),/账本成员/);
});
test('recurring confirmation allows amount edits but keeps template payer and member scope',async()=>{
  const f=await fixture(), key=await f.store.saveTemplate(f.id,f.payload), extra=await f.store.addMember(f.id,'Extra');
  await assert.rejects(f.store.addExpense(f.id,{...f.payload,sourceTemplateId:key,sourceDate:DAY,payerMemberId:f.alice}),/模板一致/);
  await assert.rejects(f.store.addExpense(f.id,{...f.payload,sourceTemplateId:key,sourceDate:DAY,shares:{[extra]:10001}}),/模板一致/);
  await f.store.addExpense(f.id,{...f.payload,sourceTemplateId:key,sourceDate:DAY,amountCents:20000,shares:{owner:10000,[f.alice]:10000}});
  const s=await f.store.loadLedger(f.id); assert.equal(s.expenses[0].amountCents,20000);
});
test('itemized expenses preserve note and receipt across reload and reject inconsistent totals',async()=>{
  const f=await fixture();
  const details=itemizedShares([{title:'Shared dish',amountCents:101,memberIds:['owner',f.alice]},{title:'Drink',amountCents:250,memberIds:[f.alice]}]);
  const receipt={name:'receipt.pdf',type:'application/pdf',size:5,dataUrl:'data:application/pdf;base64,JVBERi0='};
  const id=await f.store.addExpense(f.id,{...f.payload,...details,note:'Paid cash',receipts:[receipt]});
  const s=await createStore({mode:'demo',storage:f.memory,user:OWNER}).loadLedger(f.id);
  assert.equal(s.expenses[0].id,id); assert.equal(s.expenses[0].note,'Paid cash'); assert.deepEqual(s.expenses[0].receipts,[receipt]);
  assert.deepEqual(s.expenses[0].shares,{owner:51,[f.alice]:300});
  await assert.rejects(f.store.addExpense(f.id,{...f.payload,...details,shares:{owner:52,[f.alice]:299}}));
});
test('template stores reusable item details but excludes receipt attachments and source links',async()=>{
  const f=await fixture(), details=itemizedShares([{title:'Rent',amountCents:10000,memberIds:['owner',f.alice]}]);
  await f.store.saveTemplate(f.id,{...f.payload,...details,receipts:[{bad:true}],sourceTemplateId:'ignored',sourceDate:DAY});
  const s=await f.store.loadLedger(f.id), row=s.templates[0];
  assert.deepEqual(row.items,details.items); assert.equal(Object.hasOwn(row,'receipts'),false); assert.equal(Object.hasOwn(row,'sourceTemplateId'),false);
});
test('two stale store instances cannot confirm the same occurrence twice',async()=>{
  const f=await fixture(), key=await f.store.saveTemplate(f.id,f.payload), copy=createStore({mode:'demo',storage:f.memory,user:OWNER});
  const payload={...f.payload,sourceTemplateId:key,sourceDate:DAY};
  const outcomes=await Promise.allSettled([f.store.addExpense(f.id,payload),copy.addExpense(f.id,payload)]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  const s=await copy.loadLedger(f.id); assert.equal(s.expenses.length,1); assert.equal(s.occurrences.length,1);
});

// An in-memory Firestore adapter exercises the actual cloud write assembly and
// joins without authenticating to a service. It rejects reads after a tx write.
function cloudFixture(user=OWNER) {
  const records=new Map(); let lastWrites=[];
  const clone=value=>structuredClone(value);
  function ref(path) { return {id:path.split('/').at(-1),path,collection:name=>collection(`${path}/${name}`),get:async()=>snapshot(path),set:async value=>records.set(path,clone(value))}; }
  function snapshot(path) { return {id:path.split('/').at(-1),exists:records.has(path),data:()=>clone(records.get(path))}; }
  function collection(path,filter) { return {doc:id=>ref(`${path}/${id}`),where:(field,operator,operand)=>collection(path,{field,operator,operand}),get:async()=>({docs:[...records.keys()].filter(key=>key.startsWith(path+'/')&&!key.slice(path.length+1).includes('/')).filter(key=>!filter||(filter.operator==='array-contains'?records.get(key)[filter.field].includes(filter.operand):records.get(key)[filter.field]===filter.operand)).map(snapshot)})}; }
  function writer() { const writes=[]; return {writes,set:(r,value)=>writes.push([r.path,clone(value),false]),update:(r,value)=>writes.push([r.path,clone(value),true]),commit:async()=>{for(const[path,value,merge]of writes)records.set(path,merge?{...records.get(path),...value}:value);lastWrites=writes;}}; }
  const db={collection,batch:writer,runTransaction:async fn=>{const w=writer();const result=await fn({...w,get:async r=>{assert.equal(w.writes.length,0,'Firestore transactions read before writing');return snapshot(r.path);}});await w.commit();return result;}};
  const firestore=()=>db; firestore.FieldValue={serverTimestamp:()=>({serverTimestamp:true})};
  const firebase={firestore,auth:()=>({currentUser:user})};
  return {store:createStore({mode:'cloud',firebase,user}),records,get writes(){return lastWrites;}};
}
test('cloud adapter atomically stores and reloads item details and receipts with the financial record',async()=>{
  const f=cloudFixture(),id=await f.store.createLedger({title:'Cloud assembly',currency:'CNY'}),alice=await f.store.addMember(id,'Alice');
  const details=itemizedShares([{title:'Rent',amountCents:10001,memberIds:['owner',alice]}]);
  const receipt={name:'receipt.pdf',type:'application/pdf',size:5,dataUrl:'data:application/pdf;base64,JVBERi0='};
  const key=await f.store.addExpense(id,{...details,title:'Rent',date:DAY,payerMemberId:'owner',note:'Housing',receipts:[receipt]});
  assert.deepEqual(f.writes.map(([path])=>path.split('/').at(-2)),['expenses','expenseDetails','expenseReceipts']);
  const loaded=await f.store.loadLedger(id),expense=loaded.expenses.find(row=>row.id===key);
  assert.deepEqual(expense.items,details.items); assert.deepEqual(expense.receipts,[receipt]); assert.equal(expense.note,'Housing');
  assert.equal(Object.hasOwn(f.records.get(`ledgers/${id}/expenses/${key}`),'receipts'),false);
});
test('cloud recurrence confirms with one atomic occurrence claim and keeps template details editable',async()=>{
  const f=cloudFixture(),id=await f.store.createLedger({title:'Rent',currency:'CNY'});
  const payload={title:'Rent',date:DAY,amountCents:10001,payerMemberId:'owner',shares:{owner:10001},frequency:'monthly',startDate:DAY,note:'One month',items:[]};
  const templateId=await f.store.saveTemplate(id,payload);
  assert.deepEqual(f.writes.map(([path])=>path.split('/').at(-2)),['templates','templateDetails']);
  await f.store.saveTemplate(id,{...payload,note:'Updated month'},templateId);
  const expenseId=await f.store.addExpense(id,{...payload,sourceTemplateId:templateId,sourceDate:DAY});
  assert.deepEqual(f.writes.map(([path])=>path.split('/').at(-2)),['expenses','expenseDetails','expenseReceipts','occurrences']);
  const s=await f.store.loadLedger(id); assert.equal(s.templates[0].note,'Updated month');assert.equal(s.occurrences[0].expenseId,expenseId);
  await assert.rejects(f.store.addExpense(id,{...payload,sourceTemplateId:templateId,sourceDate:DAY}),/已经处理/);
});
test('saving a percentage template includes the payer remainder so reuse has the complete total',async()=>{
  const f=await fixture(); await f.store.saveTemplate(f.id,{...f.payload,shares:{[f.alice]:3000}});
  const s=await f.store.loadLedger(f.id); assert.deepEqual(s.templates[0].shares,{[f.alice]:3000,owner:7001});
});
