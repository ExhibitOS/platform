// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';

type Identity={dev:bigint;ino:bigint;size:bigint;mtimeNs:bigint;ctimeNs:bigint;isFile():boolean};
type Source={stat(options:{bigint:true}):Promise<Identity>;read(buffer:Uint8Array,offset:number,length:number,position:number):Promise<{bytesRead:number}>};
type Stage={stat(options:{bigint:true}):Promise<Identity>;write(buffer:Uint8Array,offset:number,length:number,position:number):Promise<{bytesWritten:number}>};
type Expected={device:string;inode:string;bytes:number};
const CHUNK=16*1024*1024,MAX=512*1024*1024,BUFFER=1024*1024,hex=/^[a-f0-9]{64}$/,decimal=/^(0|[1-9][0-9]{0,23})$/;
const same=(a:Identity,b:Identity)=>a.isFile()&&b.isFile()&&a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;

/** Inactive core: the owner supplies already-opened source handles in the
 * authorized job order and a fresh non-append stage. This does not prove
 * reservation authority, exclusive writes, process drain, fsync or recovery.
 * The returned digest is for input bytes, not proof of the staged file. The
 * owner must sync and independently hash the retained stage before use.
 * On every error the owner must retain the stage until safe reconciliation. */
export async function writeOexChunkHandles(sources:readonly Source[],stage:Stage,expected:readonly Expected[],archiveBytes:number,archiveSha256:string,stageIdentity:{device:string;inode:string}){
 if(!Array.isArray(sources)||!Array.isArray(expected)||!Number.isSafeInteger(archiveBytes)||archiveBytes<1||archiveBytes>MAX||typeof archiveSha256!=='string'||!hex.test(archiveSha256)||sources.length!==Math.ceil(archiveBytes/CHUNK)||expected.length!==sources.length||!stageIdentity||typeof stageIdentity.device!=='string'||!decimal.test(stageIdentity.device)||typeof stageIdentity.inode!=='string'||!decimal.test(stageIdentity.inode))throw Error('OEX_CHUNK_INPUT');
 const handles=[...sources],slots=expected.map((want,index)=>{if(!want||typeof want.device!=='string'||!decimal.test(want.device)||typeof want.inode!=='string'||!decimal.test(want.inode)||want.bytes!==Math.min(CHUNK,archiveBytes-index*CHUNK))throw Error('OEX_CHUNK_INPUT');return {device:want.device,inode:want.inode,bytes:want.bytes};}),target={device:stageIdentity.device,inode:stageIdentity.inode};
 const initial=await stage.stat({bigint:true});if(!initial.isFile()||initial.size!==0n||String(initial.dev)!==target.device||String(initial.ino)!==target.inode)throw Error('OEX_CHUNK_STAGE');
 const digest=createHash('sha256'),buffer=Buffer.alloc(BUFFER);let total=0;
 for(let index=0;index<handles.length;index++){
  const source=handles[index]!,want=slots[index]!,size=want.bytes;
  const before=await source.stat({bigint:true});if(!before.isFile()||String(before.dev)!==want.device||String(before.ino)!==want.inode||before.size!==BigInt(size)||before.dev===initial.dev&&before.ino===initial.ino)throw Error('OEX_CHUNK_SOURCE');
  let offset=0;while(offset<size){const requested=Math.min(buffer.length,size-offset),{bytesRead}=await source.read(buffer,0,requested,offset);if(!Number.isSafeInteger(bytesRead)||bytesRead<1||bytesRead>requested)throw Error('OEX_CHUNK_SOURCE');digest.update(buffer.subarray(0,bytesRead));let written=0;while(written<bytesRead){const result=await stage.write(buffer,written,bytesRead-written,total+written);if(!Number.isSafeInteger(result.bytesWritten)||result.bytesWritten<1||result.bytesWritten>bytesRead-written)throw Error('OEX_CHUNK_STAGE');written+=result.bytesWritten;}offset+=bytesRead;total+=bytesRead;}
  if(!same(before,await source.stat({bigint:true})))throw Error('OEX_CHUNK_SOURCE');
 }
 const final=await stage.stat({bigint:true});if(total!==archiveBytes||digest.digest('hex')!==archiveSha256)throw Error('OEX_CHUNK_DIGEST');if(!final.isFile()||final.dev!==initial.dev||final.ino!==initial.ino||final.size!==BigInt(total))throw Error('OEX_CHUNK_STAGE');return {bytes:total,inputSha256:archiveSha256};
}
