import { createStore } from './ledger-store.mjs';
import { parseMoney, formatMoney, splitShares, memberBalances, remainingFor, settlementText } from './ledger-core.mjs';

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const params = new URLSearchParams(location.search);
const demo = params.get('demo') === '1';
const state = { store: null, ledgers: [], snapshot: null, view: location.hash.slice(1) || 'overview', filter: 'all', search: '' };
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
const memberName = id => member(id)?.name || '成员';
const mine = () => state.snapshot?.members.find(m => m.uid === state.store.currentUser.uid);
const owner = () => state.snapshot?.ledger.ownerUid === state.store.currentUser.uid;
const canReceive = expense => owner() || member(expense.payerMemberId)?.uid === state.store.currentUser.uid;
const activeExpenses = () => state.snapshot.expenses.filter(e => e.status !== 'reversed');
const outstanding = expense => Object.keys(expense.shares).filter(id => id !== expense.payerMemberId).reduce((n,id) => n + remainingFor(expense,id),0);
const localDate = () => {const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const amountText = cents => `${Math.floor(cents/100)}.${String(cents%100).padStart(2,'0')}`;
const avatar = (name, cls='') => `<span class="avatar ${cls}" aria-hidden="true">${escape(Array.from(name || '?')[0])}</span>`;
const dateText = date => String(date || '').slice(5).replace('-','月') + '日';

function toast(message) {
  const node = $('#toast'); node.textContent = message; node.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => {node.hidden = true;}, 4200);
}
function errorMessage(error) {
  if (/permission-denied|Missing or insufficient permissions/i.test(error?.message || '')) return '暂时没有访问权限。请确认已加入账本，再刷新重试。';
  return error?.message || '没有保存成功，请重试。';
}
function empty(title, text, action='') { return `<div class="empty-state">${icon('book')}<h3>${escape(title)}</h3><p>${escape(text)}</p>${action}</div>`; }
function heading(title, subtitle, actions='') {return `<div class="page-heading"><div class="heading-copy"><h1>${title}</h1><p>${subtitle}</p></div><div class="page-actions">${actions}</div></div>`;}
const newExpenseButton = () => `<button class="button primary" data-action="new-expense">${icon('plus')}记一笔</button>`;

