// SPDX-License-Identifier: AGPL-3.0-or-later
import {ensureRoomBaseLight, LIGHT_DETAILS_NAMESPACE, setSpaceLighting, validateStudioLightDetails} from '@exhibitos/studio-contract';
import * as three from 'three';
import {expect, test} from 'vitest';
import {newDraft} from '../drafts/example';
import {syntheticArtwork} from '../placement/model';
import {galleryLightingFor, hasAuthoredGalleryLighting} from '../light-details-renderer';
import {retireArtworkResources} from './artwork-ownership';
import {applyDiffuseFloorReferenceEnvironment,hasDiffuseFloorReferenceEnvironmentHook} from './render-quality';
import {hasCeilingFillMaterialHook, installCeilingFillMask} from './ceiling-fill';
import {isLocalDiffuseReceiverTrial,resolveLocalDiffuseReceivers} from './local-diffuse-receiver-trial';
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
  return {camera, document, lights, mask, material, mesh, room, untaggedArea, scene, rooms};
}

test('admits the five saved default fills alongside legacy fills, and rejects an unknown mode', () => {
  const draft = newDraft().candidate;
  const template = draft.rooms[0]!;
  // Dimensions and canonical lumens of the five r215 room envelopes.
  const fills = [
    [8, 10, 393.9477973320593],
    [4, 10, 293.84127306534356],
    [11, 4, 313.9216206216657],
    [4, 4, 186.31766634982088],
    [10, 10, 451.08184843040203],
  ] as const;
  draft.rooms = fills.map(([width, depth]) => ({
    ...template, id: crypto.randomUUID(), dimensions: {width, depth, height: 4},
  }));
  const legacy = draft.rooms.reduce((document, room) => ensureRoomBaseLight(document, room.id, undefined, .5), draft);
  expect(validateStudioLightDetails(legacy).valid).toBe(true);
  expect(galleryLightingFor(legacy)).toMatchObject({roomOnly:false, fallbackSun:true, baselineIntensity:2.5});

  const marked = structuredClone(legacy);
  const details = marked.extensions![LIGHT_DETAILS_NAMESPACE] as {lights: Array<{ceilingFill: {mode?: string}}>};
  for (const [i, [, , intensity]] of fills.entries()) {
    marked.lights[i]!.intensity = intensity;
    details.lights[i]!.ceilingFill.mode = 'default';
  }
  expect(validateStudioLightDetails(marked).valid).toBe(true);
  expect(galleryLightingFor(marked)).toMatchObject({
    roomOnly:true, fallbackSun:false, baselineIntensity:0, environmentBaselineIntensity:0, reflectionIntensity:0,
  });

  details.lights[0]!.ceilingFill.mode = 'unknown';
  expect(validateStudioLightDetails(marked)).toMatchObject({
    valid:false, errors:[expect.objectContaining({code:'LIGHT_DETAILS_CEILING_FILL'})],
  });
});

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

function shaderFor(material: three.Material) {
  const shader = {
    uniforms: {} as Record<string, three.IUniform>,
    vertexShader: three.ShaderLib.standard.vertexShader,
    fragmentShader: three.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader as Parameters<three.Material['onBeforeCompile']>[0], {} as three.WebGLRenderer);
  return shader;
}
const fragment = (material: three.Material) => shaderFor(material).fragmentShader;

