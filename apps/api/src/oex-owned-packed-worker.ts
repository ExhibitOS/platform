// SPDX-License-Identifier: AGPL-3.0-or-later
// Inactive fixed-child ABI. Manager must own the inherited handles, independently
// authorize the receipt and retain uncertain stages; this worker never publishes.
import {closeSync,fstatSync,readSync,writeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {preparePackedOex} from './oex-packed-worker-core.ts';

const keys=['version','kind','tenantId','resourceId','jobId','userId','requestId','leaseId','attemptId','runtimeGeneration','stageId','reservationId','reservationGeneration','archiveBytes','archiveSha256','manifestSha256','capacity','inputDevice','inputInode','outputDevice','outputInode','reservationDigest','sourceDigest','workerDigest','profile','format'] as const;
const ids=['tenantId','resourceId','jobId','userId','requestId','leaseId','attemptId','runtimeGeneration','stageId','reservationId','reservationGeneration'] as const;
const hashes=['archiveSha256','manifestSha256','reservationDigest','sourceDigest','workerDigest'] as const;
const decimals=['inputDevice','inputInode','outputDevice','outputInode'] as const;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hex=/^[a-f0-9]{64}$/;
type Request={version:1;kind:'oex-packed-v1';archiveBytes:number;archiveSha256:string;manifestSha256:string;capacity:number;inputDevice:string;inputInode:string;outputDevice:string;outputInode:string;attemptId:string;runtimeGeneration:string;reservationId:string;reservationGeneration:string} & Record<string,unknown>;
function readExactly(fd:number,length:number){const result=Buffer.alloc(length);let offset=0;while(offset<length){const count=readSync(fd,result,offset,length-offset,null);if(!count)throw Error('CONTROL_SHORT');offset+=count;}return result;}
function request(fd:number){
 const length=readExactly(fd,4).readUInt32BE();if(length<2||length>8192)throw Error('CONTROL_SIZE');const bytes=readExactly(fd,length),end=Buffer.alloc(1);if(readSync(fd,end,0,1,null)!==0)throw Error('CONTROL_TRAILING');
 const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))throw Error('CONTROL_SCHEMA');const v=value as Record<string,unknown>;
 if(Object.keys(v).length!==keys.length||keys.some(key=>!Object.hasOwn(v,key))||v.version!==1||v.kind!=='oex-packed-v1'||v.profile!=='bounded-file-v1'||v.format!=='1.0.0-draft.9'||ids.some(key=>typeof v[key]!=='string'||!uuid.test(v[key] as string))||hashes.some(key=>typeof v[key]!=='string'||!hex.test(v[key] as string))||decimals.some(key=>typeof v[key]!=='string'||!/^(0|[1-9][0-9]{0,23})$/.test(v[key] as string))||!Number.isSafeInteger(v.archiveBytes)||Number(v.archiveBytes)<1||Number(v.archiveBytes)>512*1024*1024||!Number.isSafeInteger(v.capacity)||Number(v.capacity)<0||Number(v.capacity)>512*1024*1024)throw Error('CONTROL_SCHEMA');
 return {value:v as Request,digest:createHash('sha256').update(bytes).digest('hex')};
}
function writeAll(fd:number,bytes:Buffer){let offset=0;while(offset<bytes.length){const count=writeSync(fd,bytes,offset,bytes.length-offset,null);if(!count)throw Error('OUTPUT_SHORT');offset+=count;}}
async function main(){
 const control=process.env.EXHIBITOS_NATIVE_OEX_CONTROL_FD;if(!control||!/^[1-9][0-9]{0,3}$/.test(control)||Number(control)<3||Number(control)>1023)throw Error('CONTROL_FD');
 const controlFd=Number(control),controlStat=fstatSync(controlFd,{bigint:true});if(!controlStat.isFIFO()&&!controlStat.isSocket())throw Error('CONTROL_FD');
 let r:ReturnType<typeof request>;try{r=request(controlFd);}finally{closeSync(controlFd);}
 const inputStat=fstatSync(0,{bigint:true}),outputStat=fstatSync(1,{bigint:true}),ackStat=fstatSync(2,{bigint:true}),v=r.value;
 if(!inputStat.isFile()||!outputStat.isFile()||!ackStat.isFIFO()&&!ackStat.isSocket()||String(inputStat.dev)!==v.inputDevice||String(inputStat.ino)!==v.inputInode||String(outputStat.dev)!==v.outputDevice||String(outputStat.ino)!==v.outputInode||inputStat.dev===outputStat.dev&&inputStat.ino===outputStat.ino||outputStat.size!==0n||outputStat.nlink>1n||(outputStat.mode&0o077n)!==0n||outputStat.uid!==BigInt(process.getuid?.()??-1))throw Error('FD_IDENTITY');
 const input={stat:async()=>fstatSync(0,{bigint:true}),read:async(buffer:Uint8Array,offset:number,length:number,position:number)=>({bytesRead:readSync(0,buffer,offset,length,position)})};
 const output={write:async(buffer:Uint8Array,offset:number,length:number,position:number)=>({bytesWritten:writeSync(1,buffer,offset,length,position)})};
 const spec=await import('@exhibitos/spec') as typeof import('@exhibitos/spec') & {withOexFileHandle?:Parameters<typeof preparePackedOex>[3]};if(typeof spec.withOexFileHandle!=='function')throw Error('SPEC_HANDLE_REQUIRED');
 const entries=await preparePackedOex(input,output,{archiveBytes:v.archiveBytes,archiveSha256:v.archiveSha256,manifestSha256:v.manifestSha256,capacity:v.capacity},spec.withOexFileHandle);
 const final=fstatSync(1,{bigint:true}),outputBytes=entries.reduce((sum,e)=>sum+e.bytes,0);if(final.dev!==outputStat.dev||final.ino!==outputStat.ino||final.size!==BigInt(outputBytes)||outputBytes>v.capacity)throw Error('FD_IDENTITY');
 closeSync(0);closeSync(1);
 const ack=Buffer.from(JSON.stringify({version:1,kind:'prepared',status:'complete',attemptId:v.attemptId,runtimeGeneration:v.runtimeGeneration,reservationId:v.reservationId,reservationGeneration:v.reservationGeneration,receiptSha256:r.digest,manifestSha256:v.manifestSha256,outputDevice:v.outputDevice,outputInode:v.outputInode,outputBytes,entries}));
 if(ack.length>4*1024*1024)throw Error('ACK_SIZE');writeAll(2,ack);closeSync(2);
}
try{await main();}catch{process.exitCode=1;}
