// SPDX-License-Identifier: AGPL-3.0-or-later
import * as three from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {modelGeometryResidentBytes} from './loading';

/** CPU geometry inspection uses the installed renderer's actual GLTF material
 * and node construction. Texture dependencies are placeholders, so no image,
 * network resource, DOM canvas or GPU is acquired; texture memory stays unknown.
 * Only source bytes already matched to their requested digest are parsed. */
export async function loadBudgetGeometry(bytes:Uint8Array,source:{sha256:string;bytes:number},maximumAnalysisBytes=256*1024*1024){
 if(bytes.byteLength!==source.bytes||!/^[a-f0-9]{64}$/.test(source.sha256))throw Error('SCENE_RESOURCE_ASSET_IDENTITY');
 const input=new Uint8Array(bytes),sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',input))].map(n=>n.toString(16).padStart(2,'0')).join('');
 if(sha!==source.sha256)throw Error('SCENE_RESOURCE_ASSET_IDENTITY');
 const v=new DataView(input.buffer),size=bytes.byteLength;
 if(size<28||v.getUint32(0,true)!==0x46546c67||v.getUint32(4,true)!==2||v.getUint32(8,true)!==size||v.getUint32(16,true)!==0x4e4f534a)throw Error('SCENE_RESOURCE_GLB_UNSUPPORTED');
 const jsonSize=v.getUint32(12,true),binStart=28+jsonSize;
 if(jsonSize%4||jsonSize>1024*1024||binStart>size||v.getUint32(24+jsonSize,true)!==0x004e4942||v.getUint32(20+jsonSize,true)!==size-binStart)throw Error('SCENE_RESOURCE_GLB_UNSUPPORTED');
 const doc=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(input.subarray(20,20+jsonSize)));
 if(doc.skins!==undefined||doc.animations!==undefined||(doc.meshes??[]).some((mesh:{primitives?:{targets?:unknown}[]})=>mesh.primitives?.some(primitive=>primitive.targets!==undefined)))throw Error('SCENE_RESOURCE_GLB_UNSUPPORTED');
 if((doc.images??[]).some((image:{uri?:unknown})=>image.uri!==undefined))throw Error('SCENE_RESOURCE_EXTERNAL_OR_UNSUPPORTED');
 if(!Array.isArray(doc.buffers)||doc.buffers.length!==1||doc.buffers[0].uri!==undefined||!Array.isArray(doc.nodes))throw Error('SCENE_RESOURCE_EXTERNAL_OR_UNSUPPORTED');
 const geometryBytes=modelGeometryResidentBytes(doc,size-binStart),estimatedParse=bytes.byteLength*5+geometryBytes+doc.nodes.length*4096;
 if(!Number.isSafeInteger(estimatedParse)||estimatedParse>maximumAnalysisBytes)throw Error('SCENE_RESOURCE_ANALYSIS_BUDGET');
 const textures=new Map<number,three.Texture>(),resources=new Set<{dispose():void}>();let model:three.Group|undefined,disposed=false;
 const dispose=()=>{if(disposed)return;disposed=true;model?.traverse(node=>{if(node instanceof three.Mesh||node instanceof three.Line||node instanceof three.Points){resources.add(node.geometry);for(const material of Array.isArray(node.material)?node.material:[node.material])resources.add(material);}});for(const texture of textures.values())resources.add(texture);for(const resource of resources)resource.dispose();};
 try{
  const manager=new three.LoadingManager();manager.setURLModifier(()=>{throw Error('SCENE_RESOURCE_EXTERNAL_OR_UNSUPPORTED');});
  const loader=new GLTFLoader(manager);
  loader.register(parser=>({name:'EXHIBITOS_geometry_accounting',beforeRoot:async()=>{
   const dependency=parser.getDependency.bind(parser);
   parser.getDependency=(type,index)=>{
    if(type!=='texture')return dependency(type,index);
    let texture=textures.get(index);if(!texture){texture=new three.Texture();texture.flipY=false;textures.set(index,texture);}return Promise.resolve(texture);
   };
  }}));
  model=(await loader.parseAsync(input.buffer,'')).scene;
  return {model,geometryBytes,hasTextures:(doc.textures?.length??0)>0,dispose};
 }catch(error){dispose();throw error;}
}