test('ceiling return tracks only the visible marked fill and its verified underside material', () => {
  const {camera, document, lights, material: floor, mesh, room, scene, rooms, mask: priorMask} = fixture();
  priorMask.dispose();
  const marked = structuredClone(document);
  const sourceRoom = marked.rooms[0]!;
  const foreignRoom = {...sourceRoom, id: crypto.randomUUID()};
  marked.rooms.push(foreignRoom);
  const [area] = marked.lights;
  const detail = (marked.extensions![LIGHT_DETAILS_NAMESPACE] as {lights: Array<{ceilingFill: {mode?: string}}>}).lights[0]!;
  detail.ceilingFill.mode = 'default';
  area!.intensity *= 5;
  const ceiling = {
    id: crypto.randomUUID(), roomId: sourceRoom.id, type: 'ceiling' as const,
    dimensions: {width: sourceRoom.dimensions.width, height: sourceRoom.dimensions.depth},
    transform: {position: [0, sourceRoom.dimensions.height, 0], rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2], scale: [1, 1, 1]},
  } satisfies (typeof marked.surfaces)[number];
  const foreignCeiling = {...ceiling, id: crypto.randomUUID(), roomId: foreignRoom.id};
  marked.surfaces = [ceiling, foreignCeiling];
  expect(validateStudioLightDetails(marked).valid).toBe(true);

  const underside = new three.MeshStandardMaterial(), foreign = new three.MeshStandardMaterial();
  room.add(new three.Mesh(mesh.geometry, underside), new three.Mesh(mesh.geometry, foreign));
  const ceilingMaterials = new Map([[ceiling.id, underside], [foreignCeiling.id, foreign]]);
  const emitter = lights.get(area!.id)!.light;
  const uniform = 'exhibitosCeilingIrradiance';
  function install(doc: typeof marked) {
    const surfaces = galleryLightingFor(doc).roomOnly ? ceilingMaterials : undefined;
    const mask = installCeilingFillMask(three, doc, scene, rooms, lights, surfaces)!;
    mask.prepare(camera);
    return mask;
  }

  const actual = install(marked);
  const shader = shaderFor(underside);
  expect(shader.fragmentShader).toContain('if (gl_FrontFacing)');
  expect(shader.fragmentShader).toContain('reflectedLight.indirectDiffuse += vec3(exhibitosCeilingIrradiance)');
  expect(shader.uniforms[uniform]!.value).toBe(.12);
  for (const material of [floor, foreign]) {
    expect(shaderFor(material).uniforms[uniform]).toBeUndefined();
    expect(fragment(material)).toContain('exhibitosRoomFill');
  }
  emitter.intensity = 10;
  actual.prepare(camera);
  expect(shader.uniforms[uniform]!.value).toBe(.3);
  room.visible = false;
  actual.prepare(camera);
  expect(shader.uniforms[uniform]!.value).toBe(0);
  room.visible = true;
  emitter.intensity = .5;
  actual.prepare(camera);
  expect(shader.uniforms[uniform]!.value).toBe(.06);
  actual.dispose();

  const explicit = setSpaceLighting(marked, {version: 1, baselineIntensity: .2, reflectionIntensity: .1});
  const wrongCeiling = structuredClone(marked);
  wrongCeiling.surfaces[0]!.transform.position[1] -= .1;
  for (const value of [document, explicit, wrongCeiling]) {
    const mask = install(value);
    expect(shaderFor(underside).uniforms[uniform]).toBeUndefined();
    mask.dispose();
  }
  mesh.geometry.dispose();
  [floor, underside, foreign].forEach(material => material.dispose());
});

