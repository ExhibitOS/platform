// SPDX-License-Identifier: AGPL-3.0-or-later

const epsilon = 1e-5;
const goldenAngle = Math.PI * (3 - Math.sqrt(5));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const shift = (point, direction, distance) => point.map((value, axis) => value + direction[axis] * distance);
const delta = (a, b) => a.map((value, axis) => value - b[axis]);
const unit = value => value.map(channel => channel / Math.hypot(...value));

/** Exact planar occlusion for admitted room-surface panels. Openings are
 * represented by the existing surface partition's gaps. */
export function traceRoomDiffusePanels(panels) {
  return (origin, direction, limit) => {
    let front;
    let nearest = limit;
    for (const panel of panels) {
      const divisor = dot(panel.normal, direction);
      if (Math.abs(divisor) < 1e-10) continue;
      const distance = dot(panel.normal, delta(panel.center, origin)) / divisor;
      if (distance <= epsilon || distance >= nearest) continue;
      const position = shift(origin, direction, distance);
      const relative = delta(position, panel.center);
      if (Math.abs(dot(relative, panel.right)) > panel.widthMetres / 2 ||
          Math.abs(dot(relative, panel.up)) > panel.heightMetres / 2) continue;
      front = { position, normal: panel.normal, reflectance: panel.reflectance };
      nearest = distance;
    }
    return front;
  };
}

function directAtHit(hit, source, trace) {
  const from = shift(hit.position, hit.normal, epsilon);
  const toward = delta(source.position, from);
  const distance = Math.hypot(...toward);
  if (distance <= 2 * epsilon || (source.range && distance >= source.range)) return 0;
  const direction = toward.map(value => value / distance);
  const receives = dot(hit.normal, direction);
  if (receives <= 0) return 0;
  const facing = -dot(source.direction, direction);
  if (facing <= 0) return 0;
  let angular = facing;
  if (source.type === 'spot') {
    if (facing <= source.outerCosine) return 0;
    const fraction = facing >= source.innerCosine ? 1 :
      (facing - source.outerCosine) / (source.innerCosine - source.outerCosine);
    angular = fraction * fraction * (3 - 2 * fraction);
  }
  if (trace(from, direction, distance - epsilon)) return 0;
  const cutoff = source.range ? (1 - (distance / source.range) ** 4) ** 2 : 1;
  return source.candela * angular * receives * cutoff / distance ** 2;
}

function reflected(hit, sources, trace) {
  const irradiance = [0, 0, 0];
  for (const source of sources) {
    const direct = directAtHit(hit, source, trace);
    for (let channel = 0; channel < 3; channel++) {
      irradiance[channel] += direct * source.color[channel] * hit.reflectance[channel];
    }
  }
  return irradiance;
}

/** Split a constant-radiance rectangle into equal-flux Lambertian emitters.
 * The sum of their on-axis candela is the authored lumens divided by pi. */
export function diffuseAreaSamples({ position, normal, right, up, width, height, lumens, color }) {
  const samples = [];
  const count = 4;
  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      samples.push({
        type: 'lambertian',
        position: shift(shift(position, right, width * ((x + .5) / count - .5)), up,
          height * ((y + .5) / count - .5)),
        direction: normal,
        candela: lumens / (Math.PI * count ** 2),
        color,
      });
    }
  }
  return samples;
}

/** One diffuse reflection. All inputs and rays are room-local. The caller
 * provides the admitted nearest-hit geometry and returns undefined on escape,
 * including through a doorway. Output is linear incident RGB irradiance,
 * before receiver material, exposure or tone mapping. */
export function bakeRoomIndirectIrradiance({ trace, sources, chart, raysPerTexel = 64, signal }) {
  const { width, height, center, right, up, normal, widthMetres, heightMetres } = chart;
  const output = new Float32Array(width * height * 3);
  const unitSamples = Array.from({ length: raysPerTexel }, (_, i) => {
    const radius = Math.sqrt((i + .5) / raysPerTexel);
    const lateral = radius * Math.cos(i * goldenAngle);
    const vertical = radius * Math.sin(i * goldenAngle);
    return unit(shift(shift(normal.map(value => value * Math.sqrt(1 - radius ** 2)), right, lateral), up, vertical));
  });
  for (let y = 0; y < height; y++) {
    signal?.throwIfAborted();
    for (let x = 0; x < width; x++) {
      const origin = shift(shift(shift(center, right, widthMetres * ((x + .5) / width - .5)),
        up, heightMetres * ((y + .5) / height - .5)), normal, epsilon);
      const offset = (y * width + x) * 3;
      const result = [0, 0, 0];
      for (const direction of unitSamples) {
        const hit = trace(origin, direction, Infinity);
        if (!hit || dot(hit.normal, direction) >= 0) continue;
        const incoming = reflected(hit, sources, trace);
        // Cosine-weighted rays cancel the Lambertian 1/pi term.
        for (let channel = 0; channel < 3; channel++) result[channel] += incoming[channel];
      }
      for (let channel = 0; channel < 3; channel++) output[offset + channel] = result[channel] / raysPerTexel;
    }
  }
  return output;
}
