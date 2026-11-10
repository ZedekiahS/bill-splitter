import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStateStore} from '../public/scripts/ledger-domain.mjs';
import {consumptionShares,expenseDebts,memberBalances,netExpenseAmount,remainingBetween} from '../public/scripts/ledger-core.mjs';
import {refundCapacity,allocateRefund} from '../public/scripts/expense-refunds.mjs';
import {consumptionRows} from '../public/scripts/expense-analytics.mjs';
import {repaymentPlan} from '../public/scripts/settlement-plans.mjs';
import {ledgerExport} from '../public/scripts/ledger-export.mjs';
import {restoreState} from '../server/ledger-import.mjs';

async function fixture(payload={}){
 let state={ledgers:{},members:{},expenses:{},payments:{},templates:{},occurrences:{},invites:{},claims:{}};
 const user=uid=>({uid,displayName:uid}),store=uid=>createStateStore({user:user(uid),read:()=>state,mutate:fn=>{const copy=structuredClone(state);const result=fn(copy,user(uid),'2026-11-10T12:00:00Z');state=copy;return result;}});
 const a=store('a'),b=store('b'),c=store('c'),ledger=await a.createLedger({title:'酒店',currency:'CNY'});
 const bid=await a.addMember(ledger,'B'),cid=await a.addMember(ledger,'C');state.members[ledger][bid].uid='b';state.members[ledger][cid].uid='c';state.ledgers[ledger].memberUids.push('b','c');
 const id=await a.addExpense(ledger,{title:'酒店',date:'2026-10-01',amountCents:90000,payerMemberId:'owner',shares:{owner:30000,[bid]:30000,[cid]:30000},category:'lodging',...payload});
 const snapshot=()=>a.loadLedger(ledger),expense=async()=>(await snapshot()).expenses[0];
 const pay=async(from,to,amount,who=a)=>{const e=await expense();return who.recordPayment(ledger,{expenseId:id,fromMemberId:from,toMemberId:to,amountCents:amount,expectedVersion:e.version,expectedRemaining:remainingBetween(e,from,to),date:'2026-11-10'});};
 const refund=async(amount,benefits,extras={})=>{const e=await expense();return a.recordRefund(ledger,{expenseId:id,toMemberId:'owner',amountCents:amount,date:'2026-11-10',note:'商家退款',expectedVersion:e.version,benefits:benefits||allocateRefund(amount,refundCapacity(e).capacities),...extras});};
 return {a,b,c,bid,cid,ledger,id,snapshot,expense,pay,refund};
}
test('settled hotel refund keeps payments and creates return obligations; recipients confirm returns',async()=>{
 const f=await fixture();await f.pay(f.bid,'owner',30000);await f.pay(f.cid,'owner',30000);
 await f.refund(30000);let e=await f.expense();
 assert.equal(netExpenseAmount(e),60000);assert.deepEqual(Object.values(consumptionShares(e)),[20000,20000,20000]);
 assert.deepEqual(expenseDebts(e),[{fromMemberId:'owner',toMemberId:f.bid,amountCents:10000},{fromMemberId:'owner',toMemberId:f.cid,amountCents:10000}]);
 assert.equal((await f.snapshot()).payments.length,2);
 await assert.rejects(f.pay('owner',f.bid,10000,f.c),/只有收款人/);
 await f.pay('owner',f.bid,10000,f.b);await f.pay('owner',f.cid,10000,f.c);
 assert.deepEqual(expenseDebts(await f.expense()),[]);
 assert.deepEqual(memberBalances(await f.snapshot()).map(r=>r.balanceCents),[0,0,0]);
 assert.equal((await f.snapshot()).payments.length,4);
});
test('partial repayments, multiple refunds and further return transfers reconcile to zero',async()=>{
 const f=await fixture();await f.pay(f.bid,'owner',15000);await f.pay(f.cid,'owner',30000);
 await f.refund(30000);let e=await f.expense();assert.equal(remainingBetween(e,f.bid,'owner'),5000);assert.equal(remainingBetween(e,'owner',f.cid),10000);
 await f.pay('owner',f.cid,10000,f.c);await f.refund(15000);e=await f.expense();
 assert.equal(remainingBetween(e,f.bid,'owner'),0);assert.equal(remainingBetween(e,'owner',f.cid),5000);
 await f.pay('owner',f.cid,5000,f.c);await f.refund(45000);e=await f.expense();assert.equal(netExpenseAmount(e),0);
 await f.pay('owner',f.bid,15000,f.b);await f.pay('owner',f.cid,15000,f.c);
 assert.deepEqual(memberBalances(await f.snapshot()).map(r=>r.balanceCents),[0,0,0]);assert.deepEqual(expenseDebts(await f.expense()),[]);
 await assert.rejects(f.refund(1),/剩余可退/);
});
test('refund validation rejects excess, stale, unauthorized and reversed writes atomically',async()=>{
 const f=await fixture(),e=await f.expense(),p={expenseId:f.id,toMemberId:'owner',expectedVersion:e.version,amountCents:1000,date:'2026-11-10',note:'',benefits:{[f.bid]:1000}};
 await assert.rejects(f.b.recordRefund(f.ledger,p),/只有收款人/);
 for(const bad of [{amountCents:0},{benefits:{[f.bid]:30001},amountCents:30001},{benefits:{x:1000}},{benefits:{[f.bid]:999}},{date:'2026-09-01'},{toMemberId:f.bid}])await assert.rejects(f.a.recordRefund(f.ledger,{...p,...bad}));
 assert.equal((await f.expense()).version,e.version);
 await f.a.recordRefund(f.ledger,p);await assert.rejects(f.a.recordRefund(f.ledger,p),error=>error.statusCode===409);
 await assert.rejects(f.a.reverseExpense(f.ledger,f.id),/退款/);
 const current=await f.expense();await f.a.updateExpense(f.ledger,f.id,{...current,note:'receipt note',expectedVersion:current.version,changeReason:'补充'});
 assert.equal((await f.expense()).refunds.length,1);assert.equal(netExpenseAmount(await f.expense()),89000);
 await assert.rejects(f.a.updateExpense(f.ledger,f.id,{...await f.expense(),amountCents:100000,expectedVersion:(await f.expense()).version,changeReason:'change'}),/退款/);
 await f.a.setLedgerStatus(f.ledger,'archived');await assert.rejects(f.refund(100),/归档/);
});
test('refund reversal preserves actual transfers and restores the correct direction',async()=>{
 const f=await fixture();await f.pay(f.bid,'owner',30000);const rid=await f.refund(30000);
 const pid=await f.pay('owner',f.bid,10000,f.b),e=await f.expense();
 await f.a.reverseRefund(f.ledger,f.id,{refundId:rid,expectedVersion:e.version,reason:'录错退款'});
 assert.equal(remainingBetween(await f.expense(),f.bid,'owner'),10000);
 await f.b.reversePayment(f.ledger,pid);assert.equal(remainingBetween(await f.expense(),f.bid,'owner'),0);
 assert.equal((await f.expense()).history.at(-2).type,'refund-reversed');
});
test('item-specific refund only changes its beneficiaries and category on the original date',async()=>{
 const f=await fixture();let e=await f.expense();
 await f.a.updateExpense(f.ledger,f.id,{...e,amountCents:15000,shares:{owner:3000,[f.bid]:9000,[f.cid]:3000},items:[{title:'晚餐',amountCents:9000,memberIds:['owner',f.bid,f.cid],category:'food'},{title:'耳机',amountCents:6000,memberIds:[f.bid],category:'shopping'}],expectedVersion:e.version,changeReason:'修正内容'});
 await f.refund(6000,{[f.bid]:6000},{itemIndex:1});const s=await f.snapshot();
 assert.deepEqual(consumptionShares(s.expenses[0]),{owner:3000,[f.bid]:3000,[f.cid]:3000});
 assert.deepEqual(consumptionRows(s,{uid:'b',personal:true}).map(r=>[r.category,r.amountCents,r.date]),[['food',3000,'2026-10-01']]);
 await assert.rejects(f.refund(1,{[f.bid]:1},{itemIndex:1}),/超出/);
});
test('integer refunds conserve cents and batch plans include reverse-direction debts',async()=>{
 assert.deepEqual(allocateRefund(2,{a:1,b:1,c:1}),{a:1,b:1,c:0});
 const f=await fixture();await f.pay(f.bid,'owner',30000);await f.refund(30000);
 const s=await f.snapshot(),payload={fromMemberId:'owner',toMemberId:f.bid,amountCents:4000,date:'2026-11-10'};payload.allocations=repaymentPlan(s.expenses,payload);
 const batch=await f.b.recordPaymentBatch(f.ledger,payload);assert.equal(remainingBetween(await f.expense(),'owner',f.bid),6000);
 await f.b.reversePaymentBatch(f.ledger,batch);assert.equal(remainingBetween(await f.expense(),'owner',f.bid),10000);
});
test('refunds and reverse-direction payments survive complete export and restore',async()=>{
 const f=await fixture();await f.pay(f.bid,'owner',30000);await f.refund(30000);await f.pay('owner',f.bid,4000,f.b);
 const s=await f.snapshot(),exported=ledgerExport(s),restored=restoreState({data:exported.data,files:new Map()},{uid:'restorer',displayName:'R'},{memberId:'owner'});
 const store=createStateStore({user:{uid:'restorer'},read:()=>restored.state,mutate:()=>{}}),copy=await store.loadLedger(restored.id);
 assert.deepEqual(memberBalances(copy).map(r=>r.balanceCents),memberBalances(s).map(r=>r.balanceCents));
 assert.equal(netExpenseAmount(copy.expenses[0]),60000);assert.equal(copy.expenses[0].refunds.length,1);
 assert.ok(exported.tables['refunds.csv'].includes('商家退款'));assert.equal(copy.expenses[0].history.filter(h=>h.type==='refund').length,1);
});

test('restore rejects inconsistent refund allocations, cumulative over-refunds and unmatched returns',async()=>{
 const f=await fixture();await f.refund(90000);const data=ledgerExport(await f.snapshot()).data;
 const restore=source=>restoreState({data:source,files:new Map()},{uid:'restorer',displayName:'R'},{memberId:'owner'});
 assert.doesNotThrow(()=>restore(structuredClone(data)));
 for(const corrupt of [
  e=>e.refunds[0].benefits[f.bid]++,
  e=>e.refunds[0].allocations[0].amountCents++,
  e=>e.refunds.push({...structuredClone(e.refunds[0]),id:'duplicate-refund'}),
  e=>e.returned={[f.bid]:100},
  e=>e.refunds[0].toMemberId=f.bid,
 ]){const copy=structuredClone(data);corrupt(copy.expenses[0]);assert.throws(()=>restore(copy));}
});
