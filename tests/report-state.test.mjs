import refundMessages from '../public/scripts/refund-messages.mjs';
import {expenseDebts,remainingBetween,refundedTotal,netExpenseAmount} from '../public/scripts/ledger-core.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {mountConsumption} from '../public/scripts/consumption-view.mjs';
import {categories,consumptionRows,personalData} from '../public/scripts/expense-analytics.mjs';
import {formatMoney} from '../public/scripts/ledger-core.mjs';
import {createAutoSync} from '../public/scripts/auto-sync.mjs';
import {nextBudget} from '../public/scripts/personal-budget.mjs';
import {t,registerMessages,translateError} from '../public/scripts/i18n.mjs';
import analyticsMessages from '../public/scripts/analytics-messages.mjs';
const source=(await readFile(new URL('../public/scripts/app.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/start\(\);\s*$/,'');
const html=await readFile(new URL('../public/app.html',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
async function navigate(f,view,method='button'){
 if(method==='hash')await new Promise(resolve=>{f.dom.window.addEventListener('hashchange',resolve,{once:true});f.dom.window.location.hash=view;});
 else {const changed=new Promise(resolve=>f.dom.window.addEventListener('hashchange',resolve,{once:true}));const link=f.root.createElement('button');link.dataset.view=view;f.root.body.append(link);link.click();link.remove();await changed;}
 await tick();
}
function scheduledSync(f){
 let task,delay;
 const scheduler=createAutoSync({check:f.sync,visible:()=>true,onUnauthorized:()=>assert.fail('unexpected unauthorized response'),setTimer(fn,ms){task=fn;delay=ms;return fn;},clearTimer(){task=null;}});
 f.context.scheduler=scheduler;vm.runInContext('autoSync=scheduler',f.context);scheduler.start();
 return {async poll(){assert.ok(task,'automatic sync must remain scheduled');const fn=task;task=null;await fn();},get delay(){return delay;},stop:()=>scheduler.stop()};
}
async function fixture(){
 const dom=new JSDOM(html,{url:'http://localhost/app.html#personal'}),w=dom.window;w.HTMLElement.prototype.scrollIntoView=()=>{};w.scrollTo=({top})=>{w.scrollY=top;};
 w.document.querySelector('.topbar-actions').insertAdjacentHTML('beforeend','<button data-action="ledger-options"></button>');
 let revision=1,reads=0;
 const ledger={id:'a',title:'A',currency:'CNY',ownerUid:'me',memberUids:['me','other']};
 const snapshot={ledger,members:[{id:'me',uid:'me',name:'Me'},{id:'other',uid:'other',name:'Other'}],expenses:[],payments:[]};
 const add=(id,amount,date='2026-11-09')=>{snapshot.expenses.push({id,title:id,date,status:'active',payerMemberId:'other',amountCents:amount,category:'food',shares:{me:amount},repaid:{}});revision++;};
 add('first',1000);
 const store={currentUser:{uid:'me'},listUpdates:async()=>{reads++;return [{id:'a',revision}];},listLedgers:async()=>[structuredClone(ledger)],loadLedger:async()=>structuredClone(snapshot),personalConsumption:async()=>personalData([snapshot],'me')};
 const context=vm.createContext({refundMessages,expenseDebts,remainingBetween,refundedTotal,netExpenseAmount,URL,URLSearchParams,location:w.location,history:w.history,document:w.document,window:w,setTimeout:w.setTimeout.bind(w),clearTimeout:w.clearTimeout.bind(w),registerMessages,t,translateError,formatMoney,analyticsMessages,messages:{},featureMessages:{},accountMessages:{},categories,consumptionRows,mountConsumption,translatePage(){},calendarDate:()=> '2026-11-09',createDraftStore:()=>({}),store});
 vm.runInContext(source,context);vm.runInContext("state.store=store;state.starting=false;",context);
 await vm.runInContext('loadData()',context);await tick();
 return {dom,context,snapshot,add,touch:()=>revision++,get reads(){return reads;},sync:()=>vm.runInContext('syncChanges()',context),root:w.document};
}
test('committed category focus allows remote updates while retaining filter, focus and reading position',async()=>{
 const f=await fixture();try{
  let select=f.root.querySelector('[data-report-filter="category"]');select.value='food';select.onchange();select=f.root.querySelector('[data-report-filter="category"]');select.focus();f.dom.window.scrollY=420;
  f.add('second',2000);await f.sync();await tick();
  assert.ok(f.reads>0,'focused committed filter must not prevent revision reads');
  assert.match(f.root.querySelector('.report-total strong').textContent,/30\.00/);
  assert.equal(f.root.querySelector('[data-report-filter="category"]').value,'food');assert.equal(f.root.activeElement.dataset.reportFilter,'category');assert.equal(f.dom.window.scrollY,420);
 }finally{f.dom.window.close();}
});
test('unfinished date input survives sync; committing it resumes updates without forcing blur',async()=>{
 const f=await fixture();try{
  const period=f.root.querySelector('[data-report-filter="period"]');period.value='custom';period.onchange();
  let from=f.root.querySelector('[data-report-filter="from"]');from.focus();from.value='2026-11-01';from.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));
  f.add('second',2000);await f.sync();assert.equal(f.reads,0);assert.equal(f.root.activeElement,from);assert.equal(from.value,'2026-11-01');assert.match(f.root.querySelector('.report-total strong').textContent,/10\.00/);
  from.onchange();await f.sync();await tick();assert.match(f.root.querySelector('.report-total strong').textContent,/30\.00/);assert.equal(f.root.activeElement.dataset.reportFilter,'from');
 }finally{f.dom.window.close();}
});
test('opening an archived ledger from global history does not archive the global report',async()=>{
 const f=await fixture();try{
  f.snapshot.ledger.status='archived';await vm.runInContext('loadData("a")',f.context);await tick();
  assert.match(f.root.querySelector('h1').textContent,/我的消费/);assert.equal(f.root.querySelector('.ledger-archive-status'),null);
  vm.runInContext("state.view='project-stats';render();",f.context);await tick();assert.match(f.root.querySelector('.ledger-archive-status').textContent,/只读/);
 }finally{f.dom.window.close();}
});
test('excluding the only project in a selected year retains that year across remounts',async()=>{
 const dom=new JSDOM('<main></main>'),root=dom.window.document.querySelector('main');dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
 const data={projects:[{id:'a',title:'Old',currency:'CNY',included:true},{id:'b',title:'New',currency:'CNY',included:true}],rows:[{ledgerId:'a',expenseId:'old',date:'2025-05-01',currency:'CNY',category:'food',amountCents:3500},{ledgerId:'b',expenseId:'new',date:'2026-05-01',currency:'CNY',category:'food',amountCents:1700}]},config={period:'year',year:'2025'};
 const mount=()=>mountConsumption(root,{data,config,personal:true,today:'2026-11-09',onInclusion:async()=>{},onOpen:()=>{}});
 try{mount();const toggle=root.querySelector('[data-report-inclusion="a"]');toggle.checked=false;await toggle.onchange();
  for(let i=0;i<2;i++){
   assert.equal(root.querySelector('[data-report-filter="year"]').value,'2025');assert.equal(config.year,'2025');assert.match(root.querySelector('.annual-title').textContent,/2025/);assert.match(root.querySelector('.report-total p').textContent,/2025-01-01 — 2025-12-31/);assert.match(root.querySelector('.report-total strong').textContent,/0\.00/);mount();
  }
  root.querySelector('[data-report-view="history"]').click();assert.equal(root.querySelector('[data-report-filter="year"]').value,'2025');assert.equal(root.querySelectorAll('[data-report-row]').length,0);
 }finally{dom.window.close();}
});

test('date edits begun during a report fetch are not overwritten or marked as synchronized',async()=>{
 const f=await fixture();try{
  const period=f.root.querySelector('[data-report-filter="period"]');period.value='custom';period.onchange();
  const original=f.context.store.personalConsumption;let release;
  f.context.store.personalConsumption=()=>new Promise(resolve=>{release=resolve;});f.add('second',2000);
  const pending=f.sync();await tick();
  const from=f.root.querySelector('[data-report-filter="from"]');from.focus();from.value='2026-10-01';from.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));
  release(await original());await pending;assert.equal(f.root.activeElement,from);assert.equal(from.value,'2026-10-01');assert.match(f.root.querySelector('.report-total strong').textContent,/10\.00/);
  f.context.store.personalConsumption=original;from.onchange();await f.sync();await tick();assert.match(f.root.querySelector('.report-total strong').textContent,/30\.00/);assert.equal(f.root.querySelector('[data-report-filter="from"]').value,'2026-10-01');
 }finally{f.dom.window.close();}
});

test('a delayed sync report cannot undo a successfully saved inclusion choice',async()=>{
 const f=await fixture();try{
  const original=f.context.store.personalConsumption,oldReport=await original();let release;
  f.context.store.setAnalyticsInclusion=async(id,included)=>{f.snapshot.ledger.analyticsInclusions={me:included};f.touch();};
  f.context.store.personalConsumption=()=>new Promise(resolve=>{release=resolve;});
  const pending=f.sync();await tick();
  const toggle=f.root.querySelector('[data-report-inclusion="a"]');toggle.checked=false;await toggle.onchange();
  assert.equal(f.root.querySelector('[data-report-inclusion="a"]').checked,false);assert.match(f.root.querySelector('.report-total strong').textContent,/0\.00/);
  release(oldReport);await pending;
  assert.equal(f.root.querySelector('[data-report-inclusion="a"]').checked,false,'old report must not recheck the excluded ledger');assert.match(f.root.querySelector('.report-total strong').textContent,/0\.00/);assert.equal(f.snapshot.ledger.analyticsInclusions.me,false);
  f.context.store.personalConsumption=original;await f.sync();assert.match(f.root.querySelector('.report-total strong').textContent,/0\.00/);
 }finally{f.dom.window.close();}
});
for(const navigation of ['button','hash'])test(`leaving and returning via ${navigation} rejects a delayed older sync report`,async()=>{
 const f=await fixture();try{
  f.snapshot.expenses[0].amountCents=3500;f.snapshot.expenses[0].shares.me=3500;
  const original=f.context.store.personalConsumption,oldReport=await original();let release;
  f.context.store.personalConsumption=()=>new Promise(resolve=>{release=resolve;});const pending=f.sync();await tick();
  // Use actual navigation buttons; the project statistics page uses the same report shell.
  const navigate=async view=>{if(navigation==='hash'){await new Promise(resolve=>{f.dom.window.addEventListener('hashchange',resolve,{once:true});f.dom.window.location.hash=view;});}else {const link=f.root.createElement('button');link.dataset.view=view;f.root.body.append(link);link.click();}await tick();};
  await navigate('project-stats');
  f.add('new',4000);f.context.store.personalConsumption=original;
  await navigate('personal');
  assert.match(f.root.querySelector('.report-total strong').textContent,/75\.00/);
  release(oldReport);await pending;await tick();assert.match(f.root.querySelector('.report-total strong').textContent,/75\.00/,'newer report must not regress to 35');
  await f.sync();assert.match(f.root.querySelector('.report-total strong').textContent,/75\.00/);
 }finally{f.dom.window.close();}
});

for(const navigation of ['button','hash'])for(const outcome of ['failed','successful'])test(`${outcome} inclusion save recovers a pending report after ${navigation} navigation`,async()=>{
 const f=await fixture(),scheduler=scheduledSync(f);try{
  await scheduler.poll(); // A failed write must recover even though this revision stays unchanged.
  const original=f.context.store.personalConsumption,save=deferred(),oldRead=deferred();let reportReads=0,writes=0,holdReads=true;
  f.context.store.setAnalyticsInclusion=async(id,included)=>{writes++;await save.promise;f.snapshot.ledger.analyticsInclusions={me:included};f.touch();};
  f.context.store.personalConsumption=()=>{reportReads++;return holdReads?oldRead.promise:original();};
  const toggle=f.root.querySelector('[data-report-inclusion="a"]');toggle.checked=false;const pendingSave=toggle.onchange();
  await navigate(f,'project-stats',navigation);await navigate(f,'personal',navigation);
  assert.match(f.root.querySelector('#consumption-report').textContent,/正在读取/);
  const staleReport=await original();holdReads=false;
  if(outcome==='failed')save.reject(Error('network unavailable'));else save.resolve();
  await pendingSave;await tick();
  oldRead.resolve(staleReport);await tick();
  for(let i=0;i<3;i++)await scheduler.poll();
  assert.ok(f.root.querySelector('.report-total strong'),'successful report must replace the loading state even with unchanged revisions');
  assert.match(f.root.querySelector('.report-total strong').textContent,outcome==='failed'?/10\.00/:/0\.00/);
  assert.equal(f.root.querySelector('[data-report-inclusion="a"]').checked,outcome==='failed');
  assert.equal(f.root.querySelector('#consumption-report').hasAttribute('aria-busy'),false);
  assert.equal(writes,1,'sync must not retry the write');
  const settledReads=reportReads;await scheduler.poll();assert.equal(reportReads,settledReads,'recovered report must not refetch on every unchanged revision');
 }finally{scheduler.stop();f.dom.window.close();}
});

test('failed replacement read exposes retry and ignores the invalidated successful response',async()=>{
 const f=await fixture(),scheduler=scheduledSync(f);try{
  await scheduler.poll();
  const original=f.context.store.personalConsumption,save=deferred(),oldRead=deferred();let phase='pending',writes=0;
  f.context.store.setAnalyticsInclusion=()=>{writes++;return save.promise;};
  f.context.store.personalConsumption=()=>phase==='pending'?oldRead.promise:Promise.reject(Error('report unavailable'));
  const toggle=f.root.querySelector('[data-report-inclusion="a"]');toggle.checked=false;const pendingSave=toggle.onchange();
  await navigate(f,'project-stats','hash');await navigate(f,'personal','hash');
  phase='failed';save.reject(Error('save unavailable'));await pendingSave;await tick();
  oldRead.resolve(await original());await tick();await scheduler.poll();
  assert.match(f.root.querySelector('#consumption-report [role="alert"]').textContent,/网络连接失败/);
  assert.equal(f.root.querySelector('#consumption-report').hasAttribute('aria-busy'),false);
  const retry=f.root.querySelector('#consumption-report [data-action="refresh"]');assert.ok(retry);
  f.context.store.personalConsumption=original;retry.click();await tick();
  assert.match(f.root.querySelector('.report-total strong').textContent,/10\.00/);
  assert.equal(f.root.querySelector('[data-report-inclusion="a"]').checked,true);assert.equal(writes,1);
 }finally{scheduler.stop();f.dom.window.close();}
});

test('failed save after a return report has loaded preserves unfinished date input',async()=>{
 const f=await fixture(),scheduler=scheduledSync(f);try{
  await scheduler.poll();const save=deferred();f.context.store.setAnalyticsInclusion=()=>save.promise;
  const toggle=f.root.querySelector('[data-report-inclusion="a"]');toggle.checked=false;const pendingSave=toggle.onchange();
  await navigate(f,'project-stats','hash');await navigate(f,'personal','hash');
  const period=f.root.querySelector('[data-report-filter="period"]');period.value='custom';period.onchange();
  const from=f.root.querySelector('[data-report-filter="from"]');from.focus();from.value='2026-10-01';from.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));
  save.reject(Error('save unavailable'));await pendingSave;await tick();await scheduler.poll();
  assert.equal(f.root.activeElement,from);assert.equal(from.value,'2026-10-01');assert.match(f.root.querySelector('.report-total strong').textContent,/10\.00/);
  f.add('second',2000);from.onchange();await scheduler.poll();assert.match(f.root.querySelector('.report-total strong').textContent,/30\.00/);
 }finally{scheduler.stop();f.dom.window.close();}
});

