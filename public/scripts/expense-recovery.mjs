import {consumptionShares,parseMoney,splitShares} from './ledger-core.mjs';
import {itemizedShares} from './expense-features.mjs';

const amountText=cents=>(cents/100).toFixed(2);
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export function expenseForm(expense){
  const shares=consumptionShares(expense);
  return {fields:{category:expense.category||'uncategorized',title:expense.title,date:expense.date,note:expense.note||'',amount:amountText(expense.amountCents),payer:expense.payerMemberId,changeReason:''},
    splitType:expense.items?.length?'items':'amount',percentEdited:[],amountDraftInitialized:true,
    participants:Object.keys(shares),'data-share-amount':Object.fromEntries(Object.entries(shares).map(([id,cents])=>[id,amountText(cents)])),'data-percent':{},
    items:(expense.items||[]).map(row=>({title:row.title,amount:amountText(row.amountCents),memberIds:[...row.memberIds],category:row.category||''})),receipts:expense.receipts||[]};
}
function financial(form){
  const fields=form.fields;
  try{
    const result=form.splitType==='items'?itemizedShares(form.items.map(row=>({title:row.title,amountCents:parseMoney(row.amount),memberIds:row.memberIds,category:row.category||undefined}))):
      {amountCents:parseMoney(fields.amount),shares:splitShares(parseMoney(fields.amount),form.participants,{type:form.splitType,percentages:form['data-percent'],amounts:form['data-share-amount']}),items:[]};
    return {amountCents:result.amountCents,payerMemberId:fields.payer,shares:consumptionShares({...result,payerMemberId:fields.payer}),items:result.items};
  }catch{return {raw:{amount:fields.amount,payer:fields.payer,splitType:form.splitType,participants:form.participants,items:form.items,amounts:form['data-share-amount'],percentages:form['data-percent']}};}
}
function value(form,key){
  if(key==='financial')return financial(form);
  if(key==='receipts')return form.receipts.map(row=>row.id||row.dataUrl);
  return form.fields[key]||(key==='category'?'uncategorized':'');
}
export function reconcileExpenseDraft(record,latest){
  const base=expenseForm(record.options.initial),mine=record.form,current=expenseForm(latest);
  const locked=Object.values(latest.repaid||{}).some(amount=>amount>0);
  const amountsOnly=form=>{const result=financial(form);if(result.items)result.items=result.items.map(({category,...item})=>item);return stable(result);};
  return ['title','date','financial','category','note','receipts'].map(key=>{
    const before=stable(value(base,key)),own=stable(value(mine,key)),remote=stable(value(current,key));
    const changed=own!==before,remoteChanged=remote!==before,restricted=key==='financial'&&locked&&amountsOnly(mine)!==amountsOnly(current);
    return {key,mine,current,changed,remoteChanged,restricted,conflict:changed&&remoteChanged&&own!==remote||restricted,
      choice:changed&&!restricted?'mine':'current'};
  });
}
export function resolveExpenseDraft(record,latest,groups,choices={}){
  const form=structuredClone(record.form);
  for(const group of groups){
    const choice=choices[group.key]||group.choice;
    if(group.restricted&&choice==='mine')throw new Error('已收款的账单不能修改金额或分摊。');
    const source=group[choice];
    if(!source)throw new Error('请选择要保留的内容。');
    if(group.key==='financial'){
      for(const key of ['splitType','percentEdited','amountDraftInitialized','participants','items','data-percent','data-share-amount'])form[key]=structuredClone(source[key]);
      form.fields.amount=source.fields.amount;form.fields.payer=source.fields.payer;
    }else if(group.key==='receipts')form.receipts=structuredClone(source.receipts);
    else form.fields[group.key]=source.fields[group.key];
  }
  return {...record,attempt:null,form,title:form.fields.title,options:{...record.options,initial:structuredClone(latest)}};
}
