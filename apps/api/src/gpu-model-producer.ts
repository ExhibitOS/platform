// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {boundedMippedKtx2} from '@exhibitos/studio-contract';
import {GPU_MODEL_PREPARATION_RECIPE,GPU_MODEL_PREPARATION_RECIPE_SHA256} from './gpu-model-preparation-contract.ts';
import {parseGpuModelSource,verifyGpuSourcePreservation} from './gpu-source-preservation.ts';
import {inspectCompactModelSource,matchesModelPreparationInput,type ModelPreparationInput} from './oam-original-preparation.ts';
import {decodePngPixels} from './png-pixels.ts';

const fail=():never=>{throw Error('GPU_MODEL_PRODUCER_SOURCE_UNSUPPORTED');};
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function canonical(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>JSON.stringify(key)+':'+canonical(item)).join(',')+'}';
 return JSON.stringify(value);
}
function freeze<T>(value:T):T {
 if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;
}
export interface GpuModelRole {
 role:'baseColor'|'normal'|'occlusion';textureIndex:number;sourceImageIndex:number;sourceSHA256:string;sourceBytes:number;
 outputPngImageIndex:number;outputPngSHA256:string;outputPngBytes:number;width:512;height:512;colorSpace:'srgb'|'linear';
}
export interface GpuModelSourceInspection {
 /** Detached job-owned encoded PNG, never a pixel conversion or source slice. */
 colourPNG:Buffer;source:Readonly<ModelPreparationInput>;metrics:Readonly<{triangles:number;vertices:number}>;
 roles:readonly Readonly<GpuModelRole>[];samplerSHA256:string;
}

function inspect(source:Buffer,input:ModelPreparationInput){
 if(!matchesModelPreparationInput(source,input))throw Error('MODEL_PREPARATION_INPUT_INTEGRITY');
 // Duplicate and escaped-alias keys must fail before the ordinary JSON-based inspector.
 const parsed=parseGpuModelSource(source);
 if(!isDeepStrictEqual(parsed.doc,JSON.parse(JSON.stringify(parsed.doc))))fail();
 const model=inspectCompactModelSource(source,input),doc=model.doc;
 if(model.roles.length!==3||doc.images.length!==3||doc.textures.length!==3)fail();
 // The first profile admits implicit glTF repeat/mipmapped semantics only. Even
 // equivalent explicit filter/wrap values are not silently rewritten or guessed.
 for(const sampler of doc.samplers??[])if(Object.keys(sampler).length!==0)fail();
 const bindings=[doc.materials[0].pbrMetallicRoughness.baseColorTexture,doc.materials[0].normalTexture,doc.materials[0].occlusionTexture];
 const names=['baseColor','normal','occlusion'] as const;
 const roles=names.map((role,index):GpuModelRole=>{
  const binding=bindings[index];if(!binding)fail();
  const textureIndex=binding.index as number,sourceImageIndex=doc.textures[textureIndex].source as number,image=model.images[sourceImageIndex];
  if(!image||image.mime!=='image/png')return fail();
  const decoded=decodePngPixels(image.bytes,512*512,512);
  if(decoded.width!==512||decoded.height!==512||decoded.channels!==3)fail();
  // Colour is assigned sRGB by the frozen recipe; contradictory embedded sRGB
  // metadata on linear normal/AO inputs is outside this closed profile.
  if(role!=='baseColor'&&decoded.srgbIntent!==undefined)fail();
  const digest=sha(image.bytes);
  return {role,textureIndex,sourceImageIndex,sourceSHA256:digest,sourceBytes:image.bytes.length,outputPngImageIndex:sourceImageIndex,
   outputPngSHA256:digest,outputPngBytes:image.bytes.length,width:512,height:512,colorSpace:role==='baseColor'?'srgb':'linear'};
 });
 const inspection:GpuModelSourceInspection={colourPNG:Buffer.from(model.images[roles[0]!.sourceImageIndex]!.bytes),source:freeze({sha256:input.sha256,bytes:input.bytes}),
  metrics:freeze({triangles:model.indices.length/3,vertices:model.vertices}),roles:freeze(roles),samplerSHA256:sha(Buffer.from(canonical(doc.samplers??null)))};
 return {parsed,doc,inspection};
}
/** Static admission only; custody, approval, rights, and encoder admission are caller obligations. */
export function inspectGpuModelSource(source:Buffer,input:ModelPreparationInput):GpuModelSourceInspection {
 return inspect(source,input).inspection;
}

