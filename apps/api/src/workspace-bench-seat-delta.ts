// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import {applyBenchCommand,benchesFor,presentationFor,proposeWorkspaceDefaultSeats,validateWorkspaceFurnishings,WORKSPACE_FURNISHING_NAMESPACE,type WorkspaceFurnishingDescriptor,type WorkspaceFurnishings} from '@exhibitos/studio-contract';
import {installedWorkspaceBenchSeat} from './installed-workspace-furnishing.ts';
import type {Draft} from './studio.ts';

/** Reconstruct one authored seat edit through the same command used by Studio. */
export function ordinaryWorkspaceBenchSeatDelta(before:Draft,after:Draft):boolean {
 try {
  const existing=benchesFor(before.candidate);
  const changed=benchesFor(after.candidate).filter(bench=>!isDeepStrictEqual(existing.find(item=>item.id===bench.id),bench));
  if(changed.length!==1||!changed[0]?.workspaceVisual)return false;
  const bench=changed[0],prior=existing.find(item=>item.id===bench.id);
  if(bench.kind==='backed'||prior?.kind==='backed'){
   // Only the first visual link is a scoped edit for an existing backed bench.
   const {workspaceVisual,...host}=bench;
   if(!workspaceVisual||prior?.kind!=='backed'||prior.workspaceVisual||!isDeepStrictEqual(prior,host))return false;
  }else if(prior&&!prior.workspaceVisual)return false;
  const hadViewpoint=presentationFor(before.candidate).viewpoints.some(view=>view.id===bench.viewpointId);
  const viewpoint=hadViewpoint?undefined:presentationFor(after.candidate).viewpoints.find(view=>view.id===bench.viewpointId);
  const candidate=applyBenchCommand(before.candidate,{type:prior?'set-bench':'add-bench',bench,...(viewpoint?{viewpoint}:{})});
  return isDeepStrictEqual({...before,editVersion:after.editVersion,updatedAt:after.updatedAt,candidate},after);
 }catch{return false;}
}

/** Catalogue admission applies to new placements and seat links even when
 * they are saved together with unrelated ordinary edits. */
export function introducedInstalledStockBench(before:Draft,after:Draft):WorkspaceFurnishingDescriptor|undefined {
 const next=after.candidate.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;
 if(!next||!validateWorkspaceFurnishings(after.candidate).valid)return;
 const descriptor=next.furnishings.find(item=>installedWorkspaceBenchSeat(item));
 if(!descriptor)return;
 const prior=before.candidate.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;
 const stockPlacements=next.placements.filter(row=>row.furnishingId===descriptor.id&&row.furnishingVersion===descriptor.version);
 if(stockPlacements.some(row=>!prior?.placements.some(item=>item.id===row.id&&item.furnishingId===row.furnishingId&&
    item.furnishingVersion===row.furnishingVersion)))return descriptor;

 const placementIds=new Set(stockPlacements.map(row=>row.id.toLowerCase()));
 const priorLinks=new Map(benchesFor(before.candidate).flatMap(bench=>bench.workspaceVisual?
  [[bench.workspaceVisual.placementId.toLowerCase(),bench.id.toLowerCase()]]:[]));
 if(benchesFor(after.candidate).some(bench=>{
  const id=bench.workspaceVisual?.placementId.toLowerCase();
  return id&&placementIds.has(id)&&priorLinks.get(id)!==bench.id.toLowerCase();
 }))return descriptor;
}

/** Match a single new stock seat and its placement using the existing proposer.
 * The caller must still check active catalogue membership and live workspace authority. */
export function ordinaryInstalledBackedSeatDelta(before:Draft,after:Draft):WorkspaceFurnishingDescriptor|undefined {
 try {
  if(after.editVersion!==before.editVersion+1||!validateWorkspaceFurnishings(before.candidate).valid)return;
  const beforeBenches=benchesFor(before.candidate),afterBenches=benchesFor(after.candidate);
  if(afterBenches.length!==beforeBenches.length+1)return;
  const bench=afterBenches[beforeBenches.length],placementId=bench?.workspaceVisual?.placementId;
  if(!bench||bench.kind!=='backed'||!placementId)return;
  const left=before.candidate.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;
  const right=after.candidate.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;
  const placement=right?.placements.find(row=>row.id===placementId);
  const descriptor=right?.furnishings.find(item=>item.id===placement?.furnishingId);
  if(!placement||!descriptor)return;
  const seat=installedWorkspaceBenchSeat(descriptor);
  if(!seat)return;

  const expected=structuredClone(before);
  const graph:WorkspaceFurnishings=structuredClone(left??{version:1,furnishings:[],placements:[]});
  if(!graph.placements.some(row=>row.id===placementId))graph.placements.push(placement);
  if(!graph.furnishings.some(item=>item.id===descriptor.id))graph.furnishings.push(descriptor);
  expected.candidate.extensions={...expected.candidate.extensions,
   [WORKSPACE_FURNISHING_NAMESPACE]:graph as unknown as NonNullable<Draft['candidate']['extensions']>[string]};
  const {candidate,additions}=proposeWorkspaceDefaultSeats(expected.candidate,[{placementId,benchId:bench.id,viewpointId:bench.viewpointId}],seat);
  if(additions.length!==1)return;
  expected.candidate=candidate;
  expected.editVersion=after.editVersion;
  expected.updatedAt=after.updatedAt;
  if(isDeepStrictEqual(expected,after))return descriptor;
 }catch{return;}
}
