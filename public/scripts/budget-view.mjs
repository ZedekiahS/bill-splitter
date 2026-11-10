import {t,translateError,registerMessages} from './i18n.mjs';
import {parseMoney,formatMoney} from './ledger-core.mjs';
import {budgetSummary} from './personal-budget.mjs';
import {randomId} from './random-id.mjs';
import messages from './budget-messages.mjs';
registerMessages(messages);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const decimal=value=>`${Math.floor(value/100)}.${String(value%100).padStart(2,'0')}`;
// The current report owns the visible budget region, even after navigation or
// a filter replaces its inner DOM while an older save is still in flight.
const budgetViews=new WeakMap();
export function bindBudgetView(config,refresh){budgetViews.set(config,refresh);}

export function mountBudget(target,{data,config,today,currency,onSave,onReload,onDetails,onSettled=()=>{}}){
  config.budgetMonth??=today.slice(0,7);
  function render(){
    const month=config.budgetMonth,money=value=>formatMoney(value,currency);
    let summary;
    try{summary=budgetSummary(data,month,currency);}catch(error){target.innerHTML=`<p class="form-error">${escape(translateError(error))}</p>`;return;}
    const {budget,spentCents,remainingCents}=summary,hasBudget=remainingCents!==null;
    const draft=config.budgetDraft,attempt=config.budgetAttempt,busy=config.budgetBusy;
    target.innerHTML=`<section class="budget-panel" aria-label="${t('个人月度预算')}"><div class="section-heading"><h2>${t('月度预算')} · ${escape(currency)}</h2><label class="form-field"><span class="sr-only">${t('预算月份')}</span><input class="form-input" type="month" min="0001-01" max="9999-12" required data-budget-month value="${escape(month)}" ${draft?'disabled':''}></label></div>
      ${hasBudget?`<div class="budget-values"><div><span>${t('预算金额')}</span><strong>${money(budget.amountCents)}</strong></div><button class="budget-spent text-link"><span>${t('已消费')}</span><strong>${money(spentCents)}</strong><small>${t('查看明细')}</small></button><div class="${remainingCents<0?'budget-over':''}"><span>${t(remainingCents<0?'超出预算':'预算剩余')}</span><strong>${money(Math.abs(remainingCents))}</strong></div></div><p class="form-hint">${t('按纳入统计的账本计算所选月份的全部个人消费。')}</p>`:''}
      ${draft?`<form id="budget-form"><p class="form-hint">${escape(draft.month)} · ${escape(draft.currency)} · ${t('仅自己可见')}</p><label class="form-field"><span class="field-label">${t('预算金额')}</span><input class="form-input" name="budgetAmount" inputmode="decimal" required value="${escape(draft.amount)}" ${attempt||busy?'readonly':''}></label><p class="form-error" role="alert" ${config.budgetError?'':'hidden'}>${escape(config.budgetError||'')}</p>${config.budgetConflict?`<button type="button" class="button secondary" data-budget-reload ${busy?'disabled':''}>${t('载入最新预算')}</button>`:''}<div class="form-actions"><button type="button" class="button secondary" data-budget-cancel ${busy?'disabled':''}>${t('取消')}</button>${draft.hadBudget&&!attempt?`<button type="button" class="text-link" data-budget-remove ${busy||config.budgetConflict?'disabled':''}>${t('移除预算')}</button>`:''}<button class="button primary" type="submit" ${busy||config.budgetConflict?'disabled':''}>${t(busy?'正在保存…':attempt?'核实预算保存':'保存预算')}</button></div></form>`:`<button class="text-link" data-budget-edit>${t(attempt?'核实预算保存':hasBudget?'修改预算':'设置月度预算')}</button>`}</section>`;
    const monthInput=target.querySelector('[data-budget-month]');
    monthInput.oninput=()=>{monthInput.dataset.editing='true';};
    monthInput.onchange=()=>{if(!monthInput.validity.valid){monthInput.reportValidity();return;}config.budgetMonth=monthInput.value;render();};
    target.querySelector('.budget-spent')?.addEventListener('click',()=>onDetails(month,currency));
    target.querySelector('[data-budget-edit]')?.addEventListener('click',()=>{
      config.budgetDraft=attempt?{month:attempt.payload.month,currency:attempt.payload.currency,amount:attempt.payload.amountCents==null?'':decimal(attempt.payload.amountCents),expectedVersion:attempt.payload.expectedVersion,hadBudget:true}:{month,currency,amount:hasBudget?decimal(budget.amountCents):'',expectedVersion:budget?.version||0,hadBudget:hasBudget};render();target.querySelector('[name="budgetAmount"]').focus();
    });
    const form=target.querySelector('#budget-form');if(!form)return;
    form.elements.budgetAmount.oninput=()=>{config.budgetDraft.amount=form.elements.budgetAmount.value;};
    target.querySelector('[data-budget-cancel]').onclick=()=>{delete config.budgetDraft;delete config.budgetError;delete config.budgetConflict;render();};
    async function save(remove=false){
      if(config.budgetBusy||config.budgetConflict)return;
      let budgets;
      try{
        if(!config.budgetAttempt)config.budgetAttempt={key:randomId(),payload:{month:draft.month,currency:draft.currency,amountCents:remove?null:parseMoney(draft.amount,{allowZero:true}),expectedVersion:draft.expectedVersion}};
        config.budgetBusy=true;render();
        data.budgets=budgets=await onSave(config.budgetAttempt.payload,config.budgetAttempt.key);
        delete config.budgetDraft;delete config.budgetAttempt;delete config.budgetError;delete config.budgetConflict;
      }catch(error){
        const status=error.status||error.statusCode;
        if(status&&status<500&&![401,403,408,429].includes(status))delete config.budgetAttempt;
        config.budgetConflict=status===409;
        config.budgetError=config.budgetAttempt?t('预算保存结果待核实，请重试核实。'):translateError(error);
      }finally{config.budgetBusy=false;if(budgetViews.has(config))budgetViews.get(config)(budgets);else render();onSettled();}
    }
    form.onsubmit=event=>{event.preventDefault();save();};
    target.querySelector('[data-budget-remove]')?.addEventListener('click',()=>save(true));
    target.querySelector('[data-budget-reload]')?.addEventListener('click',async()=>{
      let budgets;
      config.budgetBusy=true;render();try{
        data.budgets=budgets=await onReload();const fresh=data.budgets.find(b=>b.month===draft.month&&b.currency===draft.currency);
        draft.expectedVersion=fresh?.version||0;draft.hadBudget=fresh?.amountCents!=null;
        config.budgetConflict=false;config.budgetError=t('最新预算：{amount}。你的输入已保留，请核对后保存。',{amount:fresh?.amountCents==null?t('未设置'):formatMoney(fresh.amountCents,draft.currency)});
      }catch(error){config.budgetError=translateError(error);}finally{config.budgetBusy=false;if(budgetViews.has(config))budgetViews.get(config)(budgets);else render();onSettled();}
    });
  }
  render();
}
