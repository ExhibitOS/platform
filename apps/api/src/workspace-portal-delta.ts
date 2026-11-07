// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import type {Draft} from './studio.ts';

/** Authorize all portal state changes, including a direct final removal. */
export function portalStateChanged(before:Draft,after:Draft,namespace:string):boolean{
 const state=(draft:Draft)=>{
  const raw=draft.candidate.extensions?.[namespace] as unknown as {furnishings?:{kind?:string}[];openingAttachments?:unknown[]}|undefined;
  return {descriptors:Array.isArray(raw?.furnishings)?raw.furnishings.filter(item=>item?.kind==='portal-finish'):[],attachments:raw?.openingAttachments??[]};
 };
 return !isDeepStrictEqual(state(before),state(after));
}

/** One opening visual attachment changes; all other draft data stays fixed.
 * This only bridges the currently used v5 shape and v6, not older profiles. */
export function ordinaryPortalDelta(before:Draft,after:Draft,namespace:string):boolean{
 const leftDraft=structuredClone(before),rightDraft=structuredClone(after);
 const extract=(draft:Draft)=>{
  const extensions=draft.candidate.extensions??{},raw=extensions[namespace] as unknown as {version:number;furnishings:{id:string;kind:string}[];placements:unknown[];frameAttachments?:unknown[];openingAttachments?:{openingId:string}[]}|undefined;
  if(raw&&(![5,6].includes(raw.version)||!Array.isArray(raw.furnishings)||!Array.isArray(raw.placements)||!Array.isArray(raw.frameAttachments)||raw.version===6&&!Array.isArray(raw.openingAttachments)))throw Error('PORTAL_INVALID');
  const result={version:raw?.version,rows:raw?.openingAttachments??[],base:raw?{furnishings:raw.furnishings.filter(item=>item.kind!=='portal-finish'),placements:raw.placements,frameAttachments:raw.frameAttachments}:undefined};
  if(draft.candidate.extensions){delete draft.candidate.extensions[namespace];if(!Object.keys(draft.candidate.extensions).length)delete draft.candidate.extensions;}return result;
 };
 try{
  const a=extract(leftDraft),b=extract(rightDraft);leftDraft.editVersion=rightDraft.editVersion;leftDraft.updatedAt=rightDraft.updatedAt;
  if(!isDeepStrictEqual(leftDraft,rightDraft)||!isDeepStrictEqual(a.base??{furnishings:[],placements:[],frameAttachments:[]},b.base??{furnishings:[],placements:[],frameAttachments:[]}))return false;
  const keys=new Set([...a.rows.map(row=>row.openingId),...b.rows.map(row=>row.openingId)]);let changes=0;
  for(const key of keys)if(!isDeepStrictEqual(a.rows.filter(row=>row.openingId===key),b.rows.filter(row=>row.openingId===key)))changes++;
  return changes===1&&(a.version===6||b.version===6);
 }catch{return false;}
}
