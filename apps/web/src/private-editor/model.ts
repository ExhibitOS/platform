// SPDX-License-Identifier: AGPL-3.0-or-later
import {freezeCanonical,presentationFor,spaceStillFor,validateFurnishings} from '@exhibitos/studio-contract';
import type {Exhibition} from '@exhibitos/spec';
import type {PublicPublication} from '../publication-client';
import {newDraft} from '../drafts/example';
import {applyGeometryCommand,createGeometryState,newRoom,whiteCubeSurfaces} from '../geometry/model';
import type {Draft} from '../drafts/store';

export interface PrivateSeed {source:PublicPublication;indexSha256:string;storeName:string}
/** The verified loader remains the sole source authority; edited metadata never grants asset access. */
export function privateSeed(source:PublicPublication,indexSha256:string):PrivateSeed {
 if(!source.local||source.publication.status!=='published'||! /^[a-f0-9]{64}$/.test(indexSha256)||! /^[a-f0-9]{64}$/.test(source.publication.revisionSha256))throw Error('편집 원본의 검증 정보를 확인할 수 없어요.');
 const still=spaceStillFor(source.exhibition);if([...source.exhibition.artworks,...source.exhibition.mediaAssets,...(still?[still]:[])].some(a=>a.rights.licenseId!=='CC0-1.0'||!a.rights.permissions.display||!a.rights.permissions.export))throw Error('편집 사본에 사용할 수 있는 공개 자산이 아니에요.');
 return {source,indexSha256,storeName:`exhibitos-private-editor-v1-${source.publication.id}-${source.publication.revisionSha256}-${indexSha256}`};
}
export function checkPrivateCandidate(seed:PrivateSeed,candidate:Exhibition){
 if(freezeCanonical(candidate.artworks)!==freezeCanonical(seed.source.exhibition.artworks)||freezeCanonical(candidate.mediaAssets)!==freezeCanonical(seed.source.exhibition.mediaAssets)||freezeCanonical(spaceStillFor(candidate)??null)!==freezeCanonical(spaceStillFor(seed.source.exhibition)??null))throw Error('원본 작품·파일·권리 정보는 이 체험에서 변경할 수 없어요.');
 if(!validateFurnishings(candidate).valid)throw Error('가구 참조를 확인할 수 없어요.');
 createGeometryState(candidate);
}
/** Clone the verified exhibition in place; publication geometry and camera stay intact. */
export function resetPrivateDraft(seed:PrivateSeed,current:Draft):Draft {
 const candidate=structuredClone(seed.source.exhibition);
 candidate.id=current.exhibitionId;candidate.revisionId=current.candidate.revisionId;
 candidate.revision=current.candidate.revision;candidate.createdAt=current.candidate.createdAt;
 checkPrivateCandidate(seed,candidate);return {...current,candidate};
}
export function starterDraft(seed:PrivateSeed){return resetPrivateDraft(seed,newDraft(seed.source.exhibition.title));}

/** Explicitly add a complete empty room. A door connection is a separate existing command. */
export function addPrivateRoom(document:Exhibition){
 const right=Math.max(0,...document.rooms.map(room=>room.transform.position[0]+Math.hypot(room.dimensions.width,room.dimensions.depth)/2*Math.max(...room.transform.scale)));
 const room=newRoom('새 전시실',{width:8,height:3.2,depth:6},{position:[Math.ceil(right)+8,0,0],rotation:[0,0,0,1],scale:[1,1,1]});
 let state=applyGeometryCommand(createGeometryState(document),{type:'add-room',room});
 for(const surface of whiteCubeSurfaces(room))state=applyGeometryCommand(state,{type:'add-surface',surface});
 return {roomId:room.id,command:{type:'replace-architecture' as const,candidate:state.present}};
}
export function starterRoom(document:Exhibition){
 const camera=presentationFor(document).startCamera;
 return document.rooms.find(r=>r.id===camera?.roomId)??document.rooms[0]!;
}
