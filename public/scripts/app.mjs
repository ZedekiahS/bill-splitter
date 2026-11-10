import {openRefundEditor} from './refund-entry.mjs';
import refundMessages from './refund-messages.mjs';
import {categories,projectTypes,consumptionRows,checkedSum} from './expense-analytics.mjs';
import {mountConsumption} from './consumption-view.mjs';
import analyticsMessages from './analytics-messages.mjs';
import {calendarDate} from './ledger-time.mjs';
import { currentSession, createApiStore, signOut, apiRequest, uploadBackup } from './api-store.mjs';
import {paymentSubmission} from './payment-submission.mjs';
import accountMessages from './account-messages.mjs';
import { t, getLanguage, setLanguage, translatePage, formatDate, translateError, registerMessages } from './i18n.mjs';
import messages from './app-messages.mjs';
import { createStore } from './ledger-store.mjs';
import { parseMoney, formatMoney, splitShares, consumptionShares, memberBalances, remainingFor, expenseDebts, remainingBetween, refundedTotal, netExpenseAmount, settlementText } from './ledger-core.mjs';
import { openExpenseEditor } from './expense-entry.mjs';
import { dueOccurrences } from './expense-features.mjs';
import { receiptMarkup,openReceiptViewer,closeReceiptViewer } from './receipt-viewer.mjs';
import { historyMarkup } from './expense-history-view.mjs';
import featureMessages from './feature-messages.mjs';
import {settlementGroups,repaymentPlan,paymentGroups} from './settlement-plans.mjs';
import { bindExpenseSearch,filterExpenses } from './expense-search.mjs';
import { createAutoSync } from './auto-sync.mjs';
import {createDraftStore,draftScope,draftKey} from './expense-drafts.mjs';
import {randomId} from './random-id.mjs';
import {reconcileExpenseDraft,resolveExpenseDraft} from './expense-recovery.mjs';
import {ledgerExport,exportFileName} from './ledger-export.mjs';

registerMessages(messages);
registerMessages(refundMessages);
registerMessages(analyticsMessages);
registerMessages(accountMessages);
registerMessages(featureMessages);

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const params = new URLSearchParams(location.search);
const demo = params.get('demo') === '1';
const state = { store: null, ledgers: [], snapshot: null, view: location.hash.slice(1) || 'overview', filter: 'all', search: '', expenseFilters:{memberId:'',memberRole:'any',from:'',to:'',status:'all'}, filterError:'', filtersExpanded:null, expenseTab:'records', showArchived:false, starting: true, startupError: null, invitation: null, claimSubmitted: false };
const draftStore=createDraftStore();
let activeEditor=null,editorRequest=0;
let dataGeneration=0,loadingData=0,saving=0,syncSignature=null,autoSync=null,dialogRefresh=null;
let reportGeneration=0;
const reportConfigs={personal:{},project:{}};
const views = [{id:'overview',name:'总览',icon:'home'},{id:'expenses',name:'账单',icon:'receipt'},{id:'settlements',name:'结算',icon:'arrows'},{id:'members',name:'成员',icon:'people'},{id:'personal',name:'我的消费',icon:'chart'}];
const paths = {
  chart:'M4 3v18h17M8 16v-5m5 5V6m5 10v-8',
  home:'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
  receipt:'M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6M9 12h6',
  arrows:'M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4',
  people:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M15 4a4 4 0 0 1 0 8m7 9v-2a4 4 0 0 0-3-4M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  plus:'M12 5v14M5 12h14',
  arrow:'M5 12h14m-5-5 5 5-5 5',
  share:'M12 16V3m-4 4 4-4 4 4M5 10v11h14V10',
  check:'m5 12 4 4L19 6',
  close:'m6 6 12 12M6 18 18 6',
  book:'M4 4h7a3 3 0 0 1 3 3v14a3 3 0 0 0-3-3H4V4Zm10 3a3 3 0 0 1 3-3h3v14h-3a3 3 0 0 0-3 3',
  search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.receipt}"/></svg>`;
const money = cents => formatMoney(cents, state.snapshot?.ledger.currency || 'CNY');
const member = id => state.snapshot?.members.find(m => m.id === id);
const memberName = id => member(id)?.name || t('成员');
const mine = () => state.snapshot?.members.find(m => m.uid === state.store.currentUser.uid);
const owner = () => state.snapshot?.ledger.ownerUid === state.store.currentUser.uid;
const archived = () => state.snapshot?.ledger.status==='archived';
const canReceive = (expense,toMemberId=expense.payerMemberId) => !archived()&&(owner() || member(toMemberId)?.uid === state.store.currentUser.uid);
const activeExpenses = () => state.snapshot.expenses.filter(e => e.status !== 'reversed');
const outstanding = expense => expenseDebts(expense).reduce((n,row)=>n+row.amountCents,0);
const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const ledgerDate = () => calendarDate(state.snapshot?.ledger.timeZone);
const amountText = cents => `${Math.floor(cents/100)}.${String(cents%100).padStart(2,'0')}`;
const avatar = (name, cls='') => `<span class="avatar ${cls}" aria-hidden="true">${escape(Array.from(name || '?')[0])}</span>`;
const dateText = date => formatDate(date);

function toast(message) {
  const node = $('#toast'); node.textContent = message; node.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => {node.hidden = true;}, 4200);
}
function errorMessage(error) {
  return translateError(error);
}
function empty(title, text, action='') { return `<div class="empty-state">${icon('book')}<h3>${escape(title)}</h3><p>${escape(text)}</p>${action}</div>`; }
function heading(title, subtitle, actions='') {return `<div class="page-heading"><div class="heading-copy"><h1>${title}</h1><p>${subtitle}</p></div><div class="page-actions">${actions}</div></div>`;}
const newExpenseButton = () => archived()?'':`<button class="button primary" data-action="new-expense">${icon('plus')}${t('记一笔')}</button>`;

