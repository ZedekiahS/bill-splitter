import { currentSession, createApiStore, signOut } from './api-store.mjs';
import accountMessages from './account-messages.mjs';
import { t, getLanguage, setLanguage, translatePage, formatDate, translateError, registerMessages } from './i18n.mjs';
import messages from './app-messages.mjs';
import { createStore } from './ledger-store.mjs';
import { parseMoney, formatMoney, splitShares, consumptionShares, memberBalances, remainingFor, settlementText } from './ledger-core.mjs';
import { openExpenseEditor } from './expense-entry.mjs';
import { dueOccurrences } from './expense-features.mjs';
import { receiptBlob } from './receipt-files.mjs';
import featureMessages from './feature-messages.mjs';
import { bindExpenseSearch } from './expense-search.mjs';
import { createAutoSync } from './auto-sync.mjs';

registerMessages(messages);
registerMessages(accountMessages);
registerMessages(featureMessages);

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const params = new URLSearchParams(location.search);
const demo = params.get('demo') === '1';
const state = { store: null, ledgers: [], snapshot: null, view: location.hash.slice(1) || 'overview', filter: 'all', search: '', expenseTab:'records', showArchived:false, starting: true, startupError: null, invitation: null, claimSubmitted: false };
let dataGeneration=0,loadingData=0,saving=0,syncSignature=null,autoSync=null,dialogRefresh=null;
const views = [{id:'overview',name:'总览',icon:'home'},{id:'expenses',name:'账单',icon:'receipt'},{id:'settlements',name:'结算',icon:'arrows'},{id:'members',name:'成员',icon:'people'}];
const paths = {
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
const canReceive = expense => owner() || member(expense.payerMemberId)?.uid === state.store.currentUser.uid;
const activeExpenses = () => state.snapshot.expenses.filter(e => e.status !== 'reversed');
const outstanding = expense => Object.keys(expense.shares).filter(id => id !== expense.payerMemberId).reduce((n,id) => n + remainingFor(expense,id),0);
const localDate = () => {if(!demo)return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
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
const newExpenseButton = () => `<button class="button primary" data-action="new-expense">${icon('plus')}${t('记一笔')}</button>`;

async function start() {
  $('.brand').href=demo?'app.html?demo=1':'app.html';
  const accountButton=document.createElement('button');
  accountButton.className='icon-button';accountButton.dataset.action='account';accountButton.dataset.i18nAriaLabel='登录与账号';accountButton.setAttribute('aria-label',t('登录与账号'));accountButton.innerHTML=icon('people');
  $('.topbar-actions').append(accountButton);
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
  const id=[preferredId,oldId,params.get('ledger'),ledgers[0]?.id].find(id=>ledgers.some(l=>l.id===id));
  const snapshot=id?await state.store.loadLedger(id):null;
  if(generation!==dataGeneration)return;
  state.ledgers=ledgers;state.snapshot=snapshot;
  if(id!==oldId){state.search='';state.filter='all';state.expenseTab='records';state.showArchived=false;}
  state.startupError=null;render();
  if(id){const url=new URL(location.href);url.searchParams.set('ledger',id);url.hash=state.view;history.replaceState(null,'',url);}
  } finally {loadingData=Math.max(0,loadingData-1);}
}
function syncBlocked(){return state.starting||loadingData||saving||Boolean(document.activeElement?.matches?.('#expense-search, #ledger-picker'));}
async function syncChanges(){
  if(!state.store||syncBlocked())return;
  const generation=dataGeneration,store=state.store;
  const valid=()=>generation===dataGeneration&&store===state.store&&!syncBlocked();
  const updates=await store.listUpdates(),signature=JSON.stringify(updates);
  if(!valid()||signature===syncSignature)return;
  // Claim approval grants membership and therefore changes this user's update list.
  if(params.has('invite')&&!state.inviteAccepted){
    const invite=await store.getInvite(params.get('invite'));
    if(!valid())return;
    if(invite.status==='accepted'&&invite.acceptedUid===store.currentUser.uid)await showInvitation(params.get('invite'));
    syncSignature=signature;return;
  }
  const ledgers=await store.listLedgers(),oldId=state.snapshot?.ledger.id;
  const id=[oldId,params.get('ledger'),ledgers[0]?.id].find(id=>ledgers.some(row=>row.id===id));
  const snapshot=id?await store.loadLedger(id):null;
  if(!valid())return;
  const changed=Boolean(state.startupError)||JSON.stringify([state.ledgers,state.snapshot])!==JSON.stringify([ledgers,snapshot]);
  state.ledgers=ledgers;state.snapshot=snapshot;syncSignature=signature;state.startupError=null;
  if(!changed)return;
  if(id!==oldId){closeDialog();state.search='';state.filter='all';state.expenseTab='records';state.showArchived=false;}
  const scrollY=window.scrollY;
  render();
  if($('#action-dialog').open)dialogRefresh?.();
  window.scrollTo({top:scrollY,behavior:'instant'});
  const url=new URL(location.href);if(id)url.searchParams.set('ledger',id);else url.searchParams.delete('ledger');history.replaceState(null,'',url);
}
function clearSession(){
  ++dataGeneration;loadingData=0;autoSync?.stop();closeDialog();
  state.store=null;state.snapshot=null;state.ledgers=[];state.invitation=null;
  for(const selector of ['#primary-nav','#mobile-nav','#ledger-nav','#ledger-picker'])$(selector).innerHTML='';
  showSignIn();
}
function startAutoSync(){
  autoSync??=createAutoSync({check:syncChanges,onUnauthorized:clearSession});autoSync.start();
}
function render() {
  const nav = views.map(v=>`<button class="nav-item ${state.view===v.id?'active':''}" data-view="${v.id}" ${state.view===v.id?'aria-current="page"':''}>${icon(v.icon)}<span>${t(v.name)}</span></button>`).join('');
  $('#primary-nav').innerHTML=nav; $('#mobile-nav').innerHTML=nav;
  $('#ledger-picker').innerHTML=state.ledgers.map(l=>`<option value="${escape(l.id)}" ${l.id===state.snapshot?.ledger.id?'selected':''}>${escape(l.title)}</option>`).join('')+`<option value="__new__">${t('＋ 新建账本')}</option>`;
  $('#ledger-nav').innerHTML=state.ledgers.map(l=>`<button class="ledger-nav-item ${l.id===state.snapshot?.ledger.id?'active':''}" data-ledger="${escape(l.id)}"><span class="ledger-dot"></span><span>${escape(l.title)}</span></button>`).join('');
  if (!state.snapshot) {$('#main-content').innerHTML=heading(t('从第一本账开始'),t('把一次旅行，或每一天的小账，记在一起。'))+empty(t('还没有共享账本'),t('新建账本后，可以先用名字添加成员。'),`<button class="button primary" data-action="new-ledger">${t('新建账本')}</button>`);return;}
  if (!views.some(v=>v.id===state.view)) state.view='overview';
  $('#main-content').innerHTML=({overview:overview,expenses:expensesView,settlements:settlementsView,members:membersView}[state.view])();
  if(state.view==='expenses'&&state.expenseTab==='records')bindExpenseSearch($('#expense-search'),value=>{state.search=value;updateExpenseResults();});
}
function myTotals() {
  const id=mine()?.id; let receivable=0,payable=0;
  for (const e of activeExpenses()) {if (e.payerMemberId===id) receivable+=outstanding(e);else if (id) payable+=remainingFor(e,id);}
  return {receivable,payable};
}
function statusFor(e) {
  if (e.status==='reversed') return `<span class="badge neutral">${t('已撤销')}</span>`;
  if (outstanding(e)===0) return `<span class="badge success">${t('已结清')}</span>`;
  if (Object.values(e.repaid || {}).some(v=>v>0)) return `<span class="badge pending">${t('部分已还')}</span>`;
  return `<span class="badge neutral">${t('待结清')}</span>`;
}
function expenseRows(list) {
  if (!list.length) return empty(t('这里还没有账单'),t('记下第一笔共同开销，分摊结果会清楚列出来。'),newExpenseButton());
  return `<div class="expense-list">${list.map(e=>{
    const id=mine()?.id;
    const relation=e.status==='reversed'?t('已撤销'):e.payerMemberId===id?`${t('待收')} ${money(outstanding(e))}`:id&&e.shares[id]!==undefined?`${t('我待付')} ${money(remainingFor(e,id))}`:t('账本成员可见');
    return `<button class="expense-row" data-expense="${escape(e.id)}"><span class="expense-icon">${icon('receipt')}</span><span class="expense-info"><span class="expense-title">${escape(e.title)} ${statusFor(e)}</span><span class="expense-meta">${t('{name}垫付', {name:escape(memberName(e.payerMemberId))})} · ${escape(dateText(e.date))} · ${t('{count}人参与', {count:Object.keys(e.shares).length})}</span></span><span class="expense-amount"><strong>${money(e.amountCents)}</strong><small>${relation}</small></span>${icon('arrow')}</button>`;
  }).join('')}</div>`;
}
const createdTime = value => value?.toMillis ? value.toMillis() : Date.parse(value) || 0;
const newestFirst = (a,b) => String(b.date).localeCompare(String(a.date)) || createdTime(b.createdAt)-createdTime(a.createdAt);
function sortedExpenses(){return [...state.snapshot.expenses].sort(newestFirst);}
function sortedPayments(){return [...state.snapshot.payments].sort(newestFirst);}
function overview() {
  const s=state.snapshot, totals=myTotals(), active=activeExpenses();
  const effective=sortedPayments().filter(p=>p.type==='payment'&&!p.reversedBy).slice(0,3);
  const memberList=s.members.slice(0,4).map(m=>`<div class="member-row">${avatar(m.name)}<div class="member-info"><strong>${escape(m.name)}${m.uid===state.store.currentUser.uid?` <span class="me-label">${t('我')}</span>`:''}</strong><small>${m.uid?t('已加入'):t('临时成员')}</small></div><span class="member-amount">${balanceLabel(m.id)}</span></div>`).join('');
  return heading(t('把账理清，轻松一点。'),`${escape(s.ledger.title)} · ${t('{count}位成员', {count:s.members.length})}`,newExpenseButton())+
    `<div class="overview-grid"><div class="main-column"><section class="balance-strip" aria-label="${t('我的待收待付')}"><div class="balance-block"><span class="balance-label">${t('待收回')}</span><strong class="balance-amount amount-in">${money(totals.receivable)}</strong><span class="balance-note">${t('已垫付，等待伙伴还款')}</span></div><div class="balance-block"><span class="balance-label">${t('待支付')}</span><strong class="balance-amount">${money(totals.payable)}</strong><span class="balance-note">${t('确认转账后，由收款人记一笔')}</span></div><div class="balance-footer"><span>${t('本账本累计支出')} <strong>${money(active.reduce((n,e)=>n+e.amountCents,0))}</strong></span><button class="text-link" data-view="settlements">${t('查看结算')} ${icon('arrow')}</button></div></section>
    <section class="panel"><div class="section-heading"><h2>${t('最近账单')}</h2><button class="text-link" data-view="expenses">${t('查看全部')} ${icon('arrow')}</button></div>${expenseRows(sortedExpenses().slice(0,5))}</section>
    <section class="panel-quiet"><div class="section-heading"><h2>${t('最近还款')}</h2><button class="text-link" data-view="settlements">${t('全部记录')}</button></div>${effective.length?effective.map(p=>`<div class="activity-row"><span class="activity-icon">${icon('check')}</span><div><strong>${escape(memberName(p.fromMemberId))} → ${escape(memberName(p.toMemberId))}</strong><small>${escape(dateText(p.date))} ${t('· 已确认收款')}</small></div><strong>${money(p.amountCents)}</strong></div>`).join(''):`<p class="muted">${t('第一笔收款确认后，记录会出现在这里。')}</p>`}</section></div>
    <aside class="side-column"><section class="panel"><div class="section-heading"><h2>${t('成员净余额')}</h2><span class="count-label">${t('{count}人', {count:s.members.length})}</span></div>${memberList}<button class="button secondary full-width" data-view="members">${icon('people')}${t('管理成员与邀请')}</button></section><section class="share-panel"><span class="share-symbol">${icon('share')}</span><h2>${t('一张清单，把账说明白。')}</h2><p>${t('把待结清的金额整理好，分享给一起消费的伙伴。')}</p><button class="button secondary" data-action="share">${t('预览结算单')} ${icon('arrow')}</button></section></aside></div>`;
}
function balanceLabel(id) {
  const b=memberBalances(state.snapshot).find(x=>x.memberId===id)?.balanceCents || 0;
  return b===0?`<span class="muted">${t('已平衡')}</span>`:b>0?`<span class="amount-in">${t('待收')} ${money(b)}</span>`:`${t('待付')} ${money(-b)}`;
}
function filteredExpenses() {
  const id=mine()?.id;
  const query=state.search.trim().toLocaleLowerCase();
  return sortedExpenses().filter(e=>(!query||e.title.toLocaleLowerCase().includes(query))&&(state.filter==='all'||state.filter==='mine'&&e.payerMemberId===id||state.filter==='participating'&&Object.hasOwn(e.shares,id)||state.filter==='open'&&e.status!=='reversed'&&outstanding(e)>0));
}
const hasExpenseFilters = () => Boolean(state.search.trim()) || state.filter!=='all';
function expenseResults(list) {
  if(!list.length&&state.snapshot.expenses.length&&hasExpenseFilters())return empty(t('没有符合条件的账单'),t('换个关键词，或清除筛选后再试。'));
  return expenseRows(list);
}
function updateExpenseResults() {
  const list=filteredExpenses();
  $('#expense-result-count').textContent=t('{count}笔账单',{count:list.length});
  $('#clear-expense-filters').hidden=!hasExpenseFilters();
  $('#expense-results').innerHTML=expenseResults(list);
}
function expensesView() {
  const filtered=filteredExpenses();
  const due=dueOccurrences(state.snapshot.templates || [],state.snapshot.occurrences || [],localDate());
  const tabs=`<div class="expense-tabs" role="group" aria-label="${t('账单内容')}">${[['records',t('已记账')],['drafts',t('待确认')+(due.length?` (${due.length})`:'')],['templates',t('模板与周期')]].map(([id,label])=>`<button class="chip ${state.expenseTab===id?'active':''}" data-expense-tab="${id}" aria-pressed="${state.expenseTab===id}">${label}</button>`).join('')}</div>`;
  const top=heading(t('每一笔，都有来处。'),t('查看共同开销，也看清自己承担的部分。'),newExpenseButton())+tabs;
  if(state.expenseTab==='templates')return top+templatesView();
  if(state.expenseTab==='drafts')return top+draftsView(due);
  return top+
  `<div class="filter-bar"><div class="filter-chips">${[['all',t('全部')],['mine',t('我垫付')],['participating',t('我参与')],['open',t('未结清')]].map(([id,label])=>`<button class="chip ${state.filter===id?'active':''}" data-filter="${id}" aria-pressed="${state.filter===id}">${label}</button>`).join('')}</div><label class="search-field">${icon('search')}<input id="expense-search" type="search" placeholder="${t('搜索账单')}" aria-label="${t('搜索账单')}" value="${escape(state.search)}" aria-controls="expense-results"></label></div><div class="expense-results-summary"><p id="expense-result-count" role="status" aria-live="polite">${t('{count}笔账单',{count:filtered.length})}</p><button id="clear-expense-filters" class="text-link" data-action="clear-expense-filters" ${hasExpenseFilters()?'':'hidden'}>${t('清除筛选')}</button></div><section id="expense-results" class="panel">${expenseResults(filtered)}</section>`;
}
const canManageTemplate = template => owner() || template.createdByUid===state.store.currentUser.uid;
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
  const pending=[];
  for(const expense of activeExpenses()) for(const id of Object.keys(expense.shares)) {const remaining=remainingFor(expense,id);if(id!==expense.payerMemberId&&remaining>0)pending.push({expense,id,remaining});}
  const payments=sortedPayments();
  return heading(t('结清一笔，轻松一分。'),t('还款记录保留在这里，来龙去脉都能查到。'),`<button class="button secondary" data-action="share">${icon('share')}${t('分享结算单')}</button>`)+
    `<div class="overview-grid"><div class="main-column"><section class="panel"><div class="section-heading"><h2>${t('待结清')}</h2><span class="count-label">${t('{count}笔往来', {count:pending.length})}</span></div>${pending.length?pending.map(({expense:e,id,remaining})=>`<div class="settlement-row">${avatar(memberName(id))}<div class="member-info"><strong>${escape(memberName(id))} <span class="direction-arrow">→</span> ${escape(memberName(e.payerMemberId))}</strong><button class="text-link secondary-link" data-expense="${escape(e.id)}">${escape(e.title)}</button></div><strong class="settlement-amount">${money(remaining)}</strong>${canReceive(e)?`<button class="button secondary small-button" data-payment="${escape(e.id)}" data-member="${escape(id)}">${t('记录收款')}</button>`:`<span class="badge neutral">${t('待收款人确认')}</span>`}</div>`).join(''):empty(t('这个账本已经结清'),t('每一笔共同开销都已对上。'))}</section>
    <section class="panel-quiet"><div class="section-heading"><h2>${t('还款流水')}</h2><span class="count-label">${t('{count}条记录', {count:payments.length})}</span></div>${payments.length?payments.map(p=>{const e=state.snapshot.expenses.find(e=>e.id===p.expenseId);return `<div class="journal-row"><div><strong>${p.type==='reversal'?t('撤销收款'):`${escape(memberName(p.fromMemberId))} → ${escape(memberName(p.toMemberId))}`}</strong><small>${escape(dateText(p.date))} · ${escape(e?.title || t('账单'))}${p.note?' · '+escape(p.note):''}</small></div><strong>${p.type==='reversal'?'−':''}${money(p.amountCents)}</strong>${p.reversedBy?`<span class="badge neutral">${t('已撤销')}</span>`:p.type==='payment'&&e&&canReceive(e)?`<button class="text-link" data-reverse-payment="${escape(p.id)}">${t('撤销')}</button>`:''}</div>`;}).join(''):`<p class="muted">${t('记录部分或全部收款后，会生成一条可追溯的流水。')}</p>`}</section></div><aside class="side-column"><section class="panel"><div class="section-heading"><h2>${t('成员净余额')}</h2></div>${state.snapshot.members.map(m=>`<div class="member-row">${avatar(m.name)}<div class="member-info"><strong>${escape(m.name)}</strong></div><span class="member-amount">${balanceLabel(m.id)}</span></div>`).join('')}<p class="form-hint">${t('净余额用于核对。收款仍逐笔记录，不会自动抵扣原始账单。')}</p></section></aside></div>`;
}
function membersView() {
  const claims=(state.snapshot.claims || []).filter(c=>c.status==='pending');
  return heading(t('一起记，才能一起算清。'),t('先用名字添加伙伴，邀请认领后再连接到本人账号。'),owner()?`<button class="button primary" data-action="new-member">${icon('plus')}${t('添加成员')}</button>`:'')+
    `<div class="overview-grid"><section class="panel">${state.snapshot.members.map(m=>`<div class="member-row spacious">${avatar(m.name)}<div class="member-info"><strong>${escape(m.name)}${m.uid===state.store.currentUser.uid?` <span class="me-label">${t('我')}</span>`:''}</strong><small>${m.uid===state.snapshot.ledger.ownerUid?t('账本创建者'):m.uid?t('已认领 · 可共同记账'):t('临时成员 · 认领前由账本创建者代记')}</small></div>${m.uid?`<span class="badge success">${t('已加入')}</span>`:owner()?`<button class="button secondary small-button" data-invite-member="${escape(m.id)}">${t('邀请认领')}</button>`:`<span class="badge neutral">${t('待认领')}</span>`}</div>`).join('')}</section><aside class="side-column"><section class="panel"><div class="section-heading"><h2>${t('认领申请')}</h2><span class="count-label">${claims.length}</span></div>${owner()?claims.length?claims.map(c=>{const invite=state.snapshot.invites.find(i=>i.id===c.inviteToken);return `<div class="claim-row"><p>${t('{name}申请认领「{member}」', {name:`<strong>${escape(c.displayName)}</strong>`,member:escape(invite?.memberName || t('成员'))})}</p><button class="button primary full-width" data-approve="${escape(c.inviteToken)}" data-uid="${escape(c.uid)}">${t('核对本人后批准')}</button></div>`;}).join(''):`<p class="muted">${t('伙伴通过邀请链接申请后，会在这里等待你的确认。')}</p>`:`<p class="muted">${t('认领申请由账本创建者核对与批准。')}</p>`}</section><div class="notice"><h3>${t('名字相同，也不会自动合并。')}</h3><p>${t('临时成员的账目保持原样。本人登录、提交认领、经创建者确认后，才会连接到账号。')}</p></div></aside></div>`;
}

