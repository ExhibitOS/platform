// SPDX-License-Identifier: AGPL-3.0-or-later
import {EventEmitter} from 'node:events';
import {expect,test,vi} from 'vitest';
import type {PrivatePaintingCapability,PrivatePaintingContext} from './demo-display-policy.ts';

const worker=vi.hoisted(()=>({spawn:vi.fn()}));
vi.mock('node:child_process',()=>({execFile:worker.spawn}));
vi.mock('./demo-display-policy.ts',()=>({privatePaintingCandidateRecipe:vi.fn()}));
const {validatePrivatePainting}=await import('./private-painting-validation.ts');
const cap={profile:'painting-1925x2634'} as PrivatePaintingCapability,context={bytes:Buffer.from('synthetic')} as PrivatePaintingContext;
function setup(){
 const child=new EventEmitter() as EventEmitter&{stdin:EventEmitter&{end:()=>void}};child.stdin=Object.assign(new EventEmitter(),{end:vi.fn()});
 let done:(error:unknown,stdout:string)=>void=()=>{};
 worker.spawn.mockImplementation((_command,_args,_options,callback)=>{done=callback;return child;});
 return {child,callback:(error:unknown,stdout:string)=>done(error,stdout)};
}
test('waits for worker close and classifies only explicit normal format failures',async()=>{
 const a=setup(),pending=validatePrivatePainting(cap,context);let settled=false;void pending.catch(()=>{settled=true;});
 a.callback(Object.assign(new Error('exit'),{code:1}),'FORMAT_REJECTED\n');await Promise.resolve();expect(settled).toBe(false);a.child.emit('close',1);await expect(pending).rejects.toThrow('FORMAT_REJECTED');
 const b=setup(),unavailable=validatePrivatePainting(cap,context);b.callback(Object.assign(new Error('timeout'),{killed:true,signal:'SIGKILL'}),'');b.child.emit('close',null);await expect(unavailable).rejects.toThrow('VALIDATION_UNAVAILABLE');
 const c=setup(),missing=validatePrivatePainting(cap,context);c.callback(Object.assign(new Error('exit'),{code:1}),'');c.child.emit('close',1);await expect(missing).rejects.toThrow('VALIDATION_UNAVAILABLE');
});
test('an in-flight cancellation waits for the child to close',async()=>{
 const a=setup(),controller=new AbortController(),pending=validatePrivatePainting(cap,context,controller.signal);let settled=false;void pending.catch(()=>{settled=true;});controller.abort();a.callback(new Error('aborted'),'');await Promise.resolve();expect(settled).toBe(false);a.child.emit('close',null);await expect(pending).rejects.toThrow('VALIDATION_CANCELLED');
});
