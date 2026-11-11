import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {createStateStore} from '../public/scripts/ledger-domain.mjs';
import {createDraftStore} from '../public/scripts/expense-drafts.mjs';
import {setLanguage} from '../public/scripts/i18n.mjs';

const appURL=new URL('../public/scripts/app.mjs',import.meta.url),raw=await readFile(appURL,'utf8'),html=await readFile(new URL('../public/app.html',import.meta.url),'utf8');
const imports={};
for(const [,binding,path] of raw.matchAll(/^import (.+?) from ['"](.+?)['"];$/gm)){
 const mod=await import(new URL(path,appURL));
 if(binding.startsWith('{'))for(const name of binding.slice(1,-1).split(',').map(s=>s.trim()))imports[name]=mod[name];
 else imports[binding]=mod.default;
}
const source=raw.replace(/^import .*;\r?\n/gm,'').replace(/start\(\);\s*$/,'');
const keys=['document','window','FormData','Event','CustomEvent','localStorage'],originals=Object.fromEntries(keys.map(k=>[k,globalThis[k]]));
let dom;
afterEach(()=>{dom?.window.close();for(const [key,value]of Object.entries(originals))if(value===undefined)delete globalThis[key];else globalThis[key]=value;setLanguage('zh-CN');});
const tick=()=>new Promise(resolve=>setTimeout(resolve,15));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
async function fixture(language='zh-CN'){
 dom=new JSDOM(html,{url:'http://localhost/app.html#personal'});const w=dom.window;
 w.document.querySelector('.topbar-actions').insertAdjacentHTML('beforeend','<button data-action="ledger-options"></button>');
 w.HTMLElement.prototype.scrollIntoView=()=>{};w.scrollTo=()=>{};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;this.querySelector('[autofocus]')?.focus();};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 for(const key of keys)globalThis[key]=w[key];setLanguage(language);
 const user={uid:'self',displayName:'Me'},state={ledgers:{},members:{},expenses:{},payments:{},templates:{},occurrences:{},invites:{},claims:{}};
 const store=createStateStore({user,read:()=>state,mutate:fn=>fn(state,user,'2026-11-11T12:00:00Z')});
 store.currentUser=user;store.mode='demo';
 const drafts=createDraftStore(new IDBFactory());
 const errors=[];const context=vm.createContext({...imports,translateError:error=>{errors.push(error.stack);return imports.translateError(error);},createDraftStore:()=>drafts,store,FormData:w.FormData,Event:w.Event,document:w.document,window:w,location:w.location,history:w.history,URL,URLSearchParams,setTimeout:w.setTimeout.bind(w),clearTimeout:w.clearTimeout.bind(w)});
 vm.runInContext(source,context);vm.runInContext('state.store=store;state.starting=false;',context);await vm.runInContext('loadData()',context);await tick();
 const $=selector=>w.document.querySelector(selector),run=code=>vm.runInContext(code,context);
 const input=(selector,value)=>{const el=$(selector);el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));};
 const click=async selector=>{$(selector).click();await tick();};
 const wait=async predicate=>{for(let i=0;i<150;i++){if(await predicate())return;await tick();}assert.fail('flow did not finish: '+errors.join(' | '));};
 return {store,context,run,$,input,click,wait,drafts,w};
}

