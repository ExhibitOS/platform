// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Artwork, Exhibition } from "@exhibitos/spec";
import { lodVariantsFor,ordinaryPngRoleSet } from "@exhibitos/studio-contract";
export interface DeviceBudget { concurrency:number;maxPixelRatio:number;maxTextureSize:number;maxTriangles:number;maxCacheBytes:number;maxTransitionBytes?:number;entranceAssets:number;selectedImage?:Readonly<{maxCacheBytes:number;maxTransitionBytes:number}> }
export const DEVICE_BUDGETS:Readonly<Record<"compact"|"desktop",DeviceBudget>>={
 compact:{concurrency:2,maxPixelRatio:1,maxTextureSize:512,maxTriangles:20000,maxCacheBytes:32*1024*1024,entranceAssets:4},
 desktop:{concurrency:3,maxPixelRatio:1.5,maxTextureSize:2048,maxTriangles:100000,maxCacheBytes:96*1024*1024,entranceAssets:4},
};
/** Canvas width is a resolution/layout input, not a device capacity signal.
 * Keep the existing standard default and constrained-memory preset; neither
 * preset is a measured hardware guarantee. */
function selectedImageCapacity(budget:DeviceBudget,memory:number|undefined):DeviceBudget {
 // A deliberate full-image selection may borrow the standard-device starting
 // allowance only above the existing known constrained-memory threshold. It never grows ordinary
 // scene/cache budgets, or grants new capacity to unknown/constrained devices.
 return {...budget,...(memory!==undefined&&Number.isFinite(memory)&&memory>4?{selectedImage:{maxCacheBytes:Math.max(budget.maxCacheBytes,96*1024*1024),maxTransitionBytes:Math.max(budget.maxTransitionBytes??budget.maxCacheBytes,128*1024*1024)}}:{})};
}
export function deviceBudget(input:{viewportWidth?:number;deviceMemory?:number;pixelRatio?:number;coarsePointer?:boolean;finePointer?:boolean}):DeviceBudget {
 const memory=input.deviceMemory;
 const budget=DEVICE_BUDGETS[memory!==undefined&&memory<=4?'compact':'desktop'];
 // Limits bound tracked allocations. They do not reserve memory up front.
 if(memory!==undefined&&Number.isFinite(memory)&&memory>=8)
  return selectedImageCapacity({...budget,maxCacheBytes:192*1024*1024,maxTransitionBytes:256*1024*1024},memory);
 // Browsers without a memory hint can still need overlap for a visible
 // minimum. Bound touch auto headroom without changing texture admission.
 if(memory===undefined&&input.coarsePointer)return {...budget,maxCacheBytes:112*1024*1024,maxTransitionBytes:128*1024*1024};
 // An explicit fine-pointer Auto session without a memory hint uses the same
 // bounded allocation allowance as the existing detailed desktop setting.
 // Triangle and texture limits stay at the ordinary desktop profile.
 if(memory===undefined&&input.coarsePointer===false&&input.finePointer===true)return {...budget,maxCacheBytes:192*1024*1024,maxTransitionBytes:256*1024*1024};
 if(memory===4)return {...budget,maxCacheBytes:48*1024*1024,maxTransitionBytes:64*1024*1024};
 return selectedImageCapacity(budget,memory);
}
/** Explicit high-quality choice permits more triangles than Auto. Known
 * constrained devices retain their existing limits. Explicit desktop uses the
 * development starting budget (192 MiB steady / 256 MiB transition); actual
 * allocations and coexistence still have to pass, not a hardware promise. */
