// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {Exhibition} from '@exhibitos/spec';
import {
  freezeCanonical, FURNISHING_NAMESPACE, furnishingsFor, LIGHT_DETAILS_NAMESPACE,
  lightAttachmentsFor, lightDetailsFor, resolveTrackSpotAiming, sameLightPose,
  validateFurnishings, validateStudioLightDetails, WORKSPACE_FURNISHING_NAMESPACE, type WorkspaceFurnishings,
} from '@exhibitos/studio-contract';
import {ApiError} from './api-error.ts';

const room = '8a538134-b62f-4044-abc3-9768cca0dab1';
const negativeRail = '6befb127-aee7-4003-b353-711b9f801c74';
const positiveRail = '15b3814f-b643-4e1c-a503-286eaeda8223';
const railModel = 'dcf99d8d5568bd5eba2614028ca3bf545a86251c435af1614b851d873c104ae7';
const headModel = 'e6801dd02c4f11a1c48b5cf64d97b775924bab10ea7dd533e2904db3a4d6d3a3';
// Commitments include the emitter, exact saved optics/aim and bound head pose.
const fixtures = [
  {id: '95c0e530-19f2-4b37-a243-49ed2a03662a', placement: 'beffde70-01a7-48b2-9e24-583ba9740abe',
    retained: '889c77400a91069994df6eff08ece9a833a32bd88b1f1dc9a9b2ce387b95ac62',
    saved: 'b30fa534a650f8921b189f5152ac315e1afaab9b0b8d2b559f9392bc9a559a81', rail: negativeRail},
  {id: '72fb53f0-045b-4909-9d11-21afa59f2d94', placement: '56a713b8-0200-4973-9bca-cd5b2966d60a',
    retained: '27af8f08b22b356fb1f0794bd3b8ba78aef3b61fcffb1fe1db93a7590eaa9bd2',
    saved: 'c4d37df020c9af25fca0817afa30de3198da3a1b82931f92fc9481454c71955f', rail: negativeRail},
  {id: 'c76f1795-4ede-46f0-a80c-2c2246a6772a', placement: 'e1103d98-1769-4ff9-a7b4-0704747e0d78',
    retained: 'ccb2bc90c92360f01b340236acf6154a707a17f8882c6db14cb69939f7152618',
    saved: 'f9d6c91c442c5e3e612d6e366f91c903fec68564a58c7e47bb3aa26d96f1b46d', rail: negativeRail},
  {id: '528f007e-5274-4871-8ab0-470b96cb74f8', placement: 'dd690963-dfd9-4d27-9dac-164403815493',
    retained: 'e9aa60ab6e957e9545ff0b45a86c3a35b9deeeb514949b5e7d9ad9954f3461de',
    saved: 'e9aa60ab6e957e9545ff0b45a86c3a35b9deeeb514949b5e7d9ad9954f3461de', rail: positiveRail},
] as const;
const unavailable = (): never => { throw new ApiError(409, 'NATIVE_DETAIL_UNAVAILABLE'); };
const commitment = (value: unknown) => createHash('sha256').update(freezeCanonical(value)).digest('hex');

function rowIndex<T>(rows: readonly T[], matches: (row: T) => boolean): number {
  const index = rows.findIndex(matches);
  if (index < 0 || rows.findLastIndex(matches) !== index) return unavailable();
  return index;
}

function rails(scene: Exhibition) {
  const workspace = scene.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as WorkspaceFurnishings | undefined;
  if (!workspace) return unavailable();
  return [negativeRail, positiveRail].map(id => {
    const placement = workspace.placements[rowIndex(workspace.placements, row => row.id === id)]!;
    const ceilingAttachments = workspace.ceilingAttachments ?? [];
    const attachment = ceilingAttachments[rowIndex(ceilingAttachments, row => row.placementId === id)]!;
    const model = workspace.furnishings[rowIndex(workspace.furnishings, row => row.id === placement.furnishingId)]!;
    const ceiling = scene.surfaces[rowIndex(scene.surfaces, row => row.id === attachment.surfaceId)]!;
    if (placement.roomId !== room || ceiling.roomId !== room || ceiling.type !== 'ceiling' ||
        model.kind !== 'ceiling-rail' || model.model.sha256 !== railModel) return unavailable();
    return [placement, attachment, ceiling, model];
  });
}

