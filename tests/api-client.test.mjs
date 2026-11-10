import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});
const fresh=()=>import(`../public/scripts/api-store.mjs?case=${crypto.randomUUID()}`);
const reply=(status,body)=>({ok:status>=200&&status<300,status,json:async()=>body});

test('batch pending identity survives a tab reload and remains isolated by account, ledger and direction',async()=>{
 const previous=globalThis.sessionStorage,storage=new Map(),calls=[];globalThis.sessionStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
 const uid=crypto.randomUUID(),ledger=crypto.randomUUID(),payload={fromMemberId:'a',toMemberId:'b',amountCents:4000,date:'2026-11-10',note:'Received once',allocations:[{expenseId:'e',amountCents:4000,expectedVersion:2,expectedRemaining:10000}]};
 const store={mode:'api',currentUser:{uid},saveDraftCommand:async(lid,command,args,key)=>{calls.push({lid,command,args,key});if(calls.length===1)throw TypeError('response lost');return 'saved';}};
 try{
  const first=await import(`../public/scripts/payment-submission.mjs?batch=${crypto.randomUUID()}`);
  await assert.rejects(first.paymentSubmission(store,ledger,undefined,'a','recordPaymentBatch','b').submit(payload));
  const fresh=await import(`../public/scripts/payment-submission.mjs?batch=${crypto.randomUUID()}`);
  assert.equal(fresh.paymentSubmission({...store,currentUser:{uid:'other'}},ledger,undefined,'a','recordPaymentBatch','b').pending,null);
  assert.equal(fresh.paymentSubmission(store,'other-ledger',undefined,'a','recordPaymentBatch','b').pending,null);
  assert.equal(fresh.paymentSubmission(store,ledger,undefined,'b','recordPaymentBatch','a').pending,null);
  const pending=fresh.paymentSubmission(store,ledger,undefined,'a','recordPaymentBatch','b');assert.deepEqual(pending.pending.payload,payload);
  await pending.submit({...payload,amountCents:1000});assert.deepEqual(calls[0],calls[1]);assert.equal(storage.size,0);
 }finally{if(previous===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=previous;}
});

test('unknown payment identity survives an expired login or throttled retry',async()=>{
 const {paymentSubmission}=await import('../public/scripts/payment-submission.mjs'),calls=[];
 const statuses=[undefined,401,403,429,408];
 const store={mode:'api',currentUser:{uid:'retry-user'},saveDraftCommand:async(_id,_type,args,key)=>{calls.push({args,key});if(statuses.length){const status=statuses.shift();throw Object.assign(new Error('Unavailable'),{status});}return 'receipt';}};
 const ledger=crypto.randomUUID(),payload={expenseId:'bill',fromMemberId:'debtor',amountCents:5000};
 const submission=paymentSubmission(store,ledger,'bill','debtor');
 for(let i=0;i<5;i++){await assert.rejects(submission.submit({...payload,amountCents:5000+i}));assert.ok(submission.pending);}
 assert.equal(await submission.submit({...payload,amountCents:1}),'receipt');assert.equal(submission.pending,null);
 assert.equal(new Set(calls.map(c=>c.key)).size,1);assert.ok(calls.every(c=>c.args[0].amountCents===5000));
});

test('definitive payment conflict permits a reviewed new request with a different identity',async()=>{
 const {paymentSubmission}=await import('../public/scripts/payment-submission.mjs'),calls=[];
 const store={mode:'api',currentUser:{uid:'retry-user'},saveDraftCommand:async(_id,_type,args,key)=>{calls.push({args,key});if(calls.length===1)throw Object.assign(new Error('Conflict'),{status:409});return 'receipt';}};
 const submission=paymentSubmission(store,crypto.randomUUID(),'bill','debtor');
 await assert.rejects(submission.submit({expenseId:'bill',fromMemberId:'debtor',expectedVersion:1}));assert.equal(submission.pending,null);
 await submission.submit({expenseId:'bill',fromMemberId:'debtor',expectedVersion:2});assert.notEqual(calls[0].key,calls[1].key);assert.equal(calls[1].args[0].expectedVersion,2);
});

test('LAN HTTP supports write keys, draft revisions and expense history without randomUUID',async()=>{
  const {apiRequest}=await fresh();
  const {createDraftStore}=await import('../public/scripts/expense-drafts.mjs');
  const {appendHistory}=await import('../public/scripts/expense-history.mjs');
  const {IDBFactory}=await import('fake-indexeddb');
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto'),native=globalThis.crypto,ids=[];
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues:bytes=>native.getRandomValues(bytes)}});
  try{
    globalThis.fetch=async(_path,options)=>{ids.push(options.headers['Idempotency-Key']);return reply(200,{result:'saved'});};
    assert.equal(await apiRequest('/api/ledgers/lan/commands',{method:'POST',body:{type:'addExpense',args:[]}}),'saved');
    const store=createDraftStore(new IDBFactory()),saved=await store.put({key:'lan',scope:'alice',form:{fields:{title:''}}});
    ids.push(saved.revision);assert.equal((await store.get('lan')).form.fields.title,'');
    const state={members:{lan:{a:{uid:'alice',name:'Alice'}}},expenses:{lan:{e:{history:[]}}}};
    appendHistory(state,'lan','e',{uid:'alice'},'2026-11-06T12:00:00Z',{type:'created'});
    ids.push(state.expenses.lan.e.history[0].id);
    for(const id of ids)assert.match(id,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    assert.equal(new Set(ids).size,ids.length);
  }finally{Object.defineProperty(globalThis,'crypto',descriptor);}
});