async function start() {
  $('.brand').href=demo?'app.html?demo=1':'app.html';
  const accountButton=document.createElement('button');
  accountButton.className='icon-button';accountButton.dataset.action='account';accountButton.dataset.i18nAriaLabel='登录与账号';accountButton.setAttribute('aria-label',t('登录与账号'));accountButton.innerHTML=icon('people');
  $('.topbar-actions').append(accountButton);
  const ledgerButton=document.createElement('button');ledgerButton.className='icon-button';ledgerButton.dataset.action='ledger-options';ledgerButton.setAttribute('aria-label',t('账本选项'));ledgerButton.dataset.i18nAriaLabel='账本选项';ledgerButton.innerHTML=icon('book');$('.topbar-actions').prepend(ledgerButton);
  try {
    let user;
    if (!demo) ({user} = await currentSession());
    if (!demo && !user) { showSignIn(); return; }
    const visitor = demo && params.has('invite') ? {uid:'demo-guest',displayName:t('新成员')} : undefined;
    state.store = demo ? createStore({mode:'demo',user:visitor}) : createApiStore(user);
    $('#account-name').textContent=state.store.currentUser.displayName || t('我的账号');
    $('.avatar-self').textContent=Array.from(state.store.currentUser.displayName || t('我'))[0];
    if (params.has('invite')) {await showInvitation(params.get('invite'));return;}
    await loadData();
  } catch(error) {state.startupError=error;showStartupError();}
  finally {state.starting=false;if(state.store?.mode==='api')startAutoSync();}
}
function showStartupError() {
  $('#main-content').innerHTML=empty(t('暂时无法打开账本'), errorMessage(state.startupError), `<a class="button primary" href="app.html?demo=1">${t('试用账本')}</a><a class="button secondary" href="index.html">${t('返回登录')}</a>`);
}
function showSignIn() {
  $('#account-name').textContent=t('未登录');
  $('.avatar-self').textContent='?';
  $('#main-content').innerHTML=empty(t('登录后，继续你的账本'),t('账号登录后可访问共享账本和提交成员认领。'),`<a class="button primary" href="index.html?next=${encodeURIComponent(location.pathname+location.search)}">${t('登录账号')}</a><a class="button secondary" href="app.html?demo=1">${t('先试用')}</a>`);
}
async function loadData(preferredId) {
  const generation=++dataGeneration;loadingData++;
  try {
  const oldId=state.snapshot?.ledger.id;
  const ledgers=await state.store.listLedgers();
  const id=[preferredId,oldId,params.get('ledger'),ledgers.find(row=>row.status!=='archived')?.id,ledgers[0]?.id].find(id=>ledgers.some(l=>l.id===id));
  const snapshot=id?await state.store.loadLedger(id):null;
  if(generation!==dataGeneration)return;
  state.ledgers=ledgers;state.snapshot=snapshot;
  if(id!==oldId){state.search='';state.filter='all';state.expenseFilters={memberId:'',memberRole:'any',from:'',to:'',status:'all'};state.expenseTab='records';state.showArchived=false;}
  state.startupError=null;render();
  if(id){const url=new URL(location.href);url.searchParams.set('ledger',id);url.hash=state.view;history.replaceState(null,'',url);}
  } finally {loadingData=Math.max(0,loadingData-1);}
}
function syncBlocked(){
  // Foreground loading/recovery owns the report until it finishes. Starting a
  // parallel background read would let an older snapshot overwrite that result.
  return state.starting||loadingData||saving||Boolean($('#budget-form'))||Boolean($('input[data-budget-month][data-editing="true"]'))||Boolean($('#consumption-report[aria-busy="true"]'))||Boolean(document.activeElement?.matches?.('#expense-search, #ledger-picker, .expense-filter-fields input, .expense-filter-fields select, input[data-report-filter][data-editing="true"]'));
}
async function syncChanges(){
  if(!state.store||syncBlocked())return;
  const generation=dataGeneration,reportVersion=reportGeneration,store=state.store,view=state.view;
  const valid=()=>generation===dataGeneration&&reportVersion===reportGeneration&&store===state.store&&view===state.view&&!syncBlocked();
  // Pending applicants have no ledger revision yet. Poll their invitation directly.
  if(params.has('invite')&&!state.inviteAccepted){
    try{
      const invite=await store.getInvite(params.get('invite'));if(!valid())return;
      if(invite.alreadyMember||invite.claimStatus!==state.invitation?.claimStatus||invite.status!==state.invitation?.status)await showInvitation(params.get('invite'));
    }catch(error){if([400,403,404].includes(error.status)&&valid()&&state.invitation)await showInvitation(params.get('invite'));else throw error;}
    return;
  }
  const updates=await store.listUpdates(),signature=JSON.stringify(updates);
  if(!valid()||signature===syncSignature)return;
  const ledgers=await store.listLedgers(),oldId=state.snapshot?.ledger.id;
  const id=[oldId,params.get('ledger'),ledgers.find(row=>row.status!=='archived')?.id,ledgers[0]?.id].find(id=>ledgers.some(row=>row.id===id));
  const snapshot=id?await store.loadLedger(id):null;
  if(!valid())return;
  // Fetch before repainting: keep the current report and any in-progress date input intact.
  const consumptionData=state.view==='personal'?await store.personalConsumption():undefined;
  if(!valid())return;
  const changed=Boolean(state.startupError)||JSON.stringify([state.ledgers,state.snapshot])!==JSON.stringify([ledgers,snapshot]);
  state.ledgers=ledgers;state.snapshot=snapshot;syncSignature=signature;state.startupError=null;
  if(!changed&&state.view!=='personal')return;
  if(id!==oldId){closeDialog();state.search='';state.filter='all';state.expenseFilters={memberId:'',memberRole:'any',from:'',to:'',status:'all'};state.expenseTab='records';state.showArchived=false;}
  const scrollY=window.scrollY;
  const reportFilter=document.activeElement?.dataset?.reportFilter;
  const expandedHistory=new Set([...document.querySelectorAll("details[data-history-id][open]")].map(row=>row.dataset.historyId));
  render({consumptionData});
  if(reportFilter)[...document.querySelectorAll('[data-report-filter]')].find(el=>el.dataset.reportFilter===reportFilter)?.focus({preventScroll:true});
  if($('#action-dialog').open)dialogRefresh?.();
  for(const row of document.querySelectorAll('details[data-history-id]'))row.open=expandedHistory.has(row.dataset.historyId);
  window.scrollTo({top:scrollY,behavior:'instant'});
  const url=new URL(location.href);if(id)url.searchParams.set('ledger',id);else url.searchParams.delete('ledger');history.replaceState(null,'',url);
}
function clearSession(){
  ++editorRequest;
  closeReceiptViewer();
  ++dataGeneration;loadingData=0;autoSync?.stop();closeDialog();
  reportConfigs.personal={};reportConfigs.project={};state.store=null;state.snapshot=null;state.ledgers=[];state.invitation=null;
  for(const selector of ['#primary-nav','#mobile-nav','#ledger-nav','#ledger-picker'])$(selector).innerHTML='';
  showSignIn();
}
function startAutoSync(){
  autoSync??=createAutoSync({check:syncChanges,onUnauthorized:clearSession});autoSync.start();
}
function render({consumptionData}={}) {
  // Returning to the same page still makes responses from its previous visit stale.
  ++reportGeneration;
  const nav = views.map(v=>`<button class="nav-item ${state.view===v.id?'active':''}" data-view="${v.id}" ${state.view===v.id?'aria-current="page"':''}>${icon(v.icon)}<span>${t(v.name)}</span></button>`).join('');
  $('#primary-nav').innerHTML=nav; $('#mobile-nav').innerHTML=nav;
  const activeLedgers=state.ledgers.filter(l=>l.status!=='archived'),archivedLedgers=state.ledgers.filter(l=>l.status==='archived');
  $('#ledger-picker').innerHTML=[...activeLedgers,...archivedLedgers].map(l=>`<option value="${escape(l.id)}" ${l.id===state.snapshot?.ledger.id?'selected':''}>${escape(l.title)}${l.status==='archived'?' · '+t('已归档'):''}</option>`).join('')+`<option value="__new__">${t('＋ 新建账本')}</option>${!demo?`<option value="__import__">${t('导入账本')}</option>`:''}`;
  $('#ledger-nav').innerHTML=activeLedgers.map(l=>`<button class="ledger-nav-item ${state.view!=='personal'&&l.id===state.snapshot?.ledger.id?'active':''}" data-ledger="${escape(l.id)}"><span class="ledger-dot"></span><span>${escape(l.title)}</span></button>`).join('');
  $('#ledger-nav').insertAdjacentHTML('beforeend',`<button class="text-link archived-ledgers-link" data-action="archived-ledgers">${t('已归档账本')}${archivedLedgers.length?` (${archivedLedgers.length})`:''}</button>`);
  document.querySelector('.scope-control').hidden=state.view==='personal';
  document.querySelector('[data-action="ledger-options"]').hidden=state.view==='personal';
  if(state.view==='personal'&&!state.snapshot){$('#main-content').innerHTML=consumptionShell(true);renderConsumption(consumptionData);return;}
  if (!state.snapshot) {$('#main-content').innerHTML=heading(t('从第一本账开始'),t('把一次旅行，或每一天的小账，记在一起。'))+empty(t('还没有共享账本'),t('新建账本后，可以先用名字添加成员。'),`<button class="button primary" data-action="new-ledger">${t('新建账本')}</button>${!demo?`<button class="button secondary" data-action="import-ledger">${t('导入账本')}</button>`:''}`);return;}
  if (state.view!=='project-stats'&&!views.some(v=>v.id===state.view)) state.view='overview';
  $('#main-content').innerHTML=({overview:overview,expenses:expensesView,settlements:settlementsView,members:membersView,personal:()=>consumptionShell(true),'project-stats':()=>consumptionShell(false)}[state.view])();
  $('#main-content').insertAdjacentHTML('afterbegin',state.view!=='personal'&&archived()?`<p class="ledger-archive-status">${t('已归档 · 只读')} ${owner()?`<button class="text-link" data-action="restore-ledger">${t('恢复账本')}</button>`:''}</p>`:'');
  if(state.view==='overview')renderPendingTasks();
  if(['personal','project-stats'].includes(state.view))renderConsumption(consumptionData);
  document.querySelector('.scope-control').hidden=state.view==='personal';
  document.querySelector('[data-action="ledger-options"]').hidden=state.view==='personal';
  if(state.view==='expenses'&&state.expenseTab==='saved-drafts')renderSavedDrafts();
  if(archived())$('#main-content').querySelectorAll('[data-action="new-template"],[data-use-template],[data-template-from-expense],[data-approve]').forEach(button=>button.hidden=true);
  if(state.view==='expenses'&&state.expenseTab==='records')bindExpenseSearch($('#expense-search'),value=>{state.search=value;updateExpenseResults();});
  document.querySelectorAll('[data-expense-filter]').forEach(input=>input.addEventListener('change',()=>{state.expenseFilters[input.dataset.expenseFilter]=input.value;if(input.dataset.expenseFilter==='status'){const shortcut=document.querySelector('[data-filter="open"]');shortcut?.classList.toggle('active',input.value==='open');shortcut?.setAttribute('aria-pressed',String(input.value==='open'));}updateExpenseResults();}));
}
function consumptionShell(personal){return heading(t(personal?'我的消费':'项目统计'),personal?t('按自己实际承担的金额，回看每一笔消费。'):escape(state.snapshot.ledger.title),personal?`<button class="button secondary" data-action="personal-ledger">${t('记日常开销')}</button>`:`<button class="button secondary" data-view="overview">${t('返回总览')}</button>`)+`<div id="consumption-report" aria-busy="true"><p role="status">${t('正在读取消费记录…')}</p></div>`;}
async function renderConsumption(suppliedData){
 const target=$('#consumption-report'),store=state.store,snapshot=state.snapshot,isPersonal=state.view==='personal',key=isPersonal?'personal':'project',reportVersion=reportGeneration;
 const valid=()=>target.isConnected&&state.store===store&&reportVersion===reportGeneration;
 try{
  const data=suppliedData??(isPersonal?await store.personalConsumption():{projects:[snapshot.ledger],rows:consumptionRows(snapshot),mineRows:consumptionRows(snapshot,{uid:store.currentUser.uid,personal:true})});
  if(!valid())return;
  if(!isPersonal&&reportConfigs.project.ledger!==snapshot.ledger.id)reportConfigs.project={ledger:snapshot.ledger.id,currency:snapshot.ledger.currency};
  mountConsumption(target,{data,personal:isPersonal,config:reportConfigs[key],today:localDate(),members:isPersonal?[]:snapshot.members.map(m=>({...m,rows:consumptionRows(snapshot,{memberId:m.id,personal:true})})),onReloadBudgets:async()=> (await store.personalConsumption()).budgets||[],onSaveBudget:async(payload,requestKey)=>{
    saving++;++reportGeneration;
    try{await store.savePersonalBudget(payload,requestKey);return (await store.personalConsumption()).budgets||[];}
    finally{saving--;if(state.store===store)++reportGeneration;autoSync?.wake();}
  },onBudgetSettled:()=>{if(state.store===store&&state.view==='personal'&&$('#consumption-report')!==target){++reportGeneration;renderConsumption();}},onInclusion:async(id,included)=>{
    saving++;++reportGeneration;
    try{await store.setAnalyticsInclusion(id,included);}
    finally{
      saving--;
      if(state.store===store){
        ++reportGeneration;
        // A return visit may be awaiting a report we just invalidated. Replace that
        // read even on failed writes: unchanged revisions cannot wake it via polling.
        // The original mounted view handles its own save result and inline error.
        const currentTarget=$('#consumption-report');
        if(state.view==='personal'&&currentTarget!==target&&currentTarget?.getAttribute('aria-busy')==='true')renderConsumption();
      }
      autoSync?.wake();
    }
  },onOpen:async row=>{
    try{if(row.ledgerId!==state.snapshot?.ledger.id)await loadData(row.ledgerId);showExpense(row.expenseId);}catch(error){toast(errorMessage(error));}
  }});
 }catch(error){if(valid())target.innerHTML=`<p class="form-error" role="alert">${escape(errorMessage(error))}</p><button class="button secondary" data-action="refresh">${t('重试')}</button>`;}
 finally{if(valid()){
  target.removeAttribute('aria-busy');
  // Resume polling even after a failed foreground read; supplied sync data does
  // not wake its own scheduler again. Discarded requests must not release it.
  if(isPersonal&&suppliedData===undefined)autoSync?.wake();
 }}
}
async function personalLedger(){
 const personal=state.ledgers.find(l=>l.projectType==='personal'&&l.ownerUid===state.store.currentUser.uid&&l.status!=='archived');
 if(personal){state.view='overview';await loadData(personal.id);newExpense();}else newLedger('personal');
}
function projectFields(ledger={}){
 return `<label class="form-field"><span class="field-label">${t('账本类型')}</span><select class="form-select" name="projectType">${Object.entries(projectTypes).map(([id,label])=>`<option value="${id}" ${id===(ledger.projectType||'general')?'selected':''}>${t(label)}</option>`).join('')}</select></label><div class="form-grid"><label class="form-field"><span class="field-label">${t('活动开始（选填）')}</span><input class="form-input" type="date" name="startDate" value="${escape(ledger.startDate||'')}"></label><label class="form-field"><span class="field-label">${t('活动结束（选填）')}</span><input class="form-input" type="date" name="endDate" value="${escape(ledger.endDate||'')}"></label></div>`;
}
function projectSettings(){
 const ledger=state.snapshot.ledger;
 openDialog(t('项目与账本设置'),`<form id="project-form"><label class="form-field"><span class="field-label">${t('账本名称')}</span><input class="form-input" name="title" required maxlength="120" value="${escape(ledger.title)}"></label>${projectFields(ledger)}<label class="form-field"><span class="field-label">${t('活动状态')}</span><select class="form-select" name="activityStatus"><option value="ongoing">${t('进行中')}</option><option value="ended" ${ledger.activityStatus==='ended'?'selected':''}>${t('已结束')}</option></select></label><p class="form-hint">${t('活动结束后仍可补账和还款；全部处理好后再归档。')}</p>${errorSlot()}<div class="form-actions"><button class="button primary" type="submit">${t('保存')}</button></div></form>`);
 $('#project-form').addEventListener('submit',event=>submitForm(event,async data=>{await state.store.updateProject(ledger.id,{...Object.fromEntries(data),expectedVersion:ledger.projectVersion||1});await finishSave(t('账本设置已保存。'));}));
}
function myTotals() {
  const id=mine()?.id; let receivable=0,payable=0;
  for(const e of activeExpenses())for(const debt of expenseDebts(e)){if(debt.toMemberId===id)receivable+=debt.amountCents;if(debt.fromMemberId===id)payable+=debt.amountCents;}
  return {receivable,payable};
}
function statusFor(e) {
  if (e.status==='reversed') return `<span class="badge neutral">${t('已撤销')}</span>`;
  if (outstanding(e)===0) return `<span class="badge success">${t('已结清')}</span>`;
  if (expenseDebts(e).some(d=>d.fromMemberId===e.payerMemberId)) return `<span class="badge pending">${t('退款后待结清')}</span>`;
  if (Object.values(e.repaid || {}).some(v=>v>0)) return `<span class="badge pending">${t('部分已还')}</span>`;
  return `<span class="badge neutral">${t('待结清')}</span>`;
}
function expenseRows(list) {
  if (!list.length) return empty(t('这里还没有账单'),t('记下第一笔共同开销，分摊结果会清楚列出来。'),newExpenseButton());
  return `<div class="expense-list">${list.map(e=>{
    const id=mine()?.id;
    const debts=expenseDebts(e),incoming=debts.filter(d=>d.toMemberId===id).reduce((n,d)=>n+d.amountCents,0),outgoing=debts.filter(d=>d.fromMemberId===id).reduce((n,d)=>n+d.amountCents,0);
    const relation=e.status==='reversed'?t('已撤销'):[incoming?`${t('待收')} ${money(incoming)}`:'',outgoing?`${t('我待付')} ${money(outgoing)}`:''].filter(Boolean).join(' · ')||t('已结清');
    return `<button class="expense-row" data-expense="${escape(e.id)}"><span class="expense-icon">${icon('receipt')}</span><span class="expense-info"><span class="expense-title">${escape(e.title)} ${statusFor(e)}</span><span class="expense-meta">${t('{name}垫付', {name:escape(memberName(e.payerMemberId))})} · ${escape(dateText(e.date))} · ${t('{count}人参与', {count:Object.keys(e.shares).length})}</span></span><span class="expense-amount"><strong>${money(netExpenseAmount(e))}</strong><small>${relation}</small></span>${icon('arrow')}</button>`;
  }).join('')}</div>`;
}
const createdTime = value => value?.toMillis ? value.toMillis() : Date.parse(value) || 0;
const newestFirst = (a,b) => String(b.date).localeCompare(String(a.date)) || createdTime(b.createdAt)-createdTime(a.createdAt);
function sortedExpenses(){return [...state.snapshot.expenses].sort(newestFirst);}
function sortedPayments(){return [...state.snapshot.payments].sort(newestFirst);}
function overview() {
  const s=state.snapshot, totals=myTotals(), active=activeExpenses();
  const mineSpent=checkedSum(consumptionRows(s,{uid:state.store.currentUser.uid,personal:true}).map(r=>r.amountCents)),paid=checkedSum(active.filter(e=>e.payerMemberId===mine()?.id).map(e=>e.amountCents));
  if(s.ledger.projectType==='personal'&&s.members.length===1)return heading(escape(s.ledger.title),t('个人日常'),`<button class="button secondary" data-view="project-stats">${t('项目统计')}</button>`+newExpenseButton())+`<section id="pending-tasks" class="pending-tasks" hidden></section><div class="report-total"><div><span>${t('我的实际消费')}</span><strong>${money(mineSpent)}</strong></div><button class="text-link" data-view="personal">${t('我的消费')}</button></div><section class="panel"><div class="section-heading"><h2>${t('最近账单')}</h2><button class="text-link" data-view="expenses">${t('查看全部')}</button></div>${expenseRows(sortedExpenses().slice(0,5))}</section>`;
  const effective=paymentGroups(sortedPayments()).filter(p=>p.type==='payment'&&!p.reversedBy).slice(0,3);
  const memberList=s.members.slice(0,4).map(m=>`<div class="member-row">${avatar(m.name)}<div class="member-info"><strong>${escape(m.name)}${m.uid===state.store.currentUser.uid?` <span class="me-label">${t('我')}</span>`:''}</strong><small>${m.uid?t('已加入'):t('临时成员')}</small></div><span class="member-amount">${balanceLabel(m.id)}</span></div>`).join('');
  return heading(escape(s.ledger.title),[t(projectTypes[s.ledger.projectType||'general']),s.ledger.activityStatus==='ended'?t('活动已结束'):null,[s.ledger.startDate,s.ledger.endDate].filter(Boolean).join(' — '),t('{count}位成员',{count:s.members.length})].filter(Boolean).map(escape).join(' · '),`<button class="button secondary" data-view="project-stats">${icon('chart')}${t('项目统计')}</button>`+newExpenseButton())+
    `<dl class="project-totals"><div><dt>${t('项目总开销')}</dt><dd>${money(checkedSum(active.map(netExpenseAmount)))}</dd></div><div><dt>${t('我的实际消费')}</dt><dd>${money(mineSpent)}</dd></div><div><dt>${t('我先付了')}</dt><dd>${money(paid)}</dd></div></dl>`+
    `<section class="pending-tasks" id="pending-tasks" hidden></section><div class="overview-grid"><div class="main-column"><section class="balance-strip" aria-label="${t('我的待收待付')}"><div class="balance-block"><span class="balance-label">${t('待收回')}</span><strong class="balance-amount amount-in">${money(totals.receivable)}</strong><span class="balance-note">${t('等待伙伴转账')}</span></div><div class="balance-block"><span class="balance-label">${t('待支付')}</span><strong class="balance-amount">${money(totals.payable)}</strong><span class="balance-note">${t('确认转账后，由收款人记一笔')}</span></div><div class="balance-footer"><button class="text-link" data-view="settlements">${t('查看结算')} ${icon('arrow')}</button></div></section>
    <section class="panel"><div class="section-heading"><h2>${t('最近账单')}</h2><button class="text-link" data-view="expenses">${t('查看全部')} ${icon('arrow')}</button></div>${expenseRows(sortedExpenses().slice(0,5))}</section>
    <section class="panel-quiet"><div class="section-heading"><h2>${t('最近还款')}</h2><button class="text-link" data-view="settlements">${t('全部记录')}</button></div>${effective.length?effective.map(p=>`<div class="activity-row"><span class="activity-icon">${icon('check')}</span><div><strong>${escape(memberName(p.fromMemberId))} → ${escape(memberName(p.toMemberId))}</strong><small>${escape(dateText(p.date))} ${t('· 已确认收款')}</small></div><strong>${money(p.amountCents)}</strong></div>`).join(''):`<p class="muted">${t('第一笔收款确认后，记录会出现在这里。')}</p>`}</section></div>
    <aside class="side-column"><section class="panel"><div class="section-heading"><h2>${t('成员净余额')}</h2><span class="count-label">${t('{count}人', {count:s.members.length})}</span></div>${memberList}<button class="button secondary full-width" data-view="members">${icon('people')}${t('管理成员与邀请')}</button></section><section class="share-panel"><span class="share-symbol">${icon('share')}</span><h2>${t('一张清单，把账说明白。')}</h2><p>${t('把待结清的金额整理好，分享给一起消费的伙伴。')}</p><button class="button secondary" data-action="share">${t('预览结算单')} ${icon('arrow')}</button></section></aside></div>`;
}
async function renderPendingTasks(){
 const target=$('#pending-tasks'),snapshot=state.snapshot,scope=currentDraftScope();if(!target||archived())return;
 let drafts=[];try{drafts=await draftStore.list(scope);}catch{}
 if(!target.isConnected||scope!==currentDraftScope())return;
 const due=dueOccurrences(snapshot.templates||[],snapshot.occurrences||[],ledgerDate()).filter(row=>{const template=snapshot.templates.find(t=>t.id===row.templateId);return canManageTemplate(template);});
 const claims=(snapshot.claims||[]).filter(c=>c.status==='pending'&&snapshot.invites.some(i=>i.id===c.inviteToken&&i.status==='open'&&Date.parse(i.expiresAt)>Date.now()));
 const actions=[drafts.length?`<button class="text-link" data-pending="saved-drafts">${t('继续 {count} 份草稿',{count:drafts.length})}</button>`:'',due.length?`<button class="text-link" data-pending="drafts">${t('确认 {count} 笔周期账单',{count:due.length})}</button>`:'',claims.length?`<button class="text-link" data-view="members">${t('处理 {count} 条认领申请',{count:claims.length})}</button>`:''].filter(Boolean);
 target.hidden=!actions.length;target.innerHTML=actions.length?`<h2>${t('待处理')}</h2>${actions.join('')}`:'';
}
function balanceLabel(id) {
  const b=memberBalances(state.snapshot).find(x=>x.memberId===id)?.balanceCents || 0;
  return b===0?`<span class="muted">${t('已平衡')}</span>`:b>0?`<span class="amount-in">${t('待收')} ${money(b)}</span>`:`${t('待付')} ${money(-b)}`;
}
function filteredExpenses() {
  const id=mine()?.id;
  try{state.filterError='';return filterExpenses(sortedExpenses(),{...state.expenseFilters,query:state.search}).filter(e=>state.filter==='all'||state.filter==='mine'&&e.payerMemberId===id||state.filter==='participating'&&Object.hasOwn(consumptionShares(e),id));}
  catch(error){state.filterError=errorMessage(error);return [];}
}
const hasExpenseFilters = () => Boolean(state.search.trim())||state.filter!=='all'||Boolean(state.expenseFilters.memberId||state.expenseFilters.from||state.expenseFilters.to)||state.expenseFilters.status!=='all';
function expenseFilterSummary(){
  const f=state.expenseFilters,parts=[];
  if(f.memberId){const member=state.snapshot.members.find(m=>m.id===f.memberId);parts.push(`${member?.name||t('成员')} · ${t(f.memberRole==='payer'?'垫付人':f.memberRole==='participant'?'参与人':'垫付或参与')}`);}
  if(f.from)parts.push(`${t('开始日期')} ${f.from}`);
  if(f.to)parts.push(`${t('结束日期')} ${f.to}`);
  return parts.join(' · ');
}
function expenseFilterFields(){
  const f=state.expenseFilters,expanded=state.filtersExpanded??!globalThis.matchMedia?.('(max-width:700px)').matches,summary=expenseFilterSummary();
  return `<div class="expense-filter-toolbar"><label class="form-field"><span class="field-label">${t('状态')}</span><select class="form-select" data-expense-filter="status">${[['all',t('全部')],['open',t('未结清')],['settled',t('已结清')],['reversed',t('已撤销')]].map(([id,label])=>`<option value="${id}" ${f.status===id?'selected':''}>${label}</option>`).join('')}</select></label><button type="button" class="button secondary" data-action="toggle-expense-filters" aria-controls="advanced-expense-filters" aria-expanded="${expanded}">${t(expanded?'收起筛选':'更多筛选')}</button></div><div id="advanced-expense-filters" class="expense-filter-fields" ${expanded?'':'hidden'}><label class="form-field"><span class="field-label">${t('成员')}</span><select class="form-select" data-expense-filter="memberId"><option value="">${t('全部成员')}</option>${state.snapshot.members.map(m=>`<option value="${escape(m.id)}" ${f.memberId===m.id?'selected':''}>${escape(m.name)}</option>`).join('')}</select></label><label class="form-field"><span class="field-label">${t('成员身份')}</span><select class="form-select" data-expense-filter="memberRole" ${f.memberId?'':'disabled'}>${[['any',t('垫付或参与')],['payer',t('垫付人')],['participant',t('参与人')]].map(([id,label])=>`<option value="${id}" ${f.memberRole===id?'selected':''}>${label}</option>`).join('')}</select></label><label class="form-field"><span class="field-label">${t('开始日期')}</span><input class="form-input" type="date" data-expense-filter="from" value="${escape(f.from)}"></label><label class="form-field"><span class="field-label">${t('结束日期')}</span><input class="form-input" type="date" data-expense-filter="to" value="${escape(f.to)}"></label></div><p id="expense-filter-summary" class="form-hint" ${summary?'':'hidden'}>${escape(summary)}</p><p id="expense-filter-error" class="form-error" role="alert" ${state.filterError?'':'hidden'}>${escape(state.filterError)}</p>`;
}
function expenseResults(list) {
  if(!list.length&&state.snapshot.expenses.length&&hasExpenseFilters())return empty(t('没有符合条件的账单'),t('换个关键词，或清除筛选后再试。'));
  return expenseRows(list);
}
function updateExpenseResults() {
  const list=filteredExpenses();
  const summary=$('#expense-filter-summary');summary.textContent=expenseFilterSummary();summary.hidden=!summary.textContent;
  document.querySelector('[data-expense-filter="memberRole"]').disabled=!state.expenseFilters.memberId;
  $('#expense-filter-error').textContent=state.filterError;$('#expense-filter-error').hidden=!state.filterError;
  $('#expense-result-count').textContent=t('{count}笔账单',{count:list.length});
  $('#clear-expense-filters').hidden=!hasExpenseFilters();
  $('#expense-results').innerHTML=expenseResults(list);
}
function expensesView() {
  const filtered=filteredExpenses();
  const due=archived()?[]:dueOccurrences(state.snapshot.templates || [],state.snapshot.occurrences || [],ledgerDate());
  const tabs=`<div class="expense-tabs" role="group" aria-label="${t('账单内容')}">${[['records',t('已记账')],['saved-drafts',t('草稿')],['drafts',t('待确认')+(due.length?` (${due.length})`:'')],['templates',t('模板与周期')],['history',t('操作历史')]].map(([id,label])=>`<button class="chip ${state.expenseTab===id?'active':''}" data-expense-tab="${id}" aria-pressed="${state.expenseTab===id}">${label}</button>`).join('')}</div>`;
  const top=heading(t('每一笔，都有来处。'),t('查看共同开销，也看清自己承担的部分。'),newExpenseButton())+tabs;
  if(state.expenseTab==='saved-drafts')return top+`<section class="panel" id="saved-drafts"><p class="muted">${t('正在读取草稿…')}</p></section>`;
  if(state.expenseTab==='templates')return top+templatesView();
  if(state.expenseTab==='drafts')return top+draftsView(due);
  if(state.expenseTab==='history')return top+`<section class="panel">${historyMarkup(state.snapshot)}</section>`;
  return top+
  `<div class="filter-bar"><div class="filter-chips">${[['all',t('全部')],['mine',t('我垫付')],['participating',t('我参与')],['open',t('未结清')]].map(([id,label])=>`<button class="chip ${(id==='open'?state.expenseFilters.status==='open':state.filter===id)?'active':''}" data-filter="${id}" aria-pressed="${id==='open'?state.expenseFilters.status==='open':state.filter===id}">${label}</button>`).join('')}</div><label class="search-field">${icon('search')}<input id="expense-search" type="search" placeholder="${t('搜索账单')}" aria-label="${t('搜索账单')}" value="${escape(state.search)}" aria-controls="expense-results"></label></div>${expenseFilterFields()}<div class="expense-results-summary"><p id="expense-result-count" role="status" aria-live="polite">${t('{count}笔账单',{count:filtered.length})}</p><button id="clear-expense-filters" class="text-link" data-action="clear-expense-filters" ${hasExpenseFilters()?'':'hidden'}>${t('清除筛选')}</button></div><section id="expense-results" class="panel">${expenseResults(filtered)}</section>`;
}
const canManageTemplate = template => !archived()&&(owner() || template.createdByUid===state.store.currentUser.uid);
const scheduleLabel = frequency => ({none:t('按需使用'),weekly:t('每周'),monthly:t('每月'),yearly:t('每年')})[frequency];
function templatesView() {
  const templates=(state.snapshot.templates || []).filter(template=>state.showArchived?template.status==='archived':template.status!=='archived');
  return `<section class="panel plan-section"><div class="section-heading"><h2>${state.showArchived?t('已归档模板'):t('常用账单')}</h2><button class="text-link" data-action="toggle-archived">${state.showArchived?t('返回常用模板'):t('查看归档')}</button><button class="button secondary" data-action="new-template">${icon('plus')}${t('新建模板')}</button></div>${templates.length?`<div class="plan-list">${templates.map(template=>`<div class="plan-row"><div class="plan-info"><strong>${escape(template.title)} ${template.status==='paused'?`<span class="badge neutral">${t('已暂停')}</span>`:''}</strong><small>${scheduleLabel(template.frequency)}${template.startDate?' · '+escape(template.startDate):''} · ${t('{name}垫付',{name:escape(memberName(template.payerMemberId))})}</small></div><strong class="plan-amount">${money(template.amountCents)}</strong><div class="plan-actions">${template.status==='archived'&&canManageTemplate(template)?`<button class="button secondary small-button" data-template-status="active" data-template-id="${escape(template.id)}">${t('恢复')}</button>`:''}<button ${template.status==='archived'?'hidden':''} class="button secondary small-button" data-use-template="${escape(template.id)}">${t('使用模板')}</button>${canManageTemplate(template)&&template.status!=='archived'?`<button class="text-link" data-edit-template="${escape(template.id)}">${t('编辑')}</button>${template.frequency!=='none'?`<button class="text-link" data-template-status="${template.status==='paused'?'active':'paused'}" data-template-id="${escape(template.id)}">${template.status==='paused'?t('恢复'):t('暂停')}</button>`:''}<button class="text-link" data-template-status="archived" data-template-id="${escape(template.id)}">${t('归档')}</button>`:''}</div></div>`).join('')}</div>`:empty(state.showArchived?t('没有已归档模板'):t('把常用开销存成模板'),state.showArchived?'':t('保存金额和分摊，下次直接使用；设置周期后，到期再确认。'))}</section>`;
}
function draftsView(due) {
  if(!due.length)return `<section class="panel">${empty(t('没有待确认的周期账单'),t('设置周期模板后，到期账单会出现在这里。'),`<button class="button secondary" data-action="new-template">${t('新建模板')}</button>`)}</section>`;
  return `<section class="panel plan-section"><div class="section-heading"><h2>${t('到期待确认')}</h2><span class="count-label">${t('{count}笔账单',{count:due.length})}</span></div><p class="form-hint">${t('确认后才计入支出；未发生的开销可以跳过本期。')}</p><div class="plan-list">${due.map(draft=>{const template=state.snapshot.templates.find(row=>row.id===draft.templateId);return `<div class="plan-row"><div class="plan-info"><strong>${escape(template.title)}</strong><small>${escape(draft.date)} · ${scheduleLabel(template.frequency)}</small></div><strong class="plan-amount">${money(template.amountCents)}</strong><div class="plan-actions">${canManageTemplate(template)?`<button class="button primary small-button" data-confirm-template="${escape(template.id)}" data-occurrence-date="${draft.date}">${t('确认账单')}</button><button class="text-link" data-skip-template="${escape(template.id)}" data-occurrence-date="${draft.date}">${t('跳过本期')}</button>`:`<span class="form-hint">${t('待创建人或管理员确认')}</span>`}</div></div>`;}).join('')}</div></section>`;
}
function settlementsView() {
  const myId=mine()?.id,all=state.settlementScope==='all';
  const groups=settlementGroups(activeExpenses()).filter(g=>all||g.fromMemberId===myId||g.toMemberId===myId).sort((a,b)=>Number(b.fromMemberId===myId)-Number(a.fromMemberId===myId)),payments=paymentGroups(sortedPayments()).filter(p=>all||p.fromMemberId===myId||p.toMemberId===myId);
  return heading(t('结清一笔，轻松一分。'),t('还款记录保留在这里，来龙去脉都能查到。'),`<button class="button secondary" data-action="my-statement">${icon('share')}${t('我的结算单')}</button><button class="text-link" data-action="share">${t('分享结算单')}</button>${newExpenseButton()}`)+
    `<div class="settlement-scope" role="group" aria-label="${t('统计口径')}">${[['mine','我的往来'],['all','全部往来']].map(([id,label])=>`<button class="chip ${(all?id==='all':id==='mine')?'active':''}" data-settlement-scope="${id}" aria-pressed="${all?id==='all':id==='mine'}">${t(label)}</button>`).join('')}</div>`+
    `<div class="overview-grid"><div class="main-column"><section class="panel"><div class="section-heading"><h2>${t('待结清')}</h2><span class="count-label">${t('{count}笔往来',{count:groups.length})}</span></div>${groups.length?groups.map((group,index)=>`${!all&&(index===0||(groups[index-1].fromMemberId===myId)!==(group.fromMemberId===myId))?`<h3>${t(group.fromMemberId===myId?'我要付给谁':'谁需要付给我')}</h3>`:''}<div class="settlement-group"><div class="settlement-row">${avatar(memberName(group.fromMemberId))}<div class="member-info"><strong>${escape(memberName(group.fromMemberId))} → ${escape(memberName(group.toMemberId))}</strong><small>${t('{count}笔账单',{count:group.expenses.length})}</small></div><strong class="settlement-amount">${money(group.totalCents)}</strong>${canReceive(group.expenses[0],group.toMemberId)?`<button class="button secondary small-button" data-batch-from="${escape(group.fromMemberId)}" data-batch-to="${escape(group.toMemberId)}">${t('记录收款')}</button>`:`<span class="badge neutral">${t('待收款人确认')}</span>`}</div><details><summary>${t('查看明细')}</summary>${group.expenses.map(e=>`<div class="settlement-line"><button class="text-link" data-expense="${escape(e.id)}">${escape(e.title)}</button><span>${escape(dateText(e.date))}</span><strong>${money(e.remainingCents)}</strong></div>`).join('')}</details></div>`).join(''):empty(t(all?'这个账本已经结清':'没有未结清的往来。'),all?t('每一笔共同开销都已对上。'):'')}</section>
    <section class="panel-quiet"><div class="section-heading"><h2>${t('还款流水')}</h2><span class="count-label">${t('{count}条记录',{count:payments.length})}</span></div>${payments.length?payments.map(p=>{const e=state.snapshot.expenses.find(e=>e.id===p.expenseId);return `<div class="payment-record"><div class="journal-row"><div><strong>${p.type==='reversal'?t('撤销收款'):`${escape(memberName(p.fromMemberId))} → ${escape(memberName(p.toMemberId))}`}</strong><small>${escape(dateText(p.date))} · ${t('{count}笔账单',{count:p.entries.length})}${p.type==='payment'&&p.note?' · '+escape(p.note):''}</small></div><strong>${p.type==='reversal'?'−':''}${money(p.amountCents)}</strong>${p.reversedBy?`<span class="badge neutral">${t('已撤销')}</span>`:p.type==='payment'&&e&&canReceive(e,p.toMemberId)?`<button class="text-link" ${p.batchId?'data-reverse-batch':'data-reverse-payment'}="${escape(p.id)}">${t('撤销')}</button>`:''}</div><details><summary>${t('查看抵扣明细')}</summary>${p.entries.map(row=>`<div class="settlement-line"><button class="text-link" data-expense="${escape(row.expenseId)}">${escape(state.snapshot.expenses.find(e=>e.id===row.expenseId)?.title||t('账单'))}</button><strong>${money(row.amountCents)}</strong></div>`).join('')}</details></div>`;}).join(''):`<p class="muted">${t('记录部分或全部收款后，会生成一条可追溯的流水。')}</p>`}</section></div><aside class="side-column"><section class="panel"><div class="section-heading"><h2>${t('成员净余额')}</h2></div>${state.snapshot.members.map(m=>`<div class="member-row">${avatar(m.name)}<div class="member-info"><button class="text-link" data-member-detail="${escape(m.id)}">${escape(m.name)}</button></div><span class="member-amount">${balanceLabel(m.id)}</span></div>`).join('')}<p class="form-hint">${t('净余额用于核对，不会自动抵扣双方的原始账单。')}</p></section></aside></div>`;
}
function membersView() {
  const claims=(state.snapshot.claims || []).filter(c=>c.status==='pending'&&state.snapshot.invites.some(i=>i.id===c.inviteToken&&i.status==='open'&&Date.parse(i.expiresAt)>Date.now()));
  return heading(t('一起记，才能一起算清。'),t('先用名字添加伙伴，邀请认领后再连接到本人账号。'),!archived()?`<button class="button secondary" data-action="new-member">${icon('plus')}${t('添加成员')}</button>${newExpenseButton()}`:'')+
    `<div class="overview-grid"><section class="panel">${state.snapshot.members.map(m=>`<div class="member-row spacious">${avatar(m.name)}<div class="member-info"><strong>${escape(m.name)}${m.uid===state.store.currentUser.uid?` <span class="me-label">${t('我')}</span>`:''}</strong><small>${m.status==='inactive'?t('已停用'):m.uid===state.snapshot.ledger.ownerUid?t('账本创建者'):m.uid?t('已认领 · 可共同记账'):t('临时成员 · 认领前由账本创建者代记')}</small></div><button class="text-link" data-member-detail="${escape(m.id)}">${t('查看往来')}</button>${!m.uid&&!archived()&&(owner()||m.createdByUid===state.store.currentUser.uid)?`<button class="text-link" data-edit-member="${escape(m.id)}">${t('编辑')}</button>`:''}${m.uid?`<span class="badge success">${t('已加入')}</span>`:owner()&&!archived()&&m.status!=='inactive'?`<button class="button secondary small-button" data-invite-member="${escape(m.id)}">${t('邀请认领')}</button>`:`<span class="badge neutral">${t('待认领')}</span>`}</div>`).join('')}</section><aside class="side-column"><section class="panel"><div class="section-heading"><h2>${t('认领申请')}</h2><span class="count-label">${claims.length}</span></div>${owner()?claims.length?claims.map(c=>{const invite=state.snapshot.invites.find(i=>i.id===c.inviteToken);return `<div class="claim-row"><p>${t('{name}申请认领「{member}」', {name:`<strong>${escape(c.displayName)}</strong>`,member:escape(invite?.memberName || t('成员'))})}</p><button class="button primary full-width" data-approve="${escape(c.inviteToken)}" data-uid="${escape(c.uid)}">${t('核对本人后批准')}</button><button class="text-link" data-reject-claim="${escape(c.inviteToken)}" data-uid="${escape(c.uid)}">${t('拒绝申请')}</button></div>`;}).join(''):`<p class="muted">${t('伙伴通过邀请链接申请后，会在这里等待你的确认。')}</p>`:`<p class="muted">${t('认领申请由账本创建者核对与批准。')}</p>`}</section></aside></div>`;
}

