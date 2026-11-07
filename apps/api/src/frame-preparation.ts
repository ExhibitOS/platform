// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';

export const FRAME_PREPARATION_POLICY='omit-unused-invalid-tangent-r1' as const;
export type FramePreparationModel={mime:'model/gltf-binary';bytes:number;sha256:string};
type Pair={id:string;source:FramePreparationModel;renderable:FramePreparationModel;bindings:readonly (readonly [number,number,number])[]};
const model=(bytes:number,sha256:string):FramePreparationModel=>({mime:'model/gltf-binary',bytes,sha256});
const pairs:readonly Pair[]=[
 {id:'black-aluminum-frame',source:model(101768,'17c571accc4ed2554731d4ce89f3cad4faa66cf2bca83321ecd92ad2537093d9'),renderable:model(101720,'2fb941a9f6ed030638512e917e348a0a3000e29c1133fe3f9670268ff1c4169c'),bindings:[[0,0,3],[1,0,8],[2,0,13],[3,0,18]]},
 {id:'brushed-silver-frame',source:model(147640,'b21ee369bf9e2d958d9ff2c03cf2457bbd22669c7d1621c379bebcb6330a8c89'),renderable:model(147592,'a0d0c0d3f02fea91b6a09273eec8d200248a16c8caf5139bd029b681af8eddcd'),bindings:[[0,0,3],[1,0,8],[2,0,13],[3,0,18]]},
 {id:'natural-oak-flat-frame',source:model(177500,'06ac605194e7aa870c4c9c68c17e00b6d1256c421aba6ed9b169e7f873b7b8d9'),renderable:model(177476,'5af789b1aa8e6aa410b40cf16e27c9e2000f87438f1fa52cb08bc46c19c75778'),bindings:[[0,0,3],[3,0,18]]},
];
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export function framePreparationPair(source:{bytes:number;sha256:string}):Pair|undefined{return pairs.find(p=>p.source.bytes===source.bytes&&p.source.sha256===source.sha256);}

/** Derive only the three admitted exact inputs. The whole source and result are
 * hash-pinned: no unknown GLB, normal map or other modification is admitted. */
export function prepareExactFrame(source:Buffer):{bytes:Buffer;pair:Pair}{
 const pair=framePreparationPair({bytes:source.length,sha256:digest(source)});
 const fail=():never=>{throw Error('FRAME_PREPARATION_UNSAFE');};
 if(!pair||source.length<28||source.toString('ascii',0,4)!=='glTF'||source.readUInt32LE(4)!==2||source.readUInt32LE(8)!==source.length||source.readUInt32LE(16)!==0x4e4f534a)return fail();
 const end=20+source.readUInt32LE(12);if(end+8>source.length||end%4!==0||source.readUInt32LE(end+4)!==0x004e4942||source.readUInt32LE(end)+8!==source.length-end)return fail();
 type Primitive={material?:number;extensions?:unknown;targets?:unknown;attributes?:{TANGENT?:number}};
 type Document={extensionsUsed?:unknown[];extensionsRequired?:unknown[];meshes?:{primitives?:Primitive[]}[];materials?:{normalTexture?:unknown;extensions?:unknown}[]};
 let doc:Document;try{doc=JSON.parse(source.toString('utf8',20,end)) as Document;}catch{return fail();}
 if(!doc||typeof doc!=='object'||(doc.extensionsUsed?.length??0)!==0||(doc.extensionsRequired?.length??0)!==0||!Array.isArray(doc.meshes)||!Array.isArray(doc.materials))return fail();
 for(const [mi,pi,accessor] of pair.bindings){
  const primitive=doc.meshes[mi]?.primitives?.[pi],material=primitive?.material===undefined?undefined:doc.materials[primitive.material];
  if(!primitive||!material||material.normalTexture!==undefined||material.extensions!==undefined||primitive.extensions!==undefined||primitive.targets!==undefined||primitive.attributes?.TANGENT!==accessor)return fail();
  delete primitive.attributes.TANGENT;
 }
 const json=Buffer.from(JSON.stringify(doc)),padded=Buffer.alloc(Math.ceil(json.length/4)*4,32);json.copy(padded);
 const header=Buffer.from(source.subarray(0,20)),bin=source.subarray(end);header.writeUInt32LE(20+padded.length+bin.length,8);header.writeUInt32LE(padded.length,12);
 const bytes=Buffer.concat([header,padded,bin]);if(bytes.length!==pair.renderable.bytes||digest(bytes)!==pair.renderable.sha256)return fail();
 return {bytes,pair};
}