export interface GpuModelProducerReceipt {
 version:1;
 tool:{name:'toktx';version:'4.4.2';executableSHA256:string;librarySHA256:string;recipeSHA256:string};
 geometry:{algorithm:'glb-source-preservation-v1';sourceSHA256:string;outputSHA256:string;triangles:number;vertices:number};
 samplers:{sourceSHA256:string;outputSHA256:string;semantics:'source-preserved-implicit-repeat-mipmapped'};
 roles:readonly Readonly<GpuModelRole>[];
 ktx:{imageIndex:number;sha256:string;bytes:number;width:512;height:512;levels:10;format:'uastc';transfer:'srgb';opaque:true;levelDimensions:readonly number[]};
}
/** Pure append-only assembly. Structural KTX validation is not decode or quality proof. */
export function assembleGpuModelDerivative(source:Buffer,input:ModelPreparationInput,ktx:Buffer):{bytes:Buffer;producer:GpuModelProducerReceipt} {
 const {parsed,doc,inspection}=inspect(source,input);
 boundedMippedKtx2(ktx);
 const output=structuredClone(doc),imageIndex=output.images.length,textureIndex=inspection.roles[0]!.textureIndex;
 const binLength=Math.ceil((parsed.bin.length+ktx.length)/4)*4;
 const bin=Buffer.alloc(binLength);parsed.bin.copy(bin);ktx.copy(bin,parsed.bin.length);
 output.bufferViews.push({buffer:0,byteOffset:parsed.bin.length,byteLength:ktx.length});
 output.images.push({bufferView:output.bufferViews.length-1,mimeType:'image/ktx2'});
 output.textures[textureIndex].extensions={KHR_texture_basisu:{source:imageIndex}};
 output.extensionsUsed=['KHR_texture_basisu'];output.buffers[0].byteLength=binLength;
 const raw=Buffer.from(JSON.stringify(output)),json=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(json);
 const bytes=Buffer.alloc(28+json.length+binLength);bytes.writeUInt32LE(0x46546c67);bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);
 bytes.writeUInt32LE(json.length,12);bytes.writeUInt32LE(0x4e4f534a,16);json.copy(bytes,20);
 bytes.writeUInt32LE(binLength,20+json.length);bytes.writeUInt32LE(0x004e4942,24+json.length);bin.copy(bytes,28+json.length);
 const ktxSHA256=sha(ktx),preserved=verifyGpuSourcePreservation(source,bytes,{source:{sha256:input.sha256,bytes:input.bytes},candidate:{sha256:sha(bytes),bytes:bytes.length},textureIndex,ktx:{sha256:ktxSHA256,bytes:ktx.length}});
 const recipe=GPU_MODEL_PREPARATION_RECIPE;
 const producer:GpuModelProducerReceipt=freeze({version:1,tool:{name:'toktx',version:'4.4.2',executableSHA256:recipe.encoder.sha256,librarySHA256:recipe.encoder.librarySHA256,recipeSHA256:GPU_MODEL_PREPARATION_RECIPE_SHA256},
  geometry:{algorithm:preserved.algorithm,sourceSHA256:preserved.sourceSHA256,outputSHA256:preserved.outputSHA256,...inspection.metrics},
  samplers:{sourceSHA256:inspection.samplerSHA256,outputSHA256:inspection.samplerSHA256,semantics:'source-preserved-implicit-repeat-mipmapped'},roles:inspection.roles,
  ktx:{imageIndex,sha256:ktxSHA256,bytes:ktx.length,width:512,height:512,levels:10,format:'uastc',transfer:'srgb',opaque:true,levelDimensions:[512,256,128,64,32,16,8,4,2,1]}});
 return {bytes,producer};
}
