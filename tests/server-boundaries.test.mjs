import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../server/app.mjs';
import {Writable} from 'node:stream';

const origin='http://localhost';
const pool={query:async()=>({rows:[]})};
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
