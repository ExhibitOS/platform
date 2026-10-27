// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEMO_ARTWORK_PLAN as plan } from './artwork-plan.mjs';

const readJson = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const pin = await readJson('./publication.json');
const index = await readJson('./source/static-publication-index.json');
const publicDocument = await readJson('./source/' + index.publication.path);
const exhibition = publicDocument.exhibition;
const roles = new Map(plan.base.rooms.map(room => [room.id, room.role]));

function assertDeepFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert(Object.isFrozen(value));
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

test('the pure plan is deeply readonly and binds the current pinned publication', () => {
  assertDeepFrozen(plan);
  assert.equal(plan.version, 1);
  assert.equal(plan.base.exhibitionId, exhibition.id);
  assert.equal(plan.base.revisionSha256, pin.revisionSha256);
  assert.equal(publicDocument.publication.id, pin.publicationId);
  assert.equal(publicDocument.publication.revisionSha256, pin.revisionSha256);
  assert.equal(index.publication.sha256, index.publication.path.split('/').at(-1).replace('.json', ''));
  assert.doesNotMatch(JSON.stringify(plan), /(?:\/Users\/|\/Volumes\/|\.blend|build\.py|verification\.json)/);
});

test('five room identities, actual transforms and reciprocal door pairs are retained', () => {
  assert.deepEqual(plan.base.rooms.map(room => room.role), ['entry', 'painting', 'transition', 'sculpture', 'closing']);
  for (const room of plan.base.rooms) {
    const source = exhibition.rooms.find(candidate => candidate.id === room.id);
    assert(source);
    assert.deepEqual(room.dimensions, source.dimensions);
    assert.deepEqual(room.transform, source.transform);
  }
  const expected = new Map(exhibition.openings.map(opening => [opening.id, opening]));
  const seen = new Set();
  for (const { a, b } of plan.base.doorPairs) {
    assert(!seen.has(a) && !seen.has(b));seen.add(a);seen.add(b);
    assert.equal(expected.get(a)?.connectsToOpeningId, b);
    assert.equal(expected.get(b)?.connectsToOpeningId, a);
    assert.equal(expected.get(a)?.dimensions.width, 2.4);
    assert.equal(expected.get(b)?.dimensions.width, 2.4);
  }
  assert.equal(plan.base.doorPairs.length, 5);
  assert.equal(seen.size, exhibition.openings.length);
});

test('each entry is a distinct existing admitted public work and exact pinned asset/pose', () => {
  assert.equal(plan.entries.length, 4);
  for (const key of ['planId', 'sourceKey', 'officialObjectIdOrURL', 'artworkId', 'artworkRevisionId'])
    assert.equal(new Set(plan.entries.map(entry => entry[key])).size, plan.entries.length);
  for (const entry of plan.entries) {
    const work = exhibition.artworks.find(item => item.id === entry.artworkId);
    const placement = exhibition.placements.find(item => item.id === entry.planId);
    assert(work && placement);
    assert.equal(entry.artworkRevisionId, work.revisionId);
    assert.equal(entry.title, work.metadata.title);
    assert.equal(entry.artist, work.metadata.artist);
    assert(work.metadata.description.includes(entry.description));
    assert.deepEqual(entry.dimensions, work.dimensions);
    assert.equal(entry.roomId, placement.roomId);
    assert.equal(placement.artworkRevisionId, work.revisionId);
    assert.deepEqual(entry.placement, placement.transform);
    assert.deepEqual(entry.placement.scale, [1, 1, 1]);
    assert.deepEqual(work.transform.scale, [1, 1, 1]);
    const asset = index.assets.find(item => item.assetId === work.primaryAssetId);
    assert(asset);
    assert.deepEqual(entry.asset, { sha256: asset.sha256, bytes: asset.bytes, mime: asset.mime });
    assert.match(entry.asset.sha256, /^[a-f0-9]{64}$/);
    assert(entry.asset.bytes > 0);
    assert.equal(entry.artworkType, work.artworkType === 'image' ? 'painting' : 'sculpture');
    assert(entry.placement.position.every(Number.isFinite));
    assert(entry.placement.rotation.every(Number.isFinite));
    assert(Object.values(entry.dimensions).every(value => Number.isFinite(value) && value > 0));
  }
});

