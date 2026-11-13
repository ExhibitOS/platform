// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {artifactPoint,type AffinePoint,type ArtifactPose} from './artifact-affine.js';
import type {FurnishingAsset,FurnishingBinding} from './furnishings.js';
import type {UserAssetCatalogueEntry} from './user-asset-catalogue.js';
import {lightDetailsFor,lightDetailsOrientation,validateStudioLightDetails} from './light-details.js';
import {lightAttachmentsFor,validateLightAttachments} from './room-envelope.js';
import {museumTrackSpotProfile} from './track-spot-profile.js';
import {validateWorkspaceFurnishings,WORKSPACE_FURNISHING_NAMESPACE,type WorkspaceFurnishings} from './workspace-furnishing.js';
import {type WasherPose} from './wallwasher-mount-head.js';
import {museumWallwasherRearReliefProfile} from './wallwasher-rear-relief-profile.js';
import {resolveWallwasherFromEmitter} from './wallwasher-from-emitter.js';

const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const identity=():ArtifactPose=>({position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]});
/** Source-bound static mode is selected by an actual same-ceiling rail context.
 * Existing unmounted catalogue visuals keep their ordinary rigid-body path. */
export function trackSpotStaticRailContext(document:Exhibition,lightId:string){
 const extension=document.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;
 if(extension?.version!==11)return false;
 const light=document.lights.find(item=>same(item.id,lightId)),attachment=lightAttachmentsFor(document).find(item=>same(item.lightId,lightId));
 return !!light&&!!attachment&&(extension.ceilingAttachments??[]).some(row=>same(row.surfaceId,attachment.surfaceId)&&extension.placements.some(placement=>same(placement.id,row.placementId)&&same(placement.roomId,light.roomId)&&extension.furnishings.some(item=>same(item.id,placement.furnishingId)&&item.kind==='ceiling-rail')));
}
/** Called during complete furnishing admission, after exact catalogue asset
 * admission. The saved attachment still describes the EMITTER, not the mount.
 * The optional result is consumed only by the matched named-part renderer. */
export function resolveCoupledWallwasher(document:Exhibition,binding:FurnishingBinding,asset:FurnishingAsset,source:UserAssetCatalogueEntry){
 const spot=asset.catalogId==='museum-track-spot',profile=spot?museumTrackSpotProfile(asset):museumWallwasherRearReliefProfile(asset),visual=binding.pose;
 if(binding.hostKind!=='light'||visual.scale!==1||visual.yaw!==0||!Array.isArray(visual.position)||visual.position.length!==3||visual.position.some((n,i)=>!Number.isFinite(n)||Math.abs(n+profile.opticalA[i]!)>1e-9))throw Error('WASHER_VISUAL_POSE_INVALID');
 if(!validateLightAttachments(document).valid||!validateStudioLightDetails(document).valid)throw Error('WASHER_STORED_LIGHT_INVALID');
 const light=document.lights.find(v=>same(v.id,binding.hostId)),attachment=lightAttachmentsFor(document).find(v=>same(v.lightId,binding.hostId));
 const surface=attachment&&document.surfaces.find(v=>same(v.id,attachment.surfaceId));
 if(!light||light.type!=='spot'||!surface||surface.type!=='ceiling'||!same(surface.roomId,light.roomId))throw Error('WASHER_CEILING_ATTACHMENT_REQUIRED');
 const room=document.rooms.find(v=>same(v.id,light.roomId));if(!room)throw Error('FURNISHING_REFERENCE');
 const details=lightDetailsFor(document).find(v=>same(v.lightId,light.id))??{lightId:light.id,fixture:'none' as const};
 const opticalPose={...light.transform,rotation:lightDetailsOrientation(document,light,details)};
 let wallwasher;
 if(spot){
  const extension=document.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;
  if(extension?.version!==11||!validateWorkspaceFurnishings(document).valid)throw Error('TRACK_SPOT_RAIL_REQUIRED');
  const matches=[];
  for(const placement of extension.placements){
   const railAttachment=extension.ceilingAttachments?.find(row=>same(row.placementId,placement.id));
   if(!railAttachment||!same(railAttachment.surfaceId,surface.id))continue;
   const descriptor=extension.furnishings.find(item=>same(item.id,placement.furnishingId)),g=descriptor?.fit?.geometry;
   if(descriptor?.kind!=='ceiling-rail'||g?.profile!=='passive-ceiling-rail-v1'||!same(placement.roomId,light.roomId))continue;
   const contactPlane={pose:{...surface.transform,position:[surface.transform.position[0],placement.position[1]+g.min[1],surface.transform.position[2]] as [number,number,number]},dimensions:surface.dimensions};
   let resolved;try{resolved=resolveWallwasherFromEmitter({profile,opticalPose,ceilingSurface:contactPlane});}catch{continue;}
   const mount=resolved.fixedPose,c=Math.cos(placement.yaw),s=Math.sin(placement.yaw),dx=mount.position[0]-placement.position[0],dz=mount.position[2]-placement.position[2],x=c*dx-s*dz,z=s*dx+c*dz;
   // A unique geometric contact, not a serialized linkage or electrical claim.
   const railPose:WasherPose={position:placement.position,rotation:[0,Math.sin(placement.yaw/2),0,Math.cos(placement.yaw/2)],scale:[1,1,1]};
   const alignment=Math.abs(mount.rotation.reduce((sum,n,i)=>sum+n*railPose.rotation[i]!,0));
   if(Math.abs(mount.position[1]-(placement.position[1]+g.min[1]))>1e-6||Math.abs(z)>1e-6||x-.0475<g.min[0]-1e-6||x+.0475>g.max[0]+1e-6||alignment<1-1e-7)continue;
   matches.push(resolved);
  }
  if(matches.length!==1)throw Error('TRACK_SPOT_RAIL_CONTACT_UNAVAILABLE');wallwasher=matches[0]!;
 }else wallwasher=resolveWallwasherFromEmitter({profile,opticalPose,ceilingSurface:{pose:surface.transform,dimensions:surface.dimensions}});
 // The source union under an optical whole-body transform is not a mounted
 // bound. Check every transformed part AABB in room and finite world space.
 for(const part of wallwasher.parts)for(let i=0;i<8;i++){
  const point:AffinePoint=[part.bounds[i&1?'max':'min'][0],part.bounds[i&2?'max':'min'][1],part.bounds[i&4?'max':'min'][2]];
  artifactPoint(point,room.transform);
  if(point[1]<-1e-6||point[1]>room.dimensions.height+1e-6||Math.abs(point[0])>room.dimensions.width/2+1e-6||Math.abs(point[2])>room.dimensions.depth/2+1e-6)throw Error('FURNISHING_BOUNDS');
 }
 return {source,roomId:light.roomId,parent:identity(),pose:identity(),mountProfile:profile.profileId,wallwasher};
}
