// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Artwork, Exhibition } from "@exhibitos/spec";
import { lodVariantsFor } from "@exhibitos/studio-contract";
export interface DeviceBudget { concurrency:number;maxPixelRatio:number;maxTextureSize:number;maxTriangles:number;maxCacheBytes:number;entranceAssets:number }
export const DEVICE_BUDGETS:Readonly<Record<"compact"|"desktop",DeviceBudget>>={
 compact:{concurrency:2,maxPixelRatio:1,maxTextureSize:512,maxTriangles:20000,maxCacheBytes:32*1024*1024,entranceAssets:4},
 desktop:{concurrency:3,maxPixelRatio:1.5,maxTextureSize:2048,maxTriangles:100000,maxCacheBytes:96*1024*1024,entranceAssets:4},
};
export function deviceBudget(input:{viewportWidth:number;deviceMemory?:number;pixelRatio?:number}):DeviceBudget {return {...DEVICE_BUDGETS[input.viewportWidth<768||(input.deviceMemory!==undefined&&input.deviceMemory<=4)?"compact":"desktop"]};}
export function prioritizePlacements(doc:Exhibition,roomId:string,position:[number,number,number]) {return [...doc.placements].sort((a,b)=>{const score=(p:Exhibition["placements"][number])=>(p.roomId.toLowerCase()===roomId.toLowerCase()?0:1e12)+p.transform.position.reduce((n,v,i)=>n+(v-position[i]!)**2,0);return score(a)-score(b)||a.id.localeCompare(b.id);});}
export function selectAssetVariant(artwork:Artwork,distance:number,budget:DeviceBudget):Artwork["assets"][number] {
 const variants=lodVariantsFor(artwork),full=variants.find(v=>v.detail==="full"),coarse=variants.find(v=>v.detail==="coarse");
 const fits=(v:typeof full)=>!!v&&(v.triangles===undefined||v.triangles<=budget.maxTriangles)&&(v.textureSize===undefined||v.textureSize<=budget.maxTextureSize);
 let selected=coarse&&(distance>2||!fits(full))&&fits(coarse)?coarse:fits(full)?full:undefined;
 // Images already resize uniformly before GPU upload. Permit only a small,
 // bounded source when no authored variant fits; model limits stay unchanged.
 if(!selected&&artwork.artworkType==='image'){
  // An authored pair never substitutes its large full source for an unusable
  // compact coarse reference. Legacy single-image resizing remains unchanged.
  selected=[coarse??full].find(variant=>{
   if(variant?.textureSize===undefined||variant.textureSize>2048)return false;
   const asset=artwork.assets.find(a=>a.id.toLowerCase()===variant.assetId.toLowerCase());
   const peak=Math.min(variant.textureSize**2,2097152)*4+(asset?.bytes??Infinity)+budget.maxTextureSize**2*4*4/3;
   return asset?.mime==='image/png'&&asset.bytes<=8388608&&peak<=(budget.maxCacheBytes-2097152)/budget.concurrency;
  });
 }
 if(!selected)throw new Error("ASSET_BUDGET_EXCEEDED");
 const asset=artwork.assets.find(a=>a.id.toLowerCase()===selected.assetId.toLowerCase());
 if(!asset)throw new Error("VARIANT_REFERENCE");return asset;
}
export function authoredImagePair(artwork:Artwork){
 if(artwork.artworkType!=='image')return undefined;
 const variants=lodVariantsFor(artwork),full=variants.find(v=>v.detail==='full'),coarse=variants.find(v=>v.detail==='coarse');
 return full&&coarse?{full,coarse}:undefined;
}
/** Includes encoded cache/copies, worst declared source bitmap, temporary
 * bitmap and mipmapped texture. Actual header dimensions refine it after fetch. */