for(const language of ['zh-CN','en'])test(`first personal entry creates then records directly, restores drafts after language switch: ${language}`,async()=>{
 const f=await fixture(language);await f.click('[data-action="personal-ledger"]');
 assert.equal(f.$('#dialog-title').textContent,language==='en'?'Create personal ledger':'创建个人账本');
 assert.equal(f.$('[name="projectType"]').value,'personal');assert.equal(f.$('[name="startDate"]'),null);assert.equal(f.$('[name="endDate"]'),null);
 assert.ok(f.$('[name="title"]').value);await f.click('#ledger-form [type="submit"]');await f.wait(()=>f.$('#expense-form'));
 assert.equal((await f.store.listLedgers()).length,1);assert.equal(f.$('#dialog-title').textContent,language==='en'?'Add daily expense':'记一笔日常开销');
 assert.equal(f.$('.entry-sharing').open,false);assert.equal(f.$('.participant-shortcuts').closest('.entry-sharing'),f.$('.entry-sharing'));assert.equal(f.$('.entry-preview').hidden,true);assert.equal(f.$('[name="payer"]').value,'owner');assert.equal(f.$('[name="participant"]').checked,true);
 f.input('[name="amount"]','12.50');f.input('[name="title"]','早餐 Breakfast');f.input('[name="date"]','2026-11-10');f.input('[name="category"]','food');
 await f.run('activeEditor.flush()');f.run('closeDialog()');setLanguage(language==='en'?'zh-CN':'en');await f.run('personalLedger()');
 assert.equal(f.$('[name="amount"]').value,'12.50');assert.equal(f.$('[name="title"]').value,'早餐 Breakfast');assert.equal(f.$('[name="date"]').value,'2026-11-10');assert.equal(f.$('[name="category"]').value,'food');
 assert.equal(f.$('#dialog-title').textContent,language==='en'?'记一笔日常开销':'Add daily expense');assert.equal(f.$('.entry-sharing').open,false);
 await f.click('#expense-form .primary[type="submit"]');await f.wait(()=>!f.$('#action-dialog').open);
 const ledgers=await f.store.listLedgers(),snapshot=await f.store.loadLedger(ledgers[0].id);assert.equal(ledgers.length,1);assert.equal(snapshot.expenses.length,1);assert.deepEqual(snapshot.expenses[0].shares,{owner:1250});assert.equal(snapshot.expenses[0].payerMemberId,'owner');
 await f.run('personalLedger()');assert.ok(f.$('#expense-form'));assert.equal(f.$('[name="amount"]').value,'');assert.equal((await f.store.listLedgers()).length,1);
});

for(const language of ['zh-CN','en'])test(`personal entry can add a participant and save shared expense without resetting fields: ${language}`,async()=>{
 const f=await fixture(language);await f.click('[data-action="personal-ledger"]');await f.click('#ledger-form [type="submit"]');await f.wait(()=>f.$('#expense-form'));
 f.input('[name="amount"]','100');f.input('[name="title"]','午餐 Lunch');f.input('[name="date"]','2026-11-10');
 f.$('.entry-sharing').open=true;await tick();assert.equal(f.$('.entry-preview').hidden,false);
 f.$('.entry-member-add').open=true;f.input('[name="inlineMemberName"]','Alice');await f.click('#entry-add-member');
 assert.equal(f.$('.entry-sharing').open,true);assert.equal(f.$('.entry-preview').hidden,false);assert.equal(f.$('[name="amount"]').value,'100');assert.equal(f.$('[name="date"]').value,'2026-11-10');
 assert.equal(f.$('#dialog-title').textContent,language==='en'?'Add a shared expense':'记一笔共同开销');
 assert.equal(f.w.document.querySelectorAll('[name="participant"]:checked').length,2);
 await f.click('[data-split="percent"]');f.input('[data-percent="owner"]','60');
 const other=[...f.w.document.querySelectorAll('[data-percent]')].find(e=>e.dataset.percent!=='owner');assert.equal(Number(other.value),40);
 await f.click('#expense-form .primary[type="submit"]');await f.wait(()=>!f.$('#action-dialog').open);
 const id=(await f.store.listLedgers())[0].id,snapshot=await f.store.loadLedger(id),expense=snapshot.expenses[0];assert.equal(expense.shares.owner,6000);assert.equal(expense.shares[other.dataset.percent],4000);
 await f.run('personalLedger()');assert.equal(f.$('.entry-sharing'),null);assert.equal(f.$('.entry-preview').hidden,false);
});