test('same-page failed inclusion save keeps its inline error and does not reload the report',async()=>{
 const f=await fixture(),scheduler=scheduledSync(f);try{
  await scheduler.poll();let reportReads=0;const original=f.context.store.personalConsumption;
  f.context.store.personalConsumption=()=>{reportReads++;return original();};
  f.context.store.setAnalyticsInclusion=async()=>{throw Error('save unavailable');};
  const toggle=f.root.querySelector('[data-report-inclusion="a"]');toggle.checked=false;await toggle.onchange();await scheduler.poll();
  assert.equal(toggle.checked,true);assert.equal(toggle.disabled,false);assert.equal(f.root.querySelector('#scope-error').hidden,false);
  assert.match(f.root.querySelector('#scope-error').textContent,/网络连接失败/);assert.equal(reportReads,0);
 }finally{scheduler.stop();f.dom.window.close();}
});

for(const kind of ['ordinary','recovery'])test(`${kind} report cannot be overwritten by an older same-page background response`,async()=>{
 const f=await fixture(),scheduler=scheduledSync(f);try{
  f.snapshot.expenses[0].amountCents=3500;f.snapshot.expenses[0].shares.me=3500;
  await scheduler.poll();
  const original=f.context.store.personalConsumption,requests=[],save=deferred();let pendingSave;
  if(kind==='recovery'){
   f.context.store.setAnalyticsInclusion=()=>save.promise;
   const toggle=f.root.querySelector('[data-report-inclusion="a"]');toggle.checked=false;pendingSave=toggle.onchange();
  }
  f.context.store.personalConsumption=()=>{const request=deferred();requests.push(request);return request.promise;};
  await navigate(f,'project-stats','hash');await navigate(f,'personal','hash');
  const abandoned=kind==='recovery'?requests[0]:null;
  if(pendingSave){save.reject(Error('offline'));await pendingSave;await tick();}
  const visibleRead=requests.at(-1),readsBeforeSync=requests.length;
  f.touch(); // The background poll has a reason to refresh while the page is loading.
  const pendingSync=scheduler.poll();await tick();
  const olderSyncRead=requests.length>readsBeforeSync?requests.at(-1):null,oldReport=await original();
  f.add('new',4000);
  visibleRead.resolve(await original());await tick();
  assert.match(f.root.querySelector('.report-total strong').textContent,/75\.00/);
  olderSyncRead?.resolve(oldReport);abandoned?.resolve(oldReport);await pendingSync;await tick();
  assert.match(f.root.querySelector('.report-total strong').textContent,/75\.00/,'late background snapshot must not regress the visible amount to 35');
  let backgroundReads=0;f.context.store.personalConsumption=()=>{backgroundReads++;return original();};await scheduler.poll();
  assert.match(f.root.querySelector('.report-total strong').textContent,/75\.00/);
  const reads=f.reads;await scheduler.poll();assert.equal(f.reads,reads+1,'polling continues after the report finishes');
  assert.equal(backgroundReads,1,'pending revision is consumed once, after foreground loading');assert.equal(scheduler.delay,3000,'background mounting must not create an immediate polling loop');
 }finally{scheduler.stop();f.dom.window.close();}
});

