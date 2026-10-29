import { describe, it, expect } from "vitest";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import {readFileSync} from "node:fs";
import * as Three from "three";
import type {Exhibition} from "@exhibitos/spec";
import { AssetScheduler, MemoryAssetCache, DEVICE_BUDGETS, selectAssetVariant, fetchVerifiedAsset, checkImageDecode, detailScreenBounds, detailDemand, DetailTransition, ArtworkAttention, artworkDemandContext, nearbyPreparation, displayedDetailReclamation, settleAssetGeneration, minimumDetailPending, minimumRoomInterest, minimumFootprintVisible, imageFullDecodeCeiling, AssetPeakBudget, retainEncodedBuffer, assetDecodeReserve, textureResidentBytes, reusableImageTier, keepsAttendedImageTier } from "./loading";
import {createFlatDetailRetry} from "./borrowed-detail-preview";
import { syntheticArtwork } from "../placement/model";
import { LOD_NAMESPACE, validateViewerLod, lodVariantsFor } from "@exhibitos/studio-contract";
const tick=()=>new Promise(r=>setTimeout(r,0));
describe('authored painting near tiers',()=>{
 const image=()=>{const a=syntheticArtwork('image'),full=a.assets[0]!,coarse={...full,id:crypto.randomUUID(),bytes:1000};full.bytes=1048576;a.assets.push(coarse);a.extensions={[LOD_NAMESPACE]:{version:1,variants:[{assetId:full.id,detail:'full',textureSize:2048},{assetId:coarse.id,detail:'coarse',textureSize:512}]}};return {a,full,coarse};};
 it('holds attention through ties and requires a stable focused/occupancy winner',()=>{
  const owner=new ArtworkAttention(),a={id:'a',demand:true,occupancy:.2,focused:false},b={id:'b',demand:true,occupancy:.1,focused:false};
  expect(owner.update([a,b],0)).toBeUndefined();expect(owner.update([a,b],300)).toBe('a');
  b.occupancy=.2;expect(owner.update([b,a],400)).toBe('a');
  b.focused=true;expect(owner.update([a,b],500)).toBe('a');expect(owner.update([a,b],799)).toBe('a');expect(owner.update([a,b],800)).toBe('b');
  b.focused=false;a.occupancy=.6;expect(owner.update([a,b],900)).toBe('b');expect(owner.update([a,b],1200)).toBe('a');
  expect(owner.update([],1300)).toBeUndefined();
 });
 it('acquires alongside detail dwell and keeps the attended tier through a brief look away',()=>{
  const owner=new ArtworkAttention(),transition=new DetailTransition();
  const observe=(demand:boolean,now:number)=>{
   const want=transition.update(demand,now);
   return {want,current:owner.update([{id:'painting',demand:demand||(owner.current()==='painting'&&want),occupancy:demand?.2:0,focused:false}],now)};
  };
  expect(observe(true,0)).toEqual({want:false,current:undefined});
  expect(observe(true,300)).toEqual({want:true,current:'painting'});
  expect(observe(false,400)).toEqual({want:true,current:'painting'});
  expect(observe(true,600)).toEqual({want:true,current:'painting'});
  expect(observe(false,700)).toEqual({want:true,current:'painting'});
  expect(observe(false,2499)).toEqual({want:true,current:'painting'});
  expect(observe(false,2500)).toEqual({want:false,current:undefined});
 });
 it('uses a valid compact coarse and rejects missing refs instead of fetching an oversized full',()=>{
  const {a,full,coarse}=image();expect(selectAssetVariant(a,0,DEVICE_BUDGETS.compact)).toBe(coarse);expect(selectAssetVariant(a,0,DEVICE_BUDGETS.desktop)).toBe(full);
  a.assets=a.assets.filter(v=>v.id!==coarse.id);expect(()=>selectAssetVariant(a,0,DEVICE_BUDGETS.compact)).toThrow('VIEWER_LOD_INVALID');
 });
 it('guards explicit desktop pair pixels before decode while retaining compact two-megapixel protection',()=>{
  const {a,full}=image(),bytes=new ArrayBuffer(64),v=new DataView(bytes);[137,80,78,71,13,10,26,10].forEach((n,i)=>v.setUint8(i,n));v.setUint32(8,13);v.setUint32(12,0x49484452);v.setUint32(16,2048);v.setUint32(20,1920);v.setUint8(24,8);v.setUint8(25,2);
  expect(checkImageDecode(bytes,a,full,DEVICE_BUDGETS.desktop)).toEqual({width:2048,height:1920});
  expect(()=>checkImageDecode(bytes,a,full,DEVICE_BUDGETS.compact)).toThrow('IMAGE_DECODE_BUDGET');
  v.setUint32(20,2049);expect(()=>checkImageDecode(bytes,a,full,DEVICE_BUDGETS.desktop)).toThrow('IMAGE_DECODE_BUDGET');
 });
 it('accounts for old residents and encoded copies instead of enlarging the shared image budget',()=>{
  const {a,full}=image(),usable=96*1024*1024-3932160-2097152,resident=6*1024*1024;
  const small=imageFullDecodeCeiling(a,full,DEVICE_BUDGETS.desktop)!;expect(small+resident).toBeLessThan(usable);
  full.bytes=8388608;expect(imageFullDecodeCeiling(a,full,DEVICE_BUDGETS.desktop)!+resident).toBeGreaterThan(usable);
  full.bytes++;expect(()=>imageFullDecodeCeiling(a,full,DEVICE_BUDGETS.desktop)).toThrow('IMAGE_DECODE_BUDGET');
 });
});
describe("bounded Viewer loading",()=>{
 it('admits bounded full-only painting for compact resizing and guards source decode before allocation',()=>{
  const a=syntheticArtwork('image'),asset=a.assets[0]!;asset.bytes=4856525;
  a.extensions={[LOD_NAMESPACE]:{version:1,variants:[{assetId:asset.id,detail:'full',textureSize:1401}]}};
  expect(selectAssetVariant(a,Infinity,DEVICE_BUDGETS.compact)).toBe(asset);
  const bytes=new ArrayBuffer(33),p=new DataView(bytes);new Uint8Array(bytes).set([137,80,78,71,13,10,26,10]);p.setUint32(8,13);p.setUint32(12,0x49484452);p.setUint32(16,1401);p.setUint32(20,1098);p.setUint8(24,8);p.setUint8(25,6);
  expect(()=>checkImageDecode(bytes,a,asset,DEVICE_BUDGETS.compact)).not.toThrow();
  p.setUint32(16,1402);expect(()=>checkImageDecode(bytes,a,asset,DEVICE_BUDGETS.compact)).toThrow('IMAGE_DECODE_BUDGET');
  p.setUint32(16,1401);p.setUint32(20,0);expect(()=>checkImageDecode(bytes,a,asset,DEVICE_BUDGETS.compact)).toThrow('IMAGE_DECODE_BUDGET');
  p.setUint32(20,1098);p.setUint8(24,16);expect(()=>checkImageDecode(bytes,a,asset,DEVICE_BUDGETS.compact)).toThrow('IMAGE_DECODE_BUDGET');p.setUint8(24,8);
  expect(()=>checkImageDecode(new ArrayBuffer(2),a,asset,DEVICE_BUDGETS.compact)).toThrow('IMAGE_DECODE_BUDGET');
  asset.bytes=8388609;expect(()=>selectAssetVariant(a,Infinity,DEVICE_BUDGETS.compact)).toThrow('ASSET_BUDGET_EXCEEDED');
  asset.bytes=1;a.extensions[LOD_NAMESPACE]={version:1,variants:[{assetId:asset.id,detail:'full',textureSize:2049}]};expect(()=>selectAssetVariant(a,Infinity,DEVICE_BUDGETS.compact)).toThrow('ASSET_BUDGET_EXCEEDED');
 });
 it('prefers smaller authored painting and refuses transient decode over the concurrency share',()=>{
  const a=syntheticArtwork('image'),full=a.assets[0]!,coarse={...full,id:crypto.randomUUID(),bytes:100000};full.bytes=8000000;a.assets.push(coarse);
  a.extensions={[LOD_NAMESPACE]:{version:1,variants:[{assetId:full.id,detail:'full',textureSize:2048},{assetId:coarse.id,detail:'coarse',textureSize:1024}]}};
  expect(selectAssetVariant(a,0,DEVICE_BUDGETS.compact)).toBe(coarse);
  a.assets.pop();a.extensions[LOD_NAMESPACE]={version:1,variants:[{assetId:full.id,detail:'full',textureSize:2048}]};
  expect(()=>selectAssetVariant(a,0,DEVICE_BUDGETS.compact)).toThrow('ASSET_BUDGET_EXCEEDED');
 });
 it("prioritizes queued demand, deduplicates and retains cancellation slots until settlement then retries",async()=>{const started:string[]=[],finish=new Map<string,(v:string)=>void>(),discarded:string[]=[];const s=new AssetScheduler<string>({concurrency:1,load:key=>{started.push(key);return new Promise(r=>finish.set(key,r));},onDiscard:v=>discarded.push(v)});const far=s.request("far",20),near=s.request("near",1);expect(s.request("near",3)).toBe(near);await tick();expect(started).toEqual(["near"]);const aborted=expect(near).rejects.toMatchObject({name:"AbortError"});s.cancel("near");await aborted;await tick();expect(s.stats().active).toBe(1);expect(started).toEqual(["near"]);finish.get("near")!("late");await tick();expect(discarded).toEqual(["late"]);expect(started).toEqual(["near","far"]);finish.get("far")!("ok");expect(await far).toBe("ok");const again=s.retry("near");await tick();finish.get("near")!("retry");expect(await again).toBe("retry");s.dispose();expect(s.stats()).toMatchObject({active:0,queued:0,completed:2,cancelled:1});});
 it("evicts only unpinned LRU resources and disposes rejected allocations and teardown",()=>{const disposed:string[]=[];const c=new MemoryAssetCache<string>(10,v=>disposed.push(v));c.set("a","a",6);c.acquire("a");expect(c.set("b","b",6)).toBe(false);expect(disposed).toEqual(["b"]);expect(c.delete("a")).toBe(false);c.release("a");expect(c.set("c","c",6)).toBe(true);expect(disposed).toEqual(["b","a"]);expect(c.stats().bytes).toBe(6);c.clear();expect(disposed).toEqual(["b","a","c"]);});
 it("selects actual qualified coarse detail and refuses known over-budget fallback including case-varied byte aliases",()=>{const a=syntheticArtwork("sculpture"),full=a.assets[0]!;full.bytes=1000;const low={...full,id:"a0000000-0000-4000-8000-000000000001",bytes:100};a.assets.push(low);a.extensions={[LOD_NAMESPACE]:{version:1,variants:[{assetId:full.id,detail:"full",triangles:30000},{assetId:low.id.toUpperCase(),detail:"coarse",triangles:3000}]}};expect(validateViewerLod(a).valid).toBe(true);expect(selectAssetVariant(a,10,DEVICE_BUDGETS.compact).id).toBe(low.id);low.bytes=2000;expect(validateViewerLod(a).valid).toBe(false);a.assets.pop();a.extensions={[LOD_NAMESPACE]:{version:1,variants:[{assetId:full.id,detail:"full",triangles:30000}]}};expect(()=>selectAssetVariant(a,1,DEVICE_BUDGETS.compact)).toThrow("ASSET_BUDGET_EXCEEDED");});
 it("verifies streamed response identity and hash, stops overflow before allocating declared body, rejects wrong revision",async()=>{const a=syntheticArtwork("image"),inventory=a.assets[0]!,payload=new Uint8Array([1,2,3]);inventory.bytes=3;inventory.sha256=createHash("sha256").update(payload).digest("hex");const publicationId="a0000000-0000-4000-8000-000000000001",revisionSha256="1".repeat(64),asset={assetId:inventory.id,mime:inventory.mime,url:`/api/v1/publications/${publicationId}/assets/${inventory.id}`},signal=new AbortController().signal,headers={"content-type":inventory.mime,"x-exhibitos-publication-revision":revisionSha256};const fetcher=(async()=>new Response(payload,{headers})) as typeof fetch;expect(new Uint8Array(await fetchVerifiedAsset({publicationId,revisionSha256,asset,inventory,signal,fetcher}))).toEqual(payload);let cancelled=false;const oversized=(async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(4));},cancel(){cancelled=true;}}),{headers})) as typeof fetch;await expect(fetchVerifiedAsset({publicationId,revisionSha256,asset,inventory,signal,fetcher:oversized})).rejects.toThrow("ASSET_INTEGRITY");expect(cancelled).toBe(true);await expect(fetchVerifiedAsset({publicationId,revisionSha256,asset,inventory,signal,fetcher:(async()=>new Response(payload,{headers:{...headers,"x-exhibitos-publication-revision":"0".repeat(64)}})) as typeof fetch})).rejects.toThrow("ASSET_RESPONSE_INVALID");});
 it("cancels a real oversized HTTP stream and stops transfer at inventory limit",async()=>{const a=syntheticArtwork("image"),inventory=a.assets[0]!;inventory.bytes=3;inventory.sha256=createHash("sha256").update(new Uint8Array([1,2,3])).digest("hex");const publicationId="a0000000-0000-4000-8000-000000000001",revisionSha256="1".repeat(64),asset={assetId:inventory.id,mime:inventory.mime,url:`/api/v1/publications/${publicationId}/assets/${inventory.id}`};let closed=false;const server=createServer((_req,res)=>{res.writeHead(200,{"content-type":inventory.mime,"x-exhibitos-publication-revision":revisionSha256});res.on("close",()=>{closed=true;});res.write(new Uint8Array(4));});await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const address=server.address();if(!address||typeof address==="string")throw Error("HTTP_TEST_BIND");try{const fetcher=((url,options)=>fetch(`http://127.0.0.1:${address.port}${url}`,options)) as typeof fetch;await expect(fetchVerifiedAsset({publicationId,revisionSha256,asset,inventory,signal:new AbortController().signal,fetcher})).rejects.toThrow("ASSET_INTEGRITY");for(let i=0;i<100&&!closed;i++)await new Promise(r=>setTimeout(r,10));expect(closed).toBe(true);}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}});
 it("interrupts a pending reader on abort and releases the stream",async()=>{const a=syntheticArtwork("image"),inventory=a.assets[0]!;inventory.bytes=3;inventory.sha256="0".repeat(64);const publicationId="a0000000-0000-4000-8000-000000000001",revisionSha256="1".repeat(64),asset={assetId:inventory.id,mime:inventory.mime,url:`/api/v1/publications/${publicationId}/assets/${inventory.id}`},controller=new AbortController();let cancelled=false;const fetcher=(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{"content-type":inventory.mime,"x-exhibitos-publication-revision":revisionSha256}})) as typeof fetch;const result=fetchVerifiedAsset({publicationId,revisionSha256,asset,inventory,signal:controller.signal,fetcher});await tick();controller.abort();await expect(result).rejects.toMatchObject({name:"AbortError"});expect(cancelled).toBe(true);});

});

