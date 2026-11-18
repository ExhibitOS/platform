// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import {LIGHT_DETAILS_LIMITS, type LightDetails} from '@exhibitos/studio-contract';

type Profile = NonNullable<LightDetails['angularProfile']>;
const spotInfo = 'getSpotLightInfo( spotLight, geometryPosition, directLight );';
const name = 'exhibitosUpperAngularPlanes';

export function createUpperAngularLighting(
  three: typeof Three,
  profiles: ReadonlyMap<Three.SpotLight, Profile>,
) {
  const slotCount = profiles.size;
  if (!slotCount) return;
  if (slotCount > LIGHT_DETAILS_LIMITS.bindings) throw Error('UPPER_ANGULAR_SPOT_LIMIT');
  const slots = new Map([...profiles.keys()].map((spot, index) => [spot, index]));
  const planes = Array.from({length: slotCount}, () => new three.Vector4());
  const uniform = {value: planes};
  const localUpPlanes = [...profiles].map(([spot, {cutoffAngle, softnessAngle}]) => {
    const inverse = Math.fround(1 / Math.sin(softnessAngle));
    if (!Number.isFinite(inverse) || inverse <= 0) throw Error('UPPER_ANGULAR_SPOT_RANGE');
    return {spot, inverse, normal: new three.Vector3(0, Math.cos(cutoffAngle), Math.sin(cutoffAngle))};
  });
  const q = new three.Quaternion();
  const world = new three.Vector3();
  return {
    definitions: `uniform vec4 ${name}[${slotCount}];`,
    applyUniform(uniforms: Record<string, Three.IUniform>) {
      uniforms[name] = uniform;
    },
    prepare(spots: readonly Three.SpotLight[]) {
      for (const [slot, {spot, inverse, normal}] of localUpPlanes.entries()) {
        spot.getWorldQuaternion(q);
        world.copy(normal).applyQuaternion(q);
        planes[slot]!.set(world.x, world.y, world.z, inverse);
      }
      // Match the pinned Three r186 WebGLLights stable sort among the visible
      // spot roster. Area sources preserve their relative traversal order.
      const order = [...spots].sort((a, b) =>
        (b.castShadow ? 2 : 0) - (a.castShadow ? 2 : 0) + (b.map ? 1 : 0) - (a.map ? 1 : 0));
      return order.flatMap((spot, index) => {
        const slot = slots.get(spot);
        if (slot === undefined) return [];
        return [`#if UNROLLED_LOOP_INDEX == ${index}
          {
            vec4 exhibitosUpperPlane = ${name}[${slot}];
            vec3 exhibitosEmittedRay = (-vec4(directLight.direction, 0.0) * viewMatrix).xyz;
            directLight.color *= 1.0 - smoothstep(0.0, 1.0,
              dot(exhibitosUpperPlane.xyz, exhibitosEmittedRay) * exhibitosUpperPlane.w);
          }
        #endif`];
      }).join('\n');
    },
    inject(chunk: string, assignments: string) {
      if (!assignments) return chunk;
      if (chunk.split(spotInfo).length !== 2) throw Error('UPPER_ANGULAR_SPOT_SHADER');
      return chunk.replace(spotInfo, spotInfo + '\n' + assignments);
    },
  };
}
