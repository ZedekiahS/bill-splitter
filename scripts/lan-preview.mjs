// Explicit LAN-only test entry point. Never points at the user's regular database.
import {networkInterfaces} from 'node:os';
import {database} from '../server/database.mjs';
import {buildApp} from '../server/app.mjs';
const host=process.env.LAN_HOST,port=Number(process.env.LAN_PORT||2807);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('LAN_PORT must be an integer between 1024 and 65535.');
const addresses=Object.values(networkInterfaces()).flat().filter(Boolean);
if(!addresses.some(row=>row.address===host&&!row.internal&&row.family==='IPv4')||
  !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host||''))throw new Error('Set LAN_HOST to this computer\'s private Wi-Fi/LAN IPv4 address.');
const target=new URL(process.env.TEST_DATABASE_URL);
if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw new Error('A dedicated local _test database is required.');
process.env.TZ||='Asia/Shanghai';
const pool=database(target.href),origin=`http://${host}:${port}`;
const app=await buildApp({pool,origins:[origin],production:false,registration:true});
await app.listen({host,port});
console.log(`Phone test URL: ${origin}/index.html`);
console.log('Synthetic test accounts only. Keep this process running during phone testing; do not run test:api against the same database.');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.close();await pool.end();process.exit(0);});
