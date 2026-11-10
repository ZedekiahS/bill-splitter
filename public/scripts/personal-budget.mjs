import {assertCents,validateDate} from './ledger-core.mjs';
import {checkedSum} from './expense-analytics.mjs';

// Removal is a versioned row with amountCents=null, not absence from a response.
export function mergeBudgetVersions(current=[],incoming=[]){
 const rows=new Map(current.map(row=>[JSON.stringify([row.month,row.currency]),row]));
 for(const row of incoming){const key=JSON.stringify([row.month,row.currency]),previous=rows.get(key);if(!previous||row.version>previous.version)rows.set(key,row);}
 return [...rows.values()];
}

export function budgetData(payload){
  const {month,currency,amountCents,expectedVersion}=payload||{};
  if(typeof month!=='string'||!/^\d{4}-\d{2}$/.test(month))throw Error('请选择有效的预算月份。');
  validateDate(month+'-01');
  if(typeof currency!=='string'||!/^[A-Z]{3}$/.test(currency))throw Error('请选择有效的预算币种。');
  if(amountCents!==null)assertCents(amountCents,true);
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0)throw Error('请重新读取预算后再保存。');
  return {month,currency,amountCents,expectedVersion};
}
export function nextBudget(current,payload){
  const data=budgetData(payload);
  if(data.expectedVersion!==(current?.version||0))throw Object.assign(Error('预算已在另一设备更新，请载入最新预算后再保存。'),{statusCode:409,status:409});
  return {month:data.month,currency:data.currency,amountCents:data.amountCents,version:data.expectedVersion+1};
}
export function budgetSummary(data,month,currency){
  budgetData({month,currency,amountCents:null,expectedVersion:0});
  const included=new Set(data.projects.filter(p=>p.included).map(p=>p.id));
  const spentCents=checkedSum(data.rows.filter(r=>included.has(r.ledgerId)&&r.currency===currency&&r.date.startsWith(month+'-')).map(r=>r.amountCents));
  const budget=data.budgets?.find(b=>b.month===month&&b.currency===currency);
  return {budget,spentCents,remainingCents:budget?.amountCents==null?null:budget.amountCents-spentCents};
}
