import {t} from './i18n.mjs';
import {parseMoney,formatMoney,expenseDebts,netExpenseAmount} from './ledger-core.mjs';
import {refundCapacity,allocateRefund,refundData} from './expense-refunds.mjs';
import {paymentSubmission} from './payment-submission.mjs';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const decimal=cents=>`${Math.floor(cents/100)}.${String(cents%100).padStart(2,'0')}`;

export function openRefundEditor({store,snapshot,expenseId,openDialog,submitForm,onSaved,today}){
 const ledgerId=snapshot.ledger.id,money=n=>formatMoney(n,snapshot.ledger.currency),name=id=>snapshot.members.find(m=>m.id===id)?.name||t('成员');
 let expense=structuredClone(snapshot.expenses.find(e=>e.id===expenseId)),manual=false,needsReview=false,busy=false;
 const submission=paymentSubmission(store,ledgerId,expenseId,'refund','recordRefund'),pending=submission.pending?.payload;
 openDialog(t(pending?'核实上次退款':'记录退款'),`<form id="refund-form"><p><span id="refund-expense-title">${escape(expense.title)}</span> · ${t('退款收款人')} <strong id="refund-recipient">${escape(name(expense.payerMemberId))}</strong></p><p class="form-hint">${t('仅记录商家已退给原垫付人的款项。')}</p><div class="form-grid"><label class="form-field"><span class="field-label">${t('退款金额')}</span><input class="form-input amount-input" name="amount" inputmode="decimal" required autofocus></label><label class="form-field"><span class="field-label">${t('退款到账日期')}</span><input class="form-input" name="date" type="date" value="${escape(today)}" required></label></div><button class="text-link" type="button" id="refund-all">${t('退回剩余全部金额')}</button><label class="form-field"><span class="field-label">${t('退款对应消费')}</span><select class="form-select" name="item"><option value="">${t('整笔账单')}</option>${(expense.items||[]).map((item,i)=>`<option value="${i}">${escape(item.title)}</option>`).join('')}</select></label><div class="section-heading"><h3>${t('减少谁的消费')}</h3><button class="text-link" type="button" id="refund-proportional">${t('按剩余份额分配')}</button></div><div id="refund-benefits"></div><label class="form-field"><span class="field-label">${t('退款备注（选填）')}</span><input class="form-input" name="note" maxlength="300"></label><div id="refund-preview" aria-live="polite"></div><p id="form-error" class="form-error" role="alert" hidden></p><button class="button secondary" id="refund-review" type="button" hidden>${t('重新核对')}</button><div class="form-actions"><button class="button secondary" type="button" data-action="close-dialog">${t('取消')}</button><button class="button primary" type="submit">${t('保存退款')}</button></div></form>`);
 const form=document.querySelector('#refund-form'),fields=form.querySelector('#refund-benefits'),preview=form.querySelector('#refund-preview'),button=form.querySelector('[type="submit"]'),review=form.querySelector('#refund-review');
 const scope=()=>form.elements.namedItem('item').value===''?null:Number(form.elements.namedItem('item').value);
 const inputs=()=>Object.fromEntries([...fields.querySelectorAll('[data-refund-member]')].map(input=>[input.dataset.refundMember,parseMoney(input.value||'0',{allowZero:true})]));
 const payload=()=>({expenseId,expectedVersion:expense.version||1,toMemberId:expense.payerMemberId,date:form.elements.date.value,amountCents:parseMoney(form.elements.amount.value),itemIndex:scope(),benefits:inputs(),note:form.elements.note.value});
 function renderFields(values={}){
  const {capacities}=refundCapacity(expense,scope());
  fields.innerHTML=Object.entries(capacities).map(([id,capacity])=>`<label class="refund-benefit"><span><strong>${escape(name(id))}</strong><small>${t('剩余可退 {amount}',{amount:money(capacity)})}</small></span><input class="form-input" inputmode="decimal" data-refund-member="${escape(id)}" value="${decimal(values[id]||0)}" aria-label="${escape(t('{name}的退款份额',{name:name(id)}))}"></label>`).join('');
  fields.querySelectorAll('input').forEach(input=>input.addEventListener('input',()=>{manual=true;update();}));
 }
 function distribute(){
  try{const values=allocateRefund(parseMoney(form.elements.amount.value),refundCapacity(expense,scope()).capacities);renderFields(values);}catch{renderFields();}
 }
 function update(){
  if(submission.pending){button.disabled=busy;button.textContent=t(busy?'正在保存…':'核实上次退款');button.dataset.label=t('核实上次退款');preview.textContent=busy?'':t('退款保存结果待核实，请核实后再记录下一笔。');return;}
  button.disabled=true;
  try{
   const record=refundData(expense,payload()),next={...expense,refunds:[...(expense.refunds||[]),record]},debts=expenseDebts(next);
   preview.innerHTML=`<div class="preview-total"><span>${t('退款后净消费')}</span><strong>${money(netExpenseAmount(next))}</strong></div><h3>${t('退款后的待结往来')}</h3>${debts.length?debts.map(d=>`<div class="preview-row"><span>${escape(name(d.fromMemberId))} → ${escape(name(d.toMemberId))}</span><strong>${money(d.amountCents)}</strong></div>`).join(''):`<p>${t('没有待结往来')}</p>`}<p class="form-hint">${t('消费统计归入原消费日期；已发生的还款保留。')}</p>`;
   button.disabled=needsReview;
  }catch(error){preview.textContent=form.elements.amount.value?t(error.message):t('填写退款金额后，核对每个人的份额。');}
 }
 function lockPending(){
  const original=submission.pending?.payload,pending=Boolean(original);
  if(original){form.elements.amount.value=decimal(original.amountCents);form.elements.date.value=original.date;form.elements.namedItem('item').value=original.itemIndex??'';form.elements.note.value=original.note;renderFields(original.benefits);form.querySelector('#refund-recipient').textContent=name(original.toMemberId);}
  for(const input of form.querySelectorAll('input'))input.readOnly=pending;
  form.elements.namedItem('item').disabled=pending;form.querySelector('#refund-all').disabled=pending;form.querySelector('#refund-proportional').disabled=pending;
  if(pending)review.hidden=true;else {button.textContent=t('保存退款');button.dataset.label=button.textContent;}
  update();
 }
 renderFields();
 if(pending){form.elements.amount.value=decimal(pending.amountCents);form.elements.date.value=pending.date;form.elements.namedItem('item').value=pending.itemIndex??'';form.elements.note.value=pending.note;renderFields(pending.benefits);lockPending();}
 form.elements.amount.addEventListener('input',()=>{if(!manual)distribute();update();});
 form.elements.namedItem('item').addEventListener('change',()=>{manual=false;distribute();update();});
 form.elements.date.addEventListener('input',update);
 form.querySelector('#refund-all').onclick=()=>{form.elements.amount.value=decimal(Object.values(refundCapacity(expense,scope()).capacities).reduce((n,v)=>n+v,0));manual=false;distribute();update();};
 form.querySelector('#refund-proportional').onclick=()=>{manual=false;distribute();update();};
 review.onclick=async()=>{
  review.disabled=true;try{const fresh=await store.loadLedger(ledgerId),next=fresh.expenses.find(e=>e.id===expenseId),values=inputs();if(!next||next.status!=='active')throw Error('这笔费用已撤销。');const oldItems=JSON.stringify(expense.items||[]);expense=next;snapshot=fresh;
   form.querySelector('#refund-expense-title').textContent=expense.title;form.querySelector('#refund-recipient').textContent=name(expense.payerMemberId);
   const selected=oldItems===JSON.stringify(expense.items||[])?form.elements.namedItem('item').value:'';
   form.elements.namedItem('item').innerHTML=`<option value="">${t('整笔账单')}</option>${(expense.items||[]).map((item,i)=>`<option value="${i}">${escape(item.title)}</option>`).join('')}`;form.elements.namedItem('item').value=selected;
   renderFields(values);needsReview=false;review.hidden=true;form.querySelector('#form-error').hidden=true;update();}catch(error){form.querySelector('#form-error').textContent=t(error.message);form.querySelector('#form-error').hidden=false;}finally{review.disabled=false;}
 };
 form.addEventListener('submit',async event=>{await submitForm(event,async()=>{
  if(needsReview&&!submission.pending)throw Error('账单已更新，请重新核对退款。');
  try{const original=submission.pending?.payload||payload();busy=true;const request=submission.submit(original);lockPending();await request;}
  catch(error){
   if((error.status||error.statusCode)===409){needsReview=true;review.hidden=false;}
   if(submission.pending)throw Error('退款保存结果待核实，请核实后再记录下一笔。');throw error;
  }
  finally{busy=false;lockPending();}
  await onSaved(t('退款已记录。'));
 });update();});
 update();
}
