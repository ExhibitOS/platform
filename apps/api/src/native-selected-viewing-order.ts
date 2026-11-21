// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import type {Exhibition} from '@exhibitos/spec';
import {
  PRESENTATION_NAMESPACE, presentationFor, setViewingPlan, validateStudioPresentation,
  validateViewingPlan, VIEWING_PLAN_NAMESPACE, viewingPlanFor, type StudioPresentation,
} from '@exhibitos/studio-contract';
import {ApiError} from './api-error.ts';
import {etag, type Draft} from './studio.ts';

type Viewpoint = StudioPresentation['viewpoints'][number];
type Head = Readonly<{revision: number; etag: string; draft: Draft}>;
const stops: ReadonlyArray<{placementId: string; historicalViewpointId: string; camera: Omit<Viewpoint, 'id'>}> = [
  {
    placementId: '89ec602d-79ff-4851-9ead-85bdd4a382cf',
    historicalViewpointId: 'f5cf74f7-bbac-4584-bb88-70341ddb4815',
    camera: {name: '회화실 첫 작품', roomId: '7681201b-c9ca-46ec-b382-4677fb78b273', position: [-2.2, 1.65, -2.35], target: [-2.2, 1.5, -4.94], fov: 50},
  },
  {
    placementId: '3fdbd22a-2933-4ca9-95af-4120e38673f7',
    historicalViewpointId: '308145ab-2e08-4de3-abfe-43e0c7ea941e',
    camera: {name: '전이 공간 작품', roomId: '01350470-bc11-4ba2-a15a-25e5eff78c1b', position: [0, 1.65, -2.35], target: [0, 1.5, -4.94], fov: 50},
  },
  {
    placementId: 'c0bd428f-911a-418b-938e-1e98efb7ed4a',
    historicalViewpointId: '55da7475-eb96-4b62-b735-2c695d3ff86f',
    camera: {name: '조각실에서 서서 감상', roomId: 'd295d832-8ec0-40b2-8d9d-72d6a1ac3666', position: [1.5, 1.65, 2], target: [0, 1.43, 0], fov: 50},
  },
  {
    placementId: 'beffde70-01a7-48b2-9e24-583ba9740abe',
    historicalViewpointId: '2671f85c-365d-4ea8-b024-5524db2eaa5f',
    camera: {name: '마무리 공간 작품', roomId: '8a538134-b62f-4044-abc3-9768cca0dab1', position: [-2, 1.65, 0.45], target: [-2, 1.5, -1.94], fov: 50},
  },
];
const cannonDisplay = 'eda096e742cfb8e490b0ef6440bf5f101dc4ed82bfd185fb0247c30f616bd181';
const unavailable = (): never => { throw new ApiError(409, 'NATIVE_DETAIL_UNAVAILABLE'); };

function withViewpoints(scene: Exhibition, viewpoints: Viewpoint[]): Exhibition {
  const next = structuredClone(scene);
  const presentation = presentationFor(next);
  presentation.viewpoints.push(...structuredClone(viewpoints));
  next.extensions = {
    ...next.extensions,
    [PRESENTATION_NAMESPACE]: presentation as unknown as NonNullable<Exhibition['extensions']>[string],
  };
  if (!validateStudioPresentation(next).valid) return unavailable();
  return next;
}

function placementGeometry(scene: Exhibition, placementId: string, roomId: string) {
  const placements = scene.placements.filter(row => row.id === placementId && row.roomId === roomId);
  const rooms = scene.rooms.filter(row => row.id === roomId);
  const [placement] = placements;
  const [room] = rooms;
  if (placements.length !== 1 || rooms.length !== 1 || !placement || !room) return unavailable();
  const artwork = scene.artworks.find(row => row.revisionId === placement.artworkRevisionId);
  const asset = artwork?.assets.find(row => row.id === (placement.assetId ?? artwork.primaryAssetId));
  if (!artwork || !asset) return unavailable();
  return {room: [room.dimensions, room.transform], placement: placement.transform,
    artwork: [artwork.dimensions, artwork.transform], sha256: asset.sha256};
}

/** Select an exact ordinary Save delta after the caller has authenticated the
 * owner and bound the acknowledged predecessor and the current saved receipt. */
export function projectSelectedViewingOrder(selected: Exhibition, before: Head, saved: Head): Exhibition {
  if (!Number.isSafeInteger(saved.revision) || before.revision < 1 || saved.revision !== before.revision + 1 ||
      saved.draft.editVersion !== before.draft.editVersion + stops.length + 1 ||
      etag(before.revision, before.draft) !== before.etag || etag(saved.revision, saved.draft) !== saved.etag)
    throw new ApiError(412, 'REMOTE_CONFLICT');
  const source = before.draft.candidate;
  const authored = saved.draft.candidate;
  if ([source, selected].some(scene => Object.hasOwn(scene.extensions ?? {}, VIEWING_PLAN_NAMESPACE) ||
      !Object.hasOwn(scene.extensions ?? {}, PRESENTATION_NAMESPACE) || !validateStudioPresentation(scene).valid) ||
      !validateViewingPlan(authored).valid) return unavailable();
  const plan = viewingPlanFor(authored);
  if (plan.stops.length !== stops.length) return unavailable();
  const existing = [JSON.stringify(source).toLowerCase(), JSON.stringify(selected).toLowerCase()];
  const used = new Set(stops.map(stop => stop.historicalViewpointId));
  const presentation = presentationFor(authored);
  const views = stops.map(({placementId, camera}, index) => {
    const stop = plan.stops[index];
    if (!stop || stop.placementId !== placementId || Object.hasOwn(stop, 'orbit')) return unavailable();
    const id = stop.viewpointId.toLowerCase();
    if (used.has(id) || existing.some(scene => scene.includes(id))) return unavailable();
    used.add(id);
    const entries = presentation.viewpoints.filter(view => view.id === stop.viewpointId);
    const [view] = entries;
    if (entries.length !== 1 || !view || !isDeepStrictEqual(view, {...camera, id: stop.viewpointId})) return unavailable();
    const geometry = placementGeometry(source, placementId, camera.roomId);
    if (!isDeepStrictEqual(geometry, placementGeometry(selected, placementId, camera.roomId)) ||
        (index === 1 && geometry.sha256 !== cannonDisplay)) return unavailable();
    return view;
  });
  const apply = (scene: Exhibition) => setViewingPlan(withViewpoints(scene, views), plan);
  const expected = {...before.draft, candidate: apply(source),
    editVersion: saved.draft.editVersion, updatedAt: saved.draft.updatedAt};
  if (!isDeepStrictEqual(expected, saved.draft)) return unavailable();
  return apply(selected);
}
