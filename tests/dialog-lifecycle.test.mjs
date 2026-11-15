import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createDialogLifecycle} from '../public/scripts/dialog-lifecycle.mjs';
import {openLedgerCreation} from '../public/scripts/ledger-creation.mjs';

function fixture(t){
 const dom=new JSDOM('<button id="trigger">Open</button><dialog></dialog>');t.after(()=>dom.window.close());
 const root=dom.window.document,dialog=root.querySelector('dialog'),queued=[];let released=0;
 dialog.showModal=()=>{dialog.open=true;};
 dialog.close=()=>{dialog.open=false;queued.push(()=>dialog.dispatchEvent(new dom.window.Event('close')));};
 const lifecycle=createDialogLifecycle({dialog,release:()=>released++});
 const open=(options={})=>lifecycle.open(d=>{d.innerHTML='<form><input autofocus></form>';},options);
 return {dom,root,dialog,lifecycle,open,queued,get released(){return released;}};
}
test('a replaced dialog loses submit rights; a late close cannot release its successor',t=>{
 const f=fixture(t),first=f.open({endOnLeave:true}),oldForm=f.dialog.querySelector('form');
 assert.equal(first.canSubmit(oldForm),true);f.lifecycle.close({reason:'complete'});assert.equal(first.isCurrent(),true);
 const second=f.open(),newForm=f.dialog.querySelector('form'),released=f.released;
 f.queued.shift()();assert.equal(f.released,released);assert.equal(first.isCurrent(),false);assert.equal(first.canSubmit(oldForm),false);assert.equal(second.canSubmit(newForm),true);
});
test('navigation invalidates a completed continuation and closes only leave-sensitive windows',t=>{
 const f=fixture(t),created=f.open({endOnLeave:true});f.lifecycle.close({reason:'complete'});f.lifecycle.leave();assert.equal(created.isCurrent(),false);
 const editing=f.open();f.lifecycle.leave();assert.equal(f.dialog.open,true);assert.equal(editing.isCurrent(),false);
 const creation=f.open({endOnLeave:true});f.lifecycle.leave();assert.equal(f.dialog.open,false);assert.equal(creation.isCurrent(),false);
});
test('user close restores focus and Escape invalidates before the native close event',t=>{
 const f=fixture(t),trigger=f.root.querySelector('#trigger');trigger.focus();const first=f.open();f.dialog.querySelector('input').focus();
 f.lifecycle.close();assert.equal(first.isCurrent(),false);assert.equal(f.root.activeElement,trigger);
 const second=f.open();f.dialog.dispatchEvent(new f.dom.window.Event('cancel'));assert.equal(second.isCurrent(),false);
 f.dialog.close();for(const close of f.queued)close();assert.equal(f.dialog.open,false);
});
test('creation controller rejects a late result and detached submit through its exported interface',async t=>{
 const f=fixture(t);let finish,last,writes=0,continued=0;
 const pending=new Promise(resolve=>finish=resolve),store={currentUser:{displayName:'Alice'},createLedger:async()=>{writes++;return pending;}};
 openLedgerCreation({store,getStore:()=>store,
  openDialog:(_title,body,_footer,_wide,options)=>f.lifecycle.open(d=>{d.innerHTML=body;},options),
  submitForm:(event,action)=>{event.preventDefault();last=action(new f.dom.window.FormData(event.target));return last;},
  projectFields:()=>'',errorSlot:()=>'',onCreated:()=>continued++},'personal',{continueEntry:true});
 const form=f.dialog.querySelector('form');form.dispatchEvent(new f.dom.window.Event('submit'));assert.equal(writes,1);
 f.lifecycle.leave();f.open();finish('saved');await last;
 form.dispatchEvent(new f.dom.window.Event('submit'));await last;
 assert.equal(writes,1);assert.equal(continued,0);assert.equal(f.dialog.open,true);
});
