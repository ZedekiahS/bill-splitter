import {t} from './i18n.mjs';

export function openLedgerCreation({store,getStore,openDialog,submitForm,projectFields,errorSlot,onCreated},type='general',{continueEntry=false}={}) {
  let root;
  const $=selector=>root.querySelector(selector);
  const operation=openDialog(t(type==='personal'?'创建个人账本':'新建共同账本'),`<form id="ledger-form"><label class="form-field"><span class="field-label">${t('账本名称')}</span><input class="form-input" name="title" placeholder="${t('例如：阳光合租 · 秋季')}" maxlength="60" required autofocus></label><label class="form-field"><span class="field-label">${t('记账币种')}</span><select class="form-select" name="currency"><option value="CNY">${t('人民币 CNY')}</option><option value="USD">${t('美元 USD')}</option></select></label>${type==='personal'?'':`<p class="form-hint">${t('一个账本使用一种币种，成员与账单都归在这本账里。')}</p>`}${errorSlot()}<div class="form-actions"><button type="button" class="button secondary" data-action="close-dialog">${t('取消')}</button><button class="button primary" type="submit">${t(continueEntry?'创建并记一笔':'创建账本')}</button></div></form>`,'',false,{endOnLeave:true});
  root=operation.element;
  $('#ledger-form [name="currency"]').closest('label').insertAdjacentHTML('beforebegin',type==='personal'?'<input type="hidden" name="projectType" value="personal">':projectFields({projectType:type}));
  if(type==='personal')$('#ledger-form [name="title"]').value=t('我的日常');
  const isCurrent=()=>operation.isCurrent()&&store===getStore();
  $('#ledger-form').addEventListener('submit',e=>submitForm(e,async data=>{
    if(!isCurrent()||!operation.canSubmit(e.target))return;
    let id;
    try{id=await store.createLedger({...Object.fromEntries(data),title:data.get('title').trim(),currency:data.get('currency'),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,ownerName:store.currentUser.displayName || t('我')});}
    catch(error){if(isCurrent())throw error;return;}
    if(!isCurrent())return;
    await onCreated(id,data.get('projectType'),{continueEntry,isCurrent});
  }));
}