test('local receiving trial binds one exact wall and one uniquely placed ordinary image to their own marked fill', () => {
  const {camera, document, lights, material: floor, mesh, room, scene, rooms, mask: priorMask} = fixture();
  priorMask.dispose();
  const owner = document.rooms[0]!;
  const outside = {...owner, id: crypto.randomUUID()};
  document.rooms.push(outside);
  const [area] = document.lights;
  const detail = (document.extensions![LIGHT_DETAILS_NAMESPACE] as {lights: Array<{ceilingFill: {mode?: string}}>}).lights[0]!;
  detail.ceilingFill.mode = 'default';
  area!.intensity *= 5;
  const wall = {
    id: crypto.randomUUID(), roomId: owner.id, type:'wall' as const,
    dimensions: {width: owner.dimensions.width, height: owner.dimensions.height},
    transform:{position:[0,2,-owner.dimensions.depth/2],rotation:[0,0,0,1],scale:[1,1,1]},
  } satisfies (typeof document.surfaces)[number];
  const outsideWall = {...wall,id:crypto.randomUUID(),roomId:outside.id};
  document.surfaces = [wall,outsideWall];
  const image = syntheticArtwork('image'), artworkRevisionId = image.revisionId;
  document.artworks.push(image);
  const placement = {id:crypto.randomUUID(),roomId:owner.id,artworkRevisionId,transform:wall.transform,assetId:image.primaryAssetId};
  document.placements.push(placement);
  const trial = {
    publicationId:crypto.randomUUID(),revisionSha256:'1'.repeat(64),indexSha256:'2'.repeat(64),
    wallId:wall.id,placementId:placement.id,
  };
  expect(isLocalDiffuseReceiverTrial(trial)).toBe(true);
  expect(isLocalDiffuseReceiverTrial({...trial,unsealed:true})).toBe(false);
  expect(resolveLocalDiffuseReceivers(document,{...trial,indexSha256:undefined},trial)).toBeUndefined();
  expect(resolveLocalDiffuseReceivers(document,{...trial,revisionSha256:'3'.repeat(64)},trial)).toBeUndefined();
  expect(resolveLocalDiffuseReceivers(document,trial,{...trial,wallId:outsideWall.id})).toBeUndefined();
  const repeated = {...document,placements:[placement,{...placement,id:crypto.randomUUID()}]};
  expect(resolveLocalDiffuseReceivers(repeated,trial,trial)).toBeUndefined();
  const selection = resolveLocalDiffuseReceivers(document,trial,trial);
  expect(selection).toEqual({wallId:wall.id,artworkRevisionId,fillLightId:area!.id});

  const wallMaterial = new three.MeshStandardMaterial(), artwork = new three.MeshStandardMaterial();
  const foreign = new three.MeshStandardMaterial(), neighbor = new three.MeshStandardMaterial();
  for (const material of [wallMaterial,artwork,foreign,neighbor]) room.add(new three.Mesh(mesh.geometry,material));
  const surfaceMaterials = new Map([[wall.id,wallMaterial],[outsideWall.id,foreign]]);
  const mask = installCeilingFillMask(three,document,scene,rooms,lights,surfaceMaterials,selection)!;
  mask.bindTrialImage(artworkRevisionId,artwork);
  mask.bindTrialImage(crypto.randomUUID(),neighbor);
  mask.prepare(camera);
  const wallShader = shaderFor(wallMaterial), artworkShader = shaderFor(artwork);
  const returnUniform = 'exhibitosCeilingIrradiance';
  const roomReturn = wallShader.uniforms[returnUniform]!;
  expect(wallShader.fragmentShader).toContain('gl_FrontFacing && dot(exhibitosReceiverInward');
  expect(wallShader.uniforms.exhibitosReceiverInward?.value.toArray()).toEqual([0,0,1]);
  expect(artworkShader.fragmentShader).toContain('if (gl_FrontFacing)');
  expect(artworkShader.uniforms[returnUniform]).toBe(roomReturn);
  expect(roomReturn.value).toBe(.12);
  for (const material of [floor,foreign,neighbor]) expect(shaderFor(material).uniforms[returnUniform]).toBeUndefined();
  lights.get(area!.id)!.light.visible = false;
  mask.prepare(camera);
  expect(roomReturn.value).toBe(0);
  mask.dispose();
  mesh.geometry.dispose();
  [floor,wallMaterial,artwork,foreign,neighbor].forEach(material=>material.dispose());
});

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

test('scene retirement unwinds support contact and ceiling fill back to the owned floor shader', async () => {
  const {camera, mask, material, mesh, room} = fixture();
  applyDiffuseFloorReferenceEnvironment(material);
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
  expect(composed).toContain('beforeEnvironmentSpecular');

  await retireArtworkResources([{dispose: () => mask.dispose(contacts.dispose)}]);
  expect(hasSupportContactMaterialHook(material)).toBe(false);
  expect(hasCeilingFillMaterialHook(material)).toBe(false);
  expect(hasDiffuseFloorReferenceEnvironmentHook(material)).toBe(true);
  expect(material.onBeforeCompile).toBe(before);
  expect(material.customProgramCacheKey).toBe(three.Material.prototype.customProgramCacheKey);
  mesh.geometry.dispose();
  material.dispose();
});


