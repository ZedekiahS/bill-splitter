import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {mountConsumption} from '../public/scripts/consumption-view.mjs';
import {categories,consumptionRows,personalData} from '../public/scripts/expense-analytics.mjs';
import {formatMoney} from '../public/scripts/ledger-core.mjs';
import {t,registerMessages,translateError} from '../public/scripts/i18n.mjs';
import analyticsMessages from '../public/scripts/analytics-messages.mjs';
const source=(await readFile(new URL('../public/scripts/app.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/start\(\);\s*$/,'');
const html=await readFile(new URL('../public/app.html',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(){
 const dom=new JSDOM(html,{url:'http://localhost/app.html#personal'}),w=dom.window;w.HTMLElement.prototype.scrollIntoView=()=>{};w.scrollTo=({top})=>{w.scrollY=top;};
 w.document.querySelector('.topbar-actions').insertAdjacentHTML('beforeend','<button data-action="ledger-options"></button>');
 let revision=1,reads=0;
 const ledger={id:'a',title:'A',currency:'CNY',ownerUid:'me',memberUids:['me','other']};
 const snapshot={ledger,members:[{id:'me',uid:'me',name:'Me'},{id:'other',uid:'other',name:'Other'}],expenses:[],payments:[]};
 const add=(id,amount,date='2026-11-09')=>{snapshot.expenses.push({id,title:id,date,status:'active',payerMemberId:'other',amountCents:amount,category:'food',shares:{me:amount},repaid:{}});revision++;};
 add('first',1000);
 const store={currentUser:{uid:'me'},listUpdates:async()=>{reads++;return [{id:'a',revision}];},listLedgers:async()=>[structuredClone(ledger)],loadLedger:async()=>structuredClone(snapshot),personalConsumption:async()=>personalData([snapshot],'me')};
 const context=vm.createContext({URL,URLSearchParams,location:w.location,history:w.history,document:w.document,window:w,registerMessages,t,translateError,formatMoney,analyticsMessages,messages:{},featureMessages:{},accountMessages:{},categories,consumptionRows,mountConsumption,translatePage(){},calendarDate:()=> '2026-11-09',createDraftStore:()=>({}),store});
 vm.runInContext(source,context);vm.runInContext("state.store=store;state.starting=false;",context);
 await vm.runInContext('loadData()',context);await tick();
 return {dom,context,snapshot,add,get reads(){return reads;},sync:()=>vm.runInContext('syncChanges()',context),root:w.document};
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
