// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import {TEMPLATE_NAMESPACE,WORKSPACE_FURNISHING_NAMESPACE,validateWorkspaceFurnishings,type WorkspaceFurnishingDescriptor,type WorkspaceFurnishings} from '@exhibitos/studio-contract';
import type {Draft} from './studio.ts';

/** Replace one selected same-source ceiling run with one registered visual.
 * Structural matching grants no registry, rights, bytes or owner authority. */
export function ordinaryCeilingRailReplacementDelta(before:Draft,after:Draft):boolean {
 try {
  if(!validateWorkspaceFurnishings(before.candidate).valid||!validateWorkspaceFurnishings(after.candidate).valid)return false;
  const left=before.candidate.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;
  const right=after.candidate.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;
  if(left?.version!==11||right?.version!==11)return false;
  const removed=left.placements.filter(p=>!right.placements.some(n=>n.id===p.id));
  const added=right.placements.filter(p=>!left.placements.some(n=>n.id===p.id));
  if(!removed.length||added.length!==1)return false;
  const prior=removed[0]!,next=added[0]!;
  if(removed.some(p=>p.furnishingId!==prior.furnishingId||p.roomId!==prior.roomId)||next.roomId!==prior.roomId||next.furnishingId===prior.furnishingId)return false;
  const old=left.furnishings.find(d=>d.id===prior.furnishingId),target=right.furnishings.find(d=>d.id===next.furnishingId);
  if(old?.kind!=='ceiling-rail'||target?.kind!=='ceiling-rail'||old.model.sha256===target.model.sha256)return false;
  const ids=new Set(removed.map(p=>p.id)),mounts=left.ceilingAttachments!.filter(a=>ids.has(a.placementId));
  const mount=right.ceilingAttachments!.find(a=>a.placementId===next.id);
  if(mounts.length!==removed.length||!mount||mounts.some(a=>a.surfaceId!==mount.surfaceId))return false;
  const expected=structuredClone(before),extension=expected.candidate.extensions![WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings;
  extension.placements=[...left.placements.filter(p=>!ids.has(p.id)).map(p=>structuredClone(p)),structuredClone(next)];
  extension.ceilingAttachments=[...left.ceilingAttachments!.filter(a=>!ids.has(a.placementId)).map(a=>structuredClone(a)),structuredClone(mount)];
  const oldStillUsed=extension.placements.some(p=>p.furnishingId===old.id);
  extension.furnishings=left.furnishings.filter(d=>oldStillUsed||d.id!==old.id).map(d=>structuredClone(d));
  if(!left.furnishings.some(d=>d.id===target.id))extension.furnishings.push(structuredClone(target));
  const template=expected.candidate.extensions?.[TEMPLATE_NAMESPACE],nextTemplate=after.candidate.extensions?.[TEMPLATE_NAMESPACE];
  if(template&&nextTemplate&&typeof template==='object'&&typeof nextTemplate==='object'&&'modified' in template&&typeof template.modified==='boolean'&&'modified' in nextTemplate&&nextTemplate.modified===true)template.modified=true;
  expected.editVersion=after.editVersion;expected.updatedAt=after.updatedAt;
  return isDeepStrictEqual(expected,after);
 }catch{return false;}
}

/** Recognize the draft produced by a single Native rail attachment. The
 * viewport caller still has to verify the current catalog, bytes and fit. */
export function ordinaryCeilingRailInsertionDelta(before:Draft,after:Draft):WorkspaceFurnishingDescriptor|undefined {
 if(after.editVersion!==before.editVersion+1||!validateWorkspaceFurnishings(before.candidate).valid)return;
 const left=before.candidate.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;
 const right=after.candidate?.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;
 if(right?.version!==11||!Array.isArray(right.placements)||!Array.isArray(right.furnishings)||
    !Array.isArray(right.ceilingAttachments))return;
 const placements=left?.placements??[],ceilings=left?.ceilingAttachments??[],furnishings=left?.furnishings??[];
 const added=right.placements[placements.length],attachment=right.ceilingAttachments[ceilings.length];
 if(!added||!attachment||added.id!==attachment.placementId)return;
 const descriptor=right.furnishings.find(item=>item?.id===added.furnishingId);
 if(descriptor?.kind!=='ceiling-rail'||descriptor.version!==added.furnishingVersion)return;
 const expected=structuredClone(before);
 const graph:WorkspaceFurnishings={version:11,placements:[...placements,added],ceilingAttachments:[...ceilings,attachment],
  furnishings:furnishings.some(item=>item.id===descriptor.id)?furnishings:[...furnishings,descriptor],
  frameAttachments:left?.frameAttachments??[],openingAttachments:left?.openingAttachments??[]};
 expected.candidate.extensions={...expected.candidate.extensions,
  [WORKSPACE_FURNISHING_NAMESPACE]:graph as unknown as NonNullable<Draft['candidate']['extensions']>[string]};
 expected.editVersion=after.editVersion;expected.updatedAt=after.updatedAt;
 return isDeepStrictEqual(expected,after)?descriptor:undefined;
}
