import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { authService,HttpError } from './auth.mjs';
import { ledgerService } from './ledgers.mjs';
import { exportStream } from './ledger-export.mjs';
import {importUploads} from './import-uploads.mjs';

export async function buildApp({pool,origins,production=false,registration=true,trustProxy=false,logger=false}){
  const allowed=new Set(origins);
  if(!allowed.size||production&&[...allowed].some(origin=>!origin.startsWith('https://')))throw new Error('Production requires explicit HTTPS PUBLIC_ORIGINS.');
  const app=Fastify({logger,trustProxy,bodyLimit:10*1024*1024,requestTimeout:300000});
  const auth=authService(pool,{secure:production,registration}),ledgers=ledgerService(pool);
  const uploads=importUploads();
  app.addContentTypeParser('application/octet-stream',(_request,stream,done)=>done(null,stream));
  app.addHook('onClose',()=>uploads.close());
  app.setErrorHandler((error,request,reply)=>{
    let status=error.statusCode||500,message='服务暂时不可用，请稍后重试。';
    if(error instanceof HttpError)message=error.message;
    else if(error.name==='Error'&&/^[\u4e00-\u9fff]/.test(error.message)){status=error.statusCode||(/只有|只能|不是该账本|其他账号/.test(error.message)?403:400);message=error.message;}
    else if(status===413)message='文件或请求太大，请减小后重试。';
    else if(status<500||error instanceof TypeError){status=400;message='请求内容无效，请刷新后重试。';}
    if(status>=500)request.log.error({code:error.code},'Request failed');
    reply.code(status).send({error:{message}});
  });
  app.addHook('onRequest',async(request,reply)=>{
    reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','same-origin')
      .header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
      .header('X-Frame-Options','DENY');
    if(production)reply.header('Strict-Transport-Security','max-age=31536000');
    const pathname=request.url.split('?')[0];
    if(pathname.startsWith('/api/')){
      reply.header('Cache-Control','no-store').header('Vary','Cookie');
      if(!['GET','HEAD'].includes(request.method)){
        if(!allowed.has(request.headers.origin)||request.headers['x-bill-splitter']!=='1')throw new HttpError(403,'请求来源无效，请重新打开应用。');
        const uploading=pathname==='/api/ledger-import/upload';
        if(!request.headers['content-type']?.startsWith(uploading?'application/octet-stream':'application/json'))throw new HttpError(415,'请求内容无效，请刷新后重试。');
      }
      if(!pathname.startsWith('/api/auth/')&&pathname!=='/api/health'){
        request.user=await auth.current(request);if(!request.user)throw new HttpError(401,'登录已过期，请重新登录。');
      }
    }else if(pathname.startsWith('/__/')||pathname.endsWith('.html')&&!['/app.html','/index.html'].includes(pathname)){
      throw new HttpError(404,'页面不存在。');
    }
  });
  app.get('/api/health',async()=>{await pool.query('SELECT 1');return {ok:true};});
  app.get('/api/auth/me',async request=>({user:await auth.current(request)}));
  app.post('/api/auth/register',(request,reply)=>auth.register(request,reply));
  app.post('/api/auth/login',(request,reply)=>auth.login(request,reply));
  app.post('/api/auth/logout',(request,reply)=>auth.logout(request,reply));
  app.post('/api/auth/recovery-code',request=>auth.recoveryCode(request));
  app.post('/api/auth/recover',(request,reply)=>auth.recover(request,reply));
  const result=async promise=>({result:(await promise)??null});
  app.get('/api/ledgers',request=>ledgers.list(request.user));
  app.post('/api/personal-budget',request=>result(ledgers.savePersonalBudget(request.user,request.body,request.headers['idempotency-key'])));
  app.get('/api/personal-consumption',request=>ledgers.personalConsumption(request.user));
  app.get('/api/ledger-updates',request=>ledgers.updates(request.user));
  app.post('/api/ledgers',request=>result(ledgers.create(request.user,request.body,request.headers['idempotency-key'])));
  app.post('/api/ledger-import/preview',{bodyLimit:29*1024*1024},request=>ledgers.previewImport(request.user,request.body));
  app.post('/api/ledger-import',{bodyLimit:29*1024*1024},request=>result(ledgers.import(request.user,request.body,request.headers['idempotency-key'])));
  app.post('/api/ledger-import/upload',async request=>{
    const {token,archive}=await uploads.receive(request.user,request.body,request.query.format);
    try{return {...await ledgers.previewArchive(request.user,archive),token};}
    catch(error){await uploads.remove(token);throw error;}
  });
  app.post('/api/ledger-import/commit',async request=>{
    const payload=request.body;if(!payload||typeof payload.token!=='string')throw new HttpError(400,'请选择备份文件。');
    let acquired=false,committed=false;
    try{
      const id=await ledgers.importUploaded(request.user,payload,request.headers['idempotency-key'],()=>{const archive=uploads.acquire(request.user,payload.token);acquired=true;return archive;});
      committed=true;return {result:id};
    }finally{if(acquired){if(committed)await uploads.remove(payload.token);else uploads.release(payload.token);}}
  });
  app.get('/api/ledgers/:id/export',async(request,reply)=>{
    const snapshot=await ledgers.get(request.user,request.params.id);
    const archive=exportStream(snapshot,id=>ledgers.receipt(request.user,request.params.id,id));
    reply.header('Content-Type','application/zip').header('Content-Disposition',`attachment; filename="ledger.zip"; filename*=UTF-8''${encodeURIComponent(archive.fileName).replace(/'/g,'%27')}`);
    return reply.send(archive.stream);
  });
  app.get('/api/ledgers/:id',request=>ledgers.get(request.user,request.params.id));
  app.post('/api/ledgers/:id/commands',request=>result(ledgers.command(request.user,request.params.id,request.body,request.headers['idempotency-key'])));
  app.get('/api/invites/:token',request=>ledgers.invitation(request.user,request.params.token));
  app.post('/api/invites/:token/commands',request=>result(ledgers.invitationCommand(request.user,request.params.token,request.body,request.headers['idempotency-key'])));
  app.get('/api/ledgers/:id/receipts/:receiptId',async(request,reply)=>{
    const file=await ledgers.receipt(request.user,request.params.id,request.params.receiptId);
    reply.header('Content-Type',file.mime).header('Content-Disposition',`${file.mime==='application/pdf'?'attachment':'inline'}; filename="receipt"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g,'%27')}`);
    return reply.send(file.bytes);
  });
  // Unversioned entry points and modules must revalidate after an application update.
  await app.register(staticFiles,{root:fileURLToPath(new URL('../public/',import.meta.url)),index:'index.html',cacheControl:false,setHeaders:reply=>reply.header('Cache-Control','no-cache')});
  return app;
}
