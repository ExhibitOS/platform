// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
import {alignedDoorPair, lightDetailsFor} from '@exhibitos/studio-contract';
import type * as Three from 'three';

const passageMetres = .5;
const boundaryTolerance = .002;
const lightChunk = '#include <lights_fragment_begin>';
const directAreaCall = 'RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
const materialHooks = new WeakMap<Three.Material, Three.Material['onBeforeCompile']>();
export const hasCeilingFillMaterialHook = (material: Three.Material) =>
  materialHooks.get(material) === material.onBeforeCompile;

const glsl = (value: number) => value.toFixed(9);
const components = (values: number[]) => values.map(glsl).join(', ');

function roomMask(
  three: typeof Three,
  doc: Exhibition,
  room: Exhibition['rooms'][number],
  group: Three.Group,
  index: number,
) {
  const id = room.id.toLowerCase();
  const surfaces = new Map(doc.surfaces.map(surface => [surface.id.toLowerCase(), surface]));
  const openings = new Map(doc.openings.map(opening => [opening.id.toLowerCase(), opening]));
  const worldToRoom = group.matrixWorld.clone().invert();
  const passages = [];
  for (const door of doc.openings) {
    const other = openings.get(door.connectsToOpeningId?.toLowerCase() ?? '');
    if (door.type !== 'door' || surfaces.get(door.surfaceId.toLowerCase())?.roomId.toLowerCase() !== id ||
      other?.type !== 'door' || other.connectsToOpeningId?.toLowerCase() !== door.id.toLowerCase()) continue;
    // Reuse the existing rigid face and coincident aperture checks. The pair
    // validator accepts two unconnected references, so strip just their links.
    const pair = {...doc, openings: [
      {...door, connectsToOpeningId: undefined}, {...other, connectsToOpeningId: undefined},
    ]};
    try {
      const {bottom, firstInterior} = alignedDoorPair(pair, door.id, other.id);
      const point = new three.Vector3(...bottom).applyMatrix4(worldToRoom);
      const inward = new three.Vector3(...firstInterior).transformDirection(worldToRoom);
      const verticalFeather = Math.min(.08, door.dimensions.height / 4);
      const edgeFeather = Math.min(.08, door.dimensions.width / 4);
      passages.push(`{
        vec3 offset = p - vec3(${components(point.toArray())});
        vec3 inward = vec3(${components(inward.toArray())});
        float distanceIn = dot(inward, offset);
        float widthRemaining = ${glsl(door.dimensions.width / 2)} - abs(dot(vec3(inward.z, 0.0, -inward.x), offset));
        float aperture = smoothstep(0.0, ${glsl(edgeFeather)}, widthRemaining)
          * (1.0 - smoothstep(${glsl(door.dimensions.height - verticalFeather)}, ${glsl(door.dimensions.height)}, offset.y));
        float doorway = smoothstep(-${glsl(passageMetres)}, ${glsl(passageMetres)}, distanceIn);
        if (inside) weight = min(weight, mix(1.0, doorway, aperture));
        else if (distanceIn <= 0.0) weight = max(weight, doorway * aperture);
      }`);
    } catch {
      // Unaligned pairs leave the room boundary opaque.
    }
  }
  return `float exhibitosRoomFill${index}(vec3 worldPoint, vec3 worldNormal) {
    mat4 roomFrame = mat4(${components(worldToRoom.elements)});
    vec3 p = (roomFrame * vec4(worldPoint, 1.0)).xyz;
    vec3 n = (roomFrame * vec4(worldNormal, 0.0)).xyz;
    if (p.y < -${glsl(boundaryTolerance)} || p.y > ${glsl(room.dimensions.height + boundaryTolerance)}) return 0.0;
    bool inside = abs(p.x) <= ${glsl(room.dimensions.width / 2 + boundaryTolerance)}
      && abs(p.z) <= ${glsl(room.dimensions.depth / 2 + boundaryTolerance)};
    // Coplanar room walls receive only the fill on the side they face.
    if (abs(p.x) >= ${glsl(room.dimensions.width / 2 - boundaryTolerance)} && sign(p.x)*n.x > .5) inside = false;
    if (abs(p.z) >= ${glsl(room.dimensions.depth / 2 - boundaryTolerance)} && sign(p.z)*n.z > .5) inside = false;
    float weight = inside ? 1.0 : 0.0;
    ${passages.join('\n')}
    return weight;
  }`;
}

/** Scope the existing LTC contribution for tagged room fills. No material,
 * render pass, light object, shadow map or light contribution is duplicated. */
