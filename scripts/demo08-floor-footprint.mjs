// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import {
  BackSide, Box3, BufferGeometry, DoubleSide, Float32BufferAttribute, FrontSide,
  Matrix4, Mesh, MeshBasicMaterial, Raycaster, Vector3,
} from 'three';
import { localStaticPublicationSource } from './local-static-publication-source.mjs';

const sourcePin = Object.freeze({
  publicationId: '63719dad-65d3-41e9-86a8-57304976e142',
  revisionSha256: 'a036201f22f02f52cd53b0ea0a08f3a15193f1a994841fbc0b1276d892737fdd',
  manifestSha256: 'e85e85f0b51d06df2e33a0283c7a1933efdf4d7204e12f2bc8c8f805ad124fec',
  indexSha256: 'fcd3e317780d3c26df78caa1e3df58abdc7093cd656a654ae87c20f6ba897db5',
  bodySha256: 'c2d0821659a87d70f94653de2277ffbb276a91d0b5f9a1fc31877bcc1848caa5',
});
const roomId = 'caa65c43-9a61-4fd8-9b00-9ba764660db3';
const wallId = '175edd5a-bd13-45c6-8e40-4adbbcbc71ea';
const floorId = '549b9572-4cb2-4ca0-a908-60c8d7b2da5f';
const floorPoint = Object.freeze([-.63, 0, -2.87]);
const openingIds = [
  'f9fc6204-e9c5-4bc9-895b-1b54744cf089', 'b9dc5ebf-ecae-4036-8344-b519ca0c91ac',
  'dfbe153a-7aaf-498e-858c-e6e77fb023f8', '06004171-8cb0-4aaa-9d17-670743825458',
];
const viewerPin = Object.freeze({
  buildSha256: '003f9ff72e15be9f3040c926478986eef2d7045bf07963731a138cca43c1a04f',
  entryManifestSha256: '793922548c31385f2423c674915f92ef3e257236c8ca5fc169e6efa615146ae7',
  sourceCommit: 'f4d71da8b16eed098419d226d337f5d53ff08ba5',
  sourceTree: 'cbfb0efd3870cac1ae22784332ef542a34aad3bb',
  profile: 'desktop',
});
const format = 'exhibitos-demo08-geometry-v1';
const sides = new Map([['front', FrontSide], ['back', BackSide], ['double', DoubleSide]]);
const epsilon = 1e-5;
const maxWork = 48_000_000;
const maxSnapshotBytes = 25 * 1024 * 1024;
const hash = /^[a-f0-9]{64}$/;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const closed = (v, keys) => v !== null && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
const sameFields = (value, expected) => closed(value, Object.keys(expected)) &&
  Object.entries(expected).every(([key, field]) => value[key] === field);
const sameVector = (value, expected) => Array.isArray(value) && value.length === expected.length &&
  expected.every((n, i) => value[i] === n);
const anchoredId = value => typeof value === 'string' && /^[A-Za-z0-9_.:/-]{1,200}$/.test(value);
const unresolved = reason => ({ status: 'live-fallback', coverage: 'unresolved', reason });

function geometryDraw(row) {
  if (!closed(row, ['id', 'rosterId', 'side', 'coverage', 'positions', 'indices', 'matrixWorld']) ||
      !anchoredId(row.id) || !anchoredId(row.rosterId) || !sides.has(row.side) || row.coverage !== 'opaque' ||
      !Array.isArray(row.positions) || row.positions.length < 9 || row.positions.length % 3 ||
      !row.positions.every(n => Number.isFinite(n) && Math.fround(n) === n) ||
      !Array.isArray(row.matrixWorld) || row.matrixWorld.length !== 16 ||
      !row.matrixWorld.every(Number.isFinite) ||
      [3, 7, 11].some(i => row.matrixWorld[i] !== 0) || row.matrixWorld[15] !== 1) return;
  const count = row.positions.length / 3;
  const indices = row.indices;
  if (indices !== null && (!Array.isArray(indices) ||
      !indices.every(i => Number.isSafeInteger(i) && i >= 0 && i < count))) return;
  const elements = indices?.length ?? count;
  if (!elements || elements % 3) return;
  const matrix = new Matrix4().fromArray(row.matrixWorld);
  const determinant = matrix.determinant();
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(row.positions, 3));
  if (indices !== null) geometry.setIndex(indices);
  geometry.computeBoundingBox();
  const material = new MeshBasicMaterial({ side: sides.get(row.side) });
  const mesh = new Mesh(geometry, material);
  mesh.matrixWorld.copy(matrix);
  const box = geometry.boundingBox.clone().applyMatrix4(matrix);
  if (![...box.min, ...box.max].every(Number.isFinite)) {
    geometry.dispose();
    material.dispose();
    return;
  }
  return { row, geometry, material, mesh, box, triangles: elements / 3 };
}

