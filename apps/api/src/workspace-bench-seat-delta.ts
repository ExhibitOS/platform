// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import {applyBenchCommand,benchesFor,presentationFor} from '@exhibitos/studio-contract';
import type {Draft} from './studio.ts';

/** Reconstruct one authored seat edit through the same command used by Studio. */
export function ordinaryWorkspaceBenchSeatDelta(before:Draft,after:Draft):boolean {
 try {
  const existing=benchesFor(before.candidate);
  const changed=benchesFor(after.candidate).filter(bench=>!isDeepStrictEqual(existing.find(item=>item.id===bench.id),bench));
  if(changed.length!==1||!changed[0]?.workspaceVisual)return false;
  const bench=changed[0],prior=existing.find(item=>item.id===bench.id);
  if(prior&&!prior.workspaceVisual){
   // The first visual for a backed bench keeps its existing seat and camera.
   const {workspaceVisual,...host}=bench;
   if(!workspaceVisual||prior.kind!=='backed'||!isDeepStrictEqual(prior,host))return false;
  }
  const hadViewpoint=presentationFor(before.candidate).viewpoints.some(view=>view.id===bench.viewpointId);
  const viewpoint=hadViewpoint?undefined:presentationFor(after.candidate).viewpoints.find(view=>view.id===bench.viewpointId);
  const candidate=applyBenchCommand(before.candidate,{type:prior?'set-bench':'add-bench',bench,...(viewpoint?{viewpoint}:{})});
  return isDeepStrictEqual({...before,editVersion:after.editVersion,updatedAt:after.updatedAt,candidate},after);
 }catch{return false;}
}
