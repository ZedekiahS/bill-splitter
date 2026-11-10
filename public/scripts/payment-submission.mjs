import {randomId} from './random-id.mjs';

// A payment with an unknown result retains its original payload and request key.
// Session storage also protects closing/reopening the dialog or reloading this tab.
const pending=new Map();
const storagePrefix='bill-splitter.pending-payment:';
export function pendingBatchPayments(store,ledgerId){
 const identities=new Set(pending.keys());
 if(store.mode==='api')try{
  const storage=globalThis.sessionStorage;
  for(let i=0;i<(storage?.length||0);i++){const key=storage.key(i);if(key?.startsWith(storagePrefix))identities.add(key.slice(storagePrefix.length));}
 }catch{/* In-memory requests remain reachable when session storage is unavailable. */}
 const result=[];
 for(const identity of identities)try{
  const parts=JSON.parse(identity);if(!Array.isArray(parts)||parts.length!==6)continue;
  const [uid,id,expenseId,from,command,to]=parts;
  if(uid!==store.currentUser.uid||id!==ledgerId||expenseId!==null||command!=='recordPaymentBatch'||typeof from!=='string'||typeof to!=='string'||from===to)continue;
  const attempt=paymentSubmission(store,ledgerId,undefined,from,command,to).pending,payload=attempt?.payload;
  if(attempt?.key&&payload?.fromMemberId===from&&payload.toMemberId===to&&Array.isArray(payload.allocations)&&payload.allocations.length)result.push(structuredClone(attempt));
 }catch{/* Ignore unrelated or malformed local entries, without deleting them. */}
 return result;
}
export function paymentSubmission(store,ledgerId,expenseId,fromMemberId,command='recordPayment',toMemberId){
 const identity=JSON.stringify([store.currentUser.uid,ledgerId,expenseId,fromMemberId,...(command==='recordPayment'?[]:[command]),...(toMemberId?[toMemberId]:[])]),storageKey=storagePrefix+identity;
 let attempt=pending.get(identity)||null;
 if(!attempt&&store.mode==='api')try{
   const saved=JSON.parse(globalThis.sessionStorage?.getItem(storageKey)||'null');
   if(saved?.key&&saved.payload?.expenseId===expenseId&&(command!=='recordPayment'||saved.payload.fromMemberId===fromMemberId)&&(!toMemberId||saved.payload.toMemberId===toMemberId))attempt=saved;
 }catch{/* In-memory retry protection remains available when storage is blocked. */}
 const persist=value=>{
   attempt=value;if(value)pending.set(identity,value);else pending.delete(identity);
   if(store.mode==='api')try{if(value)globalThis.sessionStorage?.setItem(storageKey,JSON.stringify(value));else globalThis.sessionStorage?.removeItem(storageKey);}catch{}
 };
 return {
   get pending(){return attempt;},
   async submit(payload){
     if(!attempt)persist({key:randomId(),payload:structuredClone(payload)});
     try{
       const result=store.mode==='api'
         ?await store.saveDraftCommand(ledgerId,command,[attempt.payload],attempt.key)
         :await store[command](ledgerId,attempt.payload);
       persist(null);return result;
     }catch(error){
       // Authentication, throttling and timeouts cannot establish whether an
       // earlier attempt committed. A definitive validation/conflict can.
       if(store.mode!=='api'||error.status&&error.status<500&&![401,403,408,429].includes(error.status))persist(null);
       throw error;
     }
   }
 };
}
