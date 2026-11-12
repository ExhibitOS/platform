// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {isDeepStrictEqual} from 'node:util';
import {applyLightObjectCommand,assertRoomEnvelopeContentsAgainstBaseline,ensureRoomBaseLight,lightDetailsFor,reflowRoomBaseLight,resizeRoomEnvelope,roomBaseLight,TEMPLATE_NAMESPACE} from '@exhibitos/studio-contract';
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
/** Narrow bounded-save replay. Complete candidate validation, saved-head CAS,
 * ownership and material/furnishing custody remain in Studio's existing path. */
export function ordinaryRoomBaseLightDelta<T extends {candidate:Exhibition}>(before:T,after:T):boolean {
 const a=structuredClone(before),b=structuredClone(after);
 // Only ordinary draft edit bookkeeping may accompany this one operation.
 for(const key of ['editVersion','updatedAt'])if(Object.hasOwn(b,key))(a as Record<string,unknown>)[key]=(b as Record<string,unknown>)[key];
 const source=before.candidate,target=after.candidate;
 const matches=(candidate:Exhibition)=>{
  const template=candidate.extensions?.[TEMPLATE_NAMESPACE];if(template&&typeof template==='object'&&!Array.isArray(template))(template as unknown as {modified:boolean}).modified=true;
  return isDeepStrictEqual({...a,candidate},b);
 };
 try{
  const added=target.rooms.filter(r=>!source.rooms.some(v=>same(v.id,r.id))),removed=source.rooms.filter(r=>!target.rooms.some(v=>same(v.id,r.id)));
  if(added.length===1&&!removed.length){
   const room=added[0]!,base=roomBaseLight(target,room.id);if(!base)return false;
   const candidate=structuredClone(source);candidate.rooms.push(structuredClone(room));return matches(ensureRoomBaseLight(candidate,room.id,base.id));
  }
  if(removed.length===1&&!added.length){
   let candidate=structuredClone(source);const base=roomBaseLight(source,removed[0]!.id);
   if(base)candidate=applyLightObjectCommand(candidate,{type:'remove-light-object',lightId:base.id},{verifiedBaseline:source}).candidate;
   candidate.rooms=candidate.rooms.filter(r=>!same(r.id,removed[0]!.id));return matches(candidate);
  }
  if(added.length||removed.length)return false;
  const changedRooms=source.rooms.filter((r,i)=>!isDeepStrictEqual(r,target.rooms[i]));
  if(changedRooms.length===1){
   const room=changedRooms[0]!,nextRoom=target.rooms.find(r=>same(r.id,room.id));if(!nextRoom)return false;
   let candidate=structuredClone(source);candidate.rooms[candidate.rooms.findIndex(r=>same(r.id,room.id))]=structuredClone(nextRoom);
   candidate=reflowRoomBaseLight(candidate,room.id);
   if(matches(candidate)){
    if(!isDeepStrictEqual(room.dimensions,nextRoom.dimensions))assertRoomEnvelopeContentsAgainstBaseline(candidate,source,room.id);
    return true;
   }
   // The existing six-surface transaction is the sole envelope resize path.
   candidate=resizeRoomEnvelope(source,room.id,nextRoom.dimensions);
   candidate.rooms[candidate.rooms.findIndex(r=>same(r.id,room.id))]=structuredClone(nextRoom);
   return matches(candidate);
  }
  if(changedRooms.length)return false;
  for(const room of source.rooms){
   const old=roomBaseLight(source,room.id),next=roomBaseLight(target,room.id);
   if(!old&&next){if(matches(ensureRoomBaseLight(source,room.id,next.id)))return true;continue;}
   if(!old)continue;
   if(!next){if(matches(applyLightObjectCommand(source,{type:'remove-light-object',lightId:old.id},{verifiedBaseline:source}).candidate))return true;continue;}
   if(!same(next.id,old.id))continue;
   const settings=lightDetailsFor(target).find(v=>same(v.lightId,next.id))!;
   for(const placement of ['auto','manual'] as const)if(settings.basePlacement===placement&&matches(applyLightObjectCommand(source,{type:'set-room-base-light-placement',lightId:old.id,basePlacement:placement},{verifiedBaseline:source}).candidate))return true;
   const {id:_,...light}=next,{lightId:__,...details}=settings;void _;void __;
   const previous=lightDetailsFor(source).find(v=>same(v.lightId,old.id));
   if(previous?.basePlacement!==undefined)details.basePlacement=previous.basePlacement;else delete details.basePlacement;
   if(matches(applyLightObjectCommand(source,{type:'set-light-object',lightId:old.id,light,settings:details},{verifiedBaseline:source}).candidate))return true;
  }
 }catch{return false;}
 return false;
}
/** Undo is an exact previous stored snapshot, never a fabricated downgrade of
 * known placement intent. Reverse replay still limits it to this one unit. */
export async function ordinaryRoomBaseLightEdit<T extends {candidate:Exhibition}>(client:import('pg').PoolClient,scope:{tenantId:string;exhibitionId:string;revision:number},before:T,after:T):Promise<boolean> {
 if(ordinaryRoomBaseLightDelta(before,after))return true;
 if(!ordinaryRoomBaseLightDelta(after,before))return false;
 const target=structuredClone(after) as Record<string,unknown>;delete target.editVersion;delete target.updatedAt;
 const result=await client.query("SELECT snapshot FROM exhibition_revisions WHERE tenant_id=$1 AND exhibition_id=$2 AND revision<$3 AND (snapshot - 'editVersion' - 'updatedAt')=$4::jsonb LIMIT 1",[scope.tenantId,scope.exhibitionId,scope.revision,target]);
 if(result.rowCount!==1)return false;
 const snapshot=structuredClone(result.rows[0]?.snapshot) as Record<string,unknown>|undefined;if(!snapshot)return false;delete snapshot.editVersion;delete snapshot.updatedAt;
 return isDeepStrictEqual(snapshot,target);
}
