// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {artifactPoint,artifactCorners,artifactBounds,validateArtifactPose,type AffinePoint,type ArtifactPose} from './artifact-affine.js';
import {validateStudioLightDetails} from './light-details.js';
import {resolveInstallations} from './installation-resolver.js';
import {validateStudioBenches} from './benches.js';
import {surfacePanels} from './surface-panels.js';
import {freezeCanonical} from './freeze.js';

type Room=Exhibition['rooms'][number];
type Surface=Exhibition['surfaces'][number];
export const LIGHT_ATTACHMENT_NAMESPACE='org.exhibitos.studio/light-attachments';
export interface LightAttachment {lightId:string;surfaceId:string;anchor:[number,number];gap:number}
export interface StudioLightAttachments {version:1;lights:LightAttachment[]}
const tolerance=1e-5;
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const close=(a:number,b:number)=>Math.abs(a-b)<=tolerance;
const dot=(a:AffinePoint,b:AffinePoint)=>a.reduce((s,v,i)=>s+v*b[i]!,0);
const sub=(a:AffinePoint,b:AffinePoint)=>a.map((v,i)=>v-b[i]!) as AffinePoint;
const unit=(v:AffinePoint)=>{const n=Math.hypot(...v);if(n<tolerance)throw Error('singular');return v.map(x=>x/n) as AffinePoint;};
const direction=(pose:ArtifactPose,axis:AffinePoint)=>sub(artifactPoint(axis,pose),pose.position);
const inside=(point:AffinePoint,dimensions:Room['dimensions'])=>Math.abs(point[0])<=dimensions.width/2+tolerance&&point[1]>=-tolerance&&point[1]<=dimensions.height+tolerance&&Math.abs(point[2])<=dimensions.depth/2+tolerance;
export class RoomEnvelopeError extends Error {
 constructor(public code:string,public subjectId:string,message:string){super(message);this.name='RoomEnvelopeError';}
}
function fail(code:string,id:string,message:string):never{throw new RoomEnvelopeError(code,id,message);}
function rigid(pose:ArtifactPose){validateArtifactPose(pose);if(pose.scale.some(n=>!close(n,1)))throw Error('scaled structural surface');}
function inverse(point:AffinePoint,pose:ArtifactPose):AffinePoint {
 rigid(pose);const [x,y,z,w]=pose.rotation;
 return artifactPoint(sub(point,pose.position),{position:[0,0,0],rotation:[-x,-y,-z,w],scale:[1,1,1]});
}
function roomFor(document:Exhibition,id:string){const room=document.rooms.find(r=>same(r.id,id));if(!room)fail('ROOM_ENVELOPE_REFERENCE',id,'방을 다시 선택해 주세요.');return room;}
function assertRoom(room:Room){
 try{rigid(room.transform);if(Math.abs(room.transform.rotation[0])+Math.abs(room.transform.rotation[2])>tolerance)throw Error('tilted room');if(Object.values(room.dimensions).some(n=>!Number.isFinite(n)||n<=0||n>10000))throw Error('dimensions');}
 catch{fail('ROOM_ENVELOPE_UNSUPPORTED',room.id,'수평 바닥과 직사각형 벽으로 구성한 방만 크기를 함께 바꿀 수 있어요.');}
}
/** Gap is metres along the explicitly selected surface's +Z side. Beam aim is separate. */
export function lightAttachmentPose(surface:Surface,binding:LightAttachment):ArtifactPose {
 rigid(surface.transform);const [x,y,z,w]=surface.transform.rotation;
 return {position:artifactPoint([binding.anchor[0],binding.anchor[1],binding.gap],surface.transform),rotation:[-z,w,x,-y],scale:[1,1,1]};
}
export function lightAttachmentsFor(document:Pick<Exhibition,'extensions'>):LightAttachment[]{
 return structuredClone((document.extensions?.[LIGHT_ATTACHMENT_NAMESPACE] as unknown as StudioLightAttachments|undefined)?.lights??[]);
}
export function validateLightAttachments(candidate:unknown){
 const errors:{code:string;path:string;message:string}[]=[];
 const add=(suffix:string,message:string)=>errors.push({code:'LIGHT_ATTACHMENT_INVALID',path:'/candidate/extensions/org.exhibitos.studio~1light-attachments'+suffix,message});
 if(!object(candidate)||!object(candidate.extensions)||!Object.hasOwn(candidate.extensions,LIGHT_ATTACHMENT_NAMESPACE))return {valid:true,errors};
 const value=candidate.extensions[LIGHT_ATTACHMENT_NAMESPACE];
 if(!object(value)||!exact(value,['version','lights'])||value.version!==1||!Array.isArray(value.lights)||value.lights.length>32||new TextEncoder().encode(JSON.stringify(value)).length>16384){add('','Expected closed version1 with at most32 explicit light attachments');return {valid:false,errors};}
 const document=candidate as unknown as Exhibition,seen=new Set<string>();
 value.lights.forEach((entry,i)=>{
  const path='/lights/'+i;
  if(!object(entry)||!exact(entry,['lightId','surfaceId','anchor','gap'])||!uuid(entry.lightId)||!uuid(entry.surfaceId)||!Array.isArray(entry.anchor)||entry.anchor.length!==2||entry.anchor.some(v=>typeof v!=='number'||!Number.isFinite(v))||typeof entry.gap!=='number'||!Number.isFinite(entry.gap)||entry.gap<.01||entry.gap>1){add(path,'Explicit surface, bounded anchor and gap0.01..1m required');return;}
  if(seen.has(entry.lightId.toLowerCase())){add(path,'A light has only one explicit attachment');return;}seen.add(entry.lightId.toLowerCase());
  try{
   const light=document.lights.find(l=>same(l.id,entry.lightId as string)),surface=document.surfaces.find(s=>same(s.id,entry.surfaceId as string));
   if(!light||!['point','spot','area'].includes(light.type)||!surface||!['wall','ceiling'].includes(surface.type)||!same(light.roomId,surface.roomId))throw Error('reference');
   const room=roomFor(document,light.roomId),binding=entry as unknown as LightAttachment;
   if(Math.abs(binding.anchor[0])>surface.dimensions.width/2||Math.abs(binding.anchor[1])>surface.dimensions.height/2)throw Error('anchor outside surface');
   const pose=lightAttachmentPose(surface,binding);validateArtifactPose(light.transform);
   if(pose.position.some((v,j)=>!close(v,light.transform.position[j]!))||Math.abs(Math.abs(pose.rotation.reduce((s,v,j)=>s+v*light.transform.rotation[j]!,0))-1)>tolerance||light.transform.scale.some(n=>!close(n,1))||!inside(pose.position,room.dimensions))throw Error('stored pose differs');
   artifactPoint(pose.position,room.transform);
  }catch{add(path,'Selected wall/ceiling, stored pose, room and attachment must agree');}
 });
 return {valid:errors.length===0,errors};
}
function writeAttachments(document:Exhibition,lights:LightAttachment[]){
 document.extensions={...document.extensions,[LIGHT_ATTACHMENT_NAMESPACE]:{version:1,lights} as unknown as NonNullable<Exhibition['extensions']>[string]};
}
function assertAttachments(document:Exhibition){if(!validateLightAttachments(document).valid)fail('ROOM_ENVELOPE_LIGHT_ATTACHMENT',document.id,'조명 부착 정보와 저장된 위치가 달라요. 부착할 표면을 명시해 확인해 주세요.');}
export function setLightAttachment(document:Exhibition,lightId:string,value:Omit<LightAttachment,'lightId'>|null,verifiedBaseline?:Exhibition):Exhibition {
 assertAttachments(document);const next=structuredClone(document),light=next.lights.find(l=>same(l.id,lightId));if(!light)fail('ROOM_ENVELOPE_REFERENCE',lightId,'조명을 다시 선택해 주세요.');
 const bindings=lightAttachmentsFor(next).filter(b=>!same(b.lightId,lightId));
 if(value){const surface=next.surfaces.find(s=>same(s.id,value.surfaceId));if(!surface)fail('ROOM_ENVELOPE_REFERENCE',value.surfaceId,'부착할 벽이나 천장을 선택해 주세요.');const binding={...structuredClone(value),lightId:light.id};light.transform=lightAttachmentPose(surface,binding);bindings.push(binding);}
 writeAttachments(next,bindings);assertAttachments(next);if(verifiedBaseline)assertRoomEnvelopeContentsAgainstBaseline(next,verifiedBaseline,light.roomId);else assertRoomEnvelopeContents(next,light.roomId);return next;
}
export function remapLightAttachments(value:StudioLightAttachments,ids:ReadonlyMap<string,string>):StudioLightAttachments {
 const mapped=(id:string)=>{const value=ids.get(id.toLowerCase());if(!uuid(value))throw Error('LIGHT_ATTACHMENT_REFERENCE');return value;};
 return {version:1,lights:value.lights.map(b=>({...structuredClone(b),lightId:mapped(b.lightId),surfaceId:mapped(b.surfaceId)}))};
}

