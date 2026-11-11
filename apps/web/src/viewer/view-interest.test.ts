// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {AssetScheduler,MemoryAssetCache,ArtworkAttention,detailDemand,nearbyPreparation} from './loading';
import {optionalResidentRetryReady,retainGalleryDetail,viewInterestRank,viewQueuePriority,viewAttentionEligible,hasViewDemand,type ViewInterest} from './view-interest';
const cold:ViewInterest={visible:false,next:false,recent:false,connected:false,distance:20};
it('connected rooms remain soft interest rather than visible or next-view entitlement',()=>{
  expect(viewInterestRank({...cold,connected:true})).toBeGreaterThan(viewInterestRank({...cold,next:true}));
  expect(viewInterestRank({...cold,next:true})).toBeGreaterThan(viewInterestRank({...cold,visible:true}));
  expect(viewInterestRank(cold,false,true)).toBeLessThan(viewInterestRank({...cold,visible:true}));
});
it('pressure retains useful encoded neighbors before cold bodies and honors pins and exact deficit',()=>{
  const disposed:string[]=[],cache=new MemoryAssetCache<string>(100,value=>disposed.push(value));
  for(const key of ['visible','next','cold','pinned'])cache.set(key,key,10);
  cache.acquire('pinned');cache.get('cold'); // Recently read cold content still yields to useful next-view content.
  const rank=(id:string)=>viewInterestRank(id==='visible'?{...cold,visible:true}:id==='next'?{...cold,next:true}:cold);
  cache.reclaim(()=>cache.stats().bytes-30,rank);expect(disposed).toEqual(['cold']);
  cache.reclaim(()=>cache.stats().bytes-20,rank);expect(disposed).toEqual(['cold','next']);
  cache.reclaim(()=>100,rank);expect(cache.stats()).toMatchObject({bytes:10,pinned:1});expect(disposed).not.toContain('pinned');
});
it('equal-interest pressure reclamation respects actual cache recency',()=>{
  const disposed:string[]=[],cache=new MemoryAssetCache<string>(100,value=>disposed.push(value));
  cache.set('first','first',10);cache.set('second','second',10);cache.get('first');
  cache.reclaim(()=>cache.stats().bytes-10);expect(disposed).toEqual(['second']);
});
it('queued camera priority can rise and fall without cancelling compatible work or opening another serial slot',async()=>{
  let finish!:()=>void;const started:string[]=[];
  const scheduler=new AssetScheduler({concurrency:1,load:async(key:string)=>{started.push(key);if(key==='busy')await new Promise<void>(resolve=>{finish=resolve;});return key;}});
  const busy=scheduler.request('busy');await Promise.resolve();
  const a=scheduler.request('a',0),b=scheduler.request('b',1);
  scheduler.setPriorityOverride('a',viewQueuePriority(cold,true,false));
  scheduler.setPriorityOverride('a',viewQueuePriority(cold,false,false));
  scheduler.setPriorityOverride('b',viewQueuePriority({...cold,visible:true},false,false));
  finish();await Promise.all([busy,a,b]);expect(started).toEqual(['busy','b','a']);expect(scheduler.stats()).toMatchObject({completed:3,cancelled:0,active:0});scheduler.dispose();
});
it('attached full quality survives brief attention loss but pressure can demote it',()=>{
  expect(retainGalleryDetail(true,true,false)).toBe(true);
  expect(retainGalleryDetail(true,true,true)).toBe(false);
  expect(retainGalleryDetail(true,false,false)).toBe(false);
  expect(retainGalleryDetail(false,true,false)).toBe(false); // Warmth cannot promote a coarse asset.
});
it('a measured optional refusal does not retry at unchanged headroom and invalidates on exact policy identity change',()=>{
  const wait={identity:'inventory-sha/policy128/prepare',bytes:20};
  expect(optionalResidentRetryReady(wait,wait.identity,90,100)).toBe(false);
  expect(optionalResidentRetryReady(wait,wait.identity,80,100)).toBe(true);
  expect(optionalResidentRetryReady(wait,wait.identity,90,100,10)).toBe(true);
  expect(optionalResidentRetryReady(wait,'different-inventory-sha/policy128/prepare',90,100)).toBe(true);
  expect(optionalResidentRetryReady(wait,'inventory-sha/policy160/prepare',90,100)).toBe(true);
});

it('gallery pressure leaves separately owned original-cache domains alone',()=>{
  const cache=new MemoryAssetCache<string>(100);cache.set('original-domain','original',10);cache.set('gallery','gallery',10);
  cache.reclaim(()=>100,()=>4,key=>key==='gallery');expect(cache.get('original-domain')).toBe('original');expect(cache.get('gallery')).toBeUndefined();
});

it('visible explicit focus beyond six metres can own detail without enlarging optional preparation range',()=>{
  const input={kind:'image',visible:true,distance:9,occupancy:.01,projectedPixels:100,gazeDistance:0,focused:true};
  const item={id:'focused',eligible:viewAttentionEligible(true,true,true,9),demand:detailDemand(input),occupancy:.01,focused:true,gazeDistance:0,distance:9};
  const attention=new ArtworkAttention();attention.update([item],0);expect(attention.update([item],300)).toBe('focused');
  expect(detailDemand({...input,focused:false})).toBe(false);
  expect(nearbyPreparation([item],undefined)).toEqual([]);
  expect(viewAttentionEligible(true,false,true,9)).toBe(false);
});

it('cold connected topology does not keep an unseen queued minimum alive or restart its transfer',async()=>{
  expect(hasViewDemand({...cold,connected:true})).toBe(false);expect(hasViewDemand(cold,false,true)).toBe(true);
  let finish!:()=>void;const started:string[]=[];
  const scheduler=new AssetScheduler({concurrency:1,load:async(key:string)=>{started.push(key);if(key==='busy')await new Promise<void>(resolve=>{finish=resolve;});return key;}});
  const busy=scheduler.request('busy');await Promise.resolve();
  const unseen=scheduler.request('unseen');const settled=unseen.catch(()=>undefined);
  expect(scheduler.isQueued('unseen')).toBe(true);scheduler.cancel('unseen');expect(scheduler.isQueued('unseen')).toBe(false);
  expect(scheduler.stats().active).toBe(1);finish();await Promise.all([busy,settled]);expect(started).toEqual(['busy']);scheduler.dispose();
});

it('ordinary updates with no pressure do not sort or inspect cache interest',()=>{
  const cache=new MemoryAssetCache<string>(100);cache.set('first','first',10);cache.set('second','second',10);
  let inspected=0;cache.reclaim(()=>0,()=>{inspected++;return 4;});
  expect(inspected).toBe(0);expect(cache.stats().bytes).toBe(20);
});
