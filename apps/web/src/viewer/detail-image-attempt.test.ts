// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import * as three from 'three';
import type {DetailAccess} from '../publication-client';
import {DetailAccessFailure} from '../detail-access-failure';
import {AssetPeakBudget} from './loading';
import {createDetailImageSlot,DetailImageBudgetRefusal,qualifiedDetailImageProfile,sameDetailImageViewport,startDetailImageAttempt} from './detail-image-attempt';
afterEach(()=>vi.unstubAllGlobals());
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((ok,fail)=>{resolve=ok;reject=fail});return {promise,resolve,reject};}
async function fixture(){
 const bytes=new Uint8Array([1,2,3]),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
 const access={revisionSha256:'revision',candidatesFor:vi.fn(async()=>[{candidateId:'candidate',tier:'acquired-original',sha256:hash,bytes:3,mime:'image/jpeg',sourceBindingSha256:'binding',featureReportSha256:'report',featureReport:{inspector:'inspector',cost:{model:'model',peakAdditionalBytes:400},media:{kind:'image',width:4,height:3}}}]),recheck:vi.fn(async()=>{}),fetch:vi.fn(async()=>bytes)} as unknown as DetailAccess;
 const bitmap={width:4,height:3,close:vi.fn()} as unknown as ImageBitmap;vi.stubGlobal('createImageBitmap',vi.fn(async()=>bitmap));
 const signal=new AbortController(),peak=new AssetPeakBudget(1000,()=>100),slot=createDetailImageSlot(),draw=vi.fn(),completeCommands=vi.fn(async()=>{});
 const input={profile:{staticIndexSha256:'index',publicationSha256:'publication',candidateId:'candidate',revisionSha256:'revision',sha256:hash,bytes:3,mime:'image/jpeg' as const,width:4,height:3,reservationBytes:400,restoreReservationBytes:80,transitionCapBytes:1000,maxSceneBytes:600,maxRestoreWidth:1280,maxRestoreHeight:800,devicePixelRatio:1,detailViewport:{width:692,height:520,canvasWidth:692,canvasHeight:520,pixelRatio:1,devicePixelRatio:1},runtime:{renderer:'test',platform:'macOS',browserBrand:'Google Chrome',browserVersion:'1',samples:4,alpha:true,depth:true,antialias:true,preserveDrawingBuffer:true},artworkRevisionId:'artwork',sourceBindingSha256:'binding',featureReportSha256:'report',inspector:'inspector',model:'model'},access,peak,slot,draw,hide:vi.fn(),completeCommands,attemptId:'one',generation:1,isCurrent:()=>true,isTrusted:()=>true,signal:signal.signal,three,limit:1000};
 return {input,access,bitmap,signal,peak,slot,draw,completeCommands};
}
it('refuses unrelated image profiles and over-budget attempts before any read',async()=>{
 expect(qualifiedDetailImageProfile()).toBeUndefined();const f=await fixture();expect(()=>startDetailImageAttempt({...f.input,limit:499})).toThrow(DetailImageBudgetRefusal);try{startDetailImageAttempt({...f.input,limit:499});}catch(error){expect(error).toMatchObject({attemptId:'one',generation:1,requestedBytes:400,currentBytes:100,capBytes:499,sceneCapBytes:600});}expect(f.access.fetch).not.toHaveBeenCalled();expect(f.peak.total()).toBe(100);
});
it('holds the real ledger reservation through visible life and GPU completion, without replacing an active hold',async()=>{
 const f=await fixture(),fence=deferred<void>();f.input.completeCommands=vi.fn(()=>fence.promise);const first=startDetailImageAttempt(f.input);expect(f.peak.total()).toBe(500);expect(await first.show()).toBe(true);expect(f.draw).toHaveBeenCalledOnce();
 expect(()=>startDetailImageAttempt({...f.input,attemptId:'two',generation:2,limit:499})).toThrow('DETAIL_ATTEMPT_ACTIVE');expect(f.peak.total()).toBe(500);
 const drain=first.close();await Promise.resolve();expect(f.peak.total()).toBe(500);fence.resolve();expect((await drain).drained).toBe(true);expect(f.bitmap.close).toHaveBeenCalledOnce();expect(f.peak.total()).toBe(100);
});
it('aborts late bitmap work without drawing or releasing the reservation prematurely',async()=>{
 const f=await fixture(),decode=deferred<ImageBitmap>();vi.stubGlobal('createImageBitmap',vi.fn(()=>decode.promise));const first=startDetailImageAttempt(f.input),show=first.show();await vi.waitFor(()=>expect(createImageBitmap).toHaveBeenCalled());f.signal.abort();const drain=first.close();expect(f.peak.total()).toBe(500);decode.resolve(f.bitmap);expect(await show).toBe(false);await drain;expect(f.bitmap.close).toHaveBeenCalledOnce();expect(f.draw).not.toHaveBeenCalled();expect(f.peak.total()).toBe(100);
});
it('retains the reservation and blocks successor if reader cleanup or command completion is uncertain',async()=>{
 const f=await fixture();vi.mocked(f.access.fetch).mockRejectedValue(Error('reader failed'));const first=startDetailImageAttempt(f.input);await expect(first.show()).rejects.toThrow('reader failed');await expect(first.close()).rejects.toThrow('DETAIL_DRAIN_UNCONFIRMED');expect(f.peak.total()).toBe(500);expect(()=>startDetailImageAttempt({...f.input,attemptId:'two',generation:2})).toThrow('DETAIL_ATTEMPT_ACTIVE');expect(f.peak.total()).toBe(500);
 const g=await fixture();g.input.completeCommands=vi.fn(async()=>{throw Error('fence failed')});const second=startDetailImageAttempt(g.input);expect(await second.show()).toBe(true);await expect(second.close()).rejects.toThrow('DETAIL_DRAIN_UNCONFIRMED');expect(g.peak.total()).toBe(500);
});
it('waits for in-flight final authority check and holds on failed hide or recheck',async()=>{
 const f=await fixture(),check=deferred<void>();vi.mocked(f.access.recheck).mockResolvedValueOnce().mockImplementationOnce(()=>check.promise);const first=startDetailImageAttempt(f.input),show=first.show();await vi.waitFor(()=>expect(f.access.recheck).toHaveBeenCalledTimes(2));const drain=first.close();expect(f.input.hide).toHaveBeenCalledOnce();expect(f.peak.total()).toBe(500);check.resolve();expect(await show).toBe(false);await drain;expect(f.peak.total()).toBe(100);expect(f.draw).not.toHaveBeenCalled();
 const g=await fixture();g.input.hide=vi.fn(()=>{throw Error('hide failed')});const second=startDetailImageAttempt(g.input);expect(await second.show()).toBe(true);await expect(second.close()).rejects.toThrow('DETAIL_DRAIN_UNCONFIRMED');expect(g.peak.total()).toBe(500);
});
it('cancels an explicit close during the final source check, cleans owned data, and retains uncertain reader capacity',async()=>{
 const f=await fixture();let secondSignal:AbortSignal|undefined;vi.mocked(f.access.recheck).mockResolvedValueOnce().mockImplementationOnce((_id,signal)=>{secondSignal=signal;return new Promise((_ok,fail)=>signal.addEventListener('abort',()=>fail(Error('cancel uncertain')),{once:true}));});
 const first=startDetailImageAttempt(f.input),show=first.show();await vi.waitFor(()=>expect(secondSignal).toBeDefined());const drain=first.close();expect(secondSignal!.aborted).toBe(true);await expect(show).rejects.toThrow('cancel uncertain');await expect(drain).rejects.toThrow('DETAIL_DRAIN_UNCONFIRMED');expect(f.bitmap.close).toHaveBeenCalledOnce();expect(f.input.completeCommands).toHaveBeenCalledOnce();expect(f.peak.total()).toBe(500);
});
it('automatically hides and retires a failed draw, and never reports a reentrant closed draw visible',async()=>{
 const f=await fixture();f.input.draw=vi.fn(()=>{throw Error('draw failed')});const first=startDetailImageAttempt(f.input);await expect(first.show()).rejects.toThrow('draw failed');await first.close();expect(f.input.hide).toHaveBeenCalledOnce();expect(f.bitmap.close).toHaveBeenCalledOnce();expect(f.peak.total()).toBe(100);
 const g=await fixture();g.input.draw=vi.fn(()=>{void second.close();});const second=startDetailImageAttempt(g.input);expect(await second.show()).toBe(false);await second.close();expect(g.input.hide).toHaveBeenCalledOnce();expect(g.peak.total()).toBe(100);
});
it('rejects a mismatched exact relation before fetching candidate bytes',async()=>{
 const f=await fixture();f.input.profile={...f.input.profile,featureReportSha256:'different'};const first=startDetailImageAttempt(f.input);await expect(first.show()).rejects.toThrow('DETAIL_IMAGE_BINDING');expect(f.access.fetch).not.toHaveBeenCalled();expect((await first.close()).drained).toBe(true);expect(f.peak.total()).toBe(100);
});
it('retires a stale generation and leaves a repeated show of a healthy image intact',async()=>{
 const f=await fixture();f.input.isCurrent=()=>true;const first=startDetailImageAttempt(f.input);expect(await first.show()).toBe(true);expect(await first.show()).toBe(false);expect(f.input.hide).not.toHaveBeenCalled();expect(f.peak.total()).toBe(500);await first.close();
 const g=await fixture();let live=true;g.input.isCurrent=()=>live;const draw=deferred<void>();vi.mocked(g.access.recheck).mockResolvedValueOnce().mockImplementationOnce(()=>draw.promise);const second=startDetailImageAttempt(g.input),show=second.show();await vi.waitFor(()=>expect(g.access.recheck).toHaveBeenCalledTimes(2));live=false;draw.resolve();expect(await show).toBe(false);await second.close();expect(g.input.hide).toHaveBeenCalledOnce();expect(g.bitmap.close).toHaveBeenCalledOnce();expect(g.peak.total()).toBe(100);
});
it('releases only after an actual typed confirmed static reader failure, without authorizing fallback',async()=>{
 const f=await fixture();vi.mocked(f.access.fetch).mockRejectedValue(new DetailAccessFailure('confirmed',Error('read failed')));const first=startDetailImageAttempt(f.input);await expect(first.show()).rejects.toThrow('read failed');expect((await first.close()).drained).toBe(true);expect(f.peak.total()).toBe(100);expect(f.draw).not.toHaveBeenCalled();
 const g=await fixture();vi.mocked(g.access.fetch).mockRejectedValue(new DetailAccessFailure('uncertain',Error('reader cancellation failed')));const second=startDetailImageAttempt(g.input);await expect(second.show()).rejects.toThrow('reader cancellation failed');await expect(second.close()).rejects.toThrow('DETAIL_DRAIN_UNCONFIRMED');expect(g.peak.total()).toBe(500);
});
it('distinguishes a confirmed final static read from an arbitrary lookalike failure',async()=>{
 const f=await fixture();vi.mocked(f.access.recheck).mockResolvedValueOnce().mockRejectedValueOnce(new DetailAccessFailure('confirmed',Error('authority failed')));const first=startDetailImageAttempt(f.input);await expect(first.show()).rejects.toThrow('authority failed');expect((await first.close()).drained).toBe(true);expect(f.bitmap.close).toHaveBeenCalledOnce();expect(f.peak.total()).toBe(100);expect(f.draw).not.toHaveBeenCalled();
 const g=await fixture();vi.mocked(g.access.fetch).mockRejectedValue({retirement:'confirmed'});const second=startDetailImageAttempt(g.input);await expect(second.show()).rejects.toEqual({retirement:'confirmed'});await expect(second.close()).rejects.toThrow('DETAIL_DRAIN_UNCONFIRMED');expect(g.peak.total()).toBe(500);
});
it('does not trust a static-looking failure after capability provenance changes',async()=>{
 const f=await fixture();let trusted=true;f.input.isTrusted=()=>trusted;vi.mocked(f.access.fetch).mockImplementation(async()=>{trusted=false;throw new DetailAccessFailure('confirmed',Error('changed capability'))});const first=startDetailImageAttempt(f.input);await expect(first.show()).rejects.toThrow('changed capability');await expect(first.close()).rejects.toThrow('DETAIL_DRAIN_UNCONFIRMED');expect(f.peak.total()).toBe(500);expect(f.draw).not.toHaveBeenCalled();
});
it('awaits an active periodic exact-source recheck before releasing owned capacity',async()=>{
 const f=await fixture(),pending=deferred<void>();vi.mocked(f.access.recheck).mockResolvedValueOnce().mockResolvedValueOnce().mockImplementationOnce(()=>pending.promise);const first=startDetailImageAttempt(f.input);expect(await first.show()).toBe(true);const check=first.recheck();await vi.waitFor(()=>expect(f.access.recheck).toHaveBeenCalledTimes(3));const drain=first.close();expect(f.peak.total()).toBe(500);pending.resolve();await expect(check).rejects.toThrow('DETAIL_IMAGE_AUTHORITY');await drain;expect(f.bitmap.close).toHaveBeenCalledOnce();expect(f.peak.total()).toBe(100);
});
it('hides on a stuck periodic recheck deadline but retains capacity until the read settles',async()=>{
 const f=await fixture(),pending=deferred<void>();vi.mocked(f.access.recheck).mockResolvedValueOnce().mockResolvedValueOnce().mockImplementationOnce(()=>pending.promise);const first=startDetailImageAttempt(f.input);expect(await first.show()).toBe(true);vi.useFakeTimers();try{const check=first.recheck();await Promise.resolve();await Promise.resolve();expect(f.access.recheck).toHaveBeenCalledTimes(3);await vi.advanceTimersByTimeAsync(5100);expect(f.input.hide).toHaveBeenCalledOnce();expect(f.peak.total()).toBe(500);pending.resolve();await expect(check).rejects.toThrow('DETAIL_IMAGE_AUTHORITY');await first.close();expect(f.peak.total()).toBe(100);}finally{vi.useRealTimers();}
});
it('invalidates a detail image when its measured canvas size or pixel ratio changes',()=>{
 const original={width:692,height:520,canvasWidth:692,canvasHeight:520,pixelRatio:1,devicePixelRatio:1};expect(sameDetailImageViewport(original,{...original})).toBe(true);for(const changed of [{width:700},{canvasWidth:1384},{pixelRatio:2},{devicePixelRatio:2}])expect(sameDetailImageViewport(original,{...original,...changed})).toBe(false);expect(sameDetailImageViewport({...original,width:0},{...original,width:0})).toBe(false);
});
it('hands its still-charged exact reservation to restoration without a release gap',async()=>{
 const {restoreDetailCanvas}=await import('./detail-command-completion');const f=await fixture();let hold:{key:string;bytes:number}|undefined;const first=startDetailImageAttempt({...f.input,handoffReservation:(key,bytes)=>{hold={key,bytes};return true}});expect(await first.show()).toBe(true);expect((await first.close()).drained).toBe(true);expect(f.peak.total()).toBe(500);expect(hold).toBeDefined();let done!:()=>void;const fence=new Promise<void>(resolve=>{done=resolve});const restore=restoreDetailCanvas({peak:f.peak,key:hold!.key,heldBytes:hold!.bytes,requiredBytes:80,limit:1000,draw:()=>true,complete:()=>fence,current:()=>true,reveal:()=>{}});expect(f.peak.total()).toBe(500);done();await restore;expect(f.peak.total()).toBe(100);
});
it('rejects an over-limit scene before opening any candidate reader',async()=>{
 const f=await fixture();f.input.profile={...f.input.profile,maxSceneBytes:99};expect(()=>startDetailImageAttempt(f.input)).toThrow(DetailImageBudgetRefusal);expect(f.access.candidatesFor).not.toHaveBeenCalled();expect(f.access.fetch).not.toHaveBeenCalled();expect(f.peak.total()).toBe(100);
});
it('registers only the exact measured Wheat revision and artwork with immutable bounds',()=>{
 const revision='41b47f3af2adc536df77a91dcd2918aa527c6343b3b75c31c319b8a0aafe34b8',artwork='3fb6bc87-4c8d-4b51-b964-8db4a23afd0b',profile=qualifiedDetailImageProfile(revision,artwork);
 expect(profile).toMatchObject({staticIndexSha256:'8de1650dfcb0e43aafae1f8c181293a0a88fe18c58acd2389c32de0c7bde91a1',publicationSha256:'ecf6a63b2a97ae5a08ea996eb342bea7bbfe736a0227fb47df33c0b1635758c9',candidateId:'a05143a1-eb94-48cf-997f-3506b26a16cc',sha256:'b46d02a42fd3bb13b022cefc5beaa997b1d7a28cd7b53e4413d940aa0dc4014d',reservationBytes:402653184,transitionCapBytes:536870912,maxSceneBytes:104857600});
 expect(Object.isFrozen(profile)).toBe(true);expect(Object.isFrozen(profile!.runtime)).toBe(true);expect(Object.isFrozen(profile!.detailViewport)).toBe(true);expect(qualifiedDetailImageProfile('f'.repeat(64),artwork)).toBeUndefined();expect(qualifiedDetailImageProfile(revision,'other')).toBeUndefined();
});

