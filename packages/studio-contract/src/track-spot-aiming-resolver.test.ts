// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {paintingWasherCandidate,lightId,assetId} from '../test-fixtures/wallwasher.js';
import {WORKSPACE_FURNISHING_NAMESPACE,ceilingRailAttachmentMatrix,ceilingRailDerivedPose,type WorkspaceFurnishingDescriptor} from './workspace-furnishing.js';
import {ARTICULATED_TRACK_SPOT_IDENTITY} from './track-spot-articulated-profile.js';
import type {TrackSpotAimBinding} from './track-spot-aim-binding.js';
import {resolveTrackSpotAiming,materializeTrackSpotAiming} from './track-spot-aiming-resolver.js';
import type {Exhibition} from '@exhibitos/spec';
const railId='b0000000-0000-4000-8000-000000000001',pid='b0000000-0000-4000-8000-000000000002';
function fixture(){
 const document=paintingWasherCandidate().moved,room=document.rooms[0]!,surface=document.surfaces[0]!;room.dimensions.width=12;room.dimensions.depth=12;surface.dimensions={width:12,height:12};
 const sha='aca126489bf21adcc637e9a3c3bb805bb57f93111c3333a8fdefab9d371d1c42',descriptor:WorkspaceFurnishingDescriptor={id:railId,version:1,kind:'ceiling-rail',name:'Rectangle',provenance:'Redistributable authored source',rights:{holder:'ExhibitOS',ownership:'owner',licenseId:'CC0-1.0',creditLine:'ExhibitOS',permissions:{display:true,download:true,export:true,commercial:true}},model:{mime:'model/gltf-binary',sha256:sha,bytes:268820},fit:{version:1,sourceSha256:sha,sourceBytes:268820,geometry:{profile:'passive-ceiling-rail-v1',min:[-2.809499979019165,-.03500000014901161,-3.809499979019165],max:[2.809499979019165,0,3.809499979019165]}}};
 const attachment={placementId:pid,surfaceId:surface.id,anchor:[0,0] as [number,number],yaw:0,gap:0};
 document.extensions![WORKSPACE_FURNISHING_NAMESPACE]={version:11,furnishings:[descriptor],placements:[{id:pid,roomId:room.id,furnishingId:railId,furnishingVersion:1,...ceilingRailDerivedPose(ceilingRailAttachmentMatrix(surface,attachment).matrix)}],frameAttachments:[],openingAttachments:[],ceilingAttachments:[attachment]};
 const binding:TrackSpotAimBinding={version:1,profile:'track-spot-aim-v1',mount:{railPlacementId:pid,position:[-2.2,-.035,-3.79],yaw:0},aim:{kind:'point',position:[-2.2,1.5,-4.8]}};
 document.extensions!['org.exhibitos.studio/light-details']={version:1,lights:[{lightId,fixture:'none',trackAim:binding}]};delete document.extensions!['org.exhibitos.studio/light-attachments'];
 document.extensions!['org.exhibitos.studio/furnishing-visuals']={version:1,assets:[{...ARTICULATED_TRACK_SPOT_IDENTITY,id:assetId}],bindings:[{hostKind:'light',hostId:lightId,assetId,pose:{position:[0,.15,.0755],yaw:0,scale:1}}]};
 return {document,binding};
}
it('returns one room-local fixed/yoke/head solution with unchanged adapter and materializes output optics on a clone',()=>{
 const {document,binding}=fixture(),before=structuredClone(document),result=resolveTrackSpotAiming(document,lightId);
 expect(result.reachable,result.reachable?'':result.reason).toBe(true);if(!result.reachable)throw Error(result.reason);
 expect(result.parts).toHaveLength(14);expect(result.parts.filter(p=>p.frame==='fixed')).toHaveLength(3);expect(result.residual).toBeLessThan(1e-7);
 [-2.2,3.965,-3.79].forEach((n,i)=>expect(result.fixedPose.position[i]).toBeCloseTo(n,10));
 const output=materializeTrackSpotAiming(document);expect(output).not.toBe(document);expect(output.lights[0]!.transform.position).toEqual(result.emitter);expect(document).toEqual(before);
 if(binding.aim.kind!=='point')throw Error('fixture');binding.aim.position[0]+=.2;
 const moved=resolveTrackSpotAiming(document,lightId);expect(moved.reachable).toBe(true);if(!moved.reachable)throw Error(moved.reason);expect(moved.fixedPose).toEqual(result.fixedPose);expect(moved.emitter).not.toEqual(result.emitter);
});
it('rejects unknown source, missing rail, off-contact adapter and unreachable target without fallback',()=>{
 const {document,binding}=fixture(),before=structuredClone(document);
 binding.mount.position[2]=0;const contact=resolveTrackSpotAiming(document,lightId);expect(contact).toMatchObject({reachable:false,reason:'RAIL_CONTACT'});expect(document.lights).toEqual(before.lights);
 binding.mount.position[2]=-3.79;binding.aim={kind:'point',position:[-2.2,4,-4.8]};expect(resolveTrackSpotAiming(document,lightId)).toMatchObject({reachable:false,reason:'OUTSIDE_ENVELOPE'});
 binding.mount.railPlacementId=assetId;expect(resolveTrackSpotAiming(document,lightId)).toMatchObject({reachable:false,reason:'INVALID_RAIL'});
 const old=fixture().document;const visuals=old.extensions!['org.exhibitos.studio/furnishing-visuals'] as unknown as {assets:{sha256:string}[]};visuals.assets[0]!.sha256='f'.repeat(64);expect(resolveTrackSpotAiming(old,lightId)).toMatchObject({reachable:false,reason:'INVALID_SOURCE'});
});
it('leaves ordinary fixed documents untouched and never emits a stale base pose for invalid active intent',()=>{
 const legacy=paintingWasherCandidate().moved;expect(materializeTrackSpotAiming(legacy)).toBe(legacy);
 const {document,binding}=fixture();binding.aim={kind:'point',position:[-2.2,4,-4.8]};const before=structuredClone(document);expect(()=>materializeTrackSpotAiming(document)).toThrow('TRACK_SPOT_AIM_OUTSIDE_ENVELOPE');expect(document).toEqual(before);
});

