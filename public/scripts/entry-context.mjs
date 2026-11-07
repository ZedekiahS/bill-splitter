// Carry only the user's reusable choices into a distinct new expense.
export function continuationOptions(payload,{splitType,participantIds,percentages={},percentEdited=[]}){
 const ids=[...new Set(participantIds)];
 return {participantIds:ids,continuation:{payerMemberId:payload.payerMemberId,date:payload.date,splitType,
  ...(splitType==='percent'?{percentages:Object.fromEntries(ids.map(id=>[id,percentages[id]??'0'])),percentEdited:percentEdited.filter(id=>ids.includes(id))}:{})}};
}
export function memberEntryMatch(members,name){
 const query=name.trim().toLocaleLowerCase();
 const exact=members.filter(m=>m.status!=='inactive'&&m.name.trim().toLocaleLowerCase()===query);
 return !query?{action:'empty'}:exact.length===1?{action:'select',member:exact[0]}:exact.length>1?{action:'choose',members:exact}:{action:'create'};
}
export function assignItemMember(items,memberId,index,checked){
 const next=items.map((item,i)=>({...item,memberIds:i===index?(checked?[...new Set([...item.memberIds,memberId])]:item.memberIds.filter(id=>id!==memberId)):[...item.memberIds]}));
 if(new Set(next.flatMap(item=>item.memberIds)).size>50)throw new Error('已选 50 人，请先取消一位再选择。');
 return next;
}