test('a failed foreground report releases polling and lets an unconsumed revision recover',async()=>{
 const f=await fixture(),scheduler=scheduledSync(f);try{
  await scheduler.poll();const original=f.context.store.personalConsumption,pending=deferred();let reportReads=0;
  f.context.store.personalConsumption=()=>{reportReads++;return pending.promise;};
  await navigate(f,'project-stats','hash');await navigate(f,'personal','hash');f.add('new',4000);
  const revisionReads=f.reads;await scheduler.poll();
  assert.equal(f.reads,revisionReads);assert.equal(reportReads,1,'no parallel report while foreground is pending');
  pending.reject(Error('offline'));await tick();
  assert.ok(f.root.querySelector('#consumption-report [data-action="refresh"]'));assert.equal(scheduler.delay,0,'foreground failure must wake the paused scheduler');
  f.context.store.personalConsumption=()=>{reportReads++;return original();};await scheduler.poll();
  assert.match(f.root.querySelector('.report-total strong').textContent,/50\.00/);assert.equal(reportReads,2);
  await scheduler.poll();assert.equal(reportReads,2);assert.equal(scheduler.delay,3000);
 }finally{scheduler.stop();f.dom.window.close();}
});

for(const outcome of ['success','error'])test(`discarded foreground ${outcome} does not release polling while recovery is still loading`,async()=>{
 const f=await fixture(),scheduler=scheduledSync(f);try{
  await scheduler.poll();const original=f.context.store.personalConsumption,old=deferred(),replacement=deferred(),save=deferred();let reportReads=0;
  f.context.store.personalConsumption=()=>{reportReads++;return reportReads===1?old.promise:replacement.promise;};
  f.context.store.setAnalyticsInclusion=()=>save.promise;
  const toggle=f.root.querySelector('[data-report-inclusion="a"]');toggle.checked=false;const pendingSave=toggle.onchange();
  await navigate(f,'project-stats','hash');await navigate(f,'personal','hash');
  save.reject(Error('offline'));await pendingSave;await tick();assert.equal(reportReads,2);
  if(outcome==='success')old.resolve(await original());else old.reject(Error('old failure'));
  await tick();assert.equal(f.root.querySelector('#consumption-report').getAttribute('aria-busy'),'true');
  f.touch();const revisionReads=f.reads;await scheduler.poll();assert.equal(f.reads,revisionReads);assert.equal(reportReads,2);
  replacement.resolve(await original());await tick();assert.equal(scheduler.delay,0);
  assert.match(f.root.querySelector('.report-total strong').textContent,/10\.00/);
  f.context.store.personalConsumption=original;await scheduler.poll();assert.match(f.root.querySelector('.report-total strong').textContent,/10\.00/);assert.equal(scheduler.delay,3000);
 }finally{scheduler.stop();f.dom.window.close();}
});

