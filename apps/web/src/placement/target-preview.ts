// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Artwork,Exhibition} from '@exhibitos/spec';
import {artifactBounds,artifactCorners,freezeCanonical} from '@exhibitos/studio-contract';
import {Matrix4,Quaternion,Vector3} from 'three';
import {matrix} from '../geometry/direct-edit';
import {applyGeometryCommand,createGeometryState} from '../geometry/model';
import {alignPlacement,newPlacement,type Placement} from './model';
import type {PlacementBegin} from '../native-placement-protocol';
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
/** Temporary validation projection only. It never changes the host's draft/history. */
export function placementInventory(document:Exhibition,artwork:Artwork):Exhibition {
 const existing=document.artworks.find(a=>same(a.revisionId,artwork.revisionId));
 if(existing){if(freezeCanonical(existing)!==freezeCanonical(artwork))throw Error('PLACEMENT_SOURCE_CHANGED');return document;}
 return applyGeometryCommand(createGeometryState(document),{type:'add-artwork',artwork}).present;
}
export function checkedPlacementTarget(document:Exhibition,artwork:Artwork,intent:PlacementBegin,surfaceId:string,offset:[number,number]):Placement {
 if(!offset.every(Number.isFinite)||offset.length!==2)throw Error('PLACEMENT_TARGET_INVALID');
 const doc=placementInventory(document,artwork),room=doc.rooms.find(r=>same(r.id,intent.roomId)),surface=doc.surfaces.find(s=>same(s.id,surfaceId));
 if(!room||!surface||!same(surface.roomId,room.id)||surface.type!==intent.targetKind||doc.placements.some(p=>same(p.id,intent.placementId)))throw Error('PLACEMENT_TARGET_INVALID');
 let placement={...newPlacement(artwork,room.id),id:intent.placementId};
 if(surface.type==='wall')placement=alignPlacement(doc,placement,surface,offset,0);
 else {
  const normal=new Vector3(0,0,1).applyQuaternion(new Quaternion(...surface.transform.rotation));
  // Preserve authored artwork orientation. Tilted floors remain a precise-edit path.
  if(normal.distanceTo(new Vector3(0,1,0))>1e-6)throw Error('PLACEMENT_FLOOR_UNSUPPORTED');
  const point=new Vector3(offset[0],offset[1],0).applyMatrix4(matrix(surface.transform));
  const original=artifactBounds(artifactCorners(artwork.dimensions,[artwork.transform]));
  placement.transform.position=[point.x-original.center[0],point.y-original.min[1],point.z-original.center[2]];
 }
 const corners=artifactCorners(artwork.dimensions,[artwork.transform,placement.transform]);
 for(const [x,y,z] of corners)if(Math.abs(x)>room.dimensions.width/2+1e-6||y < -1e-6||y>room.dimensions.height+1e-6||Math.abs(z)>room.dimensions.depth/2+1e-6)throw Error('PLACEMENT_OUTSIDE_ROOM');
 if(surface.type==='floor') {
  const inverse=new Matrix4().copy(matrix(surface.transform)).invert();
  for(const point of corners){const p=new Vector3(...point).applyMatrix4(inverse);if(Math.abs(p.x)>surface.dimensions.width/2+1e-6||Math.abs(p.y)>surface.dimensions.height/2+1e-6||p.z < -1e-6)throw Error('PLACEMENT_OUTSIDE_FLOOR');}
 }
 applyGeometryCommand(createGeometryState(doc),{type:'add-placement',placement});
 return placement;
}
