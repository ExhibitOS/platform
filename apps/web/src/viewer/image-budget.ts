// SPDX-License-Identifier: AGPL-3.0-or-later
import type {DeviceBudget} from './loading';
/** The source bitmap is already oriented; preserve that orientation on resize. */
export async function resizeArtworkBitmap(bitmap:ImageBitmap,budget?:DeviceBudget){
 if(!budget||Math.max(bitmap.width,bitmap.height)<=budget.maxTextureSize)return bitmap;
 const factor=budget.maxTextureSize/Math.max(bitmap.width,bitmap.height),resized=await createImageBitmap(bitmap,{imageOrientation:'none',resizeWidth:Math.max(1,Math.round(bitmap.width*factor)),resizeHeight:Math.max(1,Math.round(bitmap.height*factor))});bitmap.close();return resized;
}
