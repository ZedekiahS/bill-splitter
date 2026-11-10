import {budgetData,nextBudget} from '../public/scripts/personal-budget.mjs';
import {personalData} from '../public/scripts/expense-analytics.mjs';
import {readFile} from 'node:fs/promises';
import {memberBalances,remainingFor,expenseDebts,netExpenseAmount} from '../public/scripts/ledger-core.mjs';
import { randomUUID } from 'node:crypto';
import { createStateStore } from '../public/scripts/ledger-domain.mjs';
import { receiptBlob } from '../public/scripts/receipt-files.mjs';
import { transaction } from './database.mjs';
import { HttpError,hash } from './auth.mjs';
import {readImport,restoreState} from './ledger-import.mjs';
export const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function id(value){if(!uuid(value))throw new HttpError(400,'请求内容无效，请刷新后重试。');return value;}
function engine(state,user){return createStateStore({user,read:()=>state,mutate:fn=>fn(state,user,new Date().toISOString())});}
const commandNames=new Set(['updateProject','setAnalyticsInclusion','setLedgerTimeZone','setMemberStatus','revokeInvite','rejectClaim','setLedgerStatus','renameMember','removeMember','addMember','addMembers','saveParticipantGroup','deleteParticipantGroup','addExpense','updateExpense','saveTemplate','setTemplateStatus','skipOccurrence','recordRefund','reverseRefund','recordPaymentBatch','reversePaymentBatch','recordPayment','reversePayment','reverseExpense','createInvite']);
const empty=()=>({ledgers:{},members:{},expenses:{},payments:{},templates:{},occurrences:{},invites:{},claims:{}});

