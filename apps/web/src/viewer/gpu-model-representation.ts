// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Artwork} from '@exhibitos/spec';
import {artworkGpuModelFor,lodVariantsFor,type LodVariant} from '@exhibitos/studio-contract';
import type {DeviceBudget} from './loading';

type Inventory=Artwork['assets'][number];
type Budget=Pick<DeviceBudget,'maxTriangles'|'maxTextureSize'|'maxCacheBytes'|'maxTransitionBytes'>;
export type GpuModelCapabilities={astcSupported:boolean;bptcSupported:boolean};
export type DisplayRepresentation={
 sourceInventory:Inventory;inventory:Inventory;sourceVariant?:LodVariant;
 targetFormat?:'astc-4x4'|'bc7';
};
const sameId=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
function gpuBinding(art:Artwork){try{return artworkGpuModelFor(art);}catch{return undefined;}}
function ordinaryVariant(art:Artwork,id:string){return lodVariantsFor(art).find(value=>sameId(value.assetId,id));}

/** A physical GPU inventory is a representation of its source tier, not an
 * extra coarse/full tier. Invalid metadata never grants an alias. */
export function logicalSourceAssetId(art:Artwork,actualId:string):string {
 const gpu=gpuBinding(art);
 return gpu&&sameId(gpu.candidate.id,actualId)?gpu.source.id:actualId;
}
/** Preserve logical assetId/detail. GPU admission may only tighten the source's
 * declared ceilings; inventory/body/hash accounting always stays physical. */
export function sourceVariantForInventory(art:Artwork,actualId:string):LodVariant|undefined {
 const gpu=gpuBinding(art);
 if(!gpu||!sameId(gpu.candidate.id,actualId))return ordinaryVariant(art,actualId);
 const source=ordinaryVariant(art,gpu.source.id);
 if(!source)return;
 return {...source,triangles:Math.min(source.triangles??Infinity,gpu.binding.triangles),textureSize:Math.min(source.textureSize??Infinity,gpu.binding.textureSize)};
}

/** Resolve only AFTER ordinary LOD selection. The closed binding is structural
 * metadata, never a rights grant or a decoder/byte-validation shortcut. Missing
 * support or headroom keeps the exact ordinary source and does not change caps. */
export function resolveDisplayRepresentation(art:Artwork,ordinarySourceInventory:Inventory,budget:Budget,caps:GpuModelCapabilities,failedGpuIds:ReadonlySet<string>,allowGpu:boolean):DisplayRepresentation {
 // Return the actual artwork inventory object, including for an equivalent
 // copied selector result; never manufacture a source ID on candidate bytes.
 const matches=art.assets.filter(asset=>sameId(asset.id,ordinarySourceInventory.id)),source=matches[0];
 if(matches.length!==1||!source||(['path','role','mime','sha256','bytes'] as const).some(key=>source[key]!==ordinarySourceInventory[key]))throw Error('GPU_MODEL_SOURCE_INVENTORY_INVALID');
 const sourceVariant=ordinaryVariant(art,source.id),fallback:DisplayRepresentation={sourceInventory:source,inventory:source,sourceVariant};
 if(!allowGpu)return fallback;
 const gpu=gpuBinding(art),targetFormat=caps.astcSupported===true?'astc-4x4':caps.bptcSupported===true?'bc7':undefined;
 if(!gpu||!targetFormat||!sameId(gpu.source.id,source.id)||!sourceVariant)return fallback;
 if([...failedGpuIds].some(id=>sameId(id,gpu.candidate.id)))return fallback;
 const positive=(n:number)=>Number.isSafeInteger(n)&&n>0,transition=budget.maxTransitionBytes??budget.maxCacheBytes;
 if(![budget.maxTriangles,budget.maxTextureSize,budget.maxCacheBytes,transition].every(positive))return fallback;
 // Compression cannot admit a source LOD that ordinary policy would refuse.
 if((sourceVariant.triangles??0)>budget.maxTriangles||(sourceVariant.textureSize??0)>budget.maxTextureSize||gpu.binding.triangles>budget.maxTriangles||gpu.binding.textureSize>budget.maxTextureSize||gpu.candidate.bytes>budget.maxCacheBytes||gpu.candidate.bytes*4>transition)return fallback;
 const candidate=art.assets.find(asset=>asset===gpu.candidate);
 if(!candidate)return fallback;
 return {sourceInventory:source,inventory:candidate,sourceVariant:sourceVariantForInventory(art,candidate.id),targetFormat};
}
