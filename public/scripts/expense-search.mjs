import {consumptionShares,remainingFor,validateDate} from './ledger-core.mjs';
export function filterExpenses(expenses,{query='',memberId='',memberRole='any',from='',to='',status='all'}={}){
  if(from)validateDate(from);if(to)validateDate(to);
  if(from&&to&&from>to)throw new Error('结束日期不能早于开始日期。');
  const search=query.trim().toLocaleLowerCase();
  return expenses.filter(expense=>{
    const outstanding=Object.keys(expense.shares).reduce((sum,id)=>sum+remainingFor(expense,id),0);
    return (!search||[expense.title,expense.note||''].some(text=>text.toLocaleLowerCase().includes(search)))&&
      (!from||expense.date>=from)&&(!to||expense.date<=to)&&
      (!memberId||(memberRole==='payer'?expense.payerMemberId===memberId:memberRole==='participant'?Object.hasOwn(consumptionShares(expense),memberId):expense.payerMemberId===memberId||Object.hasOwn(consumptionShares(expense),memberId)))&&
      (status==='all'||status==='reversed'&&expense.status==='reversed'||status==='open'&&expense.status==='active'&&outstanding>0||status==='settled'&&expense.status==='active'&&outstanding===0);
  });
}
// Preserve the input node and let IMEs finish composing before filtering results.
export function bindExpenseSearch(input, onSearch) {
  let composing = false;
  let lastValue = input.value;
  const update = () => {
    if (composing || input.value === lastValue) return;
    lastValue = input.value;
    onSearch(lastValue);
  };
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; update(); });
  input.addEventListener('input', event => { if (!event.isComposing) update(); });
  input.addEventListener('search', update);
}
