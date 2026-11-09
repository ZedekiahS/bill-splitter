import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {openExpenseEditor} from '../public/scripts/expense-entry.mjs';
import {createStateStore} from '../public/scripts/ledger-domain.mjs';
import {registerMessages} from '../public/scripts/i18n.mjs';
import messages from '../public/scripts/app-messages.mjs';
registerMessages(messages);

const originals=Object.fromEntries(['document','FormData','Event'].map(k=>[k,globalThis[k]]));
let dom;
afterEach(()=>{dom?.window.close();for(const [k,v] of Object.entries(originals))if(v===undefined)delete globalThis[k];else globalThis[k]=v;});
const tick=()=>new Promise(r=>setTimeout(r,15));
async function fixture(){
 const state={ledgers:{},members:{},expenses:{},payments:{},templates:{},occurrences:{},invites:{},claims:{}},user={uid:'owner-user',displayName:'Owner'};
 const store=createStateStore({user,read:()=>state,mutate:fn=>fn(state,user,'2026-11-07T12:00:00Z')});
 const id=await store.createLedger({title:'Recovery',currency:'CNY'}),other=await store.addMember(id,'Alice');
 const group=await store.saveParticipantGroup(id,{name:'Dinner',memberIds:['owner',other]});
 let draft=null;const saved=[],errors=[],saveOptions=[];
 async function open(record=null,options={}){
  dom?.window.close();dom=new JSDOM('<div id="dialog-title"></div><main></main>',{url:'http://localhost'});
  for(const k of Object.keys(originals))globalThis[k]=dom.window[k];
  const editor=openExpenseEditor({snapshot:await store.loadLedger(id),user,isOwner:true,today:'2026-11-07',
   openDialog:(_title,html)=>document.querySelector('main').innerHTML=html,errorSlot:()=>'<p id="form-error" hidden></p>',formError:e=>errors.push(e),
   submitForm:(event,cb)=>{event.preventDefault();return cb(new FormData(event.target)).catch(e=>errors.push(e));},onSave:async(payload,options)=>{saved.push(payload);saveOptions.push(options);},
   onAddMember:async name=>{const mid=await store.addMember(id,name);return (await store.loadLedger(id)).members.find(m=>m.id===mid);},
   onAddMembers:entries=>store.addMembers(id,entries),onLoadDirectory:()=>store.loadLedger(id),onSaveGroup:(payload,gid)=>store.saveParticipantGroup(id,payload,gid),onDeleteGroup:(gid,version)=>store.deleteParticipantGroup(id,gid,version),
   draft:{key:'draft',scope:'owner',record,store:{put:async value=>{draft=structuredClone({...value,revision:'rev'});return draft;},remove:async()=>{draft=null;}}}
  },options);
  return editor;
 }
 const $=s=>document.querySelector(s);
 const input=(selector,value)=>{const el=$(selector);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));};
 const click=async selector=>{$(selector).click();await tick();};
 const chooseGroup=async()=>{$('#saved-group-tools').open=true;await tick();$('#participant-group-picker').value=group.id;$('#participant-group-picker').dispatchEvent(new Event('change',{bubbles:true}));$('.group-edit').open=true;};
 return {state,store,id,other,group,open,$,input,click,chooseGroup,saved,saveOptions,errors,get draft(){return draft;}};
}

test('manual total and exact shares survive item mode, a draft reopen and switching back',async()=>{
 const f=await fixture();let editor=await f.open();f.input('[name="amount"]','100');f.input('[name="title"]','Dinner');await f.click('[data-split="amount"]');
 f.input('[data-share-amount="owner"]','60');f.input(`[data-share-amount="${f.other}"]`,'40');
 await f.click('[data-split="items"]');await editor.flush();editor=await f.open(f.draft);
 await f.click('[data-split="amount"]');assert.equal(f.$('[name="amount"]').value,'100');
 assert.equal(f.$('[data-share-amount="owner"]').value,'60');assert.equal(f.$(`[data-share-amount="${f.other}"]`).value,'40');
 await f.click('[type="submit"]');assert.equal(f.saved[0]?.amountCents,10000);
});

