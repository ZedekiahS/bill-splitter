import {assertCents,expenseDebts} from './ledger-core.mjs';

function sum(values){const result=values.reduce((n,value)=>n+BigInt(value),0n);if(result>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('账本合计超出支持范围。');return Number(result);}
export function settlementGroups(expenses){
  const groups=new Map();
  for(const expense of expenses){
    if(expense.status!=='active')continue;
    for(const {fromMemberId,toMemberId,amountCents:remainingCents} of expenseDebts(expense)){
      const key=JSON.stringify([fromMemberId,toMemberId]);
      if(!groups.has(key))groups.set(key,{fromMemberId,toMemberId,expenses:[]});
      groups.get(key).expenses.push({...expense,remainingCents});
    }
  }
  return [...groups.values()].map(group=>({...group,totalCents:sum(group.expenses.map(e=>e.remainingCents)),expenses:group.expenses.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))}));
}
export function repaymentPlan(expenses,{fromMemberId,toMemberId,amountCents}){
  assertCents(amountCents);
  const group=settlementGroups(expenses).find(row=>row.fromMemberId===fromMemberId&&row.toMemberId===toMemberId);
  if(!group||amountCents>group.totalCents)throw new Error('还款金额不能超过这两位成员的待结金额。');
  let remaining=amountCents;
  return group.expenses.flatMap(expense=>{
    if(!remaining)return [];
    const amountCents=Math.min(remaining,expense.remainingCents);remaining-=amountCents;
    return [{expenseId:expense.id,amountCents,expectedVersion:expense.version||1,expectedRemaining:expense.remainingCents}];
  });
}
export function paymentGroups(payments){
  const groups=new Map();
  for(const payment of payments){
    const key=payment.batchId||payment.id;
    if(!groups.has(key))groups.set(key,{...payment,id:key,entries:[]});
    groups.get(key).entries.push(payment);
  }
  return [...groups.values()].map(row=>({...row,amountCents:sum(row.entries.map(p=>p.amountCents)),reversedBy:row.entries.every(p=>p.reversedBy)?row.entries[0].reversedBy:null}));
}
