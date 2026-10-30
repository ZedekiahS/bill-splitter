import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {database,migrate} from '../server/database.mjs';
import {buildApp} from '../server/app.mjs';
import {hash} from '../server/auth.mjs';

const url=process.env.TEST_DATABASE_URL;
if(!url)throw new Error('TEST_DATABASE_URL is required; use the dedicated local test database.');
const target=new URL(url);
if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw new Error('Tests require a loopback database ending in _test.');
const pool=database(url),origin='http://127.0.0.1:2801';
let app,alice,bob,outsider;
async function request(method,path,body,user,key=randomUUID(),extra={}){
  return app.inject({method,url:path,payload:body,headers:{origin,'x-bill-splitter':'1','content-type':'application/json','idempotency-key':key,...(user?{cookie:user.cookie}:{}),...extra}});
}
async function good(method,path,body,user,key){const response=await request(method,path,body,user,key);assert.ok(response.statusCode<300,response.body);const data=response.json();return Object.hasOwn(data,'result')?data.result:data;}
async function register(name){const response=await request('POST','/api/auth/register',{email:`${name}-${randomUUID()}@example.test`,displayName:name,password:'Strong-local-test-123!'});assert.equal(response.statusCode,200,response.body);return {...response.json().user,cookie:response.headers['set-cookie'].split(';')[0]};}
async function fixture(){
  const ledger=await good('POST','/api/ledgers',{title:'Trip',currency:'CNY',ownerUid:outsider.uid},alice);
  const member=await command(ledger,'addMember',['Bob'],alice);
  return {ledger,member};
}
const command=(ledger,type,args,user,key)=>good('POST',`/api/ledgers/${ledger}/commands`,{type,args},user,key);
async function join(f){const token=await command(f.ledger,'createInvite',[f.member],alice);await good('POST',`/api/invites/${token}/commands`,{type:'claim',displayName:'Bob'},bob);await good('POST',`/api/invites/${token}/commands`,{type:'approve',uid:bob.uid},alice);return token;}
const payload=f=>({title:'Dinner',date:'2026-10-29',amountCents:10001,payerMemberId:'owner',shares:{owner:5001,[f.member]:5000},note:'Shared dinner'});
before(async()=>{
  await migrate(pool);
  await pool.query('TRUNCATE bs_requests,bs_receipts,bs_invites,bs_memberships,bs_ledgers,bs_sessions,bs_identities,bs_users,bs_auth_limits');
  app=await buildApp({pool,origins:[origin]});alice=await register('Alice');bob=await register('Bob');outsider=await register('Outsider');
});
after(async()=>{if(app)await app.close();await pool.end();});

test('registration stores hashed passwords and opaque HttpOnly sessions',async()=>{
  const {rows}=await pool.query('SELECT password_hash FROM bs_identities WHERE user_id=$1',[alice.uid]);
  assert.match(rows[0].password_hash,/^[0-9a-f]{32}:[0-9a-f]{128}$/);assert.doesNotMatch(rows[0].password_hash,/Strong/);
  const me=await good('GET','/api/auth/me',undefined,alice);assert.equal(me.user.uid,alice.uid);assert.equal(me.user.email,alice.email);
  const unknown=await good('GET','/api/auth/me',undefined);assert.equal(unknown.user,null);
  assert.equal((await request('GET','/api/ledgers')).statusCode,401);
});
test('login rotates cookies and logout revokes access',async()=>{
  assert.equal((await request('POST','/api/auth/login',{email:alice.email,password:'Incorrect-password'})).statusCode,401);
  const response=await request('POST','/api/auth/login',{email:alice.email,password:'Strong-local-test-123!'});
  assert.match(response.headers['set-cookie'],/HttpOnly/);assert.match(response.headers['set-cookie'],/SameSite=Lax/);
  const session={cookie:response.headers['set-cookie'].split(';')[0]};await good('POST','/api/auth/logout',{},session);
  assert.equal((await request('GET','/api/ledgers',undefined,session)).statusCode,401);
});
test('CSRF, malformed JSON, and oversized bodies are rejected',async()=>{
  assert.equal((await request('POST','/api/ledgers',{},alice,randomUUID(),{origin:'https://evil.example'})).statusCode,403);
  assert.equal((await request('POST','/api/ledgers',{},alice,randomUUID(),{'x-bill-splitter':''})).statusCode,403);
  assert.equal((await request('POST','/api/ledgers','{"__proto__":{"admin":true}}',alice)).statusCode,400);
  assert.equal((await request('POST','/api/ledgers',{title:'x'.repeat(1024*1024+1)},alice)).statusCode,413);
});

