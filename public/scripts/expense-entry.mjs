import { t, translateError } from './i18n.mjs';
import { parseMoney, formatMoney, splitShares, consumptionShares } from './ledger-core.mjs';
import { itemizedShares } from './expense-features.mjs';
import { readReceiptFile } from './receipt-files.mjs';
import { receiptMarkup } from './receipt-viewer.mjs';

export function openExpenseEditor(context, options = {}) {
  const { snapshot:s, user, isOwner, openDialog, submitForm, errorSlot, formError, onSave, today } = context;
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = cents => formatMoney(cents,s.ledger.currency);
  const amountText = cents => `${Math.floor(cents/100)}.${String(cents%100).padStart(2,'0')}`;
  const memberName = id => s.members.find(m=>m.id===id)?.name || t('成员');
  const avatar = name => `<span class="avatar" aria-hidden="true">${escape(Array.from(name || '?')[0])}</span>`;
  const errorMessage = translateError;
  const localDate = () => today;
  const owner = () => isOwner;
  const state = {store:{currentUser:user}};
  const me=s.members.find(m=>m.uid===user.uid), initial=options.initial || {}, templateMode=Boolean(options.templateMode), recurring=Boolean(options.occurrence);
  const editing=Boolean(options.expenseId),financialLocked=editing&&Object.values(initial.repaid||{}).some(value=>value>0);
  const availableMembers=recurring?s.members.filter(m=>Object.hasOwn(initial.shares,m.id)):s.members;
  let splitType=initial.items?.length?'items':initial.shares?'amount':'equal', amountDraftInitialized=Boolean(initial.shares);
  let itemDrafts=(initial.items || []).map(row=>({title:row.title,amount:amountText(row.amountCents),memberIds:[...row.memberIds]}));
  let receipts=editing?[...(initial.receipts||[])]:[], readingReceipts=false;
  const initialShares=initial.shares?consumptionShares(initial):{};
  const defaultCount=Math.min(s.members.length,8);
  const payerOptions=s.members.filter(m=>owner()||m.uid===state.store.currentUser.uid).map(m=>`<option value="${escape(m.id)}" ${m.id===me?.id?'selected':''}>${escape(m.name)}${m.id===me?.id?t('（我）'):''}</option>`).join('');
  const percentRows=s.members.map((m,i)=>`<div class="percent-field" data-percent-member="${escape(m.id)}"><label for="percent-${i}">${escape(m.name)}</label><span class="split-input-unit"><input id="percent-${i}" class="form-input" type="number" min="0" max="100" step="0.01" inputmode="decimal" data-percent="${escape(m.id)}" value="${i<defaultCount?((Math.floor(10000/defaultCount)+(i<10000%defaultCount?1:0))/100).toFixed(2):'0.00'}" aria-label="${t('{name}的比例', {name:escape(m.name)})}" aria-describedby="percent-result-${i}"><span>%</span></span><output id="percent-result-${i}" for="new-amount percent-${i}" data-percent-result="${escape(m.id)}" class="split-converted" aria-live="off">—</output></div>`).join('');
  const amountRows=s.members.map(m=>`<label class="amount-field" data-amount-member="${escape(m.id)}"><span>${escape(m.name)}</span><span class="split-input-unit"><input class="form-input" inputmode="decimal" data-share-amount="${escape(m.id)}" placeholder="0.00" aria-label="${t('{name}承担金额', {name:escape(m.name)})}"><span>${escape(s.ledger.currency)}</span></span></label>`).join('');
  openDialog(t('记一笔共同开销'),`<form id="expense-form"><div class="entry-layout"><div class="entry-fields"><label class="form-field"><span class="field-label">${t('金额 ·')} ${escape(s.ledger.currency)}</span><input name="amount" id="new-amount" class="form-input amount-input" inputmode="decimal" placeholder="0.00" required autofocus></label><label class="form-field"><span class="field-label">${t('花在了哪里？')}</span><input class="form-input" name="title" maxlength="100" placeholder="${t('例如：周五一起吃火锅')}" required></label><div class="form-grid"><label class="form-field"><span class="field-label">${t('谁先垫付')}</span><select class="form-select" name="payer">${payerOptions}</select></label><label class="form-field"><span class="field-label">${t('日期')}</span><input class="form-input" name="date" type="date" value="${localDate()}" required></label></div><fieldset class="participant-fieldset"><legend class="field-label">${t('谁参与这笔消费')}</legend><div class="participant-grid">${s.members.map((m,i)=>`<label class="member-check"><input type="checkbox" name="participant" value="${escape(m.id)}" ${i<8?'checked':''}>${avatar(m.name)}<span>${escape(m.name)}</span></label>`).join('')}</div><p class="form-hint">${t('付款人也可以参与分摊。只勾选实际消费的人，每笔最多 8 人。')}</p></fieldset><div class="split-choice" role="group" aria-label="${t('分摊方式')}"><button type="button" class="chip active" data-split="equal" aria-pressed="true">${t('均分')}</button><button type="button" class="chip" data-split="percent" aria-pressed="false">${t('按比例')}</button><button type="button" class="chip" data-split="amount" aria-pressed="false">${t('按金额')}</button></div><div id="percent-fields" hidden>${percentRows}<p class="form-hint">${t('每行右侧显示该比例对应的金额，精确到分。')}</p></div><div id="amount-fields" hidden><p class="form-hint">${t('直接填写每个人承担的金额，合计需要与账单总额一致。')}</p>${amountRows}<p id="amount-summary" class="split-summary" role="status"></p></div></div><aside class="entry-preview"><h3>${t('分摊预览')}</h3><div id="split-preview"><p class="muted">${t('填写金额后，就能看到每人承担多少。')}</p></div></aside></div>${errorSlot()}<div class="form-actions"><button type="button" class="button secondary" data-action="close-dialog">${t('取消')}</button><button class="button primary" type="submit">${t('保存账单')}</button></div></form>`,'',true);
  const form=$('#expense-form');
  $('#dialog-title').textContent=editing?t('补充与更正账单'):templateMode?(options.templateId?t('编辑账单模板'):t('新建账单模板')):recurring?t('确认本期账单'):t('记一笔共同开销');
  const saveButton=form.querySelector('[type="submit"]');
  saveButton.textContent=editing?t('保存更正'):templateMode?t('保存模板'):recurring?t('确认并记账'):t('保存账单');
  form.elements.title.value=initial.title || '';
  form.elements.amount.value=initial.amountCents?amountText(initial.amountCents):'';
  form.elements.date.value=editing?initial.date:options.occurrence?.date || today;
  if(initial.payerMemberId&&[...form.elements.payer.options].some(o=>o.value===initial.payerMemberId))form.elements.payer.value=initial.payerMemberId;
  if(recurring)form.elements.payer.disabled=true;
  form.querySelectorAll('[name="participant"]').forEach(input=>{
    if(initial.shares)input.checked=Object.hasOwn(initialShares,input.value);
    if(recurring){input.disabled=true;input.closest('label').hidden=!Object.hasOwn(initial.shares,input.value);input.checked=Object.hasOwn(initial.shares,input.value);}
  });
  form.querySelectorAll('[data-share-amount]').forEach(input=>{if(Object.hasOwn(initialShares,input.dataset.shareAmount))input.value=amountText(initialShares[input.dataset.shareAmount]);});
  form.querySelector('.split-choice').insertAdjacentHTML('beforeend',`<button type="button" class="chip" data-split="items" aria-pressed="false">${t('逐项分摊')}</button>`);
  const fields=form.querySelector('.entry-fields');
  fields.insertAdjacentHTML('beforeend',`<div id="item-fields" hidden><p class="form-hint">${t('每项单独选择参与人，项目金额自动汇总。')}</p><div id="item-list" class="item-list"></div><button type="button" class="button secondary" id="add-item">${t('添加项目')}</button></div>
    <details class="entry-extras" ${initial.note||editing?'open':''}><summary>${templateMode?t('备注'):t('备注与收据')}</summary><label class="form-field"><span class="field-label">${t('备注（选填）')}</span><textarea name="note" class="form-input" maxlength="1000" rows="3"></textarea></label>${templateMode?'':`<div class="receipt-dropzone" id="receipt-dropzone" tabindex="0" role="group" aria-label="${t('添加截图或收据')}"><label class="form-field"><span class="field-label">${t('添加截图或收据')}</span><input id="receipt-files" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple></label><p class="form-hint">${t('也可以拖入文件，或粘贴截图。')}</p><p class="form-hint">${t('最多 3 份。图片最大 10 MB，超过 2 MB 自动压缩；PDF 最大 2 MB。')}</p></div><div id="receipt-list" class="receipt-list"></div><p id="receipt-status" class="form-hint" role="status"></p>${editing?`<p class="form-hint">${t('移除的附件仍保留在操作历史中。')}</p>`:''}`}</details>`);
  if(editing)fields.insertAdjacentHTML('beforeend',`<label class="form-field change-reason"><span class="field-label">${t('更正说明')}</span><input name="changeReason" class="form-input" maxlength="300" placeholder="${t('例如：补充付款截图，或更正住宿金额')}" required></label>`);
  if(financialLocked)fields.insertAdjacentHTML('afterbegin',`<p class="form-hint">${t('已有收款，可补充备注和附件；更改金额或分摊前，请先撤销相关收款。')}</p>`);
  form.elements.note.value=initial.note || '';
  if(templateMode){
    form.elements.date.closest('label').hidden=true;form.elements.date.required=false;
    fields.insertAdjacentHTML('beforeend',`<section class="schedule-fields"><div class="form-grid"><label class="form-field"><span class="field-label">${t('重复周期')}</span><select name="frequency" class="form-select"><option value="none">${t('不重复，仅作模板')}</option><option value="weekly">${t('每周')}</option><option value="monthly">${t('每月')}</option><option value="yearly">${t('每年')}</option></select></label><label class="form-field" id="schedule-start"><span class="field-label">${t('首次日期')}</span><input type="date" name="startDate" class="form-input" value="${today}"></label></div><p class="form-hint" id="schedule-hint">${t('到期后进入待确认，确认后才计入支出。月末日期自动适应当月天数。')}</p></section>`);
    form.elements.frequency.value=initial.frequency || 'none';form.elements.startDate.value=initial.startDate || today;
    const updateSchedule=()=>{const repeat=form.elements.frequency.value!=='none';$('#schedule-start').hidden=!repeat;form.elements.startDate.required=repeat;$('#schedule-hint').hidden=!repeat;};
    form.elements.frequency.addEventListener('change',updateSchedule);updateSchedule();
  }
  function readItemDrafts(){return [...form.querySelectorAll('.item-row')].map(row=>({title:row.querySelector('[data-item-title]').value,amount:row.querySelector('[data-item-amount]').value,memberIds:[...row.querySelectorAll('[data-item-member]:checked')].map(input=>input.value)}));}
  function renderItems(){
    $('#item-list').innerHTML=itemDrafts.map((row,i)=>`<fieldset class="item-row"><legend>${t('项目 {number}',{number:i+1})}</legend><div class="item-top"><label class="form-field"><span class="field-label">${t('项目名称')}</span><input data-item-title class="form-input" maxlength="120" value="${escape(row.title)}" aria-label="${t('项目 {number} 名称',{number:i+1})}"></label><label class="form-field"><span class="field-label">${t('金额')}</span><input data-item-amount class="form-input" inputmode="decimal" placeholder="0.00" value="${escape(row.amount)}" aria-label="${t('项目 {number} 金额',{number:i+1})}"></label><button type="button" class="text-link danger-link" data-remove-item="${i}" aria-label="${t('删除项目 {number}',{number:i+1})}">${t('删除')}</button></div><div class="item-members" role="group" aria-label="${t('项目 {number} 参与人',{number:i+1})}">${availableMembers.map(m=>`<label><input type="checkbox" data-item-member value="${escape(m.id)}" ${row.memberIds.includes(m.id)?'checked':''}>${escape(m.name)}</label>`).join('')}</div></fieldset>`).join('');
    $('#add-item').disabled=itemDrafts.length>=8;
  }
  function updateMode(){
    const itemMode=splitType==='items';
    $('#percent-fields').hidden=splitType!=='percent';$('#amount-fields').hidden=splitType!=='amount';$('#item-fields').hidden=!itemMode;
    form.querySelector('.participant-fieldset').hidden=itemMode;form.elements.amount.readOnly=itemMode||financialLocked;
    form.querySelectorAll('[data-split]').forEach(button=>{button.classList.toggle('active',button.dataset.split===splitType);button.setAttribute('aria-pressed',String(button.dataset.split===splitType));});
    if(itemMode&&!itemDrafts.length){itemDrafts=[{title:'',amount:'',memberIds:availableMembers.slice(0,8).map(m=>m.id)}];renderItems();}
  }
  $('#add-item').addEventListener('click',()=>{itemDrafts=readItemDrafts();if(itemDrafts.length>=8)return;itemDrafts.push({title:'',amount:'',memberIds:availableMembers.slice(0,8).map(m=>m.id)});renderItems();$('#item-list').lastElementChild.querySelector('input').focus();preview();});
  $('#item-list').addEventListener('click',event=>{const button=event.target.closest('[data-remove-item]');if(!button)return;itemDrafts=readItemDrafts();itemDrafts.splice(Number(button.dataset.removeItem),1);renderItems();$('#add-item').focus();preview();});
  renderItems();
  function renderReceipts(){
    $('#receipt-list').innerHTML=receipts.map((receipt,i)=>`<div class="receipt-edit-row">${receiptMarkup([receipt])}<button type="button" class="text-link danger-link" data-remove-receipt="${i}" aria-label="${t('移除收据 {name}',{name:escape(receipt.name)})}">${t('移除')}</button></div>`).join('');
  }
  async function addReceipts(files){
    const input=$('#receipt-files');if(!files.length||readingReceipts)return;
    if(receipts.length+files.length>3){formError(t('最多添加 3 份收据。'));input.value='';return;}
    readingReceipts=true;saveButton.disabled=true;input.disabled=true;$('#receipt-status').textContent=t('正在处理收据…');
    try{const added=[];for(const file of files)added.push(await readReceiptFile(file));if(!form.isConnected)return;receipts.push(...added);renderReceipts();$('#form-error').hidden=true;}
    catch(error){if(form.isConnected)formError(errorMessage(error));}
    finally{readingReceipts=false;if(form.isConnected){saveButton.disabled=false;input.disabled=false;input.value='';$('#receipt-status').textContent='';}}
  }
  $('#receipt-files')?.addEventListener('change',event=>addReceipts([...event.target.files]));
  const dropzone=$('#receipt-dropzone');
  dropzone?.addEventListener('dragover',event=>{if([...event.dataTransfer.types].includes('Files')){event.preventDefault();dropzone.classList.add('dragging');}});
  dropzone?.addEventListener('dragleave',()=>dropzone.classList.remove('dragging'));
  dropzone?.addEventListener('drop',event=>{event.preventDefault();dropzone.classList.remove('dragging');addReceipts([...event.dataTransfer.files]);});
  if(!templateMode)form.addEventListener('paste',event=>{const files=[...(event.clipboardData?.files||[])].filter(file=>file.type.startsWith('image/'));if(files.length){event.preventDefault();form.querySelector('.entry-extras').open=true;addReceipts(files);}});
  if(!templateMode)renderReceipts();
  $('#receipt-list')?.addEventListener('click',event=>{const button=event.target.closest('[data-remove-receipt]');if(button){receipts.splice(Number(button.dataset.removeReceipt),1);renderReceipts();}});
  const draftValues=attribute=>Object.fromEntries([...form.querySelectorAll(`[${attribute}]`)].map(input=>[input.getAttribute(attribute),input.value]));
  function calculate() {
    if(splitType==='items') {
      const result=itemizedShares(readItemDrafts().map(row=>({title:row.title,amountCents:parseMoney(row.amount),memberIds:row.memberIds})));
      return {amount:result.amountCents,shares:result.shares,ids:Object.keys(result.shares),items:result.items};
    }
    const data=new FormData(form),amount=parseMoney(data.get('amount')),ids=[...form.querySelectorAll('[name="participant"]:checked')].map(input=>input.value);
    // Preserve a percentage bill's implicit payer remainder when only metadata changes.
    // It may have eight explicit participants plus the payer's own remainder.
    if(editing&&splitType==='amount'&&amount===initial.amountCents&&form.elements.payer.value===initial.payerMemberId){
      const values=draftValues('data-share-amount');
      if(ids.length===Object.keys(initialShares).length&&ids.every(id=>Object.hasOwn(initialShares,id)&&parseMoney(values[id],{allowZero:true})===initialShares[id])){
        return {amount,shares:{...initial.shares},ids:Object.keys(initial.shares)};
      }
    }
    if(ids.length>8)throw new Error('每笔最多选择 8 位分摊成员。');
    return {amount,ids,shares:splitShares(amount,ids,{type:splitType,percentages:draftValues('data-percent'),amounts:draftValues('data-share-amount')})};
  }
  function amountSummary(chosen) {
    const summary=$('#amount-summary');summary.dataset.state='';
    try {
      const total=parseMoney(form.elements.amount.value),values=draftValues('data-share-amount');let assigned=0n,missing=0;
      for(const id of chosen){if(!values[id].trim()){missing++;continue;}assigned+=BigInt(parseMoney(values[id],{allowZero:true}));}
      if(assigned>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('分配金额合计超出支持范围。');
      const sum=Number(assigned),difference=total-sum;
      summary.textContent=`${t('已分配 {amount}', {amount:money(sum)})} · ${difference>0?t('还差 {amount}', {amount:money(difference)}):difference<0?t('超出 {amount}', {amount:money(-difference)}):t('与总额一致')}${missing?` · ${t('{count}人未填写', {count:missing})}`:''}`;
      summary.dataset.state=difference<0?'error':difference===0&&!missing?'success':'';
    }catch(error){summary.textContent=form.elements.amount.value?errorMessage(error):t('先填写账单总额，再分配每个人的金额。');}
  }
  function preview() {
    const chosen=[...form.querySelectorAll('[name="participant"]:checked')].map(input=>input.value);
    if(splitType==='items') {try{form.elements.amount.value=amountText(calculate().amount);}catch{form.elements.amount.value='';}}
    form.querySelectorAll('[data-percent-member]').forEach(e=>{e.hidden=!chosen.includes(e.dataset.percentMember);e.querySelector('input').disabled=financialLocked||e.hidden||splitType!=='percent';});
    form.querySelectorAll('[data-amount-member]').forEach(e=>{e.hidden=!chosen.includes(e.dataset.amountMember);e.querySelector('input').disabled=financialLocked||e.hidden||splitType!=='amount';});
    form.querySelectorAll('[data-percent-result]').forEach(e=>{e.textContent='—';});
    if(splitType==='amount')amountSummary(chosen);
    try {
      const {amount,shares,ids}=calculate(),payer=form.elements.payer.value,total=Object.values(shares).reduce((a,b)=>a+b,0),self=(shares[payer]||0)+(amount-total);
      if(splitType==='percent')form.querySelectorAll('[data-percent-result]').forEach(e=>{if(Object.hasOwn(shares,e.dataset.percentResult))e.textContent=money(shares[e.dataset.percentResult]);});
      $('#split-preview').innerHTML=`<div class="preview-list">${ids.map(id=>`<div class="preview-row"><span>${escape(memberName(id))}${id===payer?` <small>${t('垫付人')}</small>`:''}</span><strong>${money(shares[id])}</strong></div>`).join('')}</div>${amount-total?`<p class="form-hint">${t('未分配 {amount}，由垫付人承担。', {amount:money(amount-total)})}</p>`:''}<div class="preview-total"><span>${t('总额')}</span><strong>${money(amount)}</strong></div><p class="form-hint">${t('垫付人自付 {self}，待收回 {remaining}。', {self:money(self),remaining:money(amount-self-(editing?Object.values(initial.repaid||{}).reduce((sum,value)=>sum+value,0):0))})}</p>`;
    }catch(error){$('#split-preview').innerHTML=`<p class="form-hint">${escape(splitType==='items'||form.elements.amount.value?errorMessage(error):t('填写金额后，就能看到每人承担多少。'))}</p>`;}
  }
  form.addEventListener('input',event=>{if(event.target.hasAttribute('data-share-amount'))amountDraftInitialized=true;$('#form-error').hidden=true;preview();});
  form.addEventListener('change',preview);
  form.querySelectorAll('[data-split]').forEach(button=>button.addEventListener('click',()=>{
    if(button.dataset.split==='amount'&&!amountDraftInitialized){
      try {
        const data=new FormData(form),amount=parseMoney(data.get('amount')),ids=data.getAll('participant');let shares;
        try{shares=calculate().shares;}catch{shares=splitShares(amount,ids);}
        const remainder=amount-Object.values(shares).reduce((sum,value)=>sum+value,0),payer=data.get('payer');
        if(remainder&&ids.includes(payer))shares[payer]+=remainder;
        form.querySelectorAll('[data-share-amount]').forEach(input=>{if(Object.hasOwn(shares,input.dataset.shareAmount))input.value=amountText(shares[input.dataset.shareAmount]);});
        amountDraftInitialized=true;
      }catch{/* Leave fields empty until an amount and participants are available. */}
    }
    splitType=button.dataset.split;
    form.querySelectorAll('[data-split]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});
    updateMode();$('#form-error').hidden=true;preview();
  }));
  form.addEventListener('submit',e=>submitForm(e,async data=>{
    if(readingReceipts)throw new Error('收据正在处理，请稍候再保存。');
    const {amount,shares,items=[]}=calculate();
    const payload={title:data.get('title').trim(),date:data.get('date')||today,amountCents:amount,payerMemberId:form.elements.payer.value,shares,items,note:data.get('note').trim(),receipts};
    if(editing){payload.expectedVersion=initial.version||1;payload.changeReason=data.get('changeReason');payload.receipts=receipts.map(file=>file.id?{id:file.id}:file);}
    if(templateMode){payload.frequency=data.get('frequency');payload.startDate=payload.frequency==='none'?null:data.get('startDate');}
    if(recurring){payload.sourceTemplateId=initial.id;payload.sourceDate=options.occurrence.date;}
    await onSave(payload,options);
  }));
  updateMode();
  if(financialLocked)form.querySelectorAll('[name="payer"],[name="participant"],[data-split],[data-percent],[data-share-amount],[data-item-title],[data-item-amount],[data-item-member],[data-remove-item],#add-item').forEach(input=>input.disabled=true);
  preview();
}
