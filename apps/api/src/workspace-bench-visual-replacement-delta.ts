// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import {BENCH_NAMESPACE,TEMPLATE_NAMESPACE,WORKSPACE_FURNISHING_NAMESPACE,benchesFor,validateStudioBenches,validateWorkspaceFurnishings,type StudioBenches,type WorkspaceFurnishings} from '@exhibitos/studio-contract';
import type {Draft} from './studio.ts';
export const PROFILE='workspace-bench-visual-replacement-v1' as const;
/** One existing backed seat keeps its authored identity, pose, viewpoint and
 * collision overrides. Only its registered visual changes. The caller repeats
 * live owner/registry/rights/bytes checks; this structural match grants none. */
export function ordinaryWorkspaceBenchVisualReplacementDelta(before:Draft,after:Draft):boolean {
 try {
  if(!validateWorkspaceFurnishings(before.candidate).valid||!validateWorkspaceFurnishings(after.candidate).valid||
    !validateStudioBenches(before.candidate).valid||!validateStudioBenches(after.candidate).valid)return false;
  const left=before.candidate.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;
  const right=after.candidate.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;
  if(!left||!right||left.version!==right.version||left.placements.length!==right.placements.length)return false;
  const changes=left.placements.flatMap((row,i)=>isDeepStrictEqual(row,right.placements[i])?[]:[i]);
  if(changes.length!==1)return false;
  const index=changes[0]!,prior=left.placements[index]!,next=right.placements[index]!;
  if(!isDeepStrictEqual({...prior,furnishingId:next.furnishingId},next)||prior.furnishingId===next.furnishingId||prior.furnishingVersion!==1||prior.scale!==1)return false;
  const old=left.furnishings.find(row=>row.id===prior.furnishingId),target=right.furnishings.find(row=>row.id===next.furnishingId);
  if(old?.kind!=='bench'||target?.kind!=='bench'||old.version!==1||target.version!==1)return false;
  const hosts=benchesFor(before.candidate).filter(row=>row.workspaceVisual?.placementId===prior.id);
  if(hosts.length!==1||hosts[0]!.kind!=='backed'||hosts[0]!.workspaceVisual!.modelSha256!==old.model.sha256)return false;
  const expected=structuredClone(before);
  const extension=expected.candidate.extensions![WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings;
  extension.placements[index]=structuredClone(next);
  const oldStillUsed=right.placements.some(row=>row.furnishingId===old.id)||right.frameAttachments?.some(row=>row.furnishingId===old.id)||right.openingAttachments?.some(row=>row.furnishingId===old.id);
  extension.furnishings=left.furnishings.filter(row=>oldStillUsed||row.id!==old.id).map(row=>structuredClone(row));
  if(!left.furnishings.some(row=>row.id===target.id))extension.furnishings.push(structuredClone(target));
  const host=(expected.candidate.extensions![BENCH_NAMESPACE] as unknown as StudioBenches).benches.find(row=>row.id===hosts[0]!.id)!;
  host.workspaceVisual!.modelSha256=target.model.sha256;
  const template=expected.candidate.extensions?.[TEMPLATE_NAMESPACE],nextTemplate=after.candidate.extensions?.[TEMPLATE_NAMESPACE];
  if(template&&nextTemplate&&typeof template==='object'&&typeof nextTemplate==='object'&&'modified' in template&&typeof template.modified==='boolean'&&'modified' in nextTemplate&&nextTemplate.modified===true)template.modified=true;
  expected.editVersion=after.editVersion;expected.updatedAt=after.updatedAt;
  return isDeepStrictEqual(expected,after);
 }catch{return false;}
}
