// Work in hundredths of a percent; never change a manually edited share.
export function completePercentages(ids,values,edited=[]){
  const manual=new Set(edited),automatic=ids.filter(id=>!manual.has(id));
  if(!automatic.length)return {...values};
  let used=0;
  for(const id of ids.filter(id=>manual.has(id))){
    const raw=String(values[id]??'').trim();
    if(!/^\d+(?:\.\d{1,2})?$/.test(raw)||Number(raw)>100)return null;
    used+=Math.round(Number(raw)*100);
  }
  if(used>10000)return null;
  const remaining=10000-used,base=Math.floor(remaining/automatic.length),extra=remaining%automatic.length;
  return {...values,...Object.fromEntries(automatic.map((id,index)=>[id,((base+(index<extra?1:0))/100).toFixed(2)]))};
}