function openDialog(title,body,footer='',wide=false) {
  activeEditor?.flush();activeEditor=null;
  dialogRefresh=null;
  const d=$('#action-dialog'); d.classList.remove('history-dialog');d.classList.toggle('wide-dialog',wide);
  $('#dialog-content').innerHTML=`<div class="dialog-header"><h2 id="dialog-title">${title}</h2><button class="dialog-close icon-button" data-action="close-dialog" aria-label="${t('关闭')}">${icon('close')}</button></div><div class="dialog-body">${body}</div>${footer?`<div class="dialog-footer">${footer}</div>`:''}`;
  if (!d.open)d.showModal();else d.querySelector('[autofocus]')?.focus();
}
function closeDialog() {activeEditor?.flush();activeEditor=null;$('#action-dialog').close();}
function formError(message) {const e=$('#form-error');if(e&&(!e.closest('dialog')||e.closest('dialog').open)){e.textContent=message;e.hidden=false;}else toast(message);}
function errorSlot(){return '<p class="form-error" id="form-error" role="alert" hidden></p>';}
async function finishSave(success,preferredId) {
  closeDialog();
  try {await loadData(preferredId);toast(success);}
  catch {toast(t('已保存，但刷新失败。请刷新账本查看最新记录，无需重复提交。'));}
}
async function submitForm(event, action) {
  event.preventDefault();const form=event.target,button=event.submitter||form.querySelector('[type="submit"]');if(form.dataset.submitting==='true'||button?.disabled)return;form.dataset.submitting='true';
  const languagePicker=$('#language-picker'), languageWasDisabled=languagePicker.disabled;languagePicker.disabled=true;
  if(button){button.disabled=true;button.dataset.label=button.textContent;button.textContent=t('正在保存…');}
  saving++;++dataGeneration;
  try {await action(new FormData(event.target));}catch(e){formError(errorMessage(e));}finally{form.dataset.submitting='false';saving--;autoSync?.wake();languagePicker.disabled=languageWasDisabled;if(button){button.disabled=false;button.textContent=button.dataset.label;}}
}
function newLedger(type='general') {
  if(!state.store){showSignIn();return;}
  openDialog(t('新建共同账本'),`<form id="ledger-form"><label class="form-field"><span class="field-label">${t('账本名称')}</span><input class="form-input" name="title" placeholder="${t('例如：阳光合租 · 秋季')}" maxlength="60" required autofocus></label><label class="form-field"><span class="field-label">${t('记账币种')}</span><select class="form-select" name="currency"><option value="CNY">${t('人民币 CNY')}</option><option value="USD">${t('美元 USD')}</option></select></label><p class="form-hint">${t('一个账本使用一种币种，成员与账单都归在这本账里。')}</p>${errorSlot()}<div class="form-actions"><button type="button" class="button secondary" data-action="close-dialog">${t('取消')}</button><button class="button primary" type="submit">${t('创建账本')}</button></div></form>`);
  $('#ledger-form [name="currency"]').closest('label').insertAdjacentHTML('beforebegin',projectFields({projectType:type}));
  if(type==='personal')$('#ledger-form [name="title"]').value=t('我的日常');
  $('#ledger-form').addEventListener('submit',e=>submitForm(e,async data=>{const id=await state.store.createLedger({...Object.fromEntries(data),title:data.get('title').trim(),currency:data.get('currency'),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,ownerName:state.store.currentUser.displayName || t('我')});state.view=data.get('projectType')==='personal'?'overview':'members';await finishSave(t('账本已创建。'),id);}));
}
function newMember() {
  openDialog(t('添加一位伙伴'),`<form id="member-form"><label class="form-field"><span class="field-label">${t('伙伴怎么称呼？')}</span><input class="form-input" name="name" maxlength="40" placeholder="${t('输入名字或熟悉的称呼')}" required autofocus></label><p class="form-hint">${t('现在就可以为这位伙伴记账，之后再邀请本人认领。')}</p><p id="member-duplicate" class="form-hint" hidden>${t('已有同名成员；如果是同一个人，无需重复添加。')}</p>${errorSlot()}<div class="form-actions"><button type="button" class="button secondary" data-action="close-dialog">${t('完成')}</button><button class="button primary" type="submit">${t('添加成员')}</button></div></form>`);
  $('#member-form input[name="name"]').addEventListener('input',event=>{$('#member-duplicate').hidden=!state.snapshot.members.some(m=>m.name.toLocaleLowerCase()===event.target.value.trim().toLocaleLowerCase());});
  $('#member-form').addEventListener('submit',e=>submitForm(e,async data=>{await state.store.addMember(state.snapshot.ledger.id,data.get('name').trim());await loadData();toast(t('成员已添加，可以继续添加下一位。'));const input=$('#member-form input[name="name"]');input.value='';input.focus();}));
}
function editMember(id){
  const m=member(id);if(!m)return;
  const ledgerId=state.snapshot.ledger.id;
  openDialog(t('编辑临时成员'),`<form id="member-edit-form"><label class="form-field"><span class="field-label">${t('伙伴怎么称呼？')}</span><input class="form-input" name="name" value="${escape(m.name)}" maxlength="40" required autofocus></label>${errorSlot()}<div class="form-actions"><button type="button" class="text-link danger-link" id="member-remove">${t('移除误加成员')}</button><button type="submit" class="button primary">${t('保存名字')}</button></div></form>`);
  $('#member-edit-form').addEventListener('submit',event=>submitForm(event,async data=>{await state.store.renameMember(ledgerId,id,data.get('name').trim(),m.name);await finishSave(t('成员名字已更新。'));}));
  $('#member-remove').addEventListener('click',()=>confirmAction(t('移除这位成员？'),t('仅可移除没有账目、模板和邀请的临时成员。'),t('移除'),()=>state.store.removeMember(ledgerId,id),t('成员已移除。')));
}

