// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {Exhibition} from '@exhibitos/spec';
import {
  freezeCanonical, FURNISHING_NAMESPACE, furnishingsFor, LIGHT_ATTACHMENT_NAMESPACE,
  LIGHT_DETAILS_NAMESPACE, lightAttachmentsFor, lightDetailsFor, resolveTrackSpotAiming,
  validateFurnishings, validateLightAttachments, validateStudioLightDetails,
  WORKSPACE_FURNISHING_NAMESPACE, type WorkspaceFurnishings,
} from '@exhibitos/studio-contract';
import {ApiError} from './api-error.ts';

const paintingRoom = '7681201b-c9ca-46ec-b382-4677fb78b273';
const paintingRail = '6d8c63f8-1001-4d59-8b5b-0cb80b992821';
const paintingRailModel = 'aca126489bf21adcc637e9a3c3bb805bb57f93111c3333a8fdefab9d371d1c42';
const articulatedHead = 'e6801dd02c4f11a1c48b5cf64d97b775924bab10ea7dd533e2904db3a4d6d3a3';
const oldArrowModel = 'b9957bf0931550477e636ea64619f755e1056b124fb5f730dd8b6035c99d275c';
const oldArrowLight = 'abb40218-43dc-4aa6-bf3f-04222598d4a4';
const oldArrowCommitment = 'b4f44aad2fdc6a81de9e8f0661980d70b9091b98fca3ab038f164119ea633c5f';
// Exact saved light, details and fixture rows, in the reviewed Painting order.
const paintingSpots = [
  ['cea116ed-d36b-44d1-b3d2-c9451b982b7d', '93818c47ce5c3904012f5a7e5c66532af94b74609bc85b169dcad3022f3d2fb2'],
  ['ee573097-28ba-490f-9392-ae7a5ac98467', '94bd8de574f535d7362d36485ee7b031c3c8f419d964eb90eedb109088671a93'],
  ['20a4e325-6e8b-40da-8765-ba84f94760a3', '5cb8300673acf1170e87686cbc1664daf48eee9c3ab14427efde04e692806944'],
  ['ecb4884d-423d-4ba0-997c-4791cd9b9ae2', 'e33fb1088163593c27bd5b1d5dd7f3ad0c677216b141bcfe2f0b6875d75f3da9'],
  ['b791642f-f817-4c56-a926-53d315d7ab55', '60a9eb0007e6d941e8c5993a194c5b8380f01c31fd5d02de7cb45729879559ff'],
  ['d21f5408-0f7f-4d72-9c04-3e5d37f7cacb', '3609096162060879dc691b2b5baf1d9cef51601dadeef1a6167683b40b9541e6'],
  ['c204bdf2-688e-4b42-94c1-de4099cbd2d5', '870e907c0ed7cc474d2e644388b2392a1e084dede398b876125088d79c5ed6cb'],
  ['78eec554-cbc6-4caa-964e-eb347ec8881a', '1ce80a85f7553641b605f2f7c40362002be85bb67f2caf8a502f31143682aeab'],
] as const;

const heldPaintingSpots = new Set([
  'ee573097-28ba-490f-9392-ae7a5ac98467', // Apples
  'b791642f-f817-4c56-a926-53d315d7ab55', // Sunrise
]);
const acceptedPaintingSpots = paintingSpots.filter(([id]) => !heldPaintingSpots.has(id));

const unavailable = (): never => { throw new ApiError(409, 'NATIVE_DETAIL_UNAVAILABLE'); };
const commitment = (value: unknown) => createHash('sha256').update(freezeCanonical(value)).digest('hex');

function unique<T>(rows: readonly T[], match: (row: T) => boolean): T {
  const found = rows.filter(match);
  if (found.length !== 1) return unavailable();
  return found[0]!;
}

function targetGeometry(scene: Exhibition, targetId: string, roomId: string) {
  const placement = unique(scene.placements, row => row.id === targetId && row.roomId === roomId);
  const room = unique(scene.rooms, row => row.id === roomId);
  const art = unique(scene.artworks, row => row.revisionId === placement.artworkRevisionId);
  const asset = unique(art.assets, row => row.id === placement.assetId);
  return [room.dimensions, room.transform, placement.transform, art.dimensions, art.transform, asset.sha256] as const;
}

function railBinding(scene: Exhibition) {
  const workspace = scene.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as WorkspaceFurnishings | undefined;
  if (!workspace) return unavailable();
  const placement = unique(workspace.placements, row => row.id === paintingRail && row.roomId === paintingRoom);
  const descriptor = unique(workspace.furnishings, row => row.id === placement.furnishingId);
  const attachment = unique(workspace.ceilingAttachments ?? [], row => row.placementId === placement.id);
  const ceiling = unique(scene.surfaces, row => row.id === attachment.surfaceId && row.type === 'ceiling' && row.roomId === paintingRoom);
  if (descriptor.kind !== 'ceiling-rail' || descriptor.model.sha256 !== paintingRailModel) return unavailable();
  return [placement, descriptor, attachment, ceiling];
}

