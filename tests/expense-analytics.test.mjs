import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {consumptionRows,personalData,summarizeConsumption,dateRange,checkedSum,comparisonPeriods,compareConsumption,monthlyHistory} from '../public/scripts/expense-analytics.mjs';
import {registerMessages,setLanguage} from '../public/scripts/i18n.mjs';
import analyticsMessages from '../public/scripts/analytics-messages.mjs';
import {createStateStore} from '../public/scripts/ledger-domain.mjs';
import {itemizedShares} from '../public/scripts/expense-features.mjs';
import {ledgerExport} from '../public/scripts/ledger-export.mjs';
import {restoreState} from '../server/ledger-import.mjs';
import {mountConsumption} from '../public/scripts/consumption-view.mjs';

async function fixture(){
 const data={ledgers:{},members:{},expenses:{},payments:{},templates:{},occurrences:{},invites:{},claims:{}},user={uid:'a',displayName:'A'};
 const forUser=u=>createStateStore({user:u,read:()=>data,mutate:fn=>fn(data,u,'2026-11-09T12:00:00Z')});
 const store=forUser(user),id=await store.createLedger({title:'青岛旅行',currency:'CNY',projectType:'trip',startDate:'2026-10-29',endDate:'2026-11-02'});
 const b=await store.addMember(id,'B'),c=await store.addMember(id,'B');data.members[id][b].uid='b';data.ledgers[id].memberUids.push('b');
 const add=(payer,amountCents,category,date='2026-10-30')=>store.addExpense(id,{title:category,date,payerMemberId:payer,amountCents,shares:{owner:amountCents/3,[b]:amountCents/3,[c]:amountCents/3},category});
 return {data,store,id,b,c,user,forUser,add};
}
test('1350 trip costs 450 per person regardless of payer or repayments; identities use uid',async()=>{
 const f=await fixture();const hotel=await f.add('owner',90000,'lodging');await f.add(f.b,30000,'food');await f.add(f.c,15000,'entertainment');
 let s=await f.store.loadLedger(f.id);assert.equal(summarizeConsumption(consumptionRows(s),{currency:'CNY'}).totalCents,135000);
 for(const uid of ['a','b'])assert.equal(summarizeConsumption(consumptionRows(s,{uid,personal:true}),{currency:'CNY'}).totalCents,45000);
 assert.equal(consumptionRows(s,{uid:'stranger',personal:true}).length,0);
 await f.store.recordPayment(f.id,{expenseId:hotel,fromMemberId:f.b,toMemberId:'owner',expectedVersion:1,expectedRemaining:30000,amountCents:10000,date:'2026-11-09'});
 s=await f.store.loadLedger(f.id);const r=summarizeConsumption(consumptionRows(s,{uid:'a',personal:true}),{currency:'CNY',from:'2026-10-01',to:'2026-10-31'});assert.equal(r.totalCents,45000);
 assert.equal(summarizeConsumption(consumptionRows(s),{currency:'CNY',from:'2026-11-01'}).totalCents,0);
 await f.store.setLedgerStatus(f.id,'archived');assert.equal((await f.store.personalConsumption()).rows.length,3);
});
test('mixed items attribute category cents to the actual participants including rounding',async()=>{
 const f=await fixture();const d=await f.store.addMember(f.id,'D'),e=await f.store.addMember(f.id,'E');
 const items=itemizedShares([{title:'晚餐',amountCents:9000,memberIds:['owner',f.b,f.c,d,e]},{title:'停车',amountCents:1000,memberIds:['owner'],category:'transport'}]);
 await f.store.addExpense(f.id,{...items,title:'晚餐停车',payerMemberId:f.b,date:'2026-11-09',category:'food'});
 const s=await f.store.loadLedger(f.id),mine=consumptionRows(s,{uid:'a',personal:true});assert.deepEqual(mine.map(r=>[r.category,r.amountCents]),[['food',1800],['transport',1000]]);
 assert.equal(summarizeConsumption(consumptionRows(s),{currency:'CNY'}).totalCents,10000);
 assert.equal(consumptionRows(s,{memberId:f.c,personal:true}).reduce((n,r)=>n+r.amountCents,0),1800);
 const penny=itemizedShares([{title:'零头',amountCents:100,memberIds:['owner',f.b,f.c],category:'other'}]);await f.store.addExpense(f.id,{...penny,title:'零头',payerMemberId:'owner',date:'2026-11-09'});
 const latest=await f.store.loadLedger(f.id);assert.equal(checkedSum(latest.members.map(m=>checkedSum(consumptionRows(latest,{memberId:m.id,personal:true}).map(r=>r.amountCents)))),10100);
});
test('project ending permits later bills, metadata edits check versions and permissions',async()=>{
 const f=await fixture();await f.store.updateProject(f.id,{title:'结束的旅行',projectType:'trip',activityStatus:'ended',expectedVersion:1});await f.add('owner',300,'other');
 await assert.rejects(f.store.updateProject(f.id,{title:'stale',expectedVersion:1}),e=>e.statusCode===409);
 await assert.rejects(f.forUser({uid:'b'}).updateProject(f.id,{title:'forbidden',expectedVersion:2}),/管理员/);
 await assert.rejects(f.store.updateProject(f.id,{title:'bad',startDate:'2026-11-09',endDate:'2026-10-01',expectedVersion:2}),/结束日期/);
 assert.equal((await f.store.loadLedger(f.id)).ledger.activityStatus,'ended');
});
test('restore retains categories, templates, history and project dates; copies excluded per account by default',async()=>{
 const f=await fixture(),id=await f.add('owner',900,'lodging');let s=await f.store.loadLedger(f.id),bill=s.expenses[0];
 await f.store.updateExpense(f.id,id,{...bill,category:'other',expectedVersion:1,changeReason:'分类更正'});
 await f.store.saveTemplate(f.id,{...bill,category:'lodging',frequency:'none'});
 s=await f.store.loadLedger(f.id);const exported=ledgerExport(s),restored=restoreState({data:exported.data,files:new Map()},f.user,{memberId:'owner'});
 const store=createStateStore({user:f.user,read:()=>restored.state,mutate:fn=>fn(restored.state,f.user,'2026-11-09T12:00:00Z')});
 const copy=await store.loadLedger(restored.id);assert.equal(copy.ledger.projectType,'trip');assert.equal(copy.ledger.endDate,'2026-11-02');assert.equal(copy.expenses[0].category,'other');assert.equal(copy.expenses[0].history.at(-1).before.category,'lodging');assert.equal(copy.templates[0].category,'lodging');
 assert.equal((await store.personalConsumption()).projects[0].included,false);await store.setAnalyticsInclusion(restored.id,true);assert.equal((await store.personalConsumption()).projects[0].included,true);
 assert.match(exported.tables['expenses.csv'],/category/);
});
test('reversals excluded, currencies never sum, category changes allowed after repayment',async()=>{
 const f=await fixture();const bill=await f.add('owner',900,'lodging');await f.store.recordPayment(f.id,{expenseId:bill,fromMemberId:f.b,toMemberId:'owner',expectedVersion:1,expectedRemaining:300,amountCents:300});
 let s=await f.store.loadLedger(f.id),e=s.expenses[0];await f.store.updateExpense(f.id,bill,{...e,category:'other',expectedVersion:e.version,changeReason:'用途分类'});
 await f.store.setAnalyticsInclusion(f.id,false);assert.equal((await f.forUser({uid:'b'}).personalConsumption()).projects[0].included,true);
 s=await f.store.loadLedger(f.id);const rows=consumptionRows(s);assert.equal(summarizeConsumption([...rows,{...rows[0],currency:'USD',amountCents:999999}],{currency:'CNY'}).totalCents,900);
 await f.store.reversePayment(f.id,s.payments[0].id);await f.store.reverseExpense(f.id,bill);assert.equal((await f.store.personalConsumption()).rows.length,0);
});
test('date presets use literal calendar days across month/year boundaries',()=>{
 assert.deepEqual(dateRange('last-month','2026-01-15'),{from:'2025-12-01',to:'2025-12-31'});assert.deepEqual(dateRange('last-month','2024-03-01'),{from:'2024-02-01',to:'2024-02-29'});assert.deepEqual(dateRange('30-days','2026-03-10'),{from:'2026-02-09',to:'2026-03-10'});
 assert.throws(()=>summarizeConsumption([],{currency:'CNY',from:'2026-11-09',to:'2026-11-01'}),/结束日期/);assert.throws(()=>checkedSum([Number.MAX_SAFE_INTEGER,1]),/超出/);
});
test('duplicate deletion reports deleted state rather than permissions',async()=>{const f=await fixture(),g=await f.store.saveParticipantGroup(f.id,{name:'G',memberIds:['owner']});await f.store.deleteParticipantGroup(f.id,g.id,1);await assert.rejects(f.store.deleteParticipantGroup(f.id,g.id,1),e=>e.statusCode===409&&/已删除/.test(e.message));});
test('report controls drill into real rows, handle currency changes and preserve inclusion on failure',async()=>{
 const dom=new JSDOM('<main></main>');dom.window.HTMLElement.prototype.scrollIntoView=()=>{};const root=dom.window.document.querySelector('main'),clicked=[];
 const data={projects:[{id:'a',title:'Trip',currency:'CNY',included:true},{id:'b',title:'Daily',currency:'USD',included:true},{id:'copy',title:'Copy',currency:'CNY',included:false,restored:true}],rows:[{ledgerId:'a',ledgerTitle:'Trip',expenseId:'e',title:'Dinner',itemTitle:'Dinner',itemIndex:null,date:'2026-11-09',currency:'CNY',category:'food',amountCents:1800},{ledgerId:'copy',date:'2026-11-09',currency:'CNY',category:'food',amountCents:1800}]};
 const config={period:'all'};mountConsumption(root,{data,config,personal:true,today:'2026-11-09',onOpen:r=>clicked.push(r),onInclusion:async()=>{throw new Error('offline');}});
 assert.match(root.querySelector('.report-total strong').textContent,/18\.00/);root.querySelector('[data-drill="category"]').click();root.querySelector('[data-report-row]').click();assert.equal(clicked[0].expenseId,'e');
 const inclusion=root.querySelector('[data-report-inclusion="copy"]');inclusion.checked=true;await inclusion.onchange();assert.equal(inclusion.checked,false);assert.equal(data.projects[2].included,false);
 const currency=root.querySelector('[data-report-filter="currency"]');currency.value='USD';currency.onchange();assert.match(root.querySelector('.report-total strong').textContent,/0\.00/);assert.equal(root.querySelectorAll('[data-report-row]').length,0);dom.window.close();
});

