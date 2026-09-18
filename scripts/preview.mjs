// Loopback-only preview. Demo mode never loads Firebase or sends account data.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root=path.resolve(fileURLToPath(new URL('../public/',import.meta.url)));
const port=Number(process.env.BILL_SPLITTER_PORT || 2801);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon'};
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://127.0.0.1');
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
    if(url.pathname.startsWith('/__/firebase/')){res.writeHead(302,{Location:`https://shex-billsplitter.web.app${url.pathname}`});res.end();return;}
    const name=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
    const target=path.resolve(root,'.'+name);
    if(!target.startsWith(root+path.sep)&&target!==root || name.split('/').some(part=>part.startsWith('.'))){res.writeHead(403);res.end();return;}
    if(!(await stat(target)).isFile())throw new Error('not found');
    const bytes=await readFile(target);
    res.writeHead(200,{'Content-Type':types[path.extname(target)] || 'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(req.method==='HEAD'?undefined:bytes);
  }catch {res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Bill Splitter preview: http://127.0.0.1:${port}/app.html?demo=1`));