test('budget failure after leaving and returning restores editable retry state instead of a stuck saving form',async()=>{
 const f=await fixture();try{
  const save=deferred();f.context.store.savePersonalBudget=()=>save.promise;
  f.root.querySelector('[data-budget-edit]').click();const input=f.root.querySelector('[name="budgetAmount"]');input.value='2000';input.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));
  f.root.querySelector('#budget-form').dispatchEvent(new f.dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();
  await navigate(f,'project-stats','hash');await navigate(f,'personal','hash');assert.equal(f.root.querySelector('#budget-form [type="submit"]').disabled,true);
  save.reject(Error('offline'));await tick();await tick();
  assert.equal(f.root.querySelector('#consumption-report').hasAttribute('aria-busy'),false);assert.equal(f.root.querySelector('#budget-form [type="submit"]').disabled,false);
  assert.match(f.root.querySelector('#budget-form').textContent,/核实预算保存/);assert.equal(f.root.querySelector('[name="budgetAmount"]').value,'2000');
 }finally{f.dom.window.close();}
});

test('budget edit blocks remote repaint until cancelled, then consumes the pending revision',async()=>{
 const f=await fixture();try{
  await f.sync();f.root.querySelector('[data-budget-edit]').click();const input=f.root.querySelector('[name="budgetAmount"]');input.value='1200';input.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));f.add('second',2000);
  await f.sync();assert.equal(f.root.querySelector('[name="budgetAmount"]'),input);assert.equal(input.value,'1200');
  f.root.querySelector('[data-budget-cancel]').click();await f.sync();await tick();assert.match(f.root.querySelector('.report-total strong').textContent,/30\.00/);
 }finally{f.dom.window.close();}
});