describe('automatic detail transitions',()=>{
 it('keeps near-plane-intersecting geometry in demand without projecting behind-eye corners, and rejects out-of-frustum bounds',()=>{
  const near={corners:[{x:-2,y:-2,z:-3,depth:0},{x:.5,y:.5,z:.5,depth:-1}],near:.1,intersectsFrustum:true,width:800,height:600};
  expect(detailScreenBounds(near)).toEqual({visible:true,occupancy:1,projectedPixels:800,gazeDistance:0});
  expect(detailDemand({kind:'sculpture',distance:.3,focused:false,...detailScreenBounds(near)})).toBe(true);
  expect(detailScreenBounds({...near,intersectsFrustum:false}).visible).toBe(false);
  expect(detailScreenBounds({...near,corners:[{x:0,y:0,z:3,depth:.5}]}).visible).toBe(false);
 });
 it('keeps the accepted textured LOD pair within existing caps and reserves full geometry/maps before replacing coarse',()=>{
  const {publicPBRTexturedLODPair}=createRequire(import.meta.url)('../../../../scripts/embedded-texture-fixture.mjs') as {publicPBRTexturedLODPair:()=>{full:Buffer;coarse:Buffer}};
  const pair=publicPBRTexturedLODPair(),a=syntheticArtwork('sculpture'),full=a.assets[0]!,coarse={...full,id:crypto.randomUUID(),bytes:pair.coarse.length};full.bytes=pair.full.length;a.assets.push(coarse);
  a.extensions={[LOD_NAMESPACE]:{version:1,variants:[{assetId:full.id,detail:'full',triangles:8},{assetId:coarse.id,detail:'coarse',triangles:2}]}};
  expect(selectAssetVariant(a,Infinity,DEVICE_BUDGETS.compact).id).toBe(coarse.id);
  expect(selectAssetVariant(a,0,DEVICE_BUDGETS.compact).id).toBe(full.id);
  const fullReserve=assetDecodeReserve(a,full,DEVICE_BUDGETS.compact,new Uint8Array(pair.full).buffer),coarseReserve=assetDecodeReserve(a,coarse,DEVICE_BUDGETS.compact,new Uint8Array(pair.coarse).buffer);
  expect(fullReserve).toBeGreaterThan(coarseReserve);expect(fullReserve).toBeGreaterThan(full.bytes*5);
  const peak=new AssetPeakBudget(DEVICE_BUDGETS.compact.maxCacheBytes,()=>coarseReserve);expect(()=>peak.reserve('detail',fullReserve)).not.toThrow();
 });
 it('uses visibility, actual pixel demand and projected geometry area, with explicit focus',()=>{
  const image={kind:'image',visible:true,distance:3,occupancy:.1,projectedPixels:200,coarseTextureSize:512,focused:false};
  expect(detailDemand(image)).toBe(false);
  expect(detailDemand({...image,projectedPixels:900})).toBe(true);
  expect(detailDemand({...image,projectedPixels:900,distance:12})).toBe(false);
  expect(detailDemand({...image,focused:true})).toBe(true);
  expect(detailDemand({...image,focused:true,visible:false})).toBe(false);
  expect(detailDemand({...image,kind:'sculpture',occupancy:.08})).toBe(true);
  expect(detailDemand({...image,kind:'sculpture',occupancy:.01,projectedPixels:900})).toBe(false);
 });
 it('requires a sustained close view and retains detail over short look-away or threshold oscillations',()=>{
  const t=new DetailTransition();expect(t.update(true,0)).toBe(false);expect(t.update(true,299)).toBe(false);expect(t.update(true,300)).toBe(true);
  expect(t.update(false,400)).toBe(true);expect(t.update(true,600)).toBe(true);
  expect(t.update(false,700)).toBe(true);expect(t.update(false,2499)).toBe(true);expect(t.update(false,2500)).toBe(false);
 });
 it('counts resident old assets and every outstanding reservation, keeping cancelled decode charged until released',()=>{
  let resident=40;const peak=new AssetPeakBudget(100,()=>resident);
  peak.reserve('replacement',35);peak.reserve('other',20);expect(peak.total()).toBe(95);
  expect(()=>peak.reserve('third',6)).toThrow('ASSET_TRANSITION_PEAK');
  expect(()=>peak.reserve('replacement',41)).toThrow('ASSET_TRANSITION_PEAK');
  expect(peak.total()).toBe(95);peak.release('other');peak.reserve('replacement',45);expect(peak.total()).toBe(85);
  // Commit accounts new and old together before releasing the old decoded asset.
  peak.release('replacement');resident+=45;expect(peak.total()).toBe(85);resident-=40;expect(peak.total()).toBe(45);
 });
 it('releases an external load hold without dropping pinned bytes or in-flight reservations',()=>{
  const cache=new MemoryAssetCache<string>(10);cache.set('visible','visible',8);cache.acquire('visible');
  const peak=new AssetPeakBudget(15,()=>cache.stats().bytes);peak.reserve('replacement',5);
  expect(()=>peak.reserve('other',3)).toThrow('ASSET_TRANSITION_PEAK');
  cache.raiseLimit(20);peak.raiseLimit(25);peak.reserve('other',10);
  expect(peak.total()).toBe(23);expect(cache.get('visible')).toBe('visible');expect(cache.delete('visible')).toBe(false);
  expect(()=>cache.raiseLimit(19)).toThrow('CACHE_BUDGET_INVALID');expect(()=>peak.raiseLimit(24)).toThrow('ASSET_BUDGET_INVALID');
  expect(()=>peak.reserve('too-large',3)).toThrow('ASSET_TRANSITION_PEAK');
 });
 it('reserves source bitmap and resized mipmaps separately for bounded paintings',()=>{
  const a=syntheticArtwork('image'),asset=a.assets[0]!;asset.bytes=1000;
  const b=new ArrayBuffer(33),v=new DataView(b);v.setUint32(16,1401);v.setUint32(20,1098);
  expect(assetDecodeReserve(a,asset,DEVICE_BUDGETS.compact,b)).toBeGreaterThan(1401*1098*4+1000*3);
  v.setUint32(16,0);expect(()=>assetDecodeReserve(a,asset,DEVICE_BUDGETS.compact,b)).toThrow('IMAGE_DECODE_BUDGET');
 });
});