/** Only the previously agreed second footprint, expressed in the sealed room's
 * world translation. The plinth-blocked comparison is retained evidence. */
function secondFootprint(roomPosition) {
  const translation = new Vector3(...roomPosition);
  const center = new Vector3(-4.93, 3.95, -2.875).add(translation);
  const target = new Vector3(...floorPoint).add(translation);
  const direction = target.clone().sub(center).normalize();
  const origins = [center];
  for (const y of [-.05, .05]) for (const z of [-.125, .125]) {
    origins.push(center.clone().add(new Vector3(0, y, z)));
  }
  const probes = origins.map(origin => {
    const distance = (target.y - origin.y) / direction.y;
    const launch = origin.clone().addScaledVector(direction, epsilon);
    return { launch, end: origin.clone().addScaledVector(direction, distance), distance: distance - epsilon };
  });
  return { center, direction, probes, floorY: target.y };
}

/** Draw AABBs give sufficient exclusion only. Back-project their interval to
 * the launch plane to avoid mistaking the enclosing box for the swept strip. */
function couldIntersect(draw, sweep, box) {
  if (!draw.box.intersectsBox(box)) return false;
  const { center, direction } = sweep;
  const clipped = box.clone().intersect(draw.box);
  for (const [axis, halfExtent] of [['y', .05], ['z', .125]]) {
    const slope = direction[axis] / direction.x;
    const a = slope * (clipped.min.x - center.x), b = slope * (clipped.max.x - center.x);
    const lo = clipped.min[axis] - Math.max(a, b);
    const hi = clipped.max[axis] - Math.min(a, b);
    if (hi < center[axis] - halfExtent - epsilon || lo > center[axis] + halfExtent + epsilon) return false;
  }
  return true;
}

/** Computes geometry evidence only. An agreed point roster does not prove area
 * coverage. Uniform requires one covering floor triangle and exclusion of
 * every intervening draw, using the complete already-admitted snapshot. */
export function evaluateDemo08SecondFootprint(draws, roomPosition, signal) {
  const sweep = secondFootprint(roomPosition);
  const sweptBox = new Box3().setFromPoints(sweep.probes.flatMap(({ launch, end }) => [launch, end]))
    .expandByScalar(epsilon);
  const owned = [];
  try {
    const ids = new Set();
    for (const row of draws) {
      signal?.throwIfAborted();
      const draw = geometryDraw(row);
      if (!draw) return unresolved('unsupported-draw');
      owned.push(draw);
      if (ids.has(row.id)) return unresolved('duplicate-draw');
      ids.add(row.id);
    }
    const candidates = owned.filter(draw => couldIntersect(draw, sweep, sweptBox));
    const work = owned.length + sweep.probes.length * candidates.reduce((n, draw) => n + draw.triangles, 0);
    if (work > maxWork) return unresolved('work-budget');
    const byMesh = new Map(candidates.map(draw => [draw.mesh, draw]));
    const meshes = [...byMesh.keys()];
    const ray = new Raycaster();
    const hits = [];
    for (const { launch, end, distance } of sweep.probes) {
      signal?.throwIfAborted();
      ray.set(launch, sweep.direction);
      ray.far = distance + epsilon;
      const [first, ...others] = ray.intersectObjects(meshes, false);
      if (!first || first.faceIndex === undefined || !Number.isFinite(first.distance) ||
          ![...first.point].every(Number.isFinite)) {
        return unresolved('no-certain-hit');
      }
      const draw = byMesh.get(first.object);
      if (others.some(hit => hit.distance - first.distance <= epsilon &&
          byMesh.get(hit.object) !== draw)) return unresolved('ambiguous-hit');
      hits.push({ draw, faceIndex: first.faceIndex, floorPlane: first.point.distanceTo(end) <= epsilon,
        position: first.point.toArray() });
    }
    const witnesses = hits.map(({ draw, faceIndex, position }) =>
      ({ id: draw.row.rosterId, drawId: draw.row.id, faceIndex, position }));
    if (new Set(hits.map(({ draw }) => draw.row.rosterId)).size > 1) {
      return { status: 'live-fallback', coverage: 'mixed', witnesses, work };
    }
    const { draw: floor, faceIndex } = hits[0];
    if (floor.row.rosterId !== floorId) {
      return { ...unresolved('non-floor-witness'), witnesses, work };
    }
    if (hits.some(hit => hit.draw !== floor || hit.faceIndex !== faceIndex || !hit.floorPlane) ||
        Math.abs(floor.box.min.y - sweep.floorY) > epsilon ||
        Math.abs(floor.box.max.y - sweep.floorY) > epsilon ||
        candidates.some(draw => draw !== floor)) {
      return { ...unresolved('footprint-not-proven'), witnesses, work };
    }
    return { status: 'geometry-only', coverage: 'uniform-floor', witnesses, work };
  } finally {
    for (const { geometry, material } of owned) {
      geometry.dispose();
      material.dispose();
    }
  }
}