async function loadFirebase() {
  for (const src of ['/__/firebase/7.18.0/firebase-app.js','/__/firebase/7.18.0/firebase-auth.js','/__/firebase/7.18.0/firebase-firestore.js','/__/firebase/init.js']) {
    await new Promise((resolve,reject) => {const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error('暂时无法连接账号服务。'));document.head.append(s);});
  }
  return new Promise(resolve => {const stop=globalThis.firebase.auth().onAuthStateChanged(user=>{stop();resolve(user);});});
}
async function start() {
  $('.brand').href=demo?'app.html?demo=1':'app.html';
  const accountButton=document.createElement('button');
  accountButton.className='icon-button';accountButton.dataset.action='account';accountButton.setAttribute('aria-label','登录与账号');accountButton.innerHTML=icon('people');
  $('.topbar-actions').append(accountButton);
  try {
    let user;
    if (!demo) user = await loadFirebase();
    if (!demo && !user) { showSignIn(); return; }
    const visitor = demo && params.has('invite') ? {uid:'demo-guest',displayName:'新成员'} : undefined;
    state.store = createStore({mode:demo?'demo':'cloud',user:visitor});
    $('#account-name').textContent=state.store.currentUser.displayName || '我的账号';
    $('.avatar-self').textContent=Array.from(state.store.currentUser.displayName || '我')[0];
    if (params.has('invite')) {await showInvitation(params.get('invite'));return;}
    await loadData();
  } catch(error) {$('#main-content').innerHTML=empty('暂时无法打开账本', errorMessage(error), '<a class="button primary" href="app.html?demo=1">试用账本</a><a class="button secondary" href="index.html">返回登录</a>');}
}
function showSignIn() {
  $('#main-content').innerHTML=empty('登录后，继续你的账本','账号登录后可访问共享账本和提交成员认领。',`<a class="button primary" href="index.html?next=${encodeURIComponent(location.pathname+location.search)}">登录账号</a><a class="button secondary" href="app.html?demo=1">先试用</a>`);
}
async function loadData(preferredId) {
  const oldId=state.snapshot?.ledger.id;
  state.ledgers=await state.store.listLedgers();
  const id=[preferredId,oldId,params.get('ledger'),state.ledgers[0]?.id].find(id=>state.ledgers.some(l=>l.id===id));
  state.snapshot=id?await state.store.loadLedger(id):null;
  render();
  if(id){const url=new URL(location.href);url.searchParams.set('ledger',id);url.hash=state.view;history.replaceState(null,'',url);}
}
function render() {
  const nav = views.map(v=>`<button class="nav-item ${state.view===v.id?'active':''}" data-view="${v.id}" ${state.view===v.id?'aria-current="page"':''}>${icon(v.icon)}<span>${v.name}</span></button>`).join('');
  $('#primary-nav').innerHTML=nav; $('#mobile-nav').innerHTML=nav;
  $('#ledger-picker').innerHTML=state.ledgers.map(l=>`<option value="${escape(l.id)}" ${l.id===state.snapshot?.ledger.id?'selected':''}>${escape(l.title)}</option>`).join('')+'<option value="__new__">＋ 新建账本</option>';
  $('#ledger-nav').innerHTML=state.ledgers.map(l=>`<button class="ledger-nav-item ${l.id===state.snapshot?.ledger.id?'active':''}" data-ledger="${escape(l.id)}"><span class="ledger-dot"></span><span>${escape(l.title)}</span></button>`).join('');
  if (!state.snapshot) {$('#main-content').innerHTML=heading('从第一本账开始','把一次旅行，或每一天的小账，记在一起。')+empty('还没有共享账本','新建账本后，可以先用名字添加成员。','<button class="button primary" data-action="new-ledger">新建账本</button>');return;}
  if (!views.some(v=>v.id===state.view)) state.view='overview';
  $('#main-content').innerHTML=({overview:overview,expenses:expensesView,settlements:settlementsView,members:membersView}[state.view])();
}
function myTotals() {
  const id=mine()?.id; let receivable=0,payable=0;
  for (const e of activeExpenses()) {if (e.payerMemberId===id) receivable+=outstanding(e);else if (id) payable+=remainingFor(e,id);}
  return {receivable,payable};
}
function statusFor(e) {
  if (e.status==='reversed') return '<span class="badge neutral">已撤销</span>';
  if (outstanding(e)===0) return '<span class="badge success">已结清</span>';
  if (Object.values(e.repaid || {}).some(v=>v>0)) return '<span class="badge pending">部分已还</span>';
  return '<span class="badge neutral">待结清</span>';
}
function expenseRows(list) {
  if (!list.length) return empty('这里还没有账单','记下第一笔共同开销，分摊结果会清楚列出来。',newExpenseButton());
  return `<div class="expense-list">${list.map(e=>{
    const id=mine()?.id;
    const relation=e.status==='reversed'?'已撤销':e.payerMemberId===id?`待收 ${money(outstanding(e))}`:id&&e.shares[id]!==undefined?`我待付 ${money(remainingFor(e,id))}`:'账本成员可见';
    return `<button class="expense-row" data-expense="${escape(e.id)}"><span class="expense-icon">${icon('receipt')}</span><span class="expense-info"><span class="expense-title">${escape(e.title)} ${statusFor(e)}</span><span class="expense-meta">${escape(memberName(e.payerMemberId))}垫付 · ${escape(dateText(e.date))} · ${Object.keys(e.shares).length}人参与</span></span><span class="expense-amount"><strong>${money(e.amountCents)}</strong><small>${relation}</small></span>${icon('arrow')}</button>`;
  }).join('')}</div>`;
}
const createdTime = value => value?.toMillis ? value.toMillis() : Date.parse(value) || 0;
const newestFirst = (a,b) => String(b.date).localeCompare(String(a.date)) || createdTime(b.createdAt)-createdTime(a.createdAt);
function sortedExpenses(){return [...state.snapshot.expenses].sort(newestFirst);}
function sortedPayments(){return [...state.snapshot.payments].sort(newestFirst);}
function overview() {
  const s=state.snapshot, totals=myTotals(), active=activeExpenses();
  const effective=sortedPayments().filter(p=>p.type==='payment'&&!p.reversedBy).slice(0,3);
  const memberList=s.members.slice(0,4).map(m=>`<div class="member-row">${avatar(m.name)}<div class="member-info"><strong>${escape(m.name)}${m.uid===state.store.currentUser.uid?' <span class="me-label">我</span>':''}</strong><small>${m.uid?'已加入':'临时成员'}</small></div><span class="member-amount">${balanceLabel(m.id)}</span></div>`).join('');
  return heading('把账理清，轻松一点。',`${escape(s.ledger.title)} · ${s.members.length}位成员`,newExpenseButton())+
    `<div class="overview-grid"><div class="main-column"><section class="balance-strip" aria-label="我的待收待付"><div class="balance-block"><span class="balance-label">待收回</span><strong class="balance-amount amount-in">${money(totals.receivable)}</strong><span class="balance-note">已垫付，等待伙伴还款</span></div><div class="balance-block"><span class="balance-label">待支付</span><strong class="balance-amount">${money(totals.payable)}</strong><span class="balance-note">确认转账后，由收款人记一笔</span></div><div class="balance-footer"><span>本账本累计支出 <strong>${money(active.reduce((n,e)=>n+e.amountCents,0))}</strong></span><button class="text-link" data-view="settlements">查看结算 ${icon('arrow')}</button></div></section>
    <section class="panel"><div class="section-heading"><h2>最近账单</h2><button class="text-link" data-view="expenses">查看全部 ${icon('arrow')}</button></div>${expenseRows(sortedExpenses().slice(0,5))}</section>
    <section class="panel-quiet"><div class="section-heading"><h2>最近还款</h2><button class="text-link" data-view="settlements">全部记录</button></div>${effective.length?effective.map(p=>`<div class="activity-row"><span class="activity-icon">${icon('check')}</span><div><strong>${escape(memberName(p.fromMemberId))} → ${escape(memberName(p.toMemberId))}</strong><small>${escape(dateText(p.date))} · 已确认收款</small></div><strong>${money(p.amountCents)}</strong></div>`).join(''):'<p class="muted">第一笔收款确认后，记录会出现在这里。</p>'}</section></div>
    <aside class="side-column"><section class="panel"><div class="section-heading"><h2>成员净余额</h2><span class="count-label">${s.members.length}人</span></div>${memberList}<button class="button secondary full-width" data-view="members">${icon('people')}管理成员与邀请</button></section><section class="share-panel"><span class="share-symbol">${icon('share')}</span><h2>一张清单，把账说明白。</h2><p>把待结清的金额整理好，分享给一起消费的伙伴。</p><button class="button secondary" data-action="share">预览结算单 ${icon('arrow')}</button></section></aside></div>`;
}
function balanceLabel(id) {
  const b=memberBalances(state.snapshot).find(x=>x.memberId===id)?.balanceCents || 0;
  return b===0?'<span class="muted">已平衡</span>':b>0?`<span class="amount-in">待收 ${money(b)}</span>`:`待付 ${money(-b)}`;
}
function expensesView() {
  const id=mine()?.id;
  const filtered=sortedExpenses().filter(e=>(!state.search||e.title.toLowerCase().includes(state.search.toLowerCase()))&&(state.filter==='all'||state.filter==='mine'&&e.payerMemberId===id||state.filter==='participating'&&Object.hasOwn(e.shares,id)||state.filter==='open'&&e.status!=='reversed'&&outstanding(e)>0));
  return heading('每一笔，都有来处。','查看共同开销，也看清自己承担的部分。',newExpenseButton())+
  `<div class="filter-bar"><div class="filter-chips">${[['all','全部'],['mine','我垫付'],['participating','我参与'],['open','未结清']].map(([id,label])=>`<button class="chip ${state.filter===id?'active':''}" data-filter="${id}" aria-pressed="${state.filter===id}">${label}</button>`).join('')}</div><label class="search-field">${icon('search')}<input id="expense-search" type="search" placeholder="搜索账单" aria-label="搜索账单" value="${escape(state.search)}"></label></div><section class="panel">${expenseRows(filtered)}</section>`;
}
function settlementsView() {
  const pending=[];
  for(const expense of activeExpenses()) for(const id of Object.keys(expense.shares)) {const remaining=remainingFor(expense,id);if(id!==expense.payerMemberId&&remaining>0)pending.push({expense,id,remaining});}
  const payments=sortedPayments();
  return heading('结清一笔，轻松一分。','还款记录保留在这里，来龙去脉都能查到。',`<button class="button secondary" data-action="share">${icon('share')}分享结算单</button>`)+
    `<div class="overview-grid"><div class="main-column"><section class="panel"><div class="section-heading"><h2>待结清</h2><span class="count-label">${pending.length}笔往来</span></div>${pending.length?pending.map(({expense:e,id,remaining})=>`<div class="settlement-row">${avatar(memberName(id))}<div class="member-info"><strong>${escape(memberName(id))} <span class="direction-arrow">→</span> ${escape(memberName(e.payerMemberId))}</strong><button class="text-link secondary-link" data-expense="${escape(e.id)}">${escape(e.title)}</button></div><strong class="settlement-amount">${money(remaining)}</strong>${canReceive(e)?`<button class="button secondary small-button" data-payment="${escape(e.id)}" data-member="${escape(id)}">记录收款</button>`:'<span class="badge neutral">待收款人确认</span>'}</div>`).join(''):empty('这个账本已经结清','每一笔共同开销都已对上。')}</section>
    <section class="panel-quiet"><div class="section-heading"><h2>还款流水</h2><span class="count-label">${payments.length}条记录</span></div>${payments.length?payments.map(p=>{const e=state.snapshot.expenses.find(e=>e.id===p.expenseId);return `<div class="journal-row"><div><strong>${p.type==='reversal'?'撤销收款':`${escape(memberName(p.fromMemberId))} → ${escape(memberName(p.toMemberId))}`}</strong><small>${escape(p.date)} · ${escape(e?.title || '账单')}${p.note?' · '+escape(p.note):''}</small></div><strong>${p.type==='reversal'?'−':''}${money(p.amountCents)}</strong>${p.reversedBy?'<span class="badge neutral">已撤销</span>':p.type==='payment'&&e&&canReceive(e)?`<button class="text-link" data-reverse-payment="${escape(p.id)}">撤销</button>`:''}</div>`;}).join(''):'<p class="muted">记录部分或全部收款后，会生成一条可追溯的流水。</p>'}</section></div><aside class="side-column"><section class="panel"><div class="section-heading"><h2>成员净余额</h2></div>${state.snapshot.members.map(m=>`<div class="member-row">${avatar(m.name)}<div class="member-info"><strong>${escape(m.name)}</strong></div><span class="member-amount">${balanceLabel(m.id)}</span></div>`).join('')}<p class="form-hint">净余额用于核对。收款仍逐笔记录，不会自动抵扣原始账单。</p></section></aside></div>`;
}
function membersView() {
  const claims=(state.snapshot.claims || []).filter(c=>c.status==='pending');
  return heading('一起记，才能一起算清。','先用名字添加伙伴，邀请认领后再连接到本人账号。',owner()?`<button class="button primary" data-action="new-member">${icon('plus')}添加成员</button>`:'')+
    `<div class="overview-grid"><section class="panel">${state.snapshot.members.map(m=>`<div class="member-row spacious">${avatar(m.name)}<div class="member-info"><strong>${escape(m.name)}${m.uid===state.store.currentUser.uid?' <span class="me-label">我</span>':''}</strong><small>${m.uid===state.snapshot.ledger.ownerUid?'账本创建者':m.uid?'已认领 · 可共同记账':'临时成员 · 认领前由账本创建者代记'}</small></div>${m.uid?'<span class="badge success">已加入</span>':owner()?`<button class="button secondary small-button" data-invite-member="${escape(m.id)}">邀请认领</button>`:'<span class="badge neutral">待认领</span>'}</div>`).join('')}</section><aside class="side-column"><section class="panel"><div class="section-heading"><h2>认领申请</h2><span class="count-label">${claims.length}</span></div>${owner()?claims.length?claims.map(c=>{const invite=state.snapshot.invites.find(i=>i.id===c.inviteToken);return `<div class="claim-row"><p><strong>${escape(c.displayName)}</strong> 申请认领「${escape(invite?.memberName || '成员')}」</p><button class="button primary full-width" data-approve="${escape(c.inviteToken)}" data-uid="${escape(c.uid)}">核对本人后批准</button></div>`;}).join(''):'<p class="muted">伙伴通过邀请链接申请后，会在这里等待你的确认。</p>':'<p class="muted">认领申请由账本创建者核对与批准。</p>'}</section><div class="notice"><h3>名字相同，也不会自动合并。</h3><p>临时成员的账目保持原样。本人登录、提交认领、经创建者确认后，才会连接到账号。</p></div></aside></div>`;
}

