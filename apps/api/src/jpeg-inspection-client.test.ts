// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import sharp from 'sharp';
import {inspectJpegInOwnedWorker} from './jpeg-inspection-client.ts';
const bounded=<T>(promise:Promise<T>)=>Promise.race([promise,new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(Error('FIXTURE_CLOSE_TIMEOUT')),3000);timer.unref();})]);

it('fully decodes a synthetic baseline JPEG in the owned worker and rejects missing EOI',async()=>{
 const bytes=await sharp({create:{width:4,height:3,channels:3,background:{r:30,g:80,b:120}}}).jpeg({progressive:false}).toBuffer(),original=Buffer.from(bytes);let pid=0,argv:string[]=[];const result=await inspectJpegInOwnedWorker(bytes,AbortSignal.timeout(10000),{onSpawn:child=>{pid=child.pid!;argv=child.spawnargs.slice(1,-1);bytes.fill(0);}});
 expect(result.receipt).toMatchObject({version:1,sourceSha256:createHash('sha256').update(original).digest('hex'),sourceBytes:original.length,width:4,height:3,decoder:'sharp-0.35.4-vips-8.18.6-mozjpeg-0826579'});expect(result.bytes.equals(original)).toBe(true);expect(pid).toBeGreaterThan(0);console.log('jpeg-owned-group',pid);expect(()=>process.kill(-pid,0)).toThrow(expect.objectContaining({code:'ESRCH'}));
 expect(argv).toContain('--permission');expect(argv).toContain('--allow-addons');expect(argv.some(arg=>arg.startsWith('--allow-fs-write')||arg==='--allow-child-process'||arg.includes('*'))).toBe(false);
 const root=await mkdtemp(join(tmpdir(),'jpeg-permission-probe-'));try{const path=join(root,'private.txt');await writeFile(path,'synthetic');const program="const fs=require('node:fs'),cp=require('node:child_process');let read=false,child=false;try{fs.readFileSync(process.argv[1])}catch(e){read=e.code==='ERR_ACCESS_DENIED'}try{const p=cp.spawnSync(process.execPath,['-e','']);child=p.error?.code==='ERR_ACCESS_DENIED'}catch(e){child=e.code==='ERR_ACCESS_DENIED'}console.log(JSON.stringify({read,child}));";const probe=spawn(process.execPath,[...argv,'-e',program,path],{stdio:['ignore','pipe','pipe'],env:{}}),closed=once(probe,'close');let text='';probe.stdout!.on('data',chunk=>{text+=chunk.toString();});probe.stderr!.resume();expect(await bounded(closed)).toEqual([0,null]);expect(JSON.parse(text)).toEqual({read:true,child:true});}finally{await rm(root,{recursive:true,force:true});}
 await expect(inspectJpegInOwnedWorker(original.subarray(0,original.length-2),AbortSignal.timeout(10000))).rejects.toThrow('JPEG_INSPECTION_UNAVAILABLE');
});
it('waits for a cancelled child to close before returning',async()=>{
 const bytes=await sharp({create:{width:4,height:3,channels:3,background:'#456789'}}).jpeg().toBuffer(),controller=new AbortController();let closed=false,pid=0;
 await expect(inspectJpegInOwnedWorker(bytes,controller.signal,{onSpawn:child=>{pid=child.pid!;child.once('close',()=>{closed=true;});controller.abort();}})).rejects.toThrow('JPEG_INSPECTION_UNAVAILABLE');expect(closed).toBe(true);expect(pid).toBeGreaterThan(0);console.log('jpeg-cancelled-group',pid);expect(()=>process.kill(-pid,0)).toThrow(expect.objectContaining({code:'ESRCH'}));
});
it('does not start a second worker and rejects shared mutable input',async()=>{
 const bytes=await sharp({create:{width:4,height:3,channels:3,background:'#456789'}}).jpeg().toBuffer(),first=inspectJpegInOwnedWorker(bytes,AbortSignal.timeout(10000));
 await expect(inspectJpegInOwnedWorker(bytes,AbortSignal.timeout(10000))).rejects.toThrow('JPEG_INSPECTION_UNAVAILABLE');await first;
 const shared=Buffer.from(new SharedArrayBuffer(bytes.length));bytes.copy(shared);await expect(inspectJpegInOwnedWorker(shared,AbortSignal.timeout(10000))).rejects.toThrow('JPEG_INSPECTION_UNAVAILABLE');
 const crossRealm=Buffer.from(runInNewContext(`new SharedArrayBuffer(${bytes.length})`) as ArrayBuffer);bytes.copy(crossRealm);await expect(inspectJpegInOwnedWorker(crossRealm,AbortSignal.timeout(10000))).rejects.toThrow('JPEG_INSPECTION_UNAVAILABLE');
});
it('owner-pipe EOF prevents success after stdin EOF',async()=>{
 const bytes=await sharp({create:{width:4,height:3,channels:3,background:'#456789'}}).jpeg().toBuffer(),worker=fileURLToPath(new URL('./jpeg-inspection-worker.ts',import.meta.url)),child=spawn(process.execPath,[worker],{detached:true,stdio:['pipe','pipe','pipe','pipe']}),closed=once(child,'close');let output='',stopped=false;child.stdout!.on('data',chunk=>{output+=chunk.toString();});child.stderr!.resume();child.stdin!.on('error',()=>{});child.stdio[3]!.on('error',()=>{});
 try{await once(child,'spawn',{signal:AbortSignal.timeout(3000)});const pid=child.pid!;console.log('jpeg-owner-eof-group',pid);child.kill('SIGSTOP');stopped=true;const written=once(child.stdin!,'finish',{signal:AbortSignal.timeout(3000)});child.stdin!.end(bytes);await written;child.stdio[3]!.destroy();child.kill('SIGCONT');stopped=false;expect(await bounded(closed)).toEqual([70,null]);expect(output).toBe('');expect(()=>process.kill(-pid,0)).toThrow(expect.objectContaining({code:'ESRCH'}));}
 finally{child.stdio[3]?.destroy();child.stdin?.destroy();if(stopped&&child.exitCode===null&&child.signalCode===null)child.kill('SIGCONT');const drained=await Promise.race([closed.then(()=>true,()=>true),new Promise<boolean>(r=>{const t=setTimeout(()=>r(false),3000);t.unref();})]);if(!drained&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await bounded(closed);}}
},10000);
// A detached orphan can pass through an exited-but-not-yet-reaped process
// group. EPERM is unknown, never proof of absence; require ESRCH within the
// same bounded drain deadline. Never send another signal to the group.
async function waitForOwnedGroupAbsence(pid:number,timeoutMs:number,phase:string){
 const start=Date.now();let probes=0,eperm=0,identity:string|null=null,lastError:unknown;
 while(Date.now()-start<timeoutMs){
  probes++;
  try{process.kill(-pid,0);}catch(error){
   const code=(error as NodeJS.ErrnoException).code;
   if(code==='ESRCH'){console.log('jpeg-parent-loss-drain',{phase,pid,probes,eperm,identity,elapsedMs:Date.now()-start,terminal:'ESRCH'});return;}
   if(code!=='EPERM')throw error;
   lastError=error;eperm++;
   if(identity===null&&process.platform==='darwin')try{identity=execFileSync('/bin/ps',['-p',String(pid),'-o','pid=,ppid=,pgid=,uid=,stat='],{encoding:'utf8',timeout:1000,stdio:['ignore','pipe','ignore']}).trim();}catch{identity='unavailable';}
  }
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 console.log('jpeg-parent-loss-drain',{phase,pid,probes,eperm,identity,elapsedMs:Date.now()-start,terminal:'UNKNOWN'});
 throw new Error('FIXTURE_GROUP_DRAIN_UNCONFIRMED',{cause:lastError});
}
it('owned worker exits after parent death even after stdin EOF',async()=>{
 const bytes=await sharp({create:{width:4,height:3,channels:3,background:'#456789'}}).jpeg().toBuffer(),worker=fileURLToPath(new URL('./jpeg-inspection-worker.ts',import.meta.url));
 const script=`import {spawn} from 'node:child_process';const c=spawn(process.execPath,[process.argv[1]],{detached:true,stdio:['pipe','ignore','ignore','pipe']});c.stdin.on('error',()=>{});c.stdio[3].on('error',()=>{});c.once('spawn',()=>{console.log('START '+c.pid);process.stdin.once('data',()=>{c.stdin.once('finish',()=>console.log('READY'));c.stdin.end(Buffer.from(process.argv[2],'base64'));});});setInterval(()=>{},1000);`;
 const parent=spawn(process.execPath,['--input-type=module','-e',script,worker,bytes.toString('base64')],{stdio:['pipe','pipe','pipe']}),closed=once(parent,'close'),lines=createInterface({input:parent.stdout!})[Symbol.asyncIterator]();parent.stdin!.on('error',()=>{});parent.stderr!.resume();
 let workerPid=0,stopped=false,phase='start',bodyFailed=false,cleanupFailed=false,bodyError:unknown,cleanupError:unknown;
 const nextLine=()=>Promise.race([lines.next(),new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(Error('OWNER_FIXTURE_TIMEOUT')),3000);timer.unref();})]);
 try{
  const first=await nextLine();workerPid=Number(first.value?.replace('START ',''));expect(workerPid).toBeGreaterThan(0);console.log('jpeg-parent-loss-group',workerPid);
  phase='stop-owned-child';process.kill(workerPid,'SIGSTOP');stopped=true;
  parent.stdin!.write('go\n');phase='stdin-finish';expect((await nextLine()).value).toBe('READY');
  phase='parent-close';parent.kill('SIGKILL');await bounded(closed);
  phase='resume-owned-child';process.kill(workerPid,'SIGCONT');stopped=false;
  phase='body-drain';await waitForOwnedGroupAbsence(workerPid,3000,phase);workerPid=0;
 }catch(error){bodyFailed=true;bodyError=error;console.log('jpeg-parent-loss-body-error',{phase,workerPid,code:(error as NodeJS.ErrnoException).code??null,message:error instanceof Error?error.message:'unknown'});}
 finally{
  try{
   const parentAlive=parent.exitCode===null&&parent.signalCode===null;
   if(parentAlive)parent.kill('SIGKILL');
   if(workerPid&&stopped)try{process.kill(workerPid,'SIGCONT');}catch{/* Preserve the body error; the bounded group probe still must prove absence. */}
   if(parentAlive)await bounded(closed);
   if(workerPid)await waitForOwnedGroupAbsence(workerPid,11000,'cleanup-drain');
  }catch(error){cleanupFailed=true;cleanupError=error;}
 }
 // A cleanup failure must still fail; it must not discard the original cause.
 if(bodyFailed&&cleanupFailed)throw new AggregateError([bodyError,cleanupError],'JPEG_PARENT_DEATH_BODY_AND_CLEANUP_FAILED');
 if(bodyFailed)throw bodyError;
 if(cleanupFailed)throw cleanupError;
},20000);