test('expired sessions lose access and login limits recover after their window',async()=>{
  const loginBody={email:outsider.email,password:'Strong-local-test-123!'};
  const response=await request('POST','/api/auth/login',loginBody);
  const session={cookie:response.headers['set-cookie'].split(';')[0]};
  const raw=session.cookie.slice(session.cookie.indexOf('=')+1);
  await pool.query("UPDATE bs_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[hash(raw)]);
  assert.equal((await request('GET','/api/ledgers',undefined,session)).statusCode,401);
  const key=hash('login-email:'+outsider.email);
  await pool.query('UPDATE bs_auth_limits SET count=20 WHERE key=$1',[key]);
  assert.equal((await request('POST','/api/auth/login',loginBody)).statusCode,429);
  await pool.query("UPDATE bs_auth_limits SET expires_at=now()-interval '1 second' WHERE key=$1",[key]);
  assert.equal((await request('POST','/api/auth/login',loginBody)).statusCode,200);
});

test('production requires HTTPS origins and sets secure cookies with registration control',async()=>{
  await assert.rejects(()=>buildApp({pool,origins:[origin],production:true}),/HTTPS/);
  const secureOrigin='https://bills.example.test';
  const secured=await buildApp({pool,origins:[secureOrigin],production:true,registration:false});
  try {
    const headers={origin:secureOrigin,'x-bill-splitter':'1'};
    const blocked=await secured.inject({method:'POST',url:'/api/auth/register',headers,payload:{}});
    assert.equal(blocked.statusCode,403);
    const response=await secured.inject({method:'POST',url:'/api/auth/login',headers,payload:{email:bob.email,password:'Strong-local-test-123!'}});
    assert.equal(response.statusCode,200,response.body);
    assert.match(response.headers['set-cookie'],/^__Host-bs_session=.*; Path=\/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure$/);
    assert.equal(response.headers['strict-transport-security'],'max-age=31536000');
  }finally{await secured.close();}
});
test('the authenticated owner is authoritative and outsiders cannot see ledger data',async()=>{
  const f=await fixture(),s=await good('GET',`/api/ledgers/${f.ledger}`,undefined,alice);
  assert.equal(s.ledger.ownerUid,alice.uid);assert.equal((await request('GET',`/api/ledgers/${f.ledger}`,undefined,outsider)).statusCode,403);
  assert.deepEqual(await good('GET','/api/ledgers',undefined,outsider),[]);
  assert.equal((await request('POST',`/api/ledgers/${f.ledger}/commands`,{type:'addMember',args:['Intruder']},outsider)).statusCode,403);
});
test('invitation approval binds only the claimant and preserves member identity',async()=>{
  const f=await fixture(),token=await command(f.ledger,'createInvite',[f.member],alice);
  await good('POST',`/api/invites/${token}/commands`,{type:'claim',displayName:'Bob',uid:alice.uid},bob);
  assert.equal((await request('GET',`/api/ledgers/${f.ledger}`,undefined,bob)).statusCode,403);
  assert.equal((await request('POST',`/api/invites/${token}/commands`,{type:'approve',uid:bob.uid},bob)).statusCode,403);
  await good('POST',`/api/invites/${token}/commands`,{type:'approve',uid:bob.uid},alice);
  const s=await good('GET',`/api/ledgers/${f.ledger}`,undefined,bob);assert.equal(s.members.find(m=>m.id===f.member).uid,bob.uid);
  assert.equal((await request('GET',`/api/invites/${token}`,undefined,outsider)).statusCode,403);
});
test('members cannot impersonate another payer or administer the ledger',async()=>{
  const f=await fixture();await join(f);
  for(const body of [{type:'addMember',args:['Mallory']},{type:'addExpense',args:[payload(f)]}])assert.equal((await request('POST',`/api/ledgers/${f.ledger}/commands`,body,bob)).statusCode,403);
  const expense=await command(f.ledger,'addExpense',[{...payload(f),payerMemberId:f.member}],bob);assert.ok(expense);
});
test('concurrent writes and retries preserve one idempotent expense',async()=>{
  const f=await fixture(),key=randomUUID(),body={type:'addExpense',args:[payload(f)]};
  const [a,b]=await Promise.all([request('POST',`/api/ledgers/${f.ledger}/commands`,body,alice,key),request('POST',`/api/ledgers/${f.ledger}/commands`,body,alice,key)]);
  assert.equal(a.statusCode,200,a.body);assert.equal(b.statusCode,200,b.body);assert.equal(a.body,b.body);
  assert.equal((await good('GET',`/api/ledgers/${f.ledger}`,undefined,alice)).expenses.length,1);
  assert.equal((await request('POST',`/api/ledgers/${f.ledger}/commands`,{type:'addMember',args:['different']},alice,key)).statusCode,409);
});
test('concurrent overpayments serialize and reversal is append-only',async()=>{
  const f=await fixture();await join(f);const expense=await command(f.ledger,'addExpense',[payload(f)],alice),body={type:'recordPayment',args:[{expenseId:expense,fromMemberId:f.member,amountCents:4000,date:'2026-10-29'}]};
  const responses=await Promise.all([request('POST',`/api/ledgers/${f.ledger}/commands`,body,alice),request('POST',`/api/ledgers/${f.ledger}/commands`,body,alice)]);
  assert.deepEqual(responses.map(r=>r.statusCode).sort(),[200,400]);
  let s=await good('GET',`/api/ledgers/${f.ledger}`,undefined,bob);assert.equal(s.expenses[0].repaid[f.member],4000);assert.equal(s.payments.length,1);
  assert.equal((await request('POST',`/api/ledgers/${f.ledger}/commands`,{type:'reversePayment',args:[s.payments[0].id]},bob)).statusCode,403);
  await command(f.ledger,'reversePayment',[s.payments[0].id],alice);s=await good('GET',`/api/ledgers/${f.ledger}`,undefined,bob);
  assert.equal(s.payments.length,2);assert.equal(s.expenses[0].repaid[f.member],0);
});
test('item totals are validated on the server and receipts require membership',async()=>{
  const f=await fixture();await join(f);const bytes=Buffer.from('%PDF-1.4\nfixture\n%%EOF'),file={name:'receipt.pdf',type:'application/pdf',size:bytes.length,dataUrl:`data:application/pdf;base64,${bytes.toString('base64')}`};
  const data={...payload(f),items:[{title:'Dinner',amountCents:10001,memberIds:['owner',f.member]}],receipts:[file]};
  const bad={...data,shares:{owner:5000,[f.member]:5001}};
  assert.equal((await request('POST',`/api/ledgers/${f.ledger}/commands`,{type:'addExpense',args:[bad]},alice)).statusCode,400);
  await command(f.ledger,'addExpense',[data],alice);
  const s=await good('GET',`/api/ledgers/${f.ledger}`,undefined,bob),receipt=s.expenses[0].receipts[0];assert.equal(receipt.dataUrl,undefined);
  const response=await request('GET',receipt.url,undefined,bob);assert.equal(response.statusCode,200);assert.deepEqual(response.rawPayload,bytes);assert.equal(response.headers['cache-control'],'no-store');
  assert.equal((await request('GET',receipt.url,undefined,outsider)).statusCode,403);assert.equal((await request('GET',receipt.url)).statusCode,401);
});
test('recurring claims cannot double-post across accounts or after reversal',async()=>{
  const f=await fixture();await join(f);const startDate='2026-01-01';
  const template=await command(f.ledger,'saveTemplate',[{...payload(f),payerMemberId:f.member,frequency:'monthly',startDate}],bob);
  const body={type:'addExpense',args:[{...payload(f),payerMemberId:f.member,sourceTemplateId:template,sourceDate:startDate}]};
  const results=await Promise.all([request('POST',`/api/ledgers/${f.ledger}/commands`,body,alice),request('POST',`/api/ledgers/${f.ledger}/commands`,body,bob)]);
  assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,400]);
  const s=await good('GET',`/api/ledgers/${f.ledger}`,undefined,bob);assert.equal(s.occurrences.length,1);assert.equal(s.expenses.length,1);
  await command(f.ledger,'reverseExpense',[s.expenses[0].id],alice);
  assert.equal((await request('POST',`/api/ledgers/${f.ledger}/commands`,body,bob)).statusCode,400);
});
test('accounts and ledger data survive a new server instance',async()=>{
  const f=await fixture();await app.close();app=await buildApp({pool,origins:[origin]});
  assert.equal((await good('GET',`/api/ledgers/${f.ledger}`,undefined,alice)).ledger.id,f.ledger);
  const response=await request('GET','/index.html');assert.equal(response.statusCode,200);assert.doesNotMatch(response.body,/firebase|rosefire/i);
  assert.equal((await request('GET','/history.html')).statusCode,404);
});