async function readAcceptedSnapshot(path, digest, signal) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 2 || stat.size > maxSnapshotBytes) return;
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(bytes, offset, Math.min(1024 * 1024, bytes.length - offset), offset);
      if (!bytesRead) return;
      offset += bytesRead;
    }
    if ((await handle.stat()).size === stat.size && sha(bytes) === digest) return JSON.parse(bytes);
  } finally {
    await handle.close();
  }
}

/** Minimum authored roster for this exact room and its directly joined walls.
 * The separately accepted snapshot digest also binds capture completeness for
 * anything outside this list that may have a footprint-intersecting bound. */
function requiredRoster(exhibition, index) {
  const { extensions, surfaces, placements, lights, openings } = exhibition;
  const boundary = openingIds.map(id => openings.find(opening => opening.id === id));
  if (boundary.some(opening => !opening) ||
      boundary.some((opening, i) => opening.connectsToOpeningId !== boundary[i ^ 1].id) ||
      boundary[0].surfaceId !== wallId) return;
  const required = new Map();
  const add = (id, kind, sourceSha256) => required.set(id, { kind, sourceSha256 });
  const verifyAsset = (assetId, sourceSha256) => {
    const refs = index.assets.filter(asset => asset.assetId === assetId && asset.sha256 === sourceSha256);
    if (refs.length !== 1) throw Error('UNVERIFIED_ASSET');
    return sourceSha256;
  };
  const boundarySurfaces = new Set(boundary.map(opening => opening.surfaceId));
  for (const surface of surfaces) {
    if (surface.roomId === roomId || boundarySurfaces.has(surface.id)) add(surface.id, 'surface');
  }
  for (const placement of placements.filter(row => row.roomId === roomId)) {
    const artwork = exhibition.artworks.find(row => row.revisionId === placement.artworkRevisionId);
    const asset = artwork?.assets.find(row => row.id === placement.assetId && row.role === 'model');
    if (!asset) return;
    add(placement.id, 'artwork', verifyAsset(asset.id, asset.sha256));
    const installed = extensions['org.exhibitos.studio/installation'].placements
      .find(row => row.placementId === placement.id);
    if (installed?.pedestal && installed.pedestal.kind !== 'none') add(`pedestal:${placement.id}`, 'pedestal');
  }
  const fixtureIds = new Set(extensions['org.exhibitos.studio/light-details'].lights
    .filter(detail => detail.fixture !== 'none').map(detail => detail.lightId));
  for (const light of lights) {
    if (light.roomId === roomId && fixtureIds.has(light.id)) add(`fixture:${light.id}`, 'fixture');
  }
  const workspace = extensions['org.exhibitos.studio/workspace-furnishings'];
  const furnishingHash = (id, version) => {
    const item = workspace.furnishings.find(row => row.id === id && row.version === version);
    return verifyAsset(item.id, item.model.sha256);
  };
  for (const placement of workspace.placements) {
    if (placement.roomId === roomId) {
      add(placement.id, 'workspace', furnishingHash(placement.furnishingId, placement.furnishingVersion));
    }
  }
  for (const attachment of workspace.openingAttachments) {
    if (openingIds.includes(attachment.openingId)) {
      add(attachment.openingId, 'portal', furnishingHash(attachment.furnishingId, attachment.furnishingVersion));
    }
  }
  for (const plaque of extensions['org.exhibitos.studio/plaques'].plaques) {
    if (plaque.roomId === roomId && plaque.visible) add(plaque.id, 'plaque');
  }
  return required;
}

