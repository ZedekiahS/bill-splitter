export function expenseVersion(expense) {
  const {title,date,amountCents,payerMemberId,shares,items=[],note='',receipts=[],status,repaid={}}=expense;
  return structuredClone({title,date,amountCents,payerMemberId,shares,items,note,receipts,status,repaid});
}
export function legacyHistory(id,expense,payments,members) {
  const name=uid=>Object.values(members).find(member=>member.uid===uid)?.name||null;
  const initial=expenseVersion(expense);initial.status='active';initial.repaid=Object.fromEntries(Object.keys(initial.shares).map(key=>[key,0]));
  const events=[{id:`created-${id}`,type:'created',at:expense.createdAt,actorUid:expense.createdByUid,actorName:name(expense.createdByUid),after:initial}];
  for(const [paymentId,payment]of Object.entries(payments||{}))if(payment.expenseId===id)events.push({id:`payment-${paymentId}`,type:payment.type==='reversal'?'payment-reversed':'payment',at:payment.createdAt,actorUid:payment.createdByUid,actorName:name(payment.createdByUid),amountCents:payment.amountCents,fromMemberId:payment.fromMemberId,toMemberId:payment.toMemberId,note:payment.note,paymentId});
  if(expense.status==='reversed')events.push({id:`reversed-${id}`,type:'reversed',at:expense.reversedAt,actorUid:null,actorName:null});
  return events.sort((a,b)=>String(a.at).localeCompare(String(b.at)));
}
export function ensureHistory(state,ledgerId,expenseId) {
  const expense=state.expenses[ledgerId][expenseId];
  expense.history ||= legacyHistory(expenseId,expense,state.payments[ledgerId],state.members[ledgerId]);
  return expense.history;
}
export function appendHistory(state,ledgerId,expenseId,user,at,event) {
  const expense=state.expenses[ledgerId][expenseId];
  ensureHistory(state,ledgerId,expenseId).push({id:crypto.randomUUID(),actorUid:user.uid,actorName:Object.values(state.members[ledgerId]).find(member=>member.uid===user.uid)?.name||user.displayName||null,at,...event});
  expense.version=(expense.version||1)+1;
}
