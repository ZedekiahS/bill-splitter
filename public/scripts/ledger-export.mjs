// Stable, provider-independent export format. Login sessions and invite tokens are excluded.
import {consumptionShares, memberBalances} from './ledger-core.mjs';
export function csv(rows) {
  const cell=value=>{
    if(typeof value==='number')return String(value);
    let text=String(value??'');
    if(/^[\s]*[=+@-]/.test(text))text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  };
  return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
export function exportFileName(title){return String(title||'ledger').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/,'').slice(0,80)||'ledger';}
export function ledgerExport(snapshot,exportedAt=new Date().toISOString()) {
  const s=structuredClone(snapshot),files=new Map();
  const memberNames=new Map(s.members.map(member=>[member.id,member.name]));
  const name=id=>memberNames.get(id)||id;
  for(const expense of s.expenses){
    for(const version of [expense,...(expense.history||[]).flatMap(event=>[event.before,event.after].filter(Boolean))]){
      version.receipts=(version.receipts||[]).map(file=>{
        const key=file.id||file.dataUrl;
        if(!key)throw new Error('附件记录不完整，无法导出。');
        if(!files.has(key)){
          const extension=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','application/pdf':'pdf'})[file.type];
          if(!extension)throw new Error('附件记录不完整，无法导出。');
          files.set(key,{...file,path:`attachments/${String(files.size+1).padStart(5,'0')}.${extension}`});
        }
        return {id:file.id||null,name:file.name,type:file.type,size:file.size,path:files.get(key).path};
      });
    }
  }
  const {id,title,currency,createdAt,ownerUid,status='active',archivedAt=null,statusHistory=[],timeZone='Asia/Shanghai',timeZoneHistory=[]}=s.ledger;
  const data={schemaVersion:1,exportedAt,ledger:{id,title,currency,createdAt,ownerUid,status,archivedAt,statusHistory,timeZone,timeZoneHistory},
    members:s.members.map(({id,name,uid,createdAt,status='active',nameHistory=[],statusHistory=[]})=>({id,name,uid,createdAt,status,nameHistory,statusHistory})),expenses:s.expenses,payments:s.payments,
    templates:s.templates||[],occurrences:s.occurrences||[]};
  const tables={};
  tables['expenses.csv']=csv([['expense_id','date','title','currency','amount_cents','payer_id','payer_name','status','note','created_by','created_at','version','attachments'],...s.expenses.map(e=>[e.id,e.date,e.title,currency,e.amountCents,e.payerMemberId,name(e.payerMemberId),e.status,e.note,e.createdByUid,e.createdAt,e.version||1,e.receipts.map(f=>f.path).join(';')])]);
  tables['shares.csv']=csv([['expense_id','member_id','member_name','share_cents','repaid_cents','is_payer'],...s.expenses.flatMap(e=>Object.entries(consumptionShares(e)).map(([id,cents])=>[e.id,id,name(id),cents,e.repaid?.[id]||0,id===e.payerMemberId?'yes':'no']))]);
  tables['items.csv']=csv([['expense_id','item_number','title','amount_cents','participant_ids'],...s.expenses.flatMap(e=>(e.items||[]).map((item,i)=>[e.id,i+1,item.title,item.amountCents,item.memberIds.join(';')]))]);
  tables['payments.csv']=csv([['payment_id','expense_id','date','from_member','to_member','amount_cents','type','reverses_id','reversed_by','note','created_by','created_at'],...s.payments.map(p=>[p.id,p.expenseId,p.date,p.fromMemberId,p.toMemberId,p.amountCents,p.type,p.reversesId,p.reversedBy,p.note,p.createdByUid,p.createdAt])]);
  tables['members.csv']=csv([['member_id','name','balance_cents'],...memberBalances(s).map(m=>[m.memberId,m.name,m.balanceCents])]);
  tables['history.csv']=csv([['expense_id','event_id','event_type','actor_uid','actor_name','at','reason','amount_cents','from_member','to_member','before','after'],...s.expenses.flatMap(e=>(e.history||[]).map(h=>[e.id,h.id,h.type,h.actorUid,h.actorName,h.at,h.reason||h.note,h.amountCents??'',h.fromMemberId,h.toMemberId,h.before?JSON.stringify(h.before):'',h.after?JSON.stringify(h.after):'']))]);
  tables['attachments.csv']=csv([['path','original_name','mime','bytes','receipt_id'],...[...files.values()].map(f=>[f.path,f.name,f.type,f.size,f.id])]);
  tables['ledger-status.csv']=csv([['status','actor_uid','actor_name','at'],...statusHistory.map(h=>[h.status,h.actorUid,h.actorName,h.at])]);
  tables['ledger.json']=JSON.stringify(data,null,2);
  tables['README.txt']=`Bill Splitter — ${title}\nExported at / 导出时间: ${exportedAt}\nSchema version / 格式版本: 1\nCurrency / 币种: ${currency}\n\nledger.json: 完整账本数据，含账单、成员、还款、操作历史、周期模板和已处理期次。\nCSV: expenses 账单；shares 分摊；items 消费项目；payments 还款与撤销；members 净余额；history 操作历史；ledger-status 归档与恢复；attachments 附件索引。\n金额列以分（amount_cents / share_cents / repaid_cents / balance_cents）为单位，100 分为一个货币单位。已撤销账单不计入余额，不能直接将所有账单行相加。\n附件包含当前及历史版本；JSON 中的 path 对应压缩包内文件，原文件名见附件索引。文件夹中的编号避免同名覆盖。\n草稿只存在原设备，不在此导出包中。此文件是数据导出，不含登录凭据和邀请链接，也不会执行付款。\n\nledger.json contains all saved financial records, history, templates and occurrences. CSV monetary values use integer cents. Reversed expenses do not count toward balances. Attachment paths are relative to this archive and include historical versions. Local drafts, credentials and invitation links are excluded. No payment is executed.\nCSV text beginning with spreadsheet formula characters is prefixed with an apostrophe; exact original text remains in JSON.\n可通过账本选项导入为独立账本；其他成员需重新认领。 / Import from ledger options to create a separate ledger. Other members must be invited again.\n`;
  return {data,tables,files:[...files.values()],fileName:exportFileName(title)+'.zip'};
}