test('cancel and failed personal creation keep account unchanged and input retryable',async()=>{
 const f=await fixture();await f.run('personalLedger()');await f.click('#ledger-form [data-action="close-dialog"]');assert.equal((await f.store.listLedgers()).length,0);
 await f.run('personalLedger()');f.input('#ledger-form [name="title"]','我的通勤');const create=f.store.createLedger;f.store.createLedger=async()=>{throw Error('网络连接失败，请检查网络后重试。');};
 await f.click('#ledger-form [type="submit"]');assert.equal(f.$('[name="title"]').value,'我的通勤');assert.equal(f.$('#form-error').hidden,false);assert.equal(f.$('#ledger-form [type="submit"]').disabled,false);assert.equal((await f.store.listLedgers()).length,0);
 f.store.createLedger=create;await f.click('#ledger-form [type="submit"]');await f.wait(()=>f.$('#expense-form'));assert.equal((await f.store.listLedgers()).length,1);
});

test('shared-ledger creation retains project fields and member setup',async()=>{
 const f=await fixture('en');f.run('newLedger()');assert.equal(f.$('#dialog-title').textContent,'Create a shared ledger');assert.ok(f.$('[name="startDate"]'));assert.ok(f.$('[name="endDate"]'));
 f.input('#ledger-form [name="title"]','Trip');await f.click('#ledger-form [type="submit"]');await f.wait(()=>!f.$('#action-dialog').open);assert.equal(f.$('#expense-form'),null);assert.equal(f.run('state.view'),'members');
 await f.run('newExpense()');assert.equal(f.$('.entry-sharing'),null);assert.equal(f.$('.entry-preview').hidden,false);
});


test('single-person custom percentage draft stays expanded and preserves explicit allocation',async()=>{
 const f=await fixture();await f.click('[data-action="personal-ledger"]');await f.click('#ledger-form [type="submit"]');await f.wait(()=>f.$('#expense-form'));
 f.input('[name="amount"]','100');f.input('[name="title"]','Breakfast');f.$('.entry-sharing').open=true;await tick();await f.click('[data-split="percent"]');f.input('[data-percent="owner"]','60');
 await f.run('activeEditor.flush()');f.run('closeDialog()');setLanguage('en');await f.run('personalLedger()');
 assert.equal(f.$('.entry-sharing').open,true);assert.equal(f.$('.entry-preview').hidden,false);assert.equal(f.$('[data-percent="owner"]').value,'60');assert.equal(f.$('[name="amount"]').value,'100');
 await f.click('#expense-form .primary[type="submit"]');await f.wait(()=>!f.$('#action-dialog').open);
 const id=(await f.store.listLedgers())[0].id,e=(await f.store.loadLedger(id)).expenses[0];assert.equal(e.shares.owner,6000);assert.equal(e.amountCents,10000);
});

test('save and continue stays compact for daily entries and creates separate bills',async()=>{
 const f=await fixture();await f.click('[data-action="personal-ledger"]');await f.click('#ledger-form [type="submit"]');await f.wait(()=>f.$('#expense-form'));
 f.input('[name="amount"]','10');f.input('[name="title"]','Breakfast');f.input('[name="date"]','2026-11-10');
 await f.click('[name="continueEntry"]');await f.wait(()=>f.$('#expense-form [name="amount"]')?.value==='');
 assert.equal(f.$('.entry-sharing').open,false);assert.equal(f.$('[name="date"]').value,'2026-11-10');f.input('[name="amount"]','3');f.input('[name="title"]','Metro');
 await f.click('#expense-form .primary[type="submit"]');await f.wait(()=>!f.$('#action-dialog').open);
 const id=(await f.store.listLedgers())[0].id;assert.equal((await f.store.loadLedger(id)).expenses.length,2);
});

test('successful creation with failed refresh does not open an editor on a previous ledger',async()=>{
 const f=await fixture(),id=await f.store.createLedger({title:'Trip',currency:'CNY'});await f.run('loadData()');await f.run('personalLedger()');
 const load=f.store.loadLedger;f.store.loadLedger=async ledgerId=>{if(ledgerId!==id)throw Error('Failed to fetch');return load(ledgerId);};
 await f.click('#ledger-form [type="submit"]');await f.wait(()=>!f.$('#action-dialog').open);
 assert.equal(f.$('#expense-form'),null);assert.equal((await f.store.listLedgers()).length,2);assert.match(f.$('#toast').textContent,/已保存，但刷新失败/);
 f.store.loadLedger=load;await f.run('loadData()');await f.run('personalLedger()');assert.ok(f.$('#expense-form'));assert.equal(f.run('state.snapshot.ledger.projectType'),'personal');assert.equal((await f.store.listLedgers()).length,2);
});


