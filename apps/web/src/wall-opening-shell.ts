// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type { architecturalWallBoxes } from '@exhibitos/studio-contract';

type Point = readonly [number, number];
type Edge = readonly [Point, Point];
type Axis = 0 | 1;
type Panel = { min: Point; max: Point };

/** Panel centers and widths can reconstruct the same edge a few double ULPs
 * apart. Choose one Float32 coordinate before building any face. */
function canonicalCoordinates(values: readonly number[]) {
  const result = new Map<number, number>();
  let anchor: number | undefined;
  for (const value of [...new Set(values)].sort((a, b) => a - b)) {
    if (anchor === undefined || value - anchor > 16 * Number.EPSILON * Math.max(1, Math.abs(value))) {
      anchor = value;
    }
    result.set(value, Math.fround(anchor));
  }
  return result;
}

function panelEdges({ min: [left, bottom], max: [right, top] }: Panel): Edge[] {
  return [[[left, bottom], [right, bottom]], [[right, bottom], [right, top]],
    [[right, top], [left, top]], [[left, top], [left, bottom]]];
}

function varyingAxis([from, to]: Edge): Axis {
  return from[0] === to[0] ? 1 : 0;
}

/** Render the exterior of the existing equal-depth wall panels. At a jamb,
 * neighboring panels subdivide the same edge at the head/sill breakpoints.
 * Collision still uses the original solids. */
export function wallOpeningShell(three: typeof Three, boxes: ReturnType<typeof architecturalWallBoxes>) {
  const raw = boxes.map(({ position: [x, y], dimensions: { width, height } }): Panel => ({
    min: [x - width / 2, y - height / 2], max: [x + width / 2, y + height / 2],
  }));
  const xs = canonicalCoordinates(raw.flatMap(p => [p.min[0], p.max[0]]));
  const ys = canonicalCoordinates(raw.flatMap(p => [p.min[1], p.max[1]]));
  const canonical = ([x, y]: Point): Point => [xs.get(x)!, ys.get(y)!];
  const panels = raw.map(({ min, max }) => ({ min: canonical(min), max: canonical(max) }));
  const breaks = [new Map<number, Set<number>>(), new Map<number, Set<number>>()] as const;
  for (const panel of panels) {
    for (const edge of panelEdges(panel)) {
      const axis = varyingAxis(edge), [from, to] = edge, fixed = from[1 - axis]!;
      const coords = breaks[axis].get(fixed) ?? new Set<number>();
      coords.add(from[axis]).add(to[axis]);
      breaks[axis].set(fixed, coords);
    }
  }

  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  const vertices = new Map<string, number>(), boundary = new Map<string, Edge>();
  const halfDepth = boxes[0]!.dimensions.depth / 2;
  function vertex([x, y]: Point, z: number, nx: number, ny: number, nz: number) {
    const key = `${x},${y},${z}/${nx},${ny},${nz}`;
    const existing = vertices.get(key);
    if (existing !== undefined) return existing;
    const index = positions.length / 3;
    vertices.set(key, index);
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    return index;
  }
  for (const panel of panels) {
    const center: Point = [(panel.min[0] + panel.max[0]) / 2, (panel.min[1] + panel.max[1]) / 2];
    const front = vertex(center, halfDepth, 0, 0, 1), back = vertex(center, -halfDepth, 0, 0, -1);
    for (const edge of panelEdges(panel)) {
      const axis = varyingAxis(edge), [from, to] = edge, fixed = from[1 - axis]!;
      const direction = Math.sign(to[axis] - from[axis]);
      const cuts = [...breaks[axis].get(fixed)!]
        .filter(value => (value - from[axis]) * direction >= 0 && (to[axis] - value) * direction >= 0)
        .sort((a, b) => (a - b) * direction);
      const points: Point[] = cuts.map(value => axis === 0 ? [value, fixed] : [fixed, value]);
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!, b = points[i]!;
        indices.push(front, vertex(a, halfDepth, 0, 0, 1), vertex(b, halfDepth, 0, 0, 1),
          back, vertex(b, -halfDepth, 0, 0, -1), vertex(a, -halfDepth, 0, 0, -1));
        if (!boundary.delete(`${b}:${a}`)) boundary.set(`${a}:${b}`, [a, b]);
      }
    }
  }
  // Only unmatched edges bound the outer wall or an opening reveal.
  for (const [a, b] of boundary.values()) {
    const nx = Math.sign(b[1] - a[1]), ny = Math.sign(a[0] - b[0]);
    const am = vertex(a, -halfDepth, nx, ny, 0), bm = vertex(b, -halfDepth, nx, ny, 0);
    const ap = vertex(a, halfDepth, nx, ny, 0), bp = vertex(b, halfDepth, nx, ny, 0);
    indices.push(am, bm, bp, am, bp, ap);
  }
  return new three.BufferGeometry()
    .setAttribute('position', new three.Float32BufferAttribute(positions, 3))
    .setAttribute('normal', new three.Float32BufferAttribute(normals, 3))
    .setIndex(indices);
}
