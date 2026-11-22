// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Exhibition } from '@exhibitos/spec';
import { qualifiedModularPortalTarget, workspaceFitGeometry } from '@exhibitos/spec/workspace-fit-models';
import { artifactPoint } from './artifact-affine.js';
import { architecturalWallBoxes, validateArchitecturalFinishes, wallFinishesFor } from './architectural-finishes.js';
import { freezeCanonical } from './freeze.js';
import { lightDetailsFor, validateStudioLightDetails } from './light-details.js';
import { PAIRED_WALL_STRUCTURE_NAMESPACE } from './paired-wall-structure.js';
import { validateSpaceLighting, spaceLightingFor } from './space-lighting.js';
import { validateWorkspaceFurnishings, WORKSPACE_FURNISHING_NAMESPACE, type WorkspaceFurnishings } from './workspace-furnishing.js';

export const STATIC_ROOM_INDIRECT_FORMAT = 'exhibitos-static-room-indirect-v1';
export const STATIC_ROOM_INDIRECT_RECIPE = 'room-diffuse-one-bounce-rgba8-v1';
export const STATIC_ROOM_INDIRECT_TEXTURE_BUDGET = 1024 * 1024;
const hash = /^[a-f0-9]{64}$/;

type Vec3 = [number, number, number];
type RoomPose = Exhibition['rooms'][number]['transform'];

export interface StaticRoomIndirectSource {
  publicationId: string;
  revisionSha256: string;
  bodySha256: string;
  indexSha256: string;
}

export interface StaticRoomIndirectChart {
  surfaceId: string;
  center: Vec3;
  right: Vec3;
  up: Vec3;
  normal: Vec3;
  widthMetres: number;
  heightMetres: number;
  width: number;
  height: number;
  texture: { sha256: string; bytes: number };
}

/** Source-side coverage record. Live descriptor admission still requires all
 * receiver roles and therefore does not admit these records in isolation. */
export type StaticRoomIndirectFrontPaintChart = StaticRoomIndirectChart & {
  receiverRole: 'front-paint';
  patchIndex: number;
};
type FrontPaintFootprint = Omit<StaticRoomIndirectFrontPaintChart, 'texture'>;

interface StaticRoomIndirectRoom {
  roomId: string;
  transform: RoomPose;
  scale: number;
  panelsSha256: string;
  materialsSha256: string;
  emitterIds: string[];
  emittersSha256: string;
  charts: StaticRoomIndirectChart[];
}

export interface StaticRoomIndirectDescriptor {
  format: typeof STATIC_ROOM_INDIRECT_FORMAT;
  source: StaticRoomIndirectSource;
  recipe: { id: typeof STATIC_ROOM_INDIRECT_RECIPE; sha256: string };
  rooms: StaticRoomIndirectRoom[];
}

const sourceKeys = ['publicationId', 'revisionSha256', 'bodySha256', 'indexSha256'] as const;
const isHash = (value: unknown) => typeof value === 'string' && hash.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const closed = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const sameVector = (value: unknown, expected: readonly number[]) =>
  Array.isArray(value) && value.length === expected.length && expected.every((n, i) => value[i] === n);

/** Derive the inward front rectangles from the existing wall decomposition.
 * Portal concealment and receiver coverage are checked by the producer. */
