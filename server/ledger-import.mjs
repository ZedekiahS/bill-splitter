import {projectData} from '../public/scripts/expense-analytics.mjs';
import yauzl from 'yauzl';
import {randomUUID} from 'node:crypto';
import {expenseData,text} from '../public/scripts/ledger-domain.mjs';
import {assertCents,validateDate} from '../public/scripts/ledger-core.mjs';
import {normalizeSchedule,occurrenceId} from '../public/scripts/expense-features.mjs';
import {timeZone} from '../public/scripts/ledger-time.mjs';
import {receiptBlob} from '../public/scripts/receipt-files.mjs';
import {checkBackupMetadata,MAX_BACKUP_RECEIPT_BYTES} from './backup-limits.mjs';
import {expenseVersion} from '../public/scripts/expense-history.mjs';
const invalid=()=>{throw new Error('账本文件不完整或账目不一致，请使用原始导出文件。');};
const list=(value,max=Infinity)=>{if(!Array.isArray(value)||value.length>max)invalid();return value;};
const instant=value=>{if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))invalid();return value;};
function mapping(rows){const map=new Map();for(const row of rows){if(!row||typeof row.id!=='string'||!row.id||map.has(row.id))invalid();map.set(row.id,randomUUID());}return map;}
function mapped(map,id,optional=false){if(optional&&id==null)return null;if(!map.has(id))invalid();return map.get(id);}
async function unzip(bytes){return new Promise((resolve,reject)=>{
 yauzl.fromBuffer(bytes,{lazyEntries:true},(error,zip)=>{
  if(error)return reject(new Error('无法读取压缩包，请选择完整账本 ZIP。'));
  const files=new Map();let size=0,done=false;
  const fail=()=>{if(done)return;done=true;zip.close();reject(new Error('压缩包无效，请选择原始完整账本 ZIP。'));};
  zip.on('error',fail);zip.on('end',()=>{if(!done){done=true;resolve(files);}});
  zip.on('entry',entry=>{
   if(files.has(entry.fileName)||entry.fileName.includes('..')||entry.fileName.startsWith('/')||entry.fileName.includes('\\'))return fail();
   if(entry.fileName==='ledger.json'){try{checkBackupMetadata(entry.uncompressedSize);}catch{return fail();}}
   else if(entry.fileName.startsWith('attachments/')){if(entry.uncompressedSize>MAX_BACKUP_RECEIPT_BYTES)return fail();}
   else return zip.readEntry();
   zip.openReadStream(entry,(error,stream)=>{
    if(error)return fail();const chunks=[];stream.on('error',fail);
    stream.on('data',chunk=>{size+=chunk.length;if(size>40*1024*1024){stream.destroy();fail();}else chunks.push(chunk);});
    stream.on('end',()=>{if(!done){files.set(entry.fileName,Buffer.concat(chunks));zip.readEntry();}});
   });
  });zip.readEntry();
 });
});}
export async function readImport(payload){
 if(!payload||!['json','zip'].includes(payload.format)||typeof payload.content!=='string'||payload.content.length>29*1024*1024)invalid();
 let bytes,files=new Map();
 if(payload.format==='zip'){
  if(!/^[A-Za-z0-9+/]*={0,2}$/.test(payload.content))invalid();
  bytes=Buffer.from(payload.content,'base64');files=await unzip(bytes);bytes=files.get('ledger.json');
 }else bytes=Buffer.from(payload.content,'utf8');
 checkBackupMetadata(bytes?.length||0);
 let data;try{data=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));}catch{invalid();}
 if(data?.schemaVersion!==1||!data.ledger)invalid();
 return {data,files};
}
export function restoreState({data,files},user,{memberId,title}={}){
 const members=list(data.members),expenses=list(data.expenses),payments=list(data.payments),templates=list(data.templates||[]),occurrences=list(data.occurrences||[]);
 if(!members.length)invalid();const memberMap=mapping(members),expenseMap=mapping(expenses),paymentMap=mapping(payments),templateMap=mapping(templates),batchMap=new Map();
 if(!memberMap.has(memberId))throw new Error('请选择导入账本中代表你自己的成员。');
 const oldUid=members.find(m=>m.id===memberId).uid,actor=uid=>uid&&uid===oldUid?user.uid:uid?'imported:'+String(uid).slice(0,200):null;
 const id=randomUUID(),now=new Date().toISOString(),state={ledgers:{},members:{[id]:{}},expenses:{[id]:{}},payments:{[id]:{}},templates:{[id]:{}},occurrences:{[id]:{}},invites:{},claims:{}};
 const currency=text(data.ledger.currency,'币种',3);if(!/^[A-Z]{3}$/.test(currency))invalid();
 state.ledgers[id]={title:text(title||data.ledger.title,'账本名称'),currency,...projectData(data.ledger),projectVersion:1,timeZone:timeZone(data.ledger.timeZone),ownerUid:user.uid,memberUids:[user.uid],createdAt:now,status:'active',lastApprovedInviteId:null,importedAt:now,importedFrom:{ledgerId:String(data.ledger.id),exportedAt:instant(data.exportedAt)}};
 for(const m of members)state.members[id][memberMap.get(m.id)]={name:text(m.name,'成员名字',40),uid:m.id===memberId?user.uid:null,createdAt:instant(m.createdAt),createdByUid:user.uid,claimInviteId:null,status:m.id===memberId?'active':m.status==='inactive'?'inactive':'active'};
 state.participantGroups={[id]:{}};
 const groupNames=new Set();
 for(const group of list(data.participantGroups||[])){
   const name=text(group.name,'组合名称',40),key=name.toLocaleLowerCase();if(groupNames.has(key))invalid();groupNames.add(key);
   const ids=list(group.memberIds,50).map(old=>mapped(memberMap,old));if(new Set(ids).size!==ids.length)invalid();
   state.participantGroups[id][randomUUID()]={name,memberIds:ids,createdByUid:user.uid,createdAt:instant(group.createdAt),updatedAt:instant(group.updatedAt),version:1};
 }
 const attachmentMap=new Map();
 function receipts(rows){return list(rows||[],3).map(file=>{
  const bytes=files.get(file.path);if(!bytes)throw new Error('导出文件包含附件，请选择带附件的完整 ZIP 账本。');
  if(!/^attachments\/[0-9]+\.(png|jpg|webp|pdf)$/.test(file.path)||(bytes.importPath?bytes.size:bytes.length)!==file.size)invalid();
  text(file.name,'收据文件名',120);if(bytes.importPath&&bytes.type!==file.type)invalid();
  if(!attachmentMap.has(file.path))attachmentMap.set(file.path,{id:randomUUID(),name:file.name,type:file.type,size:file.size,...(bytes.importPath?{importPath:bytes.importPath}:{dataUrl:`data:${file.type};base64,${bytes.toString('base64')}`})});
  const result=attachmentMap.get(file.path);if(file.name!==result.name||file.type!==result.type)invalid();return {...result};
 });}
 function version(e){
  const shares=Object.fromEntries(Object.entries(e.shares||{}).map(([key,value])=>[mapped(memberMap,key),value]));
  const items=list(e.items||[],8).map(row=>({...row,memberIds:list(row.memberIds,50).map(key=>mapped(memberMap,key))}));
  const payload={title:e.title,date:e.date,amountCents:e.amountCents,payerMemberId:mapped(memberMap,e.payerMemberId),shares,items,category:e.category,note:e.note,receipts:receipts(e.receipts)};
  const activeMembers=Object.fromEntries(Object.entries(state.members[id]).map(([key,m])=>[key,{...m,status:'active'}]));
  const result=expenseData({...payload,receipts:[]},activeMembers,user.uid,now);result.receipts=payload.receipts;
  if(!['active','reversed'].includes(e.status))invalid();result.status=e.status;
  result.repaid=Object.fromEntries(Object.entries(shares).map(([key,cents])=>{const old=[...memberMap].find(([,value])=>value===key)[0],paid=assertCents(e.repaid?.[old]||0,true);if(paid>cents||key===result.payerMemberId&&paid||e.status==='reversed'&&paid)invalid();return [key,paid];}));
  return result;
 }
 const batch=id=>{if(!id)return null;if(typeof id!=='string')invalid();if(!batchMap.has(id))batchMap.set(id,randomUUID());return batchMap.get(id);};
 for(const e of expenses){
  const result=version(e);if(!Number.isSafeInteger(e.version||1)||(e.version||1)<1)invalid();
  Object.assign(result,{createdByUid:actor(e.createdByUid),createdAt:instant(e.createdAt),version:e.version||1,updatedAt:e.updatedAt?instant(e.updatedAt):null,reversedAt:e.reversedAt?instant(e.reversedAt):null,lastPaymentId:mapped(paymentMap,e.lastPaymentId,true),sourceTemplateId:mapped(templateMap,e.sourceTemplateId,true),sourceDate:e.sourceDate?validateDate(e.sourceDate):null});
  result.history=list(e.history||[]).map(h=>{
   if(!['created','updated','payment','payment-reversed','reversed'].includes(h.type))invalid();
   const row={id:randomUUID(),type:h.type,actorUid:actor(h.actorUid),actorName:h.actorName==null?null:text(h.actorName,'成员名字',120),at:instant(h.at)};
   for(const key of ['reason','note'])if(h[key]!=null){if(typeof h[key]!=='string'||h[key].length>1000)invalid();row[key]=h[key];}
   if(h.type==='updated'&&(!h.before||!h.after)||h.before&&!h.after)invalid();
   for(const key of ['before','after'])if(h[key])row[key]=expenseVersion(version(h[key]));
   for(const key of ['fromMemberId','toMemberId'])if(h[key])row[key]=mapped(memberMap,h[key]);
   if(h.paymentId)row.paymentId=mapped(paymentMap,h.paymentId);if(h.batchId)row.batchId=batch(h.batchId);if(h.amountCents!=null)row.amountCents=assertCents(h.amountCents);
   return row;
  });state.expenses[id][expenseMap.get(e.id)]=result;
 }
 for(const p of payments){
  if(!['payment','reversal'].includes(p.type))invalid();
  state.payments[id][paymentMap.get(p.id)]={expenseId:mapped(expenseMap,p.expenseId),fromMemberId:mapped(memberMap,p.fromMemberId),toMemberId:mapped(memberMap,p.toMemberId),amountCents:assertCents(p.amountCents),date:validateDate(p.date),note:String(p.note||'').slice(0,300),type:p.type,reversesId:mapped(paymentMap,p.reversesId,true),reversedBy:mapped(paymentMap,p.reversedBy,true),createdByUid:actor(p.createdByUid),createdAt:instant(p.createdAt),...(p.batchId?{batchId:batch(p.batchId)}:{}),...(p.reversesBatchId?{reversesBatchId:batch(p.reversesBatchId)}:{})};
 }
 const paid=new Map();
 for(const [key,p]of Object.entries(state.payments[id])){
  if(p.type==='payment'&&p.reversesId||p.type==='reversal'&&p.reversedBy)invalid();
  if(p.type==='reversal'){
   const original=state.payments[id][p.reversesId];if(!original||original.type!=='payment'||original.reversedBy!==key||['expenseId','fromMemberId','toMemberId','amountCents'].some(k=>original[k]!==p[k]))invalid();
  }else if(p.reversedBy){if(state.payments[id][p.reversedBy]?.type!=='reversal'||state.payments[id][p.reversedBy]?.reversesId!==key)invalid();}
  else{
   const e=state.expenses[id][p.expenseId];if(e.status!=='active'||e.payerMemberId!==p.toMemberId||p.fromMemberId===p.toMemberId||!Object.hasOwn(e.shares,p.fromMemberId))invalid();
   const token=p.expenseId+':'+p.fromMemberId;paid.set(token,(paid.get(token)||0n)+BigInt(p.amountCents));
  }
 }
 for(const [key,e]of Object.entries(state.expenses[id]))for(const [member,cents]of Object.entries(e.repaid))if(BigInt(cents)!==(paid.get(key+':'+member)||0n))invalid();
 const groups=new Map();for(const p of Object.values(state.payments[id]))if(p.batchId){
  const previous=groups.get(p.batchId);if(previous&&(['fromMemberId','toMemberId','type','date','note'].some(key=>p[key]!==previous[key])||Boolean(p.reversedBy)!==Boolean(previous.reversedBy)))invalid();groups.set(p.batchId,p);
 }
 for(const template of templates){
  const record=version({...template,date:template.startDate||'2000-01-01',status:'active',repaid:{},receipts:[]});
  const schedule=normalizeSchedule(template);if(!['active','paused','archived'].includes(template.status))invalid();
  state.templates[id][templateMap.get(template.id)]={title:record.title,amountCents:record.amountCents,payerMemberId:record.payerMemberId,shares:record.shares,items:record.items,category:record.category,note:record.note,...schedule,status:template.status,createdByUid:user.uid,createdAt:instant(template.createdAt),updatedAt:instant(template.updatedAt)};
 }
 for(const o of occurrences){const templateId=mapped(templateMap,o.templateId),date=validateDate(o.date),key=occurrenceId(templateId,date);if(!['posted','skipped'].includes(o.status)||state.occurrences[id][key])invalid();state.occurrences[id][key]={templateId,date,status:o.status,expenseId:mapped(expenseMap,o.expenseId,true),createdByUid:actor(o.createdByUid),createdAt:instant(o.createdAt)};}
 const histories=(rows,kind)=>list(rows||[]).map(row=>{
  const result={...row,at:instant(row.at),actorUid:actor(row.actorUid)};
  if(kind==='name'){result.before=text(row.before,'成员名字',120);result.after=text(row.after,'成员名字',120);}
  else if(kind==='zone'){result.before=timeZone(row.before);result.after=timeZone(row.after);}
  else if(!['active','inactive','archived'].includes(row.status))invalid();return result;
 });
 state.ledgers[id].statusHistory=histories(data.ledger.statusHistory,'status');
 state.ledgers[id].timeZoneHistory=histories(data.ledger.timeZoneHistory,'zone');
 state.ledgers[id].status=data.ledger.status==='archived'?'archived':'active';
 state.ledgers[id].archivedAt=data.ledger.archivedAt?instant(data.ledger.archivedAt):null;
 for(const m of members){state.members[id][memberMap.get(m.id)].nameHistory=histories(m.nameHistory,'name');state.members[id][memberMap.get(m.id)].statusHistory=histories(m.statusHistory,'status');}
 for(const file of attachmentMap.values())if(file.dataUrl)receiptBlob(file);
 return {id,state,attachmentCount:attachmentMap.size};
}
