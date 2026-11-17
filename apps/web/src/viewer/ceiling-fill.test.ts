// SPDX-License-Identifier: AGPL-3.0-or-later
import {ensureRoomBaseLight, LIGHT_DETAILS_NAMESPACE} from '@exhibitos/studio-contract';
import * as three from 'three';
import {expect, test} from 'vitest';
import {newDraft} from '../drafts/example';
import {hasAuthoredGalleryLighting} from '../light-details-renderer';
import {retireArtworkResources} from './artwork-ownership';
import {hasCeilingFillMaterialHook, installCeilingFillMask} from './ceiling-fill';
import {hasSupportContactMaterialHook, installSupportContactShadows} from './shadows';

function fixture(supplemental = false) {
  const draft = newDraft().candidate;
  const roomId = draft.rooms[0]!.id;
  const document = ensureRoomBaseLight(draft, roomId, undefined, .5);
  const room = new three.Group();
  const light = new three.RectAreaLight();
  const untaggedArea = new three.RectAreaLight();
  const material = new three.MeshStandardMaterial();
  const mesh = new three.Mesh(new three.BoxGeometry(), material);
  const scene = new three.Scene();
  room.add(untaggedArea, light, mesh);
  scene.add(room);
  const rooms = new Map([[roomId, room]]);
  const lights = new Map<string, {light: three.Light}>([[document.lights[0]!.id, {light}]]);
  if (supplemental) {
    const pointDocument = ensureRoomBaseLight(draft, roomId);
    const base = pointDocument.lights[0]!;
    const point = new three.PointLight(0xffffff, base.intensity, 10);
    const area = document.lights[0]!;
    document.lights.unshift(base);
    document.extensions = {...document.extensions, [LIGHT_DETAILS_NAMESPACE]: {
      version: 1,
      lights: [
        {lightId: base.id, fixture: 'none', purpose: 'room-base', range: 10},
        {lightId: area.id, fixture: 'none', purpose: 'room-supplemental-fill',
          basePlacement: 'auto', ceilingFill: {version: 1, brightness: .5}},
      ],
    }};
    lights.set(base.id, {light: point});
    room.add(point);
  }
  const camera = new three.PerspectiveCamera(70, 1, .1, 100);
  camera.position.set(0, 1, 3);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const mask = installCeilingFillMask(three, document, scene, rooms, lights)!;
  return {camera, document, lights, mask, material, mesh, room, untaggedArea};
}

test('a supplemental ceiling fill masks its area contribution without changing the gallery fallback or legacy point', () => {
  const {camera, document, lights, mask, material, mesh} = fixture(true);
  const [base, area] = document.lights;
  const legacyPoint = lights.get(base!.id)!.light;
  expect(hasAuthoredGalleryLighting(document)).toBe(false);
  expect(hasAuthoredGalleryLighting({
    ...document, lights: [...document.lights, {...area!, id: crypto.randomUUID()}],
  })).toBe(true);

  mask.prepare(camera);
  expect(fragment(material)).toContain('UNROLLED_LOOP_INDEX == 1');
  expect(fragment(material)).not.toContain('UNROLLED_LOOP_INDEX == 0');
  expect(legacyPoint).toBeInstanceOf(three.PointLight);
  expect(legacyPoint).toMatchObject({intensity: 16, distance: 10});

  mask.dispose();
  mesh.geometry.dispose();
  material.dispose();
});

function fragment(material: three.Material) {
  const shader = {
    uniforms: {},
    vertexShader: three.ShaderLib.standard.vertexShader,
    fragmentShader: three.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader as Parameters<three.Material['onBeforeCompile']>[0], {} as three.WebGLRenderer);
  return shader.fragmentShader;
}

test('mask follows the visible area roster and releases a retired model material', () => {
  const {camera, mask, material, mesh, untaggedArea} = fixture();
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey;
  mask.prepare(camera);
  expect(fragment(material)).toContain('UNROLLED_LOOP_INDEX == 1');
  expect(fragment(material)).not.toContain('UNROLLED_LOOP_INDEX == 0');
  untaggedArea.visible = false;
  mask.prepare(camera);
  expect(fragment(material)).toContain('UNROLLED_LOOP_INDEX == 0');
  expect(fragment(material)).not.toContain('UNROLLED_LOOP_INDEX == 1');

  mesh.removeFromParent();
  material.dispose();
  expect(hasCeilingFillMaterialHook(material)).toBe(false);
  expect(material.onBeforeCompile).toBe(before);
  expect(material.customProgramCacheKey).toBe(key);
  mask.dispose();
  mesh.geometry.dispose();
});

test('ordinary scene retirement unwinds support contact before its ceiling-fill material hook', async () => {
  const {camera, mask, material, mesh, room} = fixture();
  const before = material.onBeforeCompile;
  mask.prepare(camera);
  const contacts = installSupportContactShadows(three, [{
    room, receiver: mesh, position: [0, .002, 0], rotation: [0, 0, 0, 1], width: .2, height: .2,
  }], false, () => {});
  contacts.setView(camera);
  expect(hasSupportContactMaterialHook(material)).toBe(true);
  const composed = fragment(material);
  expect(composed).toContain('exhibitosRoomFill');
  expect(composed).toContain('contactStrength');

  await retireArtworkResources([{dispose: () => mask.dispose(contacts.dispose)}]);
  expect(hasSupportContactMaterialHook(material)).toBe(false);
  expect(hasCeilingFillMaterialHook(material)).toBe(false);
  expect(material.onBeforeCompile).toBe(before);
  expect(material.customProgramCacheKey).toBe(three.Material.prototype.customProgramCacheKey);
  mesh.geometry.dispose();
  material.dispose();
});