it('rejects a reachable beam when the head body would cross the room wall',()=>{
 const {document,binding}=fixture();document.rooms[0]!.dimensions.width=5.62;document.surfaces[0]!.dimensions.width=5.62;
 binding.mount.position=[2.79,-.035,2.5];binding.mount.yaw=Math.PI/2;binding.aim={kind:'point',position:[2.8,3.5,2.5]};
 expect(resolveTrackSpotAiming(document,lightId)).toMatchObject({reachable:false,reason:'OUTSIDE_ROOM'});
});
it('recomputes the explicit artwork target after motion and never substitutes the independent shadow target',()=>{
 const {document,binding}=fixture(),roomId=document.rooms[0]!.id,artId='c0000000-0000-4000-8000-000000000001',placementId='c0000000-0000-4000-8000-000000000002',shadowId='c0000000-0000-4000-8000-000000000003';
 const pose={position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]} as const;
 document.artworks=[{id:artId,revisionId:artId,dimensions:{width:1,height:1,depth:.01},transform:structuredClone(pose)} as unknown as Exhibition['artworks'][number]];
 document.placements=[{id:placementId,roomId,artworkRevisionId:artId,transform:{...structuredClone(pose),position:[-2.2,1.5,-4.8]}},{id:shadowId,roomId,artworkRevisionId:artId,transform:{...structuredClone(pose),position:[2,1,0]}}];
 document.lights[0]!.targetPlacementId=shadowId;binding.aim={kind:'placement-center',placementId,offset:[0,0,0]};
 const first=resolveTrackSpotAiming(document,lightId);expect(first.reachable).toBe(true);if(!first.reachable)throw Error(first.reason);expect(first.resolvedTarget).toEqual([-2.2,1.5,-4.8]);
 document.placements[0]!.transform.position[0]+=.2;const before=structuredClone(document),moved=resolveTrackSpotAiming(document,lightId);expect(moved.reachable).toBe(true);if(!moved.reachable)throw Error(moved.reason);expect(moved.fixedPose).toEqual(first.fixedPose);expect(moved.emitter).not.toEqual(first.emitter);expect(document).toEqual(before);
 document.placements.shift();expect(resolveTrackSpotAiming(document,lightId)).toMatchObject({reachable:false,reason:'INVALID_TARGET'});expect(document.lights[0]!.targetPlacementId).toBe(shadowId);
});
