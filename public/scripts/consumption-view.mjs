import {mountBudget,bindBudgetView} from './budget-view.mjs';
import {mergeBudgetVersions} from './personal-budget.mjs';
import {t,translateError,getLanguage} from './i18n.mjs';
import {formatMoney} from './ledger-core.mjs';
import {categories,dateRange,summarizeConsumption,comparisonPeriods,compareConsumption,monthlyHistory,checkedSum} from './expense-analytics.mjs';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const options=(entries,value)=>entries.map(([id,label])=>`<option value="${escape(id)}" ${id===value?'selected':''}>${escape(label)}</option>`).join('');
const field=(label,html)=>`<label class="form-field"><span class="field-label">${t(label)}</span>${html}</label>`;
const select=(name,entries,value)=>`<select class="form-select" data-report-filter="${name}">${options(entries,value)}</select>`;
const empty=()=>`<p class="muted report-empty">${t('这个范围还没有消费记录。')}</p>`;
const monthLabel=month=>new Intl.DateTimeFormat(getLanguage(),{year:'numeric',month:'long',timeZone:'UTC'}).format(new Date(`${month}-01T12:00:00Z`));

export function mountConsumption(target,{data,config,personal,today,onOpen,onInclusion,onSaveBudget,onReloadBudgets,onBudgetSettled,members=[]}){
  const projects=data.projects,currencies=[...new Set([...projects.map(p=>p.currency),...(personal?['CNY','USD',...(data.budgets||[]).map(b=>b.currency)]:[])])].sort();
  config.period??=personal?'month':'all';config.grain??='auto';config.scope??='all';config.view??='overview';config.year??=today.slice(0,4);
  if(!currencies.includes(config.currency))config.currency=currencies[0]||'CNY';
  if(config.ledgerId&&!projects.some(p=>p.id===config.ledgerId&&p.included&&p.currency===config.currency))config.ledgerId='';
  const currency=()=>config.currency,money=value=>formatMoney(value,currency());
  const signed=value=>`${value>0?'+':value<0?'−':''}${money(Math.abs(value))}`;
  let drill=config.drill||null,limit=config.limit||50;
  if(drill?.type==='member'&&!members.some(m=>m.id===drill.key)||drill?.type==='project'&&!projects.some(p=>p.id===drill.key&&p.included)){drill=null;config.drill=null;}
  function resetDrill(){drill=null;config.drill=null;limit=50;config.limit=50;}
  function showDetails(){if(personal)config.view='history';render();target.querySelector('#report-details')?.scrollIntoView({block:'start'});target.querySelector('#report-details h2')?.focus({preventScroll:true});}
  function renderBudget(){
    const region=target.querySelector('#personal-budget');if(!region)return;
    mountBudget(region,{data,config,today,currency:currency(),onSave:onSaveBudget,onReload:onReloadBudgets,onSettled:onBudgetSettled,onDetails:(month,unit)=>{
      config.period='custom';config.from=month+'-01';config.to=month+'-'+new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate();config.currency=unit;config.category='';config.ledgerId='';resetDrill();showDetails();
    }});
  }
  if(personal)bindBudgetView(config,budgets=>{if(budgets)data.budgets=mergeBudgetVersions(data.budgets,budgets);if(target.isConnected)renderBudget();});
  function render(){
    const included=new Set(projects.filter(p=>p.included).map(p=>p.id));
    const allRows=personal?data.rows.filter(row=>included.has(row.ledgerId)):(config.scope==='mine'?data.mineRows:data.rows);
    let report,error='',periods,comparison;
    let range=config.period==='custom'?{from:config.from||'',to:config.to||''}:dateRange(config.period,today);
    const filters={currency:currency(),category:config.category,ledgerId:config.ledgerId};
    try{
      if(personal){periods=comparisonPeriods(config.period,today,config.year);if(periods)range=periods.current;}
      const dates=allRows.map(r=>r.date).sort(),from=range.from||dates[0],to=range.to||dates.at(-1);
      const grain=personal&&config.period==='year'?'month':config.grain==='auto'?(!range.from||from&&to&&Date.parse(to)-Date.parse(from)>93*86400000?'month':'day'):config.grain;
      report=summarizeConsumption(allRows,{...filters,...range,grain});
      if(periods)comparison=compareConsumption(allRows,filters,periods);
      if(personal&&config.period==='year'){
        const months=Number(range.to.slice(5,7)),actual=new Map(report.trend.map(r=>[r.id,r.amountCents]));
        report.trend=Array.from({length:months},(_,i)=>{const id=`${config.year}-${String(i+1).padStart(2,'0')}`;return {id,amountCents:actual.get(id)||0};});
      }
    }catch(e){error=translateError(e);}
    const history=personal&&config.view==='history';
    const years=[...new Set([today.slice(0,4),config.year,...allRows.map(r=>r.date.slice(0,4)).filter(y=>y<=today.slice(0,4))])].sort().reverse();
    target.innerHTML=`${personal?`<div class="report-view-switch" role="group" aria-label="${t('消费视图')}">${[['overview','消费概览'],['history','历史明细']].map(([id,label])=>`<button class="text-link" data-report-view="${id}" aria-pressed="${config.view===id}">${t(label)}</button>`).join('')}</div>`:''}
      ${personal&&!history?'<div id="personal-budget"></div>':''}<div class="report-filters">
        ${field('时间范围',select('period',[['month',t('本月')],['last-month',t('上月')],['30-days',t('近 30 天')],['year',t(personal?'年度回顾':'今年')],['all',t('全部')],['custom',t('自定义')]],config.period))}
        ${personal&&config.period==='year'?field('年份',select('year',years.map(y=>[y,y]),config.year)):''}
        ${personal?field('币种',select('currency',currencies.map(id=>[id,id]),currency())):field('统计口径',select('scope',[['all',t('项目全部消费')],['mine',t('只看我的消费')]],config.scope))}
        ${field('分类',select('category',[['',t('全部分类')],...Object.entries(categories).map(([id,label])=>[id,t(label)])],config.category||''))}
        ${personal?field('项目／账本',select('ledgerId',[['',t('全部账本')],...projects.filter(p=>p.included&&p.currency===currency()).map(p=>[p.id,p.title])],config.ledgerId||'')):''}
        ${config.period==='custom'?field('开始日期',`<input class="form-input" type="date" data-report-filter="from" value="${escape(range.from)}">`)+field('结束日期',`<input class="form-input" type="date" data-report-filter="to" value="${escape(range.to)}">`):''}
      </div>
      ${personal?`<details class="report-scope" ${config.scopeOpen?'open':''}><summary>${t('纳入统计的账本')} · ${projects.filter(p=>p.included).length}/${projects.length}</summary>${projects.some(p=>p.restored)?`<p class="form-hint">${t('恢复的副本默认不计入，避免重复累计。此选择只影响你的统计。')}</p>`:''}<div class="scope-ledgers">${projects.map(p=>`<label class="member-check"><input type="checkbox" data-report-inclusion="${escape(p.id)}" ${p.included?'checked':''}><span>${escape(p.title)} · ${escape(p.currency)}${p.restored?' · '+t('恢复的副本'):''}${p.status==='archived'?' · '+t('已归档'):''}</span></label>`).join('')}</div><p class="form-error" id="scope-error" role="alert" hidden></p></details>`:''}
      ${error?`<p class="form-error" role="alert">${escape(error)}</p>`:`
        <div class="report-total"><div><span>${t(personal||config.scope==='mine'?'我的实际消费':'项目总开销')} · ${escape(currency())}</span><strong>${money(report.totalCents)}</strong></div><p>${t('{count}笔账单',{count:report.expenseCount})}${range.from||range.to?' · '+escape([range.from,range.to].filter(Boolean).join(' — ')):''}</p></div>
        ${!history?`${comparison?comparisonMarkup(comparison,periods):''}${personal&&config.period==='year'?`<h2 class="annual-title">${t('{year} 年消费回顾',{year:escape(config.year)})}</h2>`:''}${charts(report)}${personal?`<button class="button secondary report-history-link" data-history-link>${t('查看历史明细')}</button>`:''}`:''}
        ${history||!personal?`<section class="panel report-details" id="report-details"><div class="section-heading"><h2 tabindex="-1">${t(history?'历史明细':'消费明细')}</h2><button class="text-link" data-clear-drill ${drill?'':'hidden'}>${t('显示全部明细')}</button></div><div id="report-rows"></div></section>`:''}`}`;
    if(personal&&!history)renderBudget();
    if(report&&(history||!personal))renderRows(report,range,history);
    target.querySelector('.comparison-categories')?.addEventListener('toggle',event=>{config.changesOpen=event.target.open;});
    target.querySelector('.report-scope')?.addEventListener('toggle',event=>{config.scopeOpen=event.target.open;});
    target.querySelectorAll('[data-report-view]').forEach(button=>button.onclick=()=>{config.view=button.dataset.reportView;resetDrill();render();target.querySelector(`[data-report-view="${config.view}"]`).focus();});
    target.querySelector('[data-history-link]')?.addEventListener('click',()=>{resetDrill();showDetails();});
    target.querySelectorAll('input[data-report-filter]').forEach(input=>input.oninput=()=>{input.dataset.editing='true';});
    target.querySelectorAll('[data-report-filter]').forEach(input=>input.onchange=()=>{const name=input.dataset.reportFilter;config[name]=input.value;if(name==='currency')config.ledgerId='';resetDrill();render();target.querySelector(`[data-report-filter="${name}"]`)?.focus();});
    target.querySelectorAll('[data-drill]').forEach(button=>button.onclick=()=>{
      drill={type:button.dataset.drill,key:button.dataset.key,label:button.dataset.drill==='trend'?button.dataset.key:button.querySelector('.report-bar-label').textContent};config.drill=drill;limit=50;config.limit=50;showDetails();
    });
    target.querySelectorAll('[data-compare-period]').forEach(button=>button.onclick=()=>{
      const selected=periods[button.dataset.comparePeriod];config.period='custom';config.from=selected.from;config.to=selected.to;resetDrill();showDetails();
    });
    target.querySelectorAll('[data-category-change]').forEach(button=>button.onclick=()=>{
      config.category=button.dataset.categoryChange;resetDrill();showDetails();
    });
    target.querySelector('[data-clear-drill]')?.addEventListener('click',()=>{resetDrill();render();});
    target.querySelector('[data-report-more]')?.addEventListener('click',()=>{limit+=50;config.limit=limit;render();});
    target.querySelectorAll('[data-report-inclusion]').forEach(input=>input.onchange=async()=>{
      const id=input.dataset.reportInclusion,p=projects.find(p=>p.id===id),next=input.checked;input.disabled=true;
      try{await onInclusion(id,next);p.included=next;config.ledgerId='';resetDrill();config.scopeOpen=true;render();}
      catch(e){input.checked=p.included;const error=target.querySelector('#scope-error');if(error){error.textContent=translateError(e);error.hidden=false;}}
      finally{input.disabled=false;}
    });
  }
  function renderRows(report,range,history){
    let rows=report.rows;
    if(drill?.type==='category')rows=rows.filter(r=>r.category===drill.key);
    if(drill?.type==='project')rows=rows.filter(r=>r.ledgerId===drill.key);
    if(drill?.type==='trend')rows=rows.filter(r=>r.date.startsWith(drill.key));
    if(drill?.type==='member')rows=summarizeConsumption(members.find(m=>m.id===drill.key).rows,{currency:currency(),...range,category:config.category}).rows;
    rows=[...rows].sort((a,b)=>b.date.localeCompare(a.date));
    const visible=rows.slice(0,limit);
    const rowMarkup=(r,index)=>`<button class="report-row" data-report-row="${index}"><span><strong>${escape(r.title)}</strong><small>${escape(r.date)} · ${t(categories[r.category])}${personal?' · '+escape(r.ledgerTitle):''}${r.itemIndex!==null?' · '+escape(r.itemTitle):''}</small></span><strong>${money(r.amountCents)}</strong></button>`;
    let content=empty();
    if(rows.length){
      if(history){
        let index=0;
        const totals=new Map(monthlyHistory(rows).map(group=>[group.month,group]));
        content=monthlyHistory(visible).map(group=>{const total=totals.get(group.month);return `<section class="history-month" aria-label="${escape(monthLabel(group.month))}"><header><h3>${escape(monthLabel(group.month))}</h3><span>${t('{count}笔账单',{count:total.expenseCount})} · <strong>${money(total.totalCents)}</strong></span></header>${group.rows.map(r=>rowMarkup(r,index++)).join('')}</section>`;}).join('');
      }else content=visible.map(rowMarkup).join('');
    }
    target.querySelector('#report-rows').innerHTML=(drill?`<p class="form-hint">${escape(drill.label)} · ${money(checkedSum(rows.map(r=>r.amountCents)))}</p>`:'')+content+(rows.length>limit?`<button class="button secondary" data-report-more>${t('显示更多')} · ${t('已显示 {shown} / {count} 条',{shown:visible.length,count:rows.length})}</button>`:'');
    target.querySelectorAll('[data-report-row]').forEach(el=>el.onclick=()=>onOpen(visible[Number(el.dataset.reportRow)]));
  }
  function comparisonMarkup(result,periods){
    const change=result.deltaCents===0?t('与上一期持平'):t(result.deltaCents>0?'比上一期多 {amount}':'比上一期少 {amount}',{amount:money(Math.abs(result.deltaCents))});
    return `<section class="report-comparison" aria-label="${t(config.period==='year'?'年度对比':'月度对比')}"><h2>${t(config.period==='year'?'年度对比':'月度对比')}</h2><div class="comparison-periods">${[['current','本期'],['previous','上一期']].map(([key,label])=>`<button data-compare-period="${key}" class="comparison-period"><span>${t(label)} · ${escape(periods[key].from)} — ${escape(periods[key].to)}</span><strong>${money(result[key].totalCents)}</strong><small>${t('查看明细')}</small></button>`).join('')}</div><p class="comparison-change">${change}${result.percent!==null&&result.deltaCents!==0?' · '+(Math.abs(result.percent)<0.1?t('不足 0.1%'):Math.abs(result.percent).toFixed(1)+'%'):''}</p>${result.percent===null?`<p class="form-hint">${t('上一期无消费记录，暂不计算变化比例。')}</p>`:''}${result.changes.length?`<details class="comparison-categories" ${config.changesOpen?'open':''}><summary>${t('变化最大的分类（前三项）')}</summary><div class="category-changes">${result.changes.slice(0,3).map(row=>`<button class="report-row" data-category-change="${row.id}"><span><strong>${t(categories[row.id])}</strong><small>${t('上一期 {previous} · 本期 {current}',{previous:money(row.previousCents),current:money(row.currentCents)})}</small></span><strong>${signed(row.deltaCents)}</strong></button>`).join('')}</div></details>`:''}</section>`;
  }
  function charts(report){
    const trendMax=Math.max(1,...report.trend.map(r=>r.amountCents));
    return `<div class="report-grid"><section class="panel report-trend"><div class="section-heading"><h2>${t('消费趋势')}</h2>${personal&&config.period==='year'?'':field('按时间汇总',select('grain',[['auto',t('自动')],['day',t('按日')],['month',t('按月')],['year',t('按年')]],config.grain))}</div>${personal&&config.period==='year'?annualChart(report):report.trend.length?`<div class="trend-scroll" tabindex="0" role="group" aria-label="${t('消费趋势')}"><div class="trend-chart">${report.trend.map(row=>`<button class="trend-column" data-drill="trend" data-key="${escape(row.id)}" aria-label="${escape(row.id)} · ${money(row.amountCents)}"><span class="trend-number">${money(row.amountCents)}</span><span class="trend-track"><span style="height:${row.amountCents?Math.max(1,row.amountCents/trendMax*100):0}%"></span></span><span>${escape(row.id)}</span></button>`).join('')}</div></div>`:empty()}</section><section class="panel"><h2>${t('钱花在哪里')}</h2>${bars(report.categories,'category',id=>t(categories[id]),report.totalCents)}</section></div>${personal?`<section class="panel report-projects"><h2>${t('项目消费对比')}</h2>${bars(report.projects,'project',id=>projects.find(p=>p.id===id)?.title||'',report.totalCents)}</section>`:config.scope==='all'?`<section class="panel report-projects"><h2>${t('每个人的实际消费')}</h2>${bars(members.map(m=>({id:m.id,amountCents:summarizeConsumption(m.rows,{currency:currency(),...(config.period==='custom'?{from:config.from||'',to:config.to||''}:dateRange(config.period,today)),category:config.category}).totalCents})).filter(m=>m.amountCents>0).sort((a,b)=>b.amountCents-a.amountCents),'member',id=>members.find(m=>m.id===id).name,report.totalCents)}</section>`:''}`;
  }
  function annualChart(report){
    const max=Math.max(1,...report.trend.map(r=>r.amountCents));
    return `<div class="annual-chart" role="group" aria-label="${t('消费趋势')}">${report.trend.map(row=>{
      const label=new Intl.DateTimeFormat(getLanguage(),{month:'short',timeZone:'UTC'}).format(new Date(`${row.id}-01T12:00:00Z`));
      return `<button class="annual-month" data-drill="trend" data-key="${row.id}" aria-label="${row.id} · ${money(row.amountCents)}"><span>${escape(label)}</span><span class="annual-track"><span style="width:${row.amountCents/max*100}%"></span></span><strong>${money(row.amountCents)}</strong></button>`;
    }).join('')}</div>`;
  }
  function bars(rows,type,label,total){const max=Math.max(1,...rows.map(r=>r.amountCents));return rows.length?`<div class="report-bars">${rows.map(row=>`<button class="report-bar" data-drill="${type}" data-key="${escape(row.id)}"><span class="report-bar-label">${escape(label(row.id))}</span><strong>${money(row.amountCents)} <small>${total?(row.amountCents/total*100).toFixed(1):'0'}%</small></strong><span class="report-bar-track"><span style="width:${row.amountCents/max*100}%"></span></span></button>`).join('')}</div>`:empty();}
  render();
}