function admittedRoster(snapshot, required, index) {
  if (!Array.isArray(snapshot.roster) || !Array.isArray(snapshot.draws) || !snapshot.roster.length ||
      !snapshot.draws.length) return false;
  const mounted = new Map();
  const readyKinds = new Set(['surface', 'artwork', 'pedestal', 'fixture', 'workspace', 'portal', 'plaque']);
  for (const row of snapshot.roster) {
    const keys = ['id', 'kind', 'readiness', 'disposition', ...(Object.hasOwn(row ?? {}, 'sourceSha256') ? ['sourceSha256'] : [])];
    if (!closed(row, keys) || !anchoredId(row.id) || !readyKinds.has(row.kind) ||
        row.readiness !== 'ready' || row.disposition !== 'mounted' || mounted.has(row.id) ||
        (row.sourceSha256 !== undefined &&
          (typeof row.sourceSha256 !== 'string' || !index.assets.some(asset => asset.sha256 === row.sourceSha256)))) {
      return false;
    }
    mounted.set(row.id, row);
  }
  for (const [id, expected] of required) {
    const row = mounted.get(id);
    if (row?.kind !== expected.kind || row.sourceSha256 !== expected.sourceSha256) return false;
  }
  const drawIds = new Set();
  for (const draw of snapshot.draws) {
    if (!mounted.has(draw?.rosterId)) return false;
    drawIds.add(draw.rosterId);
  }
  return drawIds.size === mounted.size;
}

/** Private, detached input only. Callers must explicitly pass the digest of a
 * snapshot accepted for this exact footprint. There is no default snapshot,
 * browser endpoint, producer call site, or descriptor/export integration. */
export async function inspectAcceptedDemo08SecondFootprint({
  sourceDir, snapshotPath, acceptedSnapshotSha256, signal,
}) {
  if (typeof acceptedSnapshotSha256 !== 'string' || !hash.test(acceptedSnapshotSha256)) {
    return unresolved('snapshot-acceptance-required');
  }
  try {
    signal?.throwIfAborted();
    const snapshot = await readAcceptedSnapshot(snapshotPath, acceptedSnapshotSha256, signal);
    if (!closed(snapshot, ['format', 'source', 'viewer', 'scope', 'roster', 'draws']) ||
        snapshot.format !== format || !sameFields(snapshot.source, sourcePin) ||
        !anchoredId(snapshot.viewer?.generation) ||
        !sameFields(snapshot.viewer, { ...viewerPin, generation: snapshot.viewer.generation })) {
      return unresolved('snapshot-identity');
    }
    const scope = snapshot.scope;
    if (!closed(scope, ['roomId', 'surfaceId', 'texelColumn', 'texelRow', 'floorPoint']) ||
        scope.roomId !== roomId || scope.surfaceId !== wallId || scope.texelColumn !== 6 || scope.texelRow !== 0 ||
        !sameVector(scope.floorPoint, floorPoint)) return unresolved('snapshot-scope');
    const source = await localStaticPublicationSource({
      sourceDir,
      sourceManifestSha256: sourcePin.manifestSha256,
      indexSha256: sourcePin.indexSha256,
      publicationId: sourcePin.publicationId,
      revisionSha256: sourcePin.revisionSha256,
    }, { cancelled: () => signal?.aborted ?? false });
    const index = JSON.parse(await source.read('static-publication-index.json'));
    const body = await source.read(index.publication.path);
    if (sha(body) !== sourcePin.bodySha256) return unresolved('snapshot-source');
    const { exhibition } = JSON.parse(body);
    const required = requiredRoster(exhibition, index);
    const room = exhibition.rooms.find(row => row.id === roomId);
    if (!sameVector(room?.transform.rotation, [0, 0, 0, 1]) || !sameVector(room?.transform.scale, [1, 1, 1]) ||
        !sameVector(room?.transform.position, [13, 0, -7]) ||
        !required?.has(floorId) || !admittedRoster(snapshot, required, index)) {
      return unresolved('incomplete-roster');
    }
    return { ...evaluateDemo08SecondFootprint(snapshot.draws, room.transform.position, signal),
      snapshotSha256: acceptedSnapshotSha256 };
  } catch {
    signal?.throwIfAborted();
    return unresolved('snapshot-invalid');
  }
}
