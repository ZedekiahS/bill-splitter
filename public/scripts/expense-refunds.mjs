import {assertCents,validateDate,expensePieces} from './ledger-core.mjs';

// Integer proportional allocation, bounded by each remaining consumption share.
export function allocateRefund(amountCents,capacities){
  assertCents(amountCents);
  const entries=Object.entries(capacities).filter(([,v])=>v>0),total=entries.reduce((n,[,v])=>n+BigInt(assertCents(v,true)),0n),amount=BigInt(amountCents);
  if(amount>total)throw new Error('退款金额不能超过剩余可退金额。');
  const rows=entries.map(([id,v],i)=>({id,i,cents:amount*BigInt(v)/total,remainder:amount*BigInt(v)%total}));
  let extra=amount-rows.reduce((n,r)=>n+r.cents,0n);
  for(const row of [...rows].sort((a,b)=>a.remainder===b.remainder?a.i-b.i:a.remainder>b.remainder?-1:1)){if(extra===0n)break;row.cents++;extra--;}
  return Object.fromEntries(rows.map(r=>[r.id,Number(r.cents)]));
}
export function refundCapacity(expense,itemIndex=null){
  if(itemIndex!==null&&(!Number.isInteger(itemIndex)||!expense.items?.[itemIndex]))throw new Error('请选择有效的退款项目。');
  const pieces=expensePieces(expense).filter(p=>itemIndex===null||p.itemIndex===itemIndex),capacities={};
  for(const p of pieces)for(const [id,v]of Object.entries(p.shares))capacities[id]=(capacities[id]||0)+v;
  return {pieces,capacities};
}
export function refundData(expense,payload){
  if(expense.status!=='active')throw new Error('这笔费用已撤销。');
  if(payload.toMemberId!==expense.payerMemberId)throw new Error('请确认退款已退给原垫付人。');
  const date=validateDate(payload.date);if(date<expense.date)throw new Error('退款日期不能早于消费日期。');
  const amountCents=assertCents(payload.amountCents),itemIndex=payload.itemIndex??null,{pieces,capacities}=refundCapacity(expense,itemIndex);
  const benefits=payload.benefits;
  if(!benefits||typeof benefits!=='object'||Array.isArray(benefits))throw new Error('请填写退款分配。');
  let total=0n;const allocations=[];
  for(const [memberId,value]of Object.entries(benefits)){
    const cents=assertCents(value,true);if(!Object.hasOwn(capacities,memberId)||cents>capacities[memberId])throw new Error('退款分配超出原消费份额。');
    total+=BigInt(cents);if(!cents)continue;
    const part=allocateRefund(cents,Object.fromEntries(pieces.map((p,i)=>[i,p.shares[memberId]||0])));
    for(const [index,v]of Object.entries(part))if(v)allocations.push({itemIndex:pieces[Number(index)].itemIndex,memberId,amountCents:v});
  }
  if(total!==BigInt(amountCents))throw new Error('退款分配合计必须等于退款金额。');
  if(typeof payload.note!=='string'||payload.note.length>300)throw new Error('退款备注不能超过 300 个字。');
  return {amountCents,date,toMemberId:expense.payerMemberId,itemIndex,benefits:{...benefits},allocations,note:payload.note.trim(),status:'active'};
}
