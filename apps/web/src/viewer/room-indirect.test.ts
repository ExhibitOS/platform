// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect, test} from 'vitest';
import * as three from 'three';
import {applyRoomIndirect, mountRoomIndirect} from './room-indirect';
import type {LoadedRoomIndirect} from '../private-static-room-indirect';

test('room indirect textures activate as a complete bounded group', () => {
  const materials = new Map<string, three.MeshStandardMaterial>();
  const source: LoadedRoomIndirect = {roomId: 'room', emitterIds: ['light'], scale: .12, charts: []};
  for (let i = 0; i < 6; i++) {
    const id = String(i);
    materials.set(id, new three.MeshStandardMaterial());
    source.charts.push({
      chart: {surfaceId: id, center: [0,0,0], right: [1,0,0], up: [0,1,0], normal: [0,0,1],
        widthMetres: 1, heightMetres: 1, width: 1, height: 1, texture: {sha256: 'hash', bytes: 4}},
      bytes: new Uint8Array([40,40,40,255]),
    });
  }
  const rooms = new Map([['room', new three.Group()]]);
  expect(mountRoomIndirect(three, [source], rooms, materials, 47, 64).receivers.size).toBe(0);
  const missing = new Map(materials);
  missing.delete('5');
  expect(mountRoomIndirect(three, [source], rooms, missing, 48, 64).receivers.size).toBe(0);

  const mounted = mountRoomIndirect(three, [source], rooms, materials, 48, 64);
  expect(mounted.reservedBytes).toBe(48);
  expect(mounted.receivers.size).toBe(6);
  const receiver = mounted.receivers.get(materials.get('0')!)!;
  expect(receiver.texture.colorSpace).toBe(three.NoColorSpace);
  const shader = {uniforms: {}, fragmentShader: '#include <lights_fragment_begin>\n#include <lights_fragment_end>'} as Parameters<three.Material['onBeforeCompile']>[0];
  applyRoomIndirect(shader, receiver.uniforms);
  expect(shader.fragmentShader).toContain('#include <lights_fragment_begin>');
  expect(shader.fragmentShader).toContain('float exhibitosIndirectScale');
  expect(shader.fragmentShader).toContain('indirectDiffuse += incoming * BRDF_Lambert');
  expect(shader.uniforms.exhibitosIndirectScale?.value).toBe(.12);
  mounted.dispose();
  expect(mounted.receivers.size).toBe(0);
  for (const material of materials.values()) material.dispose();
});
