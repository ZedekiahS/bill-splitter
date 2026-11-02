import yauzl from 'yauzl';
export function unzip(buffer){return new Promise((resolve,reject)=>{
  yauzl.fromBuffer(buffer,{lazyEntries:true},(error,zip)=>{
    if(error)return reject(error);const files=new Map();
    zip.on('error',reject);zip.on('end',()=>resolve(files));
    zip.on('entry',entry=>zip.openReadStream(entry,(error,stream)=>{
      if(error)return reject(error);const chunks=[];stream.on('error',reject);stream.on('data',chunk=>chunks.push(chunk));
      stream.on('end',()=>{files.set(entry.fileName,Buffer.concat(chunks));zip.readEntry();});
    }));zip.readEntry();
  });
});}
