// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import {applyWorkspaceBenchModelForward,benchesFor,TEMPLATE_NAMESPACE,WORKSPACE_FURNISHING_NAMESPACE,type WorkspaceFurnishings} from '@exhibitos/studio-contract';
import type {Draft} from './studio.ts';
/** One existing backed bench declares model-local forward. The registered
 * visual, full host, placement, viewpoint, collision settings and all unrelated
 * draft data are immutable here. This match grants no live authority. */
export function ordinaryWorkspaceBenchModelForwardDelta(before:Draft,after:Draft):boolean {
 try{
  const left=benchesFor(before.candidate),right=benchesFor(after.candidate);
  if(left.length!==right.length)return false;
  const changed=left.flatMap((row,i)=>isDeepStrictEqual(row,right[i])?[]:[i]);if(changed.length!==1)return false;
  const prior=left[changed[0]!]!,next=right[changed[0]!]!,forward=next.workspaceVisual?.modelForward;
  if(!prior.workspaceVisual||!forward||forward===(prior.workspaceVisual.modelForward??'negative-z'))return false;
  const workspace=before.candidate.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;
  const placement=workspace?.placements.find(row=>row.id.toLowerCase()===prior.workspaceVisual!.placementId.toLowerCase());if(!placement)return false;
  const expected=structuredClone(before);
  expected.candidate=applyWorkspaceBenchModelForward(before.candidate,{benchId:prior.id,placementId:placement.id,furnishingId:placement.furnishingId,furnishingVersion:placement.furnishingVersion,modelSha256:prior.workspaceVisual.modelSha256,expectedModelForward:prior.workspaceVisual.modelForward??'negative-z',modelForward:forward});
  const template=expected.candidate.extensions?.[TEMPLATE_NAMESPACE],nextTemplate=after.candidate.extensions?.[TEMPLATE_NAMESPACE];
  if(template&&nextTemplate&&typeof template==='object'&&typeof nextTemplate==='object'&&'modified' in template&&typeof template.modified==='boolean'&&'modified' in nextTemplate&&nextTemplate.modified===true)template.modified=true;
  expected.editVersion=after.editVersion;expected.updatedAt=after.updatedAt;
  return isDeepStrictEqual(expected,after);
 }catch{return false;}
}
