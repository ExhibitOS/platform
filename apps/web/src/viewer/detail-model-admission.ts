// SPDX-License-Identifier: AGPL-3.0-or-later
import type {DetailAccess} from '../publication-client';
import type {DetailRuntimeProfile} from './detail-runtime-profile';
import {modelGeometryResidentBytes,textureResidentBytes} from './loading';

type Candidate=Awaited<ReturnType<DetailAccess['candidatesFor']>>[number];
export const acquiredModelRuntime:DetailRuntimeProfile={
 renderer:'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)',platform:'macOS',
 browserBrand:'Google Chrome',browserVersion:'156.0.8078.79',samples:4,alpha:false,depth:true,antialias:true,preserveDrawingBuffer:true,
};
export const acquiredModelTransitionCap=768*1024*1024;
export const acquiredModelTextureEdge=4096;
const inspector='native-adopted-embedded-glb-v1';

export function eligibleAcquiredModel(candidate:Candidate,maxTriangles:number,maxTextureSize:number){
 const {media,cost}=candidate.featureReport;
 if(candidate.tier!=='acquired-original'||candidate.mime!=='model/gltf-binary'||candidate.featureReport.inspector!==inspector||
   cost.model!==inspector||media.kind!=='glb'||media.triangles>maxTriangles||media.requiredExtensions.length||
   media.sceneCount!==1||media.nodeCount!==1||media.primitiveCount!==1||media.drawCount!==1||
   !media.textures.length||media.textures.length>3||media.textures.some(t=>t.codec==='ktx2'||t.textureReferences!==1||
    Math.max(t.width,t.height)>Math.min(maxTextureSize,acquiredModelTextureEdge)))return;
 const resident=media.geometryCpuBytes+media.geometryGpuBytes+
  media.textures.reduce((sum,t)=>sum+textureResidentBytes(t.width,t.height),0);
 if(resident!==cost.residentBytes||resident+candidate.bytes*5!==cost.peakAdditionalBytes)return;
 return {media,cost};
}

/** Read dimensions before handing JPEG data to the browser decoder. */
export function embeddedJpegSize(bytes:Uint8Array){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(bytes.length<12||view.getUint16(0)!==0xffd8||view.getUint16(bytes.length-2)!==0xffd9)return;
 for(let offset=2;offset+4<bytes.length;){
  if(bytes[offset++]!==0xff)return;
  while(bytes[offset]===0xff)offset++;
  const marker=bytes[offset++];
  if(marker===undefined||marker===0xda||marker===0xd9||offset+2>bytes.length)return;
  const length=view.getUint16(offset);
  if(length<2||offset+length>bytes.length)return;
  if(marker===0xc0||marker===0xc2){
   if(length<11||bytes[offset+2]!==8||![1,3].includes(bytes[offset+7]!))return;
   const width=view.getUint16(offset+5),height=view.getUint16(offset+3);
   if(width&&height)return {width,height};
   return;
  }
  offset+=length;
 }
}

export function checkAcquiredModelGeometry(bytes:ArrayBuffer,media:NonNullable<ReturnType<typeof eligibleAcquiredModel>>['media']){
 const view=new DataView(bytes);
 if(bytes.byteLength<28||view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||
  view.getUint32(8,true)!==bytes.byteLength||view.getUint32(16,true)!==0x4e4f534a)throw Error('DETAIL_MODEL_PROFILE');
 const length=view.getUint32(12,true),start=28+length;
 if(start>bytes.byteLength||length>1048576||length%4||view.getUint32(24+length,true)!==0x004e4942||
  view.getUint32(20+length,true)!==bytes.byteLength-start)throw Error('DETAIL_MODEL_PROFILE');
 const model=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(bytes,20,length)));
 const allowed=['asset','scene','scenes','nodes','meshes','materials','textures','images','accessors','bufferViews','buffers','samplers'];
 if(Object.keys(model).some(key=>!allowed.includes(key))||model.scene!==0||model.scenes?.length!==1||model.nodes?.length!==1||
  model.meshes?.length!==1||model.meshes[0]?.primitives?.length!==1||model.materials?.length!==1||
  model.images?.length!==media.textures.length||model.textures?.length!==media.textures.length)throw Error('DETAIL_MODEL_PROFILE');
 const primitive=model.meshes[0].primitives[0],index=model.accessors?.[primitive.indices];
 if((primitive.mode??4)!==4||index?.count!==media.triangles*3||primitive.targets!==undefined||
  modelGeometryResidentBytes(model,bytes.byteLength-start)!==media.geometryCpuBytes+media.geometryGpuBytes)throw Error('DETAIL_MODEL_PROFILE');
}
