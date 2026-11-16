import {LogController} from 'fastify';
import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// Only installed application modules can be reported as diagnostic locations.
const sourceFiles=new Map();
for(const directory of ['server/','public/scripts/']){
 const root=new URL('../'+directory,import.meta.url);
 for(const file of readdirSync(root).filter(name=>name.endsWith('.mjs'))){
  const url=new URL(file,root),label=directory+file;
  sourceFiles.set(url.href,label);sourceFiles.set(fileURLToPath(url),label);
 }
}

// Allowlisted diagnostics only: never log request URLs, headers, bodies or raw
// errors (database errors can include submitted values and query details).
export function errorDiagnostic(error={}){
 const names=new Set(['Error','TypeError','RangeError','SyntaxError','URIError','AggregateError','DatabaseError','FastifyError']);
 const type=names.has(error.name)?error.name:'Error';
 const code=/^(?:[0-9A-Z]{5}|FST_ERR_[A-Z_]+|ERR_STREAM_PREMATURE_CLOSE|ECONNRESET)$/.test(error.code||'')?error.code:undefined;
 const stack=typeof error.stack==='string'?error.stack:'';
 const header=error.message?`${error.name}: ${error.message}`:error.name;
 const sites=[];
 // Strip the *entire* message, including embedded newlines and forged frames.
 // Nonstandard/modified stacks have no reliably identifiable boundary: omit them.
 if(typeof header==='string'&&stack.startsWith(header+'\n')){
  for(const line of stack.slice(header.length+1).split('\n')){
   const frame=/^\s+at (?:[^()]* \()?(.+):(\d+):(\d+)\)?$/.exec(line);
   const source=frame&&sourceFiles.get(frame[1]);
   if(source){const site=`${source}:${frame[2]}:${frame[3]}`;if(!sites.includes(site))sites.push(site);}
   if(sites.length===5)break;
  }
 }
 return {type,code,sites};
}
export function loggerOptions(options={}){
 return {...options,serializers:{req:()=>undefined,res:()=>undefined,err:errorDiagnostic}};
}
const interrupted=new WeakSet();
const sourceErrors=new WeakMap();
function logInterrupted(error,request,reply,outcome){
 if(interrupted.has(reply))return;
 interrupted.add(reply);
 request.log.warn({event:'request.failed',outcome,method:request.method,route:request.routeOptions.url||'unmatched',
  status:reply.statusCode,headersSent:reply.raw.headersSent,durationMs:reply.elapsedTime,
  ...(error?{error:errorDiagnostic(error)}:{})},'Response interrupted');
}
export class RequestLogController extends LogController{
 constructor(){super({disableRequestLogging:true});}
 streamError(error,request,reply){
  // A reset in the source (e.g. PostgreSQL) is not a client cancellation.
  // Source errors are observed before Fastify handles/destroys the response.
  const sourceFailed=sourceErrors.get(reply)===error;
  const disconnected=reply.raw.destroyed||request.raw.aborted;
  logInterrupted(error,request,reply,sourceFailed||!disconnected?'failed':'aborted');
 }
}
export function installRequestLogging(app){
 app.addHook('onRequest',async(request,reply)=>{
  reply.header('X-Request-Id',request.id);
  reply.raw.once('close',()=>{
   // Let the stream controller retain the original error first. This fallback
   // also covers disconnected responses that never reach onResponse.
   if(reply.raw.writableFinished===false)setImmediate(()=>logInterrupted(null,request,reply,'aborted'));
  });
 });
 app.addHook('onSend',async(_request,reply,payload)=>{
  if(typeof payload?.pipe==='function'&&typeof payload.once==='function'){
   payload.once('error',error=>sourceErrors.set(reply,error));
  }
  return payload;
 });
 app.addHook('onResponse',async(request,reply)=>{
  if(interrupted.has(reply))return;
  request.log.info({event:'request.completed',method:request.method,route:request.routeOptions.url||'unmatched',status:reply.statusCode,durationMs:reply.elapsedTime},'Request completed');
 });
}
