// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import type {WorkspaceFrameAttachment} from '@exhibitos/studio-contract';
import type {Draft} from './studio.ts';
/** One attachment change only; all other document content and room visuals are retained. */
export function ordinaryFrameDelta(before:Draft,after:Draft,namespace:string):boolean {
 const a=structuredClone(before),b=structuredClone(after);
 const extract=(draft:Draft)=>{
  const extensions=draft.candidate.extensions??{},raw=extensions[namespace] as unknown as {version:number;furnishings:{id:string;kind:string}[];placements:unknown[];frameAttachments?:WorkspaceFrameAttachment[];openingAttachments?:unknown[]}|undefined;
  if(raw&&(!Array.isArray(raw.furnishings)||!Array.isArray(raw.placements)||![1,2,3,4,5,6,7,9,10].includes(raw.version)||(raw.version>=4&&!Array.isArray(raw.frameAttachments))||(raw.version>=6&&!Array.isArray(raw.openingAttachments))))throw Error('FRAME_INVALID');
  const result={version:raw?.version,rows:raw?.frameAttachments??[],base:raw?{furnishings:raw.furnishings.filter(item=>item.kind!=='artwork-frame'),placements:raw.placements,openingAttachments:raw.openingAttachments??[]}:undefined};
  if(draft.candidate.extensions){delete draft.candidate.extensions[namespace];if(!Object.keys(draft.candidate.extensions).length)delete draft.candidate.extensions;}
  return result;
 };
 try{
  const left=extract(a),right=extract(b);a.editVersion=b.editVersion;a.updatedAt=b.updatedAt;
  const fitTransition=[left.version,right.version].some(version=>version===7||version===9||version===10);
  if(right.version!==undefined&&![4,5,6,7,9,10].includes(right.version)||left.version===5&&right.version===4||!fitTransition&&(left.version===6)!==(right.version===6)||!isDeepStrictEqual(a,b)||!isDeepStrictEqual(left.base??{furnishings:[],placements:[],openingAttachments:[]},right.base??{furnishings:[],placements:[],openingAttachments:[]}))return false;
  for(const old of left.rows){const next=right.rows.find(row=>row.placementId===old.placementId);
   if(old.imageFit&&next&&!next.imageFit&&['artworkRevisionId','assetId','furnishingId','furnishingVersion','modelSha256'].every(key=>old[key as keyof WorkspaceFrameAttachment]===next[key as keyof WorkspaceFrameAttachment]))return false;
  }
  const keys=new Set([...left.rows.map(row=>row.placementId),...right.rows.map(row=>row.placementId)]);let changes=0;
  for(const key of keys)if(!isDeepStrictEqual(left.rows.filter(row=>row.placementId===key),right.rows.filter(row=>row.placementId===key)))changes++;
  return changes===1;
 }catch{return false;}
}