async function newExpense(options={},resumeRecord=null) {
  if(!state.snapshot)return newLedger();
  if(archived()){toast(t('账本已归档，请由创建者恢复后再修改。'));return;}
  const request=++editorRequest,store=state.store,id=state.snapshot.ledger.id;
  let snapshot=state.snapshot;
  const returnPosition=window.scrollY;
  const scope=draftScope(store.mode,store.currentUser.uid,id),key=resumeRecord?.key||draftKey(scope,options);
  let record,storageError=false;
  try{record=resumeRecord||await draftStore.get(key);}catch{storageError=true;}
  if(request!==editorRequest||state.store!==store||state.snapshot?.ledger.id!==id)return;
  if(record?.scope!==scope)record=null;
  if(record)options=record.options;
  if(options.expenseId){
    try{snapshot=await store.loadLedger(id);}catch(error){toast(errorMessage(error));return;}
    if(request!==editorRequest||state.store!==store||state.snapshot?.ledger.id!==id)return;
    const latest=snapshot.expenses.find(row=>row.id===options.expenseId);
    if(!latest||latest.status!=='active'){toast(t('这笔费用已撤销。'));return;}
    if(record&&(record.options.initial.version||1)!==(latest.version||1)){
      showDraftConflict(record,latest,snapshot);return;
    }
    if(!record)options={...options,initial:latest};
  }
  activeEditor=openExpenseEditor({snapshot,user:store.currentUser,isOwner:owner(),draft:storageError?null:{store:draftStore,key,scope,record},openDialog,submitForm,errorSlot,formError,today:options.templateMode?ledgerDate():localDate(),onConflict:async()=>{await newExpense(options);},onAddMember:async name=>{const memberId=await store.addMember(id,name);autoSync?.wake();return {id:memberId,name:name.trim(),uid:null,createdByUid:store.currentUser.uid};},onLoadDirectory:()=>store.loadLedger(id),onAddMembers:store.addMembers?async entries=>{const result=await store.addMembers(id,entries);autoSync?.wake();return result;}:null,onSaveGroup:async(payload,groupId)=>{const result=await store.saveParticipantGroup(id,payload,groupId);autoSync?.wake();return result;},onDeleteGroup:async(groupId,version)=>{await store.deleteParticipantGroup(id,groupId,version);autoSync?.wake();},onSave:async(payload,settings)=>{
    if(store.mode==='api'&&settings.draftRequestKey){
      const type=settings.templateMode?'saveTemplate':settings.expenseId?'updateExpense':'addExpense';
      const args=settings.templateMode?[payload,settings.templateId||null]:settings.expenseId?[settings.expenseId,payload]:[payload];
      await store.saveDraftCommand(id,type,args,settings.draftRequestKey);
    }
    else if(settings.templateMode)await store.saveTemplate(id,payload,settings.templateId);
    else if(settings.expenseId)await store.updateExpense(id,settings.expenseId,payload);
    else await store.addExpense(id,payload);
    try{await settings.draftCommitted?.();}catch{/* Keep a newer draft from another tab. The bill itself is already saved. */}
    await finishSave(settings.expenseId?t('更正已保存。'):settings.templateMode?t('模板已保存。'):t('账单已保存。'));
    window.scrollTo({top:returnPosition,behavior:'instant'});
    if(settings.continueEntry)await newExpense({...settings.nextEntry,entryId:randomId()});
  }},options);
  if(storageError)formError(t('无法保存草稿，请先不要关闭页面。'));
}

