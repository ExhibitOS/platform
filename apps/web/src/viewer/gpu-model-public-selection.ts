// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Artwork} from '@exhibitos/spec';
import {artworkGpuModelFor} from '@exhibitos/studio-contract';
import {sourceVariantForInventory} from './gpu-model-representation';
import {AssetReleaseUnconfirmedError,assetDecodeReserve,modelDecodeReserve,type DeviceBudget} from './loading';
type Inventory=Artwork['assets'][number];
export function publicGpuCandidate(art:Artwork,inventory:Inventory){
 const gpu=artworkGpuModelFor(art);
 return gpu&&gpu.candidate.id===inventory.id&&(['mime','bytes','sha256','path','role'] as const).every(key=>gpu.candidate[key]===inventory[key])?gpu:undefined;
}
/** Existing header arithmetic, actual encoded inventory, logical tier ceiling. */
export function publicDisplayDecodeReserve(art:Artwork,inventory:Inventory,budget:DeviceBudget,bytes:ArrayBuffer,phase:'complete'|'cpu'='complete'){
 if(!publicGpuCandidate(art,inventory))return assetDecodeReserve(art,inventory,budget,bytes,phase);
 return modelDecodeReserve(inventory.bytes,budget,bytes,sourceVariantForInventory(art,inventory.id)?.textureSize,phase);
}
/** A clean candidate failure changes representation, never the logical LOD.
 * Update only this required entrance identity before its ordinary retry. */
export function fallbackPublicGpuAsset(art:Artwork,inventory:Inventory,error:unknown,aborted:boolean,failed:Set<string>,entrance:Map<string,Inventory>,requiredChanged:(assets:Inventory[])=>void){
 if(aborted||error instanceof AssetReleaseUnconfirmedError||error instanceof Error&&error.name==='AbortError')return;
 const gpu=publicGpuCandidate(art,inventory);if(!gpu)return;
 failed.add(gpu.candidate.id);
 if(entrance.get(art.revisionId)?.id===gpu.candidate.id){entrance.set(art.revisionId,gpu.source);requiredChanged([...entrance.values()]);}
 return gpu.source;
}

/** The probe import can outlive a source change after renderer construction.
 * The old build returns before either renderer release or successor admission. */
export async function retirePublicGpuProbeRenderer(renderer:{dispose():void;forceContextLoss():void},buildSettled:Promise<void>){
 await buildSettled;
 let failed=false,cause:unknown;
 for(const release of [()=>renderer.dispose(),()=>renderer.forceContextLoss()])try{release();}catch(error){failed=true;cause??=error;}
 if(failed)throw new AssetReleaseUnconfirmedError({cause});
}
