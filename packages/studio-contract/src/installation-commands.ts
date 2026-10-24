// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {artifactPoint,artifactCorners,validateArtifactPose} from './artifact-affine.js';
import type {AffinePoint,ArtifactPose} from './artifact-affine.js';
import {installationFor,validateStudioInstallation} from './installation.js';
import {installationPlane,installationArtworkBounds,installationFramePrimitives,resolveInstallations} from './installation-resolver.js';
export type InstallationCommand={placementId:string;command:'center-artwork'|'on-top'}|{placementId:string;command:'install-height';height:number;floorSurfaceId?:string}|{placementId:string;command:'wall-gap';gap:number;wallSurfaceId:string};
const dot=(a:AffinePoint,b:AffinePoint)=>a.reduce((sum,n,i)=>sum+n*b[i]!,0);
const sub=(a:AffinePoint,b:AffinePoint):AffinePoint=>a.map((n,i)=>n-b[i]!) as AffinePoint;
const unit=(p:AffinePoint):AffinePoint=>{const l=Math.hypot(...p);if(l<1e-12||!Number.isFinite(l))throw Error('INSTALLATION_singular-transform');return p.map(n=>n/l) as AffinePoint;};
const cross=(a:AffinePoint,b:AffinePoint):AffinePoint=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const equals=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
function surfaceBasis(pose:ArtifactPose){
 validateArtifactPose(pose);const origin={...pose,position:[0,0,0] as AffinePoint};return ([0,1,2] as const).map(i=>artifactPoint([i===0?1:0,i===1?1:0,i===2?1:0],origin));
}
function surfacePlane(s:Exhibition['surfaces'][number]){
 const axes=surfaceBasis(s.transform);return {point:[...s.transform.position] as AffinePoint,normal:unit(cross(axes[0]!,axes[1]!))};
}
function inversePoint(p:AffinePoint,pose:ArtifactPose):AffinePoint{
 const delta=sub(p,pose.position),axes=surfaceBasis(pose);return axes.map(axis=>dot(delta,axis)/dot(axis,axis)) as AffinePoint;
}
/** Perimeter walls use the side containing the room volume; interior partitions
 * retain the artwork's existing side (or its explicit front when exactly on-plane).
 * This resolves the selected wall side without nearest-wall attachment or rotation.
 */
