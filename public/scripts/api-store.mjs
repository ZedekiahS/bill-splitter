// Same-origin session cookies. No account ID or credential is accepted from UI payloads.
import {randomId} from './random-id.mjs';
const pending=new Map();
export async function apiRequest(path,{method='GET',body,idempotencyKey}={}){
  const content=body===undefined?undefined:JSON.stringify(body),signature=method+path+(content||'');
  const headers={};
  if(method!=='GET'){
    headers['Content-Type']='application/json';headers['X-Bill-Splitter']='1';
    if(!pending.has(signature))pending.set(signature,randomId());
    headers['Idempotency-Key']=idempotencyKey||pending.get(signature);
  }
  let response;
  try {response=await fetch(path,{method,headers,body:content,credentials:'same-origin',cache:'no-store',...(method==='GET'?{signal:AbortSignal.timeout(15000)}:{})});}
  catch {throw new Error('网络连接失败，请检查网络后重试。');}
  let result;
  try {result=await response.json();}catch{throw new Error('服务暂时不可用，请稍后重试。');}
  // Retain the key after an uncertain server/network failure so a user retry
  // cannot create a second financial record. Never retry the write automatically.
  if(response.ok||response.status<500)pending.delete(signature);
  if(!response.ok){const error=new Error(result.error?.message||'没有保存成功，请重试。');error.status=response.status;throw error;}
  return Object.hasOwn(result,'result')?result.result:result;
}
export const currentSession=()=>apiRequest('/api/auth/me');
export async function uploadBackup(file){
 let response;
 const format=file.name.toLowerCase().endsWith('.zip')?'zip':'json';
 try{response=await fetch(`/api/ledger-import/upload?format=${format}`,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Bill-Splitter':'1'},body:file,credentials:'same-origin',cache:'no-store'});}
 catch{throw new Error('网络连接失败，请重新选择备份文件再试。');}
 let result;try{result=await response.json();}catch{throw new Error('备份未能读取，请重新选择文件再试。');}
 if(!response.ok)throw new Error(result.error?.message||'备份未能读取，请重新选择文件再试。');return result;
}
export const signOut=()=>apiRequest('/api/auth/logout',{method:'POST',body:{}});
export function createApiStore(user){
  const post=(path,body)=>apiRequest(path,{method:'POST',body});
  const store={currentUser:user,mode:'api',listLedgers:()=>apiRequest('/api/ledgers'),loadLedger:id=>apiRequest(`/api/ledgers/${encodeURIComponent(id)}`),createLedger:payload=>post('/api/ledgers',payload),getInvite:token=>apiRequest(`/api/invites/${encodeURIComponent(token)}`),claimInvite:(token,payload)=>post(`/api/invites/${encodeURIComponent(token)}/commands`,{type:'claim',...payload}),approveClaim:(token,uid)=>post(`/api/invites/${encodeURIComponent(token)}/commands`,{type:'approve',uid})};
  store.saveDraftCommand=(id,type,args,key)=>apiRequest(`/api/ledgers/${encodeURIComponent(id)}/commands`,{method:'POST',body:{type,args},idempotencyKey:key});
  store.personalConsumption=()=>apiRequest('/api/personal-consumption');
  store.listUpdates=()=>apiRequest('/api/ledger-updates');
  for(const type of ['updateProject','setAnalyticsInclusion','setLedgerTimeZone','setMemberStatus','revokeInvite','rejectClaim','setLedgerStatus','renameMember','removeMember','addMember','addMembers','saveParticipantGroup','deleteParticipantGroup','addExpense','updateExpense','saveTemplate','setTemplateStatus','skipOccurrence','recordPaymentBatch','reversePaymentBatch','recordPayment','reversePayment','reverseExpense','createInvite']){
    store[type]=(id,...args)=>post(`/api/ledgers/${encodeURIComponent(id)}/commands`,{type,args});
  }
  return store;
}
