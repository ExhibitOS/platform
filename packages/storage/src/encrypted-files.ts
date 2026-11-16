// SPDX-License-Identifier: AGPL-3.0-or-later
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {constants} from 'node:fs';
import {open,lstat,type FileHandle} from 'node:fs/promises';
import {Transform,Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
const MAGIC=Buffer.from('EXBK001\0'),HEADER=20,TAG=16;
export interface EncryptedFile {bytes:number;sha256:string;cipherBytes:number;cipherSha256:string}
function keyCheck(key:Uint8Array,aad:string){if(key.length!==32||!aad||aad.length>2048)throw Error('BACKUP_CRYPTO_CONFIG');}
function track(limit=Number.MAX_SAFE_INTEGER){const digest=createHash('sha256');let bytes=0;return {stream:new Transform({transform(chunk:Buffer,_encoding,done){bytes+=chunk.length;if(bytes>limit){done(Error('BACKUP_FILE_LIMIT'));return;}digest.update(chunk);done(null,chunk);}}),result:()=>({bytes,sha256:digest.digest('hex')})};}
function sink(file:FileHandle,start=0){let position=start;return new Writable({write(chunk:Buffer,_encoding,done){void(async()=>{let offset=0;while(offset<chunk.length){const result=await file.write(chunk,offset,chunk.length-offset,position);if(result.bytesWritten<1)throw Error('BACKUP_WRITE_FAILED');offset+=result.bytesWritten;position+=result.bytesWritten;}})().then(()=>done(),done);}});}
async function regular(path:string){const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const stat=await file.stat();if(!stat.isFile()||stat.nlink!==1||stat.size<1)throw Error('BACKUP_FILE_INVALID');return {file,stat};}catch(error){await file.close();throw error;}}
export async function hashBackupFile(path:string){const {file}=await regular(path),digest=createHash('sha256');let bytes=0;try{for await(const chunk of file.createReadStream({autoClose:true})){bytes+=chunk.length;digest.update(chunk);}return {bytes,sha256:digest.digest('hex')};}finally{await file.close();}}
/** Unique random nonce per file; full128-bit tag and role/archive-bound AAD. */
export async function encryptBackupFile(source:string,destination:string,key:Uint8Array,aad:string,expected?:{bytes:number;sha256:string}):Promise<EncryptedFile>{
 keyCheck(key,aad);const input=await regular(source);let output:FileHandle|undefined;
 try{
  if(expected&&(!Number.isSafeInteger(expected.bytes)||expected.bytes<1||!/^[a-f0-9]{64}$/.test(expected.sha256)||input.stat.size!==expected.bytes||(input.stat.mode&0o077)!==0))throw Error('BACKUP_SOURCE_INVALID');
  output=await open(destination,'wx',0o600);
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce,{authTagLength:TAG});cipher.setAAD(Buffer.from(aad));
  const written=await output.write(Buffer.concat([MAGIC,nonce]),0,HEADER,0);if(written.bytesWritten!==HEADER)throw Error('BACKUP_WRITE_FAILED');const plain=track(expected?.bytes);
  await pipeline(input.file.createReadStream({autoClose:true}),plain.stream,cipher,sink(output,HEADER));
  const result=plain.result();const after=expected?await lstat(source):input.stat;if(expected&&(result.bytes!==expected.bytes||result.sha256!==expected.sha256||after.ino!==input.stat.ino||after.dev!==input.stat.dev||after.size!==input.stat.size||after.mtimeMs!==input.stat.mtimeMs||after.ctimeMs!==input.stat.ctimeMs))throw Error('BACKUP_SOURCE_CHANGED');if((await output.write(cipher.getAuthTag(),0,TAG,HEADER+result.bytes)).bytesWritten!==TAG)throw Error('BACKUP_WRITE_FAILED');await output.sync();
  return {...result,...await hashBackupFile(destination).then(v=>({cipherBytes:v.bytes,cipherSha256:v.sha256}))};
 }catch{throw Error('BACKUP_ENCRYPT_FAILED');}finally{await input.file.close();await output?.close();}
}
/** Authenticate/hash all decrypted bytes before a caller can use the resulting file. */
export async function decryptBackupFile(source:string,destination:string,key:Uint8Array,aad:string,expected?:EncryptedFile){
 keyCheck(key,aad);const input=await regular(source);let output;
 try{
  const size=input.stat.size;if(size<=HEADER+TAG)throw Error('BACKUP_FILE_INVALID');
  if(expected){const actual=await hashBackupFile(source);if(actual.bytes!==expected.cipherBytes||actual.sha256!==expected.cipherSha256)throw Error('BACKUP_CIPHER_INTEGRITY');}
  const header=Buffer.alloc(HEADER),tag=Buffer.alloc(TAG);if((await input.file.read(header,0,HEADER,0)).bytesRead!==HEADER||(await input.file.read(tag,0,TAG,size-TAG)).bytesRead!==TAG)throw Error('BACKUP_FILE_INVALID');
  if(!header.subarray(0,MAGIC.length).equals(MAGIC))throw Error('BACKUP_VERSION_UNSUPPORTED');
  const cipher=createDecipheriv('aes-256-gcm',key,header.subarray(MAGIC.length),{authTagLength:TAG});cipher.setAAD(Buffer.from(aad));cipher.setAuthTag(tag);
  output=await open(destination,'wx',0o600);const plain=track(expected?.bytes);
  await pipeline(input.file.createReadStream({start:HEADER,end:size-TAG-1,autoClose:true}),cipher,plain.stream,sink(output));
  const result=plain.result();if(expected&&(result.bytes!==expected.bytes||result.sha256!==expected.sha256))throw Error('BACKUP_PLAIN_INTEGRITY');await output.sync();return result;
 }catch{throw Error('BACKUP_DECRYPT_FAILED');}finally{await input.file.close();await output?.close();}
}

