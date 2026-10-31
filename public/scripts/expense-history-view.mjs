import {t,getLanguage} from './i18n.mjs';
import {formatMoney,consumptionShares} from './ledger-core.mjs';
import {receiptMarkup} from './receipt-viewer.mjs';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const types={created:'创建账单',updated:'更正账单',payment:'确认收款','payment-reversed':'撤销收款',reversed:'撤销账单'};
export function historyMarkup(snapshot,expenseId){
  const name=id=>snapshot.members.find(member=>member.id===id)?.name||t('成员');
  const money=value=>formatMoney(value,snapshot.ledger.currency);
  const version=(record,label)=>`<section class="history-version"><h4>${t(label)}</h4><dl><dt>${t('账单名称')}</dt><dd>${escape(record.title)}</dd><dt>${t('日期')}</dt><dd>${escape(record.date)}</dd><dt>${t('金额')}</dt><dd>${money(record.amountCents)}</dd><dt>${t('垫付人')}</dt><dd>${escape(name(record.payerMemberId))}</dd><dt>${t('每个人的份额')}</dt><dd>${Object.entries(consumptionShares(record)).map(([id,cents])=>`${escape(name(id))} ${money(cents)}`).join('<br>')}</dd>${record.items?.length?`<dt>${t('消费明细')}</dt><dd>${record.items.map(item=>`${escape(item.title)} · ${money(item.amountCents)} · ${item.memberIds.map(id=>escape(name(id))).join('、')}`).join('<br>')}</dd>`:''}<dt>${t('备注')}</dt><dd class="history-note">${escape(record.note)||'—'}</dd></dl>${receiptMarkup(record.receipts)}</section>`;
  const events=snapshot.expenses.filter(expense=>!expenseId||expense.id===expenseId).flatMap(expense=>(expense.history||[]).map((event,index)=>({event,expense,index}))).sort((a,b)=>String(b.event.at).localeCompare(String(a.event.at))||b.index-a.index);
  if(!events.length)return `<p class="muted">${t('还没有操作记录。')}</p>`;
  return `<ol class="activity-list">${events.map(({event,expense})=>{
    const at=event.at?new Intl.DateTimeFormat(getLanguage()==='en'?'en-US':'zh-CN',{dateStyle:'medium',timeStyle:'medium'}).format(new Date(event.at)):t('时间未记录');
    return `<li class="activity-entry"><div class="activity-heading"><strong>${t(types[event.type]||'操作记录')}</strong><time datetime="${escape(event.at||'')}">${escape(at)}</time></div><p class="activity-actor">${escape(event.actorName)||t('操作人未记录')}${expenseId?'':` · ${escape(expense.title)}`}</p>${event.reason?`<p class="history-note">${escape(event.reason)}</p>`:''}${event.amountCents?`<p>${escape(name(event.fromMemberId))} → ${escape(name(event.toMemberId))} <strong>${money(event.amountCents)}</strong></p>${event.note?`<p class="history-note">${escape(event.note)}</p>`:''}`:''}${event.before?`<details data-history-id="${escape(event.id)}"><summary>${t('查看更正前后')}</summary><div class="history-versions">${version(event.before,'更正前')}${version(event.after,'更正后')}</div></details>`:event.after?`<details data-history-id="${escape(event.id)}"><summary>${t('查看原始账单')}</summary>${version(event.after,'原始账单')}</details>`:''}</li>`;
  }).join('')}</ol>`;
}
