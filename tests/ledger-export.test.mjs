import {test} from 'node:test';
import assert from 'node:assert/strict';
import {csv,ledgerExport,exportFileName} from '../public/scripts/ledger-export.mjs';
import {exportStream} from '../server/ledger-export.mjs';
import {unzip} from './zip-helper.mjs';
const bytes=Buffer.from('%PDF-1.4\nreceipt');
const receipt={id:'file1',name:'../../收据.pdf',type:'application/pdf',size:bytes.length,url:'/api/ledgers/id/receipts/file1'};
function fixture(){
  const expense={id:'e1',title:'=SUM(1,2)',date:'2026-11-01',amountCents:1001,payerMemberId:'a',shares:{a:501,b:500},repaid:{a:0,b:0},status:'active',receipts:[],history:[{id:'h1',type:'created',after:{title:'原始',amountCents:1001,payerMemberId:'a',shares:{a:501,b:500},receipts:[receipt]}}]};
  return {ledger:{id:'trip',title:'旅行',currency:'CNY',ownerUid:'alice',memberUids:['alice','bob'],lastApprovedInviteId:'private-token'},members:[{id:'a',name:'小周',uid:'alice',claimInviteId:'private-token'},{id:'b',name:'小林',uid:'bob'}],expenses:[expense],payments:[],templates:[],occurrences:[],invites:[{token:'private-token'}],claims:[{email:'private@example.test'}]};
}
test('exports stable fields, exact cents, private history files and no invite credentials',()=>{
  const snapshot=fixture(),before=structuredClone(snapshot),result=ledgerExport(snapshot,'2026-11-01T12:00:00Z');
  assert.deepEqual(snapshot,before);assert.equal(result.data.schemaVersion,1);assert.equal(result.data.expenses[0].amountCents,1001);
  assert.equal(result.files.length,1);assert.equal(result.data.expenses[0].history[0].after.receipts[0].path,'attachments/00001.pdf');
  assert.equal(JSON.stringify(result.data).includes('private-token'),false);assert.equal(JSON.stringify(result.data).includes('private@example.test'),false);
  assert.ok(result.tables['expenses.csv'].includes("'=SUM(1,2)"));assert.equal(result.data.expenses[0].title,'=SUM(1,2)');
});
test('CSV quotes newlines and formula-like text while preserving numeric negatives',()=>{
  assert.equal(csv([['a,b','line\n"quote"',' \t=1',-20]]),'\uFEFF"a,b","line\n""quote""","\' \t=1",-20\r\n');
  assert.equal(exportFileName('../旅行:*?'),'.._旅行___');
});
test('ZIP extracts with an independent reader and includes a removed historical receipt once',async()=>{
  const snapshot=fixture();snapshot.expenses[0].receipts=[receipt];
  let reads=0;const archive=exportStream(snapshot,async()=>{reads++;return {bytes};}),chunks=[];
  for await(const chunk of archive.stream)chunks.push(chunk);
  const files=await unzip(Buffer.concat(chunks));assert.equal(reads,1);assert.deepEqual(files.get('attachments/00001.pdf'),bytes);
  assert.equal(JSON.parse(files.get('ledger.json')).ledger.title,'旅行');assert.ok(files.has('history.csv'));assert.ok(files.has('README.txt'));
  assert.equal([...files.keys()].some(name=>name.includes('..')),false);
});
