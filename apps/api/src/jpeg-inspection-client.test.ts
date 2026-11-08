// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {expect,it} from 'vitest';
import sharp from 'sharp';
import {inspectJpegInOwnedWorker} from './jpeg-inspection-client.ts';

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
 const bytes=await sharp({create:{width:4,height:3,channels:3,background:'#456789'}}).jpeg().toBuffer(),worker=fileURLToPath(new URL('./jpeg-inspection-worker.ts',import.meta.url)),child=spawn(process.execPath,[worker],{detached:true,stdio:['pipe','pipe','pipe','pipe']}),closed=once(child,'close');let output='';child.stdout!.on('data',chunk=>{output+=chunk.toString();});child.stderr!.resume();child.stdio[3]!.on('error',()=>{});await once(child,'spawn');const pid=child.pid!;console.log('jpeg-owner-eof-group',pid);child.kill('SIGSTOP');child.stdin!.end(bytes);await once(child.stdin!,'finish');child.stdio[3]!.destroy();child.kill('SIGCONT');expect(await closed).toEqual([70,null]);expect(output).toBe('');expect(()=>process.kill(-pid,0)).toThrow(expect.objectContaining({code:'ESRCH'}));
},10000);
it('owned worker exits after parent death even after stdin EOF',async()=>{
 const bytes=await sharp({create:{width:4,height:3,channels:3,background:'#456789'}}).jpeg().toBuffer(),worker=fileURLToPath(new URL('./jpeg-inspection-worker.ts',import.meta.url));
 const script=`import {spawn} from 'node:child_process';const c=spawn(process.execPath,[process.argv[1]],{detached:true,stdio:['pipe','ignore','ignore','pipe']});c.stdin.on('error',()=>{});c.stdio[3].on('error',()=>{});c.once('spawn',()=>{c.kill('SIGSTOP');c.stdin.end(Buffer.from(process.argv[2],'base64'));c.stdin.once('finish',()=>console.log(c.pid));});setInterval(()=>{},1000);`;
 const parent=spawn(process.execPath,['--input-type=module','-e',script,worker,bytes.toString('base64')],{stdio:['ignore','pipe','pipe']});let workerPid=0,resumed=false;
 try{let output='';for await(const chunk of parent.stdout!){output+=chunk.toString();if(output.includes('\n'))break;}workerPid=Number(output.trim());expect(workerPid).toBeGreaterThan(0);console.log('jpeg-parent-loss-group',workerPid);const closed=once(parent,'close');parent.kill('SIGKILL');await closed;process.kill(workerPid,'SIGCONT');resumed=true;const until=Date.now()+3000;let alive=true;while(alive&&Date.now()<until){try{process.kill(-workerPid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')alive=false;else throw error;}if(alive)await new Promise(resolve=>setTimeout(resolve,20));}expect(alive).toBe(false);workerPid=0;
 }finally{if(parent.exitCode===null&&parent.signalCode===null)parent.kill('SIGKILL');if(workerPid&&!resumed)try{process.kill(workerPid,'SIGCONT');}catch{/* The stopped child may already be gone. */}if(workerPid){const deadline=Date.now()+11000;while(Date.now()<deadline){try{process.kill(-workerPid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')break;throw error;}await new Promise(resolve=>setTimeout(resolve,50));}}}
},20000);
