import { t, translateError } from './i18n.mjs';
import { parseMoney, formatMoney, splitShares, consumptionShares } from './ledger-core.mjs';
import { itemizedShares } from './expense-features.mjs';
import { readReceiptFile } from './receipt-files.mjs';
import { receiptMarkup } from './receipt-viewer.mjs';
import { draftWriter } from './expense-drafts.mjs';
import {completePercentages} from './percentage-entry.mjs';
import {randomId} from './random-id.mjs';
import {mountParticipantTools} from './participant-tools.mjs';
import {continuationOptions,memberEntryMatch,assignItemMember} from './entry-context.mjs';

export function openExpenseEditor(context, options = {}) {
  const { snapshot, user, isOwner, openDialog, submitForm, errorSlot, formError, onSave, today } = context;
  const prior=options.initial,oldDraft=context.draft?.record?.form;
  const s={...snapshot,members:snapshot.members.filter(m=>m.status!=='inactive'||prior&&(prior.payerMemberId===m.id||Object.hasOwn(prior.shares||{},m.id))||oldDraft&&(oldDraft.fields?.payer===m.id||oldDraft.participants?.includes(m.id)||oldDraft.items?.some(row=>row.memberIds.includes(m.id)))).map(m=>({...m,name:m.name+(m.status==='inactive'?` (${t('已停用')})`:'' )}))};
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
  const recovered=context.draft?.record?.form,continuation=options.continuation;
  let memberTools,saveDraft=()=>Promise.resolve(),draftComplete=false,attempt=context.draft?.record?.attempt||null;
  let splitType=recovered?.splitType||continuation?.splitType||(initial.items?.length?'items':initial.shares?'amount':'equal'), amountDraftInitialized=recovered?.amountDraftInitialized??Boolean(initial.shares||continuation?.splitType==='amount');
  let manualAmount=recovered?.manualAmount??(recovered?.splitType==='items'?'':recovered?.fields?.amount??(initial.amountCents?amountText(initial.amountCents):''));
  let itemDrafts=recovered?.items||(initial.items || []).map(row=>({title:row.title,amount:amountText(row.amountCents),memberIds:[...row.memberIds]}));
  let receipts=recovered?.receipts||(editing?[...(initial.receipts||[])]:[]), readingReceipts=false,addingMember=false,assignmentMember=!financialLocked&&!recurring&&context.onAddMember?recovered?.assignmentMember||null:null;
  const initialShares=initial.shares?consumptionShares(initial):{};
  const activeMembers=s.members.filter(m=>m.status!=='inactive');
  const defaultIds=options.participantIds?.filter(id=>activeMembers.some(m=>m.id===id))|| (activeMembers.length<=8?activeMembers.map(m=>m.id):me&&me.status!=='inactive'?[me.id]:[]);
  const lastExpense=[...snapshot.expenses].filter(e=>e.createdByUid===user.uid&&e.status==='active').sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  const previousGroup=lastExpense?Object.keys(consumptionShares(lastExpense)).filter(id=>activeMembers.some(m=>m.id===id)):[];
  const percentEdited=new Set(recovered?.percentEdited|| (recovered?recovered.participants:continuation?.percentEdited||[]));
  const payerOptions=s.members.filter(m=>owner()||m.uid===state.store.currentUser.uid).map(m=>`<option value="${escape(m.id)}" ${m.id===me?.id?'selected':''}>${escape(m.name)}${m.id===me?.id?t('（我）'):''}</option>`).join('');
  const percentRow=(m,i)=>`<div class="percent-field" data-percent-member="${escape(m.id)}"><div class="percent-person"><label for="percent-${i}">${escape(m.name)}</label><small id="percent-state-${i}" data-percent-state="${escape(m.id)}"></small></div><span class="split-input-unit"><input id="percent-${i}" class="form-input" type="number" min="0" max="100" step="0.01" inputmode="decimal" data-percent="${escape(m.id)}" value="0" aria-label="${t('{name}的比例',{name:escape(m.name)})}" aria-describedby="percent-state-${i} percent-result-${i}"><span>%</span></span><div class="percent-outcome"><output id="percent-result-${i}" for="new-amount percent-${i}" data-percent-result="${escape(m.id)}" class="split-converted" aria-live="off">—</output><button type="button" class="text-link" data-percent-auto="${escape(m.id)}" aria-label="${t('恢复{name}的自动比例',{name:escape(m.name)})}" hidden>${t('恢复自动')}</button></div></div>`;
  const percentRows=s.members.map(percentRow).join('');
  const amountRows=s.members.map(m=>`<label class="amount-field" data-amount-member="${escape(m.id)}"><span>${escape(m.name)}</span><span class="split-input-unit"><input class="form-input" inputmode="decimal" data-share-amount="${escape(m.id)}" placeholder="0.00" aria-label="${t('{name}承担金额', {name:escape(m.name)})}"><span>${escape(s.ledger.currency)}</span></span></label>`).join('');
  openDialog(t('记一笔共同开销'),`<form id="expense-form"><div class="entry-layout"><div class="entry-fields"><label class="form-field"><span class="field-label">${t('金额 ·')} ${escape(s.ledger.currency)}</span><input name="amount" id="new-amount" class="form-input amount-input" inputmode="decimal" placeholder="0.00" required autofocus></label><label class="form-field"><span class="field-label">${t('花在了哪里？')}</span><input class="form-input" name="title" maxlength="100" placeholder="${t('例如：周五一起吃火锅')}" required></label><div class="form-grid"><label class="form-field"><span class="field-label">${t('谁先垫付')}</span><select class="form-select" name="payer">${payerOptions}</select></label><label class="form-field"><span class="field-label">${t('日期')}</span><input class="form-input" name="date" type="date" value="${localDate()}" required></label></div><fieldset class="participant-fieldset"><legend class="field-label">${t('谁参与这笔消费')}</legend><div class="participant-grid">${s.members.map((m,i)=>`<label class="member-check"><input type="checkbox" name="participant" value="${escape(m.id)}" ${defaultIds.includes(m.id)?'checked':''}>${avatar(m.name)}<span>${escape(m.name)}</span></label>`).join('')}</div><p class="form-hint">${t('付款人也可以参与分摊。只勾选实际消费的人，每笔最多 50 人。')}</p></fieldset><div class="split-choice" role="group" aria-label="${t('分摊方式')}"><button type="button" class="chip active" data-split="equal" aria-pressed="true">${t('均分')}</button><button type="button" class="chip" data-split="percent" aria-pressed="false">${t('按比例')}</button><button type="button" class="chip" data-split="amount" aria-pressed="false">${t('按金额')}</button></div><div id="percent-fields" hidden>${percentRows}<p class="form-hint">${t('每行右侧显示该比例对应的金额，精确到分。')}</p></div><div id="amount-fields" hidden><p class="form-hint">${t('直接填写每个人承担的金额，合计需要与账单总额一致。')}</p>${amountRows}<p id="amount-summary" class="split-summary" role="status"></p></div></div><aside class="entry-preview"><h3>${t('分摊预览')}</h3><div id="split-preview"><p class="muted">${t('填写金额后，就能看到每人承担多少。')}</p></div></aside></div>${errorSlot()}<div class="form-actions"><button type="button" class="button secondary" data-action="close-dialog">${t('取消')}</button><button class="button primary" type="submit">${t('保存账单')}</button></div></form>`,'',true);
  const form=$('#expense-form');
  $('#dialog-title').textContent=editing?t('补充与更正账单'):templateMode?(options.templateId?t('编辑账单模板'):t('新建账单模板')):recurring?t('确认本期账单'):t('记一笔共同开销');
  const saveButton=form.querySelector('[type="submit"]');
  saveButton.textContent=editing?t('保存更正'):templateMode?t('保存模板'):recurring?t('确认并记账'):t('保存账单');
  form.elements.title.value=initial.title || '';
  form.elements.amount.value=initial.amountCents?amountText(initial.amountCents):'';
  form.elements.date.value=editing?initial.date:options.occurrence?.date || continuation?.date || today;
  if(initial.payerMemberId&&[...form.elements.payer.options].some(o=>o.value===initial.payerMemberId))form.elements.payer.value=initial.payerMemberId;
  if(continuation){form.elements.payer.value=continuation.payerMemberId;form.elements.payer.required=true;}
  form.querySelectorAll('[data-percent]').forEach(input=>input.value=continuation?.percentages?.[input.dataset.percent]??'0');
  if(recurring)form.elements.payer.disabled=true;
  form.querySelectorAll('[name="participant"]').forEach(input=>{
    if(initial.shares)input.checked=Object.hasOwn(initialShares,input.value);
    if(recurring){input.disabled=true;input.closest('label').hidden=!Object.hasOwn(initial.shares,input.value);input.checked=Object.hasOwn(initial.shares,input.value);}
  });
  form.querySelectorAll('[data-share-amount]').forEach(input=>{if(Object.hasOwn(initialShares,input.dataset.shareAmount))input.value=amountText(initialShares[input.dataset.shareAmount]);});
  if(!recurring&&!financialLocked){
    form.querySelector('.participant-grid').insertAdjacentHTML('beforebegin',`<div class="participant-tools"><span id="participant-count"></span><button type="button" class="text-link" id="participants-clear">${t('清空选择')}</button>${previousGroup.length?`<button type="button" class="text-link" id="participants-previous">${t('上次组合')}</button>`:''}${s.members.length<=50?`<button type="button" class="text-link" id="participants-all">${t('全选')}</button>`:''}</div>`);
    form.querySelector('.participant-grid').insertAdjacentHTML('beforebegin',`<label class="member-search" ${s.members.length<=4?'hidden':''}><span class="sr-only">${t('搜索参与人')}</span><input type="search" class="form-input" id="participant-search" placeholder="${t('搜索参与人')}"></label>`);
    $('#participants-previous')?.addEventListener('click',()=>{form.querySelectorAll('[name="participant"]').forEach(row=>row.checked=previousGroup.includes(row.value));preview();saveDraft();});
    $('#participant-search').addEventListener('input',event=>{const query=event.target.value.trim().toLocaleLowerCase();form.querySelectorAll('.member-check').forEach(row=>row.hidden=!row.textContent.toLocaleLowerCase().includes(query));});
    for(const [selector,checked] of [['#participants-clear',false],['#participants-all',true]])$(selector)?.addEventListener('click',()=>{form.querySelectorAll('[name="participant"]').forEach(row=>row.checked=checked);preview();saveDraft();});
  }

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
  function renderItems(refreshTools=true){
    $('#item-list').innerHTML=itemDrafts.map((row,i)=>`<fieldset class="item-row"><legend>${t('项目 {number}',{number:i+1})}</legend><div class="item-top"><label class="form-field"><span class="field-label">${t('项目名称')}</span><input data-item-title class="form-input" maxlength="120" value="${escape(row.title)}" aria-label="${t('项目 {number} 名称',{number:i+1})}"></label><label class="form-field"><span class="field-label">${t('金额')}</span><input data-item-amount class="form-input" inputmode="decimal" placeholder="0.00" value="${escape(row.amount)}" aria-label="${t('项目 {number} 金额',{number:i+1})}"></label><button type="button" class="text-link danger-link" data-remove-item="${i}" aria-label="${t('删除项目 {number}',{number:i+1})}">${t('删除')}</button></div><div class="item-members" role="group" aria-label="${t('项目 {number} 参与人',{number:i+1})}">${availableMembers.map(m=>`<label><input type="checkbox" data-item-member value="${escape(m.id)}" ${row.memberIds.includes(m.id)?'checked':''}>${escape(m.name)}</label>`).join('')}</div></fieldset>`).join('');
    $('#add-item').disabled=itemDrafts.length>=8;renderItemPicker();if(refreshTools)memberTools?.modeChanged();
  }
  function renderItemPicker(){
    const panel=$('#item-member-picker');if(!panel)return;
    panel.hidden=!assignmentMember||splitType!=='items';if(panel.hidden)return;
    const rows=readItemDrafts();
    panel.innerHTML=`<fieldset><legend>${t('{name}参与哪些项目？',{name:escape(memberName(assignmentMember))})}</legend>${rows.map((row,i)=>`<label class="item-assignment-choice"><input type="checkbox" data-assign-item="${i}" ${row.memberIds.includes(assignmentMember)?'checked':''}><span>${escape(row.title)||t('项目 {number}',{number:i+1})}</span><span>${escape(row.amount||'0.00')} ${escape(s.ledger.currency)}</span></label>`).join('')}</fieldset><p id="item-assignment-result" class="form-hint" role="status"></p><div class="item-assignment-actions"><button type="button" class="button secondary" id="item-assignment-done">${t('完成选择')}</button><button type="button" class="text-link" id="item-assignment-skip">${t('暂不分摊')}</button></div>`;
  }
  function assignmentPending(){return splitType==='items'&&assignmentMember&&!readItemDrafts().some(row=>row.memberIds.includes(assignmentMember));}
  function showAssignment(memberId){
    if(assignmentPending()&&assignmentMember!==memberId){$('#entry-member-error').textContent=t('请先选择参与项目，或选择暂不分摊。');$('#entry-member-error').hidden=false;return false;}
    assignmentMember=memberId;renderItemPicker();$('#item-member-picker input')?.focus();return true;
  }
  function updateMode(){
    const itemMode=splitType==='items';memberTools?.modeChanged();
    if($('#entry-member-feedback'))$('#entry-member-feedback').hidden=true;
    renderItemPicker();
    if($('#entry-add-member')&&!addingMember)$('#entry-add-member').textContent=t(itemMode?'添加参与人':'添加并选择');
    $('#percent-fields').hidden=splitType!=='percent';$('#amount-fields').hidden=splitType!=='amount';$('#item-fields').hidden=!itemMode;
    form.querySelector('.participant-fieldset').hidden=itemMode;form.elements.amount.readOnly=itemMode||financialLocked;
    form.querySelectorAll('[data-split]').forEach(button=>{button.classList.toggle('active',button.dataset.split===splitType);button.setAttribute('aria-pressed',String(button.dataset.split===splitType));});
    if(itemMode&&!itemDrafts.length){itemDrafts=[{title:'',amount:'',memberIds:[...form.querySelectorAll('[name="participant"]:checked')].map(input=>input.value)}];renderItems();}
  }
  $('#add-item').addEventListener('click',()=>{itemDrafts=readItemDrafts();if(itemDrafts.length>=8)return;itemDrafts.push({title:'',amount:'',memberIds:[...form.querySelectorAll('[name="participant"]:checked')].map(input=>input.value)});renderItems();$('#item-list').lastElementChild.querySelector('input').focus();preview();saveDraft();});
  $('#item-list').addEventListener('click',event=>{const button=event.target.closest('[data-remove-item]');if(!button)return;itemDrafts=readItemDrafts();itemDrafts.splice(Number(button.dataset.removeItem),1);renderItems();$('#add-item').focus();preview();saveDraft();});
  renderItems();
  if(context.onAddMember&&!recurring&&!financialLocked){
    form.querySelector('.participant-fieldset').insertAdjacentHTML('afterend',`<details class="entry-member-add"><summary>${t('添加参与人')}</summary><p class="form-hint">${t('添加到账本，可稍后邀请本人认领。')}</p><div class="inline-member-fields"><label class="form-field"><span class="field-label">${t('伙伴怎么称呼？')}</span><input class="form-input" name="inlineMemberName" maxlength="40" autocomplete="off"></label><button type="button" class="button secondary" id="entry-add-member">${t('添加并选择')}</button><button type="button" class="text-link" id="entry-members-done">${t('完成添加')}</button></div><p id="entry-member-feedback" class="form-hint" role="status" hidden></p><div id="entry-member-matches" class="member-matches"></div><div id="item-member-picker" class="item-member-picker" hidden></div><p class="form-error" id="entry-member-error" role="alert" hidden></p></details>`);
    const input=form.elements.inlineMemberName,button=$('#entry-add-member'),error=$('#entry-member-error');
    $('#entry-members-done').addEventListener('click',()=>{if(assignmentPending()){error.textContent=t('请先选择参与项目，或选择暂不分摊。');error.hidden=false;return;}form.querySelector('.entry-member-add').open=false;form.querySelector('.entry-member-add summary').focus();});
    const matches=$('#entry-member-matches');
    function showMatches(){
      const query=input.value.trim().toLocaleLowerCase(),candidates=s.members.filter(m=>m.status!=='inactive'&&m.name.toLocaleLowerCase().includes(query));
      matches.innerHTML=query?candidates.map(m=>{const twins=candidates.filter(other=>other.name.toLocaleLowerCase()===m.name.toLocaleLowerCase());return `<button type="button" class="button secondary small-button" data-existing-member="${escape(m.id)}">${t('选择已有成员：{name}',{name:escape(m.name)})}${twins.length>1?` · ${t(m.uid?'已加入':'临时成员')} · ${t('同名成员 {number}',{number:twins.indexOf(m)+1})}`:''}</button>`;}).join(''):'';
      button.textContent=t(memberEntryMatch(s.members,input.value).action==='create'||!query?(splitType==='items'?'添加参与人':'添加并选择'):'另建同名成员');
    }
    input.addEventListener('input',()=>{error.hidden=true;$('#entry-member-feedback').hidden=true;showMatches();});
    function chooseExisting(id){
      if(addingMember)return;
      error.hidden=true;$('#entry-member-feedback').hidden=true;
      const checkbox=[...form.querySelectorAll('[name="participant"]')].find(row=>row.value===id);
      if(splitType==='items'){if(!showAssignment(id))return;}
      else if(!checkbox.checked){if(form.querySelectorAll('[name="participant"]:checked').length>=50){error.textContent=t('已选 50 人，请先取消一位再选择。');error.hidden=false;return;}checkbox.checked=true;}
      input.value='';matches.innerHTML='';showMatches();if(splitType!=='items')input.focus();preview();saveDraft();
    }
    matches.addEventListener('click',event=>{const target=event.target.closest('[data-existing-member]');if(target)chooseExisting(target.dataset.existingMember);});
    input.addEventListener('keydown',event=>{
      if(event.key!=='Enter'||event.isComposing)return;event.preventDefault();if(addingMember)return;
      const match=memberEntryMatch(s.members,input.value);
      if(match.action==='select')chooseExisting(match.member.id);
      else if(match.action==='choose'){showMatches();error.textContent=t('找到多个同名成员，请选择一位。');error.hidden=false;matches.querySelector('button')?.focus();}
      else button.click();
    });
    $('#item-member-picker').addEventListener('change',event=>{
      if(!event.target.matches('[data-assign-item]'))return;
      try{itemDrafts=assignItemMember(readItemDrafts(),assignmentMember,Number(event.target.dataset.assignItem),event.target.checked);
        form.querySelectorAll('.item-row').forEach((row,i)=>row.querySelectorAll('[data-item-member]').forEach(box=>box.checked=itemDrafts[i].memberIds.includes(box.value)));
        error.hidden=true;$('#form-error').hidden=true;preview();saveDraft();
      }catch(problem){event.target.checked=!event.target.checked;error.textContent=errorMessage(problem);error.hidden=false;}
    });
    $('#item-member-picker').addEventListener('click',event=>{
      if(!event.target.closest('#item-assignment-done,#item-assignment-skip'))return;
      if(event.target.closest('#item-assignment-done')&&assignmentPending()){error.textContent=t('请先选择参与项目，或选择暂不分摊。');error.hidden=false;return;}
      assignmentMember=null;renderItemPicker();error.hidden=true;$('#form-error').hidden=true;input.focus();saveDraft();
    });
    button.addEventListener('click',async()=>{
      if(addingMember)return;
      if(assignmentPending()){error.textContent=t('请先选择参与项目，或选择暂不分摊。');error.hidden=false;return;}
      const name=input.value.trim();error.hidden=true;
      if(!name){error.textContent=t('请填写伙伴的称呼。');error.hidden=false;input.focus();return;}
      const selected=splitType==='items'?new Set(readItemDrafts().flatMap(row=>row.memberIds)).size:form.querySelectorAll('[name="participant"]:checked').length;
      if(selected>=50){error.textContent=t('已选 50 人，请先取消一位再选择。');error.hidden=false;return;}
      addingMember=true;button.disabled=true;input.disabled=true;saveButton.disabled=true;button.textContent=t('正在添加…');
      try{
        const m=await context.onAddMember(name);
        if(!form.isConnected)return;
        registerMember(m,true);itemDrafts=readItemDrafts();renderItems();
        input.value='';matches.innerHTML='';input.disabled=false;input.focus();
        updateMode();preview();const feedback=$('#entry-member-feedback');feedback.textContent=t(splitType==='items'?'已添加{name}，请在消费项目中勾选参与。':splitType==='amount'?'已添加{name}，请填写承担金额。':splitType==='percent'?'已添加{name}，请核对比例与承担金额。':'已添加{name}，均分金额已更新。',{name:m.name});feedback.hidden=splitType==='items';if(splitType==='items'){showAssignment(m.id);preview();}await saveDraft();
      }catch(problem){if(form.isConnected){error.textContent=errorMessage(problem);error.hidden=false;}}
      finally{addingMember=false;if(form.isConnected){button.disabled=false;input.disabled=false;saveButton.disabled=readingReceipts;button.textContent=t(splitType==='items'?'添加参与人':'添加并选择');}}
    });
  }
  function registerMember(m,selected=false){
    const prior=s.members.find(row=>row.id===m.id);
    if(prior){Object.assign(prior,m);
      form.querySelectorAll('[name="participant"]').forEach(box=>{if(box.value===m.id)box.closest('label').lastElementChild.textContent=m.name;});
      form.querySelectorAll('[data-percent-member]').forEach(row=>{if(row.dataset.percentMember===m.id)row.querySelector('label').textContent=m.name;});
      form.querySelectorAll('[data-amount-member]').forEach(row=>{if(row.dataset.amountMember===m.id)row.firstElementChild.textContent=m.name;});
      [...form.elements.payer.options].forEach(option=>{if(option.value===m.id)option.textContent=m.name+(m.id===me?.id?t('（我）'):'');});return;
    }
    s.members.push(m);
    if($('#participants-all'))$('#participants-all').hidden=s.members.length>50;
    if(s.members.length>4&&form.querySelector('.member-search'))form.querySelector('.member-search').hidden=false;
    const i=s.members.length-1,id=escape(m.id),label=escape(m.name);
    form.querySelector('.participant-grid').insertAdjacentHTML('beforeend',`<label class="member-check"><input type="checkbox" name="participant" value="${id}" ${selected?'checked':''}>${avatar(m.name)}<span>${label}</span></label>`);
    $('#percent-fields').insertAdjacentHTML('beforeend',percentRow(m,i));
    $('#amount-fields').insertAdjacentHTML('beforeend',`<label class="amount-field" data-amount-member="${id}"><span>${label}</span><span class="split-input-unit"><input class="form-input" inputmode="decimal" data-share-amount="${id}" placeholder="0.00" aria-label="${t('{name}承担金额',{name:label})}"><span>${escape(s.ledger.currency)}</span></span></label>`);
    if(owner())form.elements.payer.insertAdjacentHTML('beforeend',`<option value="${id}">${label}</option>`);
  }
  function renderReceipts(){
    $('#receipt-list').innerHTML=receipts.map((receipt,i)=>`<div class="receipt-edit-row">${receiptMarkup([receipt])}<button type="button" class="text-link danger-link" data-remove-receipt="${i}" aria-label="${t('移除收据 {name}',{name:escape(receipt.name)})}">${t('移除')}</button></div>`).join('');
  }
  async function addReceipts(files){
    const input=$('#receipt-files');if(!files.length||readingReceipts)return;
    if(receipts.length+files.length>3){formError(t('最多添加 3 份收据。'));input.value='';return;}
    readingReceipts=true;saveButton.disabled=true;input.disabled=true;$('#receipt-status').textContent=t('正在处理收据…');
    try{const added=[];for(const file of files)added.push(await readReceiptFile(file));if(!form.isConnected)return;receipts.push(...added);renderReceipts();saveDraft();$('#form-error').hidden=true;}
    catch(error){if(form.isConnected)formError(errorMessage(error));}
    finally{readingReceipts=false;if(form.isConnected){saveButton.disabled=addingMember;input.disabled=false;input.value='';$('#receipt-status').textContent='';}}
  }
  $('#receipt-files')?.addEventListener('change',event=>addReceipts([...event.target.files]));
  const dropzone=$('#receipt-dropzone');
  dropzone?.addEventListener('dragover',event=>{if([...event.dataTransfer.types].includes('Files')){event.preventDefault();dropzone.classList.add('dragging');}});
  dropzone?.addEventListener('dragleave',()=>dropzone.classList.remove('dragging'));
  dropzone?.addEventListener('drop',event=>{event.preventDefault();dropzone.classList.remove('dragging');addReceipts([...event.dataTransfer.files]);});
  if(!templateMode)form.addEventListener('paste',event=>{const files=[...(event.clipboardData?.files||[])].filter(file=>file.type.startsWith('image/'));if(files.length){event.preventDefault();form.querySelector('.entry-extras').open=true;addReceipts(files);}});
  if(!templateMode)renderReceipts();
  $('#receipt-list')?.addEventListener('click',event=>{const button=event.target.closest('[data-remove-receipt]');if(button){receipts.splice(Number(button.dataset.removeReceipt),1);renderReceipts();saveDraft();}});
  const draftValues=attribute=>Object.fromEntries([...form.querySelectorAll(`[${attribute}]`)].map(input=>[input.getAttribute(attribute),input.value]));
  function calculate() {
    if(splitType==='items') {
      const result=itemizedShares(readItemDrafts().map(row=>({title:row.title,amountCents:parseMoney(row.amount),memberIds:row.memberIds})));
      return {amount:result.amountCents,shares:result.shares,ids:Object.keys(result.shares),items:result.items};
    }
    const data=new FormData(form),amount=parseMoney(data.get('amount')),ids=[...form.querySelectorAll('[name="participant"]:checked')].map(input=>input.value);
    // Preserve a percentage bill's implicit payer remainder when only metadata changes.
    // An implicit payer remainder may sit outside the explicitly selected shares.
    if(editing&&splitType==='amount'&&amount===initial.amountCents&&form.elements.payer.value===initial.payerMemberId){
      const values=draftValues('data-share-amount');
      if(ids.length===Object.keys(initialShares).length&&ids.every(id=>Object.hasOwn(initialShares,id)&&parseMoney(values[id],{allowZero:true})===initialShares[id])){
        return {amount,shares:{...initial.shares},ids:Object.keys(initial.shares)};
      }
    }
    if(ids.length>50)throw new Error('每笔最多选择 50 位分摊成员。');
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
    memberTools?.updateCurrent();
    if($('#participant-count'))$('#participant-count').textContent=t('已选 {count} 人',{count:chosen.length});
    if(splitType==='items') {try{form.elements.amount.value=amountText(calculate().amount);}catch{form.elements.amount.value='';}}
    form.querySelectorAll('[data-percent-member]').forEach(e=>{e.hidden=!chosen.includes(e.dataset.percentMember);e.querySelector('input').disabled=financialLocked||e.hidden||splitType!=='percent';});
    form.querySelectorAll('[data-amount-member]').forEach(e=>{e.hidden=!chosen.includes(e.dataset.amountMember);e.querySelector('input').disabled=financialLocked||e.hidden||splitType!=='amount';});
    form.querySelectorAll('[data-percent-result]').forEach(e=>{e.textContent='—';});
    if(splitType==='percent'){
      const completed=completePercentages(chosen,draftValues('data-percent'),[...percentEdited]);
      if(completed)form.querySelectorAll('[data-percent]').forEach(input=>{if(chosen.includes(input.dataset.percent))input.value=completed[input.dataset.percent];});
    }
    form.querySelectorAll('[data-percent-state]').forEach(el=>el.textContent=t(percentEdited.has(el.dataset.percentState)?'手动':'自动'));
    form.querySelectorAll('[data-percent-auto]').forEach(el=>el.hidden=financialLocked||!percentEdited.has(el.dataset.percentAuto));
    if(splitType==='items'&&assignmentMember){
      const rows=readItemDrafts(),count=rows.filter(row=>row.memberIds.includes(assignmentMember)).length,result=$('#item-assignment-result');
      if(result){result.textContent=t('已选 {count} 项',{count});try{result.textContent+=` · ${money(calculate().shares[assignmentMember]||0)}`;}catch{}}
      $('#item-assignment-skip').hidden=count>0;
      $('#item-member-picker').querySelectorAll('[data-assign-item]').forEach(box=>{const row=rows[Number(box.dataset.assignItem)];if(row){box.checked=row.memberIds.includes(assignmentMember);box.nextElementSibling.textContent=row.title||t('项目 {number}',{number:Number(box.dataset.assignItem)+1});box.parentElement.lastElementChild.textContent=`${row.amount||'0.00'} ${s.ledger.currency}`;}});
    }
    if(splitType==='amount')amountSummary(chosen);
    try {
      const {amount,shares,ids}=calculate(),payer=form.elements.payer.value,total=Object.values(shares).reduce((a,b)=>a+b,0),self=(shares[payer]||0)+(amount-total);
      if(splitType==='percent')form.querySelectorAll('[data-percent-result]').forEach(e=>{if(Object.hasOwn(shares,e.dataset.percentResult))e.textContent=money(shares[e.dataset.percentResult]);});
      const actual=consumptionShares({amountCents:amount,shares,payerMemberId:payer});
      $('#split-preview').innerHTML=`<div class="preview-list">${Object.keys(actual).map(id=>`<div class="preview-row"><span>${escape(memberName(id))}${id===payer?` <small>${t('垫付人')}</small>`:''}</span><strong>${money(actual[id])}</strong></div>`).join('')}</div>${amount-total?`<p class="form-hint">${t('未分配 {amount}，由垫付人承担。', {amount:money(amount-total)})}</p>`:''}<div class="preview-total"><span>${t('总额')}</span><strong>${money(amount)}</strong></div><p class="form-hint">${t('垫付人自付 {self}，待收回 {remaining}。', {self:money(self),remaining:money(amount-self-(editing?Object.values(initial.repaid||{}).reduce((sum,value)=>sum+value,0):0))})}</p>`;
    }catch(error){const blankItems=splitType==='items'&&readItemDrafts().every(row=>!row.title.trim()&&!row.amount.trim());$('#split-preview').innerHTML=`<p class="form-hint">${escape(blankItems?t('填写项目和金额，选择实际参与人。'):splitType==='items'||form.elements.amount.value?errorMessage(error):t('填写金额后，就能看到每人承担多少。'))}</p>`;}
  }
  if(!financialLocked){$('#percent-fields').insertAdjacentHTML('beforeend',`<button type="button" class="text-link" id="percent-reset">${t('重新均分比例')}</button>`);$('#percent-reset').addEventListener('click',()=>{percentEdited.clear();preview();saveDraft();});}
  $('#percent-fields').addEventListener('click',event=>{const button=event.target.closest('[data-percent-auto]');if(!button||financialLocked)return;percentEdited.delete(button.dataset.percentAuto);preview();saveDraft();form.querySelectorAll('[data-percent]').forEach(input=>{if(input.dataset.percent===button.dataset.percentAuto)input.focus();});});
  const chosenCount=()=>form.querySelectorAll('[name="participant"]:checked').length;
  form.addEventListener('input',event=>{if(event.target.hasAttribute('data-assign-item'))return;if(event.target.hasAttribute('data-share-amount'))amountDraftInitialized=true;if(event.target.hasAttribute('data-percent')){if(chosenCount()===2)percentEdited.clear();percentEdited.add(event.target.dataset.percent);}$('#form-error').hidden=true;preview();});
  form.addEventListener('change',preview);
  form.querySelectorAll('[data-split]').forEach(button=>button.addEventListener('click',()=>{
    const leavingItems=splitType==='items'&&button.dataset.split!=='items';
    let convertedItems=null;
    if(leavingItems){
      // Restore a manual draft when one exists. Otherwise initialize from the
      // same valid item calculation, including its participants and shares.
      if(!manualAmount.trim())try{
        convertedItems=calculate();manualAmount=amountText(convertedItems.amount);
        form.querySelectorAll('[name="participant"]').forEach(box=>box.checked=convertedItems.ids.includes(box.value));
      }catch{/* An unfinished item list cannot initialize another split method. */}
      form.elements.amount.value=manualAmount;
    }
    if(button.dataset.split==='amount'&&!amountDraftInitialized){
      try {
        const data=new FormData(form),amount=parseMoney(data.get('amount')),ids=data.getAll('participant');let shares;
        if(leavingItems)shares=convertedItems?.shares||splitShares(amount,ids);
        else try{shares=calculate().shares;}catch{shares=splitShares(amount,ids);}
        const remainder=amount-Object.values(shares).reduce((sum,value)=>sum+value,0),payer=data.get('payer');
        if(remainder&&ids.includes(payer))shares[payer]+=remainder;
        form.querySelectorAll('[data-share-amount]').forEach(input=>{if(Object.hasOwn(shares,input.dataset.shareAmount))input.value=amountText(shares[input.dataset.shareAmount]);});
        amountDraftInitialized=true;
      }catch{/* Leave fields empty until an amount and participants are available. */}
    }
    if(splitType!=='items')manualAmount=form.elements.amount.value;
    splitType=button.dataset.split;
    form.querySelectorAll('[data-split]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});
    updateMode();$('#form-error').hidden=true;preview();saveDraft();
  }));
  if(!editing&&!templateMode&&!recurring)saveButton.insertAdjacentHTML('beforebegin',`<button type="submit" class="button secondary" name="continueEntry" value="yes">${t('保存并继续记')}</button>`);
  form.addEventListener('submit',e=>submitForm(e,async data=>{
    if(addingMember)throw new Error('成员正在添加，请稍候再保存。');
    if(assignmentPending()){form.querySelector('.entry-member-add').open=true;$('#item-member-picker input')?.focus();throw new Error('请先选择参与项目，或选择暂不分摊。');}
    if(readingReceipts)throw new Error('收据正在处理，请稍候再保存。');
    if(memberTools&&!memberTools.readyToSave())return;
    const {amount,shares,items=[]}=calculate();
    const payload={title:data.get('title').trim(),date:data.get('date')||today,amountCents:amount,payerMemberId:form.elements.payer.value,shares,items,note:data.get('note').trim(),receipts};
    if(editing){payload.expectedVersion=initial.version||1;payload.changeReason=data.get('changeReason');payload.receipts=receipts.map(file=>file.id?{id:file.id}:file);}
    if(templateMode){payload.frequency=data.get('frequency');payload.startDate=payload.frequency==='none'?null:data.get('startDate');}
    if(recurring){payload.sourceTemplateId=initial.id;payload.sourceDate=options.occurrence.date;}
    if(context.draft){
      const signature=JSON.stringify([options.expenseId,options.templateMode,options.templateId,payload]);
      if(attempt?.signature!==signature)attempt={signature,key:randomId()};
      await saveDraft(true);
    }
    try{await onSave(payload,{...options,continueEntry:e.submitter?.name==='continueEntry',participantIds:calculate().ids,nextEntry:continuationOptions(payload,{splitType,participantIds:calculate().ids,percentages:draftValues('data-percent'),percentEdited:[...percentEdited]}),draftRequestKey:attempt?.key,draftCommitted:async()=>{draftComplete=true;await writer?.clear();}});}
    catch(error){
      if(editing&&context.draft&&(error.status===409||error.statusCode===409)){
        if(!$('#review-conflict')){$('#form-error').insertAdjacentHTML('afterend',`<button type="button" class="button secondary" id="review-conflict">${t('核对最新账单')}</button>`);$('#review-conflict').addEventListener('click',async()=>{await saveDraft(true);await context.onConflict();});}
        throw new Error('账单有新修改，请先核对差异。');
      }
      throw error;
    }
  }));
  if(recovered){
    for(const [name,value] of Object.entries(recovered.fields||{}))if(form.elements[name]&&name!=='participant')form.elements[name].value=value;
    form.querySelectorAll('[name="participant"]').forEach(input=>input.checked=recovered.participants.includes(input.value));
    for(const attribute of ['data-percent','data-share-amount'])form.querySelectorAll(`[${attribute}]`).forEach(input=>{input.value=recovered[attribute]?.[input.getAttribute(attribute)]??'';});
    if(templateMode)form.elements.frequency.dispatchEvent(new Event('change'));
  }
  updateMode();
  if(assignmentMember&&form.querySelector('.entry-member-add'))form.querySelector('.entry-member-add').open=true;
  if(financialLocked)form.querySelectorAll('[name="payer"],[name="participant"],[data-split],[data-percent],[data-share-amount],[data-item-title],[data-item-amount],[data-item-member],[data-remove-item],#add-item').forEach(input=>input.disabled=true);
  preview();
  if(splitType==='items'&&!recovered)form.elements.title.focus();
  if(context.onAddMembers&&!recurring&&!financialLocked){
    const selected=()=>splitType==='items'?[...new Set(readItemDrafts().flatMap(row=>row.memberIds))]:[...form.querySelectorAll('[name="participant"]:checked')].map(input=>input.value);
    let disabledBefore=[];
    function validateSelection(ids,replace,indexes){
      if(assignmentPending())throw new Error('请先选择参与项目，或选择暂不分摊。');
      if(new Set(replace?ids:[...selected(),...ids]).size>50)throw new Error('已选 50 人，请先取消一位再选择。');
      if(splitType==='items'&&(!indexes?.length||indexes.some(i=>!readItemDrafts()[i])))throw new Error('请至少选择一个消费项目。');
    }
    memberTools=mountParticipantTools({host:form.querySelector('.entry-member-add'),escape,members:s.members,user,owner:isOwner,recovered:recovered?.participantTools,
      items:()=>splitType==='items'?readItemDrafts():null,selected,validateSelection,busy:()=>addingMember||readingReceipts,
      setBusy(value){addingMember=value;if(value){disabledBefore=[...form.querySelectorAll('input,textarea,select,button')].map(el=>[el,el.disabled]);disabledBefore.forEach(([el])=>el.disabled=true);}else{disabledBefore.forEach(([el,disabled])=>{if(el.isConnected)el.disabled=disabled;});preview();}},
      changed(){preview();saveDraft();},loadDirectory:context.onLoadDirectory,addMembers:context.onAddMembers,saveGroup:context.onSaveGroup,deleteGroup:context.onDeleteGroup,
      apply(members,replace,indexes){
        const ids=members.map(m=>m.id);validateSelection(ids,replace,indexes);
        members.forEach(m=>registerMember(m));
        if(splitType==='items'){itemDrafts=readItemDrafts().map((row,i)=>indexes.includes(i)?{...row,memberIds:[...new Set([...row.memberIds,...ids])]}:row);renderItems(false);}
        else form.querySelectorAll('[name="participant"]').forEach(box=>box.checked=ids.includes(box.value)||!replace&&box.checked);
        $('#form-error').hidden=true;preview();saveDraft();
      }
    });
  }
  const capture=()=>({splitType,manualAmount:splitType==='items'?manualAmount:form.elements.amount.value,assignmentMember,participantTools:memberTools?.capture(),percentEdited:[...percentEdited],amountDraftInitialized,items:readItemDrafts(),receipts,
    fields:Object.fromEntries(['amount','title','payer','date','note','changeReason','frequency','startDate'].filter(name=>form.elements[name]).map(name=>[name,form.elements[name].value])),
    participants:[...form.querySelectorAll('[name="participant"]:checked')].map(input=>input.value),
    'data-percent':draftValues('data-percent'),'data-share-amount':draftValues('data-share-amount')});
  const baseline=JSON.stringify(capture());
  let writer,draftTouched=Boolean(recovered);
  if(context.draft){
    const draft=context.draft;
    form.querySelector('.form-actions').insertAdjacentHTML('beforebegin','<p id="draft-save-status" class="form-hint" role="status"></p>');
    const status=$('#draft-save-status');
    if(recovered)status.textContent=t('已恢复草稿');
    const rawOptions={...options,initial:{...initial,history:undefined}};
    writer=draftWriter(draft.store,draft.record||{key:draft.key},(state,error)=>{
      status.textContent=state==='saved'?t('草稿已保存在此设备'):state==='saving'?t('正在保存草稿…'):t(error?.message==='草稿已在另一个页面更新，请保留当前输入后重新打开。'?error.message:'无法保存草稿，请先不要关闭页面。');
    });
    saveDraft=(force=false)=>{
      if(draftComplete||!form.isConnected)return writer.flush();
      const value=capture();
      if(force!==true&&!draftTouched&&JSON.stringify(value)===baseline)return writer.flush();
      draftTouched=true;
      return writer.save({key:draft.key,scope:draft.scope,options:rawOptions,attempt,form:value,title:value.fields.title||t('未命名账单')});
    };
    form.addEventListener('input',saveDraft);form.addEventListener('change',saveDraft);
    form.querySelector('[data-action="close-dialog"]').textContent=t('稍后继续');
  }
  return {flush:saveDraft};
}
