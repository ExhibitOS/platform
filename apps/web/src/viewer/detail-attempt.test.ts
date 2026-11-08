// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {createDetailAttemptSlot,type DetailAttemptOptions,type DetailAttemptValue} from './detail-attempt.js';
const createDetailAttempt=<T>(options:DetailAttemptOptions<T>)=>createDetailAttemptSlot<T>().start(options);
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};}
it('waits for late owned work and asynchronous cleanup before releasing its reservation',async()=>{
 const work=deferred<DetailAttemptValue<string>>(),children=deferred<void>(),dispose=vi.fn(async()=>{}),release=vi.fn(async()=>{}),scope=createDetailAttempt({attemptId:'attempt-a',generation:1,isCurrent:()=>true,run:()=>work.promise,disposeOwned:dispose,releaseBorrow:vi.fn(async()=>{}),drainChildren:()=>children.promise,releaseReservation:release});
 await Promise.resolve();const pendingCommit=scope.tryCommit(()=>true),first=scope.drain(),second=scope.drain();expect(first).toBe(second);let drained=false;void first.then(()=>{drained=true;});await Promise.resolve();expect(drained).toBe(false);expect(release).not.toHaveBeenCalled();
 work.resolve({ownership:'owned',value:'late'});expect(await pendingCommit).toBe(false);await Promise.resolve();expect(release).not.toHaveBeenCalled();children.resolve();expect(await first).toEqual({attemptId:'attempt-a',generation:1,drained:true});expect(dispose).toHaveBeenCalledExactlyOnceWith('late');expect(release).toHaveBeenCalledOnce();
});
it('returns only a borrowed pin and never disposes the scene-owned object',async()=>{
 const sceneObject={name:'scene-owned'},dispose=vi.fn(async()=>{}),releaseBorrow=vi.fn(async()=>{}),release=vi.fn(async()=>{}),scope=createDetailAttempt({attemptId:'borrow',generation:4,isCurrent:()=>true,run:async()=>({ownership:'borrowed' as const,value:sceneObject}),disposeOwned:dispose,releaseBorrow,drainChildren:async()=>{},releaseReservation:release});
 const commit=vi.fn(()=>true);expect(await scope.tryCommit(commit)).toBe(true);expect(await scope.tryCommit(commit)).toBe(false);await scope.drain();expect(releaseBorrow).toHaveBeenCalledExactlyOnceWith(sceneObject);expect(dispose).not.toHaveBeenCalled();expect(release).toHaveBeenCalledOnce();
});
it('rejects uncertain cleanup and keeps the reservation, even if a callback throws undefined',async()=>{
 const release=vi.fn(async()=>{}),children=vi.fn(async()=>{}),scope=createDetailAttempt({attemptId:'unsafe',generation:1,isCurrent:()=>true,run:async()=>({ownership:'owned' as const,value:1}),disposeOwned:async()=>{throw undefined;},releaseBorrow:async()=>{},drainChildren:children,releaseReservation:release});
 expect(await scope.tryCommit(()=>true)).toBe(true);const drained=scope.drain();await expect(drained).rejects.toThrow('DETAIL_DRAIN_UNCONFIRMED');expect(scope.drain()).toBe(drained);expect(children).toHaveBeenCalledOnce();expect(release).not.toHaveBeenCalled();
});
it('never starts or commits a stale generation and does not report a failed child drain as complete',async()=>{
 const release=vi.fn(async()=>{}),commit=vi.fn(()=>true),run=vi.fn(async()=>({ownership:'owned' as const,value:1})),scope=createDetailAttempt({attemptId:'stale',generation:2,isCurrent:()=>false,run,disposeOwned:async()=>{},releaseBorrow:async()=>{},drainChildren:async()=>{throw Error('still running');},releaseReservation:release});
 expect(await scope.tryCommit(commit)).toBe(false);expect(run).not.toHaveBeenCalled();expect(commit).not.toHaveBeenCalled();await expect(scope.drain()).rejects.toThrow('DETAIL_DRAIN_UNCONFIRMED');expect(release).not.toHaveBeenCalled();
});
it('waits for the actual rejected worker and cleanup after abort',async()=>{
 const work=deferred<DetailAttemptValue<number>>(),cleanup=deferred<void>(),release=vi.fn(async()=>{}),scope=createDetailAttempt({attemptId:'cancel',generation:3,isCurrent:()=>true,run:()=>work.promise,disposeOwned:async()=>{},releaseBorrow:async()=>{},drainChildren:()=>cleanup.promise,releaseReservation:release});
 await Promise.resolve();const commit=scope.tryCommit(()=>true),drain=scope.drain();work.reject(Error('worker stopped'));expect(await commit).toBe(false);await Promise.resolve();expect(release).not.toHaveBeenCalled();cleanup.resolve();expect((await drain).generation).toBe(3);
});
it('admits no next attempt until prior work, children and reservation have actually drained',async()=>{
 const slot=createDetailAttemptSlot<number>(),work=deferred<DetailAttemptValue<number>>(),options={attemptId:'one',generation:2,isCurrent:()=>true,run:()=>work.promise,disposeOwned:async()=>{},releaseBorrow:async()=>{},drainChildren:async()=>{},releaseReservation:async()=>{}};
 const first=slot.start(options);await Promise.resolve();const drain=first.drain();expect(()=>slot.start({...options,attemptId:'two'})).toThrow('DETAIL_ATTEMPT_ACTIVE');
 work.resolve({ownership:'owned',value:1});await drain;expect(()=>slot.start(options)).toThrow('DETAIL_ATTEMPT_INVALID');expect(()=>slot.start({...options,attemptId:'stale',generation:1})).toThrow('DETAIL_ATTEMPT_INVALID');
 const second=slot.start({...options,attemptId:'two',run:async()=>({ownership:'owned' as const,value:2})});await second.drain();
});
it('never starts a successor after uncertain cleanup and never converts a generic failure into fallback',async()=>{
 const slot=createDetailAttemptSlot<number>(),options={attemptId:'fail',generation:1,isCurrent:()=>true,run:async():Promise<DetailAttemptValue<number>>=>{throw Error('network');},disposeOwned:async()=>{},releaseBorrow:async()=>{},drainChildren:async()=>{throw Error('not drained');},releaseReservation:async()=>{}};
 const first=slot.start(options);await expect(first.tryCommit(()=>true)).rejects.toThrow('network');await expect(first.drain()).rejects.toThrow('DETAIL_DRAIN_UNCONFIRMED');expect(()=>slot.start({...options,attemptId:'next'})).toThrow('DETAIL_ATTEMPT_ACTIVE');
});
it('publishes one drain promise before synchronous abort listeners can reenter',async()=>{
 const work=deferred<DetailAttemptValue<number>>(),dispose=vi.fn(async()=>{}),children=vi.fn(async()=>{}),release=vi.fn(async()=>{});let reentered:Promise<unknown>|undefined;
 const slot=createDetailAttemptSlot<number>();const scope=slot.start({attemptId:'reentrant',generation:1,isCurrent:()=>true,run:signal=>{signal.addEventListener('abort',()=>{reentered=scope.drain();});return work.promise;},disposeOwned:dispose,releaseBorrow:async()=>{},drainChildren:children,releaseReservation:release});
 await Promise.resolve();const first=scope.drain();expect(reentered).toBe(first);work.resolve({ownership:'owned',value:1});await first;expect(children).toHaveBeenCalledOnce();expect(dispose).toHaveBeenCalledOnce();expect(release).toHaveBeenCalledOnce();
});
it('never returns owned objects or borrowed pins while child settlement is unconfirmed',async()=>{
 for(const ownership of ['owned','borrowed'] as const){const dispose=vi.fn(async()=>{}),unpin=vi.fn(async()=>{}),release=vi.fn(async()=>{}),slot=createDetailAttemptSlot<number>(),scope=slot.start({attemptId:ownership,generation:1,isCurrent:()=>true,run:async()=>({ownership,value:1}),disposeOwned:dispose,releaseBorrow:unpin,drainChildren:async()=>{throw Error('unsettled');},releaseReservation:release});
  expect(await scope.tryCommit(()=>true)).toBe(true);await expect(scope.drain()).rejects.toThrow('DETAIL_DRAIN_UNCONFIRMED');expect(dispose).not.toHaveBeenCalled();expect(unpin).not.toHaveBeenCalled();expect(release).not.toHaveBeenCalled();}
});
it('refuses a commit receipt when staging synchronously cancels or invalidates its generation',async()=>{
 for(const mode of ['cancel','stale'] as const){let current=true;const slot=createDetailAttemptSlot<number>(),scope=slot.start({attemptId:mode,generation:1,isCurrent:()=>current,run:async()=>({ownership:'owned' as const,value:1}),disposeOwned:async()=>{},releaseBorrow:async()=>{},drainChildren:async()=>{},releaseReservation:async()=>{}});
  expect(await scope.tryCommit(()=>{if(mode==='cancel')void scope.drain();else current=false;return true;})).toBe(false);await scope.drain();}
});
