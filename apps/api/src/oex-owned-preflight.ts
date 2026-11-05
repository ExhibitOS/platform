// SPDX-License-Identifier: AGPL-3.0-or-later
// Fixed child ABI: Manager owns the input, child, timeout and actual reap.
// This process writes no archive/output files and grants no reservation authority.
import {closeSync,fstatSync,readSync,writeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {preflightOexSize} from './oex-size-preflight.ts';
import {isNativeOexFileFormat} from './oex-file-format.ts';

const keys=['version','kind','attemptId','runtimeGeneration','stageId','reservationId','reservationGeneration','reservationDigest','archiveBytes','archiveSha256','inputDevice','inputInode'] as const;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash=/^[a-f0-9]{64}$/,decimal=/^(0|[1-9][0-9]{0,23})$/;
async function io(action:()=>number,deadline:bigint){for(;;){if(process.hrtime.bigint()>=deadline)throw Error('IO_TIMEOUT');try{return action();}catch(error){if(!(error instanceof Error)||!('code' in error)||!['EAGAIN','EWOULDBLOCK'].includes(String(error.code)))throw error;await new Promise(resolve=>setTimeout(resolve,5));}}}
async function readExactly(fd:number,length:number,deadline:bigint){const b=Buffer.alloc(length);let n=0;while(n<length){const count=await io(()=>readSync(fd,b,n,length-n,null),deadline);if(!count)throw Error('CONTROL_SHORT');n+=count;}return b;}
async function readControl(fd:number){
 const deadline=process.hrtime.bigint()+5_000_000_000n,length=(await readExactly(fd,4,deadline)).readUInt32BE();if(length<2||length>4096)throw Error('CONTROL_SIZE');
 const bytes=await readExactly(fd,length,deadline),end=Buffer.alloc(1);if(await io(()=>readSync(fd,end,0,1,null),deadline)!==0)throw Error('CONTROL_TRAILING');
 const source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),value:unknown=JSON.parse(source);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('CONTROL_SCHEMA');
 const v=value as Record<string,unknown>;
 if(Object.keys(v).length!==keys.length||keys.some((k,i)=>Object.keys(v)[i]!==k)||source!==JSON.stringify(Object.fromEntries(keys.map(k=>[k,v[k]])))||v.version!==1||v.kind!=='oex-preflight-v1'||['attemptId','runtimeGeneration','stageId','reservationId','reservationGeneration'].some(k=>typeof v[k]!=='string'||!uuid.test(v[k] as string))||['reservationDigest','archiveSha256'].some(k=>typeof v[k]!=='string'||!hash.test(v[k] as string))||['inputDevice','inputInode'].some(k=>typeof v[k]!=='string'||!decimal.test(v[k] as string))||!Number.isSafeInteger(v.archiveBytes)||Number(v.archiveBytes)<1||Number(v.archiveBytes)>512*1024*1024)throw Error('CONTROL_SCHEMA');
 return {v,digest:createHash('sha256').update(bytes).digest('hex')};
}
async function writeAll(fd:number,bytes:Buffer){const deadline=process.hrtime.bigint()+5_000_000_000n;let n=0;while(n<bytes.length){const count=await io(()=>writeSync(fd,bytes,n,bytes.length-n,null),deadline);if(!count)throw Error('OUTPUT_SHORT');n+=count;}}
async function main(){
 const text=process.env.EXHIBITOS_OEX_PREFLIGHT_FDS;if(!text||text.length>14)throw Error('FD_LIST');const parts=text.split(',');if(parts.length!==3||parts.some(x=>!/^[1-9][0-9]{1,3}$/.test(x)||Number(x)<64||Number(x)>1023))throw Error('FD_LIST');const fds=parts.map(Number);if(new Set(fds).size!==3)throw Error('FD_LIST');
 const [controlFd,ackFd,inputFd]=fds as [number,number,number],controlStat=fstatSync(controlFd,{bigint:true}),ackStat=fstatSync(ackFd,{bigint:true});if((!controlStat.isFIFO()&&!controlStat.isSocket())||(!ackStat.isFIFO()&&!ackStat.isSocket())||controlStat.dev===ackStat.dev&&controlStat.ino===ackStat.ino)throw Error('CONTROL_FD');
 let request:Awaited<ReturnType<typeof readControl>>;try{request=await readControl(controlFd);}finally{closeSync(controlFd);}
 const {v,digest}=request,inputStat=fstatSync(inputFd,{bigint:true});
 if(!inputStat.isFile()||inputStat.nlink>1n||(inputStat.mode&0o077n)!==0n||inputStat.uid!==BigInt(process.getuid?.()??-1)||String(inputStat.dev)!==v.inputDevice||String(inputStat.ino)!==v.inputInode||inputStat.size!==BigInt(v.archiveBytes as number))throw Error('FD_IDENTITY');
 const input={stat:async()=>fstatSync(inputFd,{bigint:true}),read:async(buffer:Uint8Array,offset:number,length:number,position:number)=>({bytesRead:readSync(inputFd,buffer,offset,length,position)})};
 const selectedFormat=process.env.EXHIBITOS_OEX_PREFLIGHT_FORMAT;
 if(selectedFormat!==undefined&&!isNativeOexFileFormat(selectedFormat))throw Error('CONTROL_FORMAT');
 const {archiveFormat,...legacy}=await preflightOexSize(input,{bytes:v.archiveBytes as number,sha256:v.archiveSha256 as string});closeSync(inputFd);
 if(archiveFormat!==(selectedFormat??'1.0.0-draft.9'))throw Error('CONTROL_FORMAT');
 // Preserve the exact legacy ACK and key order unless the new owner mode
 // explicitly selected its format. Neither form grants drain authority.
 const result=selectedFormat===undefined?legacy:{...legacy,archiveFormat};
 const ack=Buffer.from(JSON.stringify({version:1,kind:'preflight-complete',attemptId:v.attemptId,runtimeGeneration:v.runtimeGeneration,stageId:v.stageId,reservationId:v.reservationId,reservationGeneration:v.reservationGeneration,controlSha256:digest,...result}));
 if(ack.length>4096)throw Error('ACK_SIZE');await writeAll(ackFd,ack);closeSync(ackFd);
}
try{await main();}catch{process.exitCode=1;}
