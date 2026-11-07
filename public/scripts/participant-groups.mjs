export const nameKey=value=>String(value).trim().toLocaleLowerCase();
export function parseMemberNames(value){
  if(typeof value!=='string'||value.length>5000)throw new Error('名单过长，请分批添加。');
  const names=value.split(/[\n\r,，、;；\t]+/).map(name=>name.trim()).filter(Boolean),unique=new Map();
  if(!names.length)throw new Error('请先填写成员名单。');
  for(const name of names){if(name.length>40)throw new Error('每个名字不能超过 40 个字。');if(!unique.has(nameKey(name)))unique.set(nameKey(name),name);}
  if(unique.size>50)throw new Error('每次最多添加 50 位成员，请分批处理。');
  return {names:[...unique.values()],duplicates:names.length-unique.size};
}
export function previewMemberNames(names,members){
  return names.map(name=>{const matches=members.filter(m=>m.status!=='inactive'&&nameKey(m.name)===nameKey(name));return {name,matches,memberId:matches.length===1?matches[0].id:matches.length?'':'new',expectedMatches:matches.map(m=>m.id).sort()};});
}
const conflict=()=>{throw Object.assign(new Error('成员名单已变化，请重新核对后再添加。'),{statusCode:409});};
// Validate the entire request before creating anyone, including concurrent name changes.
export function prepareMemberBatch(entries,members){
  if(!Array.isArray(entries)||!entries.length||entries.length>50)throw new Error('每次请选择 1 至 50 位成员。');
  const seen=new Set();
  return entries.map(row=>{
    if(!row||typeof row.name!=='string'||!row.name.trim()||row.name.trim().length>40)throw new Error('每个名字需填写 1 至 40 个字。');
    const name=row.name.trim(),key=nameKey(name);if(seen.has(key))throw new Error('名单中有重复名字，请先核对。');seen.add(key);
    const matches=Object.entries(members).filter(([,m])=>m.status!=='inactive'&&nameKey(m.name)===key).map(([id])=>id).sort();
    if(row.memberId){const m=typeof row.memberId==='string'&&Object.hasOwn(members,row.memberId)?members[row.memberId]:null;if(!m||m.status==='inactive'||nameKey(m.name)!==key)conflict();return {memberId:row.memberId};}
    if(row.create!==true||!Array.isArray(row.expectedMatches)||row.expectedMatches.some(id=>typeof id!=='string')||JSON.stringify(matches)!==JSON.stringify([...row.expectedMatches].sort()))conflict();
    return {name};
  });
}
export function groupData(payload,members,prior=null){
  const name=typeof payload?.name==='string'?payload.name.trim():'';
  if(!name||name.length>40)throw new Error('组合名称需填写 1 至 40 个字。');
  const ids=payload.memberIds;
  if(!Array.isArray(ids)||!ids.length||ids.length>50||new Set(ids).size!==ids.length)throw new Error('每个组合请选择 1 至 50 位不同成员。');
  if(ids.some(id=>typeof id!=='string'||!Object.hasOwn(members,id)||members[id].status==='inactive'&&!prior?.memberIds.includes(id)))throw new Error('组合中有已停用或已移除的成员，请重新选择。');
  return {name,memberIds:[...ids]};
}