for(const failure of ['offline','server-error','lost-response'])test(`${failure}: an explicit retry preserves the financial idempotency key`,async()=>{
  const {apiRequest}=await fresh(),calls=[];
  globalThis.fetch=async(path,options)=>{calls.push({path,options});if(calls.length>1)return reply(200,{result:'saved-once'});if(failure==='offline')throw new TypeError('network');if(failure==='lost-response')return {ok:true,status:200,json:async()=>{throw new SyntaxError('truncated');}};return reply(503,{error:{message:'服务暂时不可用，请稍后重试。'}});};
  const write=()=>apiRequest('/api/ledgers/test/commands',{method:'POST',body:{type:'addExpense',args:[{amountCents:100}]}});
  await assert.rejects(write);assert.equal(calls.length,1,'no automatic financial retry');assert.equal(await write(),'saved-once');
  assert.equal(calls[0].options.headers['Idempotency-Key'],calls[1].options.headers['Idempotency-Key']);assert.equal(calls[1].options.credentials,'same-origin');
});

test('a rejected input can be corrected and a new intended expense receives a new key',async()=>{
  const {apiRequest}=await fresh(),keys=[];globalThis.fetch=async(_path,options)=>{keys.push(options.headers['Idempotency-Key']);return keys.length===1?reply(400,{error:{message:'分摊金额不能超过总额。'}}):reply(200,{result:'new'});};
  const write=()=>apiRequest('/api/ledgers/test/commands',{method:'POST',body:{type:'addExpense',args:[]}});
  await assert.rejects(write,e=>e.status===400);await write();await write();assert.equal(new Set(keys).size,3);
});

test('expired login exposes an actionable error without reporting a successful save',async()=>{
  const {apiRequest}=await fresh();globalThis.fetch=async()=>reply(401,{error:{message:'登录已过期，请重新登录。'}});
  await assert.rejects(()=>apiRequest('/api/ledgers'),e=>e.status===401&&e.message==='登录已过期，请重新登录。');
});

test('two concurrent duplicate calls carry the same key and receipt reads never add one',async()=>{
  const {apiRequest}=await fresh(),headers=[];let release;const gate=new Promise(resolve=>release=resolve);
  globalThis.fetch=async(_path,options)=>{headers.push(options.headers);if(options.method==='POST')await gate;return reply(200,{result:'one'});};
  const options={method:'POST',body:{type:'recordPayment',args:[{amountCents:100}]}};
  const a=apiRequest('/api/ledgers/test/commands',options),b=apiRequest('/api/ledgers/test/commands',options);release();await Promise.all([a,b]);
  assert.equal(headers[0]['Idempotency-Key'],headers[1]['Idempotency-Key']);await apiRequest('/api/ledgers');assert.equal(headers[2]['Idempotency-Key'],undefined);
});