describe('shared attended artwork preparation',()=>{
 it('admits the recorded central 387px painting before the larger peripheral painting can claim attention',()=>{
  const central={id:'vg',kind:'image',visible:true,distance:2.944,occupancy:.05622,projectedPixels:387.19,coarseTextureSize:512,focused:false,gazeDistance:.03};
  const peripheral={...central,id:'rem',distance:3.676,occupancy:.0975,projectedPixels:590.32,gazeDistance:.8};
  expect(detailDemand(central)).toBe(true);expect(detailDemand(peripheral)).toBe(true);
  const owner=new ArtworkAttention(),candidates=[central,peripheral].map(v=>({...v,demand:detailDemand(v)}));
  owner.update(candidates,0);expect(owner.update(candidates,300)).toBe('vg');
  expect(owner.update([...candidates].reverse(),700)).toBe('vg');
  expect(detailDemand({...central,gazeDistance:.8})).toBe(false);
 });
 it('prepares a mixed nearby pair and excludes occluded/unrelated-room and far candidates',()=>{
  const item=(id:string,distance:number,eligible=true)=>({id,distance,eligible,demand:false,occupancy:0,focused:false});
  const items=[item('current-painting',1),item('same-wall-painting',2),item('near-door-sculpture',3),item('behind-wall-sculpture',.5,false),item('unrelated-room-painting',1,false),item('far-sculpture',9)];
  expect(nearbyPreparation(items,'current-painting')).toEqual(['same-wall-painting','near-door-sculpture']);
  expect(nearbyPreparation(items,undefined)).toEqual(['current-painting','same-wall-painting']);
  const owner=new ArtworkAttention();const sculpture={...item('sculpture',2),demand:true,gazeDistance:.02};
  owner.update([sculpture],0);expect(owner.update([sculpture],300)).toBe('sculpture');
 });
 it('keeps current pinned while expendable prepared/encoded assets make room under the same peak',()=>{
  const disposed:string[]=[],cache=new MemoryAssetCache<string>(100,v=>disposed.push(v));
  cache.set('current','current',40);cache.acquire('current');cache.set('prepared','prepared',20);cache.set('encoded','encoded',20);
  const peak=new AssetPeakBudget(100,()=>cache.stats().bytes);
  expect(()=>peak.reserve('new-current',35)).toThrow('ASSET_TRANSITION_PEAK');
  cache.delete('encoded');cache.delete('prepared');peak.reserve('new-current',35);
  expect(cache.get('current')).toBe('current');expect(disposed).toEqual(['encoded','prepared']);expect(peak.total()).toBe(75);
 });
 it('does not allow an aborted preparation generation to replace its new current request',async()=>{
  const started:string[]=[],finish=new Map<string,(v:string)=>void>(),discarded:string[]=[];
  const scheduler=new AssetScheduler<string>({concurrency:1,load:key=>{started.push(key);return new Promise(resolve=>finish.set(key,resolve));},onDiscard:v=>discarded.push(v)});
  const old=scheduler.request('asset/old',100);await tick();const rejected=expect(old).rejects.toMatchObject({name:'AbortError'});scheduler.cancel('asset/old');await rejected;
  const current=scheduler.request('asset/new',-100);await tick();expect(started).toEqual(['asset/old']);
  finish.get('asset/old')!('stale-prepared');await tick();expect(discarded).toEqual(['stale-prepared']);expect(started).toEqual(['asset/old','asset/new']);
  finish.get('asset/new')!('current');expect(await current).toBe('current');scheduler.dispose();
 });
});


