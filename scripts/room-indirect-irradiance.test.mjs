// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bakeRoomIndirectIrradiance, diffuseAreaSamples, traceRoomDiffusePanels } from './room-indirect-irradiance.mjs';

const black = [0, 0, 0];
const diffuse = [.7, .35, .175];
const makePlane = (center, right, up, normal, widthMetres = 4, heightMetres = 4, reflectance = black) =>
  ({ center, right, up, normal, widthMetres, heightMetres, reflectance });
const floor = makePlane([0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0], 4, 4, diffuse);
const ceiling = makePlane([0, 3, 0], [1, 0, 0], [0, 0, 1], [0, -1, 0]);
const wall = makePlane([2, 1.5, 0], [0, 0, 1], [0, 1, 0], [-1, 0, 0], 4, 3);
const down = diffuseAreaSamples({
  position: [0, 2.9, 0], normal: [0, -1, 0], right: [1, 0, 0], up: [0, 0, 1],
  width: 1, height: 1, lumens: Math.PI * 16, color: [1, 1, 1],
});
const readTile = (receiver, panels, sources = down) => bakeRoomIndirectIrradiance({
  trace: traceRoomDiffusePanels(panels), sources, chart: { ...receiver, width: 4, height: 4 }, raysPerTexel: 64,
});

test('a downward flux-controlled room emitter lights a ceiling and wall through diffuse floor reflection', () => {
  assert.equal(down.reduce((sum, sample) => sum + sample.candela, 0), 16);
  const surfaces = [floor, ceiling, wall];
  const ceilingTile = readTile(ceiling, surfaces);
  const wallTile = readTile(wall, surfaces);
  for (const tile of [ceilingTile, wallTile]) {
    assert.equal(tile.length, 48);
    assert(tile.every(value => Number.isFinite(value) && value > 0));
    for (let i = 0; i < tile.length; i += 3) {
      assert.equal(tile[i + 1], tile[i] / 2);
      assert.equal(tile[i + 2], tile[i] / 4);
    }
  }
  assert.deepEqual(readTile(ceiling, surfaces), ceilingTile);
  const blackFloor = { ...floor, reflectance: black };
  assert(readTile(ceiling, [blackFloor, ceiling, wall]).every(value => value === 0));
  assert(readTile(wall, [blackFloor, ceiling, wall]).every(value => value === 0));
});

test('opaque room geometry blocks transport, and a real gap lets a ray escape', () => {
  const screen = makePlane([0, 1.2, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0]);
  assert(readTile(ceiling, [floor, ceiling, wall, screen]).every(value => value === 0));
  const left = makePlane([-.75, 1.2, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0], 1.5, 4);
  const right = makePlane([.75, 1.2, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0], 1.5, 4);
  const wallWithGap = [{ ...left, center: [-1.25, 1.2, 0] }, { ...right, center: [1.25, 1.2, 0] }];
  const trace = traceRoomDiffusePanels(wallWithGap);
  assert.equal(trace([0, 1.5, 0], [0, -1, 0], Infinity), undefined);
  assert.equal(trace([1, 1.5, 0], [0, -1, 0], Infinity).position[1], 1.2);
  assert(readTile(ceiling, [floor, ceiling, wall, ...wallWithGap]).some(value => value > 0));
});

test('only a reached paired doorway without a definitely earlier hit leaves the chart live', () => {
  const receiver = makePlane([-1, 1.2, -1.8], [0, 0, 1], [0, 1, 0], [1, 0, 0], 1, 1);
  const aperture = makePlane([1, 1.2, .2], [0, 0, 1], [0, 1, 0], [-1, 0, 0], 1.2, 2.2);
  const preceding = makePlane([0, 1.2, -.8], [0, 0, 1], [0, 1, 0], [-1, 0, 0]);
  const paired = traceRoomDiffusePanels([aperture], { exitsOnly: true });
  const read = (panels, tracePairedDoorways) => bakeRoomIndirectIrradiance({
    trace: traceRoomDiffusePanels(panels), tracePairedDoorways, sources: down, raysPerTexel: 1,
    chart: { ...receiver, width: 1, height: 1 },
  });

  assert.deepEqual(read([]), new Float32Array(3));
  assert.equal(read([], paired), undefined);
  assert.equal(read([aperture], paired), undefined);
  assert.deepEqual(read([preceding], paired), read([preceding]));
  const elsewhere = traceRoomDiffusePanels([{ ...aperture, center: [1, 1.2, -1.2] }], { exitsOnly: true });
  assert.deepEqual(read([], elsewhere), read([]));
});
