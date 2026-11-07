import {randomId} from './random-id.mjs';

// A payment with an unknown result retains its original payload and request key.
// Session storage also protects closing/reopening the dialog or reloading this tab.
const pending=new Map();
export function paymentSubmission(store,ledgerId,expenseId,fromMemberId){
 const identity=JSON.stringify([store.currentUser.uid,ledgerId,expenseId,fromMemberId]),storageKey='bill-splitter.pending-payment:'+identity;
 let attempt=pending.get(identity)||null;
 if(!attempt&&store.mode==='api')try{
   const saved=JSON.parse(globalThis.sessionStorage?.getItem(storageKey)||'null');
   if(saved?.key&&saved.payload?.expenseId===expenseId&&saved.payload.fromMemberId===fromMemberId)attempt=saved;
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
         ?await store.saveDraftCommand(ledgerId,'recordPayment',[attempt.payload],attempt.key)
         :await store.recordPayment(ledgerId,attempt.payload);
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