describe('displayed detail pressure and generation isolation',()=>{
 it('promotes real nonsquare prepared textures using conservative integer resident bytes',()=>{
  for(const [width,height] of [[1792,1404],[512,401],[1948,2048]]){
   const estimate=textureResidentBytes(width!,height!)+280;
   expect(Number.isSafeInteger(estimate)).toBe(true);
   expect(estimate).toBeGreaterThanOrEqual(width!*height!*4*(1+4/3)+280);
   let resident=estimate+6000000;
   const peak=new AssetPeakBudget(94633984,()=>resident);
   resident-=estimate; // Transfer the same prepared object to the in-flight slot.
   expect(()=>peak.reserve('same-prepared',estimate)).not.toThrow();
   expect(peak.total()).toBe(estimate+6000000);
   peak.release('same-prepared');resident+=estimate;
   expect(peak.total()).toBe(estimate+6000000);
  }
 });
 it('promotes a queued preparation in place before peers and reclaims expendable memory only after promotion',async()=>{
  let resident=80;const peak=new AssetPeakBudget(100,()=>resident),started:string[]=[];
  let finish!:()=>void;const role={prepareOnly:true};
  const scheduler=new AssetScheduler<string>({concurrency:1,load:async key=>{
   started.push(key);
   if(key==='blocking')await new Promise<void>(resolve=>finish=resolve);
   if(key==='prepared'){
    if(!role.prepareOnly)resident-=30;
    peak.reserve(key,40);
   }
   return key;
  }});
  const blocking=scheduler.request('blocking');await tick();
  const peer=scheduler.request('peer',100),prepared=scheduler.request('prepared',100);
  role.prepareOnly=false;expect(scheduler.request('prepared',-100)).toBe(prepared);
  finish();await blocking;expect(await prepared).toBe('prepared');await peer;
  expect(started).toEqual(['blocking','prepared','peer']);
  expect(scheduler.stats()).toMatchObject({completed:3,failed:0,cancelled:0});
  expect(peak.total()).toBe(90);peak.release('prepared');scheduler.dispose();
 });
 const paired=(kind:'image'|'sculpture')=>{
  const artwork=syntheticArtwork(kind),full=artwork.assets[0]!,coarse={...full,id:crypto.randomUUID(),bytes:100};full.bytes=1000;artwork.assets.push(coarse);
  artwork.extensions={[LOD_NAMESPACE]:{version:1,variants:[{assetId:full.id,detail:'full',...(kind==='sculpture'?{triangles:100}:{textureSize:2048})},{assetId:coarse.id,detail:'coarse',...(kind==='sculpture'?{triangles:20}:{textureSize:512})}]}};
  return {artwork,full,coarse};
 };
 it('reclaims a visible legacy image by tier and never reuses its smaller same-ID texture for promotion',()=>{
  const artwork=syntheticArtwork('image'),assetId=artwork.assets[0]!.id;
  const item={id:'old',artwork,assetId,imageLimit:2048,visible:true,minimumRequired:true,lastAttended:0};
  expect(displayedDetailReclamation([item],'new',1799,DEVICE_BUDGETS.compact)).toBeUndefined();
  expect(displayedDetailReclamation([item],'new',1800,DEVICE_BUDGETS.compact)).toEqual({id:'old',evict:false,assetId});
  expect(reusableImageTier(512,2048)).toBe(false);
  expect(reusableImageTier(1024,2048)).toBe(false);
  expect(reusableImageTier(2048,512)).toBe(false);
  expect(reusableImageTier(512,512)).toBe(true);
  expect(keepsAttendedImageTier(2048,1024)).toBe(true);
  expect(keepsAttendedImageTier(1024,2048)).toBe(false);
  expect(displayedDetailReclamation([{...item,imageLimit:512}],'new',1800,DEVICE_BUDGETS.compact)).toBeUndefined();
 });
 it('makes current detail progress by ready-before-swap downgrading an old visible full neighbor, and allows a later revisit',()=>{
  const a=paired('image'),b=paired('sculpture'),displayed=new Map([['a',{asset:a.coarse.id,bytes:5}],['b',{asset:b.full.id,bytes:60}]]);
  const peak=new AssetPeakBudget(100,()=>[...displayed.values()].reduce((sum,v)=>sum+v.bytes,0));
  const candidates=()=>[{id:'a',artwork:a.artwork,assetId:displayed.get('a')!.asset,visible:true,lastAttended:2000},{id:'b',artwork:b.artwork,assetId:displayed.get('b')!.asset,visible:true,lastAttended:0}];
  expect(()=>peak.reserve('a-full',45)).toThrow('ASSET_TRANSITION_PEAK');
  expect(displayedDetailReclamation(candidates(),'a',1799,DEVICE_BUDGETS.desktop)).toBeUndefined();
  expect(displayedDetailReclamation(candidates(),'a',1800,DEVICE_BUDGETS.desktop)).toEqual({id:'b',evict:false,assetId:b.coarse.id});
  peak.reserve('b-coarse',10);expect(displayed.get('b')!.asset).toBe(b.full.id); // Old remains displayed during preparation.
  peak.release('b-coarse');displayed.set('b',{asset:b.coarse.id,bytes:5});
  peak.reserve('a-full',45);peak.release('a-full');displayed.set('a',{asset:a.full.id,bytes:60});
  expect(displayed.get('a')!.asset).toBe(a.full.id);
  // Turn back after grace: the same shared policy now protects B and reclaims A.
  expect(()=>peak.reserve('b-full',45)).toThrow('ASSET_TRANSITION_PEAK');
  expect(displayedDetailReclamation(candidates(),'b',3800,DEVICE_BUDGETS.desktop)).toEqual({id:'a',evict:false,assetId:a.coarse.id});
  peak.reserve('a-coarse',10);peak.release('a-coarse');displayed.set('a',{asset:a.coarse.id,bytes:5});
  expect(()=>peak.reserve('b-full',45)).not.toThrow();
 });
 it('promotes cached borrowed B while wall attention A keeps ticking, retaining both minima and one downgrade',async()=>{
  const a=paired('image'),b=paired('image'),displayed=new Map([['a',{asset:a.full.id,bytes:60}],['b',{asset:b.coarse.id,bytes:5}]]);
  const encoded=new MemoryAssetCache<string>(20);encoded.set(b.full.id,'verified-full-b',5);
  const peak=new AssetPeakBudget(100,()=>[...displayed.values()].reduce((sum,v)=>sum+v.bytes,0)+encoded.stats().bytes);
  const attention=new ArtworkAttention(),lastAttended=new Map<string,number>();
  let now=0,current:string|undefined,borrowed:string|undefined,alive=true,pending=false,attempts=0,downgradePending=false;
  const observeWall=()=>{if(!artworkDemandContext(current,borrowed).observeWall)return;current=attention.update([{id:'a',demand:true,focused:true,occupancy:.5}],now);if(current)lastAttended.set(current,now);};
  observeWall();now=300;observeWall();expect(current).toBe('a');borrowed='b';
  const candidates=()=>[...displayed].map(([id,value])=>({id,artwork:id==='a'?a.artwork:b.artwork,assetId:value.asset,visible:true,lastAttended:lastAttended.get(id)??-Infinity}));
  let finishDowngrade!:(value:string)=>void;const loads:string[]=[];
  const scheduler=new AssetScheduler<string>({concurrency:1,load:key=>{loads.push(key);peak.reserve(key,10);return new Promise(resolve=>{finishDowngrade=resolve;});}});
  const retry=createFlatDetailRetry({valid:()=>alive,pending:()=>pending,retryAfter:()=>0,now:()=>now,ready:()=>displayed.get('b')!.asset===b.full.id,request:()=>{
   attempts++;
   try{peak.reserve('b-full',45);pending=true;}
   catch{
    expect(encoded.get(b.full.id)).toBe('verified-full-b'); // Cached downloadOnly path: no second download.
    if(downgradePending)return;
    const choice=displayedDetailReclamation(candidates(),artworkDemandContext(current,borrowed).owner,now,DEVICE_BUDGETS.desktop);
    if(!choice)return;
    expect(choice).toEqual({id:'a',evict:false,assetId:a.coarse.id});downgradePending=true;
    void scheduler.request('a-coarse').then(()=>{peak.release('a-coarse');displayed.set('a',{asset:a.coarse.id,bytes:5});downgradePending=false;});
   }
  }});
  // Real repeated wall observations must not refresh A's grace while B borrows the renderer.
  for(now=500;now<=1900;now+=200){observeWall();retry();}
  expect(loads).toEqual([]);now=2100;observeWall();retry();await tick();
  expect(loads).toEqual(['a-coarse']);expect(lastAttended.get('a')).toBe(300);
  for(now=2300;now<=2700;now+=200){observeWall();retry();}
  expect(loads).toEqual(['a-coarse']);expect(displayed.get('a')!.asset).toBe(a.full.id);expect(displayed.get('b')!.asset).toBe(b.coarse.id);
  finishDowngrade('ready');await tick();retry();expect(pending).toBe(true);const admittedAttempts=attempts;
  for(let n=0;n<5;n++){observeWall();retry();}expect(attempts).toBe(admittedAttempts);
  expect(displayed.get('b')!.asset).toBe(b.coarse.id); // Borrowed image stays until its full replacement is ready.
  peak.release('b-full');displayed.set('b',{asset:b.full.id,bytes:60});pending=false;retry();expect(attempts).toBe(admittedAttempts);expect(peak.total()).toBeLessThanOrEqual(100);
  alive=false;borrowed=undefined;now=4000;observeWall();expect(lastAttended.get('a')).toBe(4000);retry();expect(attempts).toBe(admittedAttempts);
  expect(encoded.get(b.full.id)).toBe('verified-full-b');scheduler.dispose();
 });
 it('never manufactures a coarse tuple for visible full-only geometry and only evicts it offscreen after grace',()=>{
  const artwork=syntheticArtwork('sculpture'),assetId=artwork.assets[0]!.id,item={id:'full-only',artwork,assetId,visible:true,lastAttended:0};
  expect(displayedDetailReclamation([item],'current',2000,DEVICE_BUDGETS.desktop)).toBeUndefined();
  expect(displayedDetailReclamation([{...item,visible:false}],'current',1799,DEVICE_BUDGETS.desktop)).toBeUndefined();
  expect(displayedDetailReclamation([{...item,visible:false}],'current',1800,DEVICE_BUDGETS.desktop)).toEqual({id:'full-only',evict:true});
  // Turning away inside the current/connected room does not make its only real representation expendable.
  expect(displayedDetailReclamation([{...item,visible:false,minimumRequired:true}],'current',5000,DEVICE_BUDGETS.desktop)).toBeUndefined();
  expect(displayedDetailReclamation([{...item,visible:false}],'full-only',5000,DEVICE_BUDGETS.desktop)).toBeUndefined();
 });
 it('downgrades an offscreen authored pair without discarding its renderable work on a quick turn back',()=>{
  const {artwork,full,coarse}=paired('image');
  const item={id:'painting',artwork,assetId:full.id,visible:false,lastAttended:0};
  expect(displayedDetailReclamation([item],'current',1800,DEVICE_BUDGETS.desktop)).toEqual({id:'painting',evict:false,assetId:coarse.id});
  expect(displayedDetailReclamation([{...item,assetId:coarse.id}],'current',1800,DEVICE_BUDGETS.desktop)).toBeUndefined();
 });
 it('ignores a stale non-abort rejection without poisoning the succeeding request retry/failure state',()=>{
  const pending=new Map([['art','new-key']]),retryAfter=new Map<string,number>(),failed=new Set<string>();
  const reject=(key:string)=>{if(!settleAssetGeneration(pending,'art',key))return;retryAfter.set('art',Infinity);failed.add('art');};
  reject('old-key');expect(pending.get('art')).toBe('new-key');expect(retryAfter.size).toBe(0);expect(failed.size).toBe(0);
  reject('new-key');expect(pending.has('art')).toBe(false);expect(retryAfter.get('art')).toBe(Infinity);expect(failed.has('art')).toBe(true);
 });
});

