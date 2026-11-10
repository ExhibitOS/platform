// SPDX-License-Identifier: AGPL-3.0-or-later
import {artworkPlaqueCaptionFor,creationYearFor,entranceFor,roomPlaqueIntroductionFor,type StudioPlaque} from '@exhibitos/studio-contract';
import type {Exhibition} from '@exhibitos/spec';
/** Display text is derived per admitted scene; no second authored text store. */
export function plaqueContent(document:Exhibition,plaque:StudioPlaque){
 if(plaque.source.kind==='exhibition'){const entrance=entranceFor(document);return {title:document.title,summary:[entrance.artist,entrance.introduction].filter(Boolean).join('\n')};}
 if(plaque.source.kind==='room')return {title:document.rooms.find(r=>r.id.toLowerCase()===plaque.roomId.toLowerCase())!.name,summary:'공간 안내'};
 const artwork=plaqueArtwork(document,plaque.source.placementId);
 return {title:artwork.metadata.title,summary:artwork.metadata.artist};
}

function plaqueArtwork(document:Exhibition,placementId:string){
 const placement=document.placements.find(p=>p.id.toLowerCase()===placementId.toLowerCase())!;
 return document.artworks.find(a=>a.revisionId.toLowerCase()===placement.artworkRevisionId.toLowerCase())!;
}

/** Physical signs use concise authored display text. The existing reading
 * controls keep their independent exhibition, room and artwork details. */
export function plaqueFaceContent(document:Exhibition,plaque:StudioPlaque,locale=globalThis.window?.navigator.language||'ko'){
 const content=plaqueContent(document,plaque);
 if(plaque.source.kind==='exhibition'){
  const translations=entranceFor(document).design?.translations??[];
  const korean=translations.find(t=>t.locale.toLowerCase()==='ko')??translations.find(t=>t.locale.toLowerCase().startsWith('ko-'));
  return {title:korean?.title?.trim()||content.title,summary:''};
 }
 if(plaque.source.kind==='room')return {title:content.title,summary:roomPlaqueIntroductionFor(document,plaque.roomId,'ko')??''};
 const caption=artworkPlaqueCaptionFor(plaque,locale);
 const year=creationYearFor(plaqueArtwork(document,plaque.source.placementId));
 const korean=artworkPlaqueCaptionFor(plaque,'ko');
 const translations=plaque.artworkCaption?.translations;
 const medium=caption?.medium??korean?.medium??translations?.find(row=>row.medium)?.medium;
 const dimensions=caption?.dimensions??korean?.dimensions??translations?.find(row=>row.dimensions)?.dimensions;
 const authoredDate=medium||dimensions?korean?.date??translations?.find(row=>row.medium||row.dimensions)?.date:undefined;
 const date=caption?.date??authoredDate??(year===undefined?undefined:String(year));
 const attribution=[caption?.artist??content.summary,date].filter(Boolean).join(' · ');
 return {title:content.title,summary:[attribution,medium,dimensions].filter(Boolean).join('\n')};
}
