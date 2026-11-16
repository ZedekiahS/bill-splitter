import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../server/app.mjs';
import {Writable} from 'node:stream';
import {get} from 'node:http';
import {unzip} from './zip-helper.mjs';
import {errorDiagnostic} from '../server/request-logging.mjs';
import {setTimeout as delay} from 'node:timers/promises';

const origin='http://localhost';
const pool={query:async()=>({rows:[]})};

function capture(){
 const lines=[];
 return {stream:new Writable({write(chunk,_encoding,done){lines.push(String(chunk));done();}}),
  raw:()=>lines.join(''),logs:()=>lines.join('').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))};
}

test('diagnostics exclude whole multiline messages including forged application frames',async t=>{
 const captureLog=capture(),site=new URL('../server/app.mjs',import.meta.url).href;
 const messages=['Database value: server/private-canary-note.mjs:12:34',
  `Database value\n    at private-canary (${site}:987654:321)\npublic/scripts/private-canary.mjs:42:10`];
 let message;
 const app=await buildApp({pool:{query:async()=>{throw Object.assign(new Error(message),{code:'08006'});}},origins:[origin],logger:{stream:captureLog.stream}});
 t.after(()=>app.close());
 for(message of messages){
  const response=await app.inject('/api/health');assert.equal(response.statusCode,500);
  const log=captureLog.logs().find(row=>row.event==='request.failed'&&row.reqId===response.headers['x-request-id']);
  assert.equal(log.error.code,'08006');
  assert.ok(log.error.sites.some(site=>/^server\/app\.mjs:\d+:\d+$/.test(site)),'real application frame retained');
 }
 assert.doesNotMatch(captureLog.raw(),/private-canary|987654/);
});

test('diagnostic locations reject unknown source files and unrecognizable message boundaries',()=>{
 const error=new Error('original');
 error.stack=`Error: original\n    at query (${new URL('../server/not-installed.mjs',import.meta.url).href}:1:2)\n    at query (server/app.mjs:3:4)`;
 assert.deepEqual(errorDiagnostic(error).sites,[]);
 error.message='changed';error.stack=`Error: original\n    at query (${new URL('../server/app.mjs',import.meta.url).href}:5:6)`;
 assert.deepEqual(errorDiagnostic(error).sites,[]);
});

async function exportFixture(t){
 const captureLog=capture(),id='11111111-1111-4111-8111-111111111111',fileId='22222222-2222-4222-8222-222222222222';
 const bytes=Buffer.from('%PDF-1.4\nprivate receipt'),user={uid:'owner',displayName:'Owner'};
 const receipt={id:fileId,name:'private-receipt.pdf',type:'application/pdf',size:bytes.length};
 const state={templates:{},occurrences:{},ledgers:{[id]:{title:'Private ledger',currency:'CNY',ownerUid:user.uid,memberUids:[user.uid]}},
  members:{[id]:{owner:{name:'Owner',uid:user.uid}}},expenses:{[id]:{expense:{title:'Private purchase',date:'2026-11-15',amountCents:100,payerMemberId:'owner',shares:{owner:100},repaid:{},status:'active',receipts:[receipt],history:[]}}},payments:{[id]:{}}};
 let readReceipt=async()=>({rows:[{name:receipt.name,mime:receipt.type,bytes}]});
 const pool={query:async sql=>{
  if(sql.includes('FROM bs_sessions'))return {rows:[user]};
  if(sql.includes('SELECT body FROM bs_ledgers'))return {rows:[{body:state}]};
  if(sql.includes('FROM bs_receipts'))return readReceipt();
  throw new Error('Unexpected fixture query');
 }};
 const app=await buildApp({pool,origins:[origin],logger:{stream:captureLog.stream}});
 const base=await app.listen({host:'127.0.0.1',port:0});
 t.after(()=>{app.server.closeAllConnections();return app.close();});
 function open(){return new Promise((resolve,reject)=>{
  const request=get(`${base}/api/ledgers/${id}/export?private=private-query`,{headers:{cookie:'bs_session='+'a'.repeat(43)}},resolve);
  request.on('error',reject);
 });}
 return {...captureLog,bytes,open,setRead:fn=>{readReceipt=fn;}};
}

for(const code of ['08006','ECONNRESET'])test(`ZIP attachment ${code} after headers has one safe correlated failure, not a successful completion`,{timeout:10000},async t=>{
 const f=await exportFixture(t);let fail,started;
 const reading=new Promise(resolve=>{started=resolve;});
 f.setRead(()=>new Promise((_resolve,reject)=>{fail=reject;started();}));
 const response=await f.open();assert.equal(response.statusCode,200);
 const body=(async()=>{for await(const _chunk of response){/* consume actual network response */}})();
 await reading;
 fail(Object.assign(new Error('private-zip-canary\nserver/private-canary.mjs:12:34'),{code}));
 await assert.rejects(body);
 await new Promise(resolve=>setImmediate(resolve));
 const logs=f.logs().filter(row=>row.reqId===response.headers['x-request-id']);
 const failures=logs.filter(row=>row.event==='request.failed');assert.equal(failures.length,1);
 const failure=failures[0];assert.equal(failure.outcome,'failed');assert.equal(failure.status,200);
 assert.equal(failure.method,'GET');assert.equal(failure.route,'/api/ledgers/:id/export');assert.ok(failure.durationMs>=0);
 assert.equal(failure.error.code,code);assert.equal(failure.error.type,'Error');assert.equal(failure.headersSent,true);
 assert.equal(logs.filter(row=>row.event==='request.completed').length,0);
 assert.doesNotMatch(f.raw(),/private-zip-canary|private-canary|private-query|Private purchase|Private ledger|private-receipt|bs_session/);
});

