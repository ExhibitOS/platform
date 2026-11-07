// SPDX-License-Identifier: Apache-2.0
// The generated schema is compiled from the same public Spec as the server.
import {workspaceMaterialBindingsSchema} from './schema-standalone.mjs';
import {validateRights} from './artwork-validation.mjs';

export const WORKSPACE_MATERIAL_NAMESPACE='org.exhibitos.studio/workspace-materials';
/** Validate the supported floor/wall color, normal and roughness projection before deriving any resource
 * path from a snapshot. Rights authority remains with the source serving bytes. */
export function workspaceFloorMaterials(document){
 const value=document?.extensions?.[WORKSPACE_MATERIAL_NAMESPACE];
 if(value===undefined)return [];
 if(!workspaceMaterialBindingsSchema(value)||!Array.isArray(document.surfaces))throw Error('WORKSPACE_MATERIAL_INVALID');
 const surfaces=new Map();
 for(const surface of document.surfaces){if(!surface||typeof surface.id!=='string'||!['floor','wall','ceiling'].includes(surface.type)||surfaces.has(surface.id.toLowerCase()))throw Error('WORKSPACE_MATERIAL_INVALID');surfaces.set(surface.id.toLowerCase(),surface.type);}
 const materials=new Map(),used=new Set(),targets=new Set();
 for(const material of value.materials){
  const key=material.id.toLowerCase()+':'+material.version;
  if(materials.has(key)||!['floor','wall'].includes(material.kind)||!material.maps.color||Object.keys(material.maps).some(role=>!['color','normal','roughness'].includes(role))||Object.values(material.maps).some(map=>map.width*map.height>4194304)||!validateRights(material.rights).valid)throw Error('WORKSPACE_MATERIAL_UNSUPPORTED');
  materials.set(key,material);
 }
 const result=[];
 for(const binding of value.bindings){
  const target=binding.surfaceId.toLowerCase(),key=binding.materialId.toLowerCase()+':'+binding.materialVersion,material=materials.get(key);
  if(targets.has(target)||!material||surfaces.get(target)!==material.kind)throw Error('WORKSPACE_MATERIAL_INVALID');
  targets.add(target);used.add(key);result.push({binding,material});
 }
 if(used.size!==materials.size||!result.length)throw Error('WORKSPACE_MATERIAL_INVALID');
 return result;
}
