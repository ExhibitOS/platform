// SPDX-License-Identifier: AGPL-3.0-or-later
import {artworkThumbnailFor,checkArtworkThumbnailPng} from '@exhibitos/studio-contract';
import type {Artwork} from '@exhibitos/spec';
import {fetchVerifiedAsset} from './loading';

/** Retained 32px DOM images plus one verified fetch/decode/encode scratch. This
 * is an estimate; browser/driver overhead is not a measured hardware limit. */
export function publicThumbnailReserve(count:number){return Math.min(64,Number.isFinite(count)?Math.max(0,Math.floor(count)):0)*48*1024+3*1024*1024;}

/** Turns an already verified, bounded PNG into a tiny upright shared image. */
export async function decodePublicThumbnail(bytes:ArrayBuffer,signal:AbortSignal,api:{bitmap:(blob:Blob)=>Promise<ImageBitmap>;canvas:()=>HTMLCanvasElement}={bitmap:blob=>createImageBitmap(blob),canvas:()=>document.createElement('canvas')}){
 if(!checkArtworkThumbnailPng(bytes))throw Error('THUMBNAIL_INVALID');
 signal.throwIfAborted();const header=new DataView(bytes),bitmap=await api.bitmap(new Blob([bytes],{type:'image/png'}));
 try{
  signal.throwIfAborted();if(bitmap.width!==header.getUint32(16)||bitmap.height!==header.getUint32(20))throw Error('THUMBNAIL_INVALID');
  const canvas=api.canvas(),scale=Math.min(1,32/Math.max(bitmap.width,bitmap.height));
  try{
   canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   const context=canvas.getContext('2d');if(!context)throw Error('THUMBNAIL_INVALID');
   context.drawImage(bitmap,0,0,canvas.width,canvas.height);
   const value=canvas.toDataURL('image/png');signal.throwIfAborted();
   if(!value.startsWith('data:image/png;base64,')||value.length>8192)throw Error('THUMBNAIL_INVALID');
   return value;
  }finally{canvas.width=0;canvas.height=0;}
 }finally{bitmap.close();}
}

/** Shared by map/list/tour. The host chooses when the serial work may run;
 * 3D hosts must schedule behind scene demand using their existing loader. */
export function createPublicThumbnailCache(input:{
 publicationId:string;revisionSha256:string;assets:readonly {assetId:string;url:string;mime:string}[];
 check():Promise<void|readonly string[]>;fetcher?:typeof fetch;changed(items:Readonly<Record<string,string>>):void;
 decode?:(bytes:ArrayBuffer,signal:AbortSignal)=>Promise<string>;
 now?:()=>number;
}){
 const values:Record<string,string>={},owners=new Map<string,string>(),retryAfter=new Map<string,number>(),abort=new AbortController();let disposed=false,busy=false,blocked=false,epoch=0,available=new Set(input.assets.map(a=>a.assetId.toLowerCase()));
 const clear=()=>{epoch++;for(const id of Object.keys(values))delete values[id];owners.clear();retryAfter.clear();input.changed({});};
 const checked=async()=>{if(disposed)throw Error('THUMBNAIL_DISPOSED');const started=epoch;try{
  const ids=await input.check();abort.signal.throwIfAborted();if(epoch!==started)throw Error('THUMBNAIL_CHECK_STALE');
  if(ids){const next=new Set(ids.map(id=>id.toLowerCase())),changed=available.size!==next.size||[...available].some(id=>!next.has(id));available=next;if(changed){epoch++;let removed=false;for(const [key,id] of owners)if(!next.has(id)){owners.delete(key);delete values[key];removed=true;}if(removed)input.changed({...values});}}
  blocked=false;
 }catch(error){if(!disposed&&epoch===started){blocked=true;clear();}throw error;}};
 const verify=async()=>{try{await checked();return true;}catch{return false;}};
 const canLoad=(artwork:Artwork)=>{const key=artwork.revisionId.toLowerCase(),inventory=artworkThumbnailFor(artwork);return !disposed&&!busy&&!blocked&&!values[key]&&Object.keys(values).length<64&&!!inventory&&available.has(inventory.id.toLowerCase())&&input.assets.some(a=>a.assetId.toLowerCase()===inventory.id.toLowerCase())&&(retryAfter.get(key)??0)<=(input.now??(()=>performance.now()))();};
 return {
  canLoad,
  async loadOne(artwork:Artwork,externalSignal?:AbortSignal){
   const key=artwork.revisionId.toLowerCase(),inventory=artworkThumbnailFor(artwork);
   if(!canLoad(artwork)||!inventory||externalSignal?.aborted)return false;
   const asset=input.assets.find(a=>a.assetId.toLowerCase()===inventory.id.toLowerCase());if(!asset)return false;
   busy=true;const started=epoch,signal=externalSignal?AbortSignal.any([abort.signal,externalSignal]):abort.signal;
   try{
    if(!await verify())return false;signal.throwIfAborted();
    const bytes=await fetchVerifiedAsset({publicationId:input.publicationId,revisionSha256:input.revisionSha256,asset,inventory,signal,fetcher:input.fetcher,check:checked,maxBytes:512*1024});
    const url=await (input.decode??decodePublicThumbnail)(bytes,signal);
    if(!await verify()||disposed||signal.aborted||epoch!==started)return false;
    values[key]=url;owners.set(key,inventory.id.toLowerCase());input.changed({...values});return true;
   }catch{
    if(!disposed&&!signal.aborted&&await verify())retryAfter.set(key,(input.now??(()=>performance.now()))()+5000);
    return false;
   }finally{busy=false;}
  },
  recheck:verify,
  invalidate(){if(!disposed){blocked=true;clear();}},
  dispose(){if(disposed)return;disposed=true;abort.abort();clear();},
 };
}