function showDraftConflict(record,latest,snapshot){
  const groups=reconcileExpenseDraft(record,latest);
  const labels={title:t('用途'),date:t('日期'),category:t('分类'),financial:t('金额与分摊'),note:t('备注'),receipts:t('收据')};
  const name=id=>snapshot.members.find(m=>m.id===id)?.name||t('成员');
  const describe=(form,key)=>{
    if(key==='receipts')return form.receipts.map(row=>row.name).join('、')||t('无');
    if(key==='category')return t(categories[form.fields.category||'uncategorized']);
    if(key!=='financial')return form.fields[key]||t('无');
    const shares=form.splitType==='items'?form.items.map(row=>`${row.title} · ${t(categories[row.category||form.fields.category||'uncategorized'])} ${row.amount} (${row.memberIds.map(name).join('、')})`).join('\n'):
      form.participants.map(id=>`${name(id)}: ${form.splitType==='percent'?(form['data-percent'][id]||'0')+'%':form.splitType==='equal'?t('均分'):form['data-share-amount'][id]||'—'}`).join('\n');
    return `${form.fields.amount} ${snapshot.ledger.currency} · ${t('{name}垫付',{name:name(form.fields.payer)})}
${shares}`;
  };
  openDialog(t('核对账单更新'),`<p>${t('其他成员更新了这笔账单。核对差异后继续，你的草稿仍然保留。')}</p><form id="draft-conflict-form">${groups.filter(row=>row.changed||row.remoteChanged).map(row=>`<fieldset class="draft-difference"><legend>${labels[row.key]}</legend><div class="draft-comparison">${['mine','current'].map(choice=>`<label><strong>${choice==='mine'?t('我的草稿'):t('最新账单')}</strong><span>${escape(describe(row[choice],row.key))}</span>${row.conflict?`<span><input type="radio" name="${row.key}" value="${choice}" ${row.restricted&&choice==='mine'?'disabled':''} ${choice===row.choice?'checked':''}> ${t('保留这一份')}</span>`:choice===row.choice?`<small>${t('将保留')}</small>`:''}</label>`).join('')}</div>${row.restricted?`<p class="form-hint">${t('已发生收款，金额与分摊保留最新账单。')}</p>`:''}</fieldset>`).join('')}${errorSlot()}<div class="form-actions"><button type="button" class="button secondary" data-action="close-dialog">${t('稍后处理')}</button><button type="submit" class="button primary">${t('继续编辑')}</button></div></form>`,'',true);
  $('#draft-conflict-form').addEventListener('submit',event=>submitForm(event,async data=>{
    const next=resolveExpenseDraft(record,latest,groups,Object.fromEntries(data));
    const saved=await draftStore.put(next,record.revision);
    await newExpense(saved.options,saved);
  }));
}

