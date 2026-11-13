// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type { architecturalWallBoxes,WallFinish } from '@exhibitos/studio-contract';
import type {Exhibition} from '@exhibitos/spec';

type Point = readonly [number, number];
type Edge = readonly [Point, Point];
type Axis = 0 | 1;
type Panel = { min: Point; max: Point };
export type OpeningRevealCoverage={left:number;right:number;bottom:number;top:number;minZ:number;maxZ:number;omit:boolean};

/** Two explicitly connected slabs can overlap along the same reveal plane.
 * Draw their depth union once, on a deterministic world-normal side. Front/back
 * panels and physical solids remain unchanged. Only aligned, matching apertures
 * with overlapping depths qualify; other geometry retains the original shell. */
export function pairedOpeningRevealCoverage(three:typeof Three,document:Pick<Exhibition,'openings'>,surfaces:ReadonlyMap<string,Three.Group>,walls:readonly WallFinish[]){
 const result=new Map<string,OpeningRevealCoverage[]>(),depths=new Map(walls.map(w=>[w.surfaceId.toLowerCase(),w.depth])),visited=new Set<string>(),epsilon=1e-6;
 const put=(opening:Exhibition['openings'][number],minZ:number,maxZ:number,omit:boolean)=>{
  const id=opening.surfaceId.toLowerCase(),rows=result.get(id)??[];
  rows.push({left:Math.fround(opening.offset[0]-opening.dimensions.width/2),right:Math.fround(opening.offset[0]+opening.dimensions.width/2),bottom:Math.fround(opening.offset[1]-opening.dimensions.height/2),top:Math.fround(opening.offset[1]+opening.dimensions.height/2),minZ,maxZ,omit});result.set(id,rows);
 };
 for(const opening of document.openings){
  const id=opening.id.toLowerCase(),mate=document.openings.find(o=>o.id.toLowerCase()===opening.connectsToOpeningId?.toLowerCase());
  if(visited.has(id)||!mate||mate.id.toLowerCase()===id||mate.connectsToOpeningId?.toLowerCase()!==id||mate.surfaceId.toLowerCase()===opening.surfaceId.toLowerCase())continue;
  visited.add(id);visited.add(mate.id.toLowerCase());
  const a=surfaces.get(opening.surfaceId.toLowerCase()),b=surfaces.get(mate.surfaceId.toLowerCase()),depthA=depths.get(opening.surfaceId.toLowerCase()),depthB=depths.get(mate.surfaceId.toLowerCase());
  if(!a||!b||depthA===undefined||depthB===undefined)continue;
  a.updateWorldMatrix(true,false);b.updateWorldMatrix(true,false);
  const relative=a.matrixWorld.clone().invert().multiply(b.matrixWorld),e=relative.elements;
  // Relative X/Z reverse, Y agrees. Reject skew, tilted/nonmatching apertures,
  // disjoint depths and singular transforms rather than guessing a join.
  if(!e.every(Number.isFinite)||e[0]!>=0||e[5]!<=0||e[10]!>=0||[1,2,3,4,6,7,8,9,11].some(i=>Math.abs(e[i]!)>1e-9)||Math.abs(e[15]!-1)>1e-9)continue;
  const center=new three.Vector3(...mate.offset,0).applyMatrix4(relative),peerHalf=Math.abs(e[10]!)*depthB/2;
  if(Math.abs(center.x-opening.offset[0])>epsilon||Math.abs(center.y-opening.offset[1])>epsilon||Math.abs(Math.abs(e[0]!)*mate.dimensions.width-opening.dimensions.width)>epsilon||Math.abs(e[5]!*mate.dimensions.height-opening.dimensions.height)>epsilon||Math.min(depthA/2,center.z+peerHalf)-Math.max(-depthA/2,center.z-peerHalf)<=epsilon)continue;
  const normal=new three.Vector3(0,0,1).applyMatrix3(new three.Matrix3().getNormalMatrix(a.matrixWorld)).normalize(),owns=normal.toArray().find(n=>Math.abs(n)>1e-8)!>0;
  const inverse=relative.clone().invert().elements;if(!inverse.every(Number.isFinite)||Math.abs(inverse[15]!-1)>1e-9)continue;const otherHalf=Math.abs(inverse[10]!)*depthA/2;
  put(opening,Math.min(-depthA/2,center.z-peerHalf),Math.max(depthA/2,center.z+peerHalf),!owns);
  put(mate,Math.min(-depthB/2,inverse[14]!-otherHalf),Math.max(depthB/2,inverse[14]!+otherHalf),owns);
 }
 return result;
}

function coverageForEdge([a,b]:Edge,coverage:readonly OpeningRevealCoverage[]){
 return coverage.find(r=>a[0]===b[0]?(a[0]===r.left||a[0]===r.right)&&Math.min(a[1],b[1])>=r.bottom&&Math.max(a[1],b[1])<=r.top:
  (a[1]===r.bottom||a[1]===r.top)&&Math.min(a[0],b[0])>=r.left&&Math.max(a[0],b[0])<=r.right);
}

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
function wallOpeningShellData(boxes: ReturnType<typeof architecturalWallBoxes>,coverage:readonly OpeningRevealCoverage[]=[]) {
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
    const reveal=coverageForEdge([a,b],coverage);if(reveal?.omit)continue;
    const minZ=reveal?.minZ??-halfDepth,maxZ=reveal?.maxZ??halfDepth;
    const nx = Math.sign(b[1] - a[1]), ny = Math.sign(a[0] - b[0]);
    const am = vertex(a, minZ, nx, ny, 0), bm = vertex(b, minZ, nx, ny, 0);
    const ap = vertex(a, maxZ, nx, ny, 0), bp = vertex(b, maxZ, nx, ny, 0);
    indices.push(am, bm, bp, am, bp, ap);
  }
  return {positions,normals,indices};
}

export function wallOpeningShell(three: typeof Three, boxes: ReturnType<typeof architecturalWallBoxes>,coverage?:readonly OpeningRevealCoverage[]) {
  const {positions,normals,indices}=wallOpeningShellData(boxes,coverage);
  return new three.BufferGeometry()
    .setAttribute('position', new three.Float32BufferAttribute(positions, 3))
    .setAttribute('normal', new three.Float32BufferAttribute(normals, 3))
    .setIndex(indices);
}

/** Count CPU and GPU positions, normals, optional metric UVs, and UInt32 indices. */
export function wallOpeningShellReserve(boxes: ReturnType<typeof architecturalWallBoxes>, textured: boolean) {
  const {positions,indices}=wallOpeningShellData(boxes);
  return 2 * (positions.length / 3 * (textured ? 32 : 24) + indices.length * 4);
}
