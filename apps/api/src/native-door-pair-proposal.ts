// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {
  alignedDoorPair, assertRoomEnvelopeContentsAgainstBaseline, TEMPLATE_NAMESPACE,
  validateWorkspaceFurnishings,
} from '@exhibitos/studio-contract';

type Opening = Exhibition['openings'][number];
type DoorSide = Pick<Opening, 'surfaceId'|'offset'>;
export type NativeDoorPairCommand = {
  type: 'add-connected-door-pair';
  dimensions: Opening['dimensions'];
  first: DoorSide;
  second: DoorSide;
};
export const NATIVE_DOOR_PAIR_PROFILE = 'saved-head-rectangular-door-pair-v1';

/** One prospective geometry delta. No opening ID, attachment or existing
 * candidate field is supplied by the caller. The ordinary Save owns CAS. */
export function nativeDoorPairProposal(base: Exhibition, command: NativeDoorPairCommand,
  openingIds: [string,string]) {
  const next = structuredClone(base);
  const openings = [command.first,command.second].map((side,index):Opening => {
    const wall = base.surfaces.find(row => row.id.toLowerCase() === side.surfaceId.toLowerCase());
    if (wall?.type !== 'wall') throw Error('DOOR_PAIR_REFERENCE');
    const overlaps = base.openings.some(opening => opening.surfaceId.toLowerCase() === wall.id.toLowerCase() &&
      2 * Math.abs(opening.offset[0] - side.offset[0]) < opening.dimensions.width + command.dimensions.width &&
      2 * Math.abs(opening.offset[1] - side.offset[1]) < opening.dimensions.height + command.dimensions.height);
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