// Calendar comparison and history use the same recorded consumption rows as charts.
test('monthly comparisons align elapsed days, clamp short months and cross years',()=>{
 assert.deepEqual(comparisonPeriods('month','2026-01-09'),{current:{from:'2026-01-01',to:'2026-01-09'},previous:{from:'2025-12-01',to:'2025-12-09'}});
 assert.equal(comparisonPeriods('month','2024-03-31').previous.to,'2024-02-29');
 assert.equal(comparisonPeriods('month','2025-03-31').previous.to,'2025-02-28');
 assert.deepEqual(comparisonPeriods('last-month','2026-04-09'),{current:{from:'2026-03-01',to:'2026-03-31'},previous:{from:'2026-02-01',to:'2026-02-28'}});
 assert.equal(comparisonPeriods('all','2026-11-09'),null);
});
test('annual comparisons handle leap days, previous full years and future selections',()=>{
 assert.deepEqual(comparisonPeriods('year','2024-02-29','2024'),{current:{from:'2024-01-01',to:'2024-02-29'},previous:{from:'2023-01-01',to:'2023-02-28'}});
 assert.deepEqual(comparisonPeriods('year','2026-11-09','2025'),{current:{from:'2025-01-01',to:'2025-12-31'},previous:{from:'2024-01-01',to:'2024-12-31'}});
 assert.throws(()=>comparisonPeriods('year','2026-11-09','2027'),/年份/);
});
const reportRow=(date,amountCents,extra={})=>({ledgerId:'a',ledgerTitle:'Trip',expenseId:date,title:'Meal',itemTitle:'Meal',itemIndex:null,date,currency:'CNY',category:'food',amountCents,...extra});
test('comparison preserves scope and cents, reports decreases and avoids zero-base percentages',()=>{
 const rows=[reportRow('2026-10-03',1001),reportRow('2026-11-03',1502),reportRow('2026-10-20',99999),reportRow('2026-11-03',90000,{currency:'USD'}),reportRow('2026-11-03',300,{category:'transport'}),reportRow('2026-11-03',99999,{ledgerId:'b'})];
 const filters={currency:'CNY',ledgerId:'a'},periods=comparisonPeriods('month','2026-11-09');
 const result=compareConsumption(rows,filters,periods);
 assert.equal(result.current.totalCents,1802);assert.equal(result.previous.totalCents,1001);assert.equal(result.deltaCents,801);assert.equal(result.changes[0].deltaCents,501);
 assert.equal(compareConsumption(rows,{...filters,category:'transport'},periods).percent,null);
 assert.equal(compareConsumption([rows[0]],filters,periods).percent,-100);
 assert.equal(compareConsumption([],filters,periods).percent,null);
});
test('monthly history counts a mixed bill once and distinguishes identical ids in different ledgers',()=>{
 const rows=[reportRow('2026-10-31',100),reportRow('2026-11-01',101,{expenseId:'same',itemIndex:0}),reportRow('2026-11-01',202,{expenseId:'same',itemIndex:1}),reportRow('2026-11-01',303,{expenseId:'same',ledgerId:'b'})];
 const history=monthlyHistory(rows);assert.deepEqual(history.map(g=>[g.month,g.totalCents,g.expenseCount]),[['2026-11',606,2],['2026-10',100,1]]);assert.equal(rows[0].date,'2026-10-31');
});
test('history switch preserves filters and pagination, opens exact bills and survives remount',()=>{
 const dom=new JSDOM('<main></main>');dom.window.HTMLElement.prototype.scrollIntoView=()=>{};const root=dom.window.document.querySelector('main'),clicked=[];
 const data={projects:[{id:'a',title:'Trip',currency:'CNY',included:true}],rows:[...Array.from({length:55},(_,i)=>reportRow('2026-11-09',100,{expenseId:`e${i}`})),reportRow('2026-10-01',200)]},config={period:'all'};
 const mount=()=>mountConsumption(root,{data,config,personal:true,today:'2026-11-09',onOpen:r=>clicked.push(r)});mount();
 assert.equal(root.querySelectorAll('[data-report-row]').length,0);
 root.querySelector('[data-report-view="history"]').click();assert.equal(config.period,'all');assert.equal(root.querySelectorAll('[data-report-row]').length,50);assert.match(root.querySelector('.history-month header').textContent,/55/);
 root.querySelector('[data-report-more]').click();assert.equal(root.querySelectorAll('.history-month').length,2);assert.equal(root.querySelectorAll('[data-report-row]').length,56);
 root.querySelector('[data-report-row="55"]').click();assert.equal(clicked[0].date,'2026-10-01');
 mount();assert.equal(root.querySelectorAll('[data-report-row]').length,56);assert.equal(root.querySelector('[data-report-view="history"]').getAttribute('aria-pressed'),'true');
 root.querySelector('[data-report-view="overview"]').click();root.querySelector('[data-drill="trend"][data-key="2026-10"]').click();assert.equal(config.view,'history');assert.equal(root.querySelectorAll('[data-report-row]').length,1);dom.window.close();
});
test('monthly comparison drill opens previous dates; annual chart includes empty months and translates',()=>{
 registerMessages(analyticsMessages);setLanguage('en');
 const dom=new JSDOM('<main></main>');dom.window.HTMLElement.prototype.scrollIntoView=()=>{};const root=dom.window.document.querySelector('main');
 const data={projects:[{id:'a',title:'Trip',currency:'CNY',included:true},{id:'copy',title:'Copy',currency:'CNY',included:false}],rows:[reportRow('2026-11-03',1500),reportRow('2026-10-03',1000),reportRow('2026-10-20',90000),reportRow('2026-11-03',99999,{ledgerId:'copy'}),reportRow('2025-05-01',2000)]},config={};
 const mount=()=>mountConsumption(root,{data,config,personal:true,today:'2026-11-09',onOpen:()=>{}});mount();
 assert.match(root.querySelector('[data-compare-period="previous"]').textContent,/10\.00/);assert.match(root.querySelector('.comparison-change').textContent,/50\.0%/);
 root.querySelector('[data-compare-period="previous"]').click();assert.equal(config.from,'2026-10-01');assert.equal(config.to,'2026-10-09');assert.equal(root.querySelectorAll('[data-report-row]').length,1);
 const period=root.querySelector('[data-report-filter="period"]');period.value='year';period.onchange();root.querySelector('[data-report-view="overview"]').click();
 assert.equal(root.querySelectorAll('[data-drill="trend"]').length,11);assert.match(root.querySelector('.annual-title').textContent,/Spending in 2026/);
 const year=root.querySelector('[data-report-filter="year"]');year.value='2025';year.onchange();assert.equal(root.querySelectorAll('[data-drill="trend"]').length,12);
 root.querySelector('[data-drill="trend"][data-key="2025-01"]').click();assert.equal(root.querySelectorAll('[data-report-row]').length,0);
 assert.equal(root.textContent.includes('历史明细'),false);mount();assert.equal(config.view,'history');dom.window.close();setLanguage('zh-CN');
});
