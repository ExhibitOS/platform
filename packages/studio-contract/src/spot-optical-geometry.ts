// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {artifactCorners, artifactPoint, type AffinePoint} from './artifact-affine.js';
import {floorFor} from './floors.js';
import {frameImageFootprintForArtwork} from './frame-image-fit.js';
import {lightDetailsTarget, type ExhibitionLight, type LightDetails} from './light-details.js';
import {resolveTrackSpotAiming} from './track-spot-aiming-resolver.js';
import {lodVariantsFor} from './viewer.js';

export type SpotOpticalMeasurement =
 | {kind:'png';assetId:string;sha256:string;widthPx:number;heightPx:number}
 | {kind:'centered-glb';assetId:string;sha256:string;size:AffinePoint};
export type SpotOpticalPose = {emitter:AffinePoint;axis:AffinePoint;range:number;penumbra:number};
export type SpotOpticalBounds = {kind:'display-plane'|'sculpture-containment-envelope';assetId:string;sha256:string;corners:readonly AffinePoint[];normal?:AffinePoint};
export type SpotOpticalFloor = {origin:AffinePoint;normal:AffinePoint;witnesses?:readonly AffinePoint[]};
export interface SpotOpticalFitEvidence {
 maxDistanceMeters:number;
 maxPolarAngleRadians:number;
 minImageIncidence:number|null;
 floorSpill:'range-excluded'|'positive-witness'|'unknown';
}
export type SpotOpticalFitResult =
 | {ok:true;fullBeamRadians:number;evidence:SpotOpticalFitEvidence}
 | {ok:false;reason:'behind-axis'|'out-of-range'|'angle-limit'|'unsupported-penumbra';evidence:SpotOpticalFitEvidence};

const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const invalid=():never=>{throw Error('SPOT_BEAM_FIT_BOUNDS_UNSUPPORTED');};
const add=(a:AffinePoint,b:AffinePoint):AffinePoint=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a:AffinePoint,b:AffinePoint):AffinePoint=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const dot=(a:AffinePoint,b:AffinePoint)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:AffinePoint,b:AffinePoint):AffinePoint=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function unit(v:AffinePoint):AffinePoint {
 const norm=Math.hypot(...v);
 if(!Number.isFinite(norm)||norm<=0)return invalid();
 return [v[0]/norm,v[1]/norm,v[2]/norm];
}
function unique<T>(rows:readonly T[],match:(row:T)=>boolean):T {
 const matches=rows.filter(match);
 return matches.length===1?matches[0]!:invalid();
}

export function resolveSpotOpticalPose(document:Exhibition,light:ExhibitionLight,details?:LightDetails):SpotOpticalPose {
 if(light.type!=='spot')return invalid();
 const room=unique(document.rooms,r=>same(r.id,light.roomId));
 let emitter=light.transform.position;
 let target:AffinePoint|undefined;
 if(details?.trackAim){
  const solved=resolveTrackSpotAiming(document,light.id,details.trackAim);
  if(!solved.reachable)return invalid();
  emitter=[...solved.emitter];
  target=solved.resolvedTarget?[...solved.resolvedTarget]:add(emitter,[...solved.direction]);
 }else{
  if(details?.aim)target=lightDetailsTarget(document,light,details);
  if(!target&&light.targetPlacementId)target=unique(document.placements,p=>same(p.id,light.targetPlacementId!)).transform.position;
  target??=artifactPoint([0,0,-1],{position:emitter,rotation:light.transform.rotation,scale:[1,1,1]});
 }
 const worldEmitter=artifactPoint(emitter,room.transform);
 return {emitter:worldEmitter,axis:unit(sub(artifactPoint(target,room.transform),worldEmitter)),range:details?.range??0,penumbra:details?.penumbra??0};
}

/** The explicit selection binds artwork bounds without changing the light's aim. */
export function spotBeamFitArtwork(document:Exhibition,light:ExhibitionLight,details:LightDetails|undefined,placementId:string) {
 const placement=unique(document.placements,p=>same(p.id,placementId));
 if(light.type!=='spot'||!same(placement.roomId,light.roomId))return invalid();
 const track=details?.trackAim?.aim;
 const referenced=track?.kind==='placement-center'?track.placementId
  :!track&&(details?.aim?.kind==='placement-center'||details?.aim===undefined)?light.targetPlacementId:undefined;
 const fixedPoint=track?.kind==='point'||!track&&details?.aim?.kind==='point';
 if(referenced?!same(referenced,placement.id):!fixedPoint)return invalid();
 return unique(document.artworks,a=>same(a.revisionId,placement.artworkRevisionId));
}

export function spotOpticalAssetIds(art:Exhibition['artworks'][number]):string[] {
 return [...new Set([art.primaryAssetId,...lodVariantsFor(art).map(variant=>variant.assetId)].map(id=>id.toLowerCase()))];
}