test('unresolved slots exactly account for the stated room targets, without candidate entries', () => {
  assert.deepEqual(plan.targets, { paintings: 14, sculptures: 5 });
  const roomTargets = [
    ['entry', 'painting', 0], ['entry', 'sculpture', 0],
    ['painting', 'painting', 9], ['painting', 'sculpture', 0],
    ['transition', 'painting', 3], ['transition', 'sculpture', 1],
    ['sculpture', 'painting', 0], ['sculpture', 'sculpture', 4],
    ['closing', 'painting', 2], ['closing', 'sculpture', 0],
  ];
  for (const [role, type, target] of roomTargets) {
    const admitted = plan.entries.filter(entry => roles.get(entry.roomId) === role && entry.artworkType === type).length;
    const missing = plan.unresolved.filter(entry => entry.roomRole === role && entry.artworkType === type).reduce((sum, entry) => sum + entry.count, 0);
    assert.equal(admitted + missing, target, `${role}/${type}`);
  }
  assert.equal(plan.unresolved.filter(item => item.artworkType === 'painting').reduce((n, item) => n + item.count, 0), 11);
  assert.equal(plan.unresolved.filter(item => item.artworkType === 'sculpture').reduce((n, item) => n + item.count, 0), 4);
  assert(plan.unresolved.every(item => Number.isInteger(item.count) && item.count > 0 && item.reason.length > 0));
});

test('existing painting extents fit their unbroken wall without overlap or occluding a door', () => {
  const paintingRoom = plan.base.rooms.find(room => room.role === 'painting');assert(paintingRoom);
  const paintings = plan.entries.filter(entry => entry.roomId === paintingRoom.id && entry.artworkType === 'painting')
    .toSorted((a, b) => a.placement.position[0] - b.placement.position[0]);
  assert.equal(paintings.length, 3);
  const [first] = paintings;
  assert(first);
  const wall = exhibition.surfaces.find(surface => surface.roomId === paintingRoom.id && surface.type === 'wall'
    && Math.abs(surface.transform.position[2] - (first.placement.position[2] - 0.05)) < 1e-9);
  assert(wall);
  assert(!exhibition.openings.some(opening => opening.surfaceId === wall.id));
  for (const painting of paintings) {
    const [x, y, z] = painting.placement.position;
    assert.equal(z, first.placement.position[2]);
    assert(Math.abs(x) + painting.dimensions.width / 2 < wall.dimensions.width / 2);
    assert(y - painting.dimensions.height / 2 > 0);
    assert(y + painting.dimensions.height / 2 < wall.dimensions.height);
  }
  for (let i = 1; i < paintings.length; i++) {
    const left = paintings[i - 1], right = paintings[i];
    assert(left.placement.position[0] + left.dimensions.width / 2 < right.placement.position[0] - right.dimensions.width / 2);
  }
  // This is an unframed, source-local static geometry check; it does not certify runtime routing.
});

test('existing sculpture keeps the published scale, base envelope and room clearance', () => {
  const entry = plan.entries.find(item => item.artworkType === 'sculpture');assert(entry);
  const room = plan.base.rooms.find(item => item.id === entry.roomId);assert(room);
  const installation = exhibition.extensions['org.exhibitos.studio/installation'];
  const pedestal = installation.placements.find(item => item.placementId === entry.planId)?.pedestal;assert(pedestal);
  assert.equal(pedestal.kind, 'box');
  const [x, y, z] = entry.placement.position;
  assert(Math.abs((y - entry.dimensions.height / 2) - (pedestal.position[1] + pedestal.dimensions.height)) < 1e-9);
  assert(Math.abs(x) + Math.max(entry.dimensions.width, pedestal.dimensions.width) / 2 < room.dimensions.width / 2);
  assert(Math.abs(z) + Math.max(entry.dimensions.depth, pedestal.dimensions.depth) / 2 < room.dimensions.depth / 2);
  // Bounding envelopes alone cannot establish mesh contact, full orbit or collision clearance.
});