test('unassigned item participant survives modes and draft recovery until explicitly resolved',async()=>{
 const f=await fixture();let editor=await f.open();f.input('[name="title"]','Dinner');await f.click('[data-split="items"]');
 f.input('[data-item-title]','Meal');f.input('[data-item-amount]','100');f.input('[name="inlineMemberName"]','New guest');await f.click('#entry-add-member');
 await f.click('[data-split="equal"]');await editor.flush();editor=await f.open(f.draft);await f.click('[data-split="items"]');
 assert.equal(f.$('#item-member-picker').hidden,false);await f.click('[type="submit"]');assert.equal(f.saved.length,0);assert.match(f.errors.at(-1)?.message||'',/选择参与条目/);
 await f.click('#item-assignment-skip');await f.click('[type="submit"]');assert.equal(f.saved.length,1);
});

test('existing group edits survive mode changes, collapse, draft reopen and block saving the bill',async()=>{
 const f=await fixture();let editor=await f.open();f.input('[name="title"]','Meal');f.input('[name="amount"]','100');await f.chooseGroup();
 f.input('#edit-group-name','Friday dinner');await f.click(`[data-edit-group-member][value="${f.other}"]`);
 await f.click('[data-split="percent"]');assert.equal(f.$('#edit-group-name').value,'Friday dinner');
 f.$('#saved-group-tools').open=false;await tick();f.$('#saved-group-tools').open=true;await tick();
 assert.equal(f.$('#edit-group-name').value,'Friday dinner');assert.equal(f.$(`[data-edit-group-member][value="${f.other}"]`).checked,false);
 await editor.flush();editor=await f.open(f.draft);await f.chooseGroup();assert.equal(f.$('#edit-group-name').value,'Friday dinner');
 await f.click('[type="submit"]');assert.equal(f.saved.length,0);assert.equal(f.$('#participant-tools-error').hidden,false);
 await f.click('[data-member-tool="update-group"]');await f.click('[type="submit"]');assert.equal(f.saved.length,1);
 const group=(await f.store.loadLedger(f.id)).participantGroups[0];assert.equal(group.name,'Friday dinner');assert.deepEqual(group.memberIds,['owner']);
});

test('renaming a group retains its inactive members and applying it selects only active members',async()=>{
 const f=await fixture();await f.store.setMemberStatus(f.id,f.other,'inactive');await f.open();await f.chooseGroup();
 f.input('#edit-group-name','Friday dinner');await f.click('[data-member-tool="update-group"]');
 assert.deepEqual((await f.store.loadLedger(f.id)).participantGroups[0].memberIds,['owner',f.other]);
 await f.click('[data-member-tool="apply-group"]');assert.deepEqual([...document.querySelectorAll('[name="participant"]:checked')].map(e=>e.value),['owner']);
 await f.store.setMemberStatus(f.id,f.other,'active');await f.click('[data-member-tool="refresh-groups"]');await f.click('[data-member-tool="apply-group"]');
 assert.equal(document.querySelectorAll('[name="participant"]:checked').length,2);
});

test('remote group edits require reviewing the new definition while keeping local edits',async()=>{
 const f=await fixture();await f.open();await f.chooseGroup();f.input('#edit-group-name','My dinner');
 const remote=createStateStore({user:{uid:'owner-user'},read:()=>f.state,mutate:fn=>fn(f.state,{uid:'owner-user'},'2026-11-07T13:00:00Z')});
 await remote.saveParticipantGroup(f.id,{name:'Remote dinner',memberIds:['owner'],expectedVersion:1},f.group.id);
 await f.click('[data-member-tool="update-group"]');
 assert.equal(f.$('#edit-group-name').value,'My dinner');assert.equal((await f.store.loadLedger(f.id)).participantGroups[0].name,'Remote dinner');
 assert.match(f.$('#participant-group-review').textContent,/Remote dinner/);
 await f.click('[data-member-tool="review-group-edit"]');await f.click('[data-member-tool="update-group"]');
 const group=(await f.store.loadLedger(f.id)).participantGroups[0];assert.equal(group.name,'My dinner');assert.equal(group.version,3);
});

