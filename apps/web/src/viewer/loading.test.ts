import { describe, it, expect } from "vitest";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { AssetScheduler, MemoryAssetCache, DEVICE_BUDGETS, selectAssetVariant, fetchVerifiedAsset, checkImageDecode, detailScreenBounds, detailDemand, DetailTransition, ArtworkAttention, nearbyPreparation, displayedDetailReclamation, settleAssetGeneration, imageFullDecodeCeiling, AssetPeakBudget, assetDecodeReserve } from "./loading";
import { syntheticArtwork } from "../placement/model";
import { LOD_NAMESPACE, validateViewerLod } from "@exhibitos/studio-contract";
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
  expect(fullReserve).toBeGreaterThan(coarseReserve);expect(fullReserve).toBeGreaterThan(full.bytes*5+8*3*64*2);
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
 const paired=(kind:'image'|'sculpture')=>{
  const artwork=syntheticArtwork(kind),full=artwork.assets[0]!,coarse={...full,id:crypto.randomUUID(),bytes:100};full.bytes=1000;artwork.assets.push(coarse);
  artwork.extensions={[LOD_NAMESPACE]:{version:1,variants:[{assetId:full.id,detail:'full',...(kind==='sculpture'?{triangles:100}:{textureSize:2048})},{assetId:coarse.id,detail:'coarse',...(kind==='sculpture'?{triangles:20}:{textureSize:512})}]}};
  return {artwork,full,coarse};
 };
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
 it('never manufactures a coarse tuple for visible full-only geometry and only evicts it offscreen after grace',()=>{
  const artwork=syntheticArtwork('sculpture'),assetId=artwork.assets[0]!.id,item={id:'full-only',artwork,assetId,visible:true,lastAttended:0};
  expect(displayedDetailReclamation([item],'current',2000,DEVICE_BUDGETS.desktop)).toBeUndefined();
  expect(displayedDetailReclamation([{...item,visible:false}],'current',1799,DEVICE_BUDGETS.desktop)).toBeUndefined();
  expect(displayedDetailReclamation([{...item,visible:false}],'current',1800,DEVICE_BUDGETS.desktop)).toEqual({id:'full-only',evict:true});
  expect(displayedDetailReclamation([{...item,visible:false}],'full-only',5000,DEVICE_BUDGETS.desktop)).toBeUndefined();
 });
 it('ignores a stale non-abort rejection without poisoning the succeeding request retry/failure state',()=>{
  const pending=new Map([['art','new-key']]),retryAfter=new Map<string,number>(),failed=new Set<string>();
  const reject=(key:string)=>{if(!settleAssetGeneration(pending,'art',key))return;retryAfter.set('art',Infinity);failed.add('art');};
  reject('old-key');expect(pending.get('art')).toBe('new-key');expect(retryAfter.size).toBe(0);expect(failed.size).toBe(0);
  reject('new-key');expect(pending.has('art')).toBe(false);expect(retryAfter.get('art')).toBe(Infinity);expect(failed.has('art')).toBe(true);
 });
});
