// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {artifactCorners, artifactPoint, type AffinePoint} from './artifact-affine.js';
import {frameImageFootprintForArtwork} from './frame-image-fit.js';
import type {TrackSpotAimBinding} from './track-spot-aim-binding.js';
import type {TrackSpotAimingSuccess} from './track-spot-aiming-resolver.js';

export interface UpperFramingProfile {
 version:1;
 kind:'upper-framing';
 /** Radians in the solved head frame, with +Y up and -Z forward. */
 cutoffAngle:number;
 softnessAngle:number;
}

export function isUpperFramingProfile(value:unknown):value is UpperFramingProfile {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const profile=value as Record<string,unknown>;
 if(Object.keys(profile).length!==4||!['version','kind','cutoffAngle','softnessAngle'].every(k=>Object.hasOwn(profile,k)))return false;
 const {cutoffAngle,softnessAngle}=profile;
 if(profile.version!==1||profile.kind!=='upper-framing'||typeof cutoffAngle!=='number'||typeof softnessAngle!=='number'
  ||!Number.isFinite(cutoffAngle)||!Number.isFinite(softnessAngle)||cutoffAngle<=-Math.PI/2||cutoffAngle>=Math.PI/2
  ||softnessAngle<=0||cutoffAngle+softnessAngle>Math.PI/2)return false;
 const inverse=Math.fround(1/Math.sin(softnessAngle));
 return Number.isFinite(inverse)&&inverse>0;
}

const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const cornerHeadroom=1e-6;

/** Match the resolved head's optical frame and conservatively protect the
 * complete image plane. A canonical frame footprint is used when available;
 * any ordinary contained image tier otherwise fits the authored rectangle. */
export function upperFramingProtectsImage(document:Exhibition,binding:TrackSpotAimBinding,solved:TrackSpotAimingSuccess,profile:UpperFramingProfile):boolean {
 if(binding.aim.kind!=='placement-center')return false;
 const target=binding.aim.placementId;
 const placements=document.placements.filter(p=>same(p.id,target));
 const placement=placements[0];
 const rooms=document.rooms.filter(r=>same(r.id,solved.roomId));
 const scale=rooms[0]?.transform.scale;
 if(placements.length!==1||!placement||!same(placement.roomId,solved.roomId)||rooms.length!==1
  ||!scale||scale[0]<=0||!scale.every(n=>Number.isFinite(n)&&n===scale[0]))return false;
 const artworks=document.artworks.filter(a=>same(a.revisionId,placement.artworkRevisionId));
 const artwork=artworks[0];
 if(artworks.length!==1||artwork?.artworkType!=='image')return false;
 try{
  const frame=frameImageFootprintForArtwork(document,artwork);
  const plane={width:frame?.width??artwork.dimensions.width,height:frame?.height??artwork.dimensions.height};
  const [x,y,z,w]=solved.headPose.rotation;
  const corners=artifactCorners(plane,[artwork.transform,placement.transform]).slice(0,4);
  return corners.every(corner=>{
   const ray:AffinePoint=[corner[0]-solved.emitter[0],corner[1]-solved.emitter[1],corner[2]-solved.emitter[2]];
   const local=artifactPoint(ray,{position:[0,0,0],rotation:[-x,-y,-z,w],scale:[1,1,1]});
   return local[2]<0&&Math.atan2(local[1],-local[2])<=profile.cutoffAngle-cornerHeadroom;
  });
 }catch{return false;}
}
