import {test} from 'node:test';
import assert from 'node:assert/strict';
import {settlementGroups,repaymentPlan,paymentGroups} from '../public/scripts/settlement-plans.mjs';
import {filterExpenses} from '../public/scripts/expense-search.mjs';
const expense=(id,date,cents,payer='a',debtor='b')=>({id,date,title:id,note:'parking',status:'active',amountCents:cents,payerMemberId:payer,shares:{[debtor]:cents},repaid:{[debtor]:0},version:1});
const entries=[expense('new','2026-11-02',6000),expense('old','2026-11-01',3000),expense('opposite','2026-11-03',2000,'b','a')];
test('repayment applies oldest first without netting opposite debts',()=>{
 assert.equal(settlementGroups(entries).length,2);
 const plan=repaymentPlan(entries,{fromMemberId:'b',toMemberId:'a',amountCents:5001});
 assert.deepEqual(plan.map(p=>[p.expenseId,p.amountCents]),[['old',3000],['new',2001]]);
 assert.throws(()=>repaymentPlan(entries,{fromMemberId:'b',toMemberId:'a',amountCents:9001}));
 assert.throws(()=>repaymentPlan(entries,{fromMemberId:'b',toMemberId:'a',amountCents:0}));
 assert.equal(paymentGroups(plan.map((p,i)=>({...p,id:String(i),batchId:'batch',reversedBy:'reverse'})))[0].amountCents,5001);
});
test('filters combine note, inclusive dates, member role and status',()=>{
 assert.deepEqual(filterExpenses(entries,{query:'PARK',from:'2026-11-02',to:'2026-11-03',memberId:'a',memberRole:'payer',status:'open'}).map(e=>e.id),['new']);
 assert.deepEqual(filterExpenses(entries,{memberId:'a',memberRole:'participant'}).map(e=>e.id),['opposite']);
 assert.equal(filterExpenses([{...entries[0],repaid:{b:6000}}],{status:'settled'}).length,1);
 assert.equal(filterExpenses([{...entries[0],status:'reversed'}],{status:'settled'}).length,0);
 assert.throws(()=>filterExpenses(entries,{from:'2026-11-03',to:'2026-11-02'}));
});
