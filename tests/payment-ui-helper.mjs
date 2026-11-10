import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {settlementGroups,repaymentPlan,paymentGroups} from '../public/scripts/settlement-plans.mjs';
import {paymentSubmission} from '../public/scripts/payment-submission.mjs';
import {formatMoney,parseMoney} from '../public/scripts/ledger-core.mjs';
import {t,registerMessages} from '../public/scripts/i18n.mjs';
import messages from '../public/scripts/app-messages.mjs';
registerMessages(messages);
const source=await readFile(new URL('../public/scripts/app.mjs',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function batchPaymentDialog('),source.indexOf('function confirmAction('));
export function batchPaymentUI(store,snapshot){
 const dom=new JSDOM('<main></main>',{url:'http://localhost'}),document=dom.window.document,errors=[],saved=[];
 let lastSubmit;const state={store,snapshot};
 const context=vm.createContext({state,structuredClone,t,settlementGroups,repaymentPlan,paymentGroups,paymentSubmission,parseMoney,document,
  mine:()=>({id:snapshot.members.find(m=>m.uid===store.currentUser.uid)?.id}),activeExpenses:()=>state.snapshot.expenses,sortedPayments:()=>state.snapshot.payments,heading:()=>'',icon:()=>'',newExpenseButton:()=>'',avatar:()=>'',balanceLabel:()=>'',empty:()=>'',
  $:s=>document.querySelector(s),escape:s=>String(s),amountText:n=>(n/100).toFixed(2),money:n=>formatMoney(n,snapshot.ledger.currency),dateText:s=>s,localDate:()=> '2026-11-10',memberName:id=>snapshot.members.find(m=>m.id===id)?.name||id,canReceive:()=>true,
  openDialog:(_,html)=>document.querySelector('main').innerHTML=html,errorSlot:()=>'<p id="form-error" hidden></p>',errorMessage:e=>e.message,
  submitForm:(event,cb)=>{event.preventDefault();const button=event.target.querySelector('[type="submit"]');button.disabled=true;lastSubmit=(async()=>{try{await cb(new dom.window.FormData(event.target));}catch(e){errors.push(e);}finally{button.disabled=false;}})();return lastSubmit;},finishSave:async msg=>saved.push(msg)});
 vm.runInContext(code,context);
 vm.runInContext(source.slice(source.indexOf('function settlementsView('),source.indexOf('function membersView(')),context);
 return {dom,errors,saved,state,$:s=>document.querySelector(s),settlements:()=>vm.runInContext('settlementsView()',context),open(from,to){context.from=from;context.to=to;vm.runInContext('batchPaymentDialog(from,to)',context);},input(name,value){const e=document.querySelector(`[name="${name}"]`);e.value=value;e.dispatchEvent(new dom.window.Event('input',{bubbles:true}));},submit(){document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));return lastSubmit;}};
}