function inwardWallNormal(room:Exhibition['rooms'][number],plane:{point:AffinePoint;normal:AffinePoint},artCenter:AffinePoint,artNormal:AffinePoint):AffinePoint {
 const d=room.dimensions,distances=Array.from({length:8},(_,i)=>dot(sub([(i&1?1:-1)*d.width/2,i&2?d.height:0,(i&4?1:-1)*d.depth/2],plane.point),plane.normal));
 const min=Math.min(...distances),max=Math.max(...distances),side=dot(sub(artCenter,plane.point),plane.normal);
 const sign=min>=-1e-8?1:max<=1e-8?-1:Math.abs(side)>1e-8?Math.sign(side):Math.sign(dot(artNormal,plane.normal));
 if(!sign)throw Error('INSTALLATION_singular-transform');return plane.normal.map(n=>n*sign) as AffinePoint;
}
function floorAt(s:Exhibition['surfaces'][number],x:number,z:number):number|undefined{
 const plane=surfacePlane(s);if(Math.abs(plane.normal[1])<1e-8)return undefined;
 const y=plane.point[1]-(plane.normal[0]*(x-plane.point[0])+plane.normal[2]*(z-plane.point[2]))/plane.normal[1];
 if(!Number.isFinite(y)||Math.abs(y)>10000)return undefined;
 const local=inversePoint([x,y,z],s.transform);
 return Math.abs(local[0])<=s.dimensions.width/2+1e-9&&Math.abs(local[1])<=s.dimensions.height/2+1e-9?y:undefined;
}
/** Only the selected existing placement position changes. Caller validates complete base draft before and after. */
export function applyInstallationCommand(candidate:Exhibition,command:InstallationCommand):Exhibition {
 if(!validateStudioInstallation(candidate).valid)throw Error('INSTALLATION_PROFILE_INVALID');
 const p=candidate.placements.find(p=>equals(p.id,command.placementId));if(!p)throw Error('INSTALLATION_placement-not-found');
 const art=candidate.artworks.find(a=>equals(a.revisionId,p.artworkRevisionId));if(!art)throw Error('INSTALLATION_placement-not-found');
 const binding=installationFor(candidate,p.id),bounds=installationArtworkBounds(art,p),delta:AffinePoint=[0,0,0];
 if(command.command==='center-artwork'||command.command==='on-top'){
  const pedestal=binding?.pedestal;if(!pedestal||pedestal.kind==='none')throw Error('INSTALLATION_COMMAND_DENIED');
  const eligibility=resolveInstallations(candidate).find(v=>equals(v.placementId,p.id))?.issues.find(v=>v.component==='pedestal');if(eligibility)throw Error('INSTALLATION_'+eligibility.reason);
  if(command.command==='center-artwork'){delta[0]=pedestal.position[0]-bounds.center[0];delta[2]=pedestal.position[2]-bounds.center[2];}
  else delta[1]=pedestal.position[1]+pedestal.dimensions.height-bounds.min[1];
 }else if(command.command==='install-height'){
  if(!Number.isFinite(command.height)||command.height<0||command.height>10)throw Error('INSTALLATION_COMMAND_DENIED');
  const authoredFloors=candidate.surfaces.filter(s=>s.type==='floor'&&equals(s.roomId,p.roomId));
  const floors=authoredFloors.filter(s=>!command.floorSurfaceId||equals(s.id,command.floorSurfaceId));
  const values=floors.map(s=>floorAt(s,bounds.center[0],bounds.center[2])).filter((v):v is number=>v!==undefined);
  // Exact existing Viewer/presence implicit-room-base policy, only when no explicit floor exists.
  // The diagnostic implicit-floor:<room> string is never persisted as a UUID.
  if(!authoredFloors.length&&!command.floorSurfaceId){const room=candidate.rooms.find(r=>equals(r.id,p.roomId));if(room&&Math.abs(bounds.center[0])<=room.dimensions.width/2&&Math.abs(bounds.center[2])<=room.dimensions.depth/2)values.push(0);}
  if(!values.length)throw Error('INSTALLATION_missing-room-floor');if(values.length!==1)throw Error('INSTALLATION_ambiguous-room-floor');
  delta[1]=values[0]!+command.height-bounds.center[1];
 }else if(command.command==='wall-gap'){
  if(!Number.isFinite(command.gap)||command.gap<0||command.gap>1)throw Error('INSTALLATION_COMMAND_DENIED');
  const wall=candidate.surfaces.find(s=>equals(s.id,command.wallSurfaceId));if(!wall||wall.type!=='wall')throw Error('INSTALLATION_missing-selected-wall');if(!equals(wall.roomId,p.roomId))throw Error('INSTALLATION_room-mismatch');
  const frameIssue=resolveInstallations(candidate).find(r=>equals(r.placementId,p.id))?.issues.find(i=>i.component==='frame');if(frameIssue)throw Error('INSTALLATION_'+frameIssue.reason);
  let image:ReturnType<typeof installationPlane>;try{image=installationPlane(art,p);}catch(error){throw Error(error instanceof Error&&error.message==='source-not-planar'?'INSTALLATION_source-not-planar':'INSTALLATION_singular-transform',{cause:error});}
  const plane=surfacePlane(wall);if(1-Math.abs(dot(plane.normal,image.normal))>1e-4)throw Error('INSTALLATION_wall-not-parallel');
  const room=candidate.rooms.find(r=>equals(r.id,p.roomId));if(!room)throw Error('INSTALLATION_room-mismatch');plane.normal=inwardWallNormal(room,plane,bounds.center,image.normal);
  const vertices=artifactCorners(art.dimensions,[art.transform,p.transform]);if(binding)vertices.push(...installationFramePrimitives(art,p,binding).flatMap(p=>p.vertices));
  // An explicit selected wall must actually contain the artwork/frame footprint and avoid its openings.
  // Gap changes only wall-normal clearance; it must not silently snap/reorient an unrelated artwork.
  const footprint=vertices.map(v=>inversePoint(v,wall.transform)),minX=Math.min(...footprint.map(v=>v[0])),maxX=Math.max(...footprint.map(v=>v[0])),minY=Math.min(...footprint.map(v=>v[1])),maxY=Math.max(...footprint.map(v=>v[1]));
  if(minX < -wall.dimensions.width/2-1e-9||maxX>wall.dimensions.width/2+1e-9||minY < -wall.dimensions.height/2-1e-9||maxY>wall.dimensions.height/2+1e-9)throw Error('INSTALLATION_limits-exceeded');
  for(const opening of candidate.openings.filter(o=>equals(o.surfaceId,wall.id))){const x=opening.offset[0],y=opening.offset[1],w=opening.dimensions.width/2,h=opening.dimensions.height/2;if(maxX>x-w&&minX<x+w&&maxY>y-h&&minY<y+h)throw Error('INSTALLATION_limits-exceeded');}
  const clearance=Math.min(...vertices.map(v=>dot(sub(v,plane.point),plane.normal))),shift=command.gap-clearance;
  for(let i=0;i<3;i++)delta[i]=plane.normal[i]!*shift;
 }else throw Error('INSTALLATION_COMMAND_DENIED');
 const result=structuredClone(candidate),next=result.placements.find(v=>equals(v.id,p.id))!;next.transform.position=p.transform.position.map((n,i)=>n+delta[i]!) as AffinePoint;
 try{artifactCorners(art.dimensions,[art.transform,next.transform]);}catch{throw Error('INSTALLATION_limits-exceeded');}return result;
}
