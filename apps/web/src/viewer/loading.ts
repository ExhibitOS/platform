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
 const selected=coarse&&(distance>2||!fits(full))&&fits(coarse)?coarse:fits(full)?full:undefined;
 if(!selected)throw new Error("ASSET_BUDGET_EXCEEDED");
 const asset=artwork.assets.find(a=>a.id.toLowerCase()===selected.assetId.toLowerCase());
 if(!asset)throw new Error("VARIANT_REFERENCE");return asset;
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
export async function fetchVerifiedAsset(input:{publicationId:string;revisionSha256:string;asset:{assetId:string;url:string;mime:string};inventory:Artwork["assets"][number];signal:AbortSignal;fetcher?:typeof fetch;maxBytes?:number}):Promise<ArrayBuffer> {
 const {publicationId,revisionSha256,asset,inventory,signal}=input,uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
 if(!uuid.test(publicationId)||!uuid.test(asset.assetId)||asset.assetId!==inventory.id||asset.url!==`/api/v1/publications/${publicationId}/assets/${asset.assetId}`||asset.mime!==inventory.mime||!/^[a-f0-9]{64}$/.test(revisionSha256)||!/^[a-f0-9]{64}$/.test(inventory.sha256)||!Number.isSafeInteger(inventory.bytes)||inventory.bytes<1||inventory.bytes>Math.min(input.maxBytes??33554432,33554432))throw Error("ASSET_CONTRACT_INVALID");
 const response=await (input.fetcher??fetch)(asset.url,{credentials:"omit",cache:"no-store",signal});
 if(!response.ok)throw Error(`ASSET_HTTP_${response.status}`);if(response.headers.get("x-exhibitos-publication-revision")!==revisionSha256||response.headers.get("content-type")?.split(";")[0]!==inventory.mime)throw Error("ASSET_RESPONSE_INVALID");
 const reader=response.body?.getReader();if(!reader)throw Error("ASSET_BODY_MISSING");const chunks:Uint8Array[]=[];let length=0;const onAbort=()=>{void reader.cancel(signal.reason).catch(()=>{});};signal.addEventListener("abort",onAbort,{once:true});
 try{for(;;){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>inventory.bytes)throw Error("ASSET_INTEGRITY");chunks.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{signal.removeEventListener("abort",onAbort);reader.releaseLock();}
 signal.throwIfAborted();if(length!==inventory.bytes)throw Error("ASSET_INTEGRITY");const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 const hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(v=>v.toString(16).padStart(2,"0")).join("");if(hash!==inventory.sha256)throw Error("ASSET_INTEGRITY");return bytes.buffer;
}
