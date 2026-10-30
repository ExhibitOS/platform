import type {Exhibition} from '@exhibitos/spec';
import {Matrix4,Quaternion,Vector3} from 'three';
import {artifactBounds,artifactCorners,IDENTITY_ARTIFACT_POSE} from '@exhibitos/studio-contract';
import {alignPlacement} from '../placement/model';
import type {GeometryCommand} from './model';
export interface EditorSelection {kind:'room'|'surface'|'opening'|'placement';id:string}
export type EditMode='translate'|'rotate'|'dimensions';
export type Pose=Exhibition['rooms'][number]['transform'];
export interface EditorBridge {
 document:Exhibition;selection:EditorSelection|null;mode:EditMode;view:string;disabled:boolean;preview:GeometryCommand|null;
 select:(selection:EditorSelection)=>void;previewChange:(command:GeometryCommand|null)=>void;commit:(command:GeometryCommand)=>void;error:(message:string)=>void;
 uprightRooms?:boolean;
 dropArtwork?:(artworkRevisionId:string,surfaceId:string,worldPoint:[number,number,number])=>void;
}
export const selectionKey=(s:EditorSelection)=>s.kind+':'+s.id;
export function selectedItem(doc:Exhibition,s:EditorSelection){return s.kind==='room'?doc.rooms.find(x=>x.id===s.id):s.kind==='surface'?doc.surfaces.find(x=>x.id===s.id):s.kind==='opening'?doc.openings.find(x=>x.id===s.id):doc.placements.find(x=>x.id===s.id)}
export function matrix(p:Pose){return new Matrix4().compose(new Vector3(...p.position),new Quaternion(...p.rotation),new Vector3(...p.scale))}
export function roomMatrix(doc:Exhibition,id:string){const r=doc.rooms.find(x=>x.id.toLowerCase()===id.toLowerCase());if(!r)throw Error('선택한 공간을 다시 확인해 주세요.');return matrix(r.transform)}
export function worldMatrix(doc:Exhibition,s:EditorSelection):Matrix4 {
 const item=selectedItem(doc,s);if(!item)throw Error('선택한 대상을 다시 확인해 주세요.');
 if(s.kind==='room')return matrix((item as Exhibition['rooms'][number]).transform);
 if(s.kind==='opening'){const o=item as Exhibition['openings'][number];const wall=doc.surfaces.find(x=>x.id===o.surfaceId);if(!wall)throw Error('문·창문이 있는 벽을 확인해 주세요.');return roomMatrix(doc,wall.roomId).multiply(matrix(wall.transform)).multiply(new Matrix4().makeTranslation(o.offset[0],o.offset[1],0));}
 const placed=item as Exhibition['placements'][number];return roomMatrix(doc,placed.roomId).multiply(matrix(placed.transform));
}
export function localPose(doc:Exhibition,s:EditorSelection):Pose {
 const item=selectedItem(doc,s);if(!item)throw Error('대상을 다시 선택해 주세요.');
 if(s.kind==='opening'){const o=item as Exhibition['openings'][number];return {position:[o.offset[0],o.offset[1],.002],rotation:[0,0,0,1],scale:[1,1,1]};}
 return structuredClone((item as Exhibition['rooms'][number]).transform);
}
function wallOffset(doc:Exhibition,p:Exhibition['placements'][number],wall:Exhibition['surfaces'][number],position:Pose['position']):[number,number]{
 const art=doc.artworks.find(a=>a.revisionId===p.artworkRevisionId);if(!art)throw Error('작품 정보를 확인해 주세요.');
 const bounds=artifactBounds(artifactCorners(art.dimensions,[art.transform,{...IDENTITY_ARTIFACT_POSE,scale:p.transform.scale}]));
 const local=new Vector3(...position).sub(new Vector3(...wall.transform.position)).applyQuaternion(new Quaternion(...wall.transform.rotation).invert());
 return [local.x+bounds.center[0],local.y+bounds.center[1]];
}
/** The existing format stores the aligned pose, not a persistent wall attachment.
 * Freeze only a unique exact existing alignment; never choose a different wall. */