export function imageFullDecodeCeiling(artwork:Artwork,inventory:Artwork['assets'][number],budget:DeviceBudget){
 const pair=authoredImagePair(artwork);if(!pair||inventory.id.toLowerCase()!==pair.full.assetId.toLowerCase())return undefined;
 const edge=pair.full.textureSize;
 if(!edge||edge>Math.min(2048,budget.maxTextureSize)||inventory.bytes>8388608)throw Error('IMAGE_DECODE_BUDGET');
 return Math.ceil(inventory.bytes*4+edge*edge*4*(2+4/3));
}
/** Demand is measured in screen pixels for paintings, projected area for geometry. */
export function detailScreenBounds(input:{corners:ReadonlyArray<{x:number;y:number;z:number;depth:number}>;near:number;intersectsFrustum:boolean;width:number;height:number}){
 const hidden={visible:false,occupancy:0,projectedPixels:0,gazeDistance:Infinity};
 if(!input.intersectsFrustum||!input.corners.length)return hidden;
 if(input.corners.some(p=>p.depth>-input.near)&&input.corners.some(p=>p.depth<=-input.near))return {visible:true,occupancy:1,projectedPixels:Math.max(input.width,input.height),gazeDistance:0};
 if(input.corners.some(p=>![p.x,p.y,p.z].every(Number.isFinite)||p.z< -1||p.z>1))return hidden;
 const left=Math.min(...input.corners.map(p=>p.x)),right=Math.max(...input.corners.map(p=>p.x)),bottom=Math.min(...input.corners.map(p=>p.y)),top=Math.max(...input.corners.map(p=>p.y));
 if(right< -1||left>1||top< -1||bottom>1)return hidden;
 return {visible:true,occupancy:Math.max(0,Math.min(1,right)-Math.max(-1,left))*Math.max(0,Math.min(1,top)-Math.max(-1,bottom))/4,projectedPixels:Math.max((right-left)*input.width/2,(top-bottom)*input.height/2),gazeDistance:Math.hypot((left+right)/2,(top+bottom)/2)};
}
export function detailDemand(input:{kind:string;visible:boolean;distance:number;occupancy:number;projectedPixels:number;coarseTextureSize?:number;gazeDistance?:number;focused:boolean}):boolean {
 if(!input.visible||!Number.isFinite(input.distance)||input.distance<=0)return false;
 if(input.focused)return true;
 return input.distance<=6 && (input.kind==='image'
  ? input.occupancy>=.025 && input.projectedPixels>=(input.coarseTextureSize??512)*((input.gazeDistance??Infinity)<=.35?.65:.85)
  : input.occupancy>=.075);
}
/** Avoid switching on a passing glance, and retain detail across short view changes. */
export class DetailTransition {
 private full=false;private changedAt:number|undefined;private lastDemand=false;
 update(demand:boolean,now:number):boolean {
  if(demand!==this.lastDemand){this.lastDemand=demand;this.changedAt=now;}
  if(this.changedAt===undefined)this.changedAt=now;
  if(demand!==this.full&&now-this.changedAt>=(demand?300:1800))this.full=demand;
  return this.full;
 }
}
export interface AttentionCandidate { id:string; demand:boolean; occupancy:number; focused:boolean; gazeDistance?:number; distance?:number; eligible?:boolean }
/** One stable attended artwork across both media; preparation shares its ordering. */
export class ArtworkAttention {
 private owner:string|undefined;private candidate:string|undefined;private since=0;
 current(){return this.owner;}
 update(items:ReadonlyArray<AttentionCandidate>,now:number){
  const best=[...items].filter(v=>v.demand&&v.eligible!==false).sort((a,b)=>Number(b.focused)-Number(a.focused)||(a.gazeDistance??Infinity)-(b.gazeDistance??Infinity)||b.occupancy-a.occupancy||Number(b.id===this.owner)-Number(a.id===this.owner)||a.id.localeCompare(b.id))[0]?.id;
  if(best===this.owner){this.candidate=undefined;return this.owner;}
  if(best===undefined){this.owner=undefined;this.candidate=undefined;return undefined;}
  if(best!==this.candidate){this.candidate=best;this.since=now;}
  if(now-this.since>=300){this.owner=best;this.candidate=undefined;}
  return this.owner;
 }
}
/** At most two plausible short-move/turn neighbors, without a media-specific quota. */
export function nearbyPreparation(items:ReadonlyArray<AttentionCandidate>,current:string|undefined){
 // Walking/turning can leave no attended artwork. Keep the bounded nearby
 // preparation alive so the first focused work need not start from a cold load.
 return [...items].filter(v=>v.id!==current&&v.eligible&&Number.isFinite(v.distance)&&(v.distance??Infinity)<=6)
  .sort((a,b)=>Number(b.demand)-Number(a.demand)||(a.distance!-b.distance!)||(a.gazeDistance??Infinity)-(b.gazeDistance??Infinity)||a.id.localeCompare(b.id)).slice(0,2).map(v=>v.id);
}
/** Claim settlement only for the exact request that still owns this artwork. */
export function settleAssetGeneration(pending:Map<string,string>,artId:string,key:string){
 if(pending.get(artId)!==key)return false;
 pending.delete(artId);return true;
}
/** A memory retry delay does not grant detail work priority over an eligible missing minimum. */
export function minimumDetailPending(items:ReadonlyArray<{visible:boolean;eligible:boolean;active:boolean;pending:boolean;budgetBlocked:boolean}>){
 return items.some(v=>(v.visible||v.eligible)&&!v.active&&(v.pending||v.budgetBlocked));
}
/** Minimum-only room window: current room, paired-door neighbors, and one empty connector.
 * Never traverses a second populated gallery or recursively walks the exhibition. */
