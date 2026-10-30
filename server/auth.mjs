import { randomBytes,randomUUID,createHash,scrypt as scryptCallback,timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { transaction } from './database.mjs';
const scrypt=promisify(scryptCallback);
export const hash=value=>createHash('sha256').update(value).digest('hex');
export class HttpError extends Error {constructor(status,message){super(message);this.statusCode=status;}}
const fail=(message,status=400)=>{throw new HttpError(status,message);};
function email(value){
  if(typeof value!=='string'||value.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(value.trim()))fail('请输入有效的邮箱地址。');
  return value.trim().toLowerCase();
}
function password(value){if(typeof value!=='string'||value.length<10||value.length>128)fail('密码需为 10–128 个字符。');return value;}
async function derive(value,salt){return scrypt(value,salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024});}
async function encode(value){const salt=randomBytes(16).toString('hex');return `${salt}:${(await derive(value,salt)).toString('hex')}`;}
async function matches(value,encoded){const [salt,key]=encoded.split(':');const actual=await derive(value,salt);return timingSafeEqual(actual,Buffer.from(key,'hex'));}
const dummySalt='00000000000000000000000000000000';
export function authService(pool,{secure=false,registration=true}={}) {
  const cookieName=secure?'__Host-bs_session':'bs_session';
  const cookie=(value,age)=>`${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure?'; Secure':''}`;
  const token=request=>(request.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
  async function limit(key,max){
    const {rows}=await pool.query(`INSERT INTO bs_auth_limits(key,count,expires_at) VALUES($1,1,now()+interval '15 minutes')
      ON CONFLICT(key) DO UPDATE SET count=CASE WHEN bs_auth_limits.expires_at<now() THEN 1 ELSE bs_auth_limits.count+1 END,
      expires_at=CASE WHEN bs_auth_limits.expires_at<now() THEN now()+interval '15 minutes' ELSE bs_auth_limits.expires_at END RETURNING count`,[hash(key)]);
    if(rows[0].count>max)fail('尝试次数过多，请稍后再试。',429);
  }
  async function session(client,userId,reply){
    const raw=randomBytes(32).toString('base64url');
    await client.query("INSERT INTO bs_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",[hash(raw),userId]);
    reply.header('Set-Cookie',cookie(raw,7*86400));
  }
  return {
    async current(request){
      const raw=token(request);if(!/^[A-Za-z0-9_-]{43}$/.test(raw))return null;
      const {rows}=await pool.query(`SELECT u.id AS uid,u.display_name AS "displayName",i.subject AS email
        FROM bs_sessions s JOIN bs_users u ON u.id=s.user_id LEFT JOIN bs_identities i ON i.user_id=u.id AND i.provider='email'
        WHERE s.token_hash=$1 AND s.expires_at>now()`,[hash(raw)]);
      return rows[0]||null;
    },
    async register(request,reply){
      if(!registration)fail('暂未开放注册。',403);
      await limit('register:'+request.ip,10);
      const body=request.body||{},address=email(body.email),secret=password(body.password);
      if(typeof body.displayName!=='string'||!body.displayName.trim()||body.displayName.trim().length>40)fail('请填写不超过 40 个字的称呼。');
      const user={uid:randomUUID(),displayName:body.displayName.trim(),email:address},encoded=await encode(secret);
      try {await transaction(pool,async client=>{
        await client.query('INSERT INTO bs_users(id,display_name) VALUES($1,$2)',[user.uid,user.displayName]);
        await client.query("INSERT INTO bs_identities(provider,subject,user_id,password_hash) VALUES('email',$1,$2,$3)",[address,user.uid,encoded]);
        await session(client,user.uid,reply);
      });}catch(error){if(error.code==='23505')fail('这个邮箱已注册，请直接登录。',409);throw error;}
      return {user};
    },
    async login(request,reply){
      await limit('login-ip:'+request.ip,60);
      const body=request.body||{},address=email(body.email);
      await limit('login-email:'+address,20);
      const secret=password(body.password);
      const {rows}=await pool.query("SELECT user_id,password_hash FROM bs_identities WHERE provider='email' AND subject=$1",[address]);
      const identity=rows[0];
      const valid=identity?await matches(secret,identity.password_hash):(await derive(secret,dummySalt),false);
      if(!valid)fail('邮箱或密码不正确，请重试。',401);
      await transaction(pool,async client=>{
        await client.query('DELETE FROM bs_sessions WHERE token_hash=$1',[hash(token(request))]);
        await session(client,identity.user_id,reply);
      });
      const {rows:users}=await pool.query('SELECT id AS uid,display_name AS "displayName" FROM bs_users WHERE id=$1',[identity.user_id]);
      return {user:{...users[0],email:address}};
    },
    async logout(request,reply){await pool.query('DELETE FROM bs_sessions WHERE token_hash=$1',[hash(token(request))]);reply.header('Set-Cookie',cookie('',0));return {ok:true};},
  };
}
