import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});
const fresh=()=>import(`../public/scripts/api-store.mjs?case=${crypto.randomUUID()}`);
const reply=(status,body)=>({ok:status>=200&&status<300,status,json:async()=>body});

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
