// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateDemo08SecondFootprint, inspectAcceptedDemo08SecondFootprint } from './demo08-floor-footprint.mjs';

const floorId = '549b9572-4cb2-4ca0-a908-60c8d7b2da5f';
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const draw = (rosterId, positions) => ({
  id: rosterId, rosterId, side: 'front', coverage: 'opaque',
  positions: positions.map(Math.fround), indices: null, matrixWorld: identity,
});

test('matching nearest-hit witnesses cannot hide an intervening sliver', () => {
  const floor = draw(floorId, [-8, 0, -8, -8, 0, 6, 6, 0, -8]);
  const clear = evaluateDemo08SecondFootprint([floor], [0, 0, 0]);
  assert.equal(clear.coverage, 'uniform-floor');
  assert.equal(clear.status, 'geometry-only');

  const sliver = draw('sliver', [-2.82, 2, -2.83, -2.82, 2, -2.79, -2.79, 2, -2.83]);
  const uncertain = evaluateDemo08SecondFootprint([floor, sliver], [0, 0, 0]);
  assert.equal(uncertain.reason, 'footprint-not-proven');
  assert.equal(uncertain.witnesses.length, 5);
  assert.ok(uncertain.witnesses.every(hit => hit.id === floorId));

  const center = draw('blocker', [-2.84, 2, -2.92, -2.84, 2, -2.79, -2.76, 2, -2.92]);
  const mixed = evaluateDemo08SecondFootprint([floor, center], [0, 0, 0]);
  assert.equal(mixed.coverage, 'mixed');
  assert.equal(mixed.status, 'live-fallback');
  assert.deepEqual(new Set(mixed.witnesses.map(hit => hit.id)), new Set(['blocker', floorId]));
});

test('the private inspector requires a separately accepted snapshot digest before reading input', async () => {
  const result = await inspectAcceptedDemo08SecondFootprint({ sourceDir: '/never-read', snapshotPath: '/never-read' });
  assert.equal(result.reason, 'snapshot-acceptance-required');
});
