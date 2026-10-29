// SPDX-License-Identifier: AGPL-3.0-or-later
/** One 96px preview: encoding scratch, bounded data URL and DOM decoded/GPU image.
 * Reserved separately from displayed artwork allocations; never loads an asset. */
export const MAP_THUMBNAIL_RESERVE_BYTES=512*1024;
export function imageMapThumbnail(image:ImageBitmap,makeCanvas=()=>document.createElement('canvas')):string|undefined {
 if(!Number.isFinite(image.width)||!Number.isFinite(image.height)||image.width<1||image.height<1)return;
 const canvas=makeCanvas(),ratio=Math.min(1,96/Math.max(image.width,image.height));
 try{
  canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio));
  const context=canvas.getContext('2d');if(!context)return;
  // The admitted painting bitmap was flipped once for GPU upload. Restore its DOM orientation.
  context.scale(1,-1);context.drawImage(image,0,-canvas.height,canvas.width,canvas.height);
  const url=canvas.toDataURL('image/png');
  return url.startsWith('data:image/png;base64,')&&url.length<=65536?url:undefined;
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