it('binds the r19 original to its exact publication and artwork revision',()=>{
 const revision='be7e7511319007e510e24a511acb709d52d45417f9378ff50508464dce54ffbe';
 const artwork='9e775fc4-a06b-43e6-a561-e65d31127197';
 const priorRevision='1b9cbad79b1e561b82a56b236cabc9c270500406bb40966b62636e018985748d';
 const priorArtwork='842a5114-b169-4046-a653-3e7dbbaf8bc9';
 const prior=qualifiedDetailImageProfile(priorRevision,priorArtwork)!;
 expect(qualifiedDetailImageProfile(revision,artwork)).toEqual({...prior,
  revisionSha256:revision,artworkRevisionId:artwork,
  staticIndexSha256:'af7e1967477a9b1d247da21bc27b894561c74da1f0d2614b7b29443fa4975d5d',
  publicationSha256:'009511e3133cc8c89ca0237cb55fed0043df9967dc7f0914c4fe165653f74aff',
  candidateId:'bbd79da8-830c-4356-bf49-af131de40ba6',
  sourceBindingSha256:'491a245e8606dc666ecdf9df575102d146d49d95cb6da0ca6cd03b3176aca0eb',
 });
 expect(qualifiedDetailImageProfile(revision,priorArtwork)).toBeUndefined();
 expect(qualifiedDetailImageProfile(priorRevision,artwork)).toBeUndefined();
});

