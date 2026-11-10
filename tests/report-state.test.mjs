import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {mountConsumption} from '../public/scripts/consumption-view.mjs';
import {categories,consumptionRows,personalData} from '../public/scripts/expense-analytics.mjs';
import {formatMoney} from '../public/scripts/ledger-core.mjs';
import {createAutoSync} from '../public/scripts/auto-sync.mjs';
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
 let task;
 const scheduler=createAutoSync({check:f.sync,visible:()=>true,onUnauthorized:()=>assert.fail('unexpected unauthorized response'),setTimer(fn){task=fn;return fn;},clearTimer(){task=null;}});
 f.context.scheduler=scheduler;vm.runInContext('autoSync=scheduler',f.context);scheduler.start();
 return {async poll(){assert.ok(task,'automatic sync must remain scheduled');const fn=task;task=null;await fn();},stop:()=>scheduler.stop()};
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
 const context=vm.createContext({URL,URLSearchParams,location:w.location,history:w.history,document:w.document,window:w,setTimeout:w.setTimeout.bind(w),clearTimeout:w.clearTimeout.bind(w),registerMessages,t,translateError,formatMoney,analyticsMessages,messages:{},featureMessages:{},accountMessages:{},categories,consumptionRows,mountConsumption,translatePage(){},calendarDate:()=> '2026-11-09',createDraftStore:()=>({}),store});
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
