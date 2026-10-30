import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {database,migrate} from '../server/database.mjs';
import {buildApp} from '../server/app.mjs';
import {splitShares,memberBalances,settlementText,remainingFor} from '../public/scripts/ledger-core.mjs';
import {itemizedShares,dueOccurrences} from '../public/scripts/expense-features.mjs';

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
const command=(user,ledger,type,args,key)=>good(user,'POST',`/api/ledgers/${ledger}/commands`,{type,args},key);
const snapshot=(user,ledger)=>good(user,'GET',`/api/ledgers/${ledger}`);
const post=(user,ledger,type,args,key)=>request(user,'POST',`/api/ledgers/${ledger}/commands`,{type,args},key);
const expense=(payer,shares,amountCents=12000,extra={})=>({title:'共同开销',date:'2026-10-30',amountCents,payerMemberId:payer,shares,...extra});
async function ledger(owner=alice,currency='CNY'){return good(owner,'POST','/api/ledgers',{title:'三人周末',currency});}
async function invite(id,owner,user,name=user.displayName){const member=await command(owner,id,'addMember',[name]),token=await command(owner,id,'createInvite',[member]);await good(user,'POST',`/api/invites/${token}/commands`,{type:'claim',displayName:name});await good(owner,'POST',`/api/invites/${token}/commands`,{type:'approve',uid:user.uid});return member;}
async function trio(){const id=await ledger(),b=await invite(id,alice,bob),c=await invite(id,alice,chen);return {id,b,c};}
const financial=s=>({ledger:s.ledger,members:s.members,expenses:s.expenses,payments:s.payments,templates:s.templates,occurrences:s.occurrences});
async function consistent(f){const views=await Promise.all([alice,bob,chen].map(u=>snapshot(u,f.id)));assert.deepEqual(financial(views[0]),financial(views[1]));assert.deepEqual(financial(views[0]),financial(views[2]));assert.equal(memberBalances(views[0]).reduce((n,m)=>n+m.balanceCents,0),0);return views[0];}
const pdf=()=>{const bytes=Buffer.from('%PDF-1.4\nSynthetic scenario receipt\n%%EOF');return {name:'receipt.pdf',type:'application/pdf',size:bytes.length,dataUrl:`data:application/pdf;base64,${bytes.toString('base64')}`};};

before(async()=>{
  await migrate(pool);
  await pool.query('TRUNCATE bs_requests,bs_receipts,bs_invites,bs_memberships,bs_ledgers,bs_sessions,bs_identities,bs_users,bs_auth_limits');
  app=await buildApp({pool,origins:[origin]});base=await app.listen({host:'127.0.0.1',port:0});
  alice=await register('小周');bob=await register('小林');chen=await register('安安');outsider=await register('小林');
});
after(async()=>{if(app)await app.close();await pool.end();});

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
  const args=[{expenseId:id,fromMemberId:f.c,amountCents:5000}];
  const results=await Promise.all([post(alice,f.id,'recordPayment',args),post(bob,f.id,'recordPayment',args)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
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
  assert.equal((await post(bob,f.id,'addMember',['错误权限'])).status,403);
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
  const invalid=[{amountCents:0},{amountCents:-1},{amountCents:1.5},{amountCents:Number.MAX_SAFE_INTEGER+1},{amountCents:'100'}, {shares:{owner:-1}},{shares:{owner:101}},{shares:{}},{shares:{[randomUUID()]:100}}, {payerMemberId:randomUUID()},{date:'2026-02-30'},{title:' '},{title:'x'.repeat(121)},{note:'x'.repeat(1001)},{items:[{title:'wrong',amountCents:101,memberIds:['owner']}]},{receipts:[pdf(),pdf(),pdf(),pdf()]},{receipts:[{...pdf(),size:204801}]},{receipts:[{...pdf(),dataUrl:'data:application/pdf;base64,eA==',size:1}]},{sourceTemplateId:randomUUID()}];
  for(const change of invalid){const r=await post(alice,f.id,'addExpense',[{...valid,...change}]);assert.equal(r.status,400,JSON.stringify(change));}
  assert.deepEqual(await snapshot(alice,f.id),before);
  assert.equal(Number((await pool.query('SELECT count(*) FROM bs_receipts WHERE ledger_id=$1',[f.id])).rows[0].count),0);
});

test('receipt count and exact size boundaries work, and three users see private metadata',async()=>{
  const f=await trio(),bytes=Buffer.alloc(204800,32);bytes.write('%PDF-1.4');const file={name:'边界收据.pdf',type:'application/pdf',size:bytes.length,dataUrl:`data:application/pdf;base64,${bytes.toString('base64')}`};
  await command(alice,f.id,'addExpense',[expense('owner',{owner:100},100,{note:'凭据',receipts:[file,pdf(),pdf()]})]);
  const s=await consistent(f);assert.equal(s.expenses[0].receipts.length,3);const saved=s.expenses[0].receipts[0];assert.equal(saved.dataUrl,undefined);
  const response=await fetch(base+saved.url,{headers:{cookie:chen.cookie}});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);assert.equal(response.headers.get('cache-control'),'no-store');
});

test('member and item count limits reject the ninth participant without limiting ledger membership',async()=>{
  const id=await ledger(),members=['owner'];for(let i=0;i<8;i++)members.push(await command(alice,id,'addMember',[`成员${i}`]));
  const shares=Object.fromEntries(members.map(m=>[m,100]));assert.equal((await post(alice,id,'addExpense',[expense('owner',shares,900)])).status,400);
  const eight=members.slice(0,8),items=eight.map((m,i)=>({title:`项目${i}`,amountCents:100,memberIds:[m]})),details=itemizedShares(items);
  await command(alice,id,'addExpense',[expense('owner',details.shares,details.amountCents,{items})]);
  assert.equal((await post(alice,id,'addExpense',[expense('owner',details.shares,900,{items:[...items,items[0]]})])).status,400);
  const s=await snapshot(alice,id);assert.equal(s.members.length,9);assert.equal(s.expenses.length,1);
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
  await post(bob,f.id,'addMember',['forbidden']);assert.equal(await version(),initial+1n);
  const payment=await command(alice,f.id,'recordPayment',[{expenseId:id,fromMemberId:f.b,amountCents:40}]);assert.equal(await version(),initial+2n);
  await command(alice,f.id,'reversePayment',[payment]);assert.equal(await version(),initial+3n);
  await command(alice,f.id,'reverseExpense',[id]);assert.equal(await version(),initial+4n);
  const member=await command(alice,f.id,'addMember',['new']),token=await command(alice,f.id,'createInvite',[member]);
  await good(outsider,'POST',`/api/invites/${token}/commands`,{type:'claim'});assert.equal(await version(),initial+7n);
  assert.equal((await read(outsider)).some(row=>row.id===f.id),false);
  await good(alice,'POST',`/api/invites/${token}/commands`,{type:'approve',uid:outsider.uid});
  const joined=(await read(outsider)).find(row=>row.id===f.id);assert.deepEqual(Object.keys(joined).sort(),['id','revision']);assert.equal(BigInt(joined.revision),initial+8n);
});