test('unfinished participant tools remain visible when a self-only draft is restored',async()=>{
 const f=await fixture();await f.click('[data-action="personal-ledger"]');await f.click('#ledger-form [type="submit"]');await f.wait(()=>f.$('#expense-form'));
 f.$('.entry-sharing').open=true;f.$('#batch-member-tools').open=true;f.input('#batch-member-names','Alice, Bob');f.input('[name="amount"]','60');f.input('[name="title"]','Lunch');
 await f.run('activeEditor.flush()');f.run('closeDialog()');await f.run('personalLedger()');assert.equal(f.$('.entry-sharing').open,true);assert.equal(f.$('#batch-member-names').value,'Alice, Bob');
 await f.click('#expense-form .primary[type="submit"]');assert.equal(f.$('.entry-sharing').open,true);assert.equal(f.$('#participant-tools-error').hidden,false);
 const id=(await f.store.listLedgers())[0].id;assert.equal((await f.store.loadLedger(id)).expenses.length,0);
});

for(const stage of ['creation','load-button','load-hash'])test(`leaving first entry during delayed ${stage} does not reopen an editor`,async()=>{
 const f=await fixture(),gate=deferred(),entered=deferred();let writes=0;
 const create=f.store.createLedger,load=f.store.loadLedger;
 f.store.createLedger=async data=>{writes++;const id=await create(data);if(stage==='creation'){entered.resolve();await gate.promise;}return id;};
 f.store.loadLedger=async id=>{const snapshot=await load(id);if(stage!=='creation'){entered.resolve();await gate.promise;}return snapshot;};
 await f.click('[data-action="personal-ledger"]');await f.click('#ledger-form [type="submit"]');await entered.promise;
 if(stage==='creation')await f.click('#ledger-form [data-action="close-dialog"]');
 if(stage==='load-hash'){
  const changed=new Promise(resolve=>f.w.addEventListener('hashchange',resolve,{once:true}));f.w.location.hash='expenses';await changed;
 }else await f.click('#primary-nav [data-view="expenses"]');
 gate.resolve();await f.wait(()=>f.run('saving')===0);await tick();
 assert.equal(f.$('#action-dialog').open,false,'leaving must not reopen the first expense');
 assert.equal(f.run('state.view'),'expenses','late creation must not navigate back');
 assert.equal(writes,1);const ledgers=await f.store.listLedgers();assert.equal(ledgers.length,1);assert.equal((await load(ledgers[0].id)).expenses.length,0);
 f.store.loadLedger=load;await f.run('personalLedger()');assert.equal(f.$('#action-dialog').open,true);assert.ok(f.$('#expense-form'));assert.equal(writes,1);
});

for(const action of ['cancel','escape','pagehide'])test(`delayed creation respects ${action} without losing the created ledger`,async()=>{
 const f=await fixture(),gate=deferred(),create=f.store.createLedger;
 f.store.createLedger=async data=>{const id=await create(data);await gate.promise;return id;};
 await f.run('personalLedger()');await f.click('#ledger-form [type="submit"]');
 if(action==='cancel')await f.click('.dialog-close');
 if(action==='escape'){f.$('#action-dialog').dispatchEvent(new f.w.Event('cancel'));f.$('#action-dialog').close();}
 if(action==='pagehide')f.w.dispatchEvent(new f.w.Event('pagehide'));
 gate.resolve();await f.wait(()=>f.run('saving')===0);
 assert.equal(f.$('#expense-form'),null);assert.equal(f.run('state.view'),'personal');
 assert.equal((await f.store.listLedgers()).length,1);
 if(action!=='pagehide')assert.equal(f.$('#action-dialog').open,false);
 await f.run('personalLedger()');assert.ok(f.$('#expense-form'));assert.equal((await f.store.listLedgers()).length,1);
});

