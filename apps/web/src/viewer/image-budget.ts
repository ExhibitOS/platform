// SPDX-License-Identifier: AGPL-3.0-or-later
import type {DeviceBudget} from './loading';
export class ArtworkBitmapCleanupError extends Error {constructor(cause:unknown){super('ARTWORK_BITMAP_CLEANUP_FAILED',{cause});}}
/** The source bitmap is already oriented; preserve that orientation on resize. */
export async function resizeArtworkBitmap(bitmap:ImageBitmap,budget?:DeviceBudget){
 if(!budget||Math.max(bitmap.width,bitmap.height)<=budget.maxTextureSize)return bitmap;
 const factor=budget.maxTextureSize/Math.max(bitmap.width,bitmap.height),resized=await createImageBitmap(bitmap,{imageOrientation:'none',resizeWidth:Math.max(1,Math.round(bitmap.width*factor)),resizeHeight:Math.max(1,Math.round(bitmap.height*factor))});
 try{bitmap.close();}catch(error){try{resized.close();}catch{/* Keep the reservation quarantined. */}throw new ArtworkBitmapCleanupError(error);}return resized;
}
/** Resolve or reject only after the bitmap returned by the browser is closed on failure. */
export async function decodeArtworkBitmap(bytes:ArrayBuffer,budget:DeviceBudget|undefined,signal:AbortSignal,validate:(bitmap:ImageBitmap)=>void){
 let bitmap:ImageBitmap|undefined;
 try{bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}),{imageOrientation:'flipY'});validate(bitmap);signal.throwIfAborted();bitmap=await resizeArtworkBitmap(bitmap,budget);signal.throwIfAborted();return bitmap;}
 catch(error){if(bitmap)try{bitmap.close();}catch(cleanup){throw new ArtworkBitmapCleanupError(cleanup);}throw error;}
}
