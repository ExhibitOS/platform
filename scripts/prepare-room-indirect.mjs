// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
  artifactBounds, artifactCorners, artifactPoint, assignedSurfaceMaterial, DEFAULT_MATERIAL, floorFor,
  readStaticRoomIndirect, STATIC_ROOM_INDIRECT_FORMAT, STATIC_ROOM_INDIRECT_RECIPE, STATIC_ROOM_INDIRECT_TEXTURE_BUDGET,
  spaceLightingFor, staticRoomIndirectEmitterIds, staticRoomIndirectEmitterInput, surfacePanels, surfaceTextureFor,
  validateSpaceLighting, WORKSPACE_FURNISHING_NAMESPACE, staticRoomIndirectFrontPaintFootprints,
} from '@exhibitos/studio-contract';
import { bakeRoomIndirectIrradiance, diffuseAreaSamples, traceRoomDiffusePanels } from './room-indirect-irradiance.mjs';
import { readInstalledRoomIndirectRecipe, roomIndirectPortalWorkerPath } from './room-indirect-recipe.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pack = value => Buffer.from(JSON.stringify(value));
const axis = (pose, point) => artifactPoint(point, pose).map((v, i) => v - pose.position[i]);
const rigid = pose => pose.scale.every(v => v === 1);
const tileSize = metres => Math.ceil(metres / .25);
const raySamples = 64;
const maxPanelTests = 48_000_000;
const runtimeRoot = new URL('../', import.meta.url);
const portalProducerUrl = new URL(roomIndirectPortalWorkerPath, runtimeRoot);
const unsupportedGeometry = [
  'org.exhibitos.studio/architectural-finishes',
  'org.exhibitos.studio/paired-wall-structure',
  'org.exhibitos.studio/workspace-materials',
  'org.exhibitos.studio/furnishing-visuals',
  'org.exhibitos.studio/benches',
  'org.exhibitos.studio/plaques',
  'org.exhibitos.studio/installation',
  'org.exhibitos.studio/light-attachments',
];