it('keeps detail behind a memory-blocked minimum throughout retry grace, then releases only after admission or leaving its rooms',()=>{
 const minimum={visible:true,eligible:true,active:false,pending:true,budgetBlocked:false};
 expect(minimumDetailPending([minimum])).toBe(true);
 const waiting={...minimum,pending:false,budgetBlocked:true};
 expect(minimumDetailPending([waiting])).toBe(true);
 expect(minimumDetailPending([{...waiting,visible:false}])).toBe(true);
 expect(minimumDetailPending([{...waiting,active:true}])).toBe(false);
 expect(minimumDetailPending([{...waiting,visible:false,eligible:false}])).toBe(false);
 // A failed asset without a memory reservation is isolated rather than blocking independent detail forever.
 expect(minimumDetailPending([{...waiting,budgetBlocked:false}])).toBe(false);
});


function referenceExhibition():Exhibition {
 const root=new URL('../../../../demos/reference-exhibition/source/',import.meta.url),index=JSON.parse(readFileSync(new URL('static-publication-index.json',root),'utf8'));
 return JSON.parse(readFileSync(new URL(index.publication.path,root),'utf8')).exhibition;
}
it('keeps a single-GLB minimum across the empty two-door connector before painting detail',()=>{
 const doc=referenceExhibition(),image=doc.artworks.find(a=>a.artworkType==='image')!,sculpture=doc.artworks.find(a=>a.artworkType==='sculpture')!;
 const painting=doc.placements.find(p=>p.artworkRevisionId===image.revisionId)!,placed=doc.placements.find(p=>p.artworkRevisionId===sculpture.revisionId)!;
 const rooms=minimumRoomInterest(doc,painting.roomId),minimum=selectAssetVariant(sculpture,Infinity,DEVICE_BUDGETS.desktop);
 expect(rooms.has(placed.roomId.toLowerCase())).toBe(true);
 expect(lodVariantsFor(sculpture)).toHaveLength(1);expect(minimum.id).toBe(sculpture.primaryAssetId);
 expect(displayedDetailReclamation([{id:sculpture.revisionId,artwork:sculpture,assetId:minimum.id,visible:false,minimumRequired:rooms.has(placed.roomId.toLowerCase()),lastAttended:0}],image.revisionId,10000,DEVICE_BUDGETS.desktop)).toBeUndefined();
});
it('bounds the minimum room window at a populated neighbor and ignores broken door pairs',()=>{
 const doc=referenceExhibition(),image=doc.artworks.find(a=>a.artworkType==='image')!,sculpture=doc.artworks.find(a=>a.artworkType==='sculpture')!;
 const painting=doc.placements.find(p=>p.artworkRevisionId===image.revisionId)!,placed=doc.placements.find(p=>p.artworkRevisionId===sculpture.revisionId)!;
 const surfaces=new Map(doc.surfaces.map(s=>[s.id,s.roomId])),openings=new Map(doc.openings.map(o=>[o.id,o]));
 const direct=(roomId:string)=>new Set(doc.openings.filter(o=>surfaces.get(o.surfaceId)===roomId).map(o=>surfaces.get(openings.get(o.connectsToOpeningId??'')?.surfaceId??'')));
 const connector=doc.rooms.find(r=>!doc.placements.some(p=>p.roomId===r.id)&&direct(r.id).has(painting.roomId)&&direct(r.id).has(placed.roomId))!;
 const occupied=structuredClone(doc);occupied.placements.push({...structuredClone(placed),id:crypto.randomUUID(),roomId:connector.id});
 expect(minimumRoomInterest(occupied,painting.roomId).has(placed.roomId.toLowerCase())).toBe(false);
 const closed=structuredClone(doc);closed.openings=[];expect([...minimumRoomInterest(closed,painting.roomId)]).toEqual([painting.roomId.toLowerCase()]);
 expect(minimumRoomInterest(doc,crypto.randomUUID()).size).toBe(0);
});
it('admits a partial sculpture footprint through the real two-jamb geometry while preserving opaque-wall rejection',()=>{
 const walls:Three.Mesh[]=[];
 for(const x of [4,8])for(const [z,depth,y,height]of [[-10.1,3.8,2,4],[-3.9,3.8,2,4],[-7,2.4,3.5,1]] as const){
  const wall=new Three.Mesh(new Three.BoxGeometry(.12,height,depth),new Three.MeshBasicMaterial({side:Three.DoubleSide}));wall.position.set(x,y,z);wall.updateMatrixWorld(true);walls.push(wall);
 }
 const center=new Three.Vector3(13,1.1709545,-7),corners=Array.from({length:8},(_,i)=>new Three.Vector3(i&1?13.1742358:12.8257642,i&2?1.441909:.9,i&4?-6.8273684:-7.1726316));
 const clear=(from:Three.Vector3,to:Three.Vector3)=>{const d=to.clone().sub(from),length=d.length();return new Three.Raycaster(from,d.normalize(),.05,length-.15).intersectObjects(walls).length===0;};
 const partial=new Three.Vector3(.05893,1.66095,-8.74768),opaque=new Three.Vector3(0,1.66,-9.6);
 expect(clear(partial,center)).toBe(false);expect(minimumFootprintVisible(corners,false,p=>clear(partial,p))).toBe(true);
 expect(minimumFootprintVisible(corners,clear(opaque,center),p=>clear(opaque,p))).toBe(false);
 let probes=0;expect(minimumFootprintVisible(corners,true,()=>{probes++;return false;})).toBe(true);expect(probes).toBe(0);
 minimumFootprintVisible([...corners,...corners],false,()=>{probes++;return false;});expect(probes).toBe(8);
 for(const wall of walls){wall.geometry.dispose();(wall.material as Three.Material).dispose();}
});

