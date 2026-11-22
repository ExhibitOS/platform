// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {LoadedRoomIndirect} from '../private-static-room-indirect';

const lightEnd = '#include <lights_fragment_end>';

export function fixtureAdmittedIndirectRooms(
  sources: readonly LoadedRoomIndirect[],
  fixtureSupport: readonly {lightId: string; eligible: boolean}[],
) {
  const eligible = new Set(fixtureSupport.filter(record => record.eligible).map(record => record.lightId));
  return sources.filter(room => room.emitterIds.every(id => eligible.has(id)));
}

export function mountRoomIndirect(
  three: typeof Three,
  sources: readonly LoadedRoomIndirect[],
  rooms: ReadonlyMap<string, Three.Group>,
  materials: ReadonlyMap<string, Three.MeshStandardMaterial>,
  sceneBudget: number,
  maxTextureSize: number,
) {
  const receivers = new Map<Three.Material, {
    texture: Three.DataTexture;
    uniforms: Record<string, Three.IUniform>;
  }>();
  let reservedBytes = 0;

  for (const {roomId, scale, charts} of sources) {
    const group = rooms.get(roomId.toLowerCase());
    const bytes = charts.reduce((total, current) => total + current.bytes.byteLength * 2, 0);
    if (!group || reservedBytes + bytes > sceneBudget) continue;

    const bound = charts.map(current => ({
      ...current, material: materials.get(current.chart.surfaceId.toLowerCase()),
    }));
    if (!bound.every(entry => entry.material && !receivers.has(entry.material) &&
        Math.max(entry.chart.width, entry.chart.height) <= maxTextureSize) ||
        new Set(bound.map(entry => entry.material)).size !== charts.length) continue;

    group.updateWorldMatrix(true, false);
    const matrix = {value: group.matrixWorld.clone().invert()};
    for (const {chart, bytes, material} of bound) {
      const texture = new three.DataTexture(bytes, chart.width, chart.height, three.RGBAFormat);
      texture.minFilter = three.LinearFilter;
      texture.magFilter = three.LinearFilter;
      texture.needsUpdate = true;
      receivers.set(material!, {texture, uniforms: {
        exhibitosIndirectTexture: {value: texture},
        exhibitosIndirectRoom: matrix,
        exhibitosIndirectCenter: {value: new three.Vector3(...chart.center)},
        exhibitosIndirectRight: {value: new three.Vector3(...chart.right).divideScalar(chart.widthMetres)},
        exhibitosIndirectUp: {value: new three.Vector3(...chart.up).divideScalar(chart.heightMetres)},
        exhibitosIndirectNormal: {value: new three.Vector3(...chart.normal)},
        exhibitosIndirectScale: {value: scale},
      }});
    }
    reservedBytes += bytes;
  }

  return {
    receivers,
    reservedBytes,
    dispose() {
      for (const {texture} of receivers.values()) texture.dispose();
      receivers.clear();
    },
  };
}

export function applyRoomIndirect(
  shader: Parameters<Three.Material['onBeforeCompile']>[0], uniforms: Record<string, Three.IUniform>,
) {
  Object.assign(shader.uniforms, uniforms);
  shader.fragmentShader = `uniform sampler2D exhibitosIndirectTexture;
    uniform mat4 exhibitosIndirectRoom;
    uniform vec3 exhibitosIndirectCenter;
    uniform vec3 exhibitosIndirectRight;
    uniform vec3 exhibitosIndirectUp;
    uniform vec3 exhibitosIndirectNormal;
    uniform float exhibitosIndirectScale;
    ${shader.fragmentShader.replace(lightEnd, `${lightEnd}
      if (gl_FrontFacing) {
        vec3 indirectWorld = ((vec4(geometryPosition, 1.0) - viewMatrix[3]) * viewMatrix).xyz;
        vec3 indirectNormal = (vec4(nonPerturbedNormal, 0.0) * viewMatrix).xyz;
        vec3 indirectLocalNormal = mat3(exhibitosIndirectRoom) * indirectNormal;
        vec3 point = (exhibitosIndirectRoom * vec4(indirectWorld, 1.0)).xyz - exhibitosIndirectCenter;
        vec2 uv = vec2(dot(point, exhibitosIndirectRight), dot(point, exhibitosIndirectUp)) + vec2(0.5);
        if (dot(indirectLocalNormal, exhibitosIndirectNormal) > 0.99 &&
            abs(dot(point, exhibitosIndirectNormal)) <= 0.002 &&
            all(greaterThanEqual(uv, vec2(-0.0001))) && all(lessThanEqual(uv, vec2(1.0001)))) {
          vec3 incoming = texture2D(exhibitosIndirectTexture, uv).rgb * exhibitosIndirectScale;
          reflectedLight.indirectDiffuse += incoming * BRDF_Lambert(material.diffuseContribution);
        }
      }`)}`;
}