for(const outcome of ['success','failure'])for(const path of ['category','currency','history','roundtrip-date'])test(`budget ${outcome} updates current region after ${path} without overwriting input`,async()=>{
 const f=await fixture(),scheduler=scheduledSync(f);try{
  const save=deferred();let writes=0;const original=f.context.store.personalConsumption;let budgets=[];
  f.context.store.personalConsumption=async()=>({...await original(),budgets});
  f.context.store.savePersonalBudget=async payload=>{writes++;await save.promise;budgets=[{...payload,version:1}];};
  f.root.querySelector('[data-budget-edit]').click();let input=f.root.querySelector('[name="budgetAmount"]');input.value='2000';input.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));
  f.root.querySelector('#budget-form').dispatchEvent(new f.dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();
  let date;
  if(path==='roundtrip-date'){
   await navigate(f,'project-stats','hash');await navigate(f,'personal','hash');
   const period=f.root.querySelector('[data-report-filter="period"]');period.value='custom';period.onchange();
   date=f.root.querySelector('[data-report-filter="from"]');date.focus();date.value='2026-10-01';date.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));
  }else if(path==='history')f.root.querySelector('[data-report-view="history"]').click();
  else{const select=f.root.querySelector(`[data-report-filter="${path}"]`);select.value=path==='category'?'food':'USD';select.onchange();}
  if(outcome==='success')save.resolve();else save.reject(Error('response lost'));await tick();await tick();
  if(path==='history')f.root.querySelector('[data-report-view="overview"]').click();
  assert.equal(writes,1);
  if(date){assert.equal(f.root.querySelector('[data-report-filter="from"]'),date);assert.equal(date.value,'2026-10-01');assert.equal(f.root.activeElement,date);}
  if(outcome==='success'){
   assert.equal(f.root.querySelector('#budget-form'),null);
   if(path!=='currency')assert.match(f.root.querySelector('.budget-values').textContent,/2000.00/);
   if(date)date.onchange();const before=f.reads;await scheduler.poll();assert.ok(f.reads>before,'sync must resume after successful budget save');
  }else{assert.equal(f.root.querySelector('#budget-form [type="submit"]').disabled,false);assert.match(f.root.querySelector('#budget-form').textContent,/核实预算保存/);assert.equal(f.root.querySelector('[name="budgetAmount"]').value,'2000');}
 }finally{scheduler.stop();f.dom.window.close();}
});