it('retained decoder backing remains charged across cache eviction without counting an identical pinned allocation twice',()=>{
 const cache=new MemoryAssetCache<ArrayBuffer>(8),original=new ArrayBuffer(4),rewritten=new ArrayBuffer(4);
 cache.set('original',original,4);const same=retainEncodedBuffer(cache,'original',original);expect(same.retainedBytes+cache.stats().bytes).toBe(4);expect(cache.delete('original')).toBe(false);
 // Two live owners share the exact pinned allocation; releasing one twice
 // must not unpin the second owner or permit an eviction underneath it.
 const second=retainEncodedBuffer(cache,'original',original);same.dispose();same.dispose();expect(cache.delete('original')).toBe(false);second.dispose();expect(cache.delete('original')).toBe(true);
 const uncached=retainEncodedBuffer(cache,'original',original);expect(uncached.retainedBytes+cache.stats().bytes).toBe(4);uncached.dispose();
 cache.set('original',original,4);const independent=retainEncodedBuffer(cache,'original',rewritten);expect(independent.retainedBytes+cache.stats().bytes).toBe(8);expect(cache.delete('original')).toBe(true);expect(independent.retainedBytes+cache.stats().bytes).toBe(4);independent.dispose();
});

it('bounds a legacy single PNG before one-painting promotion without changing its ordinary path',()=>{
 const art=syntheticArtwork('image'),asset=art.assets[0]!,bytes=new ArrayBuffer(33),v=new DataView(bytes);
 new Uint8Array(bytes).set([137,80,78,71,13,10,26,10]);v.setUint32(8,13);v.setUint32(12,0x49484452);v.setUint32(16,2048);v.setUint32(20,1024);v.setUint8(24,8);v.setUint8(25,6);
 expect(checkImageDecode(bytes,art,asset,DEVICE_BUDGETS.compact)).toBeUndefined();
 expect(checkImageDecode(bytes,art,asset,DEVICE_BUDGETS.desktop,true)).toEqual({width:2048,height:1024});
 v.setUint32(16,2049);expect(()=>checkImageDecode(bytes,art,asset,DEVICE_BUDGETS.desktop,true)).toThrow('IMAGE_DECODE_BUDGET');
});