function openDialog(title,body,footer='',wide=false) {
  dialogRefresh=null;
  const d=$('#action-dialog'); d.classList.toggle('wide-dialog',wide);
  $('#dialog-content').innerHTML=`<div class="dialog-header"><h2 id="dialog-title">${title}</h2><button class="dialog-close icon-button" data-action="close-dialog" aria-label="${t('关闭')}">${icon('close')}</button></div><div class="dialog-body">${body}</div>${footer?`<div class="dialog-footer">${footer}</div>`:''}`;
  if (!d.open)d.showModal();else d.querySelector('[autofocus]')?.focus();
}
function closeDialog() {$('#action-dialog').close();}
function formError(message) {const e=$('#form-error');if(e&&(!e.closest('dialog')||e.closest('dialog').open)){e.textContent=message;e.hidden=false;}else toast(message);}
function errorSlot(){return '<p class="form-error" id="form-error" role="alert" hidden></p>';}
async function finishSave(success,preferredId) {
  closeDialog();
  try {await loadData(preferredId);toast(success);}
  catch {toast(t('已保存，但刷新失败。请刷新账本查看最新记录，无需重复提交。'));}
}
async function submitForm(event, action) {
  event.preventDefault();const button=event.target.querySelector('[type="submit"]');if(button?.disabled)return;
  const languagePicker=$('#language-picker'), languageWasDisabled=languagePicker.disabled;languagePicker.disabled=true;
  if(button){button.disabled=true;button.dataset.label=button.textContent;button.textContent=t('正在保存…');}
  saving++;++dataGeneration;
  try {await action(new FormData(event.target));}catch(e){formError(errorMessage(e));}finally{saving--;autoSync?.wake();languagePicker.disabled=languageWasDisabled;if(button){button.disabled=false;button.textContent=button.dataset.label;}}
}
function newLedger() {
  if(!state.store){showSignIn();return;}
  openDialog(t('新建共同账本'),`<form id="ledger-form"><label class="form-field"><span class="field-label">${t('账本名称')}</span><input class="form-input" name="title" placeholder="${t('例如：阳光合租 · 秋季')}" maxlength="60" required autofocus></label><label class="form-field"><span class="field-label">${t('记账币种')}</span><select class="form-select" name="currency"><option value="CNY">${t('人民币 CNY')}</option><option value="USD">${t('美元 USD')}</option></select></label><p class="form-hint">${t('一个账本使用一种币种，成员与账单都归在这本账里。')}</p>${errorSlot()}<div class="form-actions"><button type="button" class="button secondary" data-action="close-dialog">${t('取消')}</button><button class="button primary" type="submit">${t('创建账本')}</button></div></form>`);
  $('#ledger-form').addEventListener('submit',e=>submitForm(e,async data=>{const id=await state.store.createLedger({title:data.get('title').trim(),currency:data.get('currency'),ownerName:state.store.currentUser.displayName || t('我')});state.view='members';await finishSave(t('账本已创建，添加一起记账的伙伴吧。'),id);}));
}
function newMember() {
  openDialog(t('添加一位伙伴'),`<form id="member-form"><label class="form-field"><span class="field-label">${t('伙伴怎么称呼？')}</span><input class="form-input" name="name" maxlength="40" placeholder="${t('输入名字或熟悉的称呼')}" required autofocus></label><p class="form-hint">${t('现在就可以为这位伙伴记账，之后再邀请本人认领。')}</p>${errorSlot()}<div class="form-actions"><button type="button" class="button secondary" data-action="close-dialog">${t('取消')}</button><button class="button primary" type="submit">${t('添加成员')}</button></div></form>`);
  $('#member-form').addEventListener('submit',e=>submitForm(e,async data=>{await state.store.addMember(state.snapshot.ledger.id,data.get('name').trim());await finishSave(t('成员已添加，可以开始分摊了。'));}));
}
function newExpense(options={}) {
  if(!state.snapshot)return newLedger();
  openExpenseEditor({snapshot:state.snapshot,user:state.store.currentUser,isOwner:owner(),openDialog,submitForm,errorSlot,formError,today:localDate(),onSave:async(payload,settings)=>{
    if(settings.templateMode)await state.store.saveTemplate(state.snapshot.ledger.id,payload,settings.templateId);
    else await state.store.addExpense(state.snapshot.ledger.id,payload);
    state.view='expenses';state.expenseTab=settings.templateMode?'templates':'records';state.search='';state.filter='all';
    await finishSave(settings.templateMode?t('模板已保存。'):t('账单已保存，每个人的份额都记好了。'));
  }},options);
}