function openDialog(title,body,footer='',wide=false) {
  const d=$('#action-dialog'); d.classList.toggle('wide-dialog',wide);
  $('#dialog-content').innerHTML=`<div class="dialog-header"><h2 id="dialog-title">${title}</h2><button class="dialog-close icon-button" data-action="close-dialog" aria-label="关闭">${icon('close')}</button></div><div class="dialog-body">${body}</div>${footer?`<div class="dialog-footer">${footer}</div>`:''}`;
  if (!d.open)d.showModal();else d.querySelector('[autofocus]')?.focus();
}
function closeDialog() {$('#action-dialog').close();}
function formError(message) {const e=$('#form-error');if(e){e.textContent=message;e.hidden=false;}else toast(message);}
function errorSlot(){return '<p class="form-error" id="form-error" role="alert" hidden></p>';}
async function submitForm(event, action) {
  event.preventDefault();const button=event.target.querySelector('[type="submit"]');if(button?.disabled)return;
  if(button){button.disabled=true;button.dataset.label=button.textContent;button.textContent='正在保存…';}
  try {await action(new FormData(event.target));}catch(e){formError(errorMessage(e));}finally{if(button){button.disabled=false;button.textContent=button.dataset.label;}}
}
function newLedger() {
  if(!state.store){showSignIn();return;}
  openDialog('新建共同账本',`<form id="ledger-form"><label class="form-field"><span class="field-label">账本名称</span><input class="form-input" name="title" placeholder="例如：阳光合租 · 秋季" maxlength="60" required autofocus></label><label class="form-field"><span class="field-label">记账币种</span><select class="form-select" name="currency"><option value="CNY">人民币 CNY</option><option value="USD">美元 USD</option></select></label><p class="form-hint">一个账本使用一种币种，成员与账单都归在这本账里。</p>${errorSlot()}<div class="form-actions"><button type="button" class="button secondary" data-action="close-dialog">取消</button><button class="button primary" type="submit">创建账本</button></div></form>`);
  $('#ledger-form').addEventListener('submit',e=>submitForm(e,async data=>{const id=await state.store.createLedger({title:data.get('title').trim(),currency:data.get('currency'),ownerName:state.store.currentUser.displayName || '我'});closeDialog();state.view='members';await loadData(id);toast('账本已创建，添加一起记账的伙伴吧。');}));
}
function newMember() {
  openDialog('添加一位伙伴',`<form id="member-form"><label class="form-field"><span class="field-label">伙伴怎么称呼？</span><input class="form-input" name="name" maxlength="40" placeholder="输入名字或熟悉的称呼" required autofocus></label><p class="form-hint">现在就可以为这位伙伴记账，之后再邀请本人认领。</p>${errorSlot()}<div class="form-actions"><button type="button" class="button secondary" data-action="close-dialog">取消</button><button class="button primary" type="submit">添加成员</button></div></form>`);
  $('#member-form').addEventListener('submit',e=>submitForm(e,async data=>{await state.store.addMember(state.snapshot.ledger.id,data.get('name').trim());closeDialog();await loadData();toast('成员已添加，可以开始分摊了。');}));
}
function newExpense() {
  if(!state.snapshot)return newLedger();
  const s=state.snapshot, me=mine(); let splitType='equal', amountDraftInitialized=false;
  const defaultCount=Math.min(s.members.length,8);
  const payerOptions=s.members.filter(m=>owner()||m.uid===state.store.currentUser.uid).map(m=>`<option value="${escape(m.id)}" ${m.id===me?.id?'selected':''}>${escape(m.name)}${m.id===me?.id?'（我）':''}</option>`).join('');
  const percentRows=s.members.map((m,i)=>`<div class="percent-field" data-percent-member="${escape(m.id)}"><label for="percent-${i}">${escape(m.name)}</label><span class="split-input-unit"><input id="percent-${i}" class="form-input" type="number" min="0" max="100" step="0.01" inputmode="decimal" data-percent="${escape(m.id)}" value="${i<defaultCount?((Math.floor(10000/defaultCount)+(i<10000%defaultCount?1:0))/100).toFixed(2):'0.00'}" aria-label="${escape(m.name)}的比例" aria-describedby="percent-result-${i}"><span>%</span></span><output id="percent-result-${i}" for="new-amount percent-${i}" data-percent-result="${escape(m.id)}" class="split-converted" aria-live="off">—</output></div>`).join('');
  const amountRows=s.members.map(m=>`<label class="amount-field" data-amount-member="${escape(m.id)}"><span>${escape(m.name)}</span><span class="split-input-unit"><input class="form-input" inputmode="decimal" data-share-amount="${escape(m.id)}" placeholder="0.00" aria-label="${escape(m.name)}承担金额"><span>${escape(s.ledger.currency)}</span></span></label>`).join('');
  openDialog('记一笔共同开销',`<form id="expense-form"><div class="entry-layout"><div class="entry-fields"><label class="form-field"><span class="field-label">金额 · ${escape(s.ledger.currency)}</span><input name="amount" id="new-amount" class="form-input amount-input" inputmode="decimal" placeholder="0.00" required autofocus></label><label class="form-field"><span class="field-label">花在了哪里？</span><input class="form-input" name="title" maxlength="100" placeholder="例如：周五一起吃火锅" required></label><div class="form-grid"><label class="form-field"><span class="field-label">谁先垫付</span><select class="form-select" name="payer">${payerOptions}</select></label><label class="form-field"><span class="field-label">日期</span><input class="form-input" name="date" type="date" value="${localDate()}" required></label></div><fieldset class="participant-fieldset"><legend class="field-label">谁参与这笔消费</legend><div class="participant-grid">${s.members.map((m,i)=>`<label class="member-check"><input type="checkbox" name="participant" value="${escape(m.id)}" ${i<8?'checked':''}>${avatar(m.name)}<span>${escape(m.name)}</span></label>`).join('')}</div><p class="form-hint">付款人也可以参与分摊。只勾选实际消费的人，每笔最多 8 人。</p></fieldset><div class="split-choice" role="group" aria-label="分摊方式"><button type="button" class="chip active" data-split="equal" aria-pressed="true">均分</button><button type="button" class="chip" data-split="percent" aria-pressed="false">按比例</button><button type="button" class="chip" data-split="amount" aria-pressed="false">按金额</button></div><div id="percent-fields" hidden>${percentRows}<p class="form-hint">每行右侧显示该比例对应的金额，精确到分。</p></div><div id="amount-fields" hidden><p class="form-hint">直接填写每个人承担的金额，合计需要与账单总额一致。</p>${amountRows}<p id="amount-summary" class="split-summary" role="status"></p></div></div><aside class="entry-preview"><h3>分摊预览</h3><div id="split-preview"><p class="muted">填写金额后，就能看到每人承担多少。</p></div></aside></div>${errorSlot()}<div class="form-actions"><button type="button" class="button secondary" data-action="close-dialog">取消</button><button class="button primary" type="submit">保存账单</button></div></form>`,'',true);
  const form=$('#expense-form');
  const draftValues=attribute=>Object.fromEntries([...form.querySelectorAll(`[${attribute}]`)].map(input=>[input.getAttribute(attribute),input.value]));
  function calculate() {
    const data=new FormData(form),amount=parseMoney(data.get('amount')),ids=data.getAll('participant');
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
      summary.textContent=`已分配 ${money(sum)} · ${difference>0?`还差 ${money(difference)}`:difference<0?`超出 ${money(-difference)}`:'与总额一致'}${missing?` · ${missing}人未填写`:''}`;
      summary.dataset.state=difference<0?'error':difference===0&&!missing?'success':'';
    }catch(error){summary.textContent=form.elements.amount.value?errorMessage(error):'先填写账单总额，再分配每个人的金额。';}
  }
  function preview() {
    const chosen=new FormData(form).getAll('participant');
    form.querySelectorAll('[data-percent-member]').forEach(e=>{e.hidden=!chosen.includes(e.dataset.percentMember);e.querySelector('input').disabled=e.hidden||splitType!=='percent';});
    form.querySelectorAll('[data-amount-member]').forEach(e=>{e.hidden=!chosen.includes(e.dataset.amountMember);e.querySelector('input').disabled=e.hidden||splitType!=='amount';});
    form.querySelectorAll('[data-percent-result]').forEach(e=>{e.textContent='—';});
    if(splitType==='amount')amountSummary(chosen);
    try {
      const {amount,shares}=calculate(),payer=form.elements.payer.value,total=Object.values(shares).reduce((a,b)=>a+b,0),self=(shares[payer]||0)+amount-total;
      if(splitType==='percent')form.querySelectorAll('[data-percent-result]').forEach(e=>{if(Object.hasOwn(shares,e.dataset.percentResult))e.textContent=money(shares[e.dataset.percentResult]);});
      $('#split-preview').innerHTML=`<div class="preview-list">${chosen.map(id=>`<div class="preview-row"><span>${escape(memberName(id))}${id===payer?' <small>垫付人</small>':''}</span><strong>${money(shares[id])}</strong></div>`).join('')}</div>${amount-total?`<p class="form-hint">未分配 ${money(amount-total)}，由垫付人承担。</p>`:''}<div class="preview-total"><span>总额</span><strong>${money(amount)}</strong></div><p class="form-hint">垫付人自付 ${money(self)}，待收回 ${money(amount-self)}。</p>`;
    }catch(error){$('#split-preview').innerHTML=`<p class="form-hint">${escape(form.elements.amount.value?errorMessage(error):'填写金额后，就能看到每人承担多少。')}</p>`;}
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
    $('#percent-fields').hidden=splitType!=='percent';$('#amount-fields').hidden=splitType!=='amount';$('#form-error').hidden=true;preview();
  }));
  form.addEventListener('submit',e=>submitForm(e,async data=>{const {amount,shares}=calculate();await state.store.addExpense(s.ledger.id,{title:data.get('title').trim(),date:data.get('date'),amountCents:amount,payerMemberId:data.get('payer'),shares});closeDialog();state.view='expenses';await loadData();toast('账单已保存，每个人的份额都记好了。');}));
  preview();
}
function showExpense(id) {
  const e=state.snapshot.expenses.find(e=>e.id===id);if(!e)return;
  const shares=Object.keys(e.shares).map(id=>{const isPayer=id===e.payerMemberId,remaining=remainingFor(e,id),paid=e.repaid?.[id]||0;return `<div class="member-row">${avatar(memberName(id))}<div class="member-info"><strong>${escape(memberName(id))}${isPayer?' · 垫付人':''}</strong><small>${isPayer?'自己的消费份额':paid?`已还 ${money(paid)}`:'尚未还款'}</small></div><div class="expense-amount"><strong>${money(e.shares[id])}</strong><small>${isPayer?'自付':`待付 ${money(remaining)}`}</small></div>${!isPayer&&remaining>0&&e.status==='active'&&canReceive(e)?`<button class="button secondary small-button" data-payment="${escape(e.id)}" data-member="${escape(id)}">收款</button>`:''}</div>`;}).join('');
  openDialog(escape(e.title),`<div class="detail-amount">${money(e.amountCents)}</div><div class="detail-meta">${escape(e.date)} · ${escape(memberName(e.payerMemberId))}垫付 ${statusFor(e)}</div><div class="section-heading"><h3>每个人的份额</h3></div>${shares}${errorSlot()}`,e.status==='active'&&(owner()||e.createdByUid===state.store.currentUser.uid)?`<button class="text-link danger-link" data-reverse-expense="${escape(e.id)}">撤销这笔账单</button><button class="button secondary" data-action="close-dialog">完成</button>`:'<button class="button secondary" data-action="close-dialog">完成</button>');
}
function paymentDialog(expenseId,fromId) {
  const e=state.snapshot.expenses.find(e=>e.id===expenseId);if(!e)return;const remaining=remainingFor(e,fromId);
  openDialog('确认收到一笔还款',`<p class="payment-direction">${escape(memberName(fromId))} <span class="direction-arrow">→</span> ${escape(memberName(e.payerMemberId))}</p><p class="muted">${escape(e.title)} · 剩余待收 ${money(remaining)}</p><form id="payment-form"><label class="form-field"><span class="field-label">本次实际收到</span><input class="form-input amount-input" name="amount" inputmode="decimal" value="${amountText(remaining)}" required autofocus></label><div class="form-grid"><label class="form-field"><span class="field-label">收款日期</span><input class="form-input" type="date" name="date" value="${localDate()}" required></label><label class="form-field"><span class="field-label">备注（选填）</span><input class="form-input" name="note" maxlength="120" placeholder="例如：微信转账，先还一部分"></label></div><p class="form-hint">只记录已经收到的钱；支持部分还款，不会实际扣款或转账。</p>${errorSlot()}<div class="form-actions"><button class="button secondary" type="button" data-action="close-dialog">取消</button><button class="button primary" type="submit">确认已收到</button></div></form>`);
  $('#payment-form').addEventListener('submit',event=>submitForm(event,async data=>{await state.store.recordPayment(state.snapshot.ledger.id,{expenseId,fromMemberId:fromId,amountCents:parseMoney(data.get('amount')),date:data.get('date'),note:data.get('note').trim()});closeDialog();await loadData();toast('已记录本次收款，剩余金额已更新。');}));
}
function confirmAction(title,text,buttonLabel,action,success='已撤销，原记录和更正记录均已保留。') {
  openDialog(title,`<p>${text}</p>${errorSlot()}<form id="confirm-form"><div class="form-actions"><button class="button secondary" type="button" data-action="close-dialog">返回</button><button class="button primary" type="submit">${buttonLabel}</button></div></form>`);
  $('#confirm-form').addEventListener('submit',event=>submitForm(event,async()=>{await action();closeDialog();await loadData();toast(success);}));
}
async function invitationDialog(memberId) {
  try {const token=await state.store.createInvite(state.snapshot.ledger.id,memberId),url=new URL('app.html',location.href);url.search='';if(demo)url.searchParams.set('demo','1');url.searchParams.set('invite',token);
    openDialog(`邀请${escape(memberName(memberId))}认领`, `<p>把链接发给本人。对方打开链接申请认领，再由你核对批准。</p><label class="form-field"><span class="field-label">邀请链接</span><input class="form-input" id="invite-url" value="${escape(url.href)}" readonly></label><p class="form-hint">链接仅用于这位成员的认领申请，不会直接开放账本。</p>${errorSlot()}<div class="form-actions"><a class="button secondary" href="${escape(url.href)}" target="_blank" rel="noopener">打开邀请</a><button class="button primary" id="copy-invite">复制邀请链接</button></div>`);
    $('#copy-invite').addEventListener('click',()=>copyText(url.href,'邀请链接已复制，请自行发给本人。'));await refreshSnapshotOnly();
  }catch(e){toast(errorMessage(e));}
}
async function refreshSnapshotOnly(){state.snapshot=await state.store.loadLedger(state.snapshot.ledger.id);}
async function showInvitation(token) {
  $('#primary-nav').innerHTML='';$('#mobile-nav').innerHTML='';
  const invite=await state.store.getInvite(token);
  if(invite.status==='accepted'&&invite.acceptedUid===state.store.currentUser.uid) {state.inviteAccepted=true;await loadData(invite.ledgerId);toast('认领已批准，欢迎加入共同账本。');return;}
  $('#main-content').innerHTML=`<div class="invite-page"><span class="invite-emblem">${icon('people')}</span><h1>这是你们共同的账本。</h1><p>你受邀认领「<strong>${escape(invite.memberName)}</strong>」，加入 ${escape(invite.ledgerTitle)}。</p><section class="panel"><h2>先确认是你本人</h2><p>申请认领后，账本创建者会核对你的账号。批准前，你无法查看账目。</p><form id="claim-form"><label class="form-field"><span class="field-label">向创建者说明你的称呼</span><input class="form-input" name="name" maxlength="40" value="${escape(state.store.currentUser.displayName || '')}" required></label>${errorSlot()}<button type="submit" class="button primary full-width">提交认领申请</button></form></section>${demo?'':'<a class="text-link" href="app.html">返回我的账本</a>'}</div>`;
  $('#claim-form').addEventListener('submit',event=>submitForm(event,async data=>{await state.store.claimInvite(token,{displayName:data.get('name').trim()});$('#claim-form').innerHTML='<div class="notice"><h3>认领申请已提交</h3><p>请等待账本创建者确认。批准后，用同一账号打开账本即可。</p></div>'; }));
}
async function copyText(text, success='已复制。') {
  try {await navigator.clipboard.writeText(text);toast(success);}catch {formError('浏览器未允许复制，请选中文本手动复制。');const field=$('#statement-text')||$('#invite-url');field?.focus();field?.select();}
}
function shareDialog() {
  const text=settlementText(state.snapshot);
  openDialog('分享前，先看一眼',`<p class="muted">结算单包含本账本成员姓名和金额。确认分享范围后，再发给你的伙伴。</p><label class="sr-only" for="statement-text">结算单内容</label><textarea class="statement" id="statement-text" readonly rows="13">${escape(text)}</textarea>${errorSlot()}<div class="form-actions"><button class="button secondary" id="download-statement">下载文本</button><button class="button primary" id="copy-statement">复制结算单</button></div>`);
  $('#copy-statement').addEventListener('click',()=>copyText(text,'结算单已复制，可以粘贴到聊天中。'));
  $('#download-statement').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`${state.snapshot.ledger.title.replace(/[\\/:*?"<>|]/g,'-')}-结算单.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('结算单已下载。');});
}

function accountDialog() {
  if(!state.store){showSignIn();return;}
  openDialog('我的账号',`<p>${demo?'登录后，可以用自己的账号加入共同账本。':`已登录：${escape(state.store.currentUser.email || state.store.currentUser.displayName || '我的账号')}`}</p><div class="form-actions">${demo?'<a class="button primary" href="index.html">登录账号</a>':'<a class="button secondary" href="history.html">查看原有独立账单</a><button class="button primary" id="sign-out">退出登录</button>'}</div>`);
  $('#sign-out')?.addEventListener('click',async()=>{await globalThis.firebase.auth().signOut();location.href='index.html';});
}

document.addEventListener('click', async event => {
  const el=event.target.closest('button,a');if(!el)return;
  if (el.dataset.view) {state.view=el.dataset.view;location.hash=state.view;render();return;}
  if (el.dataset.ledger) {await selectLedger(el.dataset.ledger);return;}
  if (el.dataset.expense) {showExpense(el.dataset.expense);return;}
  if (el.dataset.payment) {paymentDialog(el.dataset.payment,el.dataset.member);return;}
  if (el.dataset.inviteMember) {el.disabled=true;await invitationDialog(el.dataset.inviteMember);el.disabled=false;return;}
  if (el.dataset.filter) {state.filter=el.dataset.filter;render();return;}
  if (el.dataset.reversePayment) {const p=state.snapshot.payments.find(p=>p.id===el.dataset.reversePayment);confirmAction('撤销这笔收款？',`将撤销 ${escape(memberName(p.fromMemberId))} 还款 ${money(p.amountCents)} 的确认，恢复相应待收金额，并保留更正记录。`,'确认撤销',()=>state.store.reversePayment(state.snapshot.ledger.id,p.id));return;}
  if (el.dataset.reverseExpense) {const e=state.snapshot.expenses.find(e=>e.id===el.dataset.reverseExpense);confirmAction('撤销这笔账单？',`「${escape(e.title)}」将不再计入余额。已有关联还款时，需要先撤销对应收款记录。`,'撤销账单',()=>state.store.reverseExpense(state.snapshot.ledger.id,e.id));return;}
  if (el.dataset.approve) {confirmAction('确认这位伙伴的身份',`确认申请人是你邀请的本人后，再将临时成员的账目关联到这个账号。`,'确认并批准',async()=>{await state.store.approveClaim(el.dataset.approve,el.dataset.uid);},'认领已批准，伙伴可以用自己的账号共同记账了。');return;}
  const action=el.dataset.action;
  if(action==='close-dialog')closeDialog();
  if(action==='new-ledger')newLedger();
  if(action==='new-member')newMember();
  if(action==='new-expense')newExpense();
  if(action==='share')shareDialog();
  if(action==='account')accountDialog();
  if(action==='refresh') {el.disabled=true;try {await loadData();toast('账本已刷新。');}catch(e){toast(errorMessage(e));}finally{el.disabled=false;}}
});
async function selectLedger(id) {try {await loadData(id);}catch(error){toast(errorMessage(error));}}
$('#ledger-picker').addEventListener('change',event=>{if(event.target.value==='__new__'){event.target.value=state.snapshot?.ledger.id||'';newLedger();}else selectLedger(event.target.value);});
document.addEventListener('input',event=>{if(event.target.id==='expense-search'){state.search=event.target.value;const cursor=event.target.selectionStart;render();const input=$('#expense-search');input.focus();if(cursor!==null)input.setSelectionRange(cursor,cursor);}});
window.addEventListener('hashchange',()=>{if(!params.has('invite')||state.inviteAccepted){state.view=location.hash.slice(1)||'overview';if(state.snapshot)render();}});
start();
