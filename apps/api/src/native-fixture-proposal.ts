// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {Exhibition} from '@exhibitos/spec';
import {applyFurnishingCommand,furnishingsFor,lightAttachmentsFor,setLightAttachment,validateFurnishings,validateLightAttachments,type FurnishingPose,type LightAttachment} from '@exhibitos/studio-contract';

export type NativeFixtureCommand=
 |{type:'set-furnishing-visual';hostKind:'light';hostId:string;catalogId:'museum-track-spot';catalogVersion:1;pose:FurnishingPose}
 |{type:'set-light-attachment';lightId:string;attachment:Omit<LightAttachment,'lightId'>};
export interface NativeFixtureScope {workspaceId:string;tenantId:string;principalId:string;exhibitionId:string;head:string;requestId:string;epoch:string;sequence:number}
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const valid=(candidate:Exhibition)=>validateFurnishings(candidate).valid&&validateLightAttachments(candidate).valid;
function fail():never{throw Error('FIXTURE_PROPOSAL_INVALID');}
/** Pure saved-head proposal. The route owns authentication/CAS and Studio checks
 * the full lifecycle. No ID is accepted from the external fixture request. */
export function nativeFixtureProposal(candidate:Exhibition,command:NativeFixtureCommand,scope:NativeFixtureScope):{candidate:Exhibition;lightId?:string}{
 if(!valid(candidate))fail();
 if(command.type==='set-light-attachment'){
  const light=candidate.lights.find(v=>same(v.id,command.lightId)),surface=candidate.surfaces.find(v=>same(v.id,command.attachment.surfaceId));
  if(!light||!surface||surface.type!=='ceiling'||!same(light.roomId,surface.roomId))fail();
  const attachment={...command.attachment,surfaceId:surface.id},binding={lightId:light.id,...attachment};
  if(isDeepStrictEqual(lightAttachmentsFor(candidate).find(v=>same(v.lightId,light.id)),binding))return {lightId:light.id,candidate:structuredClone(candidate)};
  const next=setLightAttachment(candidate,light.id,attachment,candidate);
  if(!valid(next))fail();
  return {lightId:light.id,candidate:next};
 }
 if(command.type!=='set-furnishing-visual'||command.hostKind!=='light'||command.catalogId!=='museum-track-spot'||command.catalogVersion!==1)fail();
 const light=candidate.lights.find(v=>same(v.id,command.hostId));if(!light||light.type!=='spot')fail();
 const current=furnishingsFor(candidate),asset=current?.assets.find(v=>v.catalogId===command.catalogId),binding=current?.bindings.find(v=>v.hostKind==='light'&&same(v.hostId,light.id));
 if(asset&&binding&&binding.assetId===asset.id&&isDeepStrictEqual(binding.pose,command.pose))return {candidate:structuredClone(candidate)};
 // Namespace by the authenticated saved head and complete request binding. The
 // existing catalogue ID is always reused; no collision fallback is allowed.
 const digest=createHash('sha256').update(JSON.stringify(['native-fixture-asset-v1',scope.workspaceId,scope.tenantId,scope.principalId,scope.exhibitionId,scope.head,scope.epoch,scope.sequence,scope.requestId,command.catalogId])).digest('hex');
 const id=`${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-8${digest.slice(17,20)}-${digest.slice(20,32)}`;
 const next=applyFurnishingCommand(candidate,{type:command.type,hostKind:'light',hostId:light.id,catalogId:'museum-track-spot',catalogVersion:1,pose:command.pose},{newAssetId:id});
 if(!valid(next))fail();
 return {candidate:next};
}
