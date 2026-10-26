// SPDX-License-Identifier: AGPL-3.0-or-later
import {entranceFor,type StudioPlaque} from '@exhibitos/studio-contract';
import type {Exhibition} from '@exhibitos/spec';
/** Display text is derived per admitted scene; no second authored text store. */
export function plaqueContent(document:Exhibition,plaque:StudioPlaque){
 if(plaque.source.kind==='exhibition'){const entrance=entranceFor(document);return {title:document.title,summary:[entrance.artist,entrance.introduction].filter(Boolean).join('\n')};}
 if(plaque.source.kind==='room')return {title:document.rooms.find(r=>r.id.toLowerCase()===plaque.roomId.toLowerCase())!.name,summary:'공간 안내'};
 const placement=document.placements.find(p=>p.id.toLowerCase()===(plaque.source as {placementId:string}).placementId.toLowerCase())!;
 const artwork=document.artworks.find(a=>a.revisionId.toLowerCase()===placement.artworkRevisionId.toLowerCase())!;
 return {title:artwork.metadata.title,summary:artwork.metadata.artist};
}
