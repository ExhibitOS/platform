// SPDX-License-Identifier: AGPL-3.0-or-later
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {deflateSync} from 'node:zlib';
import {spawn,type ChildProcess} from 'node:child_process';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {pngCrc} from './png-pixels.ts';
import {validateFurnishingThumbnailPng} from './workspace-furnishing-thumbnail-validation.ts';
vi.mock('node:child_process',async original=>{const actual=await original<typeof import('node:child_process')>();return {...actual,spawn:vi.fn(actual.spawn)};});
const actual=await vi.importActual<typeof import('node:child_process')>('node:child_process');
function chunk(name:string,data:Buffer){const type=Buffer.from(name),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(pngCrc(Buffer.concat([type,data])));return Buffer.concat([length,type,data,crc]);}
function image(){const header=Buffer.alloc(13);header.writeUInt32BE(256);header.writeUInt32BE(256,4);header[8]=8;header[9]=6;return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(256*1025))),chunk('IEND',Buffer.alloc(0))]);}
function child(){return Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn(()=>true)});}
function fake(hooks:Parameters<typeof validateFurnishingThumbnailPng>[1]={}){const worker=child();vi.mocked(spawn).mockReturnValueOnce(worker as unknown as ChildProcess);const promise=validateFurnishingThumbnailPng(image(),hooks);void promise.catch(()=>{});return {worker,promise};}
beforeEach(()=>{vi.resetAllMocks();vi.mocked(spawn).mockImplementation(actual.spawn);});afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
it('uses the existing bounded PNG worker and waits for both real valid and invalid children to close',async()=>{
 let closed=0;await validateFurnishingThumbnailPng(image(),{onSpawn:worker=>{worker.once('close',()=>closed++);}});const bad=Buffer.from(image());bad[29]=bad[29]!^1;await expect(validateFurnishingThumbnailPng(bad,{onSpawn:worker=>{worker.once('close',()=>closed++);}})).rejects.toMatchObject({status:422,code:'WORKSPACE_FURNISHING_THUMBNAIL_INVALID'});expect(closed).toBe(2);
});
it('inherits the issued writer FD and hook, but cannot settle from stdout before actual close',async()=>{
 const hook=vi.fn(),{worker,promise}=fake({writerFd:17,onSpawn:hook});let settled=false;void promise.then(()=>{settled=true;},()=>{settled=true;});expect(hook).toHaveBeenCalledWith(worker);expect(vi.mocked(spawn).mock.calls[0]?.[1]).toEqual(expect.arrayContaining(['--max-old-space-size=128','image/png','workspace-furnishing-thumbnail-v1']));expect(vi.mocked(spawn).mock.calls[0]?.[2]).toMatchObject({stdio:['pipe','pipe','pipe',17]});worker.stdout.emit('data',Buffer.from('VALID\n'));await Promise.resolve();expect(settled).toBe(false);worker.emit('close',0,null);await expect(promise).resolves.toBeUndefined();
});
it.each([[1,'FORMAT_REJECTED\n','',null,422],[1,'','',null,503],[2,'FORMAT_REJECTED','',null,503],[0,'VALID','warning',null,503],[0,'unknown','',null,503],[0,'VALID','','SIGKILL',503]] as const)('classifies only normal explicit format rejection as422 (%s,%s)',async(code,out,err,signal,status)=>{
 const {worker,promise}=fake();worker.stdout.emit('data',Buffer.from(out));if(err)worker.stderr.emit('data',Buffer.from(err));worker.emit('close',code,signal);await expect(promise).rejects.toMatchObject({status});
});
it.each(['timeout','abort','stdout','stderr','error','stdin','hook'] as const)('retains pending custody until close after %s',async event=>{
 vi.useFakeTimers();const controller=new AbortController(),{worker,promise}=fake({signal:controller.signal,onSpawn:event==='hook'?()=>{throw Error('hook failed');}:undefined});let settled=false;void promise.then(()=>{settled=true;},()=>{settled=true;});
 if(event==='timeout')await vi.advanceTimersByTimeAsync(5001);if(event==='abort')controller.abort();if(event==='stdout')worker.stdout.emit('data',Buffer.alloc(4097));if(event==='stderr')worker.stderr.emit('data',Buffer.alloc(4097));if(event==='error')worker.emit('error',Error('spawn failed'));if(event==='stdin')worker.stdin.emit('error',Error('pipe failed'));
 await Promise.resolve();expect(settled).toBe(false);if(event!=='error')expect(worker.kill).toHaveBeenCalledWith('SIGKILL');worker.emit('close',0,null);await expect(promise).rejects.toMatchObject({status:503,code:'FURNISHING_VALIDATION_UNAVAILABLE'});
});
it('rejects malformed headers, pre-abort and unissued writer descriptors without spawning',async()=>{
 await expect(validateFurnishingThumbnailPng(Buffer.alloc(33))).rejects.toMatchObject({status:422});const abort=new AbortController();abort.abort();await expect(validateFurnishingThumbnailPng(image(),{signal:abort.signal})).rejects.toMatchObject({status:503});await expect(validateFurnishingThumbnailPng(image(),{writerFd:3})).rejects.toMatchObject({status:503});expect(spawn).not.toHaveBeenCalled();
});
it('maps synchronous spawn failure to retryable503 without inventing a drained child',async()=>{vi.mocked(spawn).mockImplementationOnce(()=>{throw Error('spawn failed');});await expect(validateFurnishingThumbnailPng(image())).rejects.toMatchObject({status:503});});
