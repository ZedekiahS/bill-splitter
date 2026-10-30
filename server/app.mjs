import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { authService,HttpError } from './auth.mjs';
import { ledgerService } from './ledgers.mjs';

export async function buildApp({pool,origins,production=false,registration=true,trustProxy=false,logger=false}){
  const allowed=new Set(origins);
  if(!allowed.size||production&&[...allowed].some(origin=>!origin.startsWith('https://')))throw new Error('Production requires explicit HTTPS PUBLIC_ORIGINS.');
  const app=Fastify({logger,trustProxy,bodyLimit:1024*1024,requestTimeout:30000});
  const auth=authService(pool,{secure:production,registration}),ledgers=ledgerService(pool);
  app.setErrorHandler((error,request,reply)=>{
    let status=error.statusCode||500,message='服务暂时不可用，请稍后重试。';
    if(error instanceof HttpError)message=error.message;
    else if(error.name==='Error'&&/^[\u4e00-\u9fff]/.test(error.message)){status=/只有|只能|不是该账本|其他账号/.test(error.message)?403:400;message=error.message;}
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
        if(!request.headers['content-type']?.startsWith('application/json'))throw new HttpError(415,'请求内容无效，请刷新后重试。');
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
  const result=async promise=>({result:(await promise)??null});
  app.get('/api/ledgers',request=>ledgers.list(request.user));
  app.post('/api/ledgers',request=>result(ledgers.create(request.user,request.body,request.headers['idempotency-key'])));
  app.get('/api/ledgers/:id',request=>ledgers.get(request.user,request.params.id));
  app.post('/api/ledgers/:id/commands',request=>result(ledgers.command(request.user,request.params.id,request.body,request.headers['idempotency-key'])));
  app.get('/api/invites/:token',request=>ledgers.invitation(request.user,request.params.token));
  app.post('/api/invites/:token/commands',request=>result(ledgers.invitationCommand(request.user,request.params.token,request.body,request.headers['idempotency-key'])));
  app.get('/api/ledgers/:id/receipts/:receiptId',async(request,reply)=>{
    const file=await ledgers.receipt(request.user,request.params.id,request.params.receiptId);
    reply.header('Content-Type',file.mime).header('Content-Disposition',`${file.mime==='application/pdf'?'attachment':'inline'}; filename="receipt"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g,'%27')}`);
    return reply.send(file.bytes);
  });
  await app.register(staticFiles,{root:fileURLToPath(new URL('../public/',import.meta.url)),index:'index.html',cacheControl:false});
  return app;
}
