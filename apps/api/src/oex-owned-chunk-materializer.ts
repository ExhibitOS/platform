// SPDX-License-Identifier: AGPL-3.0-or-later
// Inactive fixed-child ABI. The Manager owns admission, handles and cleanup;
// an ACK is neither authority nor evidence of sync, sealing or process drain.
import {closeSync,fstatSync,readSync,writeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {writeOexChunkHandles} from './oex-chunk-fd-writer.ts';

const keys=['version','kind','tenantId','resourceId','jobId','userId','requestId','leaseId','attemptId','runtimeGeneration','stageId','reservationId','reservationGeneration','archiveBytes','archiveSha256','stageDevice','stageInode','chunks','reservationDigest','sourceDigest','workerDigest','profile','format'] as const;
const ids=['tenantId','resourceId','jobId','userId','requestId','leaseId','attemptId','runtimeGeneration','stageId','reservationId','reservationGeneration'] as const;
const hashes=['archiveSha256','reservationDigest','sourceDigest','workerDigest'] as const;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hex=/^[a-f0-9]{64}$/,decimal=/^(0|[1-9][0-9]{0,23})$/;
type Chunk={device:string;inode:string;bytes:number};
type Request={attemptId:string;runtimeGeneration:string;stageId:string;reservationId:string;reservationGeneration:string;archiveBytes:number;archiveSha256:string;stageDevice:string;stageInode:string;chunks:Chunk[]};
// These bounds cover nonblocking progress/retries. Manager must still enforce
// its own deadline and reap the child if a synchronous FD call blocks.
async function retryIo(operation:()=>number,deadline:bigint){for(;;){if(process.hrtime.bigint()>=deadline)throw Error('IO_TIMEOUT');try{return operation();}catch(error){if(!(error instanceof Error)||!('code' in error)||!['EAGAIN','EWOULDBLOCK'].includes(String(error.code)))throw error;await new Promise(resolve=>setTimeout(resolve,5));}}}
async function readExactly(fd:number,length:number,deadline:bigint){const result=Buffer.alloc(length);let offset=0;while(offset<length){const count=await retryIo(()=>readSync(fd,result,offset,length-offset,null),deadline);if(!count)throw Error('CONTROL_SHORT');offset+=count;}return result;}
async function request(fd:number){
 const deadline=process.hrtime.bigint()+5_000_000_000n,length=(await readExactly(fd,4,deadline)).readUInt32BE();if(length<2||length>8192)throw Error('CONTROL_SIZE');
 const bytes=await readExactly(fd,length,deadline),end=Buffer.alloc(1);if(await retryIo(()=>readSync(fd,end,0,1,null),deadline)!==0)throw Error('CONTROL_TRAILING');
 const source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),value:unknown=JSON.parse(source);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('CONTROL_SCHEMA');
 const v=value as Record<string,unknown>;
 if(Object.keys(v).length!==keys.length||keys.some(key=>!Object.hasOwn(v,key))||v.version!==1||v.kind!=='oex-chunks-v1'||v.profile!=='bounded-file-v1'||v.format!=='1.0.0-draft.9'||ids.some(key=>typeof v[key]!=='string'||!uuid.test(v[key] as string))||hashes.some(key=>typeof v[key]!=='string'||!hex.test(v[key] as string))||typeof v.stageDevice!=='string'||!decimal.test(v.stageDevice)||typeof v.stageInode!=='string'||!decimal.test(v.stageInode)||!Number.isSafeInteger(v.archiveBytes)||Number(v.archiveBytes)<1||Number(v.archiveBytes)>512*1024*1024||!Array.isArray(v.chunks)||v.chunks.length<1||v.chunks.length>32)throw Error('CONTROL_SCHEMA');
 const chunks=v.chunks;
 for(const chunk of chunks){if(!chunk||typeof chunk!=='object'||Array.isArray(chunk)||Object.keys(chunk).sort().join(',')!=='bytes,device,inode'||typeof chunk.device!=='string'||!decimal.test(chunk.device)||typeof chunk.inode!=='string'||!decimal.test(chunk.inode)||!Number.isSafeInteger(chunk.bytes)||chunk.bytes<1||chunk.bytes>16*1024*1024)throw Error('CONTROL_SCHEMA');}
 const canonical=Object.fromEntries(keys.map(key=>[key,key==='chunks'?chunks.map((chunk:Chunk)=>({device:chunk.device,inode:chunk.inode,bytes:chunk.bytes})):v[key]]));if(source!==JSON.stringify(canonical))throw Error('CONTROL_SCHEMA');
 return {value:v as unknown as Request,digest:createHash('sha256').update(bytes).digest('hex')};
}
async function writeAll(fd:number,bytes:Buffer){const deadline=process.hrtime.bigint()+5_000_000_000n;let offset=0;while(offset<bytes.length){const count=await retryIo(()=>writeSync(fd,bytes,offset,bytes.length-offset,null),deadline);if(!count)throw Error('ACK_SHORT');offset+=count;}}
async function main(){
 const descriptorList=process.env.EXHIBITOS_OEX_MATERIALIZER_FDS;
 if(!descriptorList||descriptorList.length>175)throw Error('FD_LIST');
 const parts=descriptorList.split(',');if(parts.length<4||parts.length>35||parts.some(x=>!/^[1-9][0-9]{1,3}$/.test(x)||Number(x)<64||Number(x)>1023))throw Error('FD_LIST');
 const descriptors=parts.map(Number);if(new Set(descriptors).size!==descriptors.length)throw Error('FD_LIST');
 const [controlFd,ackFd,stageFd,...chunkFds]=descriptors as [number,number,number,...number[]];
 const control=fstatSync(controlFd,{bigint:true}),ack=fstatSync(ackFd,{bigint:true});
 if((!control.isFIFO()&&!control.isSocket())||(!ack.isFIFO()&&!ack.isSocket())||(control.dev===ack.dev&&control.ino===ack.ino))throw Error('CONTROL_FD');
 let r:Awaited<ReturnType<typeof request>>;try{r=await request(controlFd);}finally{closeSync(controlFd);}
 const v=r.value;if(chunkFds.length!==v.chunks.length)throw Error('FD_LIST');const stageStat=fstatSync(stageFd,{bigint:true});
 if(!stageStat.isFile()||stageStat.nlink>1n||stageStat.size!==0n||(stageStat.mode&0o077n)!==0n||stageStat.uid!==BigInt(process.getuid?.()??-1)||String(stageStat.dev)!==v.stageDevice||String(stageStat.ino)!==v.stageInode)throw Error('STAGE_FD');
 const stage={stat:async()=>fstatSync(stageFd,{bigint:true}),write:async(buffer:Uint8Array,offset:number,length:number,position:number)=>({bytesWritten:writeSync(stageFd,buffer,offset,length,position)})};
 const sources=chunkFds.map(fd=>({stat:async()=>fstatSync(fd,{bigint:true}),read:async(buffer:Uint8Array,offset:number,length:number,position:number)=>({bytesRead:readSync(fd,buffer,offset,length,position)})}));
 const result=await writeOexChunkHandles(sources,stage,v.chunks,v.archiveBytes,v.archiveSha256,{device:v.stageDevice,inode:v.stageInode});
 for(const fd of chunkFds)closeSync(fd);closeSync(stageFd);
 const response=Buffer.from(JSON.stringify({version:1,kind:'materialized',status:'complete',attemptId:v.attemptId,runtimeGeneration:v.runtimeGeneration,stageId:v.stageId,reservationId:v.reservationId,reservationGeneration:v.reservationGeneration,receiptSha256:r.digest,stageDevice:v.stageDevice,stageInode:v.stageInode,bytes:result.bytes,inputSha256:result.inputSha256}));
 if(response.length>8192)throw Error('ACK_SIZE');await writeAll(ackFd,response);closeSync(ackFd);
}
try{await main();}catch{process.exitCode=1;}
