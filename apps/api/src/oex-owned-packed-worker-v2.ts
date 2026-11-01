// SPDX-License-Identifier: AGPL-3.0-or-later
// Inactive fixed-child ABI. Manager must own the inherited handles, independently
// authorize the receipt and retain uncertain stages; this worker never publishes.
import {closeSync,fstatSync,readSync,writeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {preparePackedOexV2} from './oex-packed-worker-v2-core.ts';

const keys=['version','kind','tenantId','resourceId','jobId','userId','requestId','leaseId','attemptId','runtimeGeneration','stageId','reservationId','reservationGeneration','archiveBytes','archiveSha256','capacity','inputDevice','inputInode','outputDevice','outputInode','reservationDigest','sourceDigest','workerDigest','profile','format'] as const;
const ids=['tenantId','resourceId','jobId','userId','requestId','leaseId','attemptId','runtimeGeneration','stageId','reservationId','reservationGeneration'] as const;
const hashes=['archiveSha256','reservationDigest','sourceDigest','workerDigest'] as const;
const decimals=['inputDevice','inputInode','outputDevice','outputInode'] as const;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hex=/^[a-f0-9]{64}$/;
type Request={version:2;kind:'oex-packed-v2';archiveBytes:number;archiveSha256:string;capacity:number;inputDevice:string;inputInode:string;outputDevice:string;outputInode:string;attemptId:string;runtimeGeneration:string;reservationId:string;reservationGeneration:string} & Record<string,unknown>;
// The Manager's external timeout and actual reap cover blocking FD syscalls.
async function retryIo(operation:()=>number,deadline:bigint){for(;;){if(process.hrtime.bigint()>=deadline)throw Error('IO_TIMEOUT');try{return operation();}catch(error){if(!(error instanceof Error)||!('code' in error)||!['EAGAIN','EWOULDBLOCK'].includes(String(error.code)))throw error;await new Promise(resolve=>setTimeout(resolve,5));}}}
async function readExactly(fd:number,length:number,deadline:bigint){const result=Buffer.alloc(length);let offset=0;while(offset<length){const count=await retryIo(()=>readSync(fd,result,offset,length-offset,null),deadline);if(!count)throw Error('CONTROL_SHORT');offset+=count;}return result;}
async function request(fd:number){
 const deadline=process.hrtime.bigint()+5_000_000_000n,length=(await readExactly(fd,4,deadline)).readUInt32BE();if(length<2||length>8192)throw Error('CONTROL_SIZE');const bytes=await readExactly(fd,length,deadline),end=Buffer.alloc(1);if(await retryIo(()=>readSync(fd,end,0,1,null),deadline)!==0)throw Error('CONTROL_TRAILING');
 const source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),value:unknown=JSON.parse(source);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('CONTROL_SCHEMA');const v=value as Record<string,unknown>;
 if(Object.keys(v).length!==keys.length||keys.some(key=>!Object.hasOwn(v,key))||v.version!==2||v.kind!=='oex-packed-v2'||v.profile!=='bounded-file-v1'||v.format!=='1.0.0-draft.9'||ids.some(key=>typeof v[key]!=='string'||!uuid.test(v[key] as string))||hashes.some(key=>typeof v[key]!=='string'||!hex.test(v[key] as string))||decimals.some(key=>typeof v[key]!=='string'||!/^(0|[1-9][0-9]{0,23})$/.test(v[key] as string))||!Number.isSafeInteger(v.archiveBytes)||Number(v.archiveBytes)<1||Number(v.archiveBytes)>512*1024*1024||!Number.isSafeInteger(v.capacity)||Number(v.capacity)<0||Number(v.capacity)>512*1024*1024)throw Error('CONTROL_SCHEMA');
 if(source!==JSON.stringify(Object.fromEntries(keys.map(key=>[key,v[key]]))))throw Error('CONTROL_SCHEMA');return {value:v as Request,digest:createHash('sha256').update(bytes).digest('hex')};
}
async function writeAll(fd:number,bytes:Buffer){const deadline=process.hrtime.bigint()+5_000_000_000n;let offset=0;while(offset<bytes.length){const count=await retryIo(()=>writeSync(fd,bytes,offset,bytes.length-offset,null),deadline);if(!count)throw Error('OUTPUT_SHORT');offset+=count;}}
async function main(){
 const text=process.env.EXHIBITOS_OEX_PACKED_V2_FDS;if(!text||text.length>19)throw Error('FD_LIST');const parts=text.split(',');if(parts.length!==4||parts.some(x=>!/^[1-9][0-9]{1,3}$/.test(x)||Number(x)<64||Number(x)>1023))throw Error('FD_LIST');const fds=parts.map(Number);if(new Set(fds).size!==4)throw Error('FD_LIST');const [controlFd,ackFd,inputFd,outputFd]=fds as [number,number,number,number],controlStat=fstatSync(controlFd,{bigint:true});if(!controlStat.isFIFO()&&!controlStat.isSocket())throw Error('CONTROL_FD');
 let r:Awaited<ReturnType<typeof request>>;try{r=await request(controlFd);}finally{closeSync(controlFd);}
 const inputStat=fstatSync(inputFd,{bigint:true}),outputStat=fstatSync(outputFd,{bigint:true}),ackStat=fstatSync(ackFd,{bigint:true}),v=r.value;if(v.sourceDigest!==v.archiveSha256)throw Error('SOURCE_DIGEST');
 if(!inputStat.isFile()||!outputStat.isFile()||!ackStat.isFIFO()&&!ackStat.isSocket()||controlStat.dev===ackStat.dev&&controlStat.ino===ackStat.ino||String(inputStat.dev)!==v.inputDevice||String(inputStat.ino)!==v.inputInode||String(outputStat.dev)!==v.outputDevice||String(outputStat.ino)!==v.outputInode||inputStat.dev===outputStat.dev&&inputStat.ino===outputStat.ino||outputStat.size!==0n||outputStat.nlink>1n||(outputStat.mode&0o077n)!==0n||outputStat.uid!==BigInt(process.getuid?.()??-1))throw Error('FD_IDENTITY');
 const input={stat:async()=>fstatSync(inputFd,{bigint:true}),read:async(buffer:Uint8Array,offset:number,length:number,position:number)=>({bytesRead:readSync(inputFd,buffer,offset,length,position)})};
 const output={write:async(buffer:Uint8Array,offset:number,length:number,position:number)=>({bytesWritten:writeSync(outputFd,buffer,offset,length,position)})};
 const spec=await import('@exhibitos/spec') as typeof import('@exhibitos/spec') & {withOexFileHandle?:Parameters<typeof preparePackedOexV2>[3]};if(typeof spec.withOexFileHandle!=='function')throw Error('SPEC_HANDLE_REQUIRED');
 const prepared=await preparePackedOexV2(input,output,{archiveBytes:v.archiveBytes,archiveSha256:v.archiveSha256,capacity:v.capacity},spec.withOexFileHandle),entries=prepared.entries;
 const final=fstatSync(outputFd,{bigint:true}),outputBytes=entries.reduce((sum,e)=>sum+e.bytes,0);if(final.dev!==outputStat.dev||final.ino!==outputStat.ino||final.size!==BigInt(outputBytes)||outputBytes>v.capacity)throw Error('FD_IDENTITY');
 closeSync(inputFd);closeSync(outputFd);
 const ack=Buffer.from(JSON.stringify({version:2,kind:'prepared',status:'complete',attemptId:v.attemptId,runtimeGeneration:v.runtimeGeneration,reservationId:v.reservationId,reservationGeneration:v.reservationGeneration,receiptSha256:r.digest,archiveSha256:v.archiveSha256,manifestSha256:prepared.manifestSha256,exhibitionSha256:prepared.exhibitionSha256,manifestBase64:prepared.manifest.toString('base64'),exhibitionBase64:prepared.exhibition.toString('base64'),outputDevice:v.outputDevice,outputInode:v.outputInode,outputBytes,entries}));
 if(ack.length>4*1024*1024)throw Error('ACK_SIZE');await writeAll(ackFd,ack);closeSync(ackFd);
}
try{await main();}catch{process.exitCode=1;}
