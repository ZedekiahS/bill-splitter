// Allowlisted diagnostics only: never log request URLs, headers, bodies or raw
// errors (database errors can include submitted values and query details).
export function errorDiagnostic(error){
 const names=new Set(['Error','TypeError','RangeError','SyntaxError','URIError','AggregateError','DatabaseError','FastifyError']);
 const type=names.has(error.name)?error.name:'Error';
 const code=/^(?:[0-9A-Z]{5}|FST_ERR_[A-Z_]+)$/.test(error.code||'')?error.code:undefined;
 const sites=[...new Set(String(error.stack||'').match(/(?:server|public[\\/]scripts)[\\/][A-Za-z0-9_.-]+\.mjs:\d+:\d+/g)||[])].slice(0,5);
 return {type,code,sites};
}
export function loggerOptions(options={}){
 return {...options,serializers:{req:()=>undefined,res:()=>undefined,err:errorDiagnostic}};
}
export function installRequestLogging(app){
 app.addHook('onRequest',async(request,reply)=>{reply.header('X-Request-Id',request.id);});
 app.addHook('onResponse',async(request,reply)=>{
  request.log.info({event:'request.completed',method:request.method,route:request.routeOptions.url||'unmatched',status:reply.statusCode,durationMs:reply.elapsedTime},'Request completed');
 });
}
