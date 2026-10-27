// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {isPbrMaterial,type PbrMaterial} from './pbr-material.js';
import type {StudioMaterials,MaterialIssue} from './index.js';

export const SURFACE_MATERIAL_TEXTURE_CAPABILITY='surface-material-textures-v1';
export const SURFACE_TEXTURE_PACK_IDS=['museum-matte-paint','fine-lime-plaster'] as const;
export type SurfaceTexturePackId=typeof SURFACE_TEXTURE_PACK_IDS[number];
export interface SurfaceTextureBinding {
 pack:{id:SurfaceTexturePackId;version:1};
 repeatMeters:[number,number];rotation:number;normalScale:number;
}
export type SurfaceMaterialTextureCommand={type:'set-material-texture';surfaceId:string;material:PbrMaterial|null;texture:SurfaceTextureBinding|null};
const namespace='org.exhibitos.studio/materials';
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const closed=(v:unknown,keys:string[])=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const number=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
export function isSurfaceTextureBinding(v:unknown):v is SurfaceTextureBinding {
 return closed(v,['pack','repeatMeters','rotation','normalScale'])&&object(v)&&closed(v.pack,['id','version'])&&object(v.pack)&&v.pack.version===1&&typeof v.pack.id==='string'&&SURFACE_TEXTURE_PACK_IDS.includes(v.pack.id as SurfaceTexturePackId)&&Array.isArray(v.repeatMeters)&&v.repeatMeters.length===2&&v.repeatMeters.every(n=>number(n,.05,20))&&number(v.rotation,-Math.PI,Math.PI)&&number(v.normalScale,0,2);
}
/** Actual authoring repeats; maps remain colour/roughness/NormalGL. Height is not
 * consumed and no ambient-occlusion/metalness content is invented. */
export function surfaceTextureDefaults(id:SurfaceTexturePackId):{material:PbrMaterial;texture:SurfaceTextureBinding}{
 if(!SURFACE_TEXTURE_PACK_IDS.includes(id))throw Error('SURFACE_TEXTURE_UNSUPPORTED');
 const repeat=id==='museum-matte-paint'?1:2;
 return {material:{color:'#ffffff',roughness:1,metalness:0},texture:{pack:{id,version:1},repeatMeters:[repeat,repeat],rotation:0,normalScale:1}};
}
export function surfaceTextureFor(candidate:{extensions?:unknown},surfaceId:string):SurfaceTextureBinding|undefined {
 const materials=object(candidate.extensions)?candidate.extensions[namespace]:undefined,map=object(materials)?materials.surfaceTextures:undefined;
 const value=object(map)?Object.entries(map).find(([id])=>same(id,surfaceId))?.[1]:undefined;
 return value===undefined?undefined:structuredClone(value) as SurfaceTextureBinding;
}
/** Extends the existing 64-surface/16KiB material envelope, not its budget. */
export function validateSurfaceTextures(candidate:unknown,materials:Record<string,unknown>):MaterialIssue[]{
 const errors:MaterialIssue[]=[],base='/candidate/extensions/org.exhibitos.studio~1materials';
 const fail=(suffix:string,message:string)=>errors.push({code:'SURFACE_TEXTURE_SCHEMA',path:base+suffix,message});
 if(!Object.hasOwn(materials,'surfaceTextures'))return errors;
 const textures=materials.surfaceTextures;if(!object(textures)){fail('/surfaceTextures','Expected a surface UUID map');return errors;}
 const surfaces=object(candidate)&&Array.isArray(candidate.surfaces)?candidate.surfaces.filter(object):[],seen=new Set<string>(),all=new Set(object(materials.surfaces)?Object.keys(materials.surfaces).map(id=>id.toLowerCase()):[]);
 for(const [id,value]of Object.entries(textures)){
  const surface=surfaces.find(s=>typeof s.id==='string'&&same(s.id,id));
  if(!uuid(id)||seen.has(id.toLowerCase())||!surface||!['wall','ceiling'].includes(String(surface.type))||!isSurfaceTextureBinding(value))fail('/surfaceTextures/'+id,'Expected one known versioned material on an existing wall or ceiling');
  seen.add(id.toLowerCase());all.add(id.toLowerCase());
 }
 if(all.size>64)fail('/surfaceTextures','Maximum64 distinct material surfaces across both maps');
 return errors;
}
/** Pure namespace delta. The existing geometry command owns base admission,
 * history, template intent and final full-draft validation. */
export function surfaceTextureMaterialMap(candidate:Exhibition,command:SurfaceMaterialTextureCommand):StudioMaterials {
 if(!closed(command,['type','surfaceId','material','texture'])||command.type!=='set-material-texture'||!uuid(command.surfaceId)||command.material!==null&&!isPbrMaterial(command.material)||command.texture!==null&&!isSurfaceTextureBinding(command.texture))throw Error('SURFACE_TEXTURE_INVALID');
 const surface=candidate.surfaces.find(s=>same(s.id,command.surfaceId));if(!surface||!['wall','ceiling'].includes(surface.type))throw Error('SURFACE_TEXTURE_REFERENCE');
 const map=structuredClone(candidate.extensions?.[namespace]??{version:1,surfaces:{}}) as unknown as StudioMaterials;
 if(map.version!==1||!object(map.surfaces))throw Error('SURFACE_TEXTURE_INVALID');
 for(const id of Object.keys(map.surfaces))if(same(id,surface.id))delete map.surfaces[id];
 if(command.material!==null)map.surfaces[surface.id]=structuredClone(command.material);
 const textures=map.surfaceTextures??{};for(const id of Object.keys(textures))if(same(id,surface.id))delete textures[id];
 if(command.texture!==null)textures[surface.id]=structuredClone(command.texture);
 if(Object.keys(textures).length)map.surfaceTextures=textures;else delete map.surfaceTextures;
 if(validateSurfaceTextures(candidate,map as unknown as Record<string,unknown>).length||new TextEncoder().encode(JSON.stringify(map)).length>16384)throw Error('SURFACE_TEXTURE_INVALID');
 return map;
}