export function minimumRoomInterest(document:Exhibition,currentRoomId:string|undefined):ReadonlySet<string>{
 const known=new Set(document.rooms.map(r=>r.id.toLowerCase())),current=currentRoomId?.toLowerCase(),result=new Set<string>();
 if(!current||!known.has(current))return result;
 const surfaces=new Map(document.surfaces.filter(s=>s.type==='wall').map(s=>[s.id.toLowerCase(),s.roomId.toLowerCase()]));
 const openings=new Map(document.openings.map(o=>[o.id.toLowerCase(),o])),adjacent=new Map<string,Set<string>>();
 for(const door of document.openings){
  const pair=door.connectsToOpeningId&&openings.get(door.connectsToOpeningId.toLowerCase());
  if(door.type!=='door'||!pair||pair.type!=='door'||pair.connectsToOpeningId?.toLowerCase()!==door.id.toLowerCase())continue;
  const a=surfaces.get(door.surfaceId.toLowerCase()),b=surfaces.get(pair.surfaceId.toLowerCase());
  if(!a||!b||a===b||!known.has(a)||!known.has(b))continue;
  const links=adjacent.get(a)??new Set<string>();links.add(b);adjacent.set(a,links);
 }
 result.add(current);const occupied=new Set(document.placements.map(p=>p.roomId.toLowerCase()));
 for(const next of adjacent.get(current)??[]){result.add(next);if(!occupied.has(next))for(const beyond of adjacent.get(next)??[])result.add(beyond);}
 return result;
}
/** Center-ray failure is not whole-bounds occlusion. Called only after the existing frustum test. */
export function minimumFootprintVisible<T>(corners:ReadonlyArray<T>,centerClear:boolean,clear:(point:T)=>boolean){
 return centerClear||corners.slice(0,8).some(point=>clear(point));
}
/** Pressure may reclaim one old displayed detail, never the attended object.
 * Prefer a real coarse replacement even offscreen, preserving a quick turn back. */
export function displayedDetailReclamation(items:ReadonlyArray<{id:string;artwork:Artwork;assetId:string;visible:boolean;minimumRequired?:boolean;lastAttended:number}>,current:string|undefined,now:number,budget:DeviceBudget){
 if(!current)return undefined;
 for(const item of [...items].sort((a,b)=>Number(a.visible)-Number(b.visible)||a.lastAttended-b.lastAttended||a.id.localeCompare(b.id))){
  if(item.id===current||now-item.lastAttended<1800)continue;
  let full;try{full=lodVariantsFor(item.artwork).find(v=>v.detail==='full');}catch{continue;}
  if(full?.assetId.toLowerCase()!==item.assetId.toLowerCase())continue;
  try{
   const coarse=selectAssetVariant(item.artwork,Infinity,budget);
   if(coarse.id.toLowerCase()!==item.assetId.toLowerCase())return {id:item.id,evict:false as const,assetId:coarse.id};
  }catch{/* No real supported replacement: retain the visible object. */}
  if(!item.visible&&!item.minimumRequired)return {id:item.id,evict:true as const};
 }
 return undefined;
}
export class AssetPeakBudget {
 private reservations=new Map<string,number>();
 constructor(private maxBytes:number,private resident:()=>number){}
 reserve(key:string,bytes:number){
  if(!Number.isSafeInteger(bytes)||bytes<0||this.total(key)+bytes>this.maxBytes)throw Error('ASSET_TRANSITION_PEAK');
  this.reservations.set(key,bytes);
 }
 release(key:string){this.reservations.delete(key);}
 total(except?:string){return this.resident()+[...this.reservations].reduce((n,[key,bytes])=>n+(key===except?0:bytes),0);}
}
/** CPU bitmap plus mipmapped GPU texture, rounded up to integral bytes so a
 * prepared object's later reservation uses the same conservative byte unit. */
