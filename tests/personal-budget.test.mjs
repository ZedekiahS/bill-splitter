import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {budgetData,nextBudget,budgetSummary} from '../public/scripts/personal-budget.mjs';
import {mountConsumption} from '../public/scripts/consumption-view.mjs';
import {createStateStore} from '../public/scripts/ledger-domain.mjs';
import {registerMessages,setLanguage,getLanguage} from '../public/scripts/i18n.mjs';
import messages from '../public/scripts/app-messages.mjs';
import analyticsMessages from '../public/scripts/analytics-messages.mjs';
registerMessages(messages);registerMessages(analyticsMessages);
let dom;afterEach(()=>dom?.window.close());const tick=()=>new Promise(r=>setTimeout(r,20));
const data=()=>({projects:[{id:'a',currency:'CNY',title:'A',included:true},{id:'b',currency:'CNY',title:'Copy',included:false},{id:'usd',currency:'USD',title:'US',included:true}],rows:[{ledgerId:'a',currency:'CNY',date:'2026-11-09',amountCents:130000,title:'个人份额',expenseId:'e',category:'food',itemIndex:null},{ledgerId:'a',currency:'CNY',date:'2026-10-09',amountCents:90000,title:'上月',expenseId:'old',category:'food',itemIndex:null},{ledgerId:'b',currency:'CNY',date:'2026-11-09',amountCents:50000,title:'副本',expenseId:'copy',category:'food',itemIndex:null},{ledgerId:'usd',currency:'USD',date:'2026-11-09',amountCents:2000,title:'美元',expenseId:'usd',category:'food',itemIndex:null}],budgets:[{month:'2026-11',currency:'CNY',amountCents:200000,version:1}]});
function fixture(overrides={}){
 dom=new JSDOM('<main></main>',{url:'http://localhost'});dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
 const root=dom.window.document.querySelector('main'),config={},source=data(),saves=[];
 let save=async(payload,key)=>{saves.push({payload,key});source.budgets=[nextBudget(source.budgets[0],payload)];return source.budgets;};
 const mount=()=>mountConsumption(root,{data:source,config,personal:true,today:'2026-11-10',onOpen:()=>{},onSaveBudget:(...args)=>save(...args),onReloadBudgets:async()=>source.budgets,...overrides});mount();
 const $=s=>root.querySelector(s),click=async s=>{$(s).click();await tick();},input=(s,value)=>{const el=$(s);el.value=value;el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
 return {root,config,source,mount,$,click,input,saves,setSave:fn=>save=fn};
}
test('budget uses only included personal shares for the month and currency, with zero distinct from unset',()=>{
 const s=data();assert.equal(budgetSummary(s,'2026-11','CNY').remainingCents,70000);assert.equal(budgetSummary(s,'2026-10','CNY').spentCents,90000);assert.equal(budgetSummary(s,'2026-11','USD').spentCents,2000);
 s.budgets[0].amountCents=0;assert.equal(budgetSummary(s,'2026-11','CNY').remainingCents,-130000);s.budgets[0].amountCents=null;assert.equal(budgetSummary(s,'2026-11','CNY').remainingCents,null);
 for(const patch of [{month:'2026-13'},{month:'0000-01'},{currency:'cny'},{amountCents:-1},{amountCents:1.2},{expectedVersion:-1}])assert.throws(()=>budgetData({month:'2026-11',currency:'CNY',amountCents:0,expectedVersion:0,...patch}));
});
test('demo budgets are account private and removal retains a version to reject stale updates',async()=>{
 const state={ledgers:{}};const user=uid=>({uid});const store=uid=>createStateStore({user:user(uid),read:()=>state,mutate:fn=>fn(state,user(uid))});const a=store('a'),b=store('b');
 await a.savePersonalBudget({month:'2026-11',currency:'CNY',amountCents:20000,expectedVersion:0});assert.equal((await b.personalConsumption()).budgets.length,0);
 await a.savePersonalBudget({month:'2026-11',currency:'CNY',amountCents:null,expectedVersion:1});await assert.rejects(a.savePersonalBudget({month:'2026-11',currency:'CNY',amountCents:30000,expectedVersion:0}),e=>e.status===409);
});
test('budget spending drilldown clears category/project filters and shows exactly its month',async()=>{
 const f=fixture();f.config.category='shopping';f.config.ledgerId='usd';f.mount();assert.match(f.$('.budget-values').textContent,/700.00/);
 await f.click('.budget-spent');assert.equal(f.config.view,'history');assert.equal(f.config.category,'');assert.equal(f.config.ledgerId,'');assert.equal(f.config.from,'2026-11-01');assert.equal(f.config.to,'2026-11-30');assert.match(f.$('#report-rows').textContent,/个人份额/);assert.doesNotMatch(f.$('#report-rows').textContent,/上月|副本|美元/);
});
test('budget editing survives repaint, validates input and supports zero and removal',async()=>{
 const f=fixture();await f.click('[data-budget-edit]');f.input('[name="budgetAmount"]','0');f.mount();assert.equal(f.$('[name="budgetAmount"]').value,'0');await f.click('#budget-form [type="submit"]');assert.equal(f.saves[0].payload.amountCents,0);assert.match(f.$('.budget-values').textContent,/超出预算/);
 await f.click('[data-budget-edit]');await f.click('[data-budget-remove]');assert.equal(f.saves[1].payload.amountCents,null);assert.equal(f.$('.budget-values'),null);
});
test('budget unknown response freezes payload across remount and retries its original key',async()=>{
 const f=fixture(),calls=[];let fail=true;f.setSave(async(payload,key)=>{calls.push({payload,key});if(fail){fail=false;throw Error('网络连接失败，请检查网络后重试。');}return [{...payload,version:2}];});
 await f.click('[data-budget-edit]');f.input('[name="budgetAmount"]','1900');await f.click('#budget-form [type="submit"]');assert.equal(f.$('[name="budgetAmount"]').readOnly,true);f.mount();await f.click('#budget-form [type="submit"]');assert.deepEqual(calls[0],calls[1]);assert.equal(f.config.budgetAttempt,undefined);
});
test('budget conflict keeps typed value until explicit reload and review',async()=>{
 const f=fixture();f.setSave(async()=>{throw Object.assign(Error('预算已在另一设备更新，请载入最新预算后再保存。'),{status:409});});
 await f.click('[data-budget-edit]');f.input('[name="budgetAmount"]','1800');await f.click('#budget-form [type="submit"]');assert.equal(f.$('#budget-form [type="submit"]').disabled,true);assert.equal(f.$('[name="budgetAmount"]').value,'1800');
 f.source.budgets[0]={...f.source.budgets[0],version:2,amountCents:210000};await f.click('[data-budget-reload]');assert.equal(f.config.budgetDraft.expectedVersion,2);assert.equal(f.$('[name="budgetAmount"]').value,'1800');assert.match(f.$('#budget-form').textContent,/2100.00/);
});

test('late save result cannot regress newer budgets held by the same mounted report data',async()=>{
 const f=fixture();let release;f.setSave(()=>new Promise(resolve=>release=resolve));
 await f.click('[data-budget-edit]');f.input('[name="budgetAmount"]','1900');await f.click('#budget-form [type="submit"]');
 f.source.budgets=[{month:'2026-11',currency:'CNY',amountCents:100000,version:3}];f.mount();
 release([{month:'2026-11',currency:'CNY',amountCents:190000,version:2}]);await tick();
 assert.equal(f.source.budgets[0].version,3);assert.equal(f.source.budgets[0].amountCents,100000);assert.equal(f.$('#budget-form'),null);assert.match(f.$('.budget-values').textContent,/1000.00/);
});

for(const language of ['zh-CN','en'])test(`budget reload feedback distinguishes loading and errors in ${language}`,async()=>{
 const previous=getLanguage();setLanguage(language);try{
  let reject;const f=fixture({onReloadBudgets:()=>new Promise((_,no)=>reject=no)});f.setSave(async()=>{throw Object.assign(Error('预算已在另一设备更新，请载入最新预算后再保存。'),{status:409});});
  await f.click('[data-budget-edit]');f.input('[name="budgetAmount"]','1800');await f.click('#budget-form [type="submit"]');await f.click('[data-budget-reload]');
  assert.equal(f.$('#budget-form').getAttribute('aria-busy'),'true');assert.match(f.$('[data-budget-reload]').textContent,language==='en'?/Loading/:/正在读取/);assert.doesNotMatch(f.$('#budget-form [type="submit"]').textContent,/Saving|正在保存/);
  assert.equal(f.$('[data-budget-reload]').disabled,true);assert.equal(f.$('[name="budgetAmount"]').readOnly,true);
  reject(Error('network unavailable'));await tick();assert.equal(f.$('[data-budget-reload]').disabled,false);assert.equal(f.$('[name="budgetAmount"]').value,'1800');assert.equal(f.$('#budget-error').hidden,false);assert.equal(f.$('#budget-notice').hidden,true);assert.equal(f.$('#budget-form [type="submit"]').disabled,true);
 }finally{setLanguage(previous);}
});

test('successful budget review notice follows language changes without losing the draft',async()=>{
 const previous=getLanguage();setLanguage('zh-CN');try{
  const f=fixture();f.setSave(async()=>{throw Object.assign(Error('预算已在另一设备更新，请载入最新预算后再保存。'),{status:409});});
  await f.click('[data-budget-edit]');f.input('[name="budgetAmount"]','1800');await f.click('#budget-form [type="submit"]');
  f.source.budgets=[{month:'2026-11',currency:'CNY',amountCents:100000,version:3}];await f.click('[data-budget-reload]');
  assert.match(f.$('#budget-notice').textContent,/最新预算/);assert.equal(f.$('#budget-notice').getAttribute('role'),'status');assert.equal(f.$('#budget-error').hidden,true);
  setLanguage('en');f.mount();assert.match(f.$('#budget-notice').textContent,/1000.00/);assert.doesNotMatch(f.$('#budget-notice').textContent,/最新预算/);assert.match(f.$('#budget-notice').textContent,/Latest budget/);
  assert.equal(f.$('[name="budgetAmount"]').value,'1800');assert.equal(f.config.budgetDraft.expectedVersion,3);
 }finally{setLanguage(previous);}
});