test('upper angular direct spot terms compose with area and contact, including spot reordering', () => {
  const {camera, document, lights, material, mesh, room, scene, rooms, mask: oldMask} = fixture();
  oldMask.dispose();
  const spot = new three.SpotLight();
  const other = new three.SpotLight();
  other.castShadow = true;
  room.add(spot, other);
  const id = crypto.randomUUID(), cutoffAngle = .16, softnessAngle = .24;
  document.lights.push({...document.lights[0]!, id, type: 'spot', unit: 'candela', beamAngle: .7});
  const existing = document.extensions?.[LIGHT_DETAILS_NAMESPACE];
  if (!existing || typeof existing !== 'object' || Array.isArray(existing) || !Array.isArray(existing.lights)) {
    throw Error('Expected the test fixture ceiling-fill bindings');
  }
  document.extensions = {...document.extensions, [LIGHT_DETAILS_NAMESPACE]: {version: 1, lights: [
    ...existing.lights,
    {lightId: id, fixture: 'none', angularProfile: {version: 1, kind: 'upper-framing', cutoffAngle, softnessAngle}},
  ]}};
  lights.set(id, {light: spot});
  const mask = installCeilingFillMask(three, document, scene, rooms, lights)!;
  const before = material.onBeforeCompile;
  mask.prepare(camera);
  const contacts = installSupportContactShadows(three, [{
    room, receiver: mesh, position: [0, .002, 0], rotation: [0, 0, 0, 1], width: .2, height: .2,
  }], false, () => {});
  contacts.setView(camera);
  const shader = shaderFor(material);
  expect(shader.fragmentShader).toContain('exhibitosRoomFill');
  expect(shader.fragmentShader).toContain('contactStrength');
  expect(shader.fragmentShader).toMatch(/#if UNROLLED_LOOP_INDEX == 1\s+\{\s+vec4 exhibitosUpperPlane/);
  const uniform = shader.uniforms.exhibitosUpperAngularPlanes!;
  expect(uniform.value[0].toArray()).toEqual([0, Math.cos(cutoffAngle), Math.sin(cutoffAngle), Math.fround(1 / Math.sin(softnessAngle))]);

  const key = material.customProgramCacheKey();
  spot.rotateZ(Math.PI / 2);
  mask.prepare(camera);
  expect(material.customProgramCacheKey()).toBe(key);
  expect(uniform.value[0].x).toBeCloseTo(-Math.cos(cutoffAngle));
  other.visible = false;
  mask.prepare(camera);
  expect(fragment(material)).toMatch(/#if UNROLLED_LOOP_INDEX == 0\s+\{\s+vec4 exhibitosUpperPlane/);
  expect(material.customProgramCacheKey()).not.toBe(key);

  const activeKey = material.customProgramCacheKey();
  spot.visible = false;
  mask.prepare(camera);
  const inactiveShader = shaderFor(material);
  expect(inactiveShader.fragmentShader).not.toContain('uniform vec4 exhibitosUpperAngularPlanes');
  expect(inactiveShader.uniforms.exhibitosUpperAngularPlanes).toBe(uniform);
  spot.visible = true;
  mask.prepare(camera);
  expect(material.customProgramCacheKey()).toBe(activeKey);
  // Returning to a cached active program may reuse the inactive compile's dictionary.
  expect(inactiveShader.uniforms.exhibitosUpperAngularPlanes!.value[0].x).toBeCloseTo(-Math.cos(cutoffAngle));

  mask.dispose(contacts.dispose);
  expect(material.onBeforeCompile).toBe(before);
  mesh.geometry.dispose();
  material.dispose();
});
