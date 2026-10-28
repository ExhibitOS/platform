// SPDX-License-Identifier: AGPL-3.0-or-later
import { artifactCorners } from './artifact-affine.js';
import type { AffinePoint } from './artifact-affine.js';
import type { InstallationFrame } from './installation.js';

/** Actual gallery-frame source construction; no rabbet, backplate or support API. */
export const GALLERY_FRAME_PROFILE = {
  mouldingWidth: 0.025,
  depth: 0.035,
  bevel: 0.001,
  bevelSegments: 3,
  sourceOpening: [0.6, 0.8],
  artworkReferenceZ: -0.015,
} as const;

export type GalleryFrameProfileInput = {
  artwork: { width: number; height: number; depth: number };
  mat: [number, number];
  floatingGap: number;
};
export type GalleryFrameRail = {
  positions: number[];
  indices: number[];
  normals: number[];
  uv: number[];
};
export type GalleryFrameProfileIssue = {
  code: 'INVALID_INPUT' | 'SIZE_BOUNDS' | 'SHORT_STRAIGHT' | 'ARTWORK_BACK_PROTRUSION'
    | 'FLOAT32_DEGENERATE';
  message: string;
};
type Sizing = {
  aperture: { width: number; height: number };
  outer: { width: number; height: number; depth: number };
  mat: { x: number; y: number };
  floatingGap: number;
  mouldingWidth: number;
  bevel: number;
  artworkPlane: { z: number; support: 'unverified' };
};
export type GalleryFrameProfileResult =
  | { status: 'rejected'; issues: readonly GalleryFrameProfileIssue[] }
  | (Sizing & { status: 'ready'; rails: readonly GalleryFrameRail[];
      issues: readonly GalleryFrameProfileIssue[] });

const reject = (code: GalleryFrameProfileIssue['code'], message: string): GalleryFrameProfileResult =>
  ({ status: 'rejected', issues: [{ code, message }] });

/** Pure source-local metre fit. Never crops/scales the artwork or coerces two mat widths into one.
 * Regenerates only the rectangular path; physical section, depth and UV density stay fixed.
 */