function expenseExtras(expense) {
  const items=expense.items || [],attachments=receiptMarkup(expense.receipts);
  return `<p class="form-hint">${t('分类')} · ${t(categories[expense.category||'uncategorized'])}</p>${expense.sourceDate?`<p class="form-hint">${t('周期账单 · {date}',{date:escape(expense.sourceDate)})}</p>`:''}${items.length?`<section class="detail-items"><h3>${t(expense.refunds?.length?'原消费明细':'消费明细')}</h3>${items.map(item=>`<div class="detail-item"><strong>${escape(item.title)}</strong><strong>${money(item.amountCents)}</strong><small>${t(categories[item.category??expense.category??'uncategorized'])} · ${item.memberIds.map(id=>escape(memberName(id))).join('、')}</small></div>`).join('')}</section>`:''}${expense.note?`<section class="detail-note"><h3>${t('备注')}</h3><p>${escape(expense.note)}</p></section>`:''}${attachments?`<section class="receipt-gallery"><h3>${t('收据')}</h3>${attachments}</section>`:''}`;
}
function showExpense(id) {
  const e=state.snapshot.expenses.find(e=>e.id===id);if(!e)return;
  const ledgerId=state.snapshot.ledger.id;
  const pending=[...state.snapshot.members.map(m=>paymentSubmission(state.store,ledgerId,e.id,m.id).pending),...state.snapshot.members.filter(m=>m.id!==e.payerMemberId).map(m=>paymentSubmission(state.store,ledgerId,e.id,e.payerMemberId,'recordPayment',m.id).pending)].filter(Boolean);
  const pendingMarkup=pending.map(({payload:p})=>`<div class="payment-record"><p>${t('上次收款结果待核实')} · ${escape(memberName(p.fromMemberId))} → ${escape(memberName(p.toMemberId))} · ${money(p.amountCents)}</p><button class="button secondary" data-payment="${escape(e.id)}" data-member="${escape(p.fromMemberId)}" ${p.fromMemberId===e.payerMemberId?`data-to="${escape(p.toMemberId)}"`:''}>${t('核实上次收款')}</button></div>`).join('');
  const shares=Object.entries(consumptionShares(e)).map(([memberId,cents])=>`<div class="member-row">${avatar(memberName(memberId))}<div class="member-info"><strong>${escape(memberName(memberId))}${memberId===e.payerMemberId?t(' · 垫付人'):''}</strong><small>${t('实际承担')}</small></div><strong>${money(cents)}</strong></div>`).join('');
  const debts=expenseDebts(e).map(d=>`<div class="member-row"><div class="member-info"><strong>${escape(memberName(d.fromMemberId))} → ${escape(memberName(d.toMemberId))}</strong><small>${t(d.fromMemberId===e.payerMemberId?'退款返还':'待付')}</small></div><strong>${money(d.amountCents)}</strong>${!pending.some(p=>p.payload.fromMemberId===d.fromMemberId&&p.payload.toMemberId===d.toMemberId)&&canReceive(e,d.toMemberId)?`<button class="button secondary small-button" data-payment="${escape(e.id)}" data-member="${escape(d.fromMemberId)}" ${d.fromMemberId===e.payerMemberId?`data-to="${escape(d.toMemberId)}"`:''}>${t('记录收款')}</button>`:''}</div>`).join('');
  const refunds=(e.refunds||[]).map(r=>`<div class="payment-record"><div class="journal-row"><div><strong>${escape(r.date)} · ${t('商家退款')} ${r.status==='reversed'?`<span class="badge neutral">${t('已撤销')}</span>`:''}</strong><small>${t('退款收款人')} ${escape(memberName(r.toMemberId))}${r.note?' · '+escape(r.note):''}</small></div><strong>${money(r.amountCents)}</strong>${r.status==='active'&&canReceive(e)?`<button class="text-link" data-reverse-refund="${escape(r.id)}" data-refund-expense="${escape(e.id)}">${t('撤销')}</button>`:''}</div><p>${Object.entries(r.benefits).filter(([,v])=>v).map(([key,v])=>`${escape(memberName(key))} −${money(v)}`).join(' · ')}</p></div>`).join('');
  const pendingRefund=paymentSubmission(state.store,ledgerId,e.id,'refund','recordRefund').pending;
  openDialog(escape(e.title),`${e.refunds?.length?`<p class="detail-meta">${t('净消费')}</p>`:''}<div class="detail-amount">${money(netExpenseAmount(e))}</div>${e.refunds?.length?`<p class="detail-meta">${t('原消费')} ${money(e.amountCents)} · ${t('累计退款')} ${money(refundedTotal(e))}</p>`:''}<div class="detail-meta">${escape(dateText(e.date))} · ${t('{name}垫付',{name:escape(memberName(e.payerMemberId))})} ${statusFor(e)}</div><h3>${t('每个人的份额')}</h3>${shares}${debts?`<h3>${t('待结清')}</h3>${debts}`:''}${pendingMarkup}${pendingRefund?`<p role="status">${t('退款保存结果待核实，请核实后再记录下一笔。')}</p>`:''}${refunds?`<h3>${t('退款记录')}</h3>${refunds}`:''}${expenseExtras(e)}${errorSlot()}`,`${archived()?'':`<button class="text-link" data-template-from-expense="${escape(e.id)}">${t('存为模板')}</button>`}<button class="text-link" data-expense-history="${escape(e.id)}">${t('操作历史')}</button>${e.status==='active'&&canReceive(e)?`<button class="button secondary" data-refund="${escape(e.id)}" ${!pendingRefund&&netExpenseAmount(e)===0?'disabled':''}>${t(pendingRefund?'核实上次退款':'记录退款')}</button><button class="button secondary" data-edit-expense="${escape(e.id)}">${t('补充与更正')}</button><button class="text-link danger-link" data-reverse-expense="${escape(e.id)}">${t('撤销这笔账单')}</button>`:''}<button class="button secondary" data-action="close-dialog">${t('完成')}</button>`);
  dialogRefresh=()=>{const top=$('.dialog-body').scrollTop;showExpense(id);$('.dialog-body').scrollTop=top;};
}
function refundDialog(expenseId){
  const expense=state.snapshot.expenses.find(e=>e.id===expenseId);if(!expense||!canReceive(expense)||expense.status!=='active')return;
  openRefundEditor({store:state.store,snapshot:state.snapshot,expenseId,openDialog,submitForm,onSaved:finishSave,today:localDate()});
}
function reverseRefundDialog(expenseId,refundId){
  const e=state.snapshot.expenses.find(e=>e.id===expenseId);if(!e||!canReceive(e))return;
  const ledgerId=state.snapshot.ledger.id;
  openDialog(t('撤销退款记录'),`<form id="refund-reversal-form"><p>${t('撤销后重新计算消费和待结往来，已发生的成员转账保留。')}</p><label class="form-field"><span class="field-label">${t('撤销原因')}</span><input class="form-input" name="reason" maxlength="300" required autofocus></label>${errorSlot()}<div class="form-actions"><button class="button secondary" type="button" data-action="close-dialog">${t('取消')}</button><button class="button primary" type="submit">${t('确认撤销')}</button></div></form>`);
  document.querySelector('#refund-reversal-form').addEventListener('submit',event=>submitForm(event,async data=>{await state.store.reverseRefund(ledgerId,expenseId,{refundId,expectedVersion:e.version||1,reason:data.get('reason')});await finishSave(t('退款记录已撤销。'));}));
}
function showHistory(id) {
  openDialog(t('操作历史'),historyMarkup(state.snapshot,id),`<button class="button secondary" data-expense="${escape(id)}">${t('返回账单')}</button>`,true);
  $('#action-dialog').classList.add('history-dialog');
  dialogRefresh=()=>{const top=$('.dialog-body').scrollTop;showHistory(id);$('.dialog-body').scrollTop=top;};
}
function paymentDialog(expenseId,fromId,toId) {
  const e=state.snapshot.expenses.find(e=>e.id===expenseId);if(!e)return;const remaining=remainingBetween(e,fromId,toId||e.payerMemberId);
  const reviewOf=row=>({toMemberId:toId||row.payerMemberId,expectedVersion:row.version||1,expectedRemaining:row.status==='reversed'?0:remainingBetween(row,fromId,toId||row.payerMemberId)});
  const reviewed=reviewOf(e);let displayed=reviewed;
  const submission=paymentSubmission(state.store,state.snapshot.ledger.id,expenseId,fromId,'recordPayment',toId);
  openDialog(t('确认收到一笔还款'),`<p class="payment-direction" id="payment-direction">${escape(memberName(fromId))} <span class="direction-arrow">→</span> ${escape(memberName(toId||e.payerMemberId))}</p><p class="muted" id="payment-outstanding">${escape(e.title)} · ${t('剩余待收 {amount}', {amount:money(remaining)})}</p><form id="payment-form"><label class="form-field"><span class="field-label">${t('本次实际收到')}</span><input class="form-input amount-input" name="amount" inputmode="decimal" value="${amountText(remaining)}" required autofocus></label><div class="form-grid"><label class="form-field"><span class="field-label">${t('收款日期')}</span><input class="form-input" type="date" name="date" value="${localDate()}" required></label><label class="form-field"><span class="field-label">${t('备注（选填）')}</span><input class="form-input" name="note" maxlength="120" placeholder="${t('例如：微信转账，先还一部分')}"></label></div><p class="form-hint">${t('只记录已经收到的钱；支持部分还款，不会实际扣款或转账。')}</p>${errorSlot()}<label id="payment-review-label" class="form-hint" hidden><input type="checkbox" id="payment-review"> ${t('已核对新的收款人和待收金额')}</label><div class="form-actions"><button class="button secondary" type="button" data-action="close-dialog">${t('取消')}</button><button class="button primary" type="submit">${t('确认已收到')}</button></div></form>`);
  const pendingUI=()=>{
    const pending=submission.pending,form=$('#payment-form');
    for(const name of ['amount','date','note'])if(form.elements?.[name]){
      form.elements[name].readOnly=Boolean(pending);
      if(pending)form.elements[name].value=name==='amount'?amountText(pending.payload.amountCents):pending.payload[name]||'';
    }
    const button=form.querySelector?.('[type="submit"]');if(button){button.textContent=t(pending?'核实本次收款结果':'确认已收到');button.dataset.label=button.textContent;}
    if(pending){$('#payment-direction').textContent=`${memberName(fromId)} → ${memberName(pending.payload.toMemberId)}`;$('#payment-outstanding').textContent=t('本次收款 {amount}，保存结果待核实。',{amount:money(pending.payload.amountCents)});$('#payment-review-label').hidden=true;}
  };
  pendingUI();
  dialogRefresh=()=>{
    const latest=state.snapshot.expenses.find(row=>row.id===expenseId);if(!latest)return;
    const next=reviewOf(latest);
    $('#payment-direction').textContent=`${memberName(fromId)} → ${memberName(next.toMemberId)}`;
    $('#payment-outstanding').textContent=`${latest.title} · ${t('剩余待收 {amount}',{amount:money(next.expectedRemaining)})}`;
    if(JSON.stringify(next)!==JSON.stringify(displayed)){$('#payment-review').checked=false;displayed=next;}
    $('#payment-review-label').hidden=JSON.stringify(displayed)===JSON.stringify(reviewed);
    pendingUI();
  };
  $('#payment-form').addEventListener('submit',event=>submitForm(event,async data=>{
    if(!submission.pending&&JSON.stringify(displayed)!==JSON.stringify(reviewed)&&!$('#payment-review').checked)throw new Error('收款信息已改变，请核对收款人和待收金额后重新确认。');
    const payload=submission.pending?.payload||{...displayed,expenseId,fromMemberId:fromId,amountCents:parseMoney(data.get('amount')),date:data.get('date'),note:data.get('note').trim()};
    try {await submission.submit(payload);}
    catch(error){
      // Another member may have recorded a receipt while this form was open.
      // Keep the entered amount and never retry a financial write automatically.
      try {await refreshSnapshotOnly();dialogRefresh?.();}catch{/* Preserve the original write error if refreshing also fails. */}
      pendingUI();
      if(submission.pending&&![401,403].includes(error.status))throw new Error('暂未确认本次收款是否保存。请核实结果，无需重新记一笔。');
      throw error;
    }
    await finishSave(t('已记录本次收款，剩余金额已更新。'));
  }));
}
function showMemberDetail(memberId){
  const m=member(memberId);if(!m)return;
  const totals=memberBalances(state.snapshot).find(row=>row.memberId===memberId),groups=settlementGroups(activeExpenses()).filter(row=>row.fromMemberId===memberId||row.toMemberId===memberId);
  const incoming=groups.filter(row=>row.toMemberId===memberId).reduce((n,row)=>n+row.totalCents,0),outgoing=groups.filter(row=>row.fromMemberId===memberId).reduce((n,row)=>n+row.totalCents,0);
  const metrics=[[t('实际承担'),totals.shareCents],[t('已垫付'),totals.paidCents],[t('已收回'),totals.receivedCents],[t('已偿还'),totals.repaidCents],[t('待收回'),incoming],[t('待支付'),outgoing]];
  const merchantRefunds=activeExpenses().filter(e=>e.payerMemberId===memberId).reduce((n,e)=>n+refundedTotal(e),0);if(merchantRefunds)metrics.splice(2,0,[t('已收商家退款'),merchantRefunds]);
  openDialog(t('{name}的账目',{name:escape(m.name)}),`<dl class="member-totals">${metrics.map(([label,value])=>`<div><dt>${label}</dt><dd>${money(value)}</dd></div>`).join('')}</dl><h3>${t('与伙伴的往来')}</h3>${groups.length?groups.map(row=>`<div class="settlement-line"><span>${escape(memberName(row.fromMemberId))} → ${escape(memberName(row.toMemberId))}</span><strong>${money(row.totalCents)}</strong></div>`).join(''):`<p class="muted">${t('没有待结往来')}</p>`}<div class="form-actions">${owner()&&!archived()&&m.uid!==state.snapshot.ledger.ownerUid?`<button class="button secondary" data-member-status="${m.status==='inactive'?'active':'inactive'}" data-member-id="${escape(m.id)}">${m.status==='inactive'?t('恢复成员'):t('停用成员')}</button>`:''}<button class="button primary" id="member-expenses">${t('查看相关账单')}</button></div>`);
  $('#member-expenses').addEventListener('click',()=>{closeDialog();state.view='expenses';state.expenseTab='records';state.search='';state.filter='all';state.expenseFilters={memberId,memberRole:'any',from:'',to:'',status:'all'};location.hash='expenses';render();});
  dialogRefresh=()=>showMemberDetail(memberId);
}
function batchPaymentDialog(fromMemberId,toMemberId){
  const store=state.store,ledgerId=state.snapshot.ledger.id;
  let reviewed=structuredClone(state.snapshot),plan=null;
  const group=settlementGroups(reviewed.expenses).find(row=>row.fromMemberId===fromMemberId&&row.toMemberId===toMemberId);
  if(!group||!canReceive(group.expenses[0],group.toMemberId))return;
  openDialog(t('确认收到一笔还款'),`<p class="payment-direction">${escape(memberName(fromMemberId))} → ${escape(memberName(toMemberId))}</p><form id="batch-payment-form"><p id="batch-outstanding" class="muted"></p><label class="form-field"><span class="field-label">${t('本次实际收到')}</span><input class="form-input amount-input" name="amount" inputmode="decimal" value="${amountText(group.totalCents)}" required autofocus></label><div class="form-grid"><label class="form-field"><span class="field-label">${t('收款日期')}</span><input class="form-input" name="date" type="date" value="${localDate()}" required></label><label class="form-field"><span class="field-label">${t('备注（选填）')}</span><input class="form-input" name="note" maxlength="120"></label></div><h3>${t('抵扣明细')}</h3><p class="form-hint">${t('按账单日期从早到晚抵扣，确认前请核对。')}</p><div id="batch-plan"></div>${errorSlot()}<div class="form-actions"><button class="button secondary" type="button" data-action="close-dialog">${t('取消')}</button><button type="submit" class="button primary">${t('确认已收到')}</button></div></form>`);
  const form=$('#batch-payment-form'),button=form.querySelector('[type="submit"]');
  const preview=()=>{
    plan=null;const current=settlementGroups(reviewed.expenses).find(row=>row.fromMemberId===fromMemberId&&row.toMemberId===toMemberId);
    $('#batch-outstanding').textContent=t('剩余待收 {amount}',{amount:money(current?.totalCents||0)});
    try{
      plan=repaymentPlan(reviewed.expenses,{fromMemberId,toMemberId,amountCents:parseMoney(form.elements.amount.value)});
      $('#batch-plan').innerHTML=plan.map(row=>{const e=reviewed.expenses.find(e=>e.id===row.expenseId);return `<div class="settlement-line"><div><strong>${escape(e.title)}</strong><small>${escape(dateText(e.date))}</small></div><strong>${money(row.amountCents)}</strong><small>${t('抵扣后待付 {amount}',{amount:money(row.expectedRemaining-row.amountCents)})}</small></div>`;}).join('');button.disabled=false;
    }catch(error){$('#batch-plan').innerHTML=`<p class="form-error" role="alert">${escape(errorMessage(error))}</p>`;button.disabled=true;}
  };
  form.elements.amount.addEventListener('input',()=>{preview();$('#form-error').hidden=true;});preview();
  form.addEventListener('submit',event=>submitForm(event,async data=>{
    if(!plan)throw new Error('请先核对抵扣明细。');
    const payload={fromMemberId,toMemberId,amountCents:parseMoney(data.get('amount')),date:data.get('date'),note:data.get('note').trim(),allocations:plan};
    try{await store.recordPaymentBatch(ledgerId,payload);}
    catch(error){
      if(error.status===409||error.statusCode===409){reviewed=await store.loadLedger(ledgerId);preview();}
      throw error;
    }
    await finishSave(t('已记录本次收款，剩余金额已更新。'));
  }));
}

