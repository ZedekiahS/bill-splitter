import {expensePieces,validateDate} from './ledger-core.mjs';

export const categories={uncategorized:'未分类',food:'餐饮',lodging:'住宿',transport:'交通',entertainment:'门票／娱乐',shopping:'购物',household:'日用',other:'其他'};
export const projectTypes={general:'共同开销',trip:'旅行',meal:'聚餐',home:'合租',personal:'个人日常'};
export function categoryId(value){
  if(value==null||value==='')return 'uncategorized';
  if(!Object.hasOwn(categories,value))throw new Error('请选择有效的消费分类。');
  return value;
}
export function projectData(payload={}){
  const projectType=payload.projectType||'general';
  if(!Object.hasOwn(projectTypes,projectType))throw new Error('请选择有效的账本类型。');
  const startDate=payload.startDate?validateDate(payload.startDate):null,endDate=payload.endDate?validateDate(payload.endDate):null;
  if(startDate&&endDate&&endDate<startDate)throw new Error('结束日期不能早于开始日期。');
  const activityStatus=payload.activityStatus||'ongoing';
  if(!['ongoing','ended'].includes(activityStatus))throw new Error('活动状态无效。');
  return {projectType,startDate,endDate,activityStatus};
}
export function checkedSum(values){
  const result=values.reduce((n,v)=>n+BigInt(v),0n);
  if(result>BigInt(Number.MAX_SAFE_INTEGER)||result<0n)throw new Error('统计金额超出支持范围，请缩小范围。');
  return Number(result);
}
// Each row is one attributable consumption amount, never a repayment.
export function consumptionRows(snapshot,{uid,memberId,personal=false}={}){
  const ledger=snapshot.ledger,myIds=new Set(snapshot.members.filter(m=>memberId?m.id===memberId:uid&&m.uid===uid).map(m=>m.id));
  return snapshot.expenses.filter(e=>e.status==='active').flatMap(e=>{
    const pieces=expensePieces(e);
    return pieces.map(piece=>({ledgerId:ledger.id,ledgerTitle:ledger.title,expenseId:e.id,title:e.title,itemTitle:piece.title,itemIndex:piece.itemIndex,date:e.date,currency:ledger.currency,category:categoryId(piece.category),amountCents:personal?checkedSum(Object.entries(piece.shares).filter(([id])=>myIds.has(id)).map(([,v])=>v)):piece.amountCents})).filter(row=>row.amountCents>0);
  });
}
export function personalData(snapshots,uid){
  const visible=snapshots.filter(s=>s.ledger.memberUids.includes(uid));
  return {projects:visible.map(({ledger:l})=>({id:l.id,title:l.title,currency:l.currency,projectType:l.projectType||'general',status:l.status||'active',restored:Boolean(l.importedFrom),included:l.analyticsInclusions?.[uid]??!l.importedFrom})),rows:visible.flatMap(s=>consumptionRows(s,{uid,personal:true}))};
}
export function dateRange(period,today){
  validateDate(today);const [year,month]=today.split('-').map(Number);
  if(period==='all')return {from:'',to:''};
  if(period==='year')return {from:`${year}-01-01`,to:today};
  if(period==='last-month'){const last=new Date(Date.UTC(year,month-1,0));return {from:last.toISOString().slice(0,8)+'01',to:last.toISOString().slice(0,10)};}
  if(period==='30-days'){const date=new Date(today+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-29);return {from:date.toISOString().slice(0,10),to:today};}
  return {from:today.slice(0,8)+'01',to:today};
}
export function summarizeConsumption(rows,{currency,from='',to='',category='',ledgerId='',grain='day'}={}){
  if(from)validateDate(from);if(to)validateDate(to);
  if(from&&to&&from>to)throw new Error('结束日期不能早于开始日期。');
  if(!currency)throw new Error('请选择记账币种。');
  const filtered=rows.filter(r=>r.currency===currency&&(!from||r.date>=from)&&(!to||r.date<=to)&&(!category||r.category===category)&&(!ledgerId||r.ledgerId===ledgerId));
  const group=key=>{const map=new Map();for(const row of filtered){const id=key(row);map.set(id,checkedSum([map.get(id)||0,row.amountCents]));}return [...map].map(([id,amountCents])=>({id,amountCents}));};
  return {rows:filtered,totalCents:checkedSum(filtered.map(r=>r.amountCents)),expenseCount:new Set(filtered.map(r=>JSON.stringify([r.ledgerId,r.expenseId]))).size,
    trend:group(r=>r.date.slice(0,grain==='year'?4:grain==='month'?7:10)).sort((a,b)=>a.id.localeCompare(b.id)),categories:group(r=>r.category).sort((a,b)=>b.amountCents-a.amountCents),projects:group(r=>r.ledgerId).sort((a,b)=>b.amountCents-a.amountCents)};
}

// Compare elapsed calendar periods, never an unfinished month with a full month.
export function comparisonPeriods(period,today,year=today.slice(0,4)){
  validateDate(today);
  const endOfMonth=(y,m)=>new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
  const monthStart=date=>date.slice(0,8)+'01';
  if(period==='month'||period==='last-month'){
    const current=dateRange(period,today),previousEnd=endOfMonth(Number(current.from.slice(0,4)),Number(current.from.slice(5,7))-1);
    const previousTo=period==='month'?previousEnd.slice(0,8)+String(Math.min(Number(today.slice(8)),Number(previousEnd.slice(8)))).padStart(2,'0'):previousEnd;
    return {current,previous:{from:monthStart(previousEnd),to:previousTo}};
  }
  if(period==='year'){
    const y=String(year);validateDate(`${y}-01-01`);
    if(y>today.slice(0,4))throw new Error('请选择当前或以前的年份。');
    const current={from:`${y}-01-01`,to:y===today.slice(0,4)?today:`${y}-12-31`};
    const prior=String(Number(y)-1).padStart(4,'0'),month=Number(current.to.slice(5,7));
    const day=Math.min(Number(current.to.slice(8)),Number(endOfMonth(Number(prior),month).slice(8)));
    return {current,previous:{from:`${prior}-01-01`,to:`${prior}-${current.to.slice(5,7)}-${String(day).padStart(2,'0')}`}};
  }
  return null;
}

export function compareConsumption(rows,filters,periods){
  const current=summarizeConsumption(rows,{...filters,...periods.current});
  const previous=summarizeConsumption(rows,{...filters,...periods.previous});
  const deltaCents=current.totalCents-previous.totalCents;
  const ids=new Set([...current.categories,...previous.categories].map(r=>r.id));
  const changes=[...ids].map(id=>({id,currentCents:current.categories.find(r=>r.id===id)?.amountCents||0,previousCents:previous.categories.find(r=>r.id===id)?.amountCents||0})).map(r=>({...r,deltaCents:r.currentCents-r.previousCents})).filter(r=>r.deltaCents!==0).sort((a,b)=>Math.abs(b.deltaCents)-Math.abs(a.deltaCents));
  return {current,previous,deltaCents,percent:previous.totalCents?deltaCents/previous.totalCents*100:null,changes};
}

export function monthlyHistory(rows){
  const groups=new Map();
  for(const row of [...rows].sort((a,b)=>b.date.localeCompare(a.date))){
    const month=row.date.slice(0,7);if(!groups.has(month))groups.set(month,[]);groups.get(month).push(row);
  }
  return [...groups].map(([month,items])=>({month,rows:items,totalCents:checkedSum(items.map(r=>r.amountCents)),expenseCount:new Set(items.map(r=>JSON.stringify([r.ledgerId,r.expenseId]))).size}));
}
