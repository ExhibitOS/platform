// SPDX-License-Identifier: AGPL-3.0-or-later
import {EventEmitter} from 'node:events';
import {expect,test,vi} from 'vitest';

const processMock=vi.hoisted(()=>({execFile:vi.fn()}));
vi.mock('node:child_process',()=>({execFile:processMock.execFile}));
import {derivative} from './derivative.ts';

test('cancellation waits for the owned worker to close before settling',async()=>{
 const child=new EventEmitter() as EventEmitter & {kill:ReturnType<typeof vi.fn>;stdin:{on:ReturnType<typeof vi.fn>;end:ReturnType<typeof vi.fn>}};
 child.kill=vi.fn();child.stdin={on:vi.fn(),end:vi.fn()};processMock.execFile.mockReturnValueOnce(child);
 const controller=new AbortController();let settled=false;
 const result=derivative(Buffer.from('synthetic'),'image/png',{signal:controller.signal})
  .then(()=>({code:'UNEXPECTED_SUCCESS'}),(error:unknown)=>error).finally(()=>{settled=true;});
 controller.abort();
 expect(child.kill).toHaveBeenCalledWith('SIGKILL');
 await new Promise<void>(resolve=>setImmediate(resolve));expect(settled).toBe(false);
 child.emit('close',null,'SIGKILL');
 expect(await result).toMatchObject({code:'DERIVATIVE_CANCELLED'});
});