export function spotArtworkOpticalBounds(document:Exhibition,placementId:string,measurements:readonly SpotOpticalMeasurement[]):readonly SpotOpticalBounds[] {
 const placement=unique(document.placements,p=>same(p.id,placementId));
 const room=unique(document.rooms,r=>same(r.id,placement.roomId));
 const art=unique(document.artworks,a=>same(a.revisionId,placement.artworkRevisionId));
 const ids=spotOpticalAssetIds(art);
 if(measurements.length!==ids.length)return invalid();
 const poses=[art.transform,placement.transform,room.transform];
 const frame=art.artworkType==='image'?frameImageFootprintForArtwork(document,art):undefined;
 return ids.map(id=>{
  const asset=unique(art.assets,a=>same(a.id,id));
  const measurement=unique(measurements,m=>same(m.assetId,id));
  if(measurement.sha256!==asset.sha256)return invalid();
  const binding={assetId:asset.id,sha256:asset.sha256};
  if(measurement.kind==='png'&&art.artworkType==='image'&&asset.mime==='image/png'){
   const {widthPx,heightPx}=measurement;
   if(![widthPx,heightPx].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=8192))return invalid();
   const scale=Math.min(art.dimensions.width/widthPx,art.dimensions.height/heightPx);
   const corners=artifactCorners(frame??{width:widthPx*scale,height:heightPx*scale},poses).slice(0,4);
   const normal=unit(cross(sub(corners[1]!,corners[0]!),sub(corners[2]!,corners[0]!)));
   return {...binding,kind:'display-plane',corners,normal};
  }
  if(measurement.kind==='centered-glb'&&art.artworkType==='sculpture'&&asset.mime==='model/gltf-binary'){
   const [width,height,depth]=measurement.size;
   if(!(depth>0))return invalid();
   return {...binding,kind:'sculpture-containment-envelope',corners:artifactCorners({width,height,depth},poses)};
  }
  return invalid();
 });
}

export function spotOpticalFloors(document:Exhibition,roomId:string):SpotOpticalFloor[] {
 const room=unique(document.rooms,r=>same(r.id,roomId));
 const floorPlane=(world:(p:AffinePoint)=>AffinePoint,second:AffinePoint)=>{
  const origin=world([0,0,0]);
  return {origin,normal:unit(cross(sub(world([1,0,0]),origin),sub(world(second),origin)))};
 };
 const floors=document.surfaces.filter(f=>same(f.roomId,room.id)&&f.type==='floor').map(
  f=>floorPlane(p=>artifactPoint(p,f.transform,room.transform),[0,1,0]));
 if(!floors.length&&floorFor(document,{roomId:room.id}))floors.push(floorPlane(p=>artifactPoint(p,room.transform),[0,0,1]));
 return floors;
}

export function solveSpotOpticalFit({pose,bounds,floors=[]}:{pose:SpotOpticalPose;bounds:readonly SpotOpticalBounds[];floors?:readonly SpotOpticalFloor[]}):SpotOpticalFitResult {
 const {emitter,range,penumbra}=pose;
 if(!bounds.length||bounds.length>2||!Number.isFinite(range)||range<0||range>50||!Number.isFinite(penumbra)||penumbra<0||penumbra>1)return invalid();
 const axis=unit(pose.axis);
 let minForward=Infinity,maxDistanceMeters=0,maxPolarAngleRadians=0,minImageIncidence:number|null=null;
 for(const bound of bounds){
  if(bound.corners.length!==(bound.kind==='display-plane'?4:8))return invalid();
  const normal=bound.normal?unit(bound.normal):undefined;
  for(const point of bound.corners){
   const ray=sub(point,emitter),dir=unit(ray),forward=dot(ray,axis);
   minForward=Math.min(minForward,forward);
   maxDistanceMeters=Math.max(maxDistanceMeters,Math.hypot(...ray));
   maxPolarAngleRadians=Math.max(maxPolarAngleRadians,Math.atan2(Math.hypot(...cross(ray,axis)),forward));
   if(normal)minImageIncidence=Math.min(minImageIncidence??1,Math.abs(dot(dir,normal)));
  }
 }
 const floorSpill=range>0&&floors.length>0&&floors.every(f=>Math.abs(dot(sub(emitter,f.origin),unit(f.normal)))>=range)?'range-excluded':'unknown';
 const evidence:SpotOpticalFitEvidence={maxDistanceMeters,maxPolarAngleRadians,minImageIncidence,floorSpill};
 if(minForward<=0)return {ok:false,reason:'behind-axis',evidence};
 if(range>0&&maxDistanceMeters>=range)return {ok:false,reason:'out-of-range',evidence};
 if(penumbra===1)return {ok:false,reason:'unsupported-penumbra',evidence};
 // Keep corners inside the inner cone after cosine quantization.
 const inner=Math.max(maxPolarAngleRadians+1e-5,Math.acos(Math.max(-1,Math.cos(maxPolarAngleRadians)-1e-6)));
 const fullBeamRadians=2*inner/(1-penumbra);
 if(fullBeamRadians>Math.PI/2)return {ok:false,reason:'angle-limit',evidence};
 if(evidence.floorSpill==='unknown'&&floors.some(f=>f.witnesses?.some(point=>{
  const ray=sub(point,emitter),distance=Math.hypot(...ray);
  return distance>0&&(range===0||distance<range)&&dot(unit(ray),axis)>Math.cos(fullBeamRadians/2);
 })))evidence.floorSpill='positive-witness';
 return {ok:true,fullBeamRadians,evidence};
}
