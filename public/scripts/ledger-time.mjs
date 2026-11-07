export function timeZone(value='Asia/Shanghai') {
  if(typeof value!=='string'||value.length>80)throw new Error('请选择有效的账本时区。');
  try{return new Intl.DateTimeFormat('en',{timeZone:value}).resolvedOptions().timeZone;}
  catch{throw new Error('请选择有效的账本时区。');}
}
export function calendarDate(zone='Asia/Shanghai',at=new Date()){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:timeZone(zone),year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at);
 const get=key=>parts.find(p=>p.type===key).value;
 return `${get('year')}-${get('month')}-${get('day')}`;
}