export function staticRoomIndirectFrontPaintFootprints(exhibition: Exhibition) {
  if (!validateSpaceLighting(exhibition).valid || spaceLightingFor(exhibition)?.mode !== 'room-local' ||
      exhibition.rooms.length !== 2 || exhibition.openings.length !== 2 || exhibition.placements.length ||
      Object.hasOwn(exhibition.extensions ?? {}, PAIRED_WALL_STRUCTURE_NAMESPACE) ||
      Object.hasOwn(exhibition.extensions ?? {}, 'org.exhibitos.studio/workspace-materials') ||
      !validateArchitecturalFinishes(exhibition).valid || !validateWorkspaceFurnishings(exhibition).valid) return;
  const workspace = exhibition.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings | undefined;
  if (!workspace || workspace.furnishings.length !== 1 || workspace.openingAttachments?.length !== 1 ||
      workspace.placements.length || workspace.frameAttachments?.length || workspace.ceilingAttachments?.length ||
      !exhibition.rooms.every(room=>staticRoomIndirectEmitterIds(exhibition,room.id)?.length===1)) return;
  const attachment = workspace.openingAttachments[0]!;
  const asset = workspace.furnishings[0]!;
  const shape = workspaceFitGeometry(asset);
  if (shape?.profile !== 'modular-portal-v1') return;
  const pair = qualifiedModularPortalTarget(shape, exhibition, attachment.openingId, asset)?.coincidentPair;
  if (!pair) return;
  const finishes = wallFinishesFor(exhibition);
  const host = finishes.find(finish=>finish.surfaceId===pair.hostSurfaceId);
  const finish = finishes.find(row=>row.surfaceId===pair.peerSurfaceId);
  const surface = exhibition.surfaces.find(value=>value.id===pair.peerSurfaceId);
  if (finishes.length!==2 || host?.preset!=='plain' || host.plainBaseboard || host.depth!==.12 ||
      finish?.preset!=='painted-edge' || finish.depth!==.12 || !surface) return;
  const {transform} = surface;
  const direction = (axis: Vec3) => artifactPoint(axis,transform).map((value,i)=>value-transform.position[i]!) as Vec3;
  const right = direction([1,0,0]), up = direction([0,1,0]), normal = direction([0,0,1]);
  return architecturalWallBoxes(surface,exhibition.openings,finish,true,exhibition)
    .filter(box=>box.kind==='finish' && box.position[2]>0)
    .map(({position,dimensions},patchIndex)=>({
      wallXY:[position[0],position[1]] as [number,number],
      chart:{
        surfaceId:surface.id,receiverRole:'front-paint',patchIndex,
        center:artifactPoint([position[0],position[1],position[2]+dimensions.depth/2],transform),
        right,up,normal,widthMetres:dimensions.width,heightMetres:dimensions.height,
        width:Math.ceil(dimensions.width/.25),height:Math.ceil(dimensions.height/.25),
      } satisfies FrontPaintFootprint,
    }));
}

export function readStaticRoomIndirectFrontPaintChart(value: unknown, expected: FrontPaintFootprint) {
  if (!closed(value,[...Object.keys(expected),'texture']) || !closed(value.texture,['sha256','bytes']) ||
      !isHash(value.texture.sha256) || expected.width<1 || expected.height<1 ||
      expected.width>64 || expected.height>64 || value.texture.bytes!==expected.width*expected.height*4 ||
      !Object.entries(expected).every(([key,entry])=>Array.isArray(entry)?sameVector(value[key],entry):value[key]===entry)) return;
  return structuredClone(value) as unknown as StaticRoomIndirectFrontPaintChart;
}

/** Admit only the fixture-free room-base area that the live Viewer enables. */
export function staticRoomIndirectEmitterIds(exhibition: Exhibition, roomId: string): string[] | undefined {
  if (!validateStudioLightDetails(exhibition).valid) return;
  const details = new Map(lightDetailsFor(exhibition).map(detail => [detail.lightId.toLowerCase(), detail]));
  const lights = exhibition.lights.filter(light => light.roomId.toLowerCase() === roomId.toLowerCase());
  if (!lights.length || lights.some(light => {
    const detail = details.get(light.id.toLowerCase());
    return light.type !== 'area' || light.unit !== 'lumen' || !light.dimensions ||
      !light.transform.scale.every(value => value === 1) || !Number.isFinite(light.intensity) || light.intensity < 0 ||
      light.castsShadow !== false || light.targetPlacementId !== undefined ||
      detail?.purpose !== 'room-base' || detail.fixture !== 'none' ||
      detail.aim !== undefined || detail.trackAim !== undefined || detail.angularProfile !== undefined;
  })) return;
  return lights.map(light => light.id).sort();
}

function samePose(value: unknown, expected: RoomPose) {
  return closed(value, ['position', 'rotation', 'scale']) && expected.scale.every(n => n === 1) &&
    sameVector(value.position, expected.position) && sameVector(value.rotation, expected.rotation) &&
    sameVector(value.scale, expected.scale);
}

function admittedChart(value: unknown, surface: Exhibition['surfaces'][number]) {
  if (!closed(value, ['surfaceId', 'center', 'right', 'up', 'normal', 'widthMetres', 'heightMetres', 'width', 'height', 'texture'])) return false;
  const { transform, dimensions } = surface;
  if (!['floor', 'wall', 'ceiling'].includes(surface.type) || !transform.scale.every(n => n === 1)) return false;
  const direction = (axis: Vec3) => artifactPoint(axis, transform).map((n, i) => n - transform.position[i]!);
  if (value.surfaceId !== surface.id || !sameVector(value.center, transform.position) ||
      !sameVector(value.right, direction([1, 0, 0])) || !sameVector(value.up, direction([0, 1, 0])) ||
      !sameVector(value.normal, direction([0, 0, 1])) ||
      value.widthMetres !== dimensions.width || value.heightMetres !== dimensions.height) return false;
  const width = Math.ceil(dimensions.width / .25), height = Math.ceil(dimensions.height / .25);
  return width > 0 && height > 0 && width <= 64 && height <= 64 &&
    value.width === width && value.height === height && closed(value.texture, ['sha256', 'bytes']) &&
    isHash(value.texture.sha256) && value.texture.bytes === width * height * 4;
}