export function ledgerService(pool){
  async function load(client,ledgerId,user,{lock=false,invite=false}={}){
    id(ledgerId);
    const {rows}=await client.query(`SELECT body FROM bs_ledgers WHERE id=$1${lock?' FOR UPDATE':''}`,[ledgerId]);
    if(!rows[0]||!invite&&!rows[0].body.ledgers[ledgerId].memberUids.includes(user.uid))throw new HttpError(403,'暂时没有访问权限。请确认已加入账本，再刷新重试。');
    return rows[0].body;
  }
  async function save(client,ledgerId,state){
    const savedFiles=new Map();
    for(const expense of Object.values(state.expenses[ledgerId]||{})){
      const versions=[expense,...(expense.history||[]).flatMap(event=>[event.before,event.after].filter(Boolean))];
      for(const version of versions)for(let index=0;index<(version.receipts||[]).length;index++){
        const file=version.receipts[index];if(!file.dataUrl&&!file.importPath)continue;
        if(file.id&&savedFiles.has(file.id)){version.receipts[index]=savedFiles.get(file.id);continue;}
        const bytes=file.importPath?await readFile(file.importPath):Buffer.from(await receiptBlob(file).arrayBuffer()),receiptId=file.id||randomUUID();
        await client.query('INSERT INTO bs_receipts(id,ledger_id,expense_id,name,mime,bytes) VALUES($1,$2,$3,$4,$5,$6)',[receiptId,ledgerId,expense.id||Object.keys(state.expenses[ledgerId]).find(key=>state.expenses[ledgerId][key]===expense),file.name,file.type,bytes]);
        const stored={id:receiptId,name:file.name,type:file.type,size:bytes.length,url:`/api/ledgers/${ledgerId}/receipts/${receiptId}`};
        version.receipts[index]=stored;savedFiles.set(receiptId,stored);
      }
    }
    await client.query('UPDATE bs_ledgers SET body=$2,updated_at=now(),revision=revision+1 WHERE id=$1',[ledgerId,state]);
    for(const uid of state.ledgers[ledgerId].memberUids)await client.query('INSERT INTO bs_memberships(ledger_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[ledgerId,uid]);
    for(const token of Object.keys(state.invites))await client.query('INSERT INTO bs_invites(id,ledger_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[token,ledgerId]);
  }
  async function once(client,user,key,fingerprint,action){
    id(key);
    // A database advisory lock also serializes the same key across different ledgers.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user.uid+':'+key]);
    const {rows}=await client.query('SELECT fingerprint,result FROM bs_requests WHERE user_id=$1 AND key=$2',[user.uid,key]);
    if(rows.length){if(rows[0].fingerprint!==fingerprint)throw new HttpError(409,'这次操作的内容已改变，请刷新后重试。');return rows[0].result;}
    const result=(await action())??null;
    await client.query('INSERT INTO bs_requests(user_id,key,fingerprint,result) VALUES($1,$2,$3,$4)',[user.uid,key,fingerprint,JSON.stringify(result)]);
    return result;
  }
  async function write(user,key,route,body,action){return transaction(pool,client=>once(client,user,key,hash(JSON.stringify([route,body])),()=>action(client)));}
  async function inviteLedger(client,token){id(token);const {rows}=await client.query('SELECT ledger_id FROM bs_invites WHERE id=$1',[token]);if(!rows.length)throw new HttpError(404,'邀请已失效、过期或被认领。');return rows[0].ledger_id;}
  const budgets=async(user,client=pool)=>(await client.query('SELECT month,currency,amount_cents::float8 AS "amountCents",version FROM bs_personal_budgets WHERE user_id=$1 ORDER BY month,currency',[user.uid])).rows;
  return {
    async savePersonalBudget(user,payload,key){
      const data=budgetData(payload);
      return write(user,key,'personal-budget',data,async client=>{
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[user.uid+':budget:'+data.month+':'+data.currency]);
        const current=(await budgets(user,client)).find(b=>b.month===data.month&&b.currency===data.currency),next=nextBudget(current,data);
        await client.query('INSERT INTO bs_personal_budgets(user_id,month,currency,amount_cents,version) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,month,currency) DO UPDATE SET amount_cents=$4,version=$5',[user.uid,next.month,next.currency,next.amountCents,next.version]);
        return next;
      });
    },
    async previewArchive(user,archive){
      const {id,state,attachmentCount}=restoreState(archive,user,{memberId:archive.data.members?.[0]?.id});
      const snapshot=await engine(state,user).loadLedger(id),active=snapshot.expenses.filter(e=>e.status==='active');
      const dates=snapshot.expenses.map(e=>e.date).sort(),balances=memberBalances(snapshot);
      return {title:archive.data.ledger.title,currency:archive.data.ledger.currency,members:archive.data.members.map((m,index)=>{
        const current=snapshot.members[index],receivable=active.flatMap(expenseDebts).filter(d=>d.toMemberId===current.id).reduce((n,d)=>n+d.amountCents,0);
        const payable=active.flatMap(expenseDebts).filter(d=>d.fromMemberId===current.id).reduce((n,d)=>n+d.amountCents,0);
        return {id:m.id,name:m.name,receivableCents:receivable,payableCents:payable,balanceCents:balances.find(b=>b.memberId===current.id).balanceCents};
      }),expenseCount:snapshot.expenses.length,attachmentCount,from:dates[0]||null,to:dates.at(-1)||null,totalCents:active.reduce((n,e)=>n+netExpenseAmount(e),0),outstandingCents:active.flatMap(expenseDebts).reduce((n,d)=>n+d.amountCents,0)};
    },
    async previewImport(user,payload){return this.previewArchive(user,await readImport(payload));},
    async importUploaded(user,payload,key,acquire){return write(user,key,'uploaded-import',payload,async client=>{
      const archive=acquire(),{id:ledgerId,state}=restoreState(archive,user,payload);
      await client.query('INSERT INTO bs_ledgers(id,owner_id,body) VALUES($1,$2,$3)',[ledgerId,user.uid,state]);
      await save(client,ledgerId,state);return ledgerId;
    });},
    async import(user,payload,key){return write(user,key,'import',payload,async client=>{
      const archive=await readImport(payload),{id:ledgerId,state}=restoreState(archive,user,payload);
      await client.query('INSERT INTO bs_ledgers(id,owner_id,body) VALUES($1,$2,$3)',[ledgerId,user.uid,state]);
      await save(client,ledgerId,state);return ledgerId;
    });},
    async personalConsumption(user){const {rows}=await pool.query('SELECT l.body FROM bs_ledgers l JOIN bs_memberships m ON m.ledger_id=l.id WHERE m.user_id=$1',[user.uid]);const snapshots=await Promise.all(rows.map(({body})=>engine(body,user).loadLedger(Object.keys(body.ledgers)[0])));return {...personalData(snapshots,user.uid),budgets:await budgets(user)};},
    async updates(user){const {rows}=await pool.query('SELECT l.id,l.revision::text AS revision FROM bs_ledgers l JOIN bs_memberships m ON m.ledger_id=l.id WHERE m.user_id=$1 ORDER BY l.id',[user.uid]);const privateRows=await budgets(user);if(privateRows.length)rows.push({id:'personal-budgets',revision:JSON.stringify(privateRows)});return rows;},
    async list(user){const {rows}=await pool.query('SELECT l.id,l.body->\'ledgers\'->l.id::text AS ledger FROM bs_ledgers l JOIN bs_memberships m ON m.ledger_id=l.id WHERE m.user_id=$1 ORDER BY l.updated_at DESC',[user.uid]);return rows.map(row=>({...row.ledger,id:row.id}));},
    async get(user,ledgerId){const state=await load(pool,ledgerId,user);return engine(state,user).loadLedger(ledgerId);},
    async create(user,payload,key){return write(user,key,'create',payload,async client=>{
      const state=empty(),ledgerId=await engine(state,user).createLedger({...payload,ownerName:user.displayName});
      await client.query('INSERT INTO bs_ledgers(id,owner_id,body) VALUES($1,$2,$3)',[ledgerId,user.uid,state]);
      await save(client,ledgerId,state);return ledgerId;
    });},
    async command(user,ledgerId,body,key){
      if(!commandNames.has(body?.type)||!Array.isArray(body.args)||body.args.length>3)throw new HttpError(400,'请求内容无效，请刷新后重试。');
      return write(user,key,ledgerId,body,async client=>{
        const state=await load(client,ledgerId,user,{lock:true});
        const result=await engine(state,user)[body.type](ledgerId,...body.args);
        await save(client,ledgerId,state);return result;
      });
    },
    async invitation(user,token){const ledgerId=await inviteLedger(pool,token),state=await load(pool,ledgerId,user,{invite:true});return engine(state,user).getInvite(token);},
    async invitationCommand(user,token,body,key){
      if(!['claim','approve'].includes(body?.type))throw new HttpError(400,'请求内容无效，请刷新后重试。');
      return write(user,key,token,body,async client=>{
        const ledgerId=await inviteLedger(client,token),state=await load(client,ledgerId,user,{invite:true,lock:true}),store=engine(state,user);
        const result=body.type==='claim'?await store.claimInvite(token,{displayName:body.displayName}):await store.approveClaim(token,id(body.uid));
        await save(client,ledgerId,state);return result;
      });
    },
    async receipt(user,ledgerId,receiptId){
      id(ledgerId);id(receiptId);
      const {rows}=await pool.query(`SELECT r.name,r.mime,r.bytes FROM bs_receipts r JOIN bs_memberships m ON m.ledger_id=r.ledger_id WHERE r.id=$1 AND r.ledger_id=$2 AND m.user_id=$3`,[receiptId,ledgerId,user.uid]);
      if(!rows.length)throw new HttpError(403,'暂时没有访问权限。请确认已加入账本，再刷新重试。');return rows[0];
    },
  };
}
