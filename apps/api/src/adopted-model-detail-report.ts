// SPDX-License-Identifier: AGPL-3.0-or-later
import type {DetailFeatureReport,DetailTextureFeatures} from '@exhibitos/studio-contract';
import {COMPACT_MODEL_LIMITS,inspectCompactModelSource,type ModelPreparationInput} from './oam-original-preparation.ts';

export const ADOPTED_MODEL_DETAIL_INSPECTOR='native-adopted-embedded-glb-v1';

const unsupported=():never=>{throw Error('NATIVE_MODEL_DETAIL_UNSUPPORTED');};

/** Build the report from the exact acquired bytes, under the same closed
 * embedded-model profile used for adoption. The feature report carries no rights. */
export async function inspectAdoptedModelDetail(bytes:Buffer,identity:ModelPreparationInput,signal?:AbortSignal):Promise<DetailFeatureReport>{
 signal?.throwIfAborted();
 const model=inspectCompactModelSource(bytes,identity);
 const {validateBytes}=await import('gltf-validator');
 const checked=await validateBytes(bytes,{maxIssues:64,externalResourceFunction:async()=>unsupported()});
 signal?.throwIfAborted();
 if(checked.issues.numErrors!==0)unsupported();
 const resources=checked.info?.resources;
 if(!Array.isArray(resources))return unsupported();

 const textures:DetailTextureFeatures[]=model.images.map(({bytes:image,mime}: {bytes:Buffer;mime:string},index:number)=>{
  const matches=resources.filter(resource=>resource.pointer===`/images/${index}`);
  const item=matches[0],dimensions=item?.image;
  if(matches.length!==1||item?.storage!=='buffer-view'||item.mimeType!==mime||dimensions?.bits!==8)return unsupported();
  const {width,height}=dimensions,edge=Math.max(width,height);
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||edge>COMPACT_MODEL_LIMITS.imageEdge)return unsupported();
  const texture=model.doc.textures.find((value:{source:number})=>value.source===index);
  const minFilter=model.doc.samplers?.[texture?.sampler]?.minFilter;
  const usesMipmaps=minFilter!==9728&&minFilter!==9729;
  return {imageIndex:index,codec:mime==='image/jpeg'?'jpeg':'png',width,height,encodedBytes:image.length,
   mipLevels:usesMipmaps?Math.floor(Math.log2(edge))+1:1,usesMipmaps,textureReferences:1};
 });
 const primitive=model.doc.meshes[0].primitives[0];
 const accessorIds=[...Object.values<number>(primitive.attributes),primitive.indices as number];
 const bufferViews=accessorIds.map(index=>model.doc.accessors[index].bufferView as number);
 const viewBytes=(index:number)=>model.doc.bufferViews[index].byteLength as number;
 const geometryCpuBytes=[...new Set(bufferViews)].reduce((sum,index)=>sum+viewBytes(index),0);
 const geometryGpuBytes=bufferViews.reduce((sum,index)=>sum+viewBytes(index),0);
 // Charge the same conservative CPU and mipmapped GPU copies as the Viewer.
 const textureBytes=textures.reduce((sum,texture)=>sum+Math.ceil(texture.width*texture.height*4*(1+4/3)),0);
 const residentBytes=geometryCpuBytes+geometryGpuBytes+textureBytes;
 return {version:1,inspector:ADOPTED_MODEL_DETAIL_INSPECTOR,assetSha256:identity.sha256,assetBytes:identity.bytes,
  media:{kind:'glb',glbVersion:2,sceneCount:1,nodeCount:1,primitiveCount:1,drawCount:1,
   triangles:model.indices.length/3,geometryCpuBytes,geometryGpuBytes,textures,requiredExtensions:[],externalReferences:false},
  cost:{model:ADOPTED_MODEL_DETAIL_INSPECTOR,residentBytes,peakAdditionalBytes:identity.bytes*5+residentBytes}};
}
