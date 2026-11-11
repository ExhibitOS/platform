// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import {PLAQUE_NAMESPACE,TEMPLATE_NAMESPACE,WORKSPACE_FURNISHING_NAMESPACE,validateStudioPlaques,validateWorkspaceFurnishings,type StudioPlaques,type WorkspaceFurnishings} from '@exhibitos/studio-contract';
import type {Draft} from './studio.ts';

export const PROFILE='workspace-info-stand-replacement-v1' as const;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
/** Match a bounded scene delta, not registration, rights or durable stand/plaque linkage.
 * The caller must independently assert the current owned immutable snapshot.
 * An unreferenced prior descriptor is retired from this scene only; its registry
 * version is never removed. All other descriptors retain their exact order/data.
 */
export function ordinaryWorkspaceInfoStandReplacementDelta(before:Draft,after:Draft):boolean {
 try {
  if(!validateWorkspaceFurnishings(before.candidate).valid||!validateWorkspaceFurnishings(after.candidate).valid||
    !validateStudioPlaques(before.candidate).valid||!validateStudioPlaques(after.candidate).valid)return false;
  const left=before.candidate.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;
  const right=after.candidate.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;
  const plaques=before.candidate.extensions?.[PLAQUE_NAMESPACE] as unknown as StudioPlaques|undefined;
  const nextPlaques=after.candidate.extensions?.[PLAQUE_NAMESPACE] as unknown as StudioPlaques|undefined;
  if(!left||!right||![3,4,5,6,7].includes(left.version)||left.version!==right.version||
    left.placements.length!==right.placements.length||!plaques||!nextPlaques||plaques.plaques.length!==nextPlaques.plaques.length)return false;
  const changes=left.placements.flatMap((row,i)=>isDeepStrictEqual(row,right.placements[i])?[]:[i]);
  if(changes.length!==1)return false;
  const index=changes[0]!,prior=left.placements[index]!,next=right.placements[index]!;
  if(prior.id!==next.id||prior.roomId!==next.roomId||prior.furnishingVersion!==1||next.furnishingVersion!==1)return false;
  const old=left.furnishings.find(row=>row.id===prior.furnishingId),target=right.furnishings.find(row=>row.id===next.furnishingId);
  if(old?.kind!=='info-stand'||target?.kind!=='info-stand'||old.version!==1||target.version!==1)return false;
  // There is no persistent stand/plaque association. Native supplies an explicit
  // pair; here only the single changed existing same-room artwork plaque is inferred.
  if(!plaques.plaques.some(row=>row.roomId===prior.roomId&&row.source.kind==='artwork'))return false;
  const plaqueChanges=plaques.plaques.flatMap((row,i)=>isDeepStrictEqual(row,nextPlaques.plaques[i])?[]:[i]);
  if(plaqueChanges.length>1)return false;
  const expected=structuredClone(before);
  const extension=expected.candidate.extensions![WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings;
  extension.placements[index]=structuredClone(next);
  const oldStillUsed=right.placements.some(row=>row.furnishingId===old.id)||
    right.frameAttachments?.some(row=>row.furnishingId===old.id)||right.openingAttachments?.some(row=>row.furnishingId===old.id);
  extension.furnishings=left.furnishings.filter(row=>oldStillUsed||row.id!==old.id).map(row=>structuredClone(row));
  if(!left.furnishings.some(row=>row.id===target.id))extension.furnishings.push(structuredClone(target));
  if(plaqueChanges.length){
    const i=plaqueChanges[0]!,plaque=plaques.plaques[i]!,nextPlaque=nextPlaques.plaques[i]!;
    if(plaque.source.kind!=='artwork'||plaque.roomId!==prior.roomId)return false;
    const row=(expected.candidate.extensions![PLAQUE_NAMESPACE] as unknown as StudioPlaques).plaques[i]!;
    row.position=structuredClone(nextPlaque.position);row.rotation=structuredClone(nextPlaque.rotation);row.dimensions=structuredClone(nextPlaque.dimensions);
  }
  const template=expected.candidate.extensions?.[TEMPLATE_NAMESPACE],nextTemplate=after.candidate.extensions?.[TEMPLATE_NAMESPACE];
  if(object(template)&&object(nextTemplate)&&typeof template.modified==='boolean'&&nextTemplate.modified===true)template.modified=true;
  expected.editVersion=after.editVersion;expected.updatedAt=after.updatedAt;
  return isDeepStrictEqual(expected,after);
 }catch{return false;}
}
