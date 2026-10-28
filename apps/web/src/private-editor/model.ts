// SPDX-License-Identifier: AGPL-3.0-or-later
import {freezeCanonical,presentationFor,spaceStillFor} from '@exhibitos/studio-contract';
import type {Exhibition} from '@exhibitos/spec';
import type {PublicPublication} from '../publication-client';
import {newDraft} from '../drafts/example';
import {applyGeometryCommand,createGeometryState,newRoom,whiteCubeSurfaces} from '../geometry/model';
import {alignPlacement,newPlacement,newLight} from '../placement/model';

export interface PrivateSeed {source:PublicPublication;indexSha256:string;storeName:string}
/** The verified loader remains the sole source authority; edited metadata never grants asset access. */
export function privateSeed(source:PublicPublication,indexSha256:string):PrivateSeed {
 if(!source.local||source.publication.status!=='published'||! /^[a-f0-9]{64}$/.test(indexSha256)||! /^[a-f0-9]{64}$/.test(source.publication.revisionSha256))throw Error('편집 원본의 검증 정보를 확인할 수 없어요.');
 const still=spaceStillFor(source.exhibition);if([...source.exhibition.artworks,...source.exhibition.mediaAssets,...(still?[still]:[])].some(a=>a.rights.licenseId!=='CC0-1.0'||!a.rights.permissions.display||!a.rights.permissions.export))throw Error('편집 사본에 사용할 수 있는 공개 자산이 아니에요.');
 return {source,indexSha256,storeName:`exhibitos-private-editor-v1-${source.publication.id}-${source.publication.revisionSha256}-${indexSha256}`};
}
export function checkPrivateCandidate(seed:PrivateSeed,candidate:Exhibition){
 if(freezeCanonical(candidate.artworks)!==freezeCanonical(seed.source.exhibition.artworks)||freezeCanonical(candidate.mediaAssets)!==freezeCanonical(seed.source.exhibition.mediaAssets)||freezeCanonical(spaceStillFor(candidate)??null)!==freezeCanonical(spaceStillFor(seed.source.exhibition)??null))throw Error('원본 작품·파일·권리 정보는 이 체험에서 변경할 수 없어요.');
 createGeometryState(candidate);
}
/** Add one complete room to a private clone; keep every original room, reference and unknown extension. */
export function starterDraft(seed:PrivateSeed){
 const draft=newDraft('나의 작은 전시실'),doc=structuredClone(seed.source.exhibition);
 doc.id=draft.exhibitionId;doc.revisionId=crypto.randomUUID();doc.revision=1;doc.createdAt=draft.createdAt;
 const right=Math.max(0,...doc.rooms.map(r=>r.transform.position[0]+Math.hypot(r.dimensions.width,r.dimensions.depth)/2));
 const room=newRoom('나의 작은 전시실',{width:8,height:3.2,depth:6},{position:[Math.ceil(right)+8,0,0],rotation:[0,0,0,1],scale:[1,1,1]});
 let state=createGeometryState(doc);state=applyGeometryCommand(state,{type:'add-room',room});
 for(const surface of whiteCubeSurfaces(room))state=applyGeometryCommand(state,{type:'add-surface',surface});
 const wall=state.present.surfaces.find(s=>s.roomId===room.id&&s.type==='wall')!;
 const works=doc.artworks.filter(a=>a.artworkType==='image').slice(0,3);
 for(const [i,art]of works.entries()){
  const placement=newPlacement(art,room.id);state=applyGeometryCommand(state,{type:'add-placement',placement:alignPlacement(state.present,placement,wall,[(i-(works.length-1)/2)*2.2,-.1],0)});
 }
 const light=newLight(room.id);light.transform.position=[0,2.7,0];light.intensity=140;
 state=applyGeometryCommand(state,{type:'add-light',light});
 state=applyGeometryCommand(state,{type:'set-presentation',presentation:{...presentationFor(state.present),startCamera:{roomId:room.id,position:[0,1.65,1.9],target:[0,1.5,-3],fov:60}}});
 // First selection and initial scene are the completed room; original source rooms remain recoverable.
 const candidate=state.present;candidate.rooms=[candidate.rooms.find(r=>r.id===room.id)!,...candidate.rooms.filter(r=>r.id!==room.id)];
 candidate.title='나의 작은 전시실';draft.candidate=candidate;checkPrivateCandidate(seed,candidate);
 return draft;
}
export function starterRoom(document:Exhibition){
 const camera=presentationFor(document).startCamera;
 return document.rooms.find(r=>r.id===camera?.roomId)??document.rooms[0]!;
}
