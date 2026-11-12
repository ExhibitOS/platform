// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import {AssetReleaseUnconfirmedError} from './loading';
import {claimPreparedArtwork,joinArtworkRetirement,retireArtworkResources,waitForArtworkRetirement} from './artwork-ownership';
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}

test('ordinary decode retirement retains worker and encoded ownership until delayed child cleanup',async()=>{
 const child=deferred(),events:string[]=[];
 const backing={dispose(){events.push('callbacks-closed');},drain:()=>child.promise,retire(){events.push('backing-retired');},cleanupOK:()=>true};
 const retired=retireArtworkResources([{dispose(){events.push('worker-disposed');}},{dispose(){events.push('pin-released');}}],backing).then(()=>{events.push('reservation-released');});
 await Promise.resolve();await Promise.resolve();expect(events).toEqual(['callbacks-closed']);
 events.push('late-bitmap-closed');child.resolve();await retired;
 expect(events).toEqual(['callbacks-closed','late-bitmap-closed','worker-disposed','pin-released','backing-retired','reservation-released']);
});
test('failed resource cleanup attempts remaining releases but cannot acknowledge retirement',async()=>{
 const events:string[]=[];
 const backing={dispose(){},async drain(){},retire(){events.push('retired');},cleanupOK:()=>false};
 await expect(retireArtworkResources([{dispose(){throw Error('close failed');}},{dispose(){events.push('other-disposed');}}],backing)).rejects.toBeInstanceOf(AssetReleaseUnconfirmedError);
 expect(events).toEqual(['other-disposed','retired']);
});
test('prepared rights wait owns a reservation and cannot be expired from its old cache',async()=>{
 const auth=deferred(),object={bytes:8},pool=new Map([['asset',object]]);let reserved=0,disposed=0;
 const result=claimPreparedArtwork({pool,assetId:'asset',reserve(value){expect(pool.has('asset')).toBe(false);reserved=value.bytes;},authorize:()=>auth.promise,check(){},dispose(){disposed++;}});
 expect(pool.size).toBe(0);expect(reserved).toBe(8);
 // The normal expiry/pressure loop sees no cache allocation to dispose.
 for(const value of pool.values()){void value;disposed++;}expect(disposed).toBe(0);
 auth.resolve();expect(await result).toBe(object);expect(reserved).toBe(8);expect(disposed).toBe(0);
});
test('failed reservation restores prepared ownership, while rejected rights retires it once',async()=>{
 const object={},pool=new Map([['asset',object]]);let disposed=0;
 await expect(claimPreparedArtwork({pool,assetId:'asset',reserve(){throw Error('budget');},async authorize(){},check(){},dispose(){disposed++;}})).rejects.toThrow('budget');
 expect(pool.get('asset')).toBe(object);expect(disposed).toBe(0);
 await expect(claimPreparedArtwork({pool,assetId:'asset',reserve(){},async authorize(){throw Error('rights');},check(){},dispose(){disposed++;}})).rejects.toThrow('rights');
 expect(pool.size).toBe(0);expect(disposed).toBe(1);
});
test('cancelled prepared authorization never publishes and failed disposal retains an uncertain hold',async()=>{
 const auth=deferred(),signal=new AbortController(),pool=new Map([['asset',{}]]);let publishes=0;
 const result=claimPreparedArtwork({pool,assetId:'asset',reserve(){},authorize:()=>auth.promise,check(){signal.signal.throwIfAborted();publishes++;},dispose(){throw Error('cannot release');}});
 const rejected=expect(result).rejects.toBeInstanceOf(AssetReleaseUnconfirmedError);signal.abort();auth.resolve();await rejected;
 expect(publishes).toBe(0);expect(pool.size).toBe(0);
});
test('repeated source replacement cannot bypass the first unfinished artwork retirement',async()=>{
 const old=deferred(),cancelledSource=new AbortController();let starts=0;
 const barrier=joinArtworkRetirement(old.promise,()=>{});
 const waiting=waitForArtworkRetirement(barrier,cancelledSource.signal);const rejected=expect(waiting).rejects.toMatchObject({name:'AbortError'});
 cancelledSource.abort();await rejected;
 const next=joinArtworkRetirement(barrier,()=>{});
 const newSource=waitForArtworkRetirement(next,new AbortController().signal).then(()=>{starts++;});
 await Promise.resolve();expect(starts).toBe(0);old.resolve();await newSource;expect(starts).toBe(1);
});
test('a failed source release blocks successor construction rather than reporting a clean cache',async()=>{
 const barrier=joinArtworkRetirement(Promise.resolve(),()=>{throw new AssetReleaseUnconfirmedError();});
 await expect(waitForArtworkRetirement(barrier,new AbortController().signal)).rejects.toBeInstanceOf(AssetReleaseUnconfirmedError);
});
