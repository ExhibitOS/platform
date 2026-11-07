// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import type {ChildProcess} from 'node:child_process';
import type {OexWorkspaceMaterialManifest} from '@exhibitos/spec';
import {WORKSPACE_MATERIAL_NAMESPACE,type WorkspaceMaterialBindings} from '@exhibitos/spec/workspace-material';
import {ApiError,uuid} from './auth.ts';
import {workspaceMaterialOutputInventory} from './workspace-material-output.ts';
import {validateWorkspaceMaterialPng,type WorkspaceMaterialMapDescriptor} from './workspace-material-png.ts';

/** Prepare the exact source rows for an owned import. The caller must first
 * validate the archive, bind its raw manifest and scene to the selected owner
 * and live lease, and commit the returned rows in the SAME fenced transaction
 * as the cleanup inventory. This function neither proves nor grants those
 * properties and is not connected to the existing native import protocol.
 * A future caller must allocate attempt-scoped keys explicitly and retain the
 * separate lease authority; do not substitute a legacy lease-scoped key. */
export function planWorkspaceMaterialImportSource(input:{tenantId:string;jobId:string;attemptId:string;manifest:OexWorkspaceMaterialManifest;scene:{extensions?:Record<string,unknown>;surfaces?:unknown};sourceKeys:ReadonlyMap<string,string>}){
 for(const id of [input.tenantId,input.jobId,input.attemptId]){uuid(id);if(id!==id.toLowerCase())throw new ApiError(400,'INVALID_INPUT');}
 const {manifest,scene,sourceKeys}=input;
 if(!manifest||manifest.formatVersion!=='1.0.0-draft.12'||manifest.archiveProfile!=='bounded-file-v1'||!Array.isArray(manifest.workspaceMaterialResources)||!(sourceKeys instanceof Map))throw new ApiError(422,'OEX_WORKSPACE_SOURCE_INVALID');
 const resources=workspaceMaterialOutputInventory(scene),declared=manifest.workspaceMaterialResources;
 if(!resources.length||resources.length!==declared.length||new Set(sourceKeys.values()).size!==sourceKeys.size)throw new ApiError(422,'OEX_WORKSPACE_SOURCE_INVALID');
 const bindings=scene.extensions![WORKSPACE_MATERIAL_NAMESPACE] as WorkspaceMaterialBindings;
 const byPath=new Map(resources.map(resource=>[resource.path,resource]));
 if(byPath.size!==resources.length||new Set(declared.map(resource=>resource.path)).size!==declared.length)throw new ApiError(422,'OEX_WORKSPACE_SOURCE_INVALID');
 const prefix=`${input.tenantId}/oex-import/${input.jobId}/${input.attemptId}/`;
 return declared.map(resource=>{
  const expected=byPath.get(resource.path),key=sourceKeys.get(resource.path),material=bindings.materials.find(item=>item.id.toLowerCase()===resource.materialId&&item.version===resource.materialVersion);
  if(!expected||!isDeepStrictEqual(expected,resource)||!material||!['color','normal','roughness'].includes(resource.role)||!material.maps[resource.role]||typeof key!=='string'||!key.startsWith(prefix))throw new ApiError(422,'OEX_WORKSPACE_SOURCE_INVALID');
  const suffix=key.slice(prefix.length);try{uuid(suffix);}catch{throw new ApiError(422,'OEX_WORKSPACE_SOURCE_INVALID');}if(suffix!==suffix.toLowerCase())throw new ApiError(422,'OEX_WORKSPACE_SOURCE_INVALID');
  return Object.freeze({sourceMaterialId:resource.materialId,sourceMaterialVersion:resource.materialVersion,role:resource.role as 'color'|'normal'|'roughness',sourcePath:resource.path,sha256:resource.sha256,bytes:resource.bytes,objectKey:key,descriptor:Object.freeze(structuredClone(material.maps[resource.role]!))});
 });
}

/** Validate source content before writing it to the staged object key. The
 * owner still retains the claim, lease and child-process drain obligations. */
export async function validateWorkspaceMaterialImportSourceBytes(source:{role:'color'|'normal'|'roughness';descriptor:WorkspaceMaterialMapDescriptor},bytes:Buffer,hooks?:{onSpawn?:(child:ChildProcess)=>void}){
 if(!source||!['color','normal','roughness'].includes(source.role))throw new ApiError(422,'OEX_WORKSPACE_SOURCE_INVALID');
 await validateWorkspaceMaterialPng(source.role,source.descriptor,bytes,hooks);
}
