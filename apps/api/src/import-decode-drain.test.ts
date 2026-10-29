// SPDX-License-Identifier: AGPL-3.0-or-later
import {EventEmitter} from 'node:events';
import {describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({callback:undefined as undefined|((error:Error|null,stdout:string)=>void),child:undefined as unknown}));
vi.mock('node:child_process',()=>({execFile:vi.fn((_node:unknown,_args:unknown,_options:unknown,callback:(error:Error|null,stdout:string)=>void)=>{state.callback=callback;const child=new EventEmitter() as EventEmitter&{stdin:EventEmitter&{end:()=>void}};child.stdin=Object.assign(new EventEmitter(),{end:()=>{}});state.child=child;return child;})}));
import {decode} from './imports.ts';
describe('import decoder ownership',()=>{
 it('does not release a still-live child when execFile reports a kill error early',async()=>{
  let settled=false;const result=decode(Buffer.from('synthetic'),'image/png').catch(e=>{settled=true;return e;});
  state.callback!(new Error('kill failed'),'');await Promise.resolve();expect(settled).toBe(false);
  (state.child as EventEmitter).emit('close',1);expect(await result).toMatchObject({code:'FORMAT_REJECTED'});
 });
 it('waits for both callback and child close on successful validation',async()=>{
  let settled=false;const result=decode(Buffer.from('synthetic'),'image/png').then(()=>{settled=true;});
  (state.child as EventEmitter).emit('close',0);await Promise.resolve();expect(settled).toBe(false);
  state.callback!(null,'VALID');await result;expect(settled).toBe(true);
 });
});
