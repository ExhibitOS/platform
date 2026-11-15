// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {artifactPoint,type AffinePoint,type ArtifactPose} from './artifact-affine.js';
import {WORKSPACE_FURNISHING_NAMESPACE,validateWorkspaceFurnishings,type WorkspaceFurnishings} from './workspace-furnishing.js';
import {trackSpotAimContext,validateTrackSpotAimBinding,type TrackSpotAimBinding} from './track-spot-aim-binding.js';
import {articulatedTrackSpotProfile} from './track-spot-articulated-profile.js';
import {solveTrackSpotAiming,type TrackSpotAimFailureReason,type TrackSpotAimSuccess} from './track-spot-aiming.js';
import {rectangularRailContact} from './rectangular-rail-contact.js';
import {groupedRailContact} from './grouped-rail-contact.js';
import {whiteRailOppositeHeading} from './white-rail-opposite-heading.js';

type PartFrame='fixed'|'yoke'|'head';
export type TrackSpotAimingFailureReason=TrackSpotAimFailureReason|'INVALID_BINDING'|'INVALID_SOURCE'|'INVALID_RAIL'|'INVALID_TARGET'|'RAIL_CONTACT'|'OUTSIDE_ROOM';
export type TrackSpotAimingFailure={reachable:false;reason:TrackSpotAimingFailureReason;remedy:string;requestedTarget:AffinePoint|null};
export type TrackSpotAimingSuccess=TrackSpotAimSuccess&{
 profile:'museum-track-spot-articulated-v1';roomId:string;railPlacementId:string;surfaceId:string;
 parts:{name:string;frame:PartFrame;pose:ArtifactPose;bounds:{min:AffinePoint;max:AffinePoint}}[];
};
export type TrackSpotAimingResult=TrackSpotAimingFailure|TrackSpotAimingSuccess;
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const namespace='org.exhibitos.studio/light-details';
const visuals='org.exhibitos.studio/furnishing-visuals';
function intentFor(document:Exhibition,lightId:string):unknown {
 const value:unknown=document.extensions?.[namespace];if(!object(value)||value.version!==1||!Array.isArray(value.lights))return undefined;
 const rows=value.lights.filter(object).filter(v=>typeof v.lightId==='string'&&same(v.lightId,lightId));return rows.length===1?rows[0]!.trackAim:undefined;
}
const rigid=(pose:TrackSpotAimSuccess['fixedPose']):ArtifactPose=>({position:[...pose.position],rotation:[...pose.rotation],scale:[1,1,1]});

/** One known-source optical/part solution. It never derives the adapter from
 * the stored emitter, changes a target, rewrites a document, or grants a joint
 * to an ordinary fixed asset. Full candidate/rights admission stays with the
 * existing owner; source contact and complete transformed bounds are checked
 * here on every evaluation, including after target or rail movement. */
