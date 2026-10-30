import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseMoney, formatMoney, remainingFor } from '../public/scripts/ledger-core.mjs';

const source = (await readFile(new URL('../public/scripts/app.mjs', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replace(/start\(\);\s*$/, '');
function fixture(status) {
  const handlers = {}, nodes = new Map(), calls = [];
  const location = new URL('http://localhost/app.html?invite=token');
  const context = vm.createContext({URL, URLSearchParams, location,
    history:{replaceState(_state,_title,url){location.href=String(url);}},
    document:{querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{handlers:{},addEventListener(type,fn){this.handlers[type]=fn;}});return nodes.get(selector);},addEventListener(type,fn){handlers[type]=fn;}},
    window:{addEventListener(){}},registerMessages(){},messages:{},featureMessages:{},accountMessages:{},translatePage(){},t:(s,values={})=>s.replace(/\{(\w+)\}/g,(_,key)=>values[key]??''),
    calls,parseMoney,formatMoney,remainingFor,
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