export const DESKTOP_NEAR_BUDGET:Readonly<DeviceBudget>=Object.freeze({...DEVICE_BUDGETS.desktop,maxTriangles:250000,maxCacheBytes:192*1024*1024,maxTransitionBytes:256*1024*1024});
export function selectedDeviceBudget(profile:'auto'|'compact'|'desktop',input:Parameters<typeof deviceBudget>[0]):DeviceBudget {
 // At 4 GiB, Auto already selects Compact geometry and texture limits.
 // Keep its bounded transition headroom when the visitor selects Compact directly.
 if(profile==='auto'||(profile==='compact'&&input.deviceMemory===4))return deviceBudget(input);
 if(profile==='desktop'&&!(input.deviceMemory!==undefined&&input.deviceMemory<=4)){
  const memory=input.deviceMemory;
  const budget=memory!==undefined&&Number.isFinite(memory)&&memory>=8
    ?{...DESKTOP_NEAR_BUDGET,maxCacheBytes:256*1024*1024,maxTransitionBytes:320*1024*1024}
    :DESKTOP_NEAR_BUDGET;
  return selectedImageCapacity(budget,memory);
 }
 return selectedImageCapacity(DEVICE_BUDGETS[profile],input.deviceMemory);
}
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
/** The selected painting may request its existing bounded full derivative.
 * The optional allowance belongs only to this explicit request; ordinary
 * wall/nearby selection and encoded cache limits remain unchanged. */
