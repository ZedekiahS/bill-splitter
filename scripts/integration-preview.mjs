// Two isolated browser origins, one local Auth/Firestore backend. Never deploy.
// Start firebase.integration.json with project demo-bill-splitter-integration first.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectId = 'demo-bill-splitter-integration';
const root = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const assets = new Map();
// v8 preserves the app's namespaced API and adds Auth emulator support absent in v7.
for (const name of ['app', 'auth', 'firestore']) {
  const response = await fetch(`https://www.gstatic.com/firebasejs/8.10.1/firebase-${name}.js`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`SDK download failed: ${response.status}`);
  assets.set(`/__/firebase/7.18.0/firebase-${name}.js`, await response.text());
}
assets.set('/__/firebase/init.js', `firebase.initializeApp(${JSON.stringify({projectId, apiKey:'integration-only', authDomain:'localhost'})});
firebase.auth().useEmulator('http://127.0.0.1:9099', {disableWarnings:true});
firebase.firestore().useEmulator('127.0.0.1',8282);`);

for (const [email, displayName] of [['alice@example.test','Alice'],['bob@example.test','Bob']]) {
  const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=integration-only', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email,password:'Local-Test-Only-280!',displayName,returnSecureToken:true}),
  });
  const result = await response.json();
  if (!response.ok && result.error?.message !== 'EMAIL_EXISTS') throw new Error(`Local account setup failed: ${result.error?.message}`);
}
const types = {'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.ico':'image/x-icon','.png':'image/png'};
for (const port of [2804,2805]) {
  http.createServer(async (req,res) => {
    try {
      if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405);res.end();return;}
      const name = decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
      let content, type;
      if (assets.has(name)) {content=assets.get(name);type=types['.js'];}
      else {
        const target=path.resolve(root,'.'+(name==='/'?'/index.html':name));
        if(!target.startsWith(root+path.sep)||name.split('/').some(p=>p.startsWith('.'))) {res.writeHead(403);res.end();return;}
        content=await readFile(target);type=types[path.extname(target)]||'application/octet-stream';
      }
      res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:content);
    } catch {res.writeHead(404);res.end('Not found');}
  }).listen(port,'127.0.0.1',()=>console.log(`Integration client: http://127.0.0.1:${port}/index.html`));
}