for(const amount of [100000,null,0])for(const editing of [false,true])test(`late budget read cannot replace version 2 (${amount}) after return; date editing=${editing}`,async()=>{
 const f=await fixture(),scheduler=scheduledSync(f);try{
  const oldRead=deferred(),original=f.context.store.personalConsumption;let reads=0,writes=0;
  const newer=[{month:'2026-11',currency:'CNY',amountCents:amount,version:2},{month:'2026-10',currency:'USD',amountCents:50000,version:3}];
  f.context.store.savePersonalBudget=async()=>{writes++;};
  f.context.store.personalConsumption=async()=>{reads++;return reads===1?oldRead.promise:{...await original(),budgets:structuredClone(newer)};};
  f.root.querySelector('[data-budget-edit]').click();const input=f.root.querySelector('[name="budgetAmount"]');input.value='2000';input.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));
  f.root.querySelector('#budget-form').dispatchEvent(new f.dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();
  await navigate(f,'project-stats','hash');await navigate(f,'personal','hash');
  let date;
  if(editing){const period=f.root.querySelector('[data-report-filter="period"]');period.value='custom';period.onchange();date=f.root.querySelector('[data-report-filter="from"]');date.focus();date.value='2026-10-01';date.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));f.dom.window.scrollY=420;}
  const display=()=>f.root.querySelector('.budget-values')?.textContent||'unset',before=display();
  oldRead.resolve({...await original(),budgets:[{month:'2026-11',currency:'CNY',amountCents:200000,version:1}]});await tick();await tick();
  assert.equal(display(),before,'older read must not change the newer budget even before sync');assert.equal(f.root.querySelector('#budget-form'),null);assert.equal(writes,1);
  for(let i=0;i<3;i++)await scheduler.poll();assert.equal(display(),before);
  if(date){assert.equal(f.root.querySelector('[data-report-filter="from"]'),date);assert.equal(date.value,'2026-10-01');assert.equal(f.root.activeElement,date);assert.equal(date.dataset.editing,'true');assert.equal(f.dom.window.scrollY,420);date.onchange();await scheduler.poll();}
  f.root.querySelector('[data-budget-edit]').click();assert.equal(vm.runInContext('reportConfigs.personal.budgetDraft.expectedVersion',f.context),2);
  f.root.querySelector('[data-budget-cancel]').click();const currency=f.root.querySelector('[data-report-filter="currency"]');currency.value='USD';currency.onchange();const month=f.root.querySelector('[data-budget-month]');month.value='2026-10';month.onchange();assert.match(display(),/500.00/,'an old response omitting a newer month/currency must not remove it');
 }finally{scheduler.stop();f.dom.window.close();}
});