/** Call only after verifying the content-addressed descriptor bytes and the
 * independently loaded publication. No room may advertise partial coverage. */
export function readStaticRoomIndirect(
  value: unknown, source: StaticRoomIndirectSource, exhibition: Exhibition, recipeSha256: string,
): StaticRoomIndirectDescriptor | undefined {
  if (!closed(value, ['format', 'source', 'recipe', 'rooms']) || value.format !== STATIC_ROOM_INDIRECT_FORMAT ||
      !closed(value.recipe, ['id', 'sha256']) || value.recipe.id !== STATIC_ROOM_INDIRECT_RECIPE ||
      !isHash(recipeSha256) || value.recipe.sha256 !== recipeSha256 ||
      !validateSpaceLighting(exhibition).valid || spaceLightingFor(exhibition)?.mode !== 'room-local' ||
      !Array.isArray(value.rooms) || !value.rooms.length || value.rooms.length > exhibition.rooms.length) return;
  const identity = value.source;
  if (!closed(identity, sourceKeys) || !sourceKeys.every(key => identity[key] === source[key])) return;
  const seen = new Set<string>();
  let bytes = 0;
  for (const entry of value.rooms) {
    if (!closed(entry, ['roomId', 'transform', 'scale', 'panelsSha256', 'materialsSha256', 'emitterIds', 'emittersSha256', 'charts']) ||
        typeof entry.roomId !== 'string' || seen.has(entry.roomId) ||
        typeof entry.scale !== 'number' || !Number.isFinite(entry.scale) || entry.scale <= 0 ||
        ![entry.panelsSha256, entry.materialsSha256, entry.emittersSha256].every(isHash) ||
        !Array.isArray(entry.charts)) return;
    seen.add(entry.roomId);
    const room = exhibition.rooms.find(room => room.id === entry.roomId);
    if (!room || !samePose(entry.transform, room.transform)) return;
    const emitterIds = staticRoomIndirectEmitterIds(exhibition, room.id);
    const advertisedIds = entry.emitterIds;
    if (!emitterIds || !Array.isArray(advertisedIds) || advertisedIds.length !== emitterIds.length ||
        !emitterIds.every((id, index) => advertisedIds[index] === id)) return;
    const surfaces = exhibition.surfaces.filter(surface => surface.roomId === room.id);
    if (surfaces.length !== 6 || entry.charts.length !== surfaces.length) return;
    for (const surface of surfaces) {
      const charts = entry.charts.filter(value => object(value) && value.surfaceId === surface.id);
      if (charts.length !== 1 || !admittedChart(charts[0], surface)) return;
      bytes += (charts[0] as StaticRoomIndirectChart).texture.bytes;
      if (bytes > STATIC_ROOM_INDIRECT_TEXTURE_BUDGET) return;
    }
  }
  return structuredClone(value) as unknown as StaticRoomIndirectDescriptor;
}

export function staticRoomIndirectTexturePath(chart: StaticRoomIndirectChart): string {
  return `data/${chart.texture.sha256}.bin`;
}

export function staticRoomIndirectEmitterInput(
  exhibition: Exhibition, emitterIds: readonly string[],
): string {
  const lights = new Map(exhibition.lights.map(light => [light.id, light]));
  const details = new Map(lightDetailsFor(exhibition).map(detail => [detail.lightId.toLowerCase(), detail]));
  return freezeCanonical(emitterIds.map(lightId => ({
    light: lights.get(lightId), detail: details.get(lightId.toLowerCase()),
  })));
}

async function digestRoomIndirectBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, n => n.toString(16).padStart(2, '0')).join('');
}

export async function verifyStaticRoomIndirectEmitters(
  room: StaticRoomIndirectRoom, exhibition: Exhibition,
): Promise<boolean> {
  const input = staticRoomIndirectEmitterInput(exhibition, room.emitterIds);
  return await digestRoomIndirectBytes(new TextEncoder().encode(input)) === room.emittersSha256;
}

/** Caller must load all admitted room charts before switching its live branch. */
export async function verifyStaticRoomIndirectTexture(
  chart: StaticRoomIndirectChart, data: Uint8Array,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (data.byteLength !== chart.texture.bytes) return;
  const bytes = new Uint8Array(data);
  for (let i = 3; i < bytes.length; i += 4) if (bytes[i] !== 255) return;
  if (await digestRoomIndirectBytes(bytes) === chart.texture.sha256) return bytes;
}