type Side='west'|'east'|'north'|'south'|'floor'|'ceiling';
function side(surface:Surface,room:Room):Side|undefined {
 rigid(surface.transform);const b=artifactBounds(artifactCorners(surface.dimensions,[surface.transform])),d=room.dimensions,n=unit(direction(surface.transform,[0,0,1]));
 const axes=[[1,0,0],[0,1,0]].map(a=>unit(direction(surface.transform,a as AffinePoint)));if(axes.some(a=>Math.max(...a.map(Math.abs))<1-tolerance))return undefined;
 const span=(axis:0|1|2,a:number,c:number)=>close(b.min[axis],a)&&close(b.max[axis],c);
 if(surface.type==='floor'&&span(0,-d.width/2,d.width/2)&&span(1,0,0)&&span(2,-d.depth/2,d.depth/2)&&close(n[1],1))return 'floor';
 if(surface.type==='ceiling'&&span(0,-d.width/2,d.width/2)&&span(1,d.height,d.height)&&span(2,-d.depth/2,d.depth/2)&&close(n[1],-1))return 'ceiling';
 if(surface.type!=='wall'||!span(1,0,d.height)||!close(unit(direction(surface.transform,[0,1,0]))[1],1))return undefined;
 if(span(0,-d.width/2,-d.width/2)&&span(2,-d.depth/2,d.depth/2)&&close(n[0],1))return 'west';
 if(span(0,d.width/2,d.width/2)&&span(2,-d.depth/2,d.depth/2)&&close(n[0],-1))return 'east';
 if(span(2,-d.depth/2,-d.depth/2)&&span(0,-d.width/2,d.width/2)&&close(n[2],1))return 'north';
 if(span(2,d.depth/2,d.depth/2)&&span(0,-d.width/2,d.width/2)&&close(n[2],-1))return 'south';
 return undefined;
}
function movedSurface(surface:Surface,kind:Side,dimensions:Room['dimensions']):Surface {
 const result=structuredClone(surface),u=unit(direction(surface.transform,[1,0,0])),v=unit(direction(surface.transform,[0,1,0])),axisLength=(axis:AffinePoint)=>[dimensions.width,dimensions.height,dimensions.depth][axis.map(Math.abs).indexOf(Math.max(...axis.map(Math.abs)))]!;
 result.dimensions={width:axisLength(u),height:axisLength(v)};
 result.transform.position=kind==='floor'?[0,0,0]:kind==='ceiling'?[0,dimensions.height,0]:[kind==='west'?-dimensions.width/2:kind==='east'?dimensions.width/2:0,dimensions.height/2,kind==='north'?-dimensions.depth/2:kind==='south'?dimensions.depth/2:0];
 return result;
}
function assertRoomEnvelopeContentsCore(document:Exhibition,roomId:string,baseline?:Exhibition){
 const room=roomFor(document,roomId),d=room.dimensions;assertRoom(room);
 for(const surface of document.surfaces.filter(s=>same(s.roomId,roomId))){
  if(artifactCorners(surface.dimensions,[surface.transform]).some(p=>!inside(p,d)))fail('ROOM_ENVELOPE_SURFACE_BOUNDS',surface.id,'방을 줄이면 내부 벽이나 표면이 밖으로 나가요. 해당 표면을 먼저 조절해 주세요.');
  artifactCorners(surface.dimensions,[surface.transform,room.transform]);
  try{surfacePanels(surface,document.openings);}catch{fail('ROOM_ENVELOPE_OPENING_BOUNDS',surface.id,'문·창문이 벽 밖으로 나가요. 개구부 크기나 위치를 먼저 조절해 주세요.');}
 }
 for(const p of document.placements.filter(p=>same(p.roomId,roomId))){const art=document.artworks.find(a=>same(a.revisionId,p.artworkRevisionId));if(!art||artifactCorners(art.dimensions,[art.transform,p.transform]).some(v=>!inside(v,d)))fail('ROOM_ENVELOPE_ARTWORK_BOUNDS',p.id,'작품 전체가 새 방 안에 들어오지 않아요. 작품을 먼저 옮겨 주세요.');artifactCorners(art.dimensions,[art.transform,p.transform,room.transform],true);}
 for(const p of document.placements.filter(p=>same(p.roomId,roomId))){
  const art=document.artworks.find(a=>same(a.revisionId,p.artworkRevisionId));if(art?.artworkType!=='image')continue;
  const corners=artifactCorners(art.dimensions,[art.transform,p.transform]);
  for(const wall of document.surfaces.filter(s=>same(s.roomId,roomId)&&s.type==='wall')){
   if(!close(Math.abs(p.transform.rotation.reduce((sum,v,i)=>sum+v*wall.transform.rotation[i]!,0)),1))continue;
   const b=artifactBounds(corners.map(v=>inverse(v,wall.transform)));if(!close(b.min[2],.002))continue;
   for(const opening of document.openings.filter(o=>same(o.surfaceId,wall.id)))if(b.max[0]>opening.offset[0]-opening.dimensions.width/2+tolerance&&b.min[0]<opening.offset[0]+opening.dimensions.width/2-tolerance&&b.max[1]>opening.offset[1]-opening.dimensions.height/2+tolerance&&b.min[1]<opening.offset[1]+opening.dimensions.height/2-tolerance)fail('ROOM_ENVELOPE_OPENING_ARTWORK',opening.id,'문·창문이 벽에 맞춘 작품과 겹쳐요. 작품이나 개구부 위치를 먼저 옮겨 주세요.');
  }
 }
 for(const installation of resolveInstallations(document).filter(i=>same(i.roomId,roomId)))if(installation.issues.length||installation.primitives.some(p=>p.vertices.some(v=>!inside(v,d))))fail('ROOM_ENVELOPE_INSTALLATION_BOUNDS',installation.placementId,'받침대나 프레임 전체가 새 방 안에 들어오지 않아요. 먼저 설치 위치를 조절해 주세요.');
 for(const light of document.lights.filter(l=>same(l.roomId,roomId)))if(!inside(light.transform.position,d))fail('ROOM_ENVELOPE_LIGHT_BOUNDS',light.id,'자유 배치 조명이 새 방 밖으로 나가요. 조명을 먼저 옮기거나 부착할 표면을 선택해 주세요.');
 if(!validateStudioLightDetails(document).valid)fail('ROOM_ENVELOPE_LIGHT_BOUNDS',roomId,'조명 기구 전체와 비추는 방향이 새 방에 맞지 않아요. 위치·부착 간격·방향을 확인해 주세요.');
 if(!validateStudioBenches(document).valid)fail('ROOM_ENVELOPE_FURNITURE_BOUNDS',roomId,'벤치 전체가 새 방 안에 들어오지 않아요. 벤치를 먼저 옮겨 주세요.');
 if(baseline)for(const room of document.rooms)assertDoorPairs(document,room.id,baseline);else assertDoorPairs(document,roomId);
}
/** Strict default remains unchanged for normal Studio and structural producers. */
export function assertRoomEnvelopeContents(document:Exhibition,roomId:string){assertRoomEnvelopeContentsCore(document,roomId);}
/** Only a verified original may grandfather an identical inherited door pair. */
export function assertRoomEnvelopeContentsAgainstBaseline(document:Exhibition,baseline:Exhibition,roomId:string){assertRoomEnvelopeContentsCore(document,roomId,baseline);}
function doorCorners(document:Exhibition,opening:Exhibition['openings'][number]){
 const wall=document.surfaces.find(s=>same(s.id,opening.surfaceId));if(!wall)throw Error('door surface');const room=roomFor(document,wall.roomId);
 return ([-1,1] as const).flatMap(x=>([-1,1] as const).map(y=>artifactPoint([opening.offset[0]+x*opening.dimensions.width/2,opening.offset[1]+y*opening.dimensions.height/2,0],wall.transform,room.transform)));
}
function unchangedOriginalDoorPair(document:Exhibition,baseline:Exhibition,door:Exhibition['openings'][number],pair:Exhibition['openings'][number]){
 const footprint=(source:Exhibition,id:string)=>{
  const opening=source.openings.find(v=>same(v.id,id));if(!opening)return;
  const wall=source.surfaces.find(v=>same(v.id,opening.surfaceId));if(!wall)return;
  const room=source.rooms.find(v=>same(v.id,wall.roomId));if(!room)return;
  return {opening,wall:{id:wall.id,roomId:wall.roomId,type:wall.type,dimensions:wall.dimensions,transform:wall.transform},room:{id:room.id,dimensions:room.dimensions,transform:room.transform}};
 };
 const oldDoor=baseline.openings.find(v=>same(v.id,door.id)),oldPair=baseline.openings.find(v=>same(v.id,pair.id));
 if(!oldDoor||!oldPair||oldDoor.type!=='door'||oldPair.type!=='door'||!oldDoor.connectsToOpeningId||!oldPair.connectsToOpeningId||!same(oldDoor.connectsToOpeningId,oldPair.id)||!same(oldPair.connectsToOpeningId,oldDoor.id))return false;
 const a=footprint(document,door.id),b=footprint(document,pair.id),oldA=footprint(baseline,door.id),oldB=footprint(baseline,pair.id);
 return !!a&&!!b&&!!oldA&&!!oldB&&freezeCanonical(a)===freezeCanonical(oldA)&&freezeCanonical(b)===freezeCanonical(oldB);
}
function assertDoorPairs(document:Exhibition,roomId:string,baseline?:Exhibition){
 for(const door of document.openings.filter(o=>o.type==='door'&&o.connectsToOpeningId&&document.surfaces.some(s=>same(s.id,o.surfaceId)&&same(s.roomId,roomId)))){
  const pair=document.openings.find(o=>same(o.id,door.connectsToOpeningId!));
  if(!pair||pair.type!=='door'||!pair.connectsToOpeningId||!same(pair.connectsToOpeningId,door.id))fail('ROOM_ENVELOPE_CONNECTED_DOOR',door.id,'연결된 두 문이 어긋나게 돼요. 연결을 해제하거나 두 방의 연결 구조를 함께 조절해 주세요.');
  if(baseline&&unchangedOriginalDoorPair(document,baseline,door,pair))continue;
  if(doorCorners(document,door).some(p=>!doorCorners(document,pair).some(q=>Math.hypot(...sub(p,q))<=tolerance)))fail('ROOM_ENVELOPE_CONNECTED_DOOR',door.id,'연결된 두 문이 어긋나게 돼요. 연결을 해제하거나 두 방의 연결 구조를 함께 조절해 주세요.');
 }
}
function assertNoLostWallAlignment(before:Exhibition,after:Exhibition,roomId:string){
 const oldWalls=before.surfaces.filter(s=>same(s.roomId,roomId)&&s.type==='wall');
 for(const p of before.placements.filter(p=>same(p.roomId,roomId))){
  const art=before.artworks.find(a=>same(a.revisionId,p.artworkRevisionId));if(art?.artworkType!=='image')continue;
  const corners=artifactCorners(art.dimensions,[art.transform,p.transform]);
  const aligned=oldWalls.filter(w=>{const local=corners.map(v=>inverse(v,w.transform)),b=artifactBounds(local);return close(Math.abs(p.transform.rotation.reduce((sum,v,i)=>sum+v*w.transform.rotation[i]!,0)),1)&&close(b.min[2],.002)&&b.min[0]>=-w.dimensions.width/2-tolerance&&b.max[0]<=w.dimensions.width/2+tolerance&&b.min[1]>=-w.dimensions.height/2-tolerance&&b.max[1]<=w.dimensions.height/2+tolerance;});
  if(aligned.some(w=>{const next=after.surfaces.find(s=>same(s.id,w.id))!;return Math.abs(dot(sub(next.transform.position,w.transform.position),unit(direction(w.transform,[0,0,1]))))>tolerance;}))fail('ROOM_ENVELOPE_ARTWORK_ALIGNMENT',p.id,'이 벽을 움직이면 벽에 맞춘 작품이 떨어져요. 작품을 먼저 옮긴 뒤 방 크기를 바꿔 주세요.');
 }
}
/** One explicit transaction; no change to legacy set-room or inference from a light's height. */
export function resizeRoomEnvelope(document:Exhibition,roomId:string,dimensions:Room['dimensions']):Exhibition {
 try{
 const source=roomFor(document,roomId);assertRoom(source);assertAttachments(document);
 const next=structuredClone(document),room=roomFor(next,roomId);room.dimensions=structuredClone(dimensions);assertRoom(room);
 const envelope=new Map<Side,Surface>();
 for(const surface of document.surfaces.filter(s=>same(s.roomId,roomId))){let kind:Side|undefined;try{kind=side(surface,source);}catch{fail('ROOM_ENVELOPE_UNSUPPORTED',surface.id,'회전·크기 표현을 지원하지 않는 구조 표면이에요. 원본을 유지합니다.');}if(kind){if(envelope.has(kind))fail('ROOM_ENVELOPE_AMBIGUOUS',surface.id,'같은 바깥 면이 겹쳐 있어요. 방의 구조 표면을 명확하게 선택해 주세요.');envelope.set(kind,surface);}}
 if(envelope.size!==6)fail('ROOM_ENVELOPE_INCOMPLETE',roomId,'네 벽·바닥·천장이 하나씩 있는 직사각형 방을 선택해 주세요. 누락된 천장은 먼저 추가할 수 있어요.');
 for(const [kind,surface]of envelope){const i=next.surfaces.findIndex(s=>same(s.id,surface.id));next.surfaces[i]=movedSurface(surface,kind,dimensions);if(surface.type==='wall')for(const opening of next.openings.filter(o=>same(o.surfaceId,surface.id)))opening.offset[1]+=(source.dimensions.height-dimensions.height)/2;}
 for(const binding of lightAttachmentsFor(next)){const surface=next.surfaces.find(s=>same(s.id,binding.surfaceId));if(surface&&same(surface.roomId,roomId)){const light=next.lights.find(l=>same(l.id,binding.lightId))!;light.transform=lightAttachmentPose(surface,binding);}}
 assertNoLostWallAlignment(document,next,roomId);assertRoomEnvelopeContents(next,roomId);assertAttachments(next);return next;
 }catch(error){if(error instanceof RoomEnvelopeError)throw error;fail('ROOM_ENVELOPE_GEOMETRY',roomId,'변환된 구조나 물체가 지원 범위를 벗어나요. 방과 배치의 위치·회전·크기를 확인해 주세요.');}
}
export function completeRoomCeiling(document:Exhibition,roomId:string,verifiedBaseline?:Exhibition):Exhibition {
 const room=roomFor(document,roomId);assertRoom(room);const ceilings=document.surfaces.filter(s=>same(s.roomId,roomId)&&s.type==='ceiling');
 if(ceilings.length){if(ceilings.length===1&&side(ceilings[0]!,room)==='ceiling')return structuredClone(document);fail('ROOM_ENVELOPE_AMBIGUOUS',roomId,'기존 천장의 형태나 중복을 먼저 확인해 주세요. 자동으로 덮어쓰지 않아요.');}
 const next=structuredClone(document),q=Math.SQRT1_2;next.surfaces.push({id:crypto.randomUUID(),roomId:room.id,type:'ceiling',dimensions:{width:room.dimensions.width,height:room.dimensions.depth},transform:{position:[0,room.dimensions.height,0],rotation:[q,0,0,q],scale:[1,1,1]}});
 if(verifiedBaseline)assertRoomEnvelopeContentsAgainstBaseline(next,verifiedBaseline,roomId);else assertRoomEnvelopeContents(next,roomId);return next;
}
