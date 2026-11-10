import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {openRefundEditor} from '../public/scripts/refund-entry.mjs';
import {createStateStore} from '../public/scripts/ledger-domain.mjs';
const originals=Object.fromEntries(['document','Event','FormData'].map(k=>[k,globalThis[k]]));let dom;
afterEach(()=>{dom?.window.close();for(const [k,v]of Object.entries(originals))if(v===undefined)delete globalThis[k];else globalThis[k]=v;});
const tick=()=>new Promise(r=>setTimeout(r,15));
async function fixture(){
 const user={uid:crypto.randomUUID(),displayName:'Owner'},state={ledgers:{},members:{},expenses:{},payments:{},templates:{},occurrences:{},invites:{},claims:{}},store=createStateStore({user,read:()=>state,mutate:fn=>fn(state,user,'2026-11-10T12:00:00Z')});
 const lid=await store.createLedger({title:'Travel',currency:'CNY'}),bid=await store.addMember(lid,'Bob'),eid=await store.addExpense(lid,{title:'Hotel',amountCents:10000,payerMemberId:'owner',shares:{owner:5000,[bid]:5000},date:'2026-11-01'});
 store.currentUser=user;const errors=[],saved=[];let action=store;
 async function open(){dom?.window.close();dom=new JSDOM('<main></main>',{url:'http://localhost'});for(const k of Object.keys(originals))globalThis[k]=dom.window[k];openRefundEditor({store:action,snapshot:await store.loadLedger(lid),expenseId:eid,today:'2026-11-10',openDialog:(_,html)=>document.querySelector('main').innerHTML=html,submitForm:async(e,cb)=>{e.preventDefault();const b=e.target.querySelector('[type="submit"]');b.disabled=true;try{await cb();}catch(error){errors.push(error);}finally{b.disabled=false;}},onSaved:msg=>saved.push(msg)});}
 const $=s=>document.querySelector(s),input=(s,v)=>{const el=$(s);el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));},click=async s=>{$(s).click();await tick();};
 return {store,lid,bid,eid,open,$,input,click,errors,saved,setAction:value=>action=value};
}
test('refund editor renders members and saves the displayed proportional allocation',async()=>{
 const f=await fixture();await f.open();assert.equal(document.querySelectorAll('[data-refund-member]').length,2);assert.equal(f.$('[type="submit"]').disabled,true);
 f.input('[name="amount"]','20');assert.equal(f.$('[data-refund-member="owner"]').value,'10.00');assert.match(f.$('#refund-preview').textContent,/80.00/);
 await f.click('[type="submit"]');assert.equal(f.errors.length,0);assert.equal(f.saved.length,1);assert.equal((await f.store.loadLedger(f.lid)).expenses[0].refunds[0].amountCents,2000);
});
test('refund editor preserves input after conflict and refreshes recipient before allowing resubmit',async()=>{
 const f=await fixture();await f.open();f.input('[name="amount"]','20');const e=(await f.store.loadLedger(f.lid)).expenses[0];
 await f.store.updateExpense(f.lid,f.eid,{...e,title:'Updated hotel',payerMemberId:f.bid,expectedVersion:e.version,changeReason:'wrong payer'});
 await f.click('[type="submit"]');assert.equal(f.errors.at(-1).statusCode,409);assert.equal(f.$('[type="submit"]').disabled,true);
 await f.click('#refund-review');assert.equal(f.$('#refund-recipient').textContent,'Bob');assert.equal(f.$('#refund-expense-title').textContent,'Updated hotel');assert.equal(f.$('[name="amount"]').value,'20.00');
 await f.click('[type="submit"]');assert.equal((await f.store.loadLedger(f.lid)).expenses[0].refunds[0].toMemberId,f.bid);
});
test('unknown refund outcome survives reopen and retries the original amount and key once',async()=>{
 const f=await fixture(),calls=[];let lose=true;
 f.setAction({...f.store,mode:'api',saveDraftCommand:async(lid,command,args,key)=>{calls.push({key,args:structuredClone(args)});if(lose){lose=false;await f.store.recordRefund(lid,args[0]);throw new TypeError('network lost');}return 'saved';}});
 await f.open();f.input('[name="amount"]','20');await f.click('[type="submit"]');assert.equal(f.$('[name="amount"]').readOnly,true);assert.equal(f.saved.length,0);
 await f.open();assert.equal(f.$('[name="amount"]').value,'20.00');assert.equal(f.$('[name="amount"]').readOnly,true);await f.click('[type="submit"]');
 assert.deepEqual(calls[0],calls[1]);assert.equal(f.saved.length,1);assert.equal((await f.store.loadLedger(f.lid)).expenses[0].refunds.length,1);
});

test('refund submission immediately locks fields and restores every displayed pending value',async()=>{
 const f=await fixture();let reject;const calls=[];
 f.setAction({...f.store,mode:'api',saveDraftCommand:async(lid,command,args,key)=>{calls.push({key,args:structuredClone(args)});if(calls.length===1){await f.store.recordRefund(lid,args[0]);return new Promise((_,no)=>reject=no);}return 'saved';}});
 await f.open();f.input('[name="amount"]','20');f.input('[name="note"]','Original note');await f.click('[type="submit"]');
 assert.equal(f.$('[name="amount"]').readOnly,true,'pending request must protect amount immediately');
 assert.equal(f.$('[name="item"]').disabled,true);assert.equal(f.$('[type="submit"]').disabled,true);
 // Even delayed input events/programmatic autofill must not change what is verified.
 f.input('[name="amount"]','30');f.input('[name="date"]','2026-11-09');f.input('[name="note"]','Changed');f.input('[data-refund-member="owner"]','30');
 reject(new TypeError('response lost'));await tick();
 assert.equal(f.$('[name="amount"]').value,'20.00');assert.equal(f.$('[name="date"]').value,'2026-11-10');assert.equal(f.$('[name="note"]').value,'Original note');assert.equal(f.$('[data-refund-member="owner"]').value,'10.00');
 await f.click('[type="submit"]');assert.deepEqual(calls[0],calls[1]);assert.equal((await f.store.loadLedger(f.lid)).expenses[0].refunds.length,1);
});
