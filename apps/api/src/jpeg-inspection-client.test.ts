// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {expect,it} from 'vitest';
import sharp from 'sharp';
import {inspectJpegInOwnedWorker} from './jpeg-inspection-client.ts';
const bounded=<T>(promise:Promise<T>)=>Promise.race([promise,new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(Error('FIXTURE_CLOSE_TIMEOUT')),3000);timer.unref();})]);

it('fully decodes a synthetic baseline JPEG in the owned worker and rejects missing EOI',async()=>{
 const bytes=await sharp({create:{width:4,height:3,channels:3,background:{r:30,g:80,b:120}}}).jpeg({progressive:false}).toBuffer(),original=Buffer.from(bytes);let pid=0;const result=await inspectJpegInOwnedWorker(bytes,AbortSignal.timeout(10000),{onSpawn:child=>{pid=child.pid!;bytes.fill(0);}});
 expect(result.receipt).toMatchObject({version:1,sourceSha256:createHash('sha256').update(original).digest('hex'),sourceBytes:original.length,width:4,height:3,decoder:'sharp-0.35.4-vips-8.18.6-mozjpeg-0826579'});expect(result.bytes.equals(original)).toBe(true);expect(pid).toBeGreaterThan(0);console.log('jpeg-owned-group',pid);expect(()=>process.kill(-pid,0)).toThrow(expect.objectContaining({code:'ESRCH'}));
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
it('owned worker exits after parent death even after stdin EOF',async()=>{
 const bytes=await sharp({create:{width:4,height:3,channels:3,background:'#456789'}}).jpeg().toBuffer(),worker=fileURLToPath(new URL('./jpeg-inspection-worker.ts',import.meta.url));
 const script=`import {spawn} from 'node:child_process';const c=spawn(process.execPath,[process.argv[1]],{detached:true,stdio:['pipe','ignore','ignore','pipe']});c.stdin.on('error',()=>{});c.stdio[3].on('error',()=>{});c.once('spawn',()=>{console.log('START '+c.pid);process.stdin.once('data',()=>{c.stdin.once('finish',()=>console.log('READY'));c.stdin.end(Buffer.from(process.argv[2],'base64'));});});setInterval(()=>{},1000);`;
 const parent=spawn(process.execPath,['--input-type=module','-e',script,worker,bytes.toString('base64')],{stdio:['pipe','pipe','pipe']}),closed=once(parent,'close'),lines=createInterface({input:parent.stdout!})[Symbol.asyncIterator]();parent.stdin!.on('error',()=>{});parent.stderr!.resume();let workerPid=0,stopped=false;
 const nextLine=()=>Promise.race([lines.next(),new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(Error('OWNER_FIXTURE_TIMEOUT')),3000);timer.unref();})]);
 try{const first=await nextLine();workerPid=Number(first.value?.replace('START ',''));expect(workerPid).toBeGreaterThan(0);console.log('jpeg-parent-loss-group',workerPid);process.kill(workerPid,'SIGSTOP');stopped=true;parent.stdin!.write('go\n');expect((await nextLine()).value).toBe('READY');parent.kill('SIGKILL');await bounded(closed);process.kill(workerPid,'SIGCONT');stopped=false;const until=Date.now()+3000;let alive=true;while(alive&&Date.now()<until){try{process.kill(-workerPid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')alive=false;else throw error;}if(alive)await new Promise(resolve=>setTimeout(resolve,20));}expect(alive).toBe(false);workerPid=0;
 }finally{const parentAlive=parent.exitCode===null&&parent.signalCode===null;if(parentAlive)parent.kill('SIGKILL');if(workerPid&&stopped)try{process.kill(workerPid,'SIGCONT');}catch{/* The owned child may already be gone. */}if(parentAlive)await bounded(closed);if(workerPid){const deadline=Date.now()+11000;while(Date.now()<deadline){try{process.kill(-workerPid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')break;throw error;}await new Promise(resolve=>setTimeout(resolve,50));}}}
},20000);