export function alignedWall(doc:Exhibition,s:EditorSelection){
 if(s.kind!=='placement')return undefined;const p=doc.placements.find(x=>x.id===s.id);if(!p)return undefined;
 const matches=doc.surfaces.filter(w=>w.type==='wall'&&w.roomId===p.roomId).filter(w=>{
  try{const aligned=alignPlacement(doc,p,w,wallOffset(doc,p,w,p.transform.position),0);return new Vector3(...aligned.transform.position).distanceTo(new Vector3(...p.transform.position))<1e-7 && 1-Math.abs(new Quaternion(...aligned.transform.rotation).dot(new Quaternion(...p.transform.rotation)))<1e-7;}catch{return false;}
 });
 if(matches.length>1)throw Error('겹친 벽을 구분할 수 없어요. 벽 정렬의 숫자 편집으로 조절해 주세요.');return matches[0];
}
export function commandForPose(doc:Exhibition,s:EditorSelection,pose:Pose):GeometryCommand {
 const item=selectedItem(doc,s);if(!item)throw Error('대상을 다시 선택해 주세요.');
 if(s.kind==='placement'){
  const p=item as Exhibition['placements'][number],wall=alignedWall(doc,s);
  if(wall)return {type:'align-placement',id:p.id,surfaceId:wall.id,offset:wallOffset(doc,p,wall,pose.position),snap:0};
  const {id,...placement}=p;return {type:'set-placement',id,placement:{...placement,transform:pose}};
 }
 if(s.kind==='room'){const {id,...room}=item as Exhibition['rooms'][number];return {type:'set-room',id,room:{...room,transform:pose}};}
 if(s.kind==='surface'){const {id,...surface}=item as Exhibition['surfaces'][number];return {type:'set-surface',id,surface:{...surface,transform:pose}};}
 const {id,...opening}=item as Exhibition['openings'][number];return {type:'set-opening',id,opening:{...opening,offset:[pose.position[0],pose.position[1]]}};
}
/** Project a world XZ delta into parent-local XZ while preserving existing local Y. */
function localHorizontalDelta(parent:Matrix4,dx:number,dz:number){
 const e=parent.elements,a=e[0]!,b=e[8]!,c=e[2]!,d=e[10]!,det=a*d-b*c;
 if(Math.abs(det)<1e-8)throw Error('이 기울기에서는 평면도 이동을 구분하기 어려워요. 3D 또는 숫자 편집을 사용해 주세요.');
 return new Vector3((d*dx-b*dz)/det,0,(-c*dx+a*dz)/det);
}
export function planarCommand(doc:Exhibition,s:EditorSelection,dx:number,dz:number,angle?:number):GeometryCommand {
 const item=selectedItem(doc,s),pose=localPose(doc,s);if(!item)throw Error('대상을 다시 선택해 주세요.');
 if(angle!==undefined){if(s.kind==='opening'||alignedWall(doc,s))throw Error('벽에 맞춘 대상은 위치를 조절해 주세요. 회전은 숫자 편집에서 확인할 수 있어요.');if(angle===0)return commandForPose(doc,s,pose);pose.rotation=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),angle).multiply(new Quaternion(...pose.rotation)).normalize().toArray() as Pose["rotation"];return commandForPose(doc,s,pose);}
 if(s.kind==='room'){pose.position[0]+=dx;pose.position[2]+=dz;return commandForPose(doc,s,pose);}
 if(s.kind==='opening'){
  const o=item as Exhibition['openings'][number],w=doc.surfaces.find(x=>x.id===o.surfaceId)!;
  const tangent=new Vector3(1,0,0).transformDirection(roomMatrix(doc,w.roomId).multiply(matrix(w.transform))),length=tangent.x*tangent.x+tangent.z*tangent.z;
  if(length<1e-8)throw Error('이 방향은 3D 또는 숫자로 조절해 주세요.');pose.position[0]+=(dx*tangent.x+dz*tangent.z)/length;return commandForPose(doc,s,pose);
 }
 const roomId=(item as Exhibition['placements'][number]).roomId,delta=localHorizontalDelta(roomMatrix(doc,roomId),dx,dz),wall=alignedWall(doc,s);
 if(wall){const normal=new Vector3(0,0,1).applyQuaternion(new Quaternion(...wall.transform.rotation)),tangent=new Vector3(0,1,0).cross(normal);if(tangent.lengthSq()<1e-10)throw Error('이 벽의 이동은 3D 또는 숫자로 조절해 주세요.');tangent.normalize();delta.copy(tangent.multiplyScalar(delta.dot(tangent)));}
 pose.position[0]+=delta.x;pose.position[2]+=delta.z;return commandForPose(doc,s,pose);
}

/** Respect opaque front surfaces. Prefer a smaller target only at the same hit distance. */
export function closestEditorSelection(hits:{distance:number;selection:EditorSelection}[]):EditorSelection|undefined {
 if(!hits.length)return undefined;const sorted=[...hits].sort((a,b)=>a.distance-b.distance),near=sorted.filter(h=>h.distance-sorted[0]!.distance<1e-5);return (near.find(h=>h.selection.kind==='opening')??near.find(h=>h.selection.kind==='placement')??near[0])?.selection;
}

export type RoomDimensionAxis='width'|'depth';
/** Change authored dimensions only. This deliberately does not rescale or relocate children. */
export function roomDimensionCommand(doc:Exhibition,s:EditorSelection,axis:RoomDimensionAxis,delta:number):GeometryCommand {
 if(s.kind!=='room'||!Number.isFinite(delta))throw Error('방을 선택한 뒤 크기를 조절해 주세요.');
 const room=doc.rooms.find(r=>r.id===s.id);if(!room)throw Error('방을 다시 선택해 주세요.');
 const {id,...value}=room;return {type:'set-room',id,room:{...value,dimensions:{...room.dimensions,[axis]:room.dimensions[axis]+delta}}};
}
export function planarRoomDimensionCommand(doc:Exhibition,s:EditorSelection,axis:RoomDimensionAxis,dx:number,dz:number):GeometryCommand {
 if(s.kind!=='room')throw Error('방을 선택한 뒤 크기를 조절해 주세요.');
 const delta=localHorizontalDelta(worldMatrix(doc,s),dx,dz);return roomDimensionCommand(doc,s,axis,2*(axis==='width'?delta.x:delta.z));
}
