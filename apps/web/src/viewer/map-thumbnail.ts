// SPDX-License-Identifier: AGPL-3.0-or-later
/** One 96px preview: encoding scratch, bounded data URL and DOM decoded/GPU image.
 * Reserved separately from displayed artwork allocations; never loads an asset. */
export const MAP_THUMBNAIL_RESERVE_BYTES=512*1024;
// Viewer admits at most 128 placements. The estimate covers two UTF-16 URI
// copies, encoded PNG, decoded 32px RGBA, mipmapped GPU image, and scratch.
// Browser/driver allocation overhead and further copies are not measured.
export const MAP_THUMBNAIL_ROSTER_LIMIT=128;
export function mapThumbnailRosterReserve(count:number){return Math.min(MAP_THUMBNAIL_ROSTER_LIMIT,Math.max(0,count))*48*1024+512*1024;}
export function imageMapThumbnail(image:ImageBitmap,makeCanvas=()=>document.createElement('canvas'),edge=96,maxLength=65536):string|undefined {
 if(!Number.isFinite(image.width)||!Number.isFinite(image.height)||image.width<1||image.height<1)return;
 const canvas=makeCanvas(),ratio=Math.min(1,edge/Math.max(image.width,image.height));
 try{
  canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio));
  const context=canvas.getContext('2d');if(!context)return;
  // The admitted painting bitmap was flipped once for GPU upload. Restore its DOM orientation.
  context.scale(1,-1);context.drawImage(image,0,-canvas.height,canvas.width,canvas.height);
  const url=canvas.toDataURL('image/png');
  return url.startsWith('data:image/png;base64,')&&url.length<=maxLength?url:undefined;
 }catch{return undefined;}
 finally{canvas.width=0;canvas.height=0;}
}

/** Called by the existing loader statistics tick and selection effect. No timer,
 * download, decoder, retained source image or independent renderer is owned here. */
export function createMapThumbnailPreview(input:{
 requested():string|undefined;allowed():boolean;image(id:string):ImageBitmap|undefined;
 changed(value:{placementId:string;thumbnail:string}|null):void;
 encode?:(image:ImageBitmap)=>string|undefined;
}){
 let key:string|undefined,settled=false,disposed=false;
 const refresh=()=>{
  if(disposed)return;
  const requested=input.allowed()?input.requested():undefined;
  if(requested!==key){key=requested;settled=false;input.changed(null);}
  if(!key||settled)return;
  const image=input.image(key);if(!image)return;
  settled=true;
  const thumbnail=(input.encode??imageMapThumbnail)(image);
  if(thumbnail)input.changed({placementId:key,thumbnail});
 };
 return {refresh,dispose(){if(disposed)return;disposed=true;input.changed(null);}};
}

/** A small bounded roster made only from already admitted images. One encode per
 * refresh limits work on the existing statistics tick; missing images wait. */
export function createMapThumbnailRoster(input:{
 ids:readonly string[];allowed():boolean;image(id:string):ImageBitmap|undefined;
 exclude?:(id:string)=>boolean;
 changed(value:ReadonlyArray<{placementId:string;thumbnail:string}>):void;
 encode?:(image:ImageBitmap)=>string|undefined;
 now?:()=>number;
}){
 const ids=[...new Set(input.ids)].slice(0,MAP_THUMBNAIL_ROSTER_LIMIT);
 const settled=new Set<string>(),values=new Map<string,string>();let disposed=false,lastEncode=-Infinity;
 const refresh=()=>{
  if(disposed)return;
  if(!input.allowed()){
   if(settled.size||values.size){settled.clear();values.clear();lastEncode=-Infinity;input.changed([]);}return;
  }
  let removed=false;for(const id of ids)if(input.exclude?.(id)&&values.delete(id)){settled.delete(id);removed=true;}
  if(removed)input.changed([...values].map(([placementId,thumbnail])=>({placementId,thumbnail})));
  const now=(input.now??(()=>performance.now()))();if(!Number.isFinite(now)||now-lastEncode<200)return;
  for(const id of ids){
   if(input.exclude?.(id))continue;
   if(settled.has(id))continue;
   const image=input.image(id);if(!image)continue;
   settled.add(id);lastEncode=now;const thumbnail=input.encode?input.encode(image):imageMapThumbnail(image,undefined,32,8192);
   if(thumbnail){values.set(id,thumbnail);input.changed([...values].map(([placementId,thumbnail])=>({placementId,thumbnail})));}
   break;
  }
 };
 return {refresh,dispose(){if(disposed)return;disposed=true;values.clear();settled.clear();input.changed([]);}};
}
