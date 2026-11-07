import {mkdtemp,rm,readFile,statfs,stat} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import yauzl from 'yauzl';
import {detectedType} from '../public/scripts/receipt-files.mjs';
import {MAX_BACKUP_METADATA_BYTES,MAX_BACKUP_RECEIPT_BYTES,checkBackupMetadata} from './backup-limits.mjs';

const expired=()=>Object.assign(new Error('这份导入预览已过期，请重新选择备份文件。'),{statusCode:410});
const invalid=()=>new Error('压缩包无效，请选择原始完整账本 ZIP。');
async function cleanup(directory){
 const target=resolve(directory);if(dirname(target)!==resolve(tmpdir())||!basename(target).startsWith('bill-splitter-import-'))throw new Error('Invalid temporary directory');
 await rm(target,{recursive:true,force:true});
}
async function space(directory,bytes){
 const disk=await statfs(directory);
 if(disk.bavail*disk.bsize<bytes+64*1024*1024)throw new Error('服务器临时空间不足，无法恢复账本，请联系服务管理员。');
}
async function writeStream(stream,path,directory,limit=Infinity){
 let total=0,checked=0;
 await space(directory,0);
 await pipeline(stream,new Transform({transform(chunk,_encoding,callback){
  total+=chunk.length;
  if(total>limit)return callback(invalid());
  const verify=total-checked>=8*1024*1024;
  if(verify){checked=total;space(directory,chunk.length).then(()=>callback(null,chunk),callback);}else callback(null,chunk);
 }}),createWriteStream(path,{flags:'wx',mode:0o600}));
 return total;
}
export async function readImportFile(path,format,directory){
 if(format==='json'){
  checkBackupMetadata((await stat(path)).size);
  return {data:parse(await readFile(path)),files:new Map()};
 }
 const zip=await new Promise((resolve,reject)=>yauzl.open(path,{lazyEntries:true},(error,value)=>error?reject(invalid()):resolve(value)));
 const files=new Map(),seen=new Set();let data;
 await new Promise((resolve,reject)=>{
  let failed=false;
  const fail=error=>{if(failed)return;failed=true;zip.close();reject(error);};
  zip.on('error',()=>fail(invalid()));zip.on('end',()=>{if(!failed)resolve();});
  zip.on('entry',entry=>{(async()=>{
   const name=entry.fileName;
   if(seen.has(name)||name.includes('..')||name.startsWith('/')||name.includes('\\'))throw invalid();
   seen.add(name);
   if(name==='ledger.json'){
    checkBackupMetadata(entry.uncompressedSize);
    const stream=await open(zip,entry),chunks=[];let size=0;
    for await(const chunk of stream){size+=chunk.length;checkBackupMetadata(size);chunks.push(chunk);}
    data=parse(Buffer.concat(chunks));
   }else if(/^attachments\/[0-9]+\.(png|jpg|webp|pdf)$/.test(name)){
    if(entry.uncompressedSize<1||entry.uncompressedSize>MAX_BACKUP_RECEIPT_BYTES)throw invalid();
    const target=join(directory,randomUUID()),size=await writeStream(await open(zip,entry),target,directory,MAX_BACKUP_RECEIPT_BYTES);
    const type=detectedType(await readFile(target));if(!type||size!==entry.uncompressedSize)throw invalid();
    files.set(name,{importPath:target,size,type});
   }else if(!name.endsWith('/')&&!/^(?:[a-z-]+\.csv|README\.txt)$/.test(name))throw invalid();
   // CSV and the human-readable note are derived views; never expand them.
   if(!failed)zip.readEntry();
  })().catch(fail);});zip.readEntry();
 });
 if(!data)throw invalid();return {data,files};
}
const open=(zip,entry)=>new Promise((resolve,reject)=>zip.openReadStream(entry,(error,stream)=>error?reject(invalid()):resolve(stream)));
function parse(bytes){try{const data=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));if(data?.schemaVersion===1&&data.ledger)return data;}catch{}throw invalid();}

export function importUploads({ttl=30*60*1000}={}){
 const jobs=new Map();let receiving=0;const users=new Set();
 async function remove(token){const job=jobs.get(token);if(job){jobs.delete(token);await cleanup(job.directory);}}
 const sweep=setInterval(()=>{for(const [token,job]of jobs)if(!job.busy&&job.expires<Date.now())remove(token).catch(()=>{});},60000);sweep.unref();
 return {
  async receive(user,stream,format){
   if(!['zip','json'].includes(format))throw invalid();
   if(users.has(user.uid)||receiving>=4)throw Object.assign(new Error('正在处理其他备份，请稍后再试。'),{statusCode:429});
   users.add(user.uid);
   // At most one staged backup per account; choosing another file replaces it.
   try{
   for(const [token,job]of jobs)if(job.uid===user.uid){if(job.busy)throw new Error('账本正在导入，请等待完成。');await remove(token);}
   if(jobs.size+receiving>=8)throw Object.assign(new Error('正在处理其他备份，请稍后再试。'),{statusCode:429});
   }catch(error){users.delete(user.uid);throw error;}
   receiving++;let directory;
   try{
    directory=await mkdtemp(join(tmpdir(),'bill-splitter-import-'));
    const path=join(directory,'upload');
    await writeStream(stream,path,directory,format==='json'?MAX_BACKUP_METADATA_BYTES:Infinity);
    const archive=await readImportFile(path,format,directory);await rm(path);
    const token=randomUUID();jobs.set(token,{uid:user.uid,directory,archive,expires:Date.now()+ttl,busy:false});
    return {token,archive};
   }catch(error){if(directory)await cleanup(directory);throw error;}
   finally{users.delete(user.uid);receiving--;}
  },
  acquire(user,token){const job=jobs.get(token);if(!job||job.uid!==user.uid||job.expires<Date.now())throw expired();if(job.busy)throw Object.assign(new Error('账本正在导入，请等待完成。'),{statusCode:409});job.busy=true;return job.archive;},
  release(token){const job=jobs.get(token);if(job)job.busy=false;},
  remove,
  async close(){clearInterval(sweep);await Promise.all([...jobs.keys()].map(remove));},
 };
}
