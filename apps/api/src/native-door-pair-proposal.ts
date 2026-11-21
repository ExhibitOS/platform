// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {isDeepStrictEqual} from 'node:util';
import {
  alignedDoorPair, assertRoomEnvelopeContentsAgainstBaseline, DoorPairEditError, editReciprocalDoorPair,
  openingsOverlap, reciprocalDoorPair, TEMPLATE_NAMESPACE, validateWorkspaceFurnishings,
  WORKSPACE_FURNISHING_NAMESPACE, type WorkspaceFurnishings,
} from '@exhibitos/studio-contract';
import type {Draft} from './studio.ts';

type Opening = Exhibition['openings'][number];
type DoorSide = Pick<Opening, 'surfaceId'|'offset'>;
export type NativeDoorPairCommand = {
  type: 'add-connected-door-pair';
  dimensions: Opening['dimensions'];
  first: DoorSide;
  second: DoorSide;
};
export const NATIVE_DOOR_PAIR_PROFILE = 'saved-head-rectangular-door-pair-v1';
export const NATIVE_DOOR_PAIR_EDIT_PROFILE = 'saved-head-reciprocal-door-edit-v1';
export type NativeDoorPairEditCommand = {
  type: 'edit-connected-door-pair';
  openingId: string;
  dimensions?: Opening['dimensions'];
  frame?: {furnishingId:string;furnishingVersion:1}|null;
};

/** One prospective geometry delta. No opening ID, attachment or existing
 * candidate field is supplied by the caller. The ordinary Save owns CAS. */
export function nativeDoorPairProposal(base: Exhibition, command: NativeDoorPairCommand,
  openingIds: [string,string]) {
  const next = structuredClone(base);
  const openings = [command.first,command.second].map((side,index):Opening => {
    const wall = base.surfaces.find(row => row.id.toLowerCase() === side.surfaceId.toLowerCase());
    if (wall?.type !== 'wall') throw Error('DOOR_PAIR_REFERENCE');
    const overlaps = base.openings.some(opening => opening.surfaceId.toLowerCase() === wall.id.toLowerCase() &&
      openingsOverlap(opening,{offset:side.offset,dimensions:command.dimensions}));
    if (overlaps) throw Error('DOOR_PAIR_OPENING_OVERLAP');
    return {id:openingIds[index]!,surfaceId:wall.id,type:'door',
      dimensions:structuredClone(command.dimensions),offset:structuredClone(side.offset)};
  });
  next.openings.push(...openings);
  alignedDoorPair(next,...openingIds);
  openings[0]!.connectsToOpeningId = openingIds[1];
  openings[1]!.connectsToOpeningId = openingIds[0];
  for (const opening of openings) {
    const room = base.surfaces.find(row => row.id === opening.surfaceId)!.roomId;
    assertRoomEnvelopeContentsAgainstBaseline(next,base,room);
  }
  if (!validateWorkspaceFurnishings(next).valid) throw Error('DOOR_PAIR_FURNISHING');
  const template = next.extensions?.[TEMPLATE_NAMESPACE] as {modified:boolean}|undefined;
  if (template) template.modified = true;
  return {candidate:next,openingIds};
}

/** Reconstruct the one pair transition before admitting a dirty ordinary viewport. */
export function ordinaryDoorPairEditDelta(before:Draft,after:Draft):{frameChanged:boolean}|undefined {
 const source=before.candidate,target=after.candidate;
 const workspace=(scene:Exhibition)=>scene.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings|undefined;
 const prior=workspace(source),next=workspace(target);
 if(!Array.isArray(target.openings)||target.openings.some(row=>typeof row?.id!=='string')||
    (next&&!Array.isArray(next.furnishings))||
    (next?.openingAttachments!==undefined&&(!Array.isArray(next.openingAttachments)||
     next.openingAttachments.some(row=>typeof row?.openingId!=='string'))))return;
 const ids=new Set<string>();
 for(const opening of target.openings){
  const saved=source.openings.find(row=>row.id===opening.id);
  if(saved?.connectsToOpeningId&&(!isDeepStrictEqual(saved.dimensions,opening.dimensions)||!isDeepStrictEqual(saved.offset,opening.offset)))ids.add(opening.id);
 }
 const oldFrames=prior?.openingAttachments??[],newFrames=next?.openingAttachments??[];
 for(const row of oldFrames)if(!newFrames.some(nextRow=>isDeepStrictEqual(row,nextRow)))ids.add(row.openingId);
 for(const row of newFrames)if(!oldFrames.some(old=>isDeepStrictEqual(row,old)))ids.add(row.openingId);
 if(!ids.size)return;
 const [selected]=ids;
 if(!selected)return;
 try{
  const pair=reciprocalDoorPair(source,selected);
  const inPair=(id:string)=>pair.some(row=>row.id===id);
  if([...ids].some(id=>!inPair(id)))return;
  const newOpening=target.openings.find(row=>row.id===pair[0].id);
  if(!newOpening)return;
  const changedFrame=!isDeepStrictEqual(oldFrames.filter(row=>inPair(row.openingId)),newFrames.filter(row=>inPair(row.openingId)));
  const attachment=newFrames.find(row=>inPair(row.openingId));
  const frame=changedFrame?(attachment?next?.furnishings.find(row=>row?.id===attachment.furnishingId&&row?.version===attachment.furnishingVersion):null):undefined;
  if(changedFrame&&frame===undefined)return;
  const size=isDeepStrictEqual(pair[0].dimensions,newOpening.dimensions)?undefined:newOpening.dimensions;
  const {candidate}=editReciprocalDoorPair(source,selected,size,frame);
  const expected={...before,editVersion:after.editVersion,updatedAt:after.updatedAt,candidate};
  if(isDeepStrictEqual(expected,after))return {frameChanged:changedFrame};
 }catch(error){if(!(error instanceof DoorPairEditError))throw error;}
}
