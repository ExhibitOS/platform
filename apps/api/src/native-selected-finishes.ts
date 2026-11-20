// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import type {Exhibition} from '@exhibitos/spec';
import {FOOTSTEP_RESOURCE_NAMESPACE} from '@exhibitos/spec/footstep-resources';
import {
  applyArchitecturalFinishCommand, experienceFor, FLOOR_NAMESPACE, floorFor, MATERIAL_NAMESPACE,
  surfaceTextureDefaults, surfaceTextureFor, surfaceTextureMaterialMap, TEMPLATE_NAMESPACE,
  validateStudioFloors, validateStudioMaterials, wallFinishesFor,
  type FloorBinding, type StudioFloors, type StudioMaterials, type SurfaceTexturePackId,
} from '@exhibitos/studio-contract';
import {ApiError} from './auth.ts';
import type {Draft} from './studio.ts';

const paintingFloor = 'f8113a60-c632-4b91-9f3a-b14ade790385';
const paintingWall = '828eb6bd-3950-4219-b10f-7fd9f18ac419';
const approvedWallTextures = [
  ['03256856-62e4-45de-a216-c3ed18e4165d', 'museum-matte-paint'],
  ['c0e44159-6c77-48bd-9544-173aca5fa682', 'museum-matte-paint'],
  ['3bdaaba2-36ea-492e-b706-71c0414dd6ad', 'museum-matte-paint'],
  ['0d7e8b5a-c3e0-4810-89a6-6066796a14f0', 'museum-matte-paint'],
  ['62aae7e6-b6c0-4c5a-a03b-73761d61203d', 'fine-gallery-concrete'],
] as const satisfies readonly (readonly [string, SurfaceTexturePackId])[];
const quietOak: Omit<FloorBinding, 'sound'> = {
  target: {kind: 'surface', surfaceId: paintingFloor},
  preset: 'wood', texturePack: {id: 'quiet-oak-herringbone', version: 1},
  repeatMeters: [0.9, 0.9], rotation: 0, normalScale: 1,
};
const paintingFinish = {
  surfaceId: paintingWall, depth: 0.12, baseboardHeight: 0.1,
  trimWidth: 0.04, ceilingBand: true,
};
const unavailable = (): never => { throw new ApiError(409, 'NATIVE_DETAIL_UNAVAILABLE'); };
type ExtensionValue = NonNullable<Exhibition['extensions']>[string];

/** Only invoked after the selected loader has authenticated the actual
 * owner/head, independently pinned the approved predecessor and loaded its
 * exact selection. The next saved head must contain five stock textures only. */
export function projectSelectedVisualFinishes(selected: Exhibition, predecessor: Draft, successor: Draft): Exhibition {
  const authored = predecessor.candidate;
  const authoredFloor = authored.surfaces.find(surface => surface.id === paintingFloor && surface.type === 'floor');
  const selectedFloor = selected.surfaces.find(surface => surface.id === paintingFloor && surface.type === 'floor');
  const authoredWalls = wallFinishesFor(authored), selectedWalls = wallFinishesFor(selected);
  const painted = authoredWalls.find(finish => finish.surfaceId === paintingWall);
  const retained = selectedWalls.find(finish => finish.surfaceId === paintingWall);
  const wood = experienceFor(selected).footsteps.find(row => row.surfaceId === paintingFloor);
  if (!authoredFloor || !selectedFloor || !isDeepStrictEqual(authoredFloor, selectedFloor) ||
      !isDeepStrictEqual(floorFor(authored, {roomId: authoredFloor.roomId, surfaceId: paintingFloor}), {...quietOak, sound: {mode: 'material-default', gain: 1}}) ||
      floorFor(selected, {roomId: selectedFloor.roomId, surfaceId: paintingFloor}) !== undefined ||
      !isDeepStrictEqual(painted, {...paintingFinish, preset: 'painted-edge'}) ||
      !isDeepStrictEqual(retained, {...paintingFinish, preset: 'dark-edge'}) ||
      !isDeepStrictEqual(wood, {surfaceId: paintingFloor, material: 'wood'}) ||
      !isDeepStrictEqual(selected.extensions?.[FOOTSTEP_RESOURCE_NAMESPACE], {version: 1, families: ['wood']}))
    return unavailable();

  try {
    const expected = structuredClone(authored);
    const projected = applyArchitecturalFinishCommand(selected, {
      type: 'set-wall-finish', wall: {...paintingFinish, preset: 'painted-edge'},
    });
    // The selected output carries the prior selection's provenance.
    if (selected.extensions?.[TEMPLATE_NAMESPACE] !== undefined)
      projected.extensions![TEMPLATE_NAMESPACE] = structuredClone(selected.extensions[TEMPLATE_NAMESPACE]);

    const selectedFloors = projected.extensions?.[FLOOR_NAMESPACE] as unknown as StudioFloors | undefined;
    projected.extensions = {
      ...projected.extensions,
      [FLOOR_NAMESPACE]: {version: 1, bindings: [...(selectedFloors?.bindings ?? []), structuredClone(quietOak)]} as unknown as ExtensionValue,
    };
    for (const [surfaceId, pack] of approvedWallTextures) {
      const wall = authored.surfaces.find(surface => surface.id === surfaceId && surface.type === 'wall');
      const authoredFinish = authoredWalls.find(finish => finish.surfaceId === surfaceId);
      if (!wall || !isDeepStrictEqual(wall, selected.surfaces.find(surface => surface.id === surfaceId)) ||
          authoredFinish?.preset !== 'plain' ||
          !isDeepStrictEqual(authoredFinish, selectedWalls.find(finish => finish.surfaceId === surfaceId)) ||
          surfaceTextureFor(authored, surfaceId) !== undefined || surfaceTextureFor(selected, surfaceId) !== undefined)
        return unavailable();

      const texture = surfaceTextureDefaults(pack).texture;
      for (const document of [expected, projected]) {
        const materials = document.extensions?.[MATERIAL_NAMESPACE] as unknown as StudioMaterials | undefined;
        const material = materials?.surfaces[surfaceId] ?? null;
        const map = surfaceTextureMaterialMap(document, {type: 'set-material-texture', surfaceId, material, texture});
        document.extensions = {...document.extensions, [MATERIAL_NAMESPACE]: map as unknown as ExtensionValue};
      }
    }
    const template = expected.extensions?.[TEMPLATE_NAMESPACE] as {modified: boolean} | undefined;
    if (template) template.modified = true;
    if (successor.editVersion !== predecessor.editVersion + approvedWallTextures.length ||
        !isDeepStrictEqual({...predecessor, editVersion: successor.editVersion, updatedAt: successor.updatedAt, candidate: expected}, successor) ||
        !validateStudioMaterials(expected).valid || !validateStudioMaterials(projected).valid || !validateStudioFloors(projected).valid)
      return unavailable();
    return projected;
  } catch {
    return unavailable();
  }
}