function linearColor(hex) {
  return [1, 3, 5].map(offset => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
}

function envelopeFace(surface, room, normal) {
  const { width, depth, height } = room.dimensions;
  const minimum = [-width / 2, 0, -depth / 2], maximum = [width / 2, height, depth / 2];
  const bounds = artifactBounds(artifactCorners(surface.dimensions, [surface.transform]));
  const fixed = normal.findIndex(n => Math.abs(n) > 1 - 1e-5);
  if (fixed < 0) return;
  const inward = normal[fixed] > 0;
  if (fixed === 1 ? surface.type !== (inward ? 'floor' : 'ceiling') : surface.type !== 'wall') return;
  const face = inward ? minimum[fixed] : maximum[fixed];
  const near = (a, b) => Math.abs(a - b) < 1e-5;
  if (minimum.some((lo, i) =>
    !near(bounds.min[i], i === fixed ? face : lo) ||
    !near(bounds.max[i], i === fixed ? face : maximum[i]))) return;
  return fixed * 2 + Number(inward);
}

function roomSurfaces(exhibition, room) {
  const surfaces = exhibition.surfaces.filter(surface => surface.roomId === room.id);
  if (!rigid(room.transform) ||
      exhibition.placements.some(placement => placement.roomId === room.id) ||
      surfaces.length !== 6) return;
  const charts = [];
  const panels = [];
  const materials = [];
  const faces = new Set();
  for (const surface of surfaces) {
    if (!['floor', 'wall', 'ceiling'].includes(surface.type) || !rigid(surface.transform) ||
        floorFor(exhibition, { roomId: room.id, surfaceId: surface.id }) ||
        surfaceTextureFor(exhibition, surface.id)) return;
    const material = assignedSurfaceMaterial(exhibition, surface.id) ?? DEFAULT_MATERIAL;
    if (material.metalness !== 0) return;
    const { transform, dimensions } = surface;
    const right = axis(transform, [1, 0, 0]), up = axis(transform, [0, 1, 0]);
    const normal = axis(transform, [0, 0, 1]);
    if ([right, up].some(vector => Math.max(...vector.map(Math.abs)) < 1 - 1e-5)) return;
    const face = envelopeFace(surface, room, normal);
    if (face === undefined || faces.has(face)) return;
    faces.add(face);
    const width = tileSize(dimensions.width), height = tileSize(dimensions.height);
    if (width < 1 || width > 64 || height < 1 || height > 64) return;
    const chart = {
      surfaceId: surface.id, center: transform.position, right, up, normal,
      widthMetres: dimensions.width, heightMetres: dimensions.height, width, height,
    };
    const reflectance = linearColor(material.color);
    charts.push(chart);
    materials.push({ surfaceId: surface.id, reflectance });
    for (const panel of surfacePanels(surface, exhibition.openings)) {
      panels.push({
        center: artifactPoint([panel.x, panel.y, 0], transform), right, up, normal,
        widthMetres: panel.width, heightMetres: panel.height, reflectance,
      });
      if (panels.length > 64) return;
    }
  }
  return { charts, panels, materials };
}

function roomSources(exhibition, room) {
  const emitterIds = staticRoomIndirectEmitterIds(exhibition, room.id);
  if (!emitterIds) return;
  const lights = emitterIds.map(id => exhibition.lights.find(light => light.id === id));
  const sources = lights.flatMap(({ dimensions, transform, color, intensity }) => diffuseAreaSamples({
    ...dimensions, lumens: intensity, color, position: transform.position, normal: axis(transform, [0, 0, -1]),
    right: axis(transform, [1, 0, 0]), up: axis(transform, [0, 1, 0]),
  }));
  return { emitterIds, sources };
}

function encodeRoom(charts, tiles, scale, files) {
  return charts.map((chart, i) => {
    const rgb = tiles[i], rgba = Buffer.alloc(rgb.length / 3 * 4, 255);
    for (let r = 0, p = 0; r < rgb.length; r += 3, p += 4) {
      for (let c = 0; c < 3; c++) rgba[p + c] = Math.min(255, Math.round(255 * rgb[r + c] / scale));
    }
    const sha256 = sha(rgba), path = `data/${sha256}.bin`;
    files.set(path, rgba);
    return { ...chart, texture: { sha256, bytes: rgba.length } };
  });
}

async function loadPortalProducer(expectedSha256) {
  if (sha(await readFile(portalProducerUrl)) !== expectedSha256) throw Error('STATIC_ROOM_INDIRECT_RECIPE');
  const { openRoomIndirectPortal } = await import(portalProducerUrl.href);
  return openRoomIndirectPortal;
}

function barePortalOpening(exhibition, workspace) {
  const [opening] = exhibition.openings;
  if (!workspace || exhibition.rooms.length !== 1 || exhibition.openings.length !== 1 ||
      !opening || opening.type !== 'door' || opening.connectsToOpeningId !== undefined ||
      workspace.placements?.length !== 0 || workspace.furnishings?.length !== 1 ||
      workspace.frameAttachments?.length || workspace.ceilingAttachments?.length ||
      workspace.openingAttachments?.length !== 1 || workspace.openingAttachments[0].openingId !== opening.id) return;
  return opening.id;
}

/** Inspect the finish role without enabling a partially covered paired room.
 * The current receiver contract has no admitted nonparallel reveal role. */
export function prepareRoomIndirectFrontPaint(exhibition, pairedShell) {
  const footprints = staticRoomIndirectFrontPaintFootprints(exhibition);
  if (!footprints?.length || !pairedShell) return { status:'live-fallback', reason:'unsupported-paint' };
  const surface = exhibition.surfaces.find(row => row.id === footprints[0].chart.surfaceId);
  const room = exhibition.rooms.find(row => row.id === surface?.roomId);
  if (!surface || !room) return { status:'live-fallback', reason:'unsupported-paint' };
  const baseCharts = exhibition.rooms.map(entry => roomSurfaces(exhibition,entry)?.charts);
  if (baseCharts.some(charts=>!charts)) return { status:'live-fallback', reason:'unsupported-paint' };
  const totalBytes = [...baseCharts.flat(),...footprints.map(({chart})=>chart)]
    .reduce((sum,chart)=>sum+chart.width*chart.height*4,0);
  if (totalBytes > STATIC_ROOM_INDIRECT_TEXTURE_BUDGET) return { status:'live-fallback', reason:'paint-budget' };

  const translation = room.transform.position;
  const basis = [[1,0,0],[0,1,0],[0,0,1]].map(vector=>axis(room.transform,vector));
  const roomPoint = world => basis.map(vector=>vector.reduce((sum,value,i)=>sum+value*(world[i]-translation[i]),0));
  const patches = [];
  for (const { chart, wallXY } of footprints) {
    const samples = [];
    for (let y=0;y<chart.height;y++) for (let x=0;x<chart.width;x++) {
      const u = chart.widthMetres*((x+.5)/chart.width-.5), v = chart.heightMetres*((y+.5)/chart.height-.5);
      let sample;
      try {
        sample = pairedShell.receiverHit(chart.surfaceId,wallXY[0]+u,wallXY[1]+v);
      } catch {
        return { status:'live-fallback', reason:'unsupported-paint' };
      }
      const hit = sample?.hit;
      if (hit?.kind === 'portal') {
        samples.push(null);
        continue;
      }
      if (hit?.kind !== 'finish' || hit.surfaceId !== chart.surfaceId)
        return { status:'live-fallback', reason:'unsupported-paint' };
      const actual = roomPoint(hit.position);
      const expected = chart.center.map((value,i)=>value+u*chart.right[i]+v*chart.up[i]);
      const alignment = hit.normal.reduce((sum,value,i)=>sum+value*sample.inward[i],0);
      if (!(alignment >= 1-1e-5) ||
          !actual.every((value,i)=>Math.abs(value-expected[i])<=1e-6) ||
          !hit.reflectance.every(value=>Number.isFinite(value)&&value>=0&&value<=1))
        return { status:'live-fallback', reason:'unsupported-paint' };
      samples.push(actual.map((value,i)=>value+chart.normal[i]*1e-5));
    }
    patches.push({ chart,samples });
  }
  return { status:'live-fallback', reason:'unsupported-reveal', patches };
}

/** Private owner export extension. Unsupported authored geometry stays entirely
 * live; this pass never silently drops a model or texture from the transport. */
export async function prepareRoomIndirect(
  { publication, bodyBytes, indexBytes, signal, stagedAssets },
  { readRecipe = () => readInstalledRoomIndirectRecipe(fileURLToPath(runtimeRoot)), loadPortal = loadPortalProducer } = {},
) {
  const { exhibition } = publication;
  if (!validateSpaceLighting(exhibition).valid ||
      spaceLightingFor(exhibition)?.mode !== 'room-local' ||
      Object.keys(exhibition.extensions ?? {}).some(key => key.endsWith('/daylight')) ||
      unsupportedGeometry.some(key => Object.hasOwn(exhibition.extensions ?? {}, key))) {
    return { status: 'live-fallback' };
  }
  const usesPortal = Object.hasOwn(exhibition.extensions ?? {}, WORKSPACE_FURNISHING_NAMESPACE);
  const openingId = usesPortal && barePortalOpening(exhibition, exhibition.extensions[WORKSPACE_FURNISHING_NAMESPACE]);
  if (usesPortal && (!openingId || !stagedAssets)) return { status: 'live-fallback' };
  let recipe;
  try {
    recipe = await readRecipe();
  } catch {
    signal?.throwIfAborted();
    return { status: 'live-fallback' };
  }
  const [,, portalProducerSha256] = recipe.digests;
  if (usesPortal && !portalProducerSha256) return { status: 'live-fallback' };
  const rooms = [], files = new Map();
  let admittedBytes = 0, panelTests = 0;
  for (const room of exhibition.rooms) {
    signal?.throwIfAborted();
    const geometry = roomSurfaces(exhibition, room), lighting = roomSources(exhibition, room);
    if (!geometry || !lighting) continue;
    const bytes = geometry.charts.reduce((total, chart) => total + chart.width * chart.height * 4, 0);
    let work = bytes / 4 * raySamples * geometry.panels.length * (1 + lighting.sources.length);
    if (admittedBytes + bytes > STATIC_ROOM_INDIRECT_TEXTURE_BUDGET || panelTests + work > maxPanelTests) continue;
    let portal;
    if (usesPortal) {
      try {
        const openPortal = await loadPortal(portalProducerSha256);
        portal = await openPortal?.({ ...stagedAssets, exhibition }, openingId, 'room');
      } catch {
        signal?.throwIfAborted();
      }
    }
    if (usesPortal && !portal) continue;
    const charge = tests => {
      work += tests;
      if (panelTests + work > maxPanelTests) throw Error('ROOM_INDIRECT_PORTAL_BUDGET');
    };
    const trace = traceRoomDiffusePanels(geometry.panels,
      portal && ((origin, direction, limit) => portal.trace(origin, direction, limit, charge)));
    const tiles = [];
    try {
      for (const chart of geometry.charts) {
        await setImmediate(undefined, { signal });
        tiles.push(bakeRoomIndirectIrradiance({ ...lighting, chart, trace, raysPerTexel: raySamples, signal }));
      }
    } catch (error) {
      if (!portal) throw error;
      signal?.throwIfAborted();
      continue;
    } finally {
      portal?.dispose();
    }
    panelTests += work;
    let scale = 0;
    for (const tile of tiles) for (const value of tile) scale = Math.max(scale, value);
    if (!Number.isFinite(scale) || scale <= 0) continue;
    rooms.push({
      roomId: room.id, transform: room.transform, scale,
      panelsSha256: sha(pack(portal ? { panels: geometry.panels, portal: portal.source } : geometry.panels)),
      materialsSha256: sha(pack(geometry.materials)), emitterIds: lighting.emitterIds,
      emittersSha256: sha(staticRoomIndirectEmitterInput(exhibition, lighting.emitterIds)),
      charts: encodeRoom(geometry.charts, tiles, scale, files),
    });
    admittedBytes += bytes;
  }
  if (!rooms.length) return { status: 'live-fallback' };
  const source = {
    publicationId: publication.publication.id, revisionSha256: publication.publication.revisionSha256,
    bodySha256: sha(bodyBytes), indexSha256: sha(indexBytes),
  };
  const recipeSha256 = recipe.sha256;
  const value = {
    format: STATIC_ROOM_INDIRECT_FORMAT, source, rooms,
    recipe: { id: STATIC_ROOM_INDIRECT_RECIPE, sha256: recipeSha256 },
  };
  if (!readStaticRoomIndirect(value, source, exhibition, recipeSha256)) return { status: 'live-fallback' };
  const descriptor = pack(value);
  const descriptorSha256 = sha(descriptor);
  files.set(`data/${descriptorSha256}.json`, descriptor);
  return { status: 'baked', descriptorSha256, rooms: rooms.length, textureBytes: admittedBytes, files };
}
