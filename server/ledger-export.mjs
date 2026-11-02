import {ZipFile} from 'yazl';
import {Readable} from 'node:stream';
import {ledgerExport} from '../public/scripts/ledger-export.mjs';

export function exportStream(snapshot,readReceipt){
  const bundle=ledgerExport(snapshot),zip=new ZipFile();
  zip.on('error',error=>zip.outputStream.destroy(error));
  for(const [path,text] of Object.entries(bundle.tables))zip.addBuffer(Buffer.from(text),path);
  for(const file of bundle.files)zip.addReadStreamLazy(file.path,{size:file.size,compress:false},callback=>{
    readReceipt(file.id).then(row=>callback(null,Readable.from([row.bytes])),callback);
  });
  zip.end();
  return {stream:zip.outputStream,fileName:bundle.fileName};
}
