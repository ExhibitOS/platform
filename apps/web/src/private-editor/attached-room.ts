import {Matrix4,Vector3,Quaternion} from 'three';
import type {Exhibition} from '@exhibitos/spec';
import {artifactBounds,artifactCorners,alignedDoorPair,freezeCanonical,TEMPLATE_NAMESPACE,assertRoomEnvelopeContents} from '@exhibitos/studio-contract';
import {newRoom,newDoor,whiteCubeSurfaces,applyGeometryCommand,createGeometryState,type GeometryCommand} from '../geometry/model';
import {worldMatrix,matrix} from '../geometry/direct-edit';
import {runDoorConnection,checkedDoorConnection} from './door-connection';

const qualified=new WeakMap<GeometryCommand,{source:Exhibition;candidate:Exhibition;roomId:string;firstId:string;secondId:string;fingerprint:string}>();
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
 if(!result||!current()||result.type!=='replace-architecture')return null;qualified.set(result,{source:document,candidate:result.candidate,roomId:candidate.roomId,firstId:candidate.firstId,secondId:candidate.secondId,fingerprint:freezeCanonical(result.candidate)});return {roomId:candidate.roomId,command:result};
}

/** Admit only this exact, still-current qualified attempt; unchanged legacy rooms
 * do not gain a new envelope requirement merely because a neighbour was added. */
export function assertPreparedRoom(source:Exhibition,command:GeometryCommand,roomId:string){
 const proof=qualified.get(command);qualified.delete(command);
 if(!proof||proof.source!==source||proof.roomId!==roomId||command.type!=='replace-architecture'||command.candidate!==proof.candidate||freezeCanonical(command.candidate)!==proof.fingerprint)throw Error('ROOM_ATTEMPT_STALE');
 const next=command.candidate,room=next.rooms.find(value=>same(value.id,roomId));if(!room||source.rooms.some(value=>same(value.id,roomId)))throw Error('ROOM_ATTEMPT_CHANGED');
 const surfaces=next.surfaces.filter(value=>same(value.roomId,roomId));if(surfaces.length!==6||surfaces.map(value=>value.type).sort().join(',')!=='ceiling,floor,wall,wall,wall,wall')throw Error('ROOM_ATTEMPT_CHANGED');
 const first=next.openings.find(value=>same(value.id,proof.firstId)),second=next.openings.find(value=>same(value.id,proof.secondId)),original=source.openings.find(value=>same(value.id,proof.firstId));
 if(!first||!second||!same(first.connectsToOpeningId??'',second.id)||!same(second.connectsToOpeningId??'',first.id)||first.exterior!==undefined||second.exterior!==undefined||!surfaces.some(value=>same(value.id,second.surfaceId)))throw Error('ROOM_ATTEMPT_CHANGED');
 if(original){const stable=(value:typeof original)=>({...value,connectsToOpeningId:null,exterior:null});if(freezeCanonical(stable(first))!==freezeCanonical(stable(original)))throw Error('ROOM_ATTEMPT_CHANGED');}
 else if(!source.surfaces.some(value=>same(value.id,first.surfaceId)))throw Error('ROOM_ATTEMPT_CHANGED');
 const copy=structuredClone(next);copy.rooms=copy.rooms.filter(value=>!same(value.id,roomId));copy.surfaces=copy.surfaces.filter(value=>!same(value.roomId,roomId));copy.openings=copy.openings.filter(value=>!same(value.id,second.id)&&(!same(value.id,first.id)||!!original)).map(value=>original&&same(value.id,original.id)?structuredClone(original):value);
 const template=copy.extensions?.[TEMPLATE_NAMESPACE] as unknown as {modified?:unknown}|undefined,oldTemplate=source.extensions?.[TEMPLATE_NAMESPACE] as unknown as {modified?:unknown}|undefined;if(template&&oldTemplate&&typeof template.modified==='boolean'&&typeof oldTemplate.modified==='boolean')template.modified=oldTemplate.modified;
 if(freezeCanonical(copy)!==freezeCanonical(source))throw Error('ROOM_ATTEMPT_CHANGED');assertRoomEnvelopeContents(next,roomId);
}