test('successful ZIP download stays readable and has exactly one completion',{timeout:10000},async t=>{
 const f=await exportFixture(t),response=await f.open(),chunks=[];
 for await(const chunk of response)chunks.push(chunk);
 const files=await unzip(Buffer.concat(chunks));assert.deepEqual(files.get('attachments/00001.pdf'),f.bytes);
 const logs=f.logs().filter(row=>row.reqId===response.headers['x-request-id']);
 assert.equal(logs.filter(row=>row.event==='request.completed').length,1);
 assert.equal(logs.filter(row=>row.event==='request.failed').length,0);
});

test('client cancellation during ZIP download is logged once as aborted',{timeout:10000},async t=>{
 const f=await exportFixture(t);let release,started;
 const reading=new Promise(resolve=>{started=resolve;});
 f.setRead(()=>new Promise(resolve=>{release=()=>resolve({rows:[{bytes:f.bytes}]});started();}));
 const response=await f.open();await reading;response.destroy();
 t.after(()=>release());
 const matching=()=>f.logs().filter(row=>row.reqId===response.headers['x-request-id']);
 for(let attempt=0;attempt<100&&!matching().some(row=>row.event==='request.failed');attempt++)await delay(10);
 release();await delay(20);
 const logs=matching(),failures=logs.filter(row=>row.event==='request.failed');
 assert.equal(failures.length,1);assert.equal(failures[0].outcome,'aborted');assert.equal(failures[0].status,200);
 assert.equal(failures[0].route,'/api/ledgers/:id/export');assert.equal(failures[0].method,'GET');assert.ok(failures[0].durationMs>=0);
 assert.equal(logs.filter(row=>row.event==='request.completed').length,0);
 assert.doesNotMatch(f.raw(),/private-query|private-receipt|Private purchase|bs_session/);
});
test('static publication rejects encoded legacy HTML but keeps current entry points and modules',async t=>{
 const app=await buildApp({pool,origins:[origin]});t.after(()=>app.close());
 for(const url of ['/home.html','/home%2ehtml','/%68ome.html','/create%2Ehtml','/%63reate%2ehtml','/detail%2ehtml','/history%2ehtml','/unpaid%2ehtml','/%5f%5f/firebase/init.js']){
  for(const method of ['GET','HEAD']){const result=await app.inject({method,url});assert.equal(result.statusCode,404,`${method} ${url}`);assert.doesNotMatch(result.body,/rosefire|firebase-app/i);}
 }
 for(const url of ['/','/app.html','/index.html','/app%2ehtml','/scripts/app.mjs','/scripts/dialog-lifecycle.mjs','/scripts/ledger-creation.mjs','/styles/app.css']){
  const result=await app.inject(url);assert.equal(result.statusCode,200,url);assert.equal(result.headers['cache-control'],'no-cache');
 }
});

test('request logs correlate outcomes without recording secrets or financial payloads',async t=>{
 const lines=[],secret='PRIVATE-canary-password-cookie-recovery-amount-note';
 const stream=new Writable({write(chunk,_encoding,done){lines.push(String(chunk));done();}});
 const failingPool={query:async()=>{const error=new Error(secret);error.code='08006';error.detail=secret;throw error;}};
 const app=await buildApp({pool:failingPool,origins:[origin],logger:{stream}});t.after(()=>app.close());
 const headers={cookie:`bs_session=${secret}`,authorization:`Bearer ${secret}`,'x-request-id':secret,origin,'x-bill-splitter':'1','content-type':'application/json'};
 const failed=await app.inject({url:'/api/health?token='+secret,headers});assert.equal(failed.statusCode,500);
 const bad=await app.inject({method:'POST',url:'/api/auth/register',headers,payload:{email:secret,password:secret,recoveryCode:secret,note:secret,amountCents:123456789}});assert.equal(bad.statusCode,500);
 const missing=await app.inject({url:`/missing-${secret}?secret=${secret}`,headers});assert.equal(missing.statusCode,404);
 const privateUrl=await app.inject({url:`/api/invites/${secret}`,headers:{}});assert.equal(privateUrl.statusCode,401);
 const ok=await app.inject('/app.html');assert.equal(ok.statusCode,200);
 const raw=lines.join('');assert.ok(raw);assert.ok(!raw.includes(secret));assert.ok(!raw.includes('123456789'));
 const logs=raw.trim().split('\n').map(line=>JSON.parse(line));
 for(const response of [failed,bad,missing,privateUrl,ok]){
  const id=response.headers['x-request-id'];assert.match(id,/^[0-9a-f-]{36}$/);
  const completed=logs.filter(row=>row.event==='request.completed'&&row.reqId===id);assert.equal(completed.length,1);
  assert.equal(completed[0].status,response.statusCode);assert.ok(completed[0].durationMs>=0);
 }
 const diagnostic=logs.find(row=>row.event==='request.failed'&&row.reqId===failed.headers['x-request-id']);
 assert.equal(diagnostic.route,'/api/health');assert.equal(diagnostic.error.type,'Error');assert.equal(diagnostic.error.code,'08006');
 assert.equal(logs.find(row=>row.reqId===privateUrl.headers['x-request-id']&&row.event==='request.completed').route,'/api/invites/:token');
});