export function selectedImageDetail(artwork:Artwork,budget:DeviceBudget){
 const pair=authoredImagePair(artwork);if(!pair)return;
 const inventory=artwork.assets.find(asset=>asset.id.toLowerCase()===pair.full.assetId.toLowerCase());
 if(!inventory||inventory.mime!=='image/png'||!pair.full.textureSize||pair.full.textureSize>2048||inventory.bytes>8388608)return;
 return {inventory,budget:{...budget,...budget.selectedImage,maxTextureSize:2048}};
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
/** The borrowed renderer can focus a different work from the paused wall camera. */
export function artworkDemandContext(currentArtwork:string|undefined, borrowedArtwork:string|undefined){
 return {owner:borrowedArtwork??currentArtwork,observeWall:borrowedArtwork===undefined};
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
 /** Release a completed external load hold without clearing live reservations. */
 raiseLimit(bytes:number){if(!Number.isSafeInteger(bytes)||bytes<this.maxBytes)throw Error('ASSET_BUDGET_INVALID');this.maxBytes=bytes;}
 reserve(key:string,bytes:number,limitBytes=this.maxBytes){
  // An explicit selected-image allowance still accounts for every other live
  // reservation and resident allocation in this same ledger.
  if(!Number.isSafeInteger(limitBytes)||limitBytes<1||!Number.isSafeInteger(bytes)||bytes<0||this.total(key)+bytes>limitBytes)throw Error('ASSET_TRANSITION_PEAK');
  this.reservations.set(key,bytes);
 }
 release(key:string){this.reservations.delete(key);}
 reservationBytes(key:string){return this.reservations.get(key);}
 reservedBytes(){return [...this.reservations.values()].reduce((sum,value)=>sum+value,0);}
 total(except?:string){return this.resident()+[...this.reservations].reduce((n,[key,bytes])=>n+(key===except?0:bytes),0);}
}
/** CPU bitmap plus mipmapped GPU texture, rounded up to integral bytes so a
 * prepared object's later reservation uses the same conservative byte unit. */
export function textureResidentBytes(width:number,height:number){
 return Math.ceil(width*height*4*(1+4/3));
}
/** Postdecode CPU backing storage and GPU upload identities differ: two plain
 * attributes may alias CPU bytes while uploading separately. Interleaved data
 * shares both. Use the same cost for committed objects and future reservations. */
export function geometryResidentBytes(attributes:ReadonlyArray<{array?:ArrayBufferView;data?:{array:ArrayBufferView}}>){
 const cpu=new Set<ArrayBufferLike>(),gpu=new Set<object>();let bytes=0;
 for(const attribute of attributes){const upload=attribute.data??attribute,array=upload.array;if(!array)throw Error('DECODE_BUDGET_EXCEEDED');if(!cpu.has(array.buffer)){cpu.add(array.buffer);bytes+=array.buffer.byteLength;}if(!gpu.has(upload)){gpu.add(upload);bytes+=array.byteLength;}}
 if(!Number.isSafeInteger(bytes))throw Error('DECODE_BUDGET_EXCEEDED');return bytes;
}
/** Bounded header accounting, never a substitute for the isolated GLB profile.
 * CPU backing views and possible GPU attribute copies are charged separately. */
export function modelGeometryResidentBytes(doc:{accessors?:Array<{bufferView?:number;count:number;type:string;componentType:number;sparse?:unknown;byteOffset?:number}>;bufferViews?:Array<{byteOffset?:number;byteLength:number;byteStride?:number}>;meshes?:Array<{primitives:Array<{attributes:Record<string,number>;indices?:number}>}>},binBytes:number){
 const accessors=new Set<number>(),views=new Set<number>();let cpu=0,gpu=0;
 for(const mesh of doc.meshes??[])for(const primitive of mesh.primitives??[])for(const index of [...Object.values(primitive.attributes),...(primitive.indices===undefined?[]:[primitive.indices])]){
  if(!Number.isSafeInteger(index)||index<0)throw Error('DECODE_BUDGET_EXCEEDED');if(accessors.has(index))continue;accessors.add(index);
  const a=doc.accessors?.[index],v=a?.bufferView===undefined?undefined:doc.bufferViews?.[a.bufferView],width=a&&({5120:1,5121:1,5122:2,5123:2,5125:4,5126:4} as Record<number,number>)[a.componentType],components=a&&({SCALAR:1,VEC2:2,VEC3:3,VEC4:4} as Record<string,number>)[a.type];
  if(!a||!v||!width||!components||a.sparse!==undefined||!Number.isSafeInteger(a.count)||a.count<1||!Number.isSafeInteger(v.byteLength)||v.byteLength<1||!Number.isSafeInteger(v.byteOffset??0)||(v.byteOffset??0)<0||(v.byteOffset??0)+v.byteLength>binBytes||!Number.isSafeInteger(a.byteOffset??0)||(a.byteOffset??0)<0)throw Error('DECODE_BUDGET_EXCEEDED');
  const stride=v.byteStride??width*components;if(!Number.isSafeInteger(stride)||stride<width*components||(a.byteOffset??0)+(a.count-1)*stride+width*components>v.byteLength)throw Error('DECODE_BUDGET_EXCEEDED');
  if(!views.has(a.bufferView!)){views.add(a.bufferView!);cpu+=v.byteLength;}
  // Separate accessors can upload independently even when their CPU views alias.
  gpu+=v.byteLength;
 }
 if(!accessors.size||!Number.isSafeInteger(cpu+gpu))throw Error('DECODE_BUDGET_EXCEEDED');return cpu+gpu;
}
/** Conservative additional fetch/decode peak; resident old/new assets are separate. */
export function assetDecodeReserve(artwork:Artwork,inventory:Artwork['assets'][number],budget:DeviceBudget,bytes:ArrayBuffer,phase:'complete'|'cpu'='complete'):number {
 const variant=lodVariantsFor(artwork).find(v=>v.assetId.toLowerCase()===inventory.id.toLowerCase());
 if(artwork.artworkType==='image'){
  const header=new DataView(bytes);if(bytes.byteLength<24)throw Error('IMAGE_DECODE_BUDGET');
  const w=header.getUint32(16),h=header.getUint32(20);if(!w||!h)throw Error('IMAGE_DECODE_BUDGET');
  const scale=Math.min(1,budget.maxTextureSize/Math.max(w,h));
  const width=Math.ceil(w*scale),height=Math.ceil(h*scale);
  // Verification has returned. Charge input + Blob and both bitmaps only
  // when resizing. GPU upload happens after the decode function returns.
  const cpu=inventory.bytes*2+w*h*4+(scale<1?width*height*4:0);
  if(phase==='cpu')return cpu;
  // Known-header preflight uses the largest phase. The ledger separately
  // tracks evictable encoded cache entries and exact mesh bytes at upload.
  return Math.max(inventory.bytes*4,cpu,textureResidentBytes(width,height));
 }
 return modelDecodeReserve(inventory.bytes,budget,bytes,variant?.textureSize,phase);
}
/** Shared GLB decode accounting; callers independently establish profile and hash. */
function modelDecodeReserve(inventoryBytes:number,budget:DeviceBudget,bytes:ArrayBuffer,textureSize:number|undefined,phase:'complete'|'cpu'){
 const header=new DataView(bytes);if(bytes.byteLength<20||header.getUint32(0,true)!==0x46546c67||header.getUint32(16,true)!==0x4e4f534a)throw Error('DECODE_BUDGET_EXCEEDED');
 const length=header.getUint32(12,true);if(length>bytes.byteLength-20)throw Error('DECODE_BUDGET_EXCEEDED');
 const glb=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(bytes,20,length))) as Parameters<typeof modelGeometryResidentBytes>[0]&{bufferViews?:Array<{buffer?:number;byteOffset?:number;byteLength:number;byteStride?:number}>;images?:Array<{bufferView?:number;mimeType?:string}>;textures?:Array<{source?:number;extensions?:{KHR_texture_basisu?:{source?:number}}}>;extensionsUsed?:unknown;extensionsRequired?:unknown;animations?:unknown;skins?:unknown};
 const binBytes=bytes.byteLength-28-length;if(binBytes<0)throw Error('DECODE_BUDGET_EXCEEDED');const geometryBytes=modelGeometryResidentBytes(glb,binBytes);
 if(geometryBytes>budget.maxCacheBytes)throw Error('MODEL_RESIDENT_BUDGET');
 if(glb.images!==undefined&&!Array.isArray(glb.images)||glb.textures!==undefined&&!Array.isArray(glb.textures)||(glb.images?.length??0)>16||(glb.textures?.length??0)>8)throw Error('DECODE_BUDGET_EXCEEDED');
 const references=new Map<number,number>();for(const texture of glb.textures??[]){for(const index of new Set([texture.source,texture.extensions?.KHR_texture_basisu?.source])){if(index===undefined)continue;if(!Number.isSafeInteger(index)||index<0||index>=(glb.images?.length??0))throw Error('DECODE_BUDGET_EXCEEDED');references.set(index,(references.get(index)??0)+1);}}
 let textureBytes=0,cpuTextureBytes=0;
 let phasedPng=phase==='cpu'&&ordinaryPngRoleSet(glb)&&glb.extensionsUsed===undefined&&glb.extensionsRequired===undefined&&glb.animations===undefined&&glb.skins===undefined&&(glb.meshes??[]).every(mesh=>mesh.primitives.every(primitive=>!('targets' in primitive)));
 for(const [index,image] of (glb.images??[]).entries()){
  const view=Number.isSafeInteger(image.bufferView)&&image.bufferView!==undefined&&image.bufferView>=0?glb.bufferViews?.[image.bufferView]:undefined;
  const relative=view?.byteOffset??0,offset=28+length+relative;
  if(!view||view.buffer!==0||!Number.isSafeInteger(relative)||relative<0||!Number.isSafeInteger(view.byteLength)||view.byteLength<28||relative+view.byteLength>binBytes)throw Error('DECODE_BUDGET_EXCEEDED');
  const png=image.mimeType==='image/png',ktx=image.mimeType==='image/ktx2';if(!png&&!ktx)throw Error('DECODE_BUDGET_EXCEEDED');
  if(ktx&&(view.byteLength<40||header.getUint32(offset+28,true)!==0||header.getUint32(offset+32,true)!==0||header.getUint32(offset+36,true)!==1))throw Error('DECODE_BUDGET_EXCEEDED');
  const w=header.getUint32(offset+(png?16:20),ktx),h=header.getUint32(offset+(png?20:24),ktx);
  if(!w||!h||Math.max(w,h)>Math.min(textureSize??budget.maxTextureSize,budget.maxTextureSize))throw Error('DECODE_BUDGET_EXCEEDED');
  const copies=Math.max(1,references.get(index)??0);
  textureBytes+=copies*w*h*4*(1+4/3);
  cpuTextureBytes+=copies*w*h*4;
  if(!Number.isFinite(textureBytes)||geometryBytes+textureBytes>budget.maxCacheBytes)throw Error('MODEL_RESIDENT_BUDGET');
  phasedPng=phasedPng&&png&&header.getUint8(offset+24)===8&&header.getUint8(offset+25)===2;
 }
 // An individually oversized resident can never fit after a ready-before-swap transition.
 if(geometryBytes+textureBytes>budget.maxCacheBytes)throw Error('MODEL_RESIDENT_BUDGET');
 // All encoded/parsed copies, indexed CPU/GPU geometry and actual texture bindings.
 // Strict ordinary PNGs create CPU bitmaps only during parse. The caller must
 // retire parser-only owners and reserve actual CPU+GPU residency before upload.
 return Math.ceil(inventoryBytes*5+geometryBytes+(phasedPng?cpuTextureBytes:textureBytes));
}
/** Header-only accounting for an already authenticated and hash-verified
 * workspace GLB. Registration still owns full glTF/profile validation. */