export function galleryFrameProfile(input: GalleryFrameProfileInput): GalleryFrameProfileResult {
  if (!input || !input.artwork || !Array.isArray(input.mat) || input.mat.length !== 2)
    return reject('INVALID_INPUT', 'Expected artwork dimensions, two mat widths and a floating gap.');
  const { width, height, depth } = input.artwork;
  const [matX, matY] = input.mat;
  if (![width, height, depth, matX, matY, input.floatingGap].every(Number.isFinite)
      || width <= 0 || height <= 0 || depth < 0 || matX < 0 || matY < 0 || input.floatingGap < 0)
    return reject('INVALID_INPUT', 'Dimensions must be finite and positive; depth and margins may be zero.');
  // Same numeric margin/gap bounds as InstallationFrame, independently applied to X and Y.
  // They bound existing product sizing; they are not a claim of an authored asset scale range.
  const marginLimit: Extract<InstallationFrame, { kind: 'flat' | 'stepped' | 'floating' }>['matWidth'] = 0.5;
  if (matX > marginLimit || matY > marginLimit || input.floatingGap > 0.2)
    return reject('SIZE_BOUNDS', 'Mat widths must be at most 0.5 m and floating gap at most 0.2 m.');
  const aperture = { width: width + 2 * (matX + input.floatingGap),
    height: height + 2 * (matY + input.floatingGap) };
  const profile = GALLERY_FRAME_PROFILE;
  const outer = { width: aperture.width + 2 * profile.mouldingWidth,
    height: aperture.height + 2 * profile.mouldingWidth, depth: profile.depth };
  if (outer.width > 10000 || outer.height > 10000 || !Number.isFinite(outer.width + outer.height))
    return reject('SIZE_BOUNDS', 'Frame dimensions exceed the existing affine envelope.');
  // Two end bevels must leave a positive straight span; no guessed source GLB stretch zones.
  if (Math.min(aperture.width, aperture.height) <= 2 * profile.bevel)
    return reject('SHORT_STRAIGHT', 'The two 1 mm end bevels must leave a positive straight span.');
  if (profile.artworkReferenceZ + depth / 2 > 0)
    return reject('ARTWORK_BACK_PROTRUSION', 'Artwork at the authored reference plane protrudes behind the frame back.');
  const centre: AffinePoint = [0, 0, -profile.depth / 2];
  try {
    artifactCorners({ width, height, depth }, [], true);
    for (const [size, margin] of [[width, matX], [height, matY]]) {
      const half = size! / 2;
      if (margin! > 0 && Math.fround(half + margin!) === Math.fround(half)) throw Error('mat collapse');
      if (input.floatingGap > 0 && Math.fround(half + margin! + input.floatingGap)
          === Math.fround(half + margin!)) throw Error('gap collapse');
    }
    artifactCorners(outer, [{ position: centre, rotation: [0, 0, 0, 1], scale: [1, 1, 1] }], true);
    // A surviving outer hull alone cannot prove its thin section/bevel survives Float32.
    for (const half of [outer.width / 2, outer.height / 2]) {
      const samples = [half, half - profile.bevel * (1 - Math.cos(Math.PI / 6)),
        half - profile.bevel / 2, half - profile.bevel, half - profile.mouldingWidth];
      if (new Set(samples.map(Math.fround)).size !== samples.length) throw Error('profile collapse');
    }
  } catch {
    return reject('FLOAT32_DEGENERATE', 'The frame hull or source section collapses in Float32.');
  }
  const rails = makeRails(aperture.width, aperture.height);
  for (const rail of rails) for (let i = 0; i < rail.indices.length; i += 3) {
    const p = rail.indices.slice(i, i + 3).map(ix =>
      rail.positions.slice(ix * 3, ix * 3 + 3).map(Math.fround) as AffinePoint);
    if (Math.hypot(...cross(sub(p[1]!, p[0]!), sub(p[2]!, p[0]!))) <= 1e-12)
      return reject('FLOAT32_DEGENERATE', 'A source-section triangle collapses in Float32.');
  }
  return { status: 'ready', aperture, outer, mat: { x: matX, y: matY },
    floatingGap: input.floatingGap, mouldingWidth: profile.mouldingWidth, bevel: profile.bevel,
    artworkPlane: { z: profile.artworkReferenceZ, support: 'unverified' },
    rails, issues: [] };
}

// Source-derived consensus of corresponding horizontal/vertical midspan bevel samples.
// Main's explicit gallery-frame-only baseline tolerance is 50 micrometres, not a mesh waiver.
// Endpoint dimensions remain exactly physical .025/.035/.001; three edges per bevel arc.
const arc = [[0, 0.001], [0.00016760975122395716, 0.000505165429785852],
  [0.0005319654941558783, 0.00014081932022236504], [0.001, 0]] as const;
const section: readonly (readonly [number, number])[] = [
  ...arc,
  ...arc.map(([r, d]) => [0.025 - r, d] as const).reverse(),
  ...arc.map(([r, d]) => [0.025 - r, 0.035 - d] as const),
  ...arc.map(([r, d]) => [r, 0.035 - d] as const).reverse(),
];
const unit = (v: AffinePoint): AffinePoint => {
  const length = Math.hypot(...v);
  return v.map(x => x / length) as AffinePoint;
};
const cross = (a: AffinePoint, b: AffinePoint): AffinePoint =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a: AffinePoint, b: AffinePoint): AffinePoint => a.map((x, i) => x - b[i]!) as AffinePoint;
const dot = (a: AffinePoint, b: AffinePoint) => a.reduce((sum, x, i) => sum + x * b[i]!, 0);

/** Top, right, bottom, left; each convex rail has an exact pair of 45-degree planar mitre caps.
 * Adjacent caps coincide with opposite outward normals: no gap and no overlapping volume.
 * Internal cap normals remain hard; body normals are continuous around the rounded section.
 */
