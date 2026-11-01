// SPDX-License-Identifier: AGPL-3.0-or-later
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,open,readFile,rm,writeFile} from 'node:fs/promises';
import type {FileHandle} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Duplex} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {expect,it} from 'vitest';

const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const id='11111111-1111-4111-8111-111111111111',digest='a'.repeat(64);
async function run(badDigest:boolean,duplicate=false){
 const dir=await mkdtemp(join(tmpdir(),'exhibitos-owned-chunks-')),inputPath=join(dir,'input'),stagePath=join(dir,'stage');
 const source=Buffer.from('synthetic archive content');let input:FileHandle|undefined,stage:FileHandle|undefined;
 try{
  await writeFile(inputPath,source,{mode:0o600});input=await open(inputPath,'r');stage=await open(stagePath,'wx+',0o600);
  const [a,b]=await Promise.all([input.stat({bigint:true}),stage.stat({bigint:true})]);
  const control={version:1,kind:'oex-chunks-v1',tenantId:id,resourceId:id,jobId:id,userId:id,requestId:id,leaseId:id,attemptId:id,runtimeGeneration:id,stageId:id,reservationId:id,reservationGeneration:id,archiveBytes:source.length,archiveSha256:badDigest?'0'.repeat(64):sha(source),stageDevice:String(b.dev),stageInode:String(b.ino),chunks:[{device:String(a.dev),inode:String(a.ino),bytes:source.length}],reservationDigest:digest,sourceDigest:digest,workerDigest:digest,profile:'bounded-file-v1',format:'1.0.0-draft.9'};
  const text=JSON.stringify(control),bytes=Buffer.from(duplicate?text.replace('"version":1','"version":1,"version":1'):text),header=Buffer.alloc(4);header.writeUInt32BE(bytes.length);
  // Node 24 on this macOS aborts in uv_spawn when asked to build a 68-entry
  // stdio table. The Manager launches its worker through native descriptors;
  // this test-only bridge duplicates four inherited handles before exec, so
  // the worker still receives and validates the production 64..67 FD ABI.
  const bridge='import os,sys\nfor src,dst in zip((3,4,5,6),(64,65,66,67)): os.dup2(src,dst,inheritable=True)\nfor src in (3,4,5,6): os.close(src)\nos.execv(sys.argv[1],sys.argv[1:])';
  const stdio:Array<'ignore'|'pipe'|number>=['ignore','ignore','ignore','pipe','pipe',stage.fd,input.fd];
  const child=spawn('/usr/bin/python3',['-c',bridge,process.execPath,'--experimental-strip-types',fileURLToPath(new URL('./oex-owned-chunk-materializer.ts',import.meta.url))],{stdio,env:{PATH:process.env.PATH,EXHIBITOS_OEX_MATERIALIZER_FDS:'64,65,66,67'}});
  const request=child.stdio[3] as Duplex,reply=child.stdio[4] as Duplex,chunks:Buffer[]=[];let failure:Error|undefined,total=0;
  const stop=(error:Error)=>{failure??=error;child.kill('SIGKILL');};
  reply.on('data',(part:Buffer)=>{total+=part.length;if(total>8192)stop(Error('ACK_LIMIT'));else chunks.push(part);});
  reply.on('error',error=>stop(error));request.on('error',error=>stop(error));child.on('error',error=>{failure??=error;});
  const closed=new Promise<number|null>(resolve=>child.once('close',resolve)),timer=setTimeout(()=>stop(Error('CHILD_TIMEOUT')),5000);
  request.end(Buffer.concat([header,bytes]));const status=await closed;clearTimeout(timer);if(failure)throw failure;
  return {status,reply:Buffer.concat(chunks),source,stageBytes:await readFile(stagePath),receiptSha256:sha(bytes)};
 }finally{await input?.close();await stage?.close();await rm(dir,{recursive:true,force:true});}
}
it('copies actual inherited source FD to the owned stage and returns a bound ACK',async()=>{
 const result=await run(false);expect(result.status).toBe(0);expect(result.stageBytes).toEqual(result.source);
 const ack=JSON.parse(result.reply.toString('utf8'));expect(ack).toMatchObject({version:1,kind:'materialized',status:'complete',receiptSha256:result.receiptSha256,bytes:result.source.length,inputSha256:sha(result.source)});
},15000);
it('fails without an ACK on a digest mismatch and preserves the partial stage for the owner',async()=>{
 const result=await run(true);expect(result.status).not.toBe(0);expect(result.reply.length).toBe(0);expect(result.stageBytes).toEqual(result.source);
},15000);
it('rejects duplicate control fields before writing the stage',async()=>{
 const result=await run(false,true);expect(result.status).not.toBe(0);expect(result.reply.length).toBe(0);expect(result.stageBytes.length).toBe(0);
},15000);