test('switching groups preserves each edit, and explicitly discarding lets the expense save',async()=>{
 const f=await fixture();const other=await f.store.saveParticipantGroup(f.id,{name:'Lunch',memberIds:['owner']});
 await f.open();f.input('[name="title"]','Meal');f.input('[name="amount"]','100');await f.chooseGroup();f.input('#edit-group-name','My dinner');
 f.$('#participant-group-picker').value=other.id;f.$('#participant-group-picker').dispatchEvent(new Event('change',{bubbles:true}));f.input('#edit-group-name','My lunch');
 await f.click('[type="submit"]');assert.equal(f.saved.length,0);assert.equal(f.$('#edit-group-name').value,'My dinner');
 await f.click('[data-member-tool="discard-group-edit"]');await f.click('[type="submit"]');assert.equal(f.saved.length,0);assert.equal(f.$('#edit-group-name').value,'My lunch');
 await f.click('[data-member-tool="discard-group-edit"]');await f.click('[type="submit"]');assert.equal(f.saved.length,1);
});

test('deleted remote group retains its local draft and allows explicit discard',async()=>{
 const f=await fixture();await f.open();f.input('[name="title"]','Meal');f.input('[name="amount"]','100');await f.chooseGroup();f.input('#edit-group-name','Keep this draft');
 await f.store.deleteParticipantGroup(f.id,f.group.id,1);await f.click('[data-member-tool="refresh-groups"]');await f.click('[type="submit"]');
 assert.equal(f.saved.length,0);assert.match(f.$('#participant-group-review').textContent,/Keep this draft/);
 await f.click('[data-member-tool="discard-group-edit"]');await f.click('[type="submit"]');assert.equal(f.saved.length,1);
});

for(const resolution of ['discard','review'])test(`reverting a conflicted name never adopts the remote version implicitly (${resolution})`,async()=>{
 const f=await fixture();let editor=await f.open();await f.chooseGroup();f.input('#edit-group-name','Local dinner');
 const third=await f.store.addMember(f.id,'Third');
 await f.store.saveParticipantGroup(f.id,{name:'Remote dinner',memberIds:['owner',f.other,third],expectedVersion:1},f.group.id);
 await f.click('[data-member-tool="update-group"]');f.input('#edit-group-name','Dinner');await editor.flush();
 assert.equal(f.draft.form.participantTools.groupEdits[f.group.id]?.base.version,1);
 editor=await f.open(f.draft);await f.chooseGroup();await f.click('[data-member-tool="update-group"]');
 let group=(await f.store.loadLedger(f.id)).participantGroups[0];assert.equal(group.version,2);assert.ok(group.memberIds.includes(third));
 if(resolution==='discard'){
  await f.click('[data-member-tool="discard-group-edit"]');assert.equal(f.$('#edit-group-name').value,'Remote dinner');assert.equal(f.$(`[data-edit-group-member][value="${third}"]`).checked,true);
 }else{
  await f.click('[data-member-tool="review-group-edit"]');await f.click('[data-member-tool="update-group"]');
  group=(await f.store.loadLedger(f.id)).participantGroups[0];assert.equal(group.version,3);assert.equal(group.name,'Dinner');assert.deepEqual(group.memberIds,['owner',f.other]);
 }
});

test('direct update after remote deletion reports deletion and keeps the edit',async()=>{
 const f=await fixture();await f.open();await f.chooseGroup();f.input('#edit-group-name','Keep me');await f.store.deleteParticipantGroup(f.id,f.group.id,1);
 await f.click('[data-member-tool="update-group"]');assert.match(f.$('#participant-tools-error').textContent,/删除/);
 assert.match(f.$('#participant-group-review').textContent,/Keep me/);assert.ok(f.$('[data-member-tool="discard-group-edit"]'));
});