function makeRails(width: number, height: number): GalleryFrameRail[] {
  return [0, 1, 2, 3].map(side => {
    const horizontal = side % 2 === 0, sign = side < 2 ? 1 : -1;
    const length = horizontal ? width : height, base = (horizontal ? height : width) / 2;
    const centre: AffinePoint = horizontal ? [0, sign * (base + 0.0125), -0.0175]
      : [sign * (base + 0.0125), 0, -0.0175];
    const rail: GalleryFrameRail = { positions: [], indices: [], normals: [], uv: [] };
    const point = (i: number, end: number): AffinePoint => {
      const [r, depth] = section[i]!;
      return horizontal ? [end * (length / 2 + r), sign * (base + r), -depth]
        : [sign * (base + r), end * (length / 2 + r), -depth];
    };
    const edgeNormal = (i: number): [number, number] => {
      const a = section[i]!, b = section[(i + 1) % section.length]!;
      const dr = b[0] - a[0], dz = b[1] - a[1], norm = Math.hypot(dr, dz);
      return [dz / norm, -dr / norm];
    };
    const sectionNormal = (i: number): AffinePoint => {
      // Exact tangencies at straight/arc transitions, averaged facet normals within each arc.
      let n: [number, number];
      if (i === 0 || i === 15) n = [-1, 0];
      else if (i === 3 || i === 4) n = [0, -1];
      else if (i === 7 || i === 8) n = [1, 0];
      else if (i === 11 || i === 12) n = [0, 1];
      else {
        const a = edgeNormal((i + section.length - 1) % section.length), b = edgeNormal(i);
        n = [a[0] + b[0], a[1] + b[1]];
      }
      return unit(horizontal ? [0, sign * n[0], -n[1]] : [sign * n[0], 0, -n[1]]);
    };
    // Same source-author face projection/density: X/.66, Y/.86, depth/.035.
    // UVs may extend beyond [0,1] for a longer path; do not stretch them to fit the new rail.
    const uv = (p: AffinePoint, n: AffinePoint): [number, number] => {
      if (Math.abs(n[2]) >= Math.max(Math.abs(n[0]), Math.abs(n[1])))
        return [0.5 + p[0] / 0.66, 0.5 - p[1] / 0.86];
      if (Math.abs(n[0]) >= Math.abs(n[1])) return [-p[2] / 0.035, 0.5 - p[1] / 0.86];
      return [0.5 + p[0] / 0.66, 1 + p[2] / 0.035];
    };
    const vertex = (p: AffinePoint, normal: AffinePoint, projection: AffinePoint) => {
      const i = rail.positions.length / 3;
      rail.positions.push(...p); rail.normals.push(...normal); rail.uv.push(...uv(p, projection));
      return i;
    };
    const triangle = (a: number, b: number, c: number) => {
      const at = (i: number) => rail.positions.slice(i * 3, i * 3 + 3) as AffinePoint;
      const pa = at(a), pb = at(b), pc = at(c), normal = cross(sub(pb, pa), sub(pc, pa));
      const centroid = pa.map((x, i) => (x + pb[i]! + pc[i]!) / 3) as AffinePoint;
      rail.indices.push(...(dot(normal, sub(centroid, centre)) > 0 ? [a, b, c] : [a, c, b]));
    };
    for (let i = 0; i < section.length; i++) {
      const j = (i + 1) % section.length, ni = sectionNormal(i), nj = sectionNormal(j);
      const edge = edgeNormal(i), projection: AffinePoint = horizontal ? [0, sign * edge[0], -edge[1]]
        : [sign * edge[0], 0, -edge[1]];
      const a = vertex(point(i, -1), ni, projection), b = vertex(point(i, 1), ni, projection);
      const c = vertex(point(j, 1), nj, projection), d = vertex(point(j, -1), nj, projection);
      triangle(a, b, c); triangle(a, c, d);
    }
    for (const end of [-1, 1]) {
      const normal = unit(horizontal ? [end, -sign, 0] : [-sign, end, 0]);
      const ring = section.map((_, i) => vertex(point(i, end), normal, normal));
      for (let i = 1; i + 1 < ring.length; i++) triangle(ring[0]!, ring[i]!, ring[i + 1]!);
    }
    return rail;
  });
}
