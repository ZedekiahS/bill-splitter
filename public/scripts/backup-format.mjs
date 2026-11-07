export const MAX_BACKUP_METADATA_BYTES=64*1024*1024;
export function checkBackupMetadata(bytes){
 if(bytes>MAX_BACKUP_METADATA_BYTES)throw new Error('账本记录过大，当前服务无法处理这份备份，请联系服务管理员。');
}
