// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {expect,it} from 'vitest';
import {WORKSPACE_FURNISHING_NAMESPACE} from './workspace-furnishing.js';
import {trackSpotAimContext,remapTrackSpotAimBinding,validateTrackSpotAimBinding,type TrackSpotAimBinding} from './track-spot-aim-binding.js';
const id=(n:number)=>`00000000-0000-4000-8000-${n.toString().padStart(12,'0')}`;
const pose=()=>({position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]});
function fixture(){
 const document={rooms:[{id:id(1),dimensions:{width:20,height:6,depth:20},transform:pose()}],surfaces:[{id:id(2),roomId:id(1),type:'ceiling'}],
  lights:[{id:id(3),roomId:id(1),type:'spot',targetPlacementId:id(99)}],
  artworks:[{revisionId:id(4),dimensions:{width:2,height:2,depth:.2},transform:{...pose(),position:[.2,.4,.1]}}],
  placements:[{id:id(5),roomId:id(1),artworkRevisionId:id(4),transform:{position:[1,1,-2],rotation:[0,Math.SQRT1_2,0,Math.SQRT1_2],scale:[2,1,1]}}],
  extensions:{[WORKSPACE_FURNISHING_NAMESPACE]:{version:11,furnishings:[{id:id(6),version:1,kind:'ceiling-rail',fit:{geometry:{profile:'passive-ceiling-rail-v1'}}}],placements:[{id:id(7),roomId:id(1),furnishingId:id(6),furnishingVersion:1,position:[0,5,0],yaw:Math.PI/2,scale:1}],ceilingAttachments:[{placementId:id(7),surfaceId:id(2)}]}}} as unknown as Exhibition;
 const binding:TrackSpotAimBinding={version:1,profile:'track-spot-aim-v1',mount:{railPlacementId:id(7),position:[2,-.035,.25],yaw:.2},aim:{kind:'placement-center',placementId:id(5),offset:[.3,.2,.4]}};
 return {document,binding};
}
it('resolves explicit target offsets through artwork and placement transforms, and follows target/rail motion without changing input',()=>{
 const {document,binding}=fixture(),before=structuredClone(document),result=trackSpotAimContext(document,id(3),binding);
 [1.5,1.6,-3].forEach((n,i)=>expect(result.target![i]).toBeCloseTo(n,12));
 [.25,4.965,-2].forEach((n,i)=>expect(result.mountPose.position[i]).toBeCloseTo(n,12));
 expect(result.surfaceId).toBe(id(2));expect(document).toEqual(before);
 document.placements[0]!.transform.position[0]+=1;
 expect(trackSpotAimContext(document,id(3),binding).target![0]).toBeCloseTo(2.5,12);
 const workspace=document.extensions![WORKSPACE_FURNISHING_NAMESPACE] as unknown as {placements:{position:number[]}[]};workspace.placements[0]!.position[0]=1;
 expect(trackSpotAimContext(document,id(3),binding).mountPose.position[0]).toBeCloseTo(1.25,12);
});
it('never substitutes a shadow-priority target or a room point for a missing/cross-room placement or rail',()=>{
 const {document,binding}=fixture();if(binding.aim.kind!=='placement-center')throw Error('fixture');
 binding.aim.placementId=id(99);expect(()=>trackSpotAimContext(document,id(3),binding)).toThrow('TRACK_SPOT_AIM_TARGET_REQUIRED');
 binding.aim.placementId=id(5);document.placements[0]!.roomId=id(9);expect(()=>trackSpotAimContext(document,id(3),binding)).toThrow('TRACK_SPOT_AIM_TARGET_REQUIRED');
 binding.mount.railPlacementId=id(99);expect(()=>trackSpotAimContext(document,id(3),binding)).toThrow('TRACK_SPOT_AIM_RAIL_REQUIRED');
});
it('keeps manual and room-point intent distinct, rejects outside-room points, and remaps every persistent reference explicitly',()=>{
 const {document,binding}=fixture(),before=structuredClone(binding),mapped=remapTrackSpotAimBinding(binding,new Map([[id(5),id(15)],[id(7),id(17)]]));
 expect(mapped.mount.railPlacementId).toBe(id(17));expect(mapped.aim).toMatchObject({placementId:id(15),offset:[.3,.2,.4]});expect(binding).toEqual(before);
 expect(()=>remapTrackSpotAimBinding(binding,new Map([[id(7),id(17)]]))).toThrow('TRACK_SPOT_AIM_REFERENCE');
 binding.aim={kind:'manual',yaw:.4,pitch:-.7};expect(trackSpotAimContext(document,id(3),binding).target).toBeUndefined();
 binding.aim={kind:'point',position:[0,1,0]};expect(trackSpotAimContext(document,id(3),binding).target).toEqual([0,1,0]);
 binding.aim={kind:'point',position:[0,-1,0]};expect(()=>trackSpotAimContext(document,id(3),binding)).toThrow('TRACK_SPOT_AIM_TARGET_OUTSIDE_ROOM');
});
it('admits only the closed versioned intent schema; this alone does not qualify source geometry or joint limits',()=>{
 const {binding}=fixture();expect(validateTrackSpotAimBinding(binding)).toBe(true);
 for(const value of [{...binding,version:2},{...binding,profile:'museum-track-spot-fixed-head-v1'},{...binding,extra:true},{...binding,mount:{...binding.mount,position:[NaN,0,0]}},{...binding,aim:{kind:'placement-center',placementId:id(5)}}])expect(validateTrackSpotAimBinding(value)).toBe(false);
});

it('rejects a scaled rail instead of silently solving a different mount',()=>{
 const {document,binding}=fixture(),workspace=document.extensions![WORKSPACE_FURNISHING_NAMESPACE] as unknown as {placements:{scale:number}[]};
 workspace.placements[0]!.scale=2;expect(()=>trackSpotAimContext(document,id(3),binding)).toThrow('TRACK_SPOT_AIM_RAIL_REQUIRED');
});
