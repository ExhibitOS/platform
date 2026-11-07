// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import type {Draft} from './studio.ts';
/** One attachment change only; all other document content and room visuals are retained. */
export function ordinaryFrameDelta(before:Draft,after:Draft,namespace:string):boolean {
 const a=structuredClone(before),b=structuredClone(after);
 const extract=(draft:Draft)=>{
  const extensions=draft.candidate.extensions??{},raw=extensions[namespace] as unknown as {version:number;furnishings:{id:string;kind:string}[];placements:unknown[];frameAttachments?:{placementId:string}[];openingAttachments?:unknown[]}|undefined;
  if(raw&&(!Array.isArray(raw.furnishings)||!Array.isArray(raw.placements)||!Number.isInteger(raw.version)||raw.version<1||raw.version>6||(raw.version>=4&&!Array.isArray(raw.frameAttachments))||(raw.version===6&&!Array.isArray(raw.openingAttachments))))throw Error('FRAME_INVALID');
  const result={version:raw?.version,rows:raw?.frameAttachments??[],base:raw?{furnishings:raw.furnishings.filter(item=>item.kind!=='artwork-frame'),placements:raw.placements,openingAttachments:raw.openingAttachments??[]}:undefined};
  if(draft.candidate.extensions){delete draft.candidate.extensions[namespace];if(!Object.keys(draft.candidate.extensions).length)delete draft.candidate.extensions;}
  return result;
 };
 try{
  const left=extract(a),right=extract(b);a.editVersion=b.editVersion;a.updatedAt=b.updatedAt;
  if(right.version!==undefined&&right.version!==4&&right.version!==5&&right.version!==6||left.version===5&&right.version===4||left.version===6&&right.version!==6||right.version===6&&left.version!==6||!isDeepStrictEqual(a,b)||!isDeepStrictEqual(left.base??{furnishings:[],placements:[],openingAttachments:[]},right.base??{furnishings:[],placements:[],openingAttachments:[]}))return false;
  const keys=new Set([...left.rows.map(row=>row.placementId),...right.rows.map(row=>row.placementId)]);let changes=0;
  for(const key of keys)if(!isDeepStrictEqual(left.rows.filter(row=>row.placementId===key),right.rows.filter(row=>row.placementId===key)))changes++;
  return changes===1;
 }catch{return false;}
}