for(const close of [false,true])test(`delayed ledger load preserves a replacement dialog, closed=${close}`,async()=>{
 const f=await fixture(),gate=deferred(),entered=deferred(),load=f.store.loadLedger;
 f.store.loadLedger=async id=>{const result=await load(id);entered.resolve();await gate.promise;return result;};
 await f.run('personalLedger()');await f.click('#ledger-form [type="submit"]');await entered.promise;
 f.run('newLedger()');f.input('#ledger-form [name="title"]','Next trip');
 if(close)await f.click('.dialog-close');
 gate.resolve();await f.wait(()=>f.run('saving')===0);
 assert.equal(f.$('#action-dialog').open,!close);assert.equal(f.$('#expense-form'),null);
 assert.equal(f.$('#ledger-form [name="title"]').value,'Next trip');assert.equal(f.run('state.snapshot'),null);
});

test('delayed creation load cannot replace a ledger selected afterwards',async()=>{
 const f=await fixture(),old=await f.store.createLedger({title:'Trip',currency:'CNY'}),gate=deferred(),entered=deferred(),load=f.store.loadLedger;
 await f.run('loadData()');
 f.store.loadLedger=async id=>{const result=await load(id);if(id!==old){entered.resolve();await gate.promise;}return result;};
 await f.run('personalLedger()');await f.click('#ledger-form [type="submit"]');await entered.promise;
 await f.run(`selectLedger(${JSON.stringify(old)})`);gate.resolve();await f.wait(()=>f.run('saving')===0);
 assert.equal(f.run('state.snapshot.ledger.id'),old);assert.equal(f.$('#action-dialog').open,false);assert.equal(new URL(f.w.location.href).searchParams.get('ledger'),old);
});

test('leaving while the first expense draft loads prevents a late editor',async()=>{
 const f=await fixture(),gate=deferred(),entered=deferred(),get=f.drafts.get;
 f.drafts.get=async key=>{const result=await get(key);entered.resolve();await gate.promise;return result;};
 await f.run('personalLedger()');await f.click('#ledger-form [type="submit"]');await entered.promise;
 await f.click('#primary-nav [data-view="expenses"]');gate.resolve();await f.wait(()=>f.run('saving')===0);
 assert.equal(f.$('#action-dialog').open,false);assert.equal(f.run('state.view'),'expenses');
});

test('normal creation continues even when its programmatic close event arrives after the editor opens',async()=>{
 const f=await fixture();let sendClose;
 f.$('#action-dialog').close=function(){this.open=false;sendClose=()=>this.dispatchEvent(new f.w.Event('close'));};
 await f.run('personalLedger()');await f.click('#ledger-form [type="submit"]');await f.wait(()=>f.$('#expense-form'));
 sendClose();assert.ok(f.run('activeEditor'));assert.equal(f.$('#action-dialog').open,true);
 f.input('[name="amount"]','8');f.input('[name="title"]','Coffee');await f.click('#expense-form .primary[type="submit"]');await f.wait(()=>f.run('saving')===0);
 const ledgers=await f.store.listLedgers();assert.equal(ledgers.length,1);assert.equal((await f.store.loadLedger(ledgers[0].id)).expenses.length,1);
});

test('returning to an existing personal ledger also cancels a delayed load on navigation',async()=>{
 const f=await fixture();await f.run('personalLedger()');await f.click('#ledger-form [type="submit"]');await f.wait(()=>f.$('#expense-form'));f.run('closeDialog()');
 const gate=deferred(),entered=deferred(),load=f.store.loadLedger;
 f.store.loadLedger=async id=>{const result=await load(id);entered.resolve();await gate.promise;return result;};
 const pending=f.run('personalLedger()');await entered.promise;await f.click('#primary-nav [data-view="expenses"]');gate.resolve();await pending;
 assert.equal(f.$('#action-dialog').open,false);assert.equal(f.run('state.view'),'expenses');assert.equal((await f.store.listLedgers()).length,1);
});
