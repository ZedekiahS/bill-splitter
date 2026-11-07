import {Readable} from 'node:stream';
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {database,migrate} from '../server/database.mjs';
import {buildApp} from '../server/app.mjs';
import {splitShares,memberBalances,settlementText,remainingFor} from '../public/scripts/ledger-core.mjs';
import {itemizedShares,dueOccurrences} from '../public/scripts/expense-features.mjs';
import {unzip} from './zip-helper.mjs';
import {repaymentPlan} from '../public/scripts/settlement-plans.mjs';
import {ledgerExport} from '../public/scripts/ledger-export.mjs';
import {calendarDate} from '../public/scripts/ledger-time.mjs';
import {createApiStore} from '../public/scripts/api-store.mjs';
import {paymentSubmission} from '../public/scripts/payment-submission.mjs';

const target=new URL(process.env.TEST_DATABASE_URL||'http://missing');
if(!['postgres:','postgresql:'].includes(target.protocol)||!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw new Error('Use a disposable loopback PostgreSQL database ending _test.');
const pool=database(target.href),origin='http://127.0.0.1';
let app,base,alice,bob,chen,outsider;
const password='Scenario-only-password-2026!';
async function request(user,method,path,body,key=randomUUID()){
  const response=await fetch(base+path,{method,headers:{origin,'content-type':'application/json','x-bill-splitter':'1','idempotency-key':key,...(user?.cookie?{cookie:user.cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const content=await response.text();let data;try{data=JSON.parse(content);}catch{data=content;}
  return {status:response.status,headers:response.headers,data,result:data&&typeof data==='object'&&Object.hasOwn(data,'result')?data.result:data};
}
async function good(user,method,path,body,key){const r=await request(user,method,path,body,key);assert.equal(r.status,200,JSON.stringify(r.data));return r.result;}
async function register(name){const email=`scenario-${randomUUID()}@example.test`,r=await request(null,'POST','/api/auth/register',{displayName:name,email,password});assert.equal(r.status,200,JSON.stringify(r.data));return {...r.data.user,cookie:r.headers.get('set-cookie').split(';')[0]};}
async function login(user,previous){const r=await request(previous,'POST','/api/auth/login',{email:user.email,password});assert.equal(r.status,200,JSON.stringify(r.data));return {...user,cookie:r.headers.get('set-cookie').split(';')[0]};}
const command=async(user,ledger,type,args,key)=>{
 if(type==='recordPayment'&&args[0].expectedVersion===undefined){const e=(await snapshot(user,ledger)).expenses.find(e=>e.id===args[0].expenseId);args=[{toMemberId:e.payerMemberId,expectedVersion:e.version||1,expectedRemaining:remainingFor(e,args[0].fromMemberId),...args[0]}];}
 return good(user,'POST',`/api/ledgers/${ledger}/commands`,{type,args},key);
};
const snapshot=(user,ledger)=>good(user,'GET',`/api/ledgers/${ledger}`);
const post=(user,ledger,type,args,key)=>request(user,'POST',`/api/ledgers/${ledger}/commands`,{type,args},key);
const expense=(payer,shares,amountCents=12000,extra={})=>({title:'共同开销',date:'2026-10-30',amountCents,payerMemberId:payer,shares,...extra});
async function ledger(owner=alice,currency='CNY'){return good(owner,'POST','/api/ledgers',{title:'三人周末',currency});}
async function invite(id,owner,user,name=user.displayName){const member=await command(owner,id,'addMember',[name]),token=await command(owner,id,'createInvite',[member]);await good(user,'POST',`/api/invites/${token}/commands`,{type:'claim',displayName:name});await good(owner,'POST',`/api/invites/${token}/commands`,{type:'approve',uid:user.uid});return member;}
async function trio(){const id=await ledger(),b=await invite(id,alice,bob),c=await invite(id,alice,chen);return {id,b,c};}
const financial=s=>({ledger:s.ledger,members:s.members,expenses:s.expenses,payments:s.payments,templates:s.templates,occurrences:s.occurrences,participantGroups:s.participantGroups});
async function consistent(f){const views=await Promise.all([alice,bob,chen].map(u=>snapshot(u,f.id)));assert.deepEqual(financial(views[0]),financial(views[1]));assert.deepEqual(financial(views[0]),financial(views[2]));assert.equal(memberBalances(views[0]).reduce((n,m)=>n+m.balanceCents,0),0);return views[0];}
const pdf=()=>{const bytes=Buffer.from('%PDF-1.4\nSynthetic scenario receipt\n%%EOF');return {name:'receipt.pdf',type:'application/pdf',size:bytes.length,dataUrl:`data:application/pdf;base64,${bytes.toString('base64')}`};};

before(async()=>{
  await migrate(pool);
  await pool.query('TRUNCATE bs_requests,bs_receipts,bs_invites,bs_memberships,bs_ledgers,bs_sessions,bs_identities,bs_users,bs_auth_limits');
  app=await buildApp({pool,origins:[origin]});base=await app.listen({host:'127.0.0.1',port:0});
  alice=await register('小周');bob=await register('小林');chen=await register('安安');outsider=await register('小林');
});
after(async()=>{if(app)await app.close();await pool.end();});

test('one transfer settles multiple bills atomically with concurrency checks and whole-transfer reversal',async()=>{
 const f=await trio();
 const first=await command(alice,f.id,'addExpense',[expense('owner',{[f.b]:3000},3000,{date:'2026-11-01'})]);
 const second=await command(alice,f.id,'addExpense',[expense('owner',{[f.b]:6000},6000,{date:'2026-11-02'})]);
 const opposite=await command(bob,f.id,'addExpense',[expense(f.b,{owner:2000},2000)]);
 const s=await consistent(f),payload={fromMemberId:f.b,toMemberId:'owner',amountCents:5001,date:'2026-11-06'};
 payload.allocations=repaymentPlan(s.expenses,payload);
 assert.equal((await post(bob,f.id,'recordPaymentBatch',[payload])).status,403);
 assert.equal((await post(outsider,f.id,'recordPaymentBatch',[payload])).status,403);
 assert.equal((await post(alice,f.id,'recordPaymentBatch',[{...payload,allocations:payload.allocations.slice(1)}])).status,409);
 assert.equal((await snapshot(alice,f.id)).payments.length,0);
 const key=randomUUID(),batch=await command(alice,f.id,'recordPaymentBatch',[payload],key);
 assert.equal(await command(alice,f.id,'recordPaymentBatch',[payload],key),batch);
 const updated=await consistent(f);assert.equal(updated.payments.length,2);
 assert.equal(remainingFor(updated.expenses.find(e=>e.id===first),f.b),0);
 assert.equal(remainingFor(updated.expenses.find(e=>e.id===second),f.b),3999);
 assert.equal(remainingFor(updated.expenses.find(e=>e.id===opposite),'owner'),2000);
 assert.equal((await post(alice,f.id,'recordPaymentBatch',[payload])).status,409);
 assert.equal((await post(alice,f.id,'reversePayment',[updated.payments[0].id])).status,400);
 assert.equal((await post(bob,f.id,'reversePaymentBatch',[batch])).status,403);
 await command(alice,f.id,'reversePaymentBatch',[batch]);
 assert.equal((await post(alice,f.id,'reversePaymentBatch',[batch])).status,400);
 const restored=await consistent(f);assert.equal(restored.payments.length,4);
 assert.equal(remainingFor(restored.expenses.find(e=>e.id===first),f.b),3000);
 assert.equal(remainingFor(restored.expenses.find(e=>e.id===second),f.b),6000);
 assert.equal(restored.expenses.find(e=>e.id===first).history.at(-1).type,'payment-reversed');
 const stale={...payload,amountCents:1000};stale.allocations=repaymentPlan(restored.expenses,stale);
 await command(alice,f.id,'recordPayment',[{expenseId:first,fromMemberId:f.b,amountCents:100}]);
 assert.equal((await post(alice,f.id,'recordPaymentBatch',[stale])).status,409);
});

test('inactive members retain old balances and access but cannot enter new expenses or active templates',async()=>{
 const f=await trio(),bill=await command(alice,f.id,'addExpense',[expense('owner',{[f.b]:500},500)]);
 assert.equal((await post(bob,f.id,'setMemberStatus',[f.c,'inactive'])).status,403);
 await command(alice,f.id,'setMemberStatus',[f.b,'inactive']);
 assert.equal((await snapshot(bob,f.id)).members.find(m=>m.id===f.b).status,'inactive');
 assert.equal((await post(alice,f.id,'addExpense',[expense('owner',{[f.b]:100},100)])).status,400);
 assert.equal((await post(bob,f.id,'addExpense',[expense(f.b,{owner:100},100)])).status,400);
 await command(alice,f.id,'recordPayment',[{expenseId:bill,fromMemberId:f.b,amountCents:100}]);
 const old=(await snapshot(alice,f.id)).expenses[0];await command(alice,f.id,'updateExpense',[bill,{...old,note:'仍可补充',expectedVersion:old.version,changeReason:'补充'}]);
 await command(alice,f.id,'setMemberStatus',[f.b,'active']);
 const tpl=await command(alice,f.id,'saveTemplate',[{...expense('owner',{[f.b]:500},500),frequency:'monthly',startDate:'2026-01-01'}]);
 assert.equal((await post(alice,f.id,'setMemberStatus',[f.b,'inactive'])).status,400);
 await command(alice,f.id,'setTemplateStatus',[tpl,'paused']);await command(alice,f.id,'setMemberStatus',[f.b,'inactive']);
 assert.equal((await post(alice,f.id,'setTemplateStatus',[tpl,'active'])).status,400);
 await consistent(f);
});

test('invites revoke old links, persist request outcomes and cannot bind rejected or expired requests',async()=>{
 const id=await ledger(),m=await command(alice,id,'addMember',['小林']);
 const old=await command(alice,id,'createInvite',[m]),token=await command(alice,id,'createInvite',[m]);
 assert.equal((await request(bob,'GET',`/api/invites/${old}`)).status,400);
 await good(bob,'POST',`/api/invites/${token}/commands`,{type:'claim'});
 assert.equal((await good(bob,'GET',`/api/invites/${token}`)).claimStatus,'pending');
 await command(alice,id,'rejectClaim',[token,bob.uid]);
 assert.equal((await good(bob,'GET',`/api/invites/${token}`)).claimStatus,'rejected');
 assert.equal((await request(alice,'POST',`/api/invites/${token}/commands`,{type:'approve',uid:bob.uid})).status,400);
 await command(alice,id,'revokeInvite',[token]);
 assert.equal((await request(bob,'GET',`/api/invites/${token}`)).status,400);
 const fresh=await command(alice,id,'createInvite',[m]);await good(bob,'POST',`/api/invites/${fresh}/commands`,{type:'claim'});await good(alice,'POST',`/api/invites/${fresh}/commands`,{type:'approve',uid:bob.uid});
 assert.equal((await good(bob,'GET',`/api/invites/${fresh}`)).alreadyMember,true);
});

test('ledger timezone is validated, shared and used for recurrence dates without changing saved dates',async()=>{
 assert.equal(calendarDate('America/New_York',new Date('2026-11-06T02:00:00Z')),'2026-11-05');
 assert.equal(calendarDate('Asia/Shanghai',new Date('2026-11-06T02:00:00Z')),'2026-11-06');
 const f=await trio(),bill=await command(alice,f.id,'addExpense',[expense('owner',{[f.b]:100},100)]);
 assert.equal((await post(bob,f.id,'setLedgerTimeZone',['UTC'])).status,403);
 assert.equal((await post(alice,f.id,'setLedgerTimeZone',['not/a/zone'])).status,400);
 await command(alice,f.id,'setLedgerTimeZone',['America/New_York']);
 const s=await consistent(f);assert.equal(s.ledger.timeZone,'America/New_York');assert.equal(s.expenses.find(e=>e.id===bill).date,'2026-10-30');
});

test('backup round trip restores private attachments, payment batches, history and balances into an independent ledger',async()=>{
 const f=await trio(),file=pdf();
 const first=await command(alice,f.id,'addExpense',[expense('owner',{[f.b]:3000},3000,{receipts:[file]})]);
 await command(alice,f.id,'addExpense',[expense('owner',{[f.b]:4000},4000)]);
 let s=await snapshot(alice,f.id),old=s.expenses.find(e=>e.id===first);
 await command(alice,f.id,'updateExpense',[first,{...old,receipts:[],expectedVersion:old.version,changeReason:'保留历史收据',note:'更正后的备注'}]);
 s=await snapshot(alice,f.id);const payload={fromMemberId:f.b,toMemberId:'owner',amountCents:5000,date:'2026-11-06'};payload.allocations=repaymentPlan(s.expenses,payload);
 await command(alice,f.id,'recordPaymentBatch',[payload]);
 s=await snapshot(alice,f.id);
 const response=await fetch(base+`/api/ledgers/${f.id}/export`,{headers:{cookie:alice.cookie}});assert.equal(response.status,200);
 const content=Buffer.from(await response.arrayBuffer()).toString('base64'),body={format:'zip',content};
 const preview=await good(bob,'POST','/api/ledger-import/preview',body);assert.equal(preview.attachmentCount,1);assert.equal(preview.expenseCount,2);
 const key=randomUUID(),importBody={...body,memberId:f.b,title:'恢复的账本'};
 const imported=await good(bob,'POST','/api/ledger-import',importBody,key);assert.equal(await good(bob,'POST','/api/ledger-import',importBody,key),imported);
 const restored=await snapshot(bob,imported);assert.equal(restored.ledger.ownerUid,bob.uid);assert.deepEqual(restored.ledger.memberUids,[bob.uid]);
 assert.equal((await request(alice,'GET',`/api/ledgers/${imported}`)).status,403);
 const balances=s=>Object.fromEntries(memberBalances(s).map(m=>[m.name,m.balanceCents]));assert.deepEqual(balances(restored),balances(s));
 const historical=restored.expenses.flatMap(e=>e.history.flatMap(h=>h.after?.receipts||[]))[0];assert.ok(historical.url.startsWith(`/api/ledgers/${imported}/`));
 const receipt=await fetch(base+historical.url,{headers:{cookie:bob.cookie}});assert.equal(receipt.status,200);assert.equal((await receipt.arrayBuffer()).byteLength,file.size);
 await command(bob,imported,'reversePaymentBatch',[restored.payments[0].batchId]);
 assert.equal((await snapshot(bob,imported)).payments.length,4);
 assert.equal((await snapshot(alice,f.id)).payments.length,2);
 const json=ledgerExport(s).tables['ledger.json'];assert.equal((await request(bob,'POST','/api/ledger-import/preview',{format:'json',content:json})).status,400);
 const plain=await ledger(),plainSnapshot=await snapshot(alice,plain),plainData=ledgerExport(plainSnapshot).data;
 assert.equal((await request(bob,'POST','/api/ledger-import',{format:'json',content:JSON.stringify(plainData),memberId:'missing'})).status,400);
 const jsonId=await good(bob,'POST','/api/ledger-import',{format:'json',content:JSON.stringify(plainData),memberId:'owner'});assert.equal((await snapshot(bob,jsonId)).expenses.length,0);
 const tampered=ledgerExport({...s,expenses:s.expenses.map(e=>({...e,receipts:[],history:[]}))}).data;tampered.expenses[0].repaid[f.b]=1;
 assert.equal((await request(bob,'POST','/api/ledger-import',{format:'json',content:JSON.stringify(tampered),memberId:f.b})).status,400);
 assert.equal((await request(bob,'POST','/api/ledger-import/preview',{format:'zip',content:'AAAA'})).status,400);
});

test('recovery code requires the current password, rotates, is single use and revokes every session',async()=>{
 const user=await register('恢复账号'),second=await login(user);
 assert.equal((await request(null,'POST','/api/auth/recovery-code',{password})).status,401);
 assert.equal((await request(user,'POST','/api/auth/recovery-code',{password:'incorrect-password'})).status,401);
 const first=await good(user,'POST','/api/auth/recovery-code',{password}),next=await good(user,'POST','/api/auth/recovery-code',{password});
 assert.notEqual(first.code,next.code);
 const body={email:user.email,password:'New-synthetic-password-2026!',code:first.code};
 assert.equal((await request(null,'POST','/api/auth/recover',body)).status,401);
 await good(null,'POST','/api/auth/recover',{...body,code:next.code});
 assert.equal((await request(null,'POST','/api/auth/recover',{...body,code:next.code})).status,401);
 assert.equal((await good(user,'GET','/api/auth/me')).user,null);assert.equal((await good(second,'GET','/api/auth/me')).user,null);
 assert.equal((await request(null,'POST','/api/auth/login',{email:user.email,password})).status,401);
 assert.equal((await request(null,'POST','/api/auth/login',{email:user.email,password:body.password})).status,200);
});

test('three people coordinate invitations, record expenses, settle and correct a mistaken repayment',async()=>{
  const f=await trio();
  const dinner=await command(alice,f.id,'addExpense',[expense('owner',{owner:4000,[f.b]:4000,[f.c]:4000})]);
  const ride=await command(bob,f.id,'addExpense',[expense(f.b,{owner:1000,[f.b]:1000,[f.c]:1000},3000,{title:'返程车费'})]);
  let s=await consistent(f);assert.equal(s.expenses.length,2);
  assert.deepEqual(Object.fromEntries(memberBalances(s).map(m=>[m.memberId,m.balanceCents])),{owner:7000,[f.b]:-2000,[f.c]:-5000});
  assert.match(settlementText(s),/小林 → 小周：¥40.00/);assert.match(settlementText(s,'en'),/小周 → 小林: ¥10.00/);
  // "I sent 15" is only a conversation; the debtor cannot mark it received.
  assert.equal((await post(bob,f.id,'recordPayment',[{expenseId:dinner,fromMemberId:f.b,amountCents:1500}])).status,403);
  const partial=await command(alice,f.id,'recordPayment',[{expenseId:dinner,fromMemberId:f.b,amountCents:1500,note:'先还一部分'}]);
  s=await consistent(f);assert.equal(remainingFor(s.expenses.find(e=>e.id===dinner),f.b),2500);
  assert.equal((await post(alice,f.id,'reverseExpense',[dinner])).status,400);
  await command(alice,f.id,'reversePayment',[partial]);
  assert.equal((await post(alice,f.id,'reversePayment',[partial])).status,400);
  await command(alice,f.id,'recordPayment',[{expenseId:dinner,fromMemberId:f.b,amountCents:4000}]);
  await command(alice,f.id,'recordPayment',[{expenseId:dinner,fromMemberId:f.c,amountCents:4000}]);
  await command(bob,f.id,'recordPayment',[{expenseId:ride,fromMemberId:'owner',amountCents:1000}]);
  await command(bob,f.id,'recordPayment',[{expenseId:ride,fromMemberId:f.c,amountCents:1000}]);
  s=await consistent(f);assert.ok(memberBalances(s).every(m=>m.balanceCents===0));assert.match(settlementText(s),/当前记录没有待确认的还款/);assert.equal(s.payments.length,6);
});

test('equal, percentage, exact amount and item splits preserve cents for all viewers',async()=>{
  const f=await trio(),ids=['owner',f.b,f.c];
  const cases=[
    [1,splitShares(1,ids),{owner:1,[f.b]:0,[f.c]:0}],
    [10001,splitShares(10001,ids,{type:'percent',percentages:{owner:'20', [f.b]:'30',[f.c]:'50'}}),{owner:2000,[f.b]:3000,[f.c]:5001}],
    [10000,splitShares(10000,[f.b],{type:'percent',percentages:{[f.b]:'25'}}),{[f.b]:2500}],
    [45000,splitShares(45000,ids,{type:'amount',amounts:{owner:'200',[f.b]:'250',[f.c]:'0'}}),{owner:20000,[f.b]:25000,[f.c]:0}],
  ];
  for(const [amount,shares,expected]of cases){const id=await command(alice,f.id,'addExpense',[expense('owner',shares,amount)]);const s=await consistent(f);assert.deepEqual(s.expenses.find(e=>e.id===id).shares,expected);}
  const items=[{title:'合住房',amountCents:30000,memberIds:ids},{title:'早餐',amountCents:2000,memberIds:[f.b,f.c]}],details=itemizedShares(items);
  const id=await command(chen,f.id,'addExpense',[expense(f.c,details.shares,details.amountCents,{items})]);
  const s=await consistent(f),row=s.expenses.find(e=>e.id===id);assert.deepEqual(row.shares,{owner:10000,[f.b]:11000,[f.c]:11000});assert.deepEqual(row.items,items);
});

test('simultaneous expense additions from three accounts all survive without lost updates',async()=>{
  const f=await trio(),shares={owner:100,[f.b]:100,[f.c]:100};
  const writes=await Promise.all([alice,bob,chen].flatMap((u,index)=>Array.from({length:4},(_,n)=>command(u,f.id,'addExpense',[expense(['owner',f.b,f.c][index],shares,300,{title:`${index}-${n}`})]))));
  const s=await consistent(f);assert.equal(s.expenses.length,12);assert.equal(new Set(writes).size,12);assert.equal(s.expenses.reduce((n,e)=>n+e.amountCents,0),3600);
});

test('owner and recipient racing to confirm the same full repayment cannot overpay',async()=>{
  const f=await trio(),id=await command(bob,f.id,'addExpense',[expense(f.b,{owner:5000,[f.c]:5000},10000)]);
  const args=[{expenseId:id,fromMemberId:f.c,toMemberId:f.b,expectedVersion:1,expectedRemaining:5000,amountCents:5000}];
  const results=await Promise.all([post(alice,f.id,'recordPayment',args),post(bob,f.id,'recordPayment',args)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  let s=await consistent(f);assert.equal(s.payments.length,1);assert.equal(s.expenses[0].repaid[f.c],5000);
  const reversals=await Promise.all([post(alice,f.id,'reversePayment',[s.payments[0].id]),post(bob,f.id,'reversePayment',[s.payments[0].id])]);
  assert.deepEqual(reversals.map(r=>r.status).sort(),[200,400]);s=await consistent(f);assert.equal(s.payments.length,2);assert.equal(s.expenses[0].repaid[f.c],0);
});

test('two browser sessions of the same account replay a committed request only once',async()=>{
  const id=await ledger(),second=await login(alice),key=randomUUID(),args=[expense('owner',{owner:100},100)];
  const a=await post(alice,id,'addExpense',args,key),b=await post(second,id,'addExpense',args,key);assert.equal(a.status,200);assert.deepEqual(a.data,b.data);assert.equal((await snapshot(alice,id)).expenses.length,1);
  await good(second,'POST','/api/auth/logout',{});assert.equal((await request(second,'GET',`/api/ledgers/${id}`)).status,401);assert.equal((await request(alice,'GET',`/api/ledgers/${id}`)).status,200);
});

test('simultaneous same-name claims and approvals bind one identity and preserve pre-claim expenses',async()=>{
  const id=await ledger(),member=await command(alice,id,'addMember',['小林']),token=await command(alice,id,'createInvite',[member]);
  await command(alice,id,'addExpense',[expense('owner',{[member]:10000},10000)]);
  for(const user of[bob,outsider]){await good(user,'POST',`/api/invites/${token}/commands`,{type:'claim',displayName:'小林'});assert.equal((await request(user,'GET',`/api/ledgers/${id}`)).status,403);}
  const before=await snapshot(alice,id);assert.equal(before.claims.length,2);
  const results=await Promise.all([bob,outsider].map(user=>request(alice,'POST',`/api/invites/${token}/commands`,{type:'approve',uid:user.uid})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
  const winner=results[0].status===200?bob:outsider,loser=winner===bob?outsider:bob;
  const s=await snapshot(winner,id);assert.equal(s.members.find(m=>m.id===member).uid,winner.uid);assert.deepEqual(s.expenses,before.expenses);assert.equal(s.claims.length,0);assert.equal(s.invites.length,0);
  assert.equal((await request(loser,'GET',`/api/ledgers/${id}`)).status,403);
  assert.equal((await request(loser,'GET',`/api/invites/${token}`)).status,403);
});

test('expired invitations reject preview, claim and approval without granting membership',async()=>{
  const id=await ledger(),member=await command(alice,id,'addMember',['迟到的伙伴']),token=await command(alice,id,'createInvite',[member]);
  await good(bob,'POST',`/api/invites/${token}/commands`,{type:'claim'});
  await pool.query("UPDATE bs_ledgers SET body=jsonb_set(body,ARRAY['invites',$2,'expiresAt'],to_jsonb('2000-01-01T00:00:00.000Z'::text)) WHERE id=$1",[id,token]);
  assert.equal((await request(bob,'GET',`/api/invites/${token}`)).status,400);
  assert.equal((await request(chen,'POST',`/api/invites/${token}/commands`,{type:'claim'})).status,400);
  assert.equal((await request(alice,'POST',`/api/invites/${token}/commands`,{type:'approve',uid:bob.uid})).status,400);
  assert.equal((await snapshot(alice,id)).members.find(m=>m.id===member).uid,null);
});

test('roles and currency stay scoped to each ledger, including receipt identifiers',async()=>{
  const f=await trio(),other=await ledger(bob,'USD');
  await command(alice,f.id,'addExpense',[expense('owner',{owner:100,[f.b]:100,[f.c]:100},300,{receipts:[pdf()]})]);
  const receipt=(await snapshot(bob,f.id)).expenses[0].receipts[0];
  assert.equal((await request(alice,'GET',`/api/ledgers/${other}`)).status,403);
  assert.equal((await post(bob,f.id,'createInvite',[f.b])).status,403);
  await command(bob,other,'addMember',['美元账本伙伴']);
  assert.equal((await request(bob,'GET',receipt.url.replace(f.id,other))).status,403);
  assert.equal((await request(outsider,'GET',receipt.url)).status,403);
  assert.equal((await request(null,'GET',receipt.url)).status,401);
  assert.equal((await snapshot(alice,f.id)).ledger.currency,'CNY');assert.equal((await snapshot(bob,other)).ledger.currency,'USD');assert.equal((await snapshot(bob,other)).expenses.length,0);
});

test('all member mutation commands reject an unrelated account and leave the ledger unchanged',async()=>{
  const f=await trio(),id=await command(alice,f.id,'addExpense',[expense('owner',{[f.b]:100},100)]),before=await snapshot(alice,f.id);
  const commands={addMember:['外人'],addExpense:[expense('owner',{owner:100},100)],saveTemplate:[{}],setTemplateStatus:[randomUUID(),'archived'],skipOccurrence:[randomUUID(),'2026-01-01'],recordPayment:[{expenseId:id,fromMemberId:f.b,amountCents:100}],reversePayment:[randomUUID()],reverseExpense:[id],createInvite:[f.b]};
  for(const[type,args]of Object.entries(commands))assert.equal((await post(outsider,f.id,type,args)).status,403,type);
  assert.deepEqual(await snapshot(alice,f.id),before);
});

test('invalid amounts, dates, members, notes and receipt bytes roll back the entire write',async()=>{
  const f=await trio(),valid=expense('owner',{owner:100},100),before=await snapshot(alice,f.id);
  const invalid=[{amountCents:0},{amountCents:-1},{amountCents:1.5},{amountCents:Number.MAX_SAFE_INTEGER+1},{amountCents:'100'}, {shares:{owner:-1}},{shares:{owner:101}},{shares:{}},{shares:{[randomUUID()]:100}}, {payerMemberId:randomUUID()},{date:'2026-02-30'},{title:' '},{title:'x'.repeat(121)},{note:'x'.repeat(1001)},{items:[{title:'wrong',amountCents:101,memberIds:['owner']}]},{receipts:[pdf(),pdf(),pdf(),pdf()]},{receipts:[{...pdf(),size:2097153}]},{receipts:[{...pdf(),dataUrl:'data:application/pdf;base64,eA==',size:1}]},{sourceTemplateId:randomUUID()}];
  for(const change of invalid){const r=await post(alice,f.id,'addExpense',[{...valid,...change}]);assert.equal(r.status,400,JSON.stringify(change));}
  assert.deepEqual(await snapshot(alice,f.id),before);
  assert.equal(Number((await pool.query('SELECT count(*) FROM bs_receipts WHERE ledger_id=$1',[f.id])).rows[0].count),0);
});

test('receipt count and exact size boundaries work, and three users see private metadata',async()=>{
  const f=await trio(),bytes=Buffer.alloc(2097152,32);bytes.write('%PDF-1.4');const file={name:'边界收据.pdf',type:'application/pdf',size:bytes.length,dataUrl:`data:application/pdf;base64,${bytes.toString('base64')}`};
  await command(alice,f.id,'addExpense',[expense('owner',{owner:100},100,{note:'凭据',receipts:[file,pdf(),pdf()]})]);
  const s=await consistent(f);assert.equal(s.expenses[0].receipts.length,3);const saved=s.expenses[0].receipts[0];assert.equal(saved.dataUrl,undefined);
  const response=await fetch(base+saved.url,{headers:{cookie:chen.cookie}});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);assert.equal(response.headers.get('cache-control'),'no-store');
});

test('large groups support fifty participants while preserving per-item limits',async()=>{
  const id=await ledger(),members=['owner'];for(let i=0;i<50;i++)members.push(await command(alice,id,'addMember',[`成员${i}`]));
  const shares=Object.fromEntries(members.map(m=>[m,100]));assert.equal((await post(alice,id,'addExpense',[expense('owner',shares,5100)])).status,400);
  await command(alice,id,'addExpense',[expense('owner',splitShares(10001,members.slice(0,50)),10001)]);
  const eight=members.slice(0,8),items=eight.map((m,i)=>({title:`项目${i}`,amountCents:100,memberIds:[m]})),details=itemizedShares(items);
  await command(alice,id,'addExpense',[expense('owner',details.shares,details.amountCents,{items})]);
  assert.equal((await post(alice,id,'addExpense',[expense('owner',details.shares,900,{items:[...items,items[0]]})])).status,400);
  const s=await snapshot(alice,id);assert.equal(s.members.length,51);assert.equal(s.expenses.length,2);
});

test('template edit, pause, resume, archive and restore obey creator permissions and keep history',async()=>{
  const f=await trio(),data=expense(f.b,{owner:200,[f.b]:100},300,{frequency:'monthly',startDate:'2026-10-01',note:'租金'}),id=await command(bob,f.id,'saveTemplate',[data]);
  const before=await consistent(f);assert.equal(before.expenses.length,0);
  assert.equal((await post(chen,f.id,'saveTemplate',[data,id])).status,403);
  assert.equal((await post(chen,f.id,'setTemplateStatus',[id,'paused'])).status,403);
  assert.equal((await post(chen,f.id,'skipOccurrence',[id,'2026-10-01'])).status,403);
  await command(bob,f.id,'saveTemplate',[{...data,title:'更新租金'},id]);
  for(const status of['paused','active','archived','active']){await command(bob,f.id,'setTemplateStatus',[id,status]);const s=await consistent(f);assert.equal(s.templates[0].status,status);assert.equal(s.expenses.length,0);if(status!=='active')assert.equal(dueOccurrences(s.templates,s.occurrences,'2026-10-30').length,0);}
  assert.equal((await snapshot(alice,f.id)).templates[0].title,'更新租金');
});

test('weekly/monthly/yearly schedules persist, and skipped/posted periods cannot be consumed again',async()=>{
  const f=await trio();
  for(const frequency of['none','weekly','monthly','yearly']){
    const data=expense(f.b,{owner:100,[f.b]:100},200,{frequency,startDate:frequency==='none'?null:'2026-01-31'}),id=await command(bob,f.id,'saveTemplate',[data]);
    if(frequency==='none')continue;
    await command(bob,f.id,'skipOccurrence',[id,'2026-01-31']);
    const next=frequency==='weekly'?'2026-02-07':frequency==='monthly'?'2026-02-28':'2027-01-31';
    const duplicate=await post(alice,f.id,'addExpense',[{...data,sourceTemplateId:id,sourceDate:'2026-01-31'}]);assert.equal(duplicate.status,400);
    if(frequency==='yearly'){const future=`${Math.max(2027,new Date().getUTCFullYear()+1)}-01-31`;assert.equal((await post(bob,f.id,'skipOccurrence',[id,future])).status,400);continue;}
    const saved=await command(bob,f.id,'addExpense',[{...data,date:next,sourceTemplateId:id,sourceDate:next}]);
    await command(bob,f.id,'reverseExpense',[saved]);
    assert.equal((await post(alice,f.id,'addExpense',[{...data,date:next,sourceTemplateId:id,sourceDate:next}])).status,400);
  }
  const s=await consistent(f);assert.equal(s.templates.length,4);assert.equal(s.occurrences.length,5);assert.ok(s.expenses.every(e=>e.status==='reversed'));
});

test('skip versus post races produce exactly one occurrence and at most one expense',async()=>{
  const f=await trio(),data=expense(f.b,{owner:100,[f.b]:100},200,{frequency:'weekly',startDate:'2026-01-01'}),id=await command(bob,f.id,'saveTemplate',[data]);
  const results=await Promise.all([post(bob,f.id,'skipOccurrence',[id,'2026-01-01']),post(alice,f.id,'addExpense',[{...data,sourceTemplateId:id,sourceDate:'2026-01-01'}])]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);const s=await consistent(f);assert.equal(s.occurrences.length,1);assert.equal(s.expenses.length,s.occurrences[0].status==='posted'?1:0);
});

test('account switching revokes the previous cookie without mixing another account data',async()=>{
  const id=await ledger(),a=await login(alice),b=await login(bob,a);
  assert.equal((await request(a,'GET',`/api/ledgers/${id}`)).status,401);
  assert.equal((await request(b,'GET',`/api/ledgers/${id}`)).status,403);
  assert.equal((await good(b,'GET','/api/auth/me')).user.uid,bob.uid);
  await good(b,'POST','/api/auth/logout',{});
  assert.equal((await good(b,'GET','/api/auth/me')).user,null);
});

test('update revisions expose only joined ledgers and advance atomically for every committed change',async()=>{
  const f=await trio(),read=user=>good(user,'GET','/api/ledger-updates');
  const version=async()=>{const rows=await read(alice);return BigInt(rows.find(row=>row.id===f.id).revision);};
  assert.equal((await request(null,'GET','/api/ledger-updates')).status,401);
  assert.equal((await read(outsider)).some(row=>row.id===f.id),false);
  const initial=await version(),key=randomUUID(),args=[expense('owner',{[f.b]:100},100)];
  const id=await command(alice,f.id,'addExpense',args,key);assert.equal(await version(),initial+1n);
  await command(alice,f.id,'addExpense',args,key);assert.equal(await version(),initial+1n);
  await post(bob,f.id,'createInvite',[f.b]);assert.equal(await version(),initial+1n);
  const payment=await command(alice,f.id,'recordPayment',[{expenseId:id,fromMemberId:f.b,amountCents:40}]);assert.equal(await version(),initial+2n);
  await command(alice,f.id,'reversePayment',[payment]);assert.equal(await version(),initial+3n);
  await command(alice,f.id,'reverseExpense',[id]);assert.equal(await version(),initial+4n);
  const member=await command(alice,f.id,'addMember',['new']),token=await command(alice,f.id,'createInvite',[member]);
  await good(outsider,'POST',`/api/invites/${token}/commands`,{type:'claim'});assert.equal(await version(),initial+7n);
  assert.equal((await read(outsider)).some(row=>row.id===f.id),false);
  await good(alice,'POST',`/api/invites/${token}/commands`,{type:'approve',uid:outsider.uid});
  const joined=(await read(outsider)).find(row=>row.id===f.id);assert.deepEqual(Object.keys(joined).sort(),['id','revision']);assert.equal(BigInt(joined.revision),initial+8n);
});

test('expense corrections preserve the original and update balances, actor, reason and version',async()=>{
  const f=await trio(),original=expense(f.b,{owner:4000,[f.b]:4000,[f.c]:4000},12000,{note:'original',receipts:[pdf()]});
  const id=await command(bob,f.id,'addExpense',[original]);let row=(await snapshot(alice,f.id)).expenses[0];
  const file=row.receipts[0],key=randomUUID(),update={...original,amountCents:15000,shares:{owner:5000,[f.b]:5000,[f.c]:5000},title:'住宿更正',note:'corrected',receipts:[{id:file.id}],expectedVersion:row.version,changeReason:'房价有调整',history:[{actorUid:outsider.uid}],createdByUid:outsider.uid};
  const response=await command(bob,f.id,'updateExpense',[id,update],key);await command(bob,f.id,'updateExpense',[id,update],key);assert.equal(response,id);
  row=(await consistent(f)).expenses[0];assert.equal(row.version,2);assert.equal(row.history.length,2);assert.equal(row.createdByUid,bob.uid);assert.equal(row.history[1].actorUid,bob.uid);assert.equal(row.history[1].actorName,'小林');assert.equal(row.history[1].reason,'房价有调整');
  assert.equal(row.history[0].after.amountCents,12000);assert.equal(row.history[1].before.amountCents,12000);assert.equal(row.history[1].after.amountCents,15000);assert.equal(row.history[1].before.receipts[0].url,file.url);assert.equal(row.receipts[0].dataUrl,undefined);
  assert.equal(Number((await pool.query('SELECT count(*) FROM bs_receipts WHERE expense_id=$1',[id])).rows[0].count),1);
});

test('paid expenses allow attachments and notes but reject financial changes until repayments reverse',async()=>{
  const f=await trio(),original=expense(f.b,{owner:5000,[f.b]:5000},10000);
  const id=await command(bob,f.id,'addExpense',[original]),payment=await command(bob,f.id,'recordPayment',[{expenseId:id,fromMemberId:'owner',amountCents:2000}]);
  let row=(await snapshot(bob,f.id)).expenses[0];
  await command(bob,f.id,'updateExpense',[id,{...original,receipts:[pdf()],note:'补充凭据',expectedVersion:row.version,changeReason:'补充付款截图'}]);
  row=(await consistent(f)).expenses[0];assert.equal(row.repaid.owner,2000);assert.equal(remainingFor(row,'owner'),3000);
  const bad={...original,amountCents:12000,shares:{owner:6000,[f.b]:6000},expectedVersion:row.version,changeReason:'金额更正',receipts:row.receipts.map(file=>({id:file.id}))};
  assert.equal((await post(bob,f.id,'updateExpense',[id,bad])).status,400);assert.equal((await snapshot(bob,f.id)).expenses[0].version,row.version);
  await command(bob,f.id,'reversePayment',[payment]);row=(await snapshot(bob,f.id)).expenses[0];
  await command(bob,f.id,'updateExpense',[id,{...bad,expectedVersion:row.version}]);row=(await consistent(f)).expenses[0];
  assert.equal(row.amountCents,12000);assert.deepEqual(row.history.map(event=>event.type),['created','payment','updated','payment-reversed','updated']);
});

test('simultaneous owner and payer corrections reject the stale version instead of overwriting',async()=>{
  const f=await trio(),original=expense(f.b,{owner:100,[f.b]:100},200),id=await command(bob,f.id,'addExpense',[original]);
  const body={...original,expectedVersion:1,changeReason:'补充说明'};
  const results=await Promise.all([post(alice,f.id,'updateExpense',[id,{...body,note:'owner edit'}]),post(bob,f.id,'updateExpense',[id,{...body,note:'payer edit'}])]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const row=(await consistent(f)).expenses[0];assert.equal(row.history.length,2);assert.equal(row.version,2);assert.equal(row.note,results[0].status===200?'owner edit':'payer edit');
});

test('other members, outsiders, forged receipt references and no-op updates leave history unchanged',async()=>{
  const f=await trio(),original=expense(f.b,{owner:100,[f.b]:100},200),id=await command(bob,f.id,'addExpense',[original]);
  const other=await command(alice,f.id,'addExpense',[expense('owner',{owner:100},100,{receipts:[pdf()]})]);
  const before=await snapshot(bob,f.id),receipt=before.expenses.find(row=>row.id===other).receipts[0],body={...original,expectedVersion:1,changeReason:'更正',note:'new'};
  for(const user of[chen,outsider])assert.equal((await post(user,f.id,'updateExpense',[id,body])).status,403);
  for(const change of[{receipts:[{id:receipt.id}]},{receipts:[{id:randomUUID()}]},{amountCents:0},{expectedVersion:0},{changeReason:''},{note:''}])assert.equal((await post(bob,f.id,'updateExpense',[id,{...body,...change}])).status,400);
  assert.deepEqual(await snapshot(bob,f.id),before);
});

test('removed receipts remain readable only to members through immutable history snapshots',async()=>{
  const f=await trio(),original=expense('owner',{owner:100,[f.b]:100},200,{receipts:[pdf()]}),id=await command(alice,f.id,'addExpense',[original]);
  let row=(await snapshot(alice,f.id)).expenses[0];const first=row.receipts[0];
  await command(alice,f.id,'updateExpense',[id,{...original,receipts:[],expectedVersion:1,changeReason:'替换附件'}]);
  row=(await consistent(f)).expenses[0];assert.equal(row.receipts.length,0);assert.equal(row.history[1].before.receipts[0].url,first.url);assert.equal(row.history[1].after.receipts.length,0);
  assert.equal((await request(bob,'GET',first.url)).status,200);assert.equal((await request(outsider,'GET',first.url)).status,403);
  await command(alice,f.id,'updateExpense',[id,{...original,receipts:[{id:first.id}],expectedVersion:2,changeReason:'核对草稿后保留原收据'}]);
  row=(await consistent(f)).expenses[0];assert.equal(row.receipts[0].id,first.id);assert.equal(row.history[1].after.receipts.length,0);assert.equal(row.history[2].after.receipts[0].id,first.id);
  await command(alice,f.id,'reverseExpense',[id]);row=(await snapshot(alice,f.id)).expenses[0];assert.equal(row.history.at(-1).type,'reversed');assert.equal(row.history.at(-1).actorUid,alice.uid);
  assert.equal((await post(alice,f.id,'updateExpense',[id,{...original,expectedVersion:row.version,changeReason:'改已撤销账单'}])).status,400);
});

test('legacy expenses gain honest history without inventing a missing reversal actor',async()=>{
  const f=await trio(),id=await command(alice,f.id,'addExpense',[expense('owner',{owner:100},100)]);
  await command(alice,f.id,'reverseExpense',[id]);
  await pool.query("UPDATE bs_ledgers SET body=body #- ARRAY['expenses',$1::text,$2,'history'] #- ARRAY['expenses',$1::text,$2,'version'] WHERE id=$1::uuid",[f.id,id]);
  const row=(await snapshot(alice,f.id)).expenses[0];assert.deepEqual(row.history.map(event=>event.type),['created','reversed']);assert.equal(row.history.at(-1).actorUid,null);assert.equal(row.history.at(-1).actorName,null);
});

test('item corrections and payer reassignment preserve history and transfer editing permission',async()=>{
  const f=await trio(),items=[{title:'住宿',amountCents:30000,memberIds:['owner',f.b,f.c]},{title:'早餐',amountCents:2000,memberIds:[f.b,f.c]}];
  const original=expense(f.b,itemizedShares(items).shares,32000,{items}),id=await command(bob,f.id,'addExpense',[original]);
  const correctedItems=[items[0],{...items[1],amountCents:1000,memberIds:[f.c]}],details=itemizedShares(correctedItems);
  const corrected={...original,...details,expectedVersion:1,changeReason:'早餐仅安安消费'};
  await command(bob,f.id,'updateExpense',[id,corrected]);
  let row=(await consistent(f)).expenses[0];assert.deepEqual(row.shares,{owner:10000,[f.b]:10000,[f.c]:11000});assert.deepEqual(row.history[1].before.items,items);assert.deepEqual(row.history[1].after.items,correctedItems);
  const reassigned={...corrected,payerMemberId:f.c,expectedVersion:row.version,changeReason:'更正实际垫付人'};
  await command(alice,f.id,'updateExpense',[id,reassigned]);row=(await consistent(f)).expenses[0];
  const supplement={...reassigned,note:'补充早餐明细',expectedVersion:row.version,changeReason:'补充说明'};
  assert.equal((await post(bob,f.id,'updateExpense',[id,supplement])).status,403);
  await command(chen,f.id,'updateExpense',[id,supplement]);
  await command(chen,f.id,'recordPayment',[{expenseId:id,fromMemberId:'owner',amountCents:1000}]);row=(await snapshot(chen,f.id)).expenses[0];
  assert.equal((await post(chen,f.id,'updateExpense',[id,{...original,payerMemberId:f.c,expectedVersion:row.version,changeReason:'改变已收款明细'}])).status,400);
  assert.equal((await post(alice,f.id,'updateExpense',[id,{...supplement,payerMemberId:f.b,expectedVersion:row.version}])).status,400);
  assert.equal((await consistent(f)).expenses[0].createdByUid,bob.uid);
});

test('archived ledgers remain readable but every financial and membership mutation is blocked',async()=>{
  const f=await trio(),original=expense('owner',{owner:5000,[f.b]:5000},10000),e=await command(alice,f.id,'addExpense',[original]);
  const payment=await command(alice,f.id,'recordPayment',[{expenseId:e,fromMemberId:f.b,amountCents:1000}]);
  const template=await command(alice,f.id,'saveTemplate',[{...original,frequency:'weekly',startDate:'2026-10-01'}]);
  const member=await command(alice,f.id,'addMember',['待加入']),token=await command(alice,f.id,'createInvite',[member]);
  await good(outsider,'POST',`/api/invites/${token}/commands`,{type:'claim'});
  const before=await snapshot(alice,f.id);
  assert.equal((await post(bob,f.id,'setLedgerStatus',['archived'])).status,403);
  await command(alice,f.id,'setLedgerStatus',['archived']);
  const calls=[['addMember',['禁止']],['addExpense',[original]],['updateExpense',[e,{...original,note:'不可改',expectedVersion:2,changeReason:'试改'}]],['recordPayment',[{expenseId:e,fromMemberId:f.b,amountCents:100}]],['reversePayment',[payment]],['reverseExpense',[e]],['saveTemplate',[{...original,frequency:'none'}]],['setTemplateStatus',[template,'paused']],['skipOccurrence',[template,'2026-10-01']],['createInvite',[member]]];
  for(const [type,args] of calls){const r=await post(alice,f.id,type,args);assert.equal(r.status,400,type);assert.match(r.data.error.message,/已归档/,type);}
  for(const body of [{type:'claim'},{type:'approve',uid:outsider.uid}]){
    const r=await request(body.type==='claim'?outsider:alice,'POST',`/api/invites/${token}/commands`,body);assert.equal(r.status,400);assert.match(r.data.error.message,/已归档/);
  }
  const after=await consistent(f);assert.deepEqual(after.expenses,before.expenses);assert.deepEqual(after.payments,before.payments);assert.equal(after.ledger.status,'archived');
  assert.equal(after.ledger.statusHistory[0].actorUid,alice.uid);
  assert.equal((await post(bob,f.id,'setLedgerStatus',['active'])).status,403);
  await command(alice,f.id,'setLedgerStatus',['active']);await command(bob,f.id,'addExpense',[expense(f.b,{[f.b]:100},100)]);
  assert.equal((await consistent(f)).expenses.length,2);
});

test('archiving serializes with another member adding an expense and restoration retains schedules',async()=>{
  const f=await trio(),original=expense('owner',{owner:100},100),template=await command(alice,f.id,'saveTemplate',[{...original,frequency:'monthly',startDate:'2026-10-01'}]);
  const [archive,add]=await Promise.all([post(alice,f.id,'setLedgerStatus',['archived']),post(bob,f.id,'addExpense',[expense(f.b,{[f.b]:100},100)])]);
  assert.equal(archive.status,200);assert.ok([200,400].includes(add.status));
  let s=await consistent(f);assert.equal(s.ledger.status,'archived');assert.equal(s.expenses.length,add.status===200?1:0);
  assert.equal((await post(bob,f.id,'addExpense',[expense(f.b,{[f.b]:100},100)])).status,400);
  await command(alice,f.id,'setLedgerStatus',['active']);s=await consistent(f);assert.equal(s.templates[0].id,template);assert.equal(s.templates[0].status,'active');assert.equal(s.templates[0].startDate,'2026-10-01');
  assert.deepEqual(s.ledger.statusHistory.map(row=>row.status),['archived','active']);
});

test('members export complete private ZIPs with old receipts and outsiders cannot download them',async()=>{
  const f=await trio(),original=expense('owner',{owner:100,[f.b]:100},200,{receipts:[pdf()]}),id=await command(alice,f.id,'addExpense',[original]);
  await command(alice,f.id,'updateExpense',[id,{...original,receipts:[],note:'移除当前附件',expectedVersion:1,changeReason:'凭据已留档'}]);
  await command(alice,f.id,'setLedgerStatus',['archived']);
  const response=await fetch(`${base}/api/ledgers/${f.id}/export`,{headers:{cookie:bob.cookie}});
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/application\/zip/);assert.equal(response.headers.get('cache-control'),'no-store');
  const files=await unzip(Buffer.from(await response.arrayBuffer())),data=JSON.parse(files.get('ledger.json'));
  assert.equal(data.schemaVersion,1);assert.equal(data.ledger.status,'archived');assert.equal(data.expenses[0].history.length,2);assert.equal(data.expenses[0].receipts.length,0);
  const file=data.expenses[0].history[0].after.receipts[0];assert.equal(files.get(file.path).toString(),Buffer.from(pdf().dataUrl.split(',')[1],'base64').toString());
  assert.ok(files.has('shares.csv'));assert.ok(files.has('payments.csv'));assert.ok(files.has('ledger-status.csv'));
  assert.equal(data.invites,undefined);assert.equal(data.claims,undefined);
  assert.equal((await fetch(`${base}/api/ledgers/${f.id}/export`,{headers:{cookie:outsider.cookie}})).status,403);
  assert.equal((await fetch(`${base}/api/ledgers/${f.id}/export`)).status,401);
});

test('members add temporary participants without granting account or invitation access',async()=>{
  const f=await trio(),before=await snapshot(alice,f.id),key=randomUUID();
  const temporary=await command(bob,f.id,'addMember',['同行伙伴'],key);
  assert.equal(await command(bob,f.id,'addMember',['同行伙伴'],key),temporary);
  const after=await consistent(f);assert.equal(after.members.length,before.members.length+1);
  assert.equal(after.members.find(row=>row.id===temporary).uid,null);
  assert.deepEqual(after.ledger.memberUids,before.ledger.memberUids);
  assert.equal((await post(bob,f.id,'createInvite',[temporary])).status,403);
  assert.equal((await post(outsider,f.id,'addMember',['外人'])).status,403);
  const id=await command(bob,f.id,'addExpense',[expense(f.b,{[f.b]:100,[temporary]:100},200)]);
  assert.equal((await snapshot(alice,f.id)).expenses.find(row=>row.id===id).shares[temporary],100);
  await command(alice,f.id,'setLedgerStatus',['archived']);
  assert.equal((await post(bob,f.id,'addMember',['归档后'])).status,400);
});

test('a resumed draft retry after a new login returns the original expense without duplicating history',async()=>{
  const f=await trio(),key=randomUUID(),args=[expense(f.b,{[f.b]:100},100)];
  const id=await command(bob,f.id,'addExpense',args,key),otherSession=await login(bob);
  assert.equal(await command(otherSession,f.id,'addExpense',args,key),id);
  const s=await consistent(f);assert.equal(s.expenses.length,1);assert.equal(s.expenses[0].history.length,1);
});


test('single receipt freezes recipient/version/balance and stale submissions leave all accounts unchanged',async()=>{
 const f=await trio(),original=expense('owner',{[f.b]:10000},10000),id=await command(alice,f.id,'addExpense',[original]);
 const reviewed={expenseId:id,fromMemberId:f.b,toMemberId:'owner',expectedVersion:1,expectedRemaining:10000,amountCents:5000,date:'2026-11-07',note:'Received by original payer'};
 await command(alice,f.id,'updateExpense',[id,{...original,payerMemberId:f.c,expectedVersion:1,changeReason:'Correct payer'}]);
 const before=await consistent(f);
 for(const payload of [reviewed,{...reviewed,expectedVersion:2},{...reviewed,toMemberId:f.c},{...reviewed,toMemberId:f.c,expectedVersion:2,expectedRemaining:9000},{expenseId:id,fromMemberId:f.b,amountCents:100}]){
  assert.equal((await post(alice,f.id,'recordPayment',[payload])).status,409);
  assert.deepEqual(financial(await consistent(f)),financial(before));
 }
 const corrected={...reviewed,toMemberId:f.c,expectedVersion:2},key=randomUUID();
 const payment=await command(chen,f.id,'recordPayment',[corrected],key);
 assert.equal(await command(chen,f.id,'recordPayment',[corrected],key),payment);
 const after=await consistent(f);assert.equal(after.payments[0].toMemberId,f.c);assert.equal(after.expenses[0].repaid[f.b],5000);
 assert.equal((await post(alice,f.id,'recordPayment',[corrected])).status,409);
});

test('streamed full backup above former upload and expansion caps restores historical receipts and balances atomically',async()=>{
 const f=await trio(),bytes=Buffer.alloc(2*1024*1024);bytes.write('%PDF-1.4\n');
 const receipt={name:'Full-size receipt.pdf',type:'application/pdf',size:bytes.length,dataUrl:`data:application/pdf;base64,${bytes.toString('base64')}`};
 for(let i=0;i<8;i++)await command(alice,f.id,'addExpense',[expense('owner',{[f.b]:10000},10000,{title:'Backup '+i,receipts:[receipt,receipt,receipt]})]);
 let saved=await snapshot(alice,f.id),first=saved.expenses[0];
 await command(alice,f.id,'updateExpense',[first.id,{...first,receipts:first.receipts.slice(1),expectedVersion:1,changeReason:'Keep removed receipt in history'}]);
 await command(alice,f.id,'recordPayment',[{expenseId:first.id,fromMemberId:f.b,amountCents:1000,date:'2026-11-07'}]);
 saved=await consistent(f);
 const exported=await fetch(base+`/api/ledgers/${f.id}/export`,{headers:{cookie:alice.cookie}});assert.equal(exported.status,200);
 const zip=Buffer.from(await exported.arrayBuffer());assert.ok(zip.length>40*1024*1024);
 const upload=await fetch(base+'/api/ledger-import/upload?format=zip',{method:'POST',headers:{origin,cookie:bob.cookie,'x-bill-splitter':'1','content-type':'application/octet-stream'},body:Readable.from((function*(){for(let i=0;i<zip.length;i+=65536)yield zip.subarray(i,i+65536);})()),duplex:'half'});
 const preview=await upload.json();assert.equal(upload.status,200,JSON.stringify(preview));
 assert.equal(preview.attachmentCount,24);assert.equal(preview.totalCents,80000);assert.equal(preview.outstandingCents,79000);assert.equal(preview.from,'2026-10-30');
 assert.equal(preview.members.find(m=>m.id===f.b).payableCents,79000);
 assert.equal((await request(outsider,'POST','/api/ledger-import/commit',{token:preview.token,memberId:f.b})).status,410);
 const key=randomUUID(),body={token:preview.token,memberId:f.b,title:'Recovered full backup'};
 const copied=await good(bob,'POST','/api/ledger-import/commit',body,key);
 assert.equal(await good(bob,'POST','/api/ledger-import/commit',body,key),copied);
 const restored=await snapshot(bob,copied);assert.equal(restored.expenses.length,8);assert.equal(restored.payments.length,1);
 assert.equal(JSON.stringify(restored).includes('importPath'),false);
 const balanceMap=s=>Object.fromEntries(memberBalances(s).map(m=>[m.name,m.balanceCents]));assert.deepEqual(balanceMap(restored),balanceMap(saved));
 const files=new Map();for(const e of restored.expenses)for(const version of [e,...e.history.flatMap(h=>[h.before,h.after].filter(Boolean))])for(const file of version.receipts||[])files.set(file.id,file);
 assert.equal(files.size,24);
 for(const file of files.values()){
  const r=await fetch(base+file.url,{headers:{cookie:bob.cookie}});assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);
 }
 assert.equal((await request(alice,'GET',`/api/ledgers/${copied}`)).status,403);
 assert.deepEqual(financial(await consistent(f)),financial(saved));
 assert.equal((await request(bob,'POST','/api/ledger-import/commit',body)).status,410);
 const rejected=await fetch(base+'/api/ledger-import/upload?format=zip',{method:'POST',headers:{origin,cookie:bob.cookie,'x-bill-splitter':'1','content-type':'application/octet-stream'},body:Buffer.from('broken zip')});assert.equal(rejected.status,400);
 assert.equal((await good(bob,'GET','/api/ledgers')).filter(l=>l.title==='Recovered full backup').length,1);
});


test('batch members commit atomically, replay once, and detect concurrent name creation',async()=>{
 const f=await trio(),entries=[{name:'小林',memberId:f.b},{name:'小宋',create:true,expectedMatches:[]}];
 const before=await snapshot(alice,f.id);
 assert.equal((await post(bob,f.id,'addMembers',[[...entries,{name:'Missing',memberId:'foreign'}]])).status,409);
 assert.deepEqual(await snapshot(alice,f.id),before);
 assert.equal((await post(outsider,f.id,'addMembers',[entries])).status,403);
 const key=randomUUID(),added=await command(bob,f.id,'addMembers',[entries],key);
 assert.deepEqual(await command(bob,f.id,'addMembers',[entries],key),added);assert.equal(added[0].id,f.b);assert.equal(added[1].uid,null);
 const concurrent=[{name:'小陶',create:true,expectedMatches:[]}];
 const results=await Promise.all([post(alice,f.id,'addMembers',[concurrent]),post(chen,f.id,'addMembers',[concurrent])]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const s=await consistent(f);assert.equal(s.members.filter(m=>m.name==='小宋').length,1);assert.equal(s.members.filter(m=>m.name==='小陶').length,1);
});

test('shared participant groups enforce versions, isolate ledgers, synchronize and survive backups',async()=>{
 const f=await trio(),g=await command(bob,f.id,'saveParticipantGroup',[{name:'晚餐四人',memberIds:['owner',f.b,f.c]}]);
 assert.deepEqual((await consistent(f)).participantGroups,[g]);
 assert.equal((await post(chen,f.id,'saveParticipantGroup',[{name:'Changed',memberIds:[f.c],expectedVersion:1},g.id])).status,403);
 const another=await ledger();assert.equal((await post(alice,another,'saveParticipantGroup',[{name:'Foreign',memberIds:[f.b]}])).status,400);
 const changed=await command(alice,f.id,'saveParticipantGroup',[{name:'同行伙伴',memberIds:[f.b,f.c],expectedVersion:1},g.id]);assert.equal(changed.version,2);
 assert.equal((await post(bob,f.id,'deleteParticipantGroup',[g.id,1])).status,409);
 const snapshotBefore=await consistent(f),{data}=ledgerExport(snapshotBefore);
 const copied=await good(bob,'POST','/api/ledger-import',{format:'json',content:JSON.stringify(data),memberId:f.b});
 const restored=await snapshot(bob,copied);assert.equal(restored.participantGroups[0].name,'同行伙伴');assert.equal(restored.participantGroups[0].memberIds.length,2);
 assert.ok(restored.participantGroups[0].memberIds.every(id=>restored.members.some(m=>m.id===id)));assert.equal((await request(chen,'GET',`/api/ledgers/${copied}`)).status,403);
 await command(bob,f.id,'deleteParticipantGroup',[g.id,2]);const after=await consistent(f);assert.deepEqual(after.participantGroups,[]);assert.deepEqual(after.members,snapshotBefore.members);assert.deepEqual(after.expenses,snapshotBefore.expenses);
 await command(alice,f.id,'setLedgerStatus',['archived']);assert.equal((await post(bob,f.id,'saveParticipantGroup',[{name:'Archived',memberIds:[f.b]}])).status,400);
});

test('three accounts see one receipt after offline and repeated lost-response retries, including a tab reload',async()=>{
 const f=await trio(),realFetch=globalThis.fetch,storage=new Map(),storageDescriptor=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}});
 try{
  for(const fault of ['offline-before-send','lost-response','truncated-response','server-error']){
   const id=await command(alice,f.id,'addExpense',[expense('owner',{[f.b]:10000},10000,{title:fault})]),writes=[];
   let failures=2;
   globalThis.fetch=async(url,options)=>{
    if(!String(url).startsWith('/api/'))return realFetch(url,options);
    const payment=options.method==='POST',fail=payment&&failures-->0;
    if(payment)writes.push({key:options.headers['Idempotency-Key'],body:options.body});
    if(fail&&fault==='offline-before-send')throw new TypeError('offline');
    const response=await realFetch(base+url,{...options,headers:{...options.headers,origin,cookie:alice.cookie}});
    if(fail){
     // Consume the successful HTTP response so the database commit is certain,
     // then simulate the browser failing to receive or parse that response.
     assert.equal(response.status,200);await response.text();
     if(fault==='server-error')return {ok:false,status:503,json:async()=>({error:{message:'Unavailable'}})};
     if(fault==='truncated-response')return {ok:true,status:200,json:async()=>{throw new SyntaxError('truncated');}};
     throw new TypeError('response lost after commit');
    }
    return response;
   };
   const store=createApiStore(alice),payload={expenseId:id,fromMemberId:f.b,toMemberId:'owner',expectedVersion:1,expectedRemaining:10000,amountCents:5000,date:'2026-11-07',note:'One actual transfer'};
   let submission=paymentSubmission(store,f.id,id,f.b);
   await assert.rejects(submission.submit(payload));assert.ok(submission.pending);assert.equal(storage.size,1);
   const fresh=await import(`../public/scripts/payment-submission.mjs?reload=${randomUUID()}`);
   submission=fresh.paymentSubmission(store,f.id,id,f.b);assert.deepEqual(submission.pending.payload,payload);
   // A newer balance, changed inputs or payer must not mutate an unknown write.
   const changed={...payload,expectedVersion:2,expectedRemaining:5000,amountCents:2500,toMemberId:f.c};
   await assert.rejects(submission.submit(changed));await submission.submit(changed);
   assert.equal(storage.size,0);assert.equal(new Set(writes.map(w=>w.key)).size,1);assert.equal(new Set(writes.map(w=>w.body)).size,1);
   globalThis.fetch=realFetch;
   const views=await consistent(f),payments=views.payments.filter(p=>p.expenseId===id);
   assert.equal(payments.length,1);assert.equal(payments[0].amountCents,5000);assert.equal(payments[0].toMemberId,'owner');
   assert.equal(remainingFor(views.expenses.find(e=>e.id===id),f.b),5000);
  }
 }finally{globalThis.fetch=realFetch;if(storageDescriptor)Object.defineProperty(globalThis,'sessionStorage',storageDescriptor);else delete globalThis.sessionStorage;}
});

test('group rename retains inactive members across accounts without permitting new inactive or foreign members',async()=>{
 const f=await trio(),g=await command(bob,f.id,'saveParticipantGroup',[{name:'Dinner',memberIds:[f.b,f.c]}]);
 await command(alice,f.id,'setMemberStatus',[f.b,'inactive']);await command(alice,f.id,'setMemberStatus',[f.c,'inactive']);
 const renamed=await command(bob,f.id,'saveParticipantGroup',[{name:'Friday dinner',memberIds:[f.b,f.c],expectedVersion:1},g.id]);
 assert.deepEqual(renamed.memberIds,[f.b,f.c]);assert.deepEqual((await consistent(f)).participantGroups,[renamed]);
 assert.equal((await post(alice,f.id,'saveParticipantGroup',[{name:'Stale',memberIds:['owner'],expectedVersion:1},g.id])).status,409);
 assert.equal((await post(alice,f.id,'saveParticipantGroup',[{name:'New inactive',memberIds:[f.b]}])).status,400);
 const other=await command(alice,f.id,'saveParticipantGroup',[{name:'Other',memberIds:['owner']}]);
 assert.equal((await post(alice,f.id,'saveParticipantGroup',[{name:'Other',memberIds:['owner',f.b],expectedVersion:1},other.id])).status,400);
 assert.equal((await post(alice,f.id,'saveParticipantGroup',[{name:'Foreign',memberIds:['foreign'],expectedVersion:2},g.id])).status,400);
 await command(alice,f.id,'setMemberStatus',[f.b,'active']);await command(alice,f.id,'setMemberStatus',[f.c,'active']);
 const final=await consistent(f);assert.deepEqual(final.participantGroups.find(row=>row.id===g.id).memberIds,[f.b,f.c]);
});
