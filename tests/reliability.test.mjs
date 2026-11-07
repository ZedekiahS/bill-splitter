import {Readable} from 'node:stream';
import {access} from 'node:fs/promises';
import {importUploads} from '../server/import-uploads.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../public/scripts/ledger-store.mjs';
import {draftKey} from '../public/scripts/expense-drafts.mjs';
import {exportStream} from '../server/ledger-export.mjs';
import {readImport} from '../server/ledger-import.mjs';
const fixture=async()=>{
 const entries=new Map(),store=createStore({mode:'demo',storage:{getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v)},user:{uid:'test-owner',displayName:'Owner'}});
 const id=await store.createLedger({title:'Review',currency:'CNY',ownerName:'Owner'}),b=await store.addMember(id,'B'),c=await store.addMember(id,'C');
 const payload={title:'Dinner',date:'2026-11-07',amountCents:10000,payerMemberId:'owner',shares:{[b]:10000}};
 const expenseId=await store.addExpense(id,payload);return {store,id,b,c,payload,expenseId};
};
test('single payment rejects a changed recipient, version, or balance without mutation',async()=>{
 const f=await fixture(),review={expenseId:f.expenseId,fromMemberId:f.b,toMemberId:'owner',expectedVersion:1,expectedRemaining:10000,amountCents:5000,date:'2026-11-07'};
 await f.store.updateExpense(f.id,f.expenseId,{...f.payload,payerMemberId:f.c,expectedVersion:1,changeReason:'Correct payer'});
 const before=await f.store.loadLedger(f.id);
 await assert.rejects(f.store.recordPayment(f.id,review),error=>error.statusCode===409);
 assert.deepEqual(await f.store.loadLedger(f.id),before);
 for(const bad of [{...review,expectedVersion:2},{...review,toMemberId:f.c},{...review,toMemberId:f.c,expectedVersion:2,expectedRemaining:9999},{expenseId:f.expenseId,fromMemberId:f.b,amountCents:5000}])await assert.rejects(f.store.recordPayment(f.id,bad));
 await f.store.recordPayment(f.id,{...review,toMemberId:f.c,expectedVersion:2});
 assert.equal((await f.store.loadLedger(f.id)).payments[0].toMemberId,f.c);
});
test('new template and templates from different expenses have separate recoverable drafts',()=>{
 const options=[{templateMode:true},{templateMode:true,sourceExpenseId:'A'},{templateMode:true,sourceExpenseId:'B'}];
 assert.equal(new Set(options.map(o=>draftKey('scope',o))).size,3);
 assert.equal(draftKey('scope',options[1]),draftKey('scope',{...options[1]}));
});
test('complete export with ten maximum-size receipts can be read for restoration',async()=>{
 const f=await fixture(),snapshot=await f.store.loadLedger(f.id),bytes=Buffer.alloc(2*1024*1024);bytes.write('%PDF-1.4\n');
 snapshot.expenses=Array.from({length:4},(_,i)=>({...snapshot.expenses[0],id:'e'+i,history:[],receipts:Array.from({length:i<3?3:1},(_,j)=>({id:`file-${i}-${j}`,name:'receipt.pdf',type:'application/pdf',size:bytes.length}))}));
 const chunks=[];for await(const chunk of exportStream(snapshot,async()=>({bytes})).stream)chunks.push(chunk);
 const zip=Buffer.concat(chunks);assert.ok(zip.length>20*1024*1024);
 const result=await readImport({format:'zip',content:zip.toString('base64')});
 assert.equal(result.data.expenses.length,4);assert.equal([...result.files.keys()].filter(k=>k.startsWith('attachments/')).length,10);
});


test('staged backups are account-bound, single-use, and remove private temporary files',async()=>{
 const f=await fixture(),snapshot=await f.store.loadLedger(f.id),bytes=Buffer.from('%PDF-1.4\nreceipt');
 snapshot.expenses[0].receipts=[{id:'file',name:'receipt.pdf',type:'application/pdf',size:bytes.length}];
 const chunks=[];for await(const chunk of exportStream(snapshot,async()=>({bytes})).stream)chunks.push(chunk);
 const uploads=importUploads(),user={uid:'importer'};
 try{
  const result=await uploads.receive(user,Readable.from(chunks),'zip'),file=[...result.archive.files.values()][0];
  await access(file.importPath);
  assert.throws(()=>uploads.acquire({uid:'outsider'},result.token),error=>error.statusCode===410);
  assert.equal(uploads.acquire(user,result.token),result.archive);
  assert.throws(()=>uploads.acquire(user,result.token),error=>error.statusCode===409);
  uploads.release(result.token);await uploads.remove(result.token);
  await assert.rejects(access(file.importPath));assert.throws(()=>uploads.acquire(user,result.token),error=>error.statusCode===410);
  await assert.rejects(uploads.receive(user,Readable.from(['invalid zip']),'zip'),/压缩包无效/);
 }finally{await uploads.close();}
});

test('expired preview requires a new upload and excessive individual attachments are rejected',async()=>{
 const f=await fixture(),snapshot=await f.store.loadLedger(f.id),uploads=importUploads({ttl:-1});
 try{
  const chunks=[];for await(const chunk of exportStream(snapshot,async()=>{}).stream)chunks.push(chunk);
  const result=await uploads.receive({uid:'a'},Readable.from(chunks),'zip');
  assert.throws(()=>uploads.acquire({uid:'a'},result.token),error=>error.statusCode===410);
  const bytes=Buffer.alloc(2*1024*1024+1);bytes.write('%PDF-1.4\n');
  snapshot.expenses[0].receipts=[{id:'big',name:'big.pdf',type:'application/pdf',size:bytes.length}];
  const bad=[];for await(const chunk of exportStream(snapshot,async()=>({bytes})).stream)bad.push(chunk);
  await assert.rejects(uploads.receive({uid:'b'},Readable.from(bad),'zip'),/压缩包无效/);
 }finally{await uploads.close();}
});
