import {Matrix4,Vector3,Quaternion} from 'three';
import type {Exhibition} from '@exhibitos/spec';
import {artifactBounds,artifactCorners,alignedDoorPair} from '@exhibitos/studio-contract';
import {newRoom,newDoor,whiteCubeSurfaces,applyGeometryCommand,createGeometryState,type GeometryCommand} from '../geometry/model';
import {worldMatrix,matrix} from '../geometry/direct-edit';
import {runDoorConnection,checkedDoorConnection} from './door-connection';

const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();

/** Compose existing room/door commands without publishing intermediate geometry. */
export function attachedRoomCandidate(document:Exhibition,wallId:string,openingId?:string){
 const wall=document.surfaces.find(value=>same(value.id,wallId)),parent=document.rooms.find(value=>!!wall&&same(value.id,wall.roomId));if(!wall||wall.type!=='wall'||!parent)throw Error('ROOM_WALL_UNSUPPORTED');
 const rotation=new Quaternion(...parent.transform.rotation),up=new Vector3(0,1,0).applyQuaternion(rotation);if(up.distanceTo(new Vector3(0,1,0))>1e-5)throw Error('ROOM_WALL_UNSUPPORTED');
 const axis=Math.abs(wall.transform.position[0])>Math.abs(wall.transform.position[2])?0:2,sign=Math.sign(wall.transform.position[axis]);if(!sign)throw Error('ROOM_WALL_UNSUPPORTED');
 const dimensions={width:axis===2?parent.dimensions.width:8,height:parent.dimensions.height,depth:axis===0?parent.dimensions.depth:6},offset=new Vector3();offset.setComponent(axis,sign*((axis===0?parent.dimensions.width:parent.dimensions.depth)+(axis===0?dimensions.width:dimensions.depth))/2);
 const position=offset.applyMatrix4(worldMatrix(document,{kind:'room',id:parent.id})).toArray() as [number,number,number],room=newRoom('새 전시실',dimensions,{position,rotation:[...parent.transform.rotation],scale:[1,1,1]});
 const bounds=artifactBounds(artifactCorners(room.dimensions,[room.transform],true));
 for(const other of document.rooms){if(same(other.id,parent.id))continue;const b=artifactBounds(artifactCorners(other.dimensions,[other.transform],true));if(([0,1,2] as const).every(i=>bounds.min[i]<b.max[i]-1e-5&&bounds.max[i]>b.min[i]+1e-5))throw Error('ROOM_SPACE_OCCUPIED');}
 let state=applyGeometryCommand(createGeometryState(document),{type:'add-room',room});const surfaces=whiteCubeSurfaces(room);for(const surface of surfaces)state=applyGeometryCommand(state,{type:'add-surface',surface});
 const opposite=surfaces.find(surface=>surface.type==='wall'&&Math.abs(surface.transform.position[axis]+sign*(axis===0?dimensions.width:dimensions.depth)/2)<1e-5)!;if(!opposite)throw Error('ROOM_WALL_UNSUPPORTED');
 let first=openingId?document.openings.find(opening=>same(opening.id,openingId!)):undefined;
 if(openingId&&(!first||!same(first.surfaceId,wall.id)||first.type!=='door'||first.connectsToOpeningId))throw Error('ROOM_DOOR_UNSUPPORTED');
 first??=newDoor(wall.id,{width:1.2,height:2.2},[0,1.1-wall.transform.position[1]]);
 for(const other of document.openings){if(!same(other.surfaceId,wall.id)||same(other.id,first.id))continue;if(Math.abs(other.offset[0]-first.offset[0])<(other.dimensions.width+first.dimensions.width)/2+1e-5&&Math.abs(other.offset[1]-first.offset[1])<(other.dimensions.height+first.dimensions.height)/2+1e-5)throw Error('ROOM_DOOR_OCCUPIED');}
 if(!openingId)state=applyGeometryCommand(state,{type:'add-opening',opening:first});
 const center=new Vector3(first.offset[0],first.offset[1],0).applyMatrix4(new Matrix4().multiplyMatrices(worldMatrix(state.present,{kind:'room',id:parent.id}),matrix(wall.transform))).applyMatrix4(new Matrix4().copy(worldMatrix(state.present,{kind:'surface',id:opposite.id})).invert());
 const second=newDoor(opposite.id,{...first.dimensions},[center.x,center.y]);state=applyGeometryCommand(state,{type:'add-opening',opening:second});alignedDoorPair(state.present,first.id,second.id);
 return {document:state.present,roomId:room.id,firstId:first.id,secondId:second.id};
}
/** Use the existing capsule/floor/collision qualification, then return one undoable command. */
export async function prepareAttachedRoom(document:Exhibition,wallId:string,openingId:string|undefined,current:()=>boolean,check=checkedDoorConnection):Promise<{roomId:string;command:GeometryCommand}|null>{
 if(!current())return null;const candidate=attachedRoomCandidate(document,wallId,openingId);let result:GeometryCommand|undefined;
 await runDoorConnection(candidate.document,candidate.firstId,candidate.secondId,current,command=>{result={type:'replace-architecture',candidate:applyGeometryCommand(createGeometryState(candidate.document),command).present};},check);
 return result&&current()?{roomId:candidate.roomId,command:result}:null;
}
