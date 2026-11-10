// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,open,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {readNativeAdoptionBrokerBlob,writeNativeAdoptionBrokerBlob} from './native-model-adoption-broker.ts';
import type {NativeModelAdoptionGrant} from './native-model-adoption-grant.ts';

it('requires an exact descriptor, verified output and a clean broker close',async()=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'model-adoption-broker-')));
 const root=await open(directory,'r');
 try{
  const helper=join(directory,'broker.cjs'),now=Date.now(),scope=()=>({
   workspaceId:randomUUID(),tenantId:randomUUID(),principalId:randomUUID(),artworkId:randomUUID(),artworkRevision:1,
  });
  const bytes=Buffer.alloc(96,2),sha256=createHash('sha256').update(bytes).digest('hex');
  const grant:NativeModelAdoptionGrant={version:1,operationId:randomUUID(),issuedAt:now,expiresAt:now+60_000,
   source:{...scope(),artworkRevisionId:randomUUID()},
   target:{...scope(),exhibitionId:randomUUID(),placementId:randomUUID(),etag:'"studio-r1-'+'a'.repeat(64)+'"'},
   receiptSha256:'a'.repeat(64),rightsSha256:'b'.repeat(64),
   original:{sha256,bytes:bytes.length},display:{sha256,bytes:bytes.length},
  };
  const stat=await root.stat({bigint:true}),broker={helper,rootFd:root.fd,rootDevice:String(stat.dev),rootInode:String(stat.ino)};
  const command=(action:string)=>writeFile(helper,`#!${process.execPath}
const fs=require('node:fs');
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const root=fs.fstatSync(3,{bigint:true});
if(process.argv[2]!=='--model-adoption-stage-read-v1'||input.rootDevice!==String(root.dev)||input.rootInode!==String(root.ino)||
 input.operationId!==${JSON.stringify(grant.operationId)}||input.role!=='display'||input.version!==1||input.sha256!==${JSON.stringify(sha256)}||input.bytes!==96)process.exit(2);
${action}
`,{mode:0o700});
  await command('process.stdout.write(Buffer.alloc(96,2));');
  const run=(signal=new AbortController().signal)=>readNativeAdoptionBrokerBlob(broker,grant,'display',signal);
  await expect(run()).resolves.toEqual(bytes);
  await expect(readNativeAdoptionBrokerBlob({...broker,rootInode:'0'},grant,'display',new AbortController().signal)).rejects.toThrow('NATIVE_MODEL_ADOPTION_STAGE_INVALID');
  await command('process.stdout.write(Buffer.alloc(96,2),()=>process.exit(1));');
  await expect(run()).rejects.toThrow('NATIVE_MODEL_ADOPTION_STAGE_INVALID');
  await command('process.stdout.write(Buffer.alloc(96,3));');
  await expect(run()).rejects.toThrow('NATIVE_MODEL_ADOPTION_STAGE_INVALID');
  await command('process.stdout.write(Buffer.alloc(12,2));setInterval(()=>{},1000);');
  const controller=new AbortController(),abort=setTimeout(()=>controller.abort(),300);
  try{await expect(run(controller.signal)).rejects.toMatchObject({name:'AbortError'});}
  finally{clearTimeout(abort);}
  const writer=(action:string)=>writeFile(helper,`#!${process.execPath}
const fs=require('node:fs'),crypto=require('node:crypto');
const data=fs.readFileSync(0),length=data.readUInt32BE(0),input=JSON.parse(data.subarray(4,4+length));
const bytes=data.subarray(4+length),root=fs.fstatSync(3,{bigint:true});
if(process.argv[2]!=='--model-adoption-stage-write-v1'||length<1||length>1024||
 Object.keys(input).join(',')!=='version,rootDevice,rootInode,operationId,role,bytes,sha256'||
 input.version!==1||input.rootDevice!==String(root.dev)||input.rootInode!==String(root.ino)||
 input.operationId!==${JSON.stringify(grant.operationId)}||input.role!=='original'||
 bytes.length!==96||input.bytes!==96||input.sha256!==${JSON.stringify(sha256)}||
 crypto.createHash('sha256').update(bytes).digest('hex')!==input.sha256)process.exit(2);
${action}
`,{mode:0o700});
  const ack='process.stdout.write('+JSON.stringify('{"version":1,"outcome":"written"}\n')+');';
  const write=(payload=bytes,signal=new AbortController().signal)=>writeNativeAdoptionBrokerBlob(broker,grant,'original',payload,signal);
  await writer(ack);
  await expect(write()).resolves.toBeUndefined();
  await expect(write(Buffer.alloc(96,3))).rejects.toThrow('NATIVE_MODEL_ADOPTION_STAGE_INVALID');
  await writer(ack+'process.exitCode=1;');
  await expect(write()).rejects.toThrow('NATIVE_MODEL_ADOPTION_STAGE_INVALID');
  await writer(ack+'process.stdout.write("extra");');
  await expect(write()).rejects.toThrow('NATIVE_MODEL_ADOPTION_STAGE_INVALID');
  await writer('setInterval(()=>{},1000);');
  const writerAbort=new AbortController(),writerTimer=setTimeout(()=>writerAbort.abort(),300);
  try{await expect(write(bytes,writerAbort.signal)).rejects.toMatchObject({name:'AbortError'});}
  finally{clearTimeout(writerTimer);}
 }finally{await root.close();await rm(directory,{recursive:true,force:true});}
});