for(const amount of [100000,null,0])test(`explicit reload arriving after navigation uses current budget ${amount} for both review and next write`,async()=>{
 const f=await fixture();try{
  const original=f.context.store.personalConsumption,delayed=deferred();let budget={month:'2026-11',currency:'CNY',amountCents:150000,version:1},hold=false;const writes=[];
  f.context.store.personalConsumption=async()=>hold?delayed.promise:{...await original(),budgets:[structuredClone(budget)]};
  f.context.store.savePersonalBudget=async payload=>{writes.push(structuredClone(payload));budget=nextBudget(budget,payload);};
  await navigate(f,'project-stats','hash');await navigate(f,'personal','hash');
  f.root.querySelector('[data-budget-edit]').click();let input=f.root.querySelector('[name="budgetAmount"]');input.value='1800';input.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));
  budget=nextBudget(budget,{...budget,amountCents:200000,expectedVersion:1});f.root.querySelector('#budget-form').dispatchEvent(new f.dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
  assert.ok(f.root.querySelector('[data-budget-reload]'));const old={...await original(),budgets:[structuredClone(budget)]};hold=true;
  f.root.querySelector('[data-budget-reload]').click();await tick();
  budget=nextBudget(budget,{...budget,amountCents:amount,expectedVersion:2});hold=false;await navigate(f,'project-stats','hash');await navigate(f,'personal','hash');
  const period=f.root.querySelector('[data-report-filter="period"]');period.value='custom';period.onchange();const date=f.root.querySelector('[data-report-filter="from"]');date.focus();date.value='2026-10-01';date.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));
  delayed.resolve(old);await tick();await tick();
  assert.equal(vm.runInContext('reportConfigs.personal.budgetDraft.expectedVersion',f.context),3,'review must adopt current report version rather than old closure data');
  assert.equal(vm.runInContext('reportConfigs.personal.budgetDraft.hadBudget',f.context),amount!==null);
  assert.equal(f.root.querySelector('#budget-error').hidden,true);assert.equal(f.root.querySelector('#budget-notice').getAttribute('role'),'status');assert.equal(f.root.querySelector('#budget-notice').hidden,false);assert.equal(f.root.querySelector('[data-budget-reload]'),null);
  assert.match(f.root.querySelector('#budget-form').textContent,amount===null?/最新预算：未设置/:amount===0?/最新预算：.*0.00/:/最新预算：.*1000.00/);
  assert.equal(f.root.querySelector('[name="budgetAmount"]').value,'1800');assert.equal(f.root.querySelector('[data-report-filter="from"]'),date);assert.equal(f.root.activeElement,date);assert.equal(date.value,'2026-10-01');assert.equal(date.dataset.editing,'true');
  f.root.querySelector('#budget-form').dispatchEvent(new f.dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
  assert.deepEqual(writes.map(p=>p.expectedVersion),[1,3]);assert.equal(budget.version,4);assert.equal(budget.amountCents,180000);assert.equal(f.root.querySelector('#budget-form'),null);
 }finally{f.dom.window.close();}
});
