// SPDX-License-Identifier: AGPL-3.0-or-later
/** Structural encoding selection only. This metadata is not a rights grant,
 * producer attestation, byte validator, or permission to load a decoder. */
export const GPU_MODEL_NAMESPACE='org.exhibitos.viewer/gpu-model';
export const GPU_MODEL_PROFILE='embedded-model-basecolor-uastc-512-mips-v1';
export const GPU_MODEL_RECIPE_SHA256='82a7dd855788e590ba6698f1c3c5fc51b7638edd24c891391b20c20c09ac1fdf';
// The ordinary producer inspects the existing bounded compact-source family.
export const MAX_GPU_MODEL_TRIANGLES=200000;
export type ArtworkGpuModel={
 version:1;profile:typeof GPU_MODEL_PROFILE;recipeSHA256:typeof GPU_MODEL_RECIPE_SHA256;
 receiptSHA256:string;sourceAssetId:string;candidateAssetId:string;triangles:number;textureSize:512;
};
export interface GpuModelArtworkAsset {id:string;path:string;role:'model';mime:'model/gltf-binary';sha256:string;bytes:number}
export interface ArtworkGpuModelSelection {binding:ArtworkGpuModel;source:GpuModelArtworkAsset;candidate:GpuModelArtworkAsset}
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i,hash=/^[a-f0-9]{64}$/;
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const integer=(v:unknown,min:number,max:number)=>Number.isSafeInteger(v)&&Number(v)>=min&&Number(v)<=max;
const keys=['version','profile','recipeSHA256','receiptSHA256','sourceAssetId','candidateAssetId','triangles','textureSize'];
function closed(v:unknown):v is Record<string,unknown>{
 return record(v)&&Reflect.ownKeys(v).length===keys.length&&keys.every(key=>{const d=Object.getOwnPropertyDescriptor(v,key);return !!d?.enumerable&&Object.hasOwn(d,'value');});
}
/** Only an existing, unique model asset can be selected; geometry LOD and the
 * primary source remain independent of this optional encoding choice. */
export function artworkGpuModelFor(artwork:unknown):ArtworkGpuModelSelection|undefined {
 if(!record(artwork)||artwork.artworkType!=='sculpture'||!record(artwork.extensions)||!Array.isArray(artwork.assets))return;
 const b=artwork.extensions[GPU_MODEL_NAMESPACE];
 if(!closed(b)||b.version!==1||b.profile!==GPU_MODEL_PROFILE||b.recipeSHA256!==GPU_MODEL_RECIPE_SHA256||typeof b.receiptSHA256!=='string'||!hash.test(b.receiptSHA256)||typeof b.sourceAssetId!=='string'||!uuid.test(b.sourceAssetId)||typeof b.candidateAssetId!=='string'||!uuid.test(b.candidateAssetId)||b.sourceAssetId.toLowerCase()===b.candidateAssetId.toLowerCase()||!integer(b.triangles,1,MAX_GPU_MODEL_TRIANGLES)||b.textureSize!==512||typeof artwork.primaryAssetId!=='string'||artwork.primaryAssetId.toLowerCase()!==b.sourceAssetId.toLowerCase())return;
 const asset=(id:string,max:number):GpuModelArtworkAsset|undefined=>{
  const matches=(artwork.assets as unknown[]).filter(v=>record(v)&&typeof v.id==='string'&&v.id.toLowerCase()===id.toLowerCase()),v=matches[0];
  if(matches.length!==1||!record(v)||v.role!=='model'||v.mime!=='model/gltf-binary'||typeof v.path!=='string'||!v.path.length||typeof v.sha256!=='string'||!hash.test(v.sha256)||!integer(v.bytes,28,max))return;
  return v as unknown as GpuModelArtworkAsset;
 };
 const source=asset(b.sourceAssetId,33554432),candidate=asset(b.candidateAssetId,33554432);if(!source||!candidate)return;
 return {binding:b as unknown as ArtworkGpuModel,source,candidate};
}
/** Missing is valid for ordinary/legacy artwork. Present malformed metadata
 * fails closed without inferring authority from a MIME, name or GLB extension. */
export function validateArtworkGpuModel(artwork:unknown){
 const present=record(artwork)&&record(artwork.extensions)&&Object.hasOwn(artwork.extensions,GPU_MODEL_NAMESPACE);
 const errors=present&&!artworkGpuModelFor(artwork)?[{code:'ARTWORK_GPU_MODEL_INVALID',path:'/extensions/org.exhibitos.viewer~1gpu-model',message:'Expected the closed bounded GPU encoding binding and two distinct model assets'}]:[];
 return {valid:errors.length===0,errors};
}