export function resolveTrackSpotAiming(document:Exhibition,lightId:string,explicit?:TrackSpotAimBinding):TrackSpotAimingResult {
 const value=explicit??intentFor(document,lightId);
 let requestedTarget:AffinePoint|null=null;
 const fail=(reason:TrackSpotAimingFailureReason,remedy:string):TrackSpotAimingFailure=>({reachable:false,reason,remedy,requestedTarget});
 if(!validateTrackSpotAimBinding(value))return fail('INVALID_BINDING','Choose the known articulated fixture and an explicit rail mount and aiming intent.');
 const binding=value;
 try{
  const ext:unknown=document.extensions?.[visuals];if(!object(ext)||ext.version!==1||!Array.isArray(ext.bindings)||!Array.isArray(ext.assets))return fail('INVALID_SOURCE','Select the exact supported articulated catalogue source.');
  const matches=ext.bindings.filter(object).filter(v=>v.hostKind==='light'&&typeof v.hostId==='string'&&same(v.hostId,lightId)),visual=matches[0];
  if(matches.length!==1||!visual)return fail('INVALID_SOURCE','Select one exact articulated visual for this light.');
  const assets=ext.assets.filter(object).filter(a=>typeof a.id==='string'&&typeof visual.assetId==='string'&&same(a.id,visual.assetId));
  if(assets.length!==1)return fail('INVALID_SOURCE','Restore the exact supported articulated source identity.');
  const profile=articulatedTrackSpotProfile(assets[0]);
  const p=visual.pose;
  if(!object(p)||p.scale!==1||p.yaw!==0||!Array.isArray(p.position)||p.position.length!==3||p.position.some((n,i)=>typeof n!=='number'||!Number.isFinite(n)||Math.abs(n+profile.geometry.opticalA[i]!)>1e-9))return fail('INVALID_BINDING','Use the source optical datum; edit the explicit mount instead of the visual offset.');
  if(!validateWorkspaceFurnishings(document).valid)return fail('INVALID_RAIL','Restore the admitted rail descriptor and its ceiling attachment.');
  const context=trackSpotAimContext(document,lightId,binding);requestedTarget=context.target?[...context.target]:null;
  const result=solveTrackSpotAiming({mountPose:context.mountPose,geometry:profile.geometry,envelope:profile.envelope,intent:binding.aim.kind==='manual'?binding.aim:{kind:'target',point:context.target!}});
  if(!result.reachable)return {...result,requestedTarget:result.requestedTarget?[...result.requestedTarget]:null};
  const workspace=document.extensions![WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings;
  const rail=workspace.placements.find(v=>same(v.id,binding.mount.railPlacementId))!,descriptor=workspace.furnishings.find(v=>same(v.id,rail.furnishingId))!,g=descriptor.fit!.geometry;
  if(g.profile!=='passive-ceiling-rail-v1')return fail('INVALID_RAIL','Choose an admitted passive ceiling rail.');
  const c=Math.cos(rail.yaw),s=Math.sin(rail.yaw),fixedPose=rigid(result.fixedPose);
  const corners=profile.mountFootprint.map(point=>{const room=artifactPoint([...point],fixedPose),dx=room[0]-rail.position[0],dz=room[2]-rail.position[2];return [c*dx-s*dz,room[1]-rail.position[1],s*dx+c*dz] as AffinePoint;});
  const certified=rectangularRailContact(descriptor,corners)??groupedRailContact(descriptor,corners);
  if(certified===false)return fail('RAIL_CONTACT','Move the adapter onto a verified contact region of the selected rail.');
  if(certified===undefined){
   const [x,y,z]=corners.reduce((sum,p)=>sum.map((n,i)=>n+p[i]!/4) as AffinePoint,[0,0,0] as AffinePoint),railRotation:[number,number,number,number]=[0,Math.sin(rail.yaw/2),0,Math.cos(rail.yaw/2)];
   const alignment=Math.abs(result.fixedPose.rotation.reduce((sum,n,i)=>sum+n*railRotation[i]!,0));
   if(Math.abs(y-g.min[1])>1e-6||Math.abs(z)>1e-6||x-.0475<g.min[0]-1e-6||x+.0475>g.max[0]+1e-6||alignment<1-1e-7&&!whiteRailOppositeHeading(descriptor,result.fixedPose.rotation,railRotation))return fail('RAIL_CONTACT','Align the adapter to the selected rail and keep its complete footprint in contact.');
  }
  const light=document.lights.find(v=>same(v.id,lightId))!,room=document.rooms.find(v=>same(v.id,light.roomId))!;
  const poses={fixed:fixedPose,yoke:rigid(result.yokePose),head:rigid(result.headPose)};
  const parts:TrackSpotAimingSuccess['parts']=[];
  for(const part of profile.parts){
   const pose=poses[part.frame],points:AffinePoint[]=[];
   for(let i=0;i<8;i++){
    const point=artifactPoint([part.bounds[i&1?'max':'min'][0],part.bounds[i&2?'max':'min'][1],part.bounds[i&4?'max':'min'][2]],pose);
    artifactPoint(point,room.transform);
    if(point[1]<-1e-6||point[1]>room.dimensions.height+1e-6||Math.abs(point[0])>room.dimensions.width/2+1e-6||Math.abs(point[2])>room.dimensions.depth/2+1e-6)return fail('OUTSIDE_ROOM','Move the mount or target so every articulated part stays inside the room.');
    points.push(point);
   }
   parts.push({name:part.name,frame:part.frame,pose,bounds:{min:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]!))) as AffinePoint,max:[0,1,2].map(i=>Math.max(...points.map(p=>p[i]!))) as AffinePoint}});
  }
  return {...result,profile:profile.profileId,roomId:light.roomId,railPlacementId:rail.id,surfaceId:context.surfaceId,parts};
 }catch(error){
  const code=error instanceof Error?error.message:'';
  if(code==='TRACK_SPOT_AIM_SOURCE_MISMATCH')return fail('INVALID_SOURCE','Restore the exact supported articulated catalogue identity.');
  if(code.startsWith('TRACK_SPOT_AIM_TARGET'))return fail('INVALID_TARGET','Choose an existing artwork placement or point in the same room.');
  if(code==='TRACK_SPOT_AIM_RAIL_REQUIRED')return fail('INVALID_RAIL','Choose an admitted unit-scale ceiling rail in the light room.');
  return fail('INVALID_BINDING','Restore the explicit mount and target references and finite rigid transforms.');
 }
}

/** Concrete base OES optics for output consumers. Authoring intent and UUID
 * links stay intact; callers remap those links using the existing output map.
 * No trackAim means the original document is returned byte/identity unchanged. */
export function materializeTrackSpotAiming(document:Exhibition):Exhibition {
 const active=document.lights.filter(light=>intentFor(document,light.id)!==undefined);
 if(!active.length)return document;
 const next=structuredClone(document);
 for(const light of active){
  const result=resolveTrackSpotAiming(document,light.id);
  if(!result.reachable)throw Error('TRACK_SPOT_AIM_'+result.reason);
  next.lights.find(v=>same(v.id,light.id))!.transform={position:[...result.emitter],rotation:[...result.headPose.rotation],scale:[1,1,1]};
 }
 return next;
}
