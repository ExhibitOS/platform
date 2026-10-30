// SPDX-License-Identifier: AGPL-3.0-or-later
/** Selection operates only after the host has validated source binding, current
 * display rights and the versioned inventory. It does not establish trust. */
export interface CoverVariantDimensions {width:number;height:number;bytes:number}
export interface CoverSelectionVariant extends CoverVariantDimensions {id:string}
export interface CoverDisplayBox {width:number;height:number;pixelRatio:number;fit:'contain'|'cover'}
const dimension=(value:number)=>Number.isSafeInteger(value)&&value>0&&value<=4096;
const positive=(value:number)=>Number.isFinite(value)&&value>0;
/** Return undefined to retain the authoritative primary. Unknown measurements
 * never select a derivative. Both dimensions matter for cropped cover fits. */
export function selectCoverVariant(primary:CoverVariantDimensions,variants:readonly CoverSelectionVariant[],box:CoverDisplayBox|undefined):CoverSelectionVariant|undefined {
 if(!primary||!Array.isArray(variants)||variants.length>8||!dimension(primary.width)||!dimension(primary.height)||!Number.isSafeInteger(primary.bytes)||primary.bytes<1||!box||!positive(box.width)||!positive(box.height)||!positive(box.pixelRatio)||!['contain','cover'].includes(box.fit))return undefined;
 const scale=(box.fit==='contain'?Math.min:Math.max)(box.width/primary.width,box.height/primary.height)*box.pixelRatio;
 const needWidth=Math.ceil(primary.width*scale),needHeight=Math.ceil(primary.height*scale);
 if(!Number.isSafeInteger(needWidth)||!Number.isSafeInteger(needHeight))return undefined;
 return variants.filter(v=>{
  if(!v||typeof v.id!=='string'||!v.id||!dimension(v.width)||!dimension(v.height)||!Number.isSafeInteger(v.bytes)||v.bytes<1||v.bytes>=primary.bytes||v.width>primary.width||v.height>primary.height||v.width<needWidth||v.height<needHeight)return false;
  const a=v.width*primary.height,b=v.height*primary.width,difference=Math.abs(a-b);
  // Allow integer resize rounding only when aspect distortion is also <=1%.
  const variantScale=(box.fit==='contain'?Math.min:Math.max)(box.width/v.width,box.height/v.height)*box.pixelRatio;
  return variantScale<=1&&difference<=primary.width+primary.height&&difference<=Math.max(a,b)/100;
 }).sort((a,b)=>a.bytes-b.bytes||a.id.localeCompare(b.id))[0];
}