export function textureResidentBytes(width:number,height:number){
 return Math.ceil(width*height*4*(1+4/3));
}
/** Conservative additional fetch/decode peak; resident old/new assets are separate. */
export function assetDecodeReserve(artwork:Artwork,inventory:Artwork['assets'][number],budget:DeviceBudget,bytes:ArrayBuffer):number {
 const variant=lodVariantsFor(artwork).find(v=>v.assetId.toLowerCase()===inventory.id.toLowerCase());
 if(artwork.artworkType==='image'){
  const header=new DataView(bytes);if(bytes.byteLength<24)throw Error('IMAGE_DECODE_BUDGET');
  const w=header.getUint32(16),h=header.getUint32(20);if(!w||!h)throw Error('IMAGE_DECODE_BUDGET');
  const scale=Math.min(1,budget.maxTextureSize/Math.max(w,h));
  // Encoded chunks/concatenation/hash, source bitmap, resized bitmap + mipmapped GPU texture.
  return Math.ceil(inventory.bytes*3+w*h*4+Math.ceil(w*scale)*Math.ceil(h*scale)*4*(1+4/3));
 }
 const header=new DataView(bytes);if(bytes.byteLength<20||header.getUint32(0,true)!==0x46546c67||header.getUint32(16,true)!==0x4e4f534a)throw Error('DECODE_BUDGET_EXCEEDED');
 const length=header.getUint32(12,true);if(length>bytes.byteLength-20)throw Error('DECODE_BUDGET_EXCEEDED');
 const glb=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,length))) as {images?:Array<{bufferView?:number;mimeType?:string}>;textures?:Array<{source:number}>;bufferViews?:Array<{byteOffset?:number;byteLength:number}>};
 let textureBytes=0;
 for(const [index,image] of (glb.images??[]).entries()){
  const view=image.bufferView===undefined?undefined:glb.bufferViews?.[image.bufferView];
  const offset=28+length+(view?.byteOffset??0);
  if(!view||view.byteLength<28||offset+view.byteLength>bytes.byteLength)throw Error('DECODE_BUDGET_EXCEEDED');
  const png=image.mimeType==='image/png',ktx=image.mimeType==='image/ktx2';if(!png&&!ktx)throw Error('DECODE_BUDGET_EXCEEDED');
  const w=header.getUint32(offset+(png?16:20),ktx),h=header.getUint32(offset+(png?20:24),ktx);
  if(!w||!h||Math.max(w,h)>Math.min(variant?.textureSize??budget.maxTextureSize,budget.maxTextureSize))throw Error('DECODE_BUDGET_EXCEEDED');
  const copies=Math.max(1,(glb.textures??[]).filter(t=>t.source===index).length);
  textureBytes+=copies*w*h*4*(1+4/3);
 }
 // Include encoded/parsed and geometry CPU/GPU copies, every embedded image's CPU/GPU allocation.
 return Math.ceil(inventory.bytes*5+(variant?.triangles??budget.maxTriangles)*3*64*2+textureBytes);
}
/** Header allocation guard before the browser decoder; hash/profile admission is separate. */
export function checkImageDecode(bytes:ArrayBuffer,artwork:Artwork,inventory:Artwork['assets'][number],budget:DeviceBudget){
 const declared=lodVariantsFor(artwork).find(v=>v.assetId.toLowerCase()===inventory.id.toLowerCase())?.textureSize;
 const desktopPair=budget.maxTextureSize>=2048&&!!authoredImagePair(artwork);
 if(!desktopPair&&(declared===undefined||declared<=budget.maxTextureSize))return;
 const p=new DataView(bytes),signature=[137,80,78,71,13,10,26,10];
 if(bytes.byteLength<33||bytes.byteLength>8388608||signature.some((n,i)=>p.getUint8(i)!==n)||p.getUint32(8)!==13||p.getUint32(12)!==0x49484452||p.getUint8(24)!==8||![2,6].includes(p.getUint8(25))||p.getUint8(26)!==0||p.getUint8(27)!==0||p.getUint8(28)!==0)throw Error('IMAGE_DECODE_BUDGET');
 const w=p.getUint32(16),h=p.getUint32(20);
 if(!w||!h||w>Math.min(declared??0,2048)||h>Math.min(declared??0,2048)||w*h>(desktopPair?4194304:2097152))throw Error('IMAGE_DECODE_BUDGET');
 return {width:w,height:h};
}
export type LoadingStatus="queued"|"loading"|"loaded"|"error"|"cancelled";
export interface LoadingEvent {key:string;status:LoadingStatus;error?:unknown}
export interface SchedulerStats {active:number;queued:number;completed:number;failed:number;cancelled:number}
interface Task<T> {key:string;priority:number;order:number;controller:AbortController;promise:Promise<T>;resolve:(v:T)=>void;reject:(e:unknown)=>void;status:LoadingStatus;settled:boolean}
const cancelled=()=>new DOMException("Asset loading cancelled","AbortError");
export class AssetScheduler<T> {
 private readonly tasks=new Map<string,Task<T>>();private active=0;private order=0;private completed=0;private failed=0;private cancelled=0;private stopped=false;
 constructor(private readonly options:{concurrency:number;load:(key:string,signal:AbortSignal)=>Promise<T>;onState?:(event:LoadingEvent)=>void;onDiscard?:(value:T)=>void}){if(!Number.isInteger(options.concurrency)||options.concurrency<1||options.concurrency>8)throw Error("CONCURRENCY_INVALID");}
 request(key:string,priority=0):Promise<T>{if(this.stopped)return Promise.reject(cancelled());if(!Number.isFinite(priority))return Promise.reject(Error("PRIORITY_INVALID"));const existing=this.tasks.get(key);if(existing){if(existing.status==="queued")existing.priority=Math.min(existing.priority,priority);return existing.promise;}
 let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});const task:Task<T>={key,priority,order:this.order++,controller:new AbortController(),promise,resolve,reject,status:"queued",settled:false};this.tasks.set(key,task);this.emit(task,"queued");queueMicrotask(()=>this.drain());return promise;}
 retry(key:string,priority=0){this.cancel(key);return this.request(key,priority);}
 cancel(key:string){const task=this.tasks.get(key);if(!task||task.settled)return;task.settled=true;task.controller.abort();task.reject(cancelled());this.cancelled++;this.emit(task,"cancelled");this.tasks.delete(key);queueMicrotask(()=>this.drain());}
 cancelAll(){for(const key of this.tasks.keys())this.cancel(key);}
 dispose(){this.stopped=true;this.cancelAll();}
 stats():SchedulerStats{return {active:this.active,queued:[...this.tasks.values()].filter(t=>t.status==="queued").length,completed:this.completed,failed:this.failed,cancelled:this.cancelled};}
 private emit(task:Task<T>,status:LoadingStatus,error?:unknown){task.status=status;this.options.onState?.({key:task.key,status,...(error===undefined?{}:{error})});}
 private drain(){if(this.stopped)return;while(this.active<this.options.concurrency){const task=[...this.tasks.values()].filter(t=>t.status==="queued").sort((a,b)=>a.priority-b.priority||a.order-b.order)[0];if(!task)return;this.active++;this.emit(task,"loading");void this.run(task);}}
 private async run(task:Task<T>){try{const value=await this.options.load(task.key,task.controller.signal);if(task.settled||this.stopped){this.options.onDiscard?.(value);return;}task.settled=true;this.completed++;this.emit(task,"loaded");task.resolve(value);}catch(error){if(!task.settled){task.settled=true;this.failed++;this.emit(task,"error",error);task.reject(error);}}finally{this.active--;if(this.tasks.get(task.key)===task)this.tasks.delete(task.key);this.drain();}}
}
interface Cached<T> {value:T;bytes:number;pins:number;order:number}
export class MemoryAssetCache<T> {
 private entries=new Map<string,Cached<T>>();private used=0;private order=0;private evictions=0;
 constructor(readonly maxBytes:number,private readonly onDispose:(value:T)=>void=()=>{}){if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw Error("CACHE_BUDGET_INVALID");}
 get(key:string):T|undefined{const entry=this.entries.get(key);if(!entry)return;entry.order=this.order++;return entry.value;}
 acquire(key:string):T|undefined{const value=this.get(key);if(value!==undefined)this.entries.get(key)!.pins++;return value;}
 release(key:string){const entry=this.entries.get(key);if(entry&&entry.pins>0)entry.pins--;}
 set(key:string,value:T,bytes:number):boolean{if(!Number.isSafeInteger(bytes)||bytes<0)throw Error("CACHE_SIZE_INVALID");const previous=this.entries.get(key);if(previous?.pins)throw Error("CACHE_PINNED");if(previous)this.delete(key);if(bytes>this.maxBytes){this.onDispose(value);return false;}
 while(this.used+bytes>this.maxBytes){const oldest=[...this.entries.entries()].filter(([,e])=>e.pins===0).sort((a,b)=>a[1].order-b[1].order)[0];if(!oldest){this.onDispose(value);return false;}this.delete(oldest[0]);this.evictions++;}
 this.entries.set(key,{value,bytes,pins:0,order:this.order++});this.used+=bytes;return true;}
 delete(key:string):boolean{const entry=this.entries.get(key);if(!entry||entry.pins)return false;this.entries.delete(key);this.used-=entry.bytes;this.onDispose(entry.value);return true;}
 /** Teardown only: detach active GPU resources and cancel loaders before clearing pinned entries. */
 clear(){for(const entry of this.entries.values())this.onDispose(entry.value);this.entries.clear();this.used=0;}
 stats(){return {entries:this.entries.size,bytes:this.used,maxBytes:this.maxBytes,pinned:[...this.entries.values()].filter(e=>e.pins>0).length,evictions:this.evictions};}
}
export async function fetchVerifiedAsset(input:{publicationId:string;revisionSha256:string;asset:{assetId:string;url:string;mime:string};inventory:{id:string;mime:string;sha256:string;bytes:number};signal:AbortSignal;fetcher?:typeof fetch;check?:()=>Promise<void>;maxBytes?:number}):Promise<ArrayBuffer> {
 const {publicationId,revisionSha256,asset,inventory,signal}=input,uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 if(!uuid.test(publicationId)||!uuid.test(asset.assetId)||asset.assetId!==inventory.id||asset.url!==`/api/v1/publications/${publicationId}/assets/${asset.assetId}`||asset.mime!==inventory.mime||!/^[a-f0-9]{64}$/.test(revisionSha256)||!/^[a-f0-9]{64}$/.test(inventory.sha256)||!Number.isSafeInteger(inventory.bytes)||inventory.bytes<1||inventory.bytes>Math.min(input.maxBytes??33554432,33554432))throw Error("ASSET_CONTRACT_INVALID");
 await input.check?.();
 const response=await (input.fetcher??fetch)(asset.url,{credentials:"omit",cache:"no-store",signal});
 if(!response.ok)throw Error(`ASSET_HTTP_${response.status}`);if(response.headers.get("x-exhibitos-publication-revision")!==revisionSha256||response.headers.get("content-type")?.split(";")[0]!==inventory.mime)throw Error("ASSET_RESPONSE_INVALID");
 const reader=response.body?.getReader();if(!reader)throw Error("ASSET_BODY_MISSING");const chunks:Uint8Array[]=[];let length=0;const onAbort=()=>{void reader.cancel(signal.reason).catch(()=>{});};signal.addEventListener("abort",onAbort,{once:true});
 try{for(;;){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>inventory.bytes)throw Error("ASSET_INTEGRITY");chunks.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{signal.removeEventListener("abort",onAbort);reader.releaseLock();}
 signal.throwIfAborted();if(length!==inventory.bytes)throw Error("ASSET_INTEGRITY");const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 const hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(v=>v.toString(16).padStart(2,"0")).join("");if(hash!==inventory.sha256)throw Error("ASSET_INTEGRITY");await input.check?.();return bytes.buffer;
}