/** Same EXB envelope for a bounded private configuration already in memory. */
export async function encryptSmallBackupFile(
 data:Uint8Array, destination:string, key:Uint8Array, aad:string, maxBytes:number,
):Promise<EncryptedFile>{
 keyCheck(key,aad);
 if(data.length<1||data.length>maxBytes)throw Error('BACKUP_FILE_LIMIT');
 const {length:bytes}=data,sha256=createHash('sha256').update(data).digest('hex');
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce,{authTagLength:TAG});
 cipher.setAAD(Buffer.from(aad));
 const sealed=Buffer.concat([MAGIC,nonce,cipher.update(data),cipher.final(),cipher.getAuthTag()]);
 const output=await open(destination,'wx',0o600);
 try{
  await output.writeFile(sealed);
  await output.sync();
 }finally{await output.close();}
 return {bytes,sha256,cipherBytes:sealed.length,cipherSha256:createHash('sha256').update(sealed).digest('hex')};
}

/** The caller owns and erases the returned bytes. No unauthenticated plaintext leaves memory. */
export async function decryptSmallBackupFile(
 source:string,key:Uint8Array,aad:string,maxBytes:number,expected?:EncryptedFile,cipherSha256=expected?.cipherSha256,
):Promise<Buffer>{
 keyCheck(key,aad);
 const {file,stat}=await regular(source);
 let plain:Buffer|undefined;
 try{
  const size=stat.size;
  if(size<=HEADER+TAG||size>maxBytes+HEADER+TAG||expected&&size!==expected.cipherBytes)throw Error('BACKUP_FILE_LIMIT');
  const sealed=Buffer.alloc(size);
  let offset=0;
  while(offset<size){
   const {bytesRead}=await file.read(sealed,offset,size-offset,offset);
   if(!bytesRead)throw Error('BACKUP_FILE_INVALID');
   offset+=bytesRead;
  }
  const current=await file.stat();
  if(current.size!==size||current.mtimeMs!==stat.mtimeMs||current.ctimeMs!==stat.ctimeMs||
     !sealed.subarray(0,MAGIC.length).equals(MAGIC)||cipherSha256&&createHash('sha256').update(sealed).digest('hex')!==cipherSha256)throw Error('BACKUP_CIPHER_INTEGRITY');
  const decipher=createDecipheriv('aes-256-gcm',key,sealed.subarray(MAGIC.length,HEADER),{authTagLength:TAG});
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(sealed.subarray(size-TAG));
  plain=decipher.update(sealed.subarray(HEADER,size-TAG));
  const tail=decipher.final();
  try{
   if(tail.length||expected&&(plain.length!==expected.bytes||createHash('sha256').update(plain).digest('hex')!==expected.sha256))throw Error('BACKUP_PLAIN_INTEGRITY');
  }finally{tail.fill(0);}
 }catch(error){plain?.fill(0);await file.close().catch(()=>{});throw error;}
 await file.close().catch(error=>{plain.fill(0);throw error;});
 return plain;
}
