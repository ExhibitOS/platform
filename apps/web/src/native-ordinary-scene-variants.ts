// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Artwork,Exhibition} from '@exhibitos/spec';
import {BUDGET_GEOMETRY_PAIR_PROFILE,NEAR_GEOMETRY_PAIR_PROFILE,NEAR_TEXTURE_PAIR_PROFILE,LOD_NAMESPACE,lodVariantsFor} from '@exhibitos/studio-contract';
import {selectAssetVariant,type DeviceBudget} from './viewer/loading';

export function qualifiedNativeModelPair(art:Artwork){
 if(art.artworkType!=='sculpture')return false;
 const profile=(art.extensions?.[LOD_NAMESPACE] as {profile?:unknown}|undefined)?.profile;
 if(![BUDGET_GEOMETRY_PAIR_PROFILE,NEAR_GEOMETRY_PAIR_PROFILE,NEAR_TEXTURE_PAIR_PROFILE].includes(profile as typeof BUDGET_GEOMETRY_PAIR_PROFILE))return false;
 try{return lodVariantsFor(art).length===2;}catch{return false;}
}
/** Per-model policy remains the existing selector's policy. Ordinary Native
 * pressure preferences never reach exports, thumbnails or public/detail tiers. */
export function nativeOrdinaryInventory(art:Artwork,budget:DeviceBudget,preferredAssetId?:string){
 const primary=art.assets.find(a=>a.id===art.primaryAssetId);if(!primary)throw Error('VARIANT_REFERENCE');
 if(!qualifiedNativeModelPair(art)){if(preferredAssetId!==undefined)throw Error('VARIANT_REFERENCE');return primary;}
 const selected=selectAssetVariant(art,0,budget,preferredAssetId!==undefined);
 if(preferredAssetId!==undefined&&selected.id!==preferredAssetId)throw Error('VARIANT_REFERENCE');
 return selected;
}
export interface NativeScenePressure {missingTriangles:number;missingDraws:number}
export interface NativeLoadedModel {revisionId:string;assetId:string;triangles:number;placements:number}
/** One bounded replan after a real aggregate reservation refusal. A coarse
 * model may take two material passes, so only its conservative saving counts.
 * Largest savings first minimize how many artworks need an ordinary tier change. */
export function nativeScenePressurePreferences(document:Exhibition,budget:DeviceBudget,loaded:ReadonlyMap<string,NativeLoadedModel>,pressure:NativeScenePressure):Map<string,string>|undefined {
 if(!Number.isSafeInteger(pressure.missingTriangles)||pressure.missingTriangles<=0||!Number.isSafeInteger(pressure.missingDraws)||pressure.missingDraws>0)return;
 const candidates:{revisionId:string;assetId:string;saving:number}[]=[];
 for(const art of document.artworks){
  const actual=loaded.get(art.revisionId);if(!actual||actual.assetId!==art.primaryAssetId||!Number.isSafeInteger(actual.triangles)||actual.triangles<1||!Number.isSafeInteger(actual.placements)||actual.placements<1||!qualifiedNativeModelPair(art))continue;
  try{
   const normal=nativeOrdinaryInventory(art,budget),coarse=selectAssetVariant(art,0,budget,true),variant=lodVariantsFor(art).find(v=>v.detail==='coarse'&&v.assetId.toLowerCase()===coarse.id.toLowerCase());
   if(normal.id!==actual.assetId||coarse.id===normal.id||!variant?.triangles)continue;
   const saving=actual.triangles-variant.triangles*2*actual.placements;
   if(Number.isSafeInteger(saving)&&saving>0)candidates.push({revisionId:art.revisionId,assetId:coarse.id,saving});
  }catch{/* Keep the admitted highest tier when no declared replacement fits. */}
 }
 candidates.sort((a,b)=>b.saving-a.saving||a.revisionId.localeCompare(b.revisionId));
 const choices=new Map<string,string>();let reclaimed=0;
 for(const item of candidates){choices.set(item.revisionId,item.assetId);reclaimed+=item.saving;if(reclaimed>=pressure.missingTriangles)return choices;}
 // An insufficient plan must not lower quality while leaving the same refusal.
 return;
}