/** Replay only the reviewed rows. The selected-output caller must first bind the
 * exact live saved draft and acknowledged predecessor to its owner and receipts. */
export function projectSelectedRetainedSpots(selected: Exhibition, saved: Exhibition, selection: boolean | 'accepted-seven'): Exhibition {
  const spots = selection === 'accepted-seven' ? acceptedPaintingSpots : paintingSpots;
  const includeOldArrow = selection !== false;
  if (!isDeepStrictEqual(railBinding(selected), railBinding(saved))) return unavailable();
  if (selected.lights.some(row => row.type === 'point')) return unavailable();
  unique(selected.lights, row => row.id === '78edc3a0-2f16-43c1-bb2d-fd5e53bafa37' && row.type === 'spot');
  unique(selected.lights, row => row.id === '4c7ab071-02d9-4132-b65e-9c3ff9bde1a2' && row.type === 'spot');
  const next = structuredClone(selected);
  const details = lightDetailsFor(next);
  const attachments = lightAttachmentsFor(next);
  const fixtures = furnishingsFor(next);
  const savedDetails = lightDetailsFor(saved);
  const savedAttachments = lightAttachmentsFor(saved);
  const savedFixtures = furnishingsFor(saved);
  if (!fixtures || !savedFixtures) return unavailable();
  const head = unique(fixtures.assets, row => row.sha256 === articulatedHead);

  function checkSlot(lightId: string, targetId: string, roomId: string) {
    if (next.lights.some(row => row.id === lightId || row.targetPlacementId === targetId) ||
        details.some(row => row.lightId === lightId || row.trackAim?.aim.kind === 'placement-center' && row.trackAim.aim.placementId === targetId) ||
        attachments.some(row => row.lightId === lightId) ||
        fixtures!.bindings.some(row => row.hostKind === 'light' && row.hostId === lightId) ||
        !isDeepStrictEqual(targetGeometry(selected, targetId, roomId), targetGeometry(saved, targetId, roomId)))
      return unavailable();
  }

  for (const [id, expected] of spots) {
    const light = unique(saved.lights, row => row.id === id);
    const detail = unique(savedDetails, row => row.lightId === id);
    const binding = unique(savedFixtures.bindings, row => row.hostKind === 'light' && row.hostId === id);
    const sourceHead = unique(savedFixtures.assets, row => row.id === binding.assetId);
    const track = detail.trackAim;
    if (!track || track.aim.kind !== 'placement-center' || light.roomId !== paintingRoom ||
        track.mount.railPlacementId !== paintingRail || savedAttachments.some(row => row.lightId === id) ||
        commitment([light, detail, binding]) !== expected || !isDeepStrictEqual(sourceHead, head) ||
        !resolveTrackSpotAiming(saved, id).reachable ||
        details.some(row => row.trackAim?.mount.railPlacementId === paintingRail &&
          isDeepStrictEqual(row.trackAim.mount.position, track.mount.position))) return unavailable();
    checkSlot(id, track.aim.placementId, light.roomId);
    next.lights.push(structuredClone(light));
    details.push(structuredClone(detail));
    fixtures.bindings.push(structuredClone(binding));
  }

  if (includeOldArrow) {
    const light = unique(saved.lights, row => row.id === oldArrowLight);
    const detail = unique(savedDetails, row => row.lightId === oldArrowLight);
    const attachment = unique(savedAttachments, row => row.lightId === oldArrowLight);
    const target = light.targetPlacementId;
    const isCeiling = (row: Exhibition['surfaces'][number]) =>
      row.id === attachment.surfaceId && row.roomId === light.roomId && row.type === 'ceiling';
    if (!target || commitment([light, detail, attachment]) !== oldArrowCommitment ||
        savedFixtures.bindings.some(row => row.hostKind === 'light' && row.hostId === oldArrowLight) ||
        targetGeometry(selected, target, light.roomId).at(-1) !== oldArrowModel ||
        !isDeepStrictEqual(unique(selected.surfaces, isCeiling), unique(saved.surfaces, isCeiling))) return unavailable();
    checkSlot(light.id, target, light.roomId);
    next.lights.push(structuredClone(light));
    details.push(structuredClone(detail));
    attachments.push(structuredClone(attachment));
  }

  next.extensions = {
    ...next.extensions,
    [LIGHT_DETAILS_NAMESPACE]: {version: 1, lights: details} as unknown as NonNullable<Exhibition['extensions']>[string],
    [FURNISHING_NAMESPACE]: fixtures as unknown as NonNullable<Exhibition['extensions']>[string],
    ...(includeOldArrow ? {[LIGHT_ATTACHMENT_NAMESPACE]: {version: 1, lights: attachments} as unknown as NonNullable<Exhibition['extensions']>[string]} : {}),
  };
  if (!validateStudioLightDetails(next).valid || !validateLightAttachments(next).valid || !validateFurnishings(next).valid ||
      spots.some(([id]) => !resolveTrackSpotAiming(next, id).reachable)) return unavailable();
  return next;
}