export function workspaceFurnishingModelPreflight(bytes:ArrayBuffer,declaredBytes:number,budget:DeviceBudget){
 if(!Number.isSafeInteger(declaredBytes)||declaredBytes<28||declaredBytes>32*1024*1024||bytes.byteLength!==declaredBytes||!Number.isSafeInteger(budget.maxTriangles)||budget.maxTriangles<0||!Number.isSafeInteger(budget.maxCacheBytes)||budget.maxCacheBytes<1||!Number.isSafeInteger(budget.maxTextureSize)||budget.maxTextureSize<1||budget.maxTransitionBytes!==undefined&&(!Number.isSafeInteger(budget.maxTransitionBytes)||budget.maxTransitionBytes<1))throw Error('DECODE_BUDGET_EXCEEDED');
 const view=new DataView(bytes),jsonLength=view.getUint32(12,true);
 if(view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==bytes.byteLength||view.getUint32(16,true)!==0x4e4f534a||jsonLength>1024*1024||jsonLength%4!==0||20+jsonLength+8>bytes.byteLength||view.getUint32(24+jsonLength,true)!==0x004e4942||view.getUint32(20+jsonLength,true)!==bytes.byteLength-28-jsonLength)throw Error('DECODE_BUDGET_EXCEEDED');
 const doc=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(bytes,20,jsonLength))) as {bufferViews?:Array<{buffer?:number;byteOffset?:number;byteLength?:number}>;accessors?:Array<{count?:number}>;meshes?:Array<{primitives?:Array<{mode?:number;indices?:number;material?:number;attributes?:{POSITION?:number};targets?:unknown}>}>;materials?:Array<{doubleSided?:boolean;alphaMode?:string}>;nodes?:Array<{mesh?:number;children?:number[];extensions?:unknown;camera?:unknown}>;scenes?:Array<{nodes?:number[]}>;scene?:number;skins?:unknown;animations?:unknown;cameras?:unknown};
 if(!Array.isArray(doc.bufferViews)||doc.bufferViews.length>100000)throw Error('DECODE_BUDGET_EXCEEDED');for(const entry of doc.bufferViews){const offset=entry?.byteOffset??0,length=entry?.byteLength;if(!entry||entry.buffer!==0||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length===undefined||length<1||offset+length>bytes.byteLength-28-jsonLength)throw Error('DECODE_BUDGET_EXCEEDED');}
 if(doc.skins!==undefined||doc.animations!==undefined||doc.cameras!==undefined||(doc.meshes??[]).some(mesh=>mesh.primitives?.some(primitive=>primitive.targets!==undefined)))throw Error('WORKSPACE_FURNISHING_UNSUPPORTED');
 if(doc.materials!==undefined&&!Array.isArray(doc.materials))throw Error('DECODE_BUDGET_EXCEEDED');
 // GLTFLoader prepares every declared scene, not just its default. Until
 // multi-scene allocations are budgeted, admit only one bounded scene and
 // reject node extensions even on nodes outside that scene.
 if(!Array.isArray(doc.scenes)||doc.scenes.length!==1||doc.scene!==undefined&&doc.scene!==0||!Array.isArray(doc.nodes)||doc.nodes.length>256)throw Error('WORKSPACE_FURNISHING_UNSUPPORTED');
 if(doc.nodes.some(node=>!node||typeof node!=='object'||Array.isArray(node)||node.extensions!==undefined||node.camera!==undefined))throw Error('WORKSPACE_FURNISHING_UNSUPPORTED');
 const scene=doc.scenes[doc.scene??0];if(!scene||!Array.isArray(scene.nodes)||scene.nodes.length>256)throw Error('DECODE_BUDGET_EXCEEDED');
 let triangles=0,draws=0;const pending=[...scene.nodes],visited=new Set<number>();
 while(pending.length){const index=pending.pop();if(!Number.isSafeInteger(index)||index===undefined||index<0||visited.has(index)||visited.size>=100000)throw Error('DECODE_BUDGET_EXCEEDED');visited.add(index);const node=doc.nodes[index];if(!node)throw Error('DECODE_BUDGET_EXCEEDED');if(node.extensions!==undefined)throw Error('WORKSPACE_FURNISHING_UNSUPPORTED');if(node.children!==undefined){if(!Array.isArray(node.children)||pending.length+node.children.length>100000)throw Error('DECODE_BUDGET_EXCEEDED');for(const child of node.children)pending.push(child);}
  if(node.mesh!==undefined){if(!Number.isSafeInteger(node.mesh)||node.mesh<0)throw Error('DECODE_BUDGET_EXCEEDED');const mesh=doc.meshes?.[node.mesh];if(!mesh||!Array.isArray(mesh.primitives))throw Error('DECODE_BUDGET_EXCEEDED');for(const primitive of mesh.primitives){const accessorIndex=primitive.indices??primitive.attributes?.POSITION,count=accessorIndex===undefined?undefined:doc.accessors?.[accessorIndex]?.count,mode=primitive.mode??4;if(!Number.isSafeInteger(count)||count===undefined||count<1||!Number.isSafeInteger(mode)||mode<0||mode>6||mode===4&&count%3!==0)throw Error('DECODE_BUDGET_EXCEEDED');if(mode===5||mode===6)throw Error('WORKSPACE_FURNISHING_UNSUPPORTED');const material=primitive.material===undefined?undefined:doc.materials?.[primitive.material];if(primitive.material!==undefined&&(!Number.isSafeInteger(primitive.material)||primitive.material<0||!material))throw Error('DECODE_BUDGET_EXCEEDED');const passes=material?.doubleSided===true&&material.alphaMode==='BLEND'?2:1;draws+=passes;triangles+=mode===4?count/3*passes:0;if(draws>256||!Number.isSafeInteger(triangles)||triangles>budget.maxTriangles)throw Error('ASSET_BUDGET_EXCEEDED');}}
 }
 if(!draws)throw Error('DECODE_BUDGET_EXCEEDED');const reserveBytes=modelDecodeReserve(declaredBytes,budget,bytes,undefined,'complete');if(!Number.isSafeInteger(reserveBytes)||reserveBytes>(budget.maxTransitionBytes??budget.maxCacheBytes))throw Error('ASSET_BUDGET_EXCEEDED');return {triangles,draws,reserveBytes};
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
interface Task<T> {key:string;priority:number;priorityOverride?:number;order:number;controller:AbortController;promise:Promise<T>;resolve:(v:T)=>void;reject:(e:unknown)=>void;status:LoadingStatus;settled:boolean}
const cancelled=()=>new DOMException("Asset loading cancelled","AbortError");
export class AssetScheduler<T> {
 private readonly tasks=new Map<string,Task<T>>();private active=0;private order=0;private completed=0;private failed=0;private cancelled=0;private stopped=false;
 constructor(private readonly options:{concurrency:number;load:(key:string,signal:AbortSignal)=>Promise<T>;onState?:(event:LoadingEvent)=>void;onDiscard?:(value:T)=>void}){if(!Number.isInteger(options.concurrency)||options.concurrency<1||options.concurrency>8)throw Error("CONCURRENCY_INVALID");}
 request(key:string,priority=0):Promise<T>{if(this.stopped)return Promise.reject(cancelled());if(!Number.isFinite(priority))return Promise.reject(Error("PRIORITY_INVALID"));const existing=this.tasks.get(key);if(existing){if(existing.status==="queued")existing.priority=Math.min(existing.priority,priority);return existing.promise;}
 let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});const task:Task<T>={key,priority,order:this.order++,controller:new AbortController(),promise,resolve,reject,status:"queued",settled:false};this.tasks.set(key,task);this.emit(task,"queued");queueMicrotask(()=>this.drain());return promise;}
 /** Override only a queued request; clearing it restores the ordinary priority. */
 setPriorityOverride(key:string,priority?:number){if(priority!==undefined&&!Number.isFinite(priority))throw Error('PRIORITY_INVALID');const task=this.tasks.get(key);if(task?.status==='queued')task.priorityOverride=priority;}
 retry(key:string,priority=0){this.cancel(key);return this.request(key,priority);}
 cancel(key:string){const task=this.tasks.get(key);if(!task||task.settled)return;task.settled=true;task.controller.abort();task.reject(cancelled());this.cancelled++;this.emit(task,"cancelled");this.tasks.delete(key);queueMicrotask(()=>this.drain());}
 cancelAll(){for(const key of this.tasks.keys())this.cancel(key);}
 dispose(){this.stopped=true;this.cancelAll();}
 stats():SchedulerStats{return {active:this.active,queued:[...this.tasks.values()].filter(t=>t.status==="queued").length,completed:this.completed,failed:this.failed,cancelled:this.cancelled};}
 private emit(task:Task<T>,status:LoadingStatus,error?:unknown){task.status=status;this.options.onState?.({key:task.key,status,...(error===undefined?{}:{error})});}
 private drain(){if(this.stopped)return;while(this.active<this.options.concurrency){const task=[...this.tasks.values()].filter(t=>t.status==="queued").sort((a,b)=>(a.priorityOverride??a.priority)-(b.priorityOverride??b.priority)||a.order-b.order)[0];if(!task)return;this.active++;this.emit(task,"loading");void this.run(task);}}
 private async run(task:Task<T>){try{const value=await this.options.load(task.key,task.controller.signal);if(task.settled||this.stopped){this.options.onDiscard?.(value);return;}task.settled=true;this.completed++;this.emit(task,"loaded");task.resolve(value);}catch(error){if(!task.settled){task.settled=true;this.failed++;this.emit(task,"error",error);task.reject(error);}}finally{this.active--;if(this.tasks.get(task.key)===task)this.tasks.delete(task.key);this.drain();}}
}
interface Cached<T> {value:T;bytes:number;pins:number;order:number}
export class MemoryAssetCache<T> {
 private entries=new Map<string,Cached<T>>();private used=0;private order=0;private evictions=0;
 constructor(private limitBytes:number,private readonly onDispose:(value:T)=>void=()=>{}){if(!Number.isSafeInteger(limitBytes)||limitBytes<1)throw Error("CACHE_BUDGET_INVALID");}
 get maxBytes(){return this.limitBytes;}
 raiseLimit(bytes:number){if(!Number.isSafeInteger(bytes)||bytes<this.limitBytes)throw Error('CACHE_BUDGET_INVALID');this.limitBytes=bytes;}
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
/** A decoder scope owns its backing after an encoded-cache entry can evict.
 * Reuse the existing cache pin only for the identical retained allocation. */
export function retainEncodedBuffer(cache:MemoryAssetCache<ArrayBuffer>,key:string,retained:ArrayBuffer){
 const cached=cache.acquire(key);
 if(cached===retained){let released=false;return {retainedBytes:0,dispose(){if(released)return;released=true;cache.release(key);}};}
 if(cached!==undefined)cache.release(key);
 return {retainedBytes:retained.byteLength,dispose(){}};
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
