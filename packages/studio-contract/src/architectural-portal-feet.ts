// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {qualifiedModularPortalTarget,workspaceFitGeometry} from '@exhibitos/spec/workspace-fit-models';
import {validateWorkspaceFurnishings,WORKSPACE_FURNISHING_NAMESPACE,type WorkspaceFurnishings} from './workspace-furnishing.js';

export interface ArchitecturalPortalFoot {min:[number,number,number];max:[number,number,number]}
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const unsupported=():never=>{throw Error('PLAIN_BASEBOARD_PORTAL_UNSUPPORTED');};
/** Wall-local bounds from an admitted source-bound modular fit, after its
 * existing target adaptation. Never infer trim from a whole-model AABB. */
export function plainBaseboardPortalFeet(document:Exhibition,surfaceId:string):ArchitecturalPortalFoot[]{
 const openings=document.openings.filter(o=>same(o.surfaceId,surfaceId)),ids=new Set(openings.map(o=>o.id.toLowerCase()));
 const legacy=document.extensions?.['org.exhibitos.studio/furnishing-visuals'] as unknown as {bindings?:{hostKind:string;hostId:string}[]}|undefined;
 if(legacy?.bindings?.some(b=>b.hostKind==='opening'&&ids.has(b.hostId.toLowerCase())))return unsupported();
 const workspace=document.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;
 if(!workspace)return [];
 if(!validateWorkspaceFurnishings(document).valid)return unsupported();
 const result:ArchitecturalPortalFoot[]=[];
 for(const opening of openings){
  const attachments=workspace.openingAttachments?.filter(a=>same(a.openingId,opening.id))??[];
  if(!attachments.length)continue;
  if(attachments.length!==1)return unsupported();
  const attachment=attachments[0]!,sources=workspace.furnishings.filter(f=>same(f.id,attachment.furnishingId)&&f.version===attachment.furnishingVersion),source=sources[0];
  if(sources.length!==1||!source||source.kind!=='portal-finish'||source.model.sha256!==attachment.modelSha256)return unsupported();
  const geometry=workspaceFitGeometry(source);
  if(!geometry||geometry.profile!=='modular-portal-v1')return unsupported();
  const target=qualifiedModularPortalTarget(geometry,document,opening.id);
  if(!target)return unsupported();
  for(const face of ['front','back'] as const)for(const side of ['left','right'] as const){
   const part=geometry.parts[`${face}-${side}`],width=part.max[0]-part.min[0],edge=opening.offset[0]+(side==='left'?-target.width/2:target.width/2),bottom=opening.offset[1]-target.height/2;
   const z=face==='front'?target.maxZ-geometry.maxZ:target.minZ-geometry.minZ;
   result.push({min:[side==='left'?edge-width:edge,bottom,z+part.min[2]],max:[side==='left'?edge:edge+width,bottom+target.height,z+part.max[2]]});
  }
 }
 return result;
}
