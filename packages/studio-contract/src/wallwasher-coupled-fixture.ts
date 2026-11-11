// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {artifactPoint,type AffinePoint,type ArtifactPose} from './artifact-affine.js';
import type {FurnishingAsset,FurnishingBinding} from './furnishings.js';
import type {UserAssetCatalogueEntry} from './user-asset-catalogue.js';
import {lightDetailsFor,lightDetailsOrientation,validateStudioLightDetails} from './light-details.js';
import {lightAttachmentsFor,validateLightAttachments} from './room-envelope.js';
import {museumWallwasherRearReliefProfile} from './wallwasher-rear-relief-profile.js';
import {resolveWallwasherFromEmitter} from './wallwasher-from-emitter.js';

const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const identity=():ArtifactPose=>({position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]});
/** Called during complete furnishing admission, after exact catalogue asset
 * admission. The saved attachment still describes the EMITTER, not the mount.
 * The optional result is consumed only by the matched named-part renderer. */
export function resolveCoupledWallwasher(document:Exhibition,binding:FurnishingBinding,asset:FurnishingAsset,source:UserAssetCatalogueEntry){
 const profile=museumWallwasherRearReliefProfile(asset),visual=binding.pose;
 if(binding.hostKind!=='light'||visual.scale!==1||visual.yaw!==0||!Array.isArray(visual.position)||visual.position.length!==3||visual.position.some((n,i)=>!Number.isFinite(n)||Math.abs(n+profile.opticalA[i]!)>1e-9))throw Error('WASHER_VISUAL_POSE_INVALID');
 if(!validateLightAttachments(document).valid||!validateStudioLightDetails(document).valid)throw Error('WASHER_STORED_LIGHT_INVALID');
 const light=document.lights.find(v=>same(v.id,binding.hostId)),attachment=lightAttachmentsFor(document).find(v=>same(v.lightId,binding.hostId));
 const surface=attachment&&document.surfaces.find(v=>same(v.id,attachment.surfaceId));
 if(!light||light.type!=='spot'||!surface||surface.type!=='ceiling'||!same(surface.roomId,light.roomId))throw Error('WASHER_CEILING_ATTACHMENT_REQUIRED');
 const room=document.rooms.find(v=>same(v.id,light.roomId));if(!room)throw Error('FURNISHING_REFERENCE');
 const details=lightDetailsFor(document).find(v=>same(v.lightId,light.id))??{lightId:light.id,fixture:'none' as const};
 const wallwasher=resolveWallwasherFromEmitter({profile,opticalPose:{...light.transform,rotation:lightDetailsOrientation(document,light,details)},ceilingSurface:{pose:surface.transform,dimensions:surface.dimensions}});
 // The source union under an optical whole-body transform is not a mounted
 // bound. Check every transformed part AABB in room and finite world space.
 for(const part of wallwasher.parts)for(let i=0;i<8;i++){
  const point:AffinePoint=[part.bounds[i&1?'max':'min'][0],part.bounds[i&2?'max':'min'][1],part.bounds[i&4?'max':'min'][2]];
  artifactPoint(point,room.transform);
  if(point[1]<-1e-6||point[1]>room.dimensions.height+1e-6||Math.abs(point[0])>room.dimensions.width/2+1e-6||Math.abs(point[2])>room.dimensions.depth/2+1e-6)throw Error('FURNISHING_BOUNDS');
 }
 return {source,roomId:light.roomId,parent:identity(),pose:identity(),wallwasher};
}
