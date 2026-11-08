// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {NativeDetailOperations,type NativeDetailScope} from './native-detail-static-export.ts';

const scope=():NativeDetailScope=>({runtimeGeneration:randomUUID(),workspaceId:randomUUID(),tenantId:randomUUID(),principalId:randomUUID(),sessionId:randomUUID(),publicationId:randomUUID(),revisionSha256:'a'.repeat(64),jobId:randomUUID()});
const done=async()=>{};
function deferred(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}

it('closes an unseen exact job before a delayed prepare and never reopens its ID',async()=>{
 const registry=new NativeDetailOperations(),s=scope();registry.close(s);
 await expect(registry.run(s,'prepare',done,done)).rejects.toThrow('NATIVE_DETAIL_UNAVAILABLE');
 expect(registry.status(s)).toBe('settled-failure');
 expect(()=>registry.status({...s,principalId:randomUUID()})).toThrow('NATIVE_DETAIL_UNAVAILABLE');
});
it('waits for actual work and cleanup after cancellation rather than treating abort as drain',async()=>{
 const registry=new NativeDetailOperations(),s=scope(),work=deferred(),cleanup=deferred();
 await registry.run(s,'prepare',done,done);
 const running=registry.run(s,'bytes',async()=>{await work.promise;},async()=>{await cleanup.promise;});
 registry.close(s);expect(registry.status(s)).toBe('pending');work.release();await Promise.resolve();expect(registry.status(s)).toBe('pending');cleanup.release();
 await expect(running).rejects.toThrow();expect(registry.status(s)).toBe('settled-failure');
});
it('requires successful preparation, no concurrent scopes and an actual final cleanup',async()=>{
 const registry=new NativeDetailOperations(),s=scope();await expect(registry.run(s,'bytes',done,done)).rejects.toThrow();
 await registry.run(s,'prepare',done,done);const cleanup=deferred();const final=registry.run(s,'final',async()=>42,async()=>cleanup.promise);
 await expect(registry.run(s,'bytes',done,done)).rejects.toThrow();expect(registry.status(s)).toBe('pending');cleanup.release();expect(await final).toBe(42);expect(registry.status(s)).toBe('settled-success');registry.close(s);expect(registry.status(s)).toBe('settled-success');
});
it('retains uncertainty on cleanup failure and refuses unbounded tombstone growth',async()=>{
 const registry=new NativeDetailOperations(),s=scope();await expect(registry.run(s,'prepare',done,async()=>{throw Error('cleanup');})).rejects.toThrow('cleanup');expect(registry.status(s)).toBe('uncertain');
 const bounded=new NativeDetailOperations();for(let i=0;i<128;i++)bounded.close(scope());expect(()=>bounded.close(scope())).toThrow('NATIVE_DETAIL_UNAVAILABLE');
});
it('closes failed admission after cleanup instead of leaving an unrecoverable pending job',async()=>{
 const registry=new NativeDetailOperations(),s=scope();await expect(registry.run(s,'prepare',async()=>{throw Error('denied');},done)).rejects.toThrow('denied');expect(registry.status(s)).toBe('settled-failure');await expect(registry.run(s,'prepare',done,done)).rejects.toThrow('NATIVE_DETAIL_UNAVAILABLE');
});
it('accounts for reentrant admission and runtime close before callback execution',async()=>{
 const registry=new NativeDetailOperations(),s=scope();let draining:Promise<boolean>|undefined;
 const running=registry.run(s,'prepare',async()=>{await expect(registry.run(s,'prepare',done,done)).rejects.toThrow('NATIVE_DETAIL_BUSY');draining=registry.closeRuntime();},done);
 await expect(running).rejects.toThrow();expect(await draining).toBe(true);
 const second=new NativeDetailOperations(),other=scope();let called=false;const pending=second.run(other,'prepare',async()=>{called=true;},done),closed=second.closeRuntime();await expect(pending).rejects.toThrow();expect(called).toBe(false);expect(await closed).toBe(true);
});
it('does not return a successful result when cancellation arrives during cleanup',async()=>{
 const registry=new NativeDetailOperations(),s=scope(),cleanup=deferred(),entered=deferred();
 const pending=registry.run(s,'prepare',async()=>42,async()=>{entered.release();await cleanup.promise;});await entered.promise;registry.close(s);expect(registry.status(s)).toBe('pending');cleanup.release();await expect(pending).rejects.toThrow();expect(registry.status(s)).toBe('settled-failure');
});
it('returns busy while a previous response cleanup is still settling, then allows the next phase',async()=>{
 const registry=new NativeDetailOperations(),s=scope(),cleanup=deferred(),entered=deferred();const pending=registry.run(s,'prepare',async()=>42,async()=>{entered.release();await cleanup.promise;});await entered.promise;
 await expect(registry.run(s,'final',done,done)).rejects.toThrow('NATIVE_DETAIL_BUSY');cleanup.release();expect(await pending).toBe(42);await registry.run(s,'final',done,done);expect(registry.status(s)).toBe('settled-success');
});