function confirmAction(title,text,buttonLabel,action,success=t('已撤销，原记录和更正记录均已保留。')) {
  openDialog(title,`<p>${text}</p>${errorSlot()}<form id="confirm-form"><div class="form-actions"><button class="button secondary" type="button" data-action="close-dialog">${t('返回')}</button><button class="button primary" type="submit">${buttonLabel}</button></div></form>`);
  $('#confirm-form').addEventListener('submit',event=>submitForm(event,async()=>{await action();await finishSave(success);}));
}
async function invitationDialog(memberId) {
  try {const token=await state.store.createInvite(state.snapshot.ledger.id,memberId),url=new URL('app.html',location.href);url.search='';if(demo)url.searchParams.set('demo','1');url.searchParams.set('invite',token);
    openDialog(t('邀请{name}认领', {name:escape(memberName(memberId))}), `<p>${t('把链接发给本人。对方打开链接申请认领，再由你核对批准。')}</p><label class="form-field"><span class="field-label">${t('邀请链接')}</span><input class="form-input" id="invite-url" value="${escape(url.href)}" readonly></label><p class="form-hint">${t('链接仅用于这位成员的认领申请，不会直接开放账本。')}</p>${errorSlot()}<div class="form-actions"><a class="button secondary" href="${escape(url.href)}" target="_blank" rel="noopener">${t('打开邀请')}</a><button class="text-link" data-revoke-invite="${escape(token)}">${t('撤销邀请')}</button><button class="button primary" id="copy-invite">${t('复制邀请链接')}</button></div>`);
    $('#copy-invite').addEventListener('click',()=>copyText(url.href,t('邀请链接已复制，请自行发给本人。')));await refreshSnapshotOnly();
  }catch(e){toast(errorMessage(e));}
}
async function refreshSnapshotOnly(){const generation=++dataGeneration;loadingData++;try{const snapshot=await state.store.loadLedger(state.snapshot.ledger.id);if(generation===dataGeneration)state.snapshot=snapshot;}finally{loadingData=Math.max(0,loadingData-1);}}
async function showInvitation(token) {
  try{state.invitation=await state.store.getInvite(token);}catch(error){state.invitation=null;$('#main-content').innerHTML=`<section class="panel invite-page"><h1>${t('无法使用这份邀请')}</h1><p>${escape(errorMessage(error))}</p><p>${t('请向账本创建者索取新的邀请链接。')}</p><a class="button secondary" href="app.html">${t('返回我的账本')}</a></section>`;return;}
  const invite=state.invitation;
  if(invite.alreadyMember||invite.status==='accepted'&&invite.acceptedUid===state.store.currentUser.uid){
    state.inviteAccepted=true;state.claimSubmitted=false;params.delete('invite');
    const url=new URL(location.href);url.searchParams.delete('invite');history.replaceState(null,'',url);
    await loadData(invite.ledgerId);toast(t('认领已批准，欢迎加入共同账本。'));return;
  }
  state.claimSubmitted=invite.claimStatus==='pending';
  renderInvitation(token);
}
function renderInvitation(token) {
  $('#primary-nav').innerHTML='';$('#mobile-nav').innerHTML='';
  const invite=state.invitation;
  $('#main-content').innerHTML=`<div class="invite-page"><span class="invite-emblem">${icon('people')}</span><h1>${t('这是你们共同的账本。')}</h1><p>${t('你受邀认领「{member}」，加入 {ledger}。', {member:`<strong>${escape(invite.memberName)}</strong>`,ledger:escape(invite.ledgerTitle)})}</p><section class="panel"><h2>${t('先确认是你本人')}</h2><p>${t('申请认领后，账本创建者会核对你的账号。批准前，你无法查看账目。')}</p><form id="claim-form"><label class="form-field"><span class="field-label">${t('向创建者说明你的称呼')}</span><input class="form-input" name="name" maxlength="40" value="${escape(state.store.currentUser.displayName || '')}" required></label>${errorSlot()}<button type="submit" class="button primary full-width">${t('提交认领申请')}</button></form></section>${demo?'':`<a class="text-link" href="app.html">${t('返回我的账本')}</a>`}</div>`;
  if(invite.claimStatus==='rejected'){$('#claim-form').innerHTML=`<p>${t('认领申请未通过，请联系账本创建者核对身份。')}</p>`;return;}
  if(state.claimSubmitted){$('#claim-form').innerHTML=`<div class="notice"><h3>${t('认领申请已提交')}</h3><p>${t('请等待账本创建者确认。批准后，用同一账号打开账本即可。')}</p></div>`;return;}
  $('#claim-form').addEventListener('submit',event=>submitForm(event,async data=>{await state.store.claimInvite(token,{displayName:data.get('name').trim()});state.claimSubmitted=true;$('#claim-form').innerHTML=`<div class="notice"><h3>${t('认领申请已提交')}</h3><p>${t('请等待账本创建者确认。批准后，用同一账号打开账本即可。')}</p></div>`; }));
}
async function copyText(text, success=t('已复制。')) {
  try {await navigator.clipboard.writeText(text);toast(success);}catch {formError(t('浏览器未允许复制，请选中文本手动复制。'));const field=$('#statement-text')||$('#invite-url');field?.focus();field?.select();}
}
function personalStatement(){
 const groups=settlementGroups(activeExpenses()).filter(g=>g.fromMemberId===mine()?.id||g.toMemberId===mine()?.id);
 return [state.snapshot.ledger.title+' · '+t('我的结算单'),...['pay','receive'].flatMap(direction=>{const rows=groups.filter(g=>direction==='pay'?g.fromMemberId===mine()?.id:g.toMemberId===mine()?.id);return [t(direction==='pay'?'我要付给谁':'谁需要付给我'),...rows.flatMap(g=>[`${memberName(g.fromMemberId)} → ${memberName(g.toMemberId)}: ${money(g.totalCents)}`,...g.expenses.map(e=>`  ${e.date} · ${e.title} · ${money(e.remainingCents)}`)]),rows.length?'':t('没有未结清的往来。')];})].join('\n');
}
function shareDialog(personal=false) {
  const content=()=>personal?personalStatement():settlementText(state.snapshot,getLanguage());
  const text=content();
  openDialog(t('分享前，先看一眼'),`<p class="muted">${t('结算单包含本账本成员姓名和金额。确认分享范围后，再发给你的伙伴。')}</p><label class="sr-only" for="statement-text">${t('结算单内容')}</label><textarea class="statement" id="statement-text" readonly rows="13">${escape(text)}</textarea>${errorSlot()}<div class="form-actions"><button class="button secondary" id="download-statement">${t('下载文本')}</button><button class="button primary" id="copy-statement">${t('复制结算单')}</button></div>`);
  dialogRefresh=()=>{$('#statement-text').value=content();};
  $('#copy-statement').addEventListener('click',()=>copyText($('#statement-text').value,t('结算单已复制，可以粘贴到聊天中。')));
  $('#download-statement').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([$('#statement-text').value],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`${state.snapshot.ledger.title.replace(/[\\/:*?"<>|]/g,'-')}${t('-结算单.txt')}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(t('结算单已下载。'));});
}

const currentDraftScope=()=>state.store&&state.snapshot?draftScope(state.store.mode,state.store.currentUser.uid,state.snapshot.ledger.id):null;
async function renderSavedDrafts(){
  const scope=currentDraftScope(),target=$('#saved-drafts');
  try{
    const records=await draftStore.list(scope);
    if(!target.isConnected||scope!==currentDraftScope())return;
    target.innerHTML=records.length?`<p class="form-hint">${t('草稿保存在此设备，提交后才会进入共同账本。')}</p><div class="plan-list">${records.map(record=>`<div class="plan-row"><div class="plan-info"><strong>${escape(record.title)}</strong><small>${escape(new Intl.DateTimeFormat(getLanguage(),{dateStyle:'medium',timeStyle:'short'}).format(new Date(record.updatedAt)))}</small></div><div class="plan-actions">${!archived()?`<button class="button secondary" data-resume-draft="${escape(record.key)}">${t('继续填写')}</button>`:''}<button class="text-link danger-link" data-discard-draft="${escape(record.key)}">${t('放弃草稿')}</button></div></div>`).join('')}</div>`:empty(t('没有未完成的草稿'),t('填写中的账单会自动保存，稍后可以继续。'));
  }catch{if(target.isConnected)target.innerHTML=`<p class="form-error">${t('无法读取此设备的草稿，请检查浏览器存储权限。')}</p>`;}
}
function showArchivedLedgers(){
  const ledgers=state.ledgers.filter(row=>row.status==='archived');
  openDialog(t('已归档账本'),ledgers.length?`<div class="plan-list">${ledgers.map(row=>`<button class="button secondary full-width" data-ledger="${escape(row.id)}">${escape(row.title)} · ${escape(row.currency)}</button>`).join('')}</div>`:`<p class="muted">${t('还没有已归档账本。')}</p>`);
}
function changeLedgerStatus(status){
  if(!state.snapshot||!owner())return;
  const id=state.snapshot.ledger.id;
  const pending=activeExpenses().reduce((sum,e)=>sum+outstanding(e),0);
  const message=status==='archived'?t('归档后所有成员只能查看和导出，停止记账、收款和周期确认；创建者可随时恢复。')+(pending?` ${t('仍有 {amount} 待结清，归档不会清除欠款。',{amount:money(pending)})}`:''):t('恢复后成员可以继续记账和收款，周期账单也会重新显示待确认期次。');
  confirmAction(status==='archived'?t('归档这个账本？'):t('恢复这个账本？'),message,status==='archived'?t('归档账本'):t('恢复账本'),()=>state.store.setLedgerStatus(id,status),status==='archived'?t('账本已归档。'):t('账本已恢复。'));
}
function downloadBlob(blob,fileName){
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=fileName;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function importDialog(){
 let payload=null;
 openDialog(t('导入账本'),`<form id="import-form"><label class="form-field"><span class="field-label">${t('选择完整 ZIP 或 JSON 账本')}</span><input class="form-input" type="file" name="file" accept=".zip,.json" required></label><p class="form-hint">${t('含附件的账本请选择完整 ZIP。')}</p><div id="import-review"></div>${errorSlot()}<div class="form-actions"><button type="submit" class="button primary" disabled>${t('导入为新账本')}</button></div></form>`);
 const form=$('#import-form'),submit=form.querySelector('[type="submit"]');let selection=0;
 form.elements.file.addEventListener('change',async()=>{
  const request=++selection;payload=null;submit.disabled=true;$('#import-review').innerHTML='';$('#form-error').hidden=true;
  try{
   const file=form.elements.file.files[0];if(!file)return;
   form.elements.file.disabled=true;
   $('#import-review').textContent=t('正在读取备份…');
   const preview=await uploadBackup(file);
   if(request!==selection||!form.isConnected)return;payload={token:preview.token};
   const importMoney=cents=>formatMoney(cents,preview.currency);
   $('#import-review').innerHTML=`<p>${t('{count}笔账单',{count:preview.expenseCount})} · ${t('{count}份附件',{count:preview.attachmentCount})} · ${escape(preview.currency)}</p><dl class="member-totals import-summary"><div><dt>${t('账目日期')}</dt><dd>${preview.from?escape(preview.from)+' – '+escape(preview.to):t('暂无账单')}</dd></div><div><dt>${t('有效支出')}</dt><dd>${importMoney(preview.totalCents)}</dd></div><div><dt>${t('未结清总额')}</dt><dd>${importMoney(preview.outstandingCents)}</dd></div></dl><details><summary>${t('核对成员余额')}</summary>${preview.members.map(m=>`<div class="settlement-line"><strong>${escape(m.name)}</strong><span>${t('待收')} ${importMoney(m.receivableCents)} · ${t('待付')} ${importMoney(m.payableCents)}</span></div>`).join('')}</details><label class="form-field"><span class="field-label">${t('账本名称')}</span><input class="form-input" name="title" value="${escape(preview.title)}" required maxlength="120"></label><label class="form-field"><span class="field-label">${t('哪位成员是你？')}</span><select class="form-select" name="memberId" required><option value="">${t('请选择')}</option>${preview.members.map(m=>`<option value="${escape(m.id)}">${escape(m.name)}</option>`).join('')}</select></label><p class="form-hint">${t('建立独立账本，保留原账目；其他成员需重新邀请认领，不会覆盖现有账本。')}</p>`;submit.disabled=false;
  }catch(error){if(request===selection&&form.isConnected){$('#import-review').innerHTML='';formError(errorMessage(error));}}finally{if(form.isConnected)form.elements.file.disabled=false;}
 });
 form.addEventListener('submit',event=>submitForm(event,async data=>{if(!payload)return;const id=await apiRequest('/api/ledger-import/commit',{method:'POST',body:{...payload,title:data.get('title'),memberId:data.get('memberId')}});await finishSave(t('账本已导入。'),id);}));
}
function timeZoneDialog(){
 const current=state.snapshot.ledger.timeZone||'Asia/Shanghai',local=Intl.DateTimeFormat().resolvedOptions().timeZone;
 const zones=[...new Set([current,local,'Asia/Shanghai','Asia/Hong_Kong','America/New_York','America/Chicago','America/Denver','America/Los_Angeles','Europe/London','UTC'])];
 openDialog(t('账本时区'),`<form id="timezone-form"><label class="form-field"><span class="field-label">${t('周期账单按此时区判断到期日期')}</span><select class="form-select" name="zone">${zones.map(zone=>`<option ${zone===current?'selected':''}>${escape(zone)}</option>`).join('')}</select></label><p class="form-hint">${t('修改不会改变已保存账单的日期。')}</p>${errorSlot()}<div class="form-actions"><button class="button primary" type="submit">${t('保存')}</button></div></form>`);
 $('#timezone-form').addEventListener('submit',event=>submitForm(event,async data=>{await state.store.setLedgerTimeZone(state.snapshot.ledger.id,data.get('zone'));await finishSave(t('账本时区已更新。'));}));
}
function ledgerOptions(){
  if(!state.snapshot)return;
  const store=state.store,id=state.snapshot.ledger.id,title=state.snapshot.ledger.title;
  openDialog(t('账本选项'),`<h3>${escape(title)}</h3>${owner()&&!archived()?`<button class="button secondary" data-action="project-settings">${t('项目与账本设置')}</button>`:''}${!demo?`<button class="button secondary" data-action="import-ledger">${t('导入账本')}</button>`:''}${owner()&&!archived()?`<button class="button secondary" data-action="ledger-timezone">${t('账本时区')} · ${escape(state.snapshot.ledger.timeZone||'Asia/Shanghai')}</button>`:''}<div class="ledger-tools"><h4>${t('导出账本')}</h4>${store.mode==='api'?`<p class="form-hint">${t('完整账本包含明细、分摊、还款、操作历史及当前和历史附件。')}</p><button class="button primary" data-export-format="zip">${t('下载完整账本 ZIP')}</button>`:''}<button class="button secondary" data-export-format="csv">${t('下载账单明细 CSV')}</button><button class="button secondary" data-export-format="json">${t('下载账本数据 JSON（不含附件文件）')}</button></div>${errorSlot()}${owner()?`<div class="ledger-tools"><h4>${t('账本状态')}</h4><button class="button secondary" data-action="${archived()?'restore-ledger':'archive-ledger'}">${archived()?t('恢复账本'):t('归档账本')}</button></div>`:''}<button class="text-link" data-action="archived-ledgers">${t('查看已归档账本')}</button>`);
  $('#dialog-content').querySelectorAll('[data-export-format]').forEach(button=>button.addEventListener('click',async()=>{
    const label=button.textContent;button.disabled=true;button.textContent=t('正在准备导出…');
    try{
      let blob,fileName;
      if(button.dataset.exportFormat==='zip'){
        const response=await fetch(`/api/ledgers/${encodeURIComponent(id)}/export`,{credentials:'same-origin',cache:'no-store'});
        if(!response.ok){const result=await response.json();throw new Error(result.error?.message||t('导出失败，请重试。'));}
        blob=await response.blob();fileName=exportFileName(title)+'.zip';
      }else{
        const bundle=ledgerExport(await store.loadLedger(id)),isCsv=button.dataset.exportFormat==='csv';
        blob=new Blob([bundle.tables[isCsv?'expenses.csv':'ledger.json']],{type:isCsv?'text/csv;charset=utf-8':'application/json'});fileName=exportFileName(title)+(isCsv?'.csv':'.json');
      }
      if(state.store!==store)return;
      downloadBlob(blob,fileName);
    }catch(error){formError(errorMessage(error));}finally{button.disabled=false;button.textContent=label;}
  }));
}

function recoveryCodeDialog(){
 openDialog(t('设置恢复码'),`<p>${t('忘记密码时，可用恢复码找回账号。生成新码会使旧码失效。')}</p><form id="recovery-code-form"><label class="form-field"><span class="field-label">${t('当前密码')}</span><input class="form-input" name="password" type="password" autocomplete="current-password" required></label>${errorSlot()}<div class="form-actions"><button type="submit" class="button primary">${t('生成恢复码')}</button></div></form>`);
 $('#recovery-code-form').addEventListener('submit',event=>submitForm(event,async data=>{
  const {code}=await apiRequest('/api/auth/recovery-code',{method:'POST',body:{password:data.get('password')}});
  openDialog(t('保存恢复码'),`<p>${t('恢复码只显示这一次。请保存在密码管理器或其他安全位置，不要分享给他人。')}</p><label class="form-field"><span class="field-label">${t('恢复码')}</span><input class="form-input" readonly value="${escape(code)}"></label><div class="form-actions"><button class="button primary" data-action="close-dialog">${t('已保存')}</button></div>`);
 }));
}
function accountDialog() {
  if(!state.store){showSignIn();return;}
  openDialog(t('我的账号'),`<p>${demo?t('登录后，可以用自己的账号加入共同账本。'):t('已登录：{account}', {account:escape(state.store.currentUser.email || state.store.currentUser.displayName || t('我的账号'))})}</p><div class="form-actions">${demo?`<a class="button primary" href="index.html">${t('登录账号')}</a>`:`<button class="button secondary" data-action="recovery-code">${t('设置恢复码')}</button><button class="button primary" id="sign-out">${t('退出登录')}</button>`}</div>`);
  $('#sign-out')?.addEventListener('click',async event=>{
    const button=event.currentTarget;button.disabled=true;
    ++dataGeneration;autoSync?.stop();
    try{await signOut();clearSession();location.href='index.html';}
    catch(error){autoSync?.start();formError(errorMessage(error));button.disabled=false;}
  });
}

document.addEventListener('click', async event => {
  const el=event.target.closest('button,a');if(!el)return;
  if(el.dataset.viewReceipt){openReceiptViewer(el.dataset.viewReceipt,el.dataset.receiptName,el);return;}
  if(el.dataset.memberDetail){showMemberDetail(el.dataset.memberDetail);return;}
  if(el.dataset.batchFrom){batchPaymentDialog(el.dataset.batchFrom,el.dataset.batchTo);return;}
  if(el.dataset.memberStatus){const id=state.snapshot.ledger.id,status=el.dataset.memberStatus;confirmAction(status==='inactive'?t('停用成员？'):t('恢复成员？'),status==='inactive'?t('不再参与新账单；旧账、未结金额及已加入账号的查看权限保留。'):t('恢复后可以再次参与新账单。'),t('确认'),()=>state.store.setMemberStatus(id,el.dataset.memberId,status),t('成员状态已更新。'));return;}
  if(el.dataset.revokeInvite){confirmAction(t('撤销邀请？'),t('这个链接将不能再用于认领。'),t('确认'),()=>state.store.revokeInvite(state.snapshot.ledger.id,el.dataset.revokeInvite),t('邀请已撤销。'));return;}
  if(el.dataset.rejectClaim){confirmAction(t('拒绝这份申请？'),t('不会将这位申请人的账号关联到成员。'),t('确认'),()=>state.store.rejectClaim(state.snapshot.ledger.id,el.dataset.rejectClaim,el.dataset.uid),t('申请已拒绝。'));return;}
  if(el.dataset.reverseBatch){const id=state.snapshot.ledger.id;confirmAction(t('撤销整笔还款？'),t('这次转账对应的所有抵扣会一起撤销，原记录仍会保留。'),t('确认撤销'),()=>state.store.reversePaymentBatch(id,el.dataset.reverseBatch));return;}
  if(el.dataset.editMember){editMember(el.dataset.editMember);return;}
  if(el.dataset.editExpense){const expense=state.snapshot.expenses.find(row=>row.id===el.dataset.editExpense);if(expense)newExpense({initial:expense,expenseId:expense.id});return;}
  if(el.dataset.expenseHistory){showHistory(el.dataset.expenseHistory);return;}
  if(el.dataset.settlementScope){state.settlementScope=el.dataset.settlementScope;render();return;}
  if (el.dataset.view) {state.view=el.dataset.view;location.hash=state.view;render();window.scrollTo({top:0,behavior:'instant'});return;}
  if (el.dataset.ledger) {await selectLedger(el.dataset.ledger);return;}
  if (el.dataset.expense) {showExpense(el.dataset.expense);return;}
  if(el.dataset.refund){refundDialog(el.dataset.refund);return;}
  if(el.dataset.reverseRefund){reverseRefundDialog(el.dataset.refundExpense,el.dataset.reverseRefund);return;}
  if (el.dataset.payment) {paymentDialog(el.dataset.payment,el.dataset.member,el.dataset.to);return;}
  if (el.dataset.inviteMember) {el.disabled=true;await invitationDialog(el.dataset.inviteMember);el.disabled=false;return;}
  if (el.dataset.filter) {if(el.dataset.filter==='open')state.expenseFilters.status='open';else state.filter=el.dataset.filter;render();return;}
  if(el.dataset.pending){state.view='expenses';state.expenseTab=el.dataset.pending;location.hash='expenses';render();return;}
  if(el.dataset.expenseTab){state.expenseTab=el.dataset.expenseTab;render();return;}
  if(el.dataset.resumeDraft||el.dataset.discardDraft){
    try{const key=el.dataset.resumeDraft||el.dataset.discardDraft,record=await draftStore.get(key);if(!record||record.scope!==currentDraftScope())return;
      if(el.dataset.resumeDraft)await newExpense(record.options,record);
      else confirmAction(t('放弃这份草稿？'),t('尚未提交的内容和附件将从此设备移除，已保存账单不受影响。'),t('放弃草稿'),()=>draftStore.remove(key,record.revision),t('草稿已移除。'));
    }catch(error){toast(errorMessage(error));}return;
  }
  if(el.dataset.templateFromExpense){newExpense({templateMode:true,sourceExpenseId:el.dataset.templateFromExpense,initial:state.snapshot.expenses.find(e=>e.id===el.dataset.templateFromExpense)});return;}
  if(el.dataset.useTemplate||el.dataset.editTemplate||el.dataset.confirmTemplate){
    const id=el.dataset.useTemplate||el.dataset.editTemplate||el.dataset.confirmTemplate,template=state.snapshot.templates.find(row=>row.id===id);
    if(template)newExpense({initial:template,templateMode:Boolean(el.dataset.editTemplate),templateId:el.dataset.editTemplate,sourceTemplateId:el.dataset.useTemplate,occurrence:el.dataset.confirmTemplate?{date:el.dataset.occurrenceDate}:undefined});return;
  }
  if(el.dataset.skipTemplate){confirmAction(t('跳过本期账单？'),t('本期不会计入支出，下一期仍按计划生成。'),t('跳过本期'),()=>state.store.skipOccurrence(state.snapshot.ledger.id,el.dataset.skipTemplate,el.dataset.occurrenceDate),t('本期已跳过。'));return;}
  if(el.dataset.templateStatus){
    const change=()=>state.store.setTemplateStatus(state.snapshot.ledger.id,el.dataset.templateId,el.dataset.templateStatus);
    if(el.dataset.templateStatus==='archived'){confirmAction(t('归档这个模板？'),t('归档后停止生成待确认账单，已有账单会保留。'),t('归档'),change,t('模板已归档。'));return;}
    el.disabled=true;try{await change();await loadData();toast(t('周期状态已更新。'));}catch(error){toast(errorMessage(error));}finally{el.disabled=false;}return;
  }
  if (el.dataset.reversePayment) {const p=state.snapshot.payments.find(p=>p.id===el.dataset.reversePayment);confirmAction(t('撤销这笔收款？'),t('将撤销 {name} 还款 {amount} 的确认，恢复相应待收金额，并保留更正记录。', {name:escape(memberName(p.fromMemberId)),amount:money(p.amountCents)}),t('确认撤销'),()=>state.store.reversePayment(state.snapshot.ledger.id,p.id));return;}
  if (el.dataset.reverseExpense) {const e=state.snapshot.expenses.find(e=>e.id===el.dataset.reverseExpense);confirmAction(t('撤销这笔账单？'),t('「{title}」将不再计入余额。已有关联还款时，需要先撤销对应收款记录。', {title:escape(e.title)}),t('撤销账单'),()=>state.store.reverseExpense(state.snapshot.ledger.id,e.id));return;}
  if (el.dataset.approve) {confirmAction(t('确认这位伙伴的身份'),t('确认申请人是你邀请的本人后，再将临时成员的账目关联到这个账号。'),t('确认并批准'),async()=>{await state.store.approveClaim(el.dataset.approve,el.dataset.uid);},t('认领已批准，伙伴可以用自己的账号共同记账了。'));return;}
  const action=el.dataset.action;
  if(action==='close-dialog')closeDialog();
  if(action==='project-settings')projectSettings();
  if(action==='personal-ledger')await personalLedger();
  if(action==='my-statement')shareDialog(true);
  if(action==='ledger-options')ledgerOptions();
  if(action==='archived-ledgers')showArchivedLedgers();
  if(action==='archive-ledger')changeLedgerStatus('archived');
  if(action==='restore-ledger')changeLedgerStatus('active');
  if(action==='toggle-expense-filters'){const panel=$('#advanced-expense-filters');state.filtersExpanded=panel.hidden;panel.hidden=!state.filtersExpanded;el.setAttribute('aria-expanded',String(state.filtersExpanded));el.textContent=t(state.filtersExpanded?'收起筛选':'更多筛选');return;}
  if(action==='clear-expense-filters'){state.search='';state.filter='all';state.expenseFilters={memberId:'',memberRole:'any',from:'',to:'',status:'all'};render();$('#expense-search')?.focus();}
  if(action==='new-ledger')newLedger();
  if(action==='new-member')newMember();
  if(action==='new-expense')newExpense();
  if(action==='new-template')newExpense({templateMode:true});
  if(action==='toggle-archived'){state.showArchived=!state.showArchived;render();}
  if(action==='share')shareDialog();
  if(action==='import-ledger')importDialog();
  if(action==='ledger-timezone')timeZoneDialog();
  if(action==='recovery-code')recoveryCodeDialog();
  if(action==='account')accountDialog();
  if(action==='refresh') {el.disabled=true;try {if(params.has('invite')&&!state.inviteAccepted)await showInvitation(params.get('invite'));else await loadData();toast(t('账本已刷新。'));}catch(e){toast(errorMessage(e));}finally{el.disabled=false;}}
});
async function selectLedger(id) {++editorRequest;closeDialog();if(state.view==='personal')state.view='overview';try {await loadData(id);window.scrollTo({top:0,behavior:'instant'});}catch(error){toast(errorMessage(error));}}
$('#ledger-picker').addEventListener('change',event=>{if(event.target.value==='__import__'){render();importDialog();return;}if(event.target.value==='__new__'){event.target.value=state.snapshot?.ledger.id||'';newLedger();}else selectLedger(event.target.value);});
window.addEventListener('hashchange',()=>{if(!params.has('invite')||state.inviteAccepted){state.view=location.hash.slice(1)||'overview';if(state.store)render();}});
$('#language-picker').addEventListener('change',event=>setLanguage(event.target.value));
document.addEventListener('visibilitychange',()=>{if(document.hidden)activeEditor?.flush();autoSync?.wake();});
document.addEventListener('focusout',()=>autoSync?.wake());
window.addEventListener('online',()=>autoSync?.wake());
window.addEventListener('focus',()=>autoSync?.wake());
window.addEventListener('pagehide',()=>{activeEditor?.flush();++dataGeneration;autoSync?.stop();});
window.addEventListener('pageshow',()=>{if(!state.starting&&state.store?.mode==='api')startAutoSync();});
$('#action-dialog').addEventListener('close',()=>{if(!$('#action-dialog').open){activeEditor?.flush();activeEditor=null;dialogRefresh=null;}autoSync?.wake();});
document.addEventListener('languagechange',()=>{
  const claimName=$('#claim-form input[name="name"]')?.value;
  translatePage();
  $('#toast').hidden=true;
  if(state.startupError){showStartupError();return;}
  if(state.starting)return;
  if(state.store){
    $('#account-name').textContent=state.store.currentUser.displayName || t('我的账号');
    $('.avatar-self').textContent=Array.from(state.store.currentUser.displayName || t('我'))[0];
    if(params.has('invite')&&!state.inviteAccepted&&state.invitation){renderInvitation(params.get('invite'));if(claimName!==undefined&&$('#claim-form input[name="name"]'))$('#claim-form input[name="name"]').value=claimName;}
    else render();
  }else showSignIn();
});
translatePage();
start();
