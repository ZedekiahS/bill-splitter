// UI ownership is independent of data versions and financial request keys.
// Completing a dialog can retain a continuation; leaving/replacing it cannot.
export function createDialogLifecycle({dialog,release=()=>{},wake=()=>{}}){
 let generation=0,current=null;
 function token(){const own=generation;return {isCurrent:()=>own===generation};}
 function close({reason='user'}={}){
  if(reason!=='complete')generation++;
  const previous=current;current=null;
  release();
  if(dialog.open)dialog.close();
  if(reason==='user'&&previous?.focus?.isConnected)previous.focus.focus();
  wake();
 }
 function leave(){
  generation++;
  if(current?.endOnLeave)close({reason:'complete'});
 }
 function begin(){leave();return token();}
 function open(render,{endOnLeave=false}={}){
  const focus=current?.focus||dialog.ownerDocument?.activeElement;
  generation++;release();
  const operation=token(),instance={endOnLeave,focus};current=instance;
  render(dialog);
  if(!dialog.open)dialog.showModal();else dialog.querySelector('[autofocus]')?.focus();
  return {...operation,element:dialog,canSubmit:form=>operation.isCurrent()&&current===instance&&dialog.open&&form.isConnected&&dialog.contains(form)};
 }
 // A queued close from a previously completed window must not release a new
 // editor. User Escape invalidates immediately, before the native close event.
 dialog.addEventListener('cancel',()=>{generation++;});
 dialog.addEventListener('close',()=>{
  if(!dialog.open&&current){generation++;current=null;release();}
  wake();
 });
 return {begin,open,close,leave};
}
