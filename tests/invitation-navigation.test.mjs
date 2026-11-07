import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {createStateStore} from '../public/scripts/ledger-domain.mjs';
import {paymentSubmission} from '../public/scripts/payment-submission.mjs';
import { parseMoney, formatMoney, remainingFor } from '../public/scripts/ledger-core.mjs';

const source = (await readFile(new URL('../public/scripts/app.mjs', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replace(/start\(\);\s*$/, '');
function fixture(status) {
  const handlers = {}, nodes = new Map(), calls = [];
  const location = new URL('http://localhost/app.html?invite=token');
  const context = vm.createContext({URL, URLSearchParams, location,
    history:{replaceState(_state,_title,url){location.href=String(url);}},
    document:{querySelectorAll(){return [];},querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{handlers:{},addEventListener(type,fn){this.handlers[type]=fn;}});return nodes.get(selector);},addEventListener(type,fn){handlers[type]=fn;}},
    window:{addEventListener(){},scrollTo(){},scrollY:0},registerMessages(){},messages:{},featureMessages:{},accountMessages:{},translatePage(){},t:(s,values={})=>s.replace(/\{(\w+)\}/g,(_,key)=>values[key]??''),
    createDraftStore:()=>({}),calls,parseMoney,formatMoney,remainingFor,paymentSubmission,
  });
  vm.runInContext(source,context);
  vm.runInContext(`state.starting=false;state.claimSubmitted=true;
    state.store={currentUser:{uid:'bob',displayName:'Bob'},getInvite:async()=>({status:'${status}',acceptedUid:'bob',ledgerId:'shared'})};
    state.invitation={status:'open'};
    loadData=async id=>{calls.push(['load',id]);state.snapshot={ledger:{id:id||'shared'}};render();};
    render=()=>calls.push(['ledger']);renderInvitation=()=>calls.push(['invitation']);toast=()=>{};`,context);
  return {calls,context,handlers,nodes,refresh:()=>handlers.click({target:{closest:()=>({dataset:{action:'refresh'}})}})};
}
test('refresh after approval stays in the ledger through language changes',async()=>{
  const f=fixture('accepted');await f.refresh();f.handlers.languagechange();
  assert.equal(vm.runInContext('Boolean(state.inviteAccepted)',f.context),true);
  assert.equal(f.calls.at(-1)[0],'ledger');
  assert.equal(vm.runInContext("params.has('invite')",f.context),false);
});
test('refresh while awaiting approval keeps the invitation context',async()=>{
  const f=fixture('open');await f.refresh();
  assert.equal(f.calls.some(row=>row[0]==='load'),false);
  assert.equal(f.calls.at(-1)[0],'invitation');
});
test('a stale repayment submission refreshes the displayed balance without retrying the payment',async()=>{
  const f=fixture('accepted');
  vm.runInContext(`state.snapshot={ledger:{id:'shared',currency:'CNY'},members:[],expenses:[{id:'dinner',title:'Dinner',status:'active',amountCents:13003,payerMemberId:'bob',shares:{bob:5001,alice:8002},repaid:{alice:0}}]};
    state.store.recordPayment=async()=>{calls.push(['payment']);throw new Error('Amount exceeds outstanding balance');};
    state.store.loadLedger=async()=>({...state.snapshot,expenses:[{...state.snapshot.expenses[0],repaid:{alice:3000}}]});
    openDialog=()=>{};errorSlot=()=>'';submitForm=(event,cb)=>cb(new Map([['amount','80.02'],['date','2026-10-29'],['note','']]));
    paymentDialog('dinner','alice');`,f.context);
  await assert.rejects(f.nodes.get('#payment-form').handlers.submit({}),/exceeds outstanding/);
  assert.equal(f.calls.filter(row=>row[0]==='payment').length,1);
  assert.match(f.nodes.get('#payment-outstanding')?.textContent||'',/50\.02/);
});

function syncFixture(){
  const f=fixture('accepted');
  vm.runInContext(`params.delete('invite');
    state.ledgers=[{id:'shared'}];state.snapshot={ledger:{id:'shared'},expenses:[]};
    state.store.listUpdates=async()=>[{id:'shared',revision:'2'}];
    state.store.listLedgers=async()=>[{id:'shared'}];
    state.store.loadLedger=async()=>{calls.push(['read']);return {ledger:{id:'shared'},expenses:[{id:'new'}]};};`,f.context);
  return f;
}
test('remote changes update the view once and unchanged revisions avoid full ledger reads',async()=>{
  const f=syncFixture();await vm.runInContext('syncChanges()',f.context);await vm.runInContext('syncChanges()',f.context);
  assert.equal(f.calls.filter(row=>row[0]==='read').length,1);assert.equal(f.calls.filter(row=>row[0]==='ledger').length,1);
  assert.equal(vm.runInContext('state.snapshot.expenses[0].id',f.context),'new');
  const empty=syncFixture();
  vm.runInContext("state.snapshot=null;state.ledgers=[];state.startupError=Error('offline');state.store.listUpdates=async()=>[];state.store.listLedgers=async()=>[];",empty.context);
  await vm.runInContext('syncChanges()',empty.context);
  assert.equal(empty.calls.filter(row=>row[0]==='ledger').length,1,'an empty account recovers from a startup outage too');
});
test('a delayed sync response cannot overwrite a newly selected ledger',async()=>{
  const f=syncFixture();let release;f.context.delayed=new Promise(r=>release=r);
  vm.runInContext('state.store.loadLedger=()=>delayed;',f.context);
  const request=vm.runInContext('syncChanges()',f.context);await Promise.resolve();await Promise.resolve();
  vm.runInContext("++dataGeneration;state.snapshot={ledger:{id:'other'}};",f.context);
  release({ledger:{id:'shared'},expenses:[]});await request;
  assert.equal(vm.runInContext('state.snapshot.ledger.id',f.context),'other');assert.equal(f.calls.some(row=>row[0]==='ledger'),false);
});
test('search input and active saves defer synchronization without losing a pending revision',async()=>{
  const f=syncFixture();f.context.document.activeElement={matches:()=>true};await vm.runInContext('syncChanges()',f.context);assert.equal(f.calls.length,0);
  f.context.document.activeElement=null;vm.runInContext('saving=1;',f.context);await vm.runInContext('syncChanges()',f.context);assert.equal(f.calls.length,0);
  vm.runInContext('saving=0;',f.context);await vm.runInContext('syncChanges()',f.context);assert.equal(f.calls.filter(row=>row[0]==='read').length,1);
});
test('sync updates read-only dialog data without rebuilding an editable form',async()=>{
  const f=syncFixture();f.nodes.get('#action-dialog').open=true;
  f.context.historyRows=[{dataset:{historyId:'original'},open:true}];
  f.context.document.querySelectorAll=selector=>f.context.historyRows.filter(row=>!selector.includes('[open]')||row.open);
  vm.runInContext("dialogRefresh=()=>{calls.push(['dialog-hint']);historyRows=[{dataset:{historyId:'original'},open:false},{dataset:{historyId:'new'},open:false}];};",f.context);
  await vm.runInContext('syncChanges()',f.context);assert.equal(f.calls.filter(row=>row[0]==='dialog-hint').length,1);
  assert.equal(f.context.historyRows[0].open,true,'keep the previously expanded history');
  assert.equal(f.context.historyRows[1].open,false,'new history stays collapsed');
});


test('quick outstanding and status selection share one status condition',async()=>{
 const f=fixture('accepted');
 vm.runInContext(`state.filter='all';state.expenseFilters.status='all';updateExpenseResults=()=>{};
   state.snapshot={ledger:{id:'shared'},members:[],expenses:[]};
   sortedExpenses=()=>[{id:'paid',status:'active',payerMemberId:'bob',shares:{alice:100},repaid:{alice:100}}];
   filterExpenses=(rows,filters)=>rows.filter(e=>filters.status==='settled');
   `,f.context);
 await f.handlers.click({target:{closest:()=>({dataset:{filter:'open'}})}});
 vm.runInContext(`state.expenseFilters.status='settled';`,f.context);
 assert.equal(vm.runInContext('filteredExpenses().length',f.context),1);
});


test('changed receipt direction requires acknowledgement and preserves typed payment fields',async()=>{
 const f=fixture('accepted');
 vm.runInContext(`state.snapshot={ledger:{id:'shared',currency:'CNY'},members:[{id:'old',name:'Old payer'},{id:'new',name:'New payer'},{id:'debtor',name:'Debtor'}],expenses:[{id:'bill',title:'Dinner',version:1,status:'active',payerMemberId:'old',shares:{debtor:10000},repaid:{debtor:0}}]};
 state.store.loadLedger=async()=>({...state.snapshot,expenses:[{...state.snapshot.expenses[0],version:2,payerMemberId:'new'}]});
 state.store.recordPayment=async(_id,payload)=>{calls.push(['payment',payload]);if(payload.toMemberId==='old')throw Object.assign(Error('Changed'),{status:409});};
 openDialog=()=>{};errorSlot=()=>'';finishSave=async()=>{};
 submitForm=(event,cb)=>cb(new Map([['amount','50'],['date','2026-11-01'],['note','Keep this note']]));
 paymentDialog('bill','debtor');`,f.context);
 const submit=()=>f.nodes.get('#payment-form').handlers.submit({});
 await assert.rejects(submit(),/Changed/);
 assert.equal(f.nodes.get('#payment-direction').textContent,'Debtor → New payer');
 assert.equal(f.nodes.get('#payment-review-label').hidden,false);
 await assert.rejects(submit(),/收款信息已改变/);
 assert.equal(f.calls.filter(c=>c[0]==='payment').length,1);
 f.nodes.get('#payment-review').checked=true;await submit();
 const payload=f.calls.filter(c=>c[0]==='payment').at(-1)[1];
 assert.equal(payload.toMemberId,'new');assert.equal(payload.expectedVersion,2);assert.equal(payload.amountCents,5000);assert.equal(payload.date,'2026-11-01');assert.equal(payload.note,'Keep this note');
});


test('mobile filter collapse preserves conditions and describes hidden member/date constraints',async()=>{
 const f=fixture('accepted');
 vm.runInContext(`state.snapshot={members:[{id:'ann',name:'Ann'}]};state.expenseFilters={memberId:'ann',memberRole:'participant',from:'2026-11-03',to:'2026-11-04',status:'open'};`,f.context);
 const before=vm.runInContext('JSON.stringify(state.expenseFilters)',f.context);
 const panel=f.context.document.querySelector('#advanced-expense-filters');panel.hidden=false;
 const toggle={dataset:{action:'toggle-expense-filters'},setAttribute(){}};
 await f.handlers.click({target:{closest:()=>toggle}});
 assert.equal(panel.hidden,true);assert.equal(vm.runInContext('JSON.stringify(state.expenseFilters)',f.context),before);
 const summary=vm.runInContext('expenseFilterSummary()',f.context);
 assert.match(summary,/Ann.*参与人.*2026-11-03.*2026-11-04/);
 await f.handlers.click({target:{closest:()=>toggle}});assert.equal(panel.hidden,false);
});

test('payment dialog retries a lost success response without changing the original payment',async()=>{
 const f=fixture('accepted'),user={uid:'bob',displayName:'Bob'};
 const state={ledgers:{},members:{},expenses:{},payments:{},templates:{},occurrences:{},invites:{},claims:{}};
 const engine=createStateStore({user,read:()=>state,mutate:fn=>fn(state,user,'2026-11-07T12:00:00Z')});
 const ledger=await engine.createLedger({title:'Retry',currency:'CNY'}),debtor=await engine.addMember(ledger,'Alice');
 const expense=await engine.addExpense(ledger,{title:'Dinner',date:'2026-11-07',payerMemberId:'owner',amountCents:10000,shares:{[debtor]:10000}});
 const {createApiStore}=await import(`../public/scripts/api-store.mjs?retry=${crypto.randomUUID()}`),originalFetch=globalThis.fetch;
 const cache=new Map(),writes=[];let dropped=2;
 globalThis.fetch=async(_path,options)=>{
   if(options.method==='GET')return {ok:true,status:200,json:async()=>engine.loadLedger(ledger)};
   const body=JSON.parse(options.body),key=options.headers['Idempotency-Key'];writes.push({key,body});
   if(!cache.has(key))cache.set(key,await engine[body.type](ledger,...body.args));
   if(dropped-->0)throw new TypeError('response lost after commit');
   return {ok:true,status:200,json:async()=>({result:cache.get(key)})};
 };
 try{
   Object.assign(f.context,{apiStore:createApiStore(user),snapshot:await engine.loadLedger(ledger),expense,debtor});
   vm.runInContext(`state.store=apiStore;state.snapshot=snapshot;openDialog=()=>{};errorSlot=()=>'';finishSave=async()=>{};
     submitForm=(event,cb)=>cb(new Map([['amount','50'],['date','2026-11-07'],['note','One actual transfer']]));paymentDialog(expense,debtor);`,f.context);
   const submit=()=>f.nodes.get('#payment-form').handlers.submit({});
   for(let i=0;i<2;i++){await assert.rejects(submit(),/核实/);f.nodes.get('#payment-review').checked=true;}
   await submit();
   const final=await engine.loadLedger(ledger);
   assert.equal(final.payments.length,1,'one real payment must produce one journal entry');
   assert.equal(remainingFor(final.expenses[0],debtor),5000);
   assert.equal(new Set(writes.map(w=>w.key)).size,1);
   assert.deepEqual(writes[0].body,writes[2].body);
 }finally{globalThis.fetch=originalFetch;}
});
