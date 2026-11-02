const DB_NAME='bill-splitter-drafts-v1';
export const draftScope=(mode,uid,ledgerId)=>JSON.stringify([mode,uid,ledgerId]);
export function draftKey(scope,options={}){
  const kind=options.expenseId?['expense',options.expenseId]:options.occurrence?['occurrence',options.initial.id,options.occurrence.date]:options.templateMode?['template',options.templateId||'new']:['new'];
  return JSON.stringify([scope,...kind]);
}
export function createDraftStore(factory=globalThis.indexedDB){
  let database;
  const open=()=>database??=(new Promise((resolve,reject)=>{
    if(!factory)return reject(new Error('无法保存草稿，请先不要关闭页面。'));
    const request=factory.open(DB_NAME,1);
    request.onupgradeneeded=()=>{const store=request.result.createObjectStore('drafts',{keyPath:'key'});store.createIndex('scope','scope');};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('无法保存草稿，请先不要关闭页面。'));
  }));
  async function transaction(mode,action){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('drafts',mode);let result,error;
      tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(error||tx.error);tx.onabort=()=>reject(error||tx.error);
      action(tx.objectStore('drafts'),value=>result=value,problem=>{error=problem;tx.abort();});
    });
  }
  const conflict=()=>new Error('草稿已在另一个页面更新，请保留当前输入后重新打开。');
  return {
    get:key=>transaction('readonly',(store,done)=>{store.get(key).onsuccess=e=>done(e.target.result||null);}),
    list:scope=>transaction('readonly',(store,done)=>{store.index('scope').getAll(scope).onsuccess=e=>done(e.target.result.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));}),
    put:(record,revision=null)=>transaction('readwrite',(store,done,fail)=>{
      store.get(record.key).onsuccess=e=>{
        if((e.target.result?.revision||null)!==revision)return fail(conflict());
        const next={...record,revision:crypto.randomUUID(),updatedAt:new Date().toISOString()};store.put(next);done(next);
      };
    }),
    remove:(key,revision)=>transaction('readwrite',(store,done,fail)=>{
      store.get(key).onsuccess=e=>{if(e.target.result&&e.target.result.revision!==revision)return fail(conflict());store.delete(key);done();};
    }),
  };
}

// One serialized writer per editor; a newer browser tab cannot be silently overwritten.
export function draftWriter(store,record,onStatus=()=>{}){
  let revision=record?.revision||null,queue=Promise.resolve(),failed=false,stopped=false,last=null;
  return {
    save(value){
      if(stopped||failed)return queue;
      const serialized=JSON.stringify(value);
      if(serialized===last)return queue;
      last=serialized;const snapshot=structuredClone(value);onStatus('saving');
      queue=queue.then(async()=>{
        if(failed)return;
        try{const saved=await store.put(snapshot,revision);revision=saved.revision;onStatus('saved');}
        catch(error){failed=true;onStatus('error',error);}
      });return queue;
    },
    async clear(){stopped=true;await queue;if(failed)throw new Error('草稿已在另一个页面更新，请保留当前输入后重新打开。');await store.remove(record.key,revision);},
    flush:()=>queue,
  };
}
