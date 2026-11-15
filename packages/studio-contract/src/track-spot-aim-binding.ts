// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {artifactBounds,artifactCorners,artifactPoint,type AffinePoint,type ArtifactPose} from './artifact-affine.js';
import {WORKSPACE_FURNISHING_NAMESPACE,type WorkspaceFurnishings} from './workspace-furnishing.js';

/** Versioned intent only. Geometry eligibility is a separate source-bound
 * profile check; this record cannot grant travel to a legacy fixed fixture. */
export interface TrackSpotAimBinding {
 version:1;
 profile:'track-spot-aim-v1';
 /** Coordinates and yaw relative to the explicitly selected rail placement. */
 mount:{railPlacementId:string;position:AffinePoint;yaw:number};
 aim:
  |{kind:'placement-center';placementId:string;offset:AffinePoint}
  |{kind:'point';position:AffinePoint}
  |{kind:'manual';yaw:number;pitch:number};
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const closed=(v:unknown,keys:string[])=>object(v)&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const number=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const vector=(v:unknown):v is AffinePoint=>Array.isArray(v)&&v.length===3&&v.every(n=>number(n,-10000,10000));
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const fail=(code:string):never=>{throw Error(code);};

export function validateTrackSpotAimBinding(value:unknown):value is TrackSpotAimBinding {
 if(!closed(value,['version','profile','mount','aim']))return false;
 const v=value as Record<string,unknown>,m=v.mount,a=v.aim;
 if(v.version!==1||v.profile!=='track-spot-aim-v1'||!closed(m,['railPlacementId','position','yaw'])||!object(m)||!uuid(m.railPlacementId)||!vector(m.position)||!number(m.yaw,-Math.PI,Math.PI)||!object(a))return false;
 return a.kind==='placement-center'?closed(a,['kind','placementId','offset'])&&uuid(a.placementId)&&vector(a.offset)
  :a.kind==='point'?closed(a,['kind','position'])&&vector(a.position)
  :a.kind==='manual'&&closed(a,['kind','yaw','pitch'])&&number(a.yaw,-Math.PI,Math.PI)&&number(a.pitch,-Math.PI,Math.PI);
}

/** The target and mount are both ROOM-local. The owning room transform is
 * applied after solving, including for rotated rooms. No nearest target or
 * legacy light.targetPlacementId fallback is permitted. */
export function trackSpotAimContext(document:Exhibition,lightId:string,binding:TrackSpotAimBinding):{mountPose:ArtifactPose;target?:AffinePoint;surfaceId:string} {
 if(!validateTrackSpotAimBinding(binding))return fail('TRACK_SPOT_AIM_SCHEMA');
 const lights=document.lights.filter(l=>same(l.id,lightId)),light=lights[0];
 if(lights.length!==1||!light||light.type!=='spot')return fail('TRACK_SPOT_AIM_REFERENCE');
 const room=document.rooms.find(r=>same(r.id,light.roomId));if(!room)return fail('TRACK_SPOT_AIM_REFERENCE');
 const workspace=document.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;
 if(workspace?.version!==11)return fail('TRACK_SPOT_AIM_RAIL_REQUIRED');
 const rails=workspace.placements.filter(p=>same(p.id,binding.mount.railPlacementId)),rail=rails[0];
 const descriptor=rail&&workspace.furnishings.find(f=>same(f.id,rail.furnishingId)&&f.version===rail.furnishingVersion);
 const attachments=rail?workspace.ceilingAttachments?.filter(a=>same(a.placementId,rail.id))??[]:[];
 const surface=attachments[0]&&document.surfaces.find(s=>same(s.id,attachments[0]!.surfaceId));
 if(rails.length!==1||!rail||!same(rail.roomId,light.roomId)||descriptor?.kind!=='ceiling-rail'||descriptor.fit?.geometry.profile!=='passive-ceiling-rail-v1'||attachments.length!==1||!surface||surface.type!=='ceiling'||!same(surface.roomId,light.roomId))return fail('TRACK_SPOT_AIM_RAIL_REQUIRED');
 const railPose:ArtifactPose={position:[...rail.position],rotation:[0,Math.sin(rail.yaw/2),0,Math.cos(rail.yaw/2)],scale:[1,1,1]},yaw=rail.yaw+binding.mount.yaw;
 const mountPose:ArtifactPose={position:artifactPoint(binding.mount.position,railPose),rotation:[0,Math.sin(yaw/2),0,Math.cos(yaw/2)],scale:[1,1,1]};
 // Full adapter-footprint contact and swept-part bounds belong to the source
 // geometry resolver. A centre point on an AABB is never a contact grant.
 let target:AffinePoint|undefined;
 if(binding.aim.kind==='point')target=[...binding.aim.position];
 else if(binding.aim.kind==='placement-center'){
  const aim=binding.aim,placements=document.placements.filter(p=>same(p.id,aim.placementId)),placement=placements[0];
  if(placements.length!==1||!placement||!same(placement.roomId,light.roomId))return fail('TRACK_SPOT_AIM_TARGET_REQUIRED');
  const artworks=document.artworks.filter(a=>same(a.revisionId,placement.artworkRevisionId)),artwork=artworks[0];
  if(artworks.length!==1||!artwork)return fail('TRACK_SPOT_AIM_TARGET_REQUIRED');
  const center=artifactBounds(artifactCorners(artwork.dimensions,[artwork.transform])).center;
  target=artifactPoint(center.map((n,i)=>n+aim.offset[i]!) as AffinePoint,placement.transform);
 }
 if(target&&(!target.every(Number.isFinite)||Math.abs(target[0])>room.dimensions.width/2||target[1]<0||target[1]>room.dimensions.height||Math.abs(target[2])>room.dimensions.depth/2))return fail('TRACK_SPOT_AIM_TARGET_OUTSIDE_ROOM');
 return {mountPose,...(target?{target}:{}),surfaceId:surface.id};
}

/** Public UUID remapping must preserve the explicit rail and placement links.
 * Missing mappings fail; there is no fallback to the previous room point. */
export function remapTrackSpotAimBinding(binding:TrackSpotAimBinding,ids:ReadonlyMap<string,string>):TrackSpotAimBinding {
 if(!validateTrackSpotAimBinding(binding))return fail('TRACK_SPOT_AIM_SCHEMA');
 const map=(id:string)=>{const next=ids.get(id.toLowerCase());if(!uuid(next))return fail('TRACK_SPOT_AIM_REFERENCE');return next;};
 const next=structuredClone(binding);next.mount.railPlacementId=map(next.mount.railPlacementId);
 if(next.aim.kind==='placement-center')next.aim.placementId=map(next.aim.placementId);
 return next;
}