function expenseExtras(expense) {
  const items=expense.items || [],receipts=expense.receipts || [],urls=[];
  const attachments=receipts.map(receipt=>{
    try {const url=typeof receipt.url==='string'&&/^\/api\/ledgers\/[a-f0-9-]+\/receipts\/[a-f0-9-]+$/.test(receipt.url)?receipt.url:URL.createObjectURL(receiptBlob(receipt));if(url.startsWith('blob:'))urls.push(url);return `<a class="receipt-row" href="${url}" download="${escape(receipt.name)}">${receipt.type.startsWith('image/')?`<img src="${url}" alt="${escape(receipt.name)}">`:icon('receipt')}<span>${escape(receipt.name)}<small>${t('下载收据')}</small></span></a>`;}
    catch{return `<p class="form-hint">${escape(receipt.name)} · ${t('收据文件无效，无法打开。')}</p>`;}
  }).join('');
  if(urls.length)$('#action-dialog').addEventListener('close',()=>urls.forEach(url=>URL.revokeObjectURL(url)),{once:true});
  return `${expense.sourceDate?`<p class="form-hint">${t('周期账单 · {date}',{date:escape(expense.sourceDate)})}</p>`:''}${items.length?`<section class="detail-items"><h3>${t('消费明细')}</h3>${items.map(item=>`<div class="detail-item"><strong>${escape(item.title)}</strong><strong>${money(item.amountCents)}</strong><small>${item.memberIds.map(id=>escape(memberName(id))).join('、')}</small></div>`).join('')}</section>`:''}${expense.note?`<section class="detail-note"><h3>${t('备注')}</h3><p>${escape(expense.note)}</p></section>`:''}${attachments?`<section class="receipt-gallery"><h3>${t('收据')}</h3>${attachments}</section>`:''}`;
}
function showExpense(id) {
  const e=state.snapshot.expenses.find(e=>e.id===id);if(!e)return;
  const shares=Object.entries(consumptionShares(e)).map(([id,cents])=>{const isPayer=id===e.payerMemberId,remaining=remainingFor(e,id),paid=e.repaid?.[id]||0;return `<div class="member-row">${avatar(memberName(id))}<div class="member-info"><strong>${escape(memberName(id))}${isPayer?t(' · 垫付人'):''}</strong><small>${isPayer?t('自己的消费份额'):paid?`${t('已还')} ${money(paid)}`:t('尚未还款')}</small></div><div class="expense-amount"><strong>${money(cents)}</strong><small>${isPayer?t('自付'):`${t('待付')} ${money(remaining)}`}</small></div>${!isPayer&&remaining>0&&e.status==='active'&&canReceive(e)?`<button class="button secondary small-button" data-payment="${escape(e.id)}" data-member="${escape(id)}">${t('收款')}</button>`:''}</div>`;}).join('');
  openDialog(escape(e.title),`<div class="detail-amount">${money(e.amountCents)}</div><div class="detail-meta">${escape(dateText(e.date))} · ${t('{name}垫付', {name:escape(memberName(e.payerMemberId))})} ${statusFor(e)}</div><div class="section-heading"><h3>${t('每个人的份额')}</h3></div>${shares}${expenseExtras(e)}${errorSlot()}`,`<button class="text-link" data-template-from-expense="${escape(e.id)}">${t('存为模板')}</button>${e.status==='active'&&(owner()||e.createdByUid===state.store.currentUser.uid)?`<button class="text-link danger-link" data-reverse-expense="${escape(e.id)}">${t('撤销这笔账单')}</button>`:''}<button class="button secondary" data-action="close-dialog">${t('完成')}</button>`);
  dialogRefresh=()=>{const top=$('.dialog-body').scrollTop;showExpense(id);$('.dialog-body').scrollTop=top;};
}
function paymentDialog(expenseId,fromId) {
  const e=state.snapshot.expenses.find(e=>e.id===expenseId);if(!e)return;const remaining=remainingFor(e,fromId);
  openDialog(t('确认收到一笔还款'),`<p class="payment-direction">${escape(memberName(fromId))} <span class="direction-arrow">→</span> ${escape(memberName(e.payerMemberId))}</p><p class="muted" id="payment-outstanding">${escape(e.title)} · ${t('剩余待收 {amount}', {amount:money(remaining)})}</p><form id="payment-form"><label class="form-field"><span class="field-label">${t('本次实际收到')}</span><input class="form-input amount-input" name="amount" inputmode="decimal" value="${amountText(remaining)}" required autofocus></label><div class="form-grid"><label class="form-field"><span class="field-label">${t('收款日期')}</span><input class="form-input" type="date" name="date" value="${localDate()}" required></label><label class="form-field"><span class="field-label">${t('备注（选填）')}</span><input class="form-input" name="note" maxlength="120" placeholder="${t('例如：微信转账，先还一部分')}"></label></div><p class="form-hint">${t('只记录已经收到的钱；支持部分还款，不会实际扣款或转账。')}</p>${errorSlot()}<div class="form-actions"><button class="button secondary" type="button" data-action="close-dialog">${t('取消')}</button><button class="button primary" type="submit">${t('确认已收到')}</button></div></form>`);
  dialogRefresh=()=>{const latest=state.snapshot.expenses.find(row=>row.id===expenseId);if(latest)$('#payment-outstanding').textContent=`${latest.title} · ${t('剩余待收 {amount}',{amount:money(latest.status==='reversed'?0:remainingFor(latest,fromId))})}`;};
  $('#payment-form').addEventListener('submit',event=>submitForm(event,async data=>{
    const payload={expenseId,fromMemberId:fromId,amountCents:parseMoney(data.get('amount')),date:data.get('date'),note:data.get('note').trim()};
    try {await state.store.recordPayment(state.snapshot.ledger.id,payload);}
    catch(error){
      // Another member may have recorded a receipt while this form was open.
      // Keep the entered amount and never retry a financial write automatically.
      try {await refreshSnapshotOnly();const latest=state.snapshot.expenses.find(row=>row.id===expenseId),hint=$('#payment-outstanding');if(latest&&hint)hint.textContent=`${latest.title} · ${t('剩余待收 {amount}',{amount:money(remainingFor(latest,fromId))})}`;}catch{/* Preserve the original write error if refreshing also fails. */}
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
    openDialog(t('邀请{name}认领', {name:escape(memberName(memberId))}), `<p>${t('把链接发给本人。对方打开链接申请认领，再由你核对批准。')}</p><label class="form-field"><span class="field-label">${t('邀请链接')}</span><input class="form-input" id="invite-url" value="${escape(url.href)}" readonly></label><p class="form-hint">${t('链接仅用于这位成员的认领申请，不会直接开放账本。')}</p>${errorSlot()}<div class="form-actions"><a class="button secondary" href="${escape(url.href)}" target="_blank" rel="noopener">${t('打开邀请')}</a><button class="button primary" id="copy-invite">${t('复制邀请链接')}</button></div>`);
    $('#copy-invite').addEventListener('click',()=>copyText(url.href,t('邀请链接已复制，请自行发给本人。')));await refreshSnapshotOnly();
  }catch(e){toast(errorMessage(e));}
}
async function refreshSnapshotOnly(){const generation=++dataGeneration;loadingData++;try{const snapshot=await state.store.loadLedger(state.snapshot.ledger.id);if(generation===dataGeneration)state.snapshot=snapshot;}finally{loadingData=Math.max(0,loadingData-1);}}
async function showInvitation(token) {
  state.invitation=await state.store.getInvite(token);
  const invite=state.invitation;
  if(invite.status==='accepted'&&invite.acceptedUid===state.store.currentUser.uid){
    state.inviteAccepted=true;state.claimSubmitted=false;params.delete('invite');
    const url=new URL(location.href);url.searchParams.delete('invite');history.replaceState(null,'',url);
    await loadData(invite.ledgerId);toast(t('认领已批准，欢迎加入共同账本。'));return;
  }
  renderInvitation(token);
}
function renderInvitation(token) {
  $('#primary-nav').innerHTML='';$('#mobile-nav').innerHTML='';
  const invite=state.invitation;
  $('#main-content').innerHTML=`<div class="invite-page"><span class="invite-emblem">${icon('people')}</span><h1>${t('这是你们共同的账本。')}</h1><p>${t('你受邀认领「{member}」，加入 {ledger}。', {member:`<strong>${escape(invite.memberName)}</strong>`,ledger:escape(invite.ledgerTitle)})}</p><section class="panel"><h2>${t('先确认是你本人')}</h2><p>${t('申请认领后，账本创建者会核对你的账号。批准前，你无法查看账目。')}</p><form id="claim-form"><label class="form-field"><span class="field-label">${t('向创建者说明你的称呼')}</span><input class="form-input" name="name" maxlength="40" value="${escape(state.store.currentUser.displayName || '')}" required></label>${errorSlot()}<button type="submit" class="button primary full-width">${t('提交认领申请')}</button></form></section>${demo?'':`<a class="text-link" href="app.html">${t('返回我的账本')}</a>`}</div>`;
  if(state.claimSubmitted){$('#claim-form').innerHTML=`<div class="notice"><h3>${t('认领申请已提交')}</h3><p>${t('请等待账本创建者确认。批准后，用同一账号打开账本即可。')}</p></div>`;return;}
  $('#claim-form').addEventListener('submit',event=>submitForm(event,async data=>{await state.store.claimInvite(token,{displayName:data.get('name').trim()});state.claimSubmitted=true;$('#claim-form').innerHTML=`<div class="notice"><h3>${t('认领申请已提交')}</h3><p>${t('请等待账本创建者确认。批准后，用同一账号打开账本即可。')}</p></div>`; }));
}
async function copyText(text, success=t('已复制。')) {
  try {await navigator.clipboard.writeText(text);toast(success);}catch {formError(t('浏览器未允许复制，请选中文本手动复制。'));const field=$('#statement-text')||$('#invite-url');field?.focus();field?.select();}
}
function shareDialog() {
  const text=settlementText(state.snapshot, getLanguage());
  openDialog(t('分享前，先看一眼'),`<p class="muted">${t('结算单包含本账本成员姓名和金额。确认分享范围后，再发给你的伙伴。')}</p><label class="sr-only" for="statement-text">${t('结算单内容')}</label><textarea class="statement" id="statement-text" readonly rows="13">${escape(text)}</textarea>${errorSlot()}<div class="form-actions"><button class="button secondary" id="download-statement">${t('下载文本')}</button><button class="button primary" id="copy-statement">${t('复制结算单')}</button></div>`);
  dialogRefresh=()=>{$('#statement-text').value=settlementText(state.snapshot,getLanguage());};
  $('#copy-statement').addEventListener('click',()=>copyText($('#statement-text').value,t('结算单已复制，可以粘贴到聊天中。')));
  $('#download-statement').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([$('#statement-text').value],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`${state.snapshot.ledger.title.replace(/[\\/:*?"<>|]/g,'-')}${t('-结算单.txt')}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(t('结算单已下载。'));});
}

function accountDialog() {
  if(!state.store){showSignIn();return;}
  openDialog(t('我的账号'),`<p>${demo?t('登录后，可以用自己的账号加入共同账本。'):t('已登录：{account}', {account:escape(state.store.currentUser.email || state.store.currentUser.displayName || t('我的账号'))})}</p><div class="form-actions">${demo?`<a class="button primary" href="index.html">${t('登录账号')}</a>`:`<button class="button primary" id="sign-out">${t('退出登录')}</button>`}</div>`);
  $('#sign-out')?.addEventListener('click',async event=>{
    const button=event.currentTarget;button.disabled=true;
    ++dataGeneration;autoSync?.stop();
    try{await signOut();clearSession();location.href='index.html';}
    catch(error){autoSync?.start();formError(errorMessage(error));button.disabled=false;}
  });
}

document.addEventListener('click', async event => {
  const el=event.target.closest('button,a');if(!el)return;
  if (el.dataset.view) {state.view=el.dataset.view;location.hash=state.view;render();return;}
  if (el.dataset.ledger) {await selectLedger(el.dataset.ledger);return;}
  if (el.dataset.expense) {showExpense(el.dataset.expense);return;}
  if (el.dataset.payment) {paymentDialog(el.dataset.payment,el.dataset.member);return;}
  if (el.dataset.inviteMember) {el.disabled=true;await invitationDialog(el.dataset.inviteMember);el.disabled=false;return;}
  if (el.dataset.filter) {state.filter=el.dataset.filter;render();return;}
  if(el.dataset.expenseTab){state.expenseTab=el.dataset.expenseTab;render();return;}
  if(el.dataset.templateFromExpense){newExpense({templateMode:true,initial:state.snapshot.expenses.find(e=>e.id===el.dataset.templateFromExpense)});return;}
  if(el.dataset.useTemplate||el.dataset.editTemplate||el.dataset.confirmTemplate){
    const id=el.dataset.useTemplate||el.dataset.editTemplate||el.dataset.confirmTemplate,template=state.snapshot.templates.find(row=>row.id===id);
    if(template)newExpense({initial:template,templateMode:Boolean(el.dataset.editTemplate),templateId:el.dataset.editTemplate,occurrence:el.dataset.confirmTemplate?{date:el.dataset.occurrenceDate}:undefined});return;
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
  if(action==='clear-expense-filters'){state.search='';state.filter='all';render();$('#expense-search')?.focus();}
  if(action==='new-ledger')newLedger();
  if(action==='new-member')newMember();
  if(action==='new-expense')newExpense();
  if(action==='new-template')newExpense({templateMode:true});
  if(action==='toggle-archived'){state.showArchived=!state.showArchived;render();}
  if(action==='share')shareDialog();
  if(action==='account')accountDialog();
  if(action==='refresh') {el.disabled=true;try {if(params.has('invite')&&!state.inviteAccepted)await showInvitation(params.get('invite'));else await loadData();toast(t('账本已刷新。'));}catch(e){toast(errorMessage(e));}finally{el.disabled=false;}}
});
async function selectLedger(id) {try {await loadData(id);}catch(error){toast(errorMessage(error));}}
$('#ledger-picker').addEventListener('change',event=>{if(event.target.value==='__new__'){event.target.value=state.snapshot?.ledger.id||'';newLedger();}else selectLedger(event.target.value);});
window.addEventListener('hashchange',()=>{if(!params.has('invite')||state.inviteAccepted){state.view=location.hash.slice(1)||'overview';if(state.snapshot)render();}});
$('#language-picker').addEventListener('change',event=>setLanguage(event.target.value));
document.addEventListener('visibilitychange',()=>autoSync?.wake());
document.addEventListener('focusout',()=>autoSync?.wake());
window.addEventListener('online',()=>autoSync?.wake());
window.addEventListener('focus',()=>autoSync?.wake());
window.addEventListener('pagehide',()=>{++dataGeneration;autoSync?.stop();});
window.addEventListener('pageshow',()=>{if(!state.starting&&state.store?.mode==='api')startAutoSync();});
$('#action-dialog').addEventListener('close',()=>{if(!$('#action-dialog').open)dialogRefresh=null;autoSync?.wake();});
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