function geometry(scene: Exhibition, placementId: string) {
  const placement = scene.placements[rowIndex(scene.placements, row => row.id === placementId && row.roomId === room)]!;
  const artwork = scene.artworks[rowIndex(scene.artworks, row => row.revisionId === placement.artworkRevisionId)]!;
  const asset = artwork.assets[rowIndex(artwork.assets, row => row.id === (placement.assetId ?? artwork.primaryAssetId))]!;
  return [placement.transform, artwork.transform, artwork.dimensions, asset.sha256];
}

/** The caller binds the exact live owner head, accepted predecessor receipt and rights.
 * Update only the three approved retained fixtures; the fourth already matches. */
export function projectSelectedClosingFixtures(selected: Exhibition, saved: Exhibition): Exhibition {
  const selectedRoom = selected.rooms[rowIndex(selected.rooms, row => row.id === room)]!;
  const savedRoom = saved.rooms[rowIndex(saved.rooms, row => row.id === room)]!;
  if (!isDeepStrictEqual([selectedRoom.dimensions, selectedRoom.transform], [savedRoom.dimensions, savedRoom.transform]) ||
      !isDeepStrictEqual(rails(selected), rails(saved))) return unavailable();
  const next = structuredClone(selected);
  const details = lightDetailsFor(next), sourceDetails = lightDetailsFor(saved);
  const visuals = furnishingsFor(next), sourceVisuals = furnishingsFor(saved);
  if (!visuals || !sourceVisuals || [next, saved].some(scene =>
    scene.lights.filter(row => row.type === 'spot' && row.roomId === room).length !== fixtures.length ||
    lightAttachmentsFor(scene).some(row => fixtures.some(fixture => fixture.id === row.lightId)))) return unavailable();
  const head = visuals.assets[rowIndex(visuals.assets, row => row.sha256 === headModel)]!;
  const sourceHead = sourceVisuals.assets[rowIndex(sourceVisuals.assets, row => row.sha256 === headModel)]!;
  if (!isDeepStrictEqual(head, sourceHead)) return unavailable();

  for (const fixture of fixtures) {
    const byLight = (row: {lightId: string}) => row.lightId === fixture.id;
    const byHead = (row: {hostKind: string; hostId: string}) => row.hostKind === 'light' && row.hostId === fixture.id;
    const lightIndex = rowIndex(next.lights, row => row.id === fixture.id);
    const detailIndex = rowIndex(details, byLight);
    const visualIndex = rowIndex(visuals.bindings, byHead);
    const light = saved.lights[rowIndex(saved.lights, row => row.id === fixture.id)]!;
    const detail = sourceDetails[rowIndex(sourceDetails, byLight)]!;
    const visual = sourceVisuals.bindings[rowIndex(sourceVisuals.bindings, byHead)]!;
    const track = detail.trackAim;
    if (commitment([next.lights[lightIndex], details[detailIndex], visuals.bindings[visualIndex]]) !== fixture.retained ||
        commitment([light, detail, visual]) !== fixture.saved ||
        !track || track.mount.railPlacementId !== fixture.rail || track.aim.kind !== 'placement-center' ||
        track.aim.placementId !== fixture.placement || light.roomId !== room || visual.assetId !== head.id ||
        !isDeepStrictEqual(geometry(selected, fixture.placement), geometry(saved, fixture.placement))) return unavailable();
    if (fixture.retained === fixture.saved) continue;
    next.lights[lightIndex] = structuredClone(light);
    details[detailIndex] = structuredClone(detail);
    visuals.bindings[visualIndex] = structuredClone(visual);
  }
  next.extensions = {
    ...next.extensions,
    [LIGHT_DETAILS_NAMESPACE]: {version: 1, lights: details} as unknown as NonNullable<Exhibition['extensions']>[string],
    [FURNISHING_NAMESPACE]: visuals as unknown as NonNullable<Exhibition['extensions']>[string],
  };
  if (!validateStudioLightDetails(next).valid || !validateFurnishings(next).valid) return unavailable();
  for (const {id} of fixtures) {
    const projected = resolveTrackSpotAiming(next, id), source = resolveTrackSpotAiming(saved, id);
    const light = next.lights.find(row => row.id === id)!;
    if (!projected.reachable || !isDeepStrictEqual(projected, source) ||
        !sameLightPose(light.transform, {position: [...projected.emitter], rotation: [...projected.headPose.rotation], scale: [1, 1, 1]}))
      return unavailable();
  }
  return next;
}