export function installCeilingFillMask(
  three: typeof Three,
  doc: Exhibition,
  scene: Three.Scene,
  rooms: ReadonlyMap<string, Three.Group>,
  lights: ReadonlyMap<string, {light: Three.Light}>,
) {
  const tagged = new Set(lightDetailsFor(doc).filter(entry => entry.ceilingFill).map(entry => entry.lightId.toLowerCase()));
  if (!tagged.size) return;
  scene.updateMatrixWorld(true);
  const byObject = new Map<Three.RectAreaLight, string>();
  for (const item of doc.lights) {
    if (!tagged.has(item.id.toLowerCase())) continue;
    const room = doc.rooms.find(entry => entry.id.toLowerCase() === item.roomId.toLowerCase());
    const group = rooms.get(item.roomId.toLowerCase());
    const light = lights.get(item.id)?.light;
    if (room && group && light instanceof three.RectAreaLight) {
      byObject.set(light, roomMask(three, doc, room, group, byObject.size));
    }
  }

  const fragment = three.ShaderChunk.lights_fragment_begin;
  if (!fragment.includes(directAreaCall)) throw Error('ROOM_CEILING_FILL_SHADER');
  type Hook = {before: Three.Material['onBeforeCompile']; key: Three.Material['customProgramCacheKey'];
    hook: Three.Material['onBeforeCompile']; ownedKey: Three.Material['customProgramCacheKey']};
  const materials = new Map<Three.Material, Hook>();
  const indices = new Map([...byObject.keys()].map((light, i) => [light, i]));
  const definitions = [...byObject.values()].join('\n');
  let previousAssignments: string | undefined;
  let sourceKey = '', injectedLighting = '';

  const prepare = (camera: Three.Camera) => {
    const order: Three.RectAreaLight[] = [], receiving = new Set<Three.Material>();
    // Three r186 gathers lights in visible scene traversal order. Its stable
    // shadow/map sort leaves the relative order of passive RectAreaLights intact.
    scene.traverseVisible(object => {
      if (!object.layers.test(camera.layers)) return;
      if (object instanceof three.RectAreaLight) order.push(object);
      if (object instanceof three.Mesh) {
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (material instanceof three.MeshStandardMaterial) receiving.add(material);
        }
      }
    });
    const assignments = order.map((light, i) => {
      const zone = indices.get(light);
      return zone === undefined ? '' : `if (UNROLLED_LOOP_INDEX == ${i}) exhibitosFillWeight = exhibitosRoomFill${zone}(exhibitosFillWorld, exhibitosFillNormal);`;
    }).join('\n');
    if (previousAssignments !== assignments) {
      previousAssignments = assignments;
      sourceKey = assignments + definitions;
      injectedLighting = fragment.replace(directAreaCall, `{
        vec3 exhibitosFillWorld = ((vec4(geometryPosition, 1.0) - viewMatrix[3]) * viewMatrix).xyz;
        vec3 exhibitosFillNormal = (vec4(nonPerturbedNormal, 0.0) * viewMatrix).xyz;
        float exhibitosFillWeight = 1.0;
        ${assignments}
        if (exhibitosFillWeight > 0.0) {
          rectAreaLight.color *= exhibitosFillWeight;
          ${directAreaCall}
        }
      }`);
      for (const material of materials.keys()) material.needsUpdate = true;
    }
    for (const material of receiving) {
      if (materials.has(material)) continue;
      const before = material.onBeforeCompile, key = material.customProgramCacheKey;
      const baseKey = key.call(material);
      const hook: Three.Material['onBeforeCompile'] = (shader, renderer) => {
        before.call(material, shader, renderer);
        shader.fragmentShader = definitions + '\n' + shader.fragmentShader.replace(lightChunk, injectedLighting);
      };
      const ownedKey = () => baseKey + '|exhibitos-ceiling-fill-v1|' + sourceKey;
      material.onBeforeCompile = hook;
      material.customProgramCacheKey = ownedKey;
      materials.set(material, {before, key, hook, ownedKey});
      materialHooks.set(material, hook);
      material.needsUpdate = true;
    }
  };
  const dispose = () => {
    for (const [material, {before, key, hook, ownedKey}] of materials) {
      if (material.onBeforeCompile === hook) material.onBeforeCompile = before;
      if (material.customProgramCacheKey === ownedKey) material.customProgramCacheKey = key;
      if (materialHooks.get(material) === hook) materialHooks.delete(material);
      material.needsUpdate = true;
    }
    materials.clear();
  };
  return {prepare, dispose};
}