it('rechecks exact authority and integrity before using prefetched original bytes',async()=>{
 const f=await fixture(),take=vi.fn(()=>new Uint8Array([1,2,3]));
 const attempt=startDetailImageAttempt({...f.input,takePrefetchedBytes:take});
 expect(await attempt.show()).toBe(true);
 expect(f.access.recheck).toHaveBeenCalledTimes(2);
 expect(take).toHaveBeenCalledOnce();
 expect(f.access.fetch).not.toHaveBeenCalled();
 await attempt.close();
 const g=await fixture(),invalid=vi.fn(()=>new Uint8Array([1,2,4]));
 const bad=startDetailImageAttempt({...g.input,takePrefetchedBytes:invalid});
 await expect(bad.show()).rejects.toThrow('DETAIL_IMAGE_INTEGRITY');
 await bad.close();
 expect(g.draw).not.toHaveBeenCalled();
 expect(g.access.fetch).not.toHaveBeenCalled();
 const h=await fixture(),revoked=vi.fn();
 vi.mocked(h.access.recheck).mockRejectedValueOnce(new DetailAccessFailure('confirmed',Error('revoked')));
 const denied=startDetailImageAttempt({...h.input,takePrefetchedBytes:revoked});
 await expect(denied.show()).rejects.toThrow('revoked');
 await denied.close();
 expect(revoked).not.toHaveBeenCalled();
 expect(h.draw).not.toHaveBeenCalled();
});