test('first exact-amount mode restores the manual total and initializes matching shares',async()=>{
 const f=await fixture();await f.open();f.input('[name="title"]','Dinner');f.input('[name="amount"]','200');await f.click('[data-split="items"]');
 f.input('[data-item-title]','Meal');f.input('[data-item-amount]','100');await f.click('[data-split="amount"]');
 assert.equal(Number(f.$('[name="amount"]').value),200);
 assert.equal(Number(f.$('[data-share-amount="owner"]').value)+Number(f.$(`[data-share-amount="${f.other}"]`).value),200);
 await f.click('[type="submit"]');assert.equal(f.saved[0]?.amountCents,20000);
});

for(const mode of ['equal','amount','percent'])test(`a complete item-only expense initializes ${mode} without losing total or participants`,async()=>{
 const f=await fixture();let editor=await f.open();f.input('[name="title"]','Meal');await f.click('[data-split="items"]');
 f.input('[data-item-title]','Dinner');f.input('[data-item-amount]','100');await f.click('[data-item-member][value="owner"]');await editor.flush();
 await f.open(f.draft);await f.click(`[data-split="${mode}"]`);
 assert.equal(Number(f.$('[name="amount"]').value),100);assert.equal(f.$('[name="participant"][value="owner"]').checked,false);
 await f.click('[type="submit"]');assert.equal(f.saved[0]?.amountCents,10000);assert.deepEqual(f.saved[0]?.shares,{[f.other]:10000});
});

test('converted item total does not carry into the next expense',async()=>{
 const f=await fixture();await f.open();f.input('[name="title"]','Dinner');await f.click('[data-split="items"]');
 f.input('[data-item-title]','Meal');f.input('[data-item-amount]','100');await f.click('[data-split="amount"]');await f.click('[name="continueEntry"]');
 assert.equal(f.saved[0]?.amountCents,10000);await f.open(null,f.saveOptions[0].nextEntry);
 assert.equal(f.$('[name="amount"]').value,'');assert.equal(f.$('[name="title"]').value,'');
 assert.ok([...document.querySelectorAll('[data-share-amount]')].every(input=>input.value===''));
});


test('expense and item categories survive editor drafts and submit with itemized amounts',async()=>{
 const f=await fixture();let editor=await f.open();f.input('[name="title"]','Dinner and parking');f.input('[name="category"]','food');
 await f.click('[data-split="items"]');f.input('[data-item-title]','Dinner');f.input('[data-item-amount]','90');
 await f.click('#add-item');const rows=[...document.querySelectorAll('.item-row')];rows[1].querySelector('[data-item-title]').value='Parking';rows[1].querySelector('[data-item-amount]').value='10';rows[1].querySelector('[data-item-category]').value='transport';rows[1].querySelector(`[data-item-member][value="${f.other}"]`).checked=false;
 await editor.flush();editor=await f.open(f.draft);assert.equal(f.$('[name="category"]').value,'food');assert.equal(document.querySelectorAll('[data-item-category]')[1].value,'transport');
 await f.click('[type="submit"]');assert.equal(f.saved[0].category,'food');assert.equal(f.saved[0].items[1].category,'transport');assert.equal(f.saved[0].amountCents,10000);assert.equal(f.saved[0].shares.owner,5500);
});

test('stale delete confirmation refreshes deleted group while retaining unsaved edits',async()=>{
 const f=await fixture();await f.open();await f.chooseGroup();f.input('#edit-group-name','My changed name');
 await f.click('[data-member-tool="ask-delete-group"]');
 await f.store.deleteParticipantGroup(f.id,f.group.id,1);
 await f.click('[data-member-tool="delete-group"]');
 assert.match(f.$('#participant-tools-error').textContent,/已删除/);assert.match(f.$('#participant-group-review').textContent,/My changed name/);
});
