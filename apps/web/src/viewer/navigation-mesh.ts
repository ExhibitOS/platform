// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Vec3, WalkableRegion } from "./navigation";
export interface NavigationCell {
    id: number;
    roomId: string;
    surfaceId: string;
    center: Vec3;
    vertices: [
        number,
        number,
        number,
        number
    ];
    neighbors: number[];
}
export interface NavigationMesh {
    version: 1;
    cellSize: number;
    coarsened: boolean;
    vertices: Vec3[];
    triangles: [
        number,
        number,
        number
    ][];
    cells: NavigationCell[];
}
export interface MeshQueries {
    walkable: (foot: Vec3) => boolean;
    cellClear: (corners: Vec3[]) => boolean;
    segmentClear: (a: Vec3, b: Vec3) => boolean;
}
const sum = (a: Vec3, b: Vec3, t: number): Vec3 => a.map((n, i) => n + b[i]! * t) as Vec3;
/** Bounded conservative clearance cells. Every cell footprint and graph edge is qualified by actual physics queries. */
export function buildNavigationMesh(regions: readonly WalkableRegion[], queries: MeshQueries): NavigationMesh {
    let cellSize = 0.25;
    const layouts = regions.filter(r => r.normal[1] >= Math.cos(35 * Math.PI / 180) - 0.001).map(r => { const a = r.corners[0]!, u = r.corners[1]!.map((n, i) => n - a[i]!) as Vec3, v = r.corners[3]!.map((n, i) => n - a[i]!) as Vec3; return { r, a, u, v, w: Math.hypot(...u), h: Math.hypot(...v) }; });
    const count = () => layouts.reduce((n, l) => n + Math.ceil(l.w / cellSize) * Math.ceil(l.h / cellSize), 0);
    while (count() > 4096) {
        cellSize *= 1.25;
        if (cellSize > 10000)
            throw Error("NAVIGATION_MESH_COMPLEXITY");
    }
    const mesh: NavigationMesh = { version: 1, cellSize, coarsened: cellSize > 0.25, vertices: [], triangles: [], cells: [] };
    for (const { r, a, u, v, w, h } of layouts) {
        const nx = Math.ceil(w / cellSize), ny = Math.ceil(h / cellSize), at = (x: number, y: number) => sum(sum(a, u, x / nx), v, y / ny);
        for (let y = 0; y < ny; y++)
            for (let x = 0; x < nx; x++) {
                const corners = [at(x, y), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1)], center = at(x + 0.5, y + 0.5);
                if (!queries.walkable(center) || corners.some(p => !queries.walkable(p)) || !queries.cellClear(corners))
                    continue;
                const offset = mesh.vertices.length;
                mesh.vertices.push(...corners);
                mesh.triangles.push([offset, offset + 1, offset + 2], [offset, offset + 2, offset + 3]);
                mesh.cells.push({ id: mesh.cells.length, roomId: r.roomId, surfaceId: r.surfaceId, center, vertices: [offset, offset + 1, offset + 2, offset + 3], neighbors: [] });
            }
    }
    // Spatial buckets bound neighborhood candidates; no all-pairs gallery graph scan.
    const range = cellSize * 1.6 + 0.5, buckets = new Map<string, NavigationCell[]>(), key = (x: number, z: number) => `${x},${z}`;
    for (const c of mesh.cells) {
        const x = Math.floor(c.center[0] / range), z = Math.floor(c.center[2] / range), k = key(x, z);
        buckets.set(k, [...(buckets.get(k) ?? []), c]);
    }
    let edges = 0;
    for (const c of mesh.cells) {
        const x = Math.floor(c.center[0] / range), z = Math.floor(c.center[2] / range);
        for (let dx = -1; dx <= 1; dx++)
            for (let dz = -1; dz <= 1; dz++)
                for (const other of buckets.get(key(x + dx, z + dz)) ?? []) {
                    if (other.id <= c.id || Math.hypot(other.center[0] - c.center[0], other.center[2] - c.center[2]) > (c.surfaceId === other.surfaceId ? cellSize * 1.6 : range) || Math.abs(other.center[1] - c.center[1]) > Math.max(0.25, range * Math.tan(35 * Math.PI / 180)))
                        continue;
                    if (!queries.segmentClear(c.center, other.center))
                        continue;
                    if (++edges > 32768)
                        throw Error("NAVIGATION_MESH_COMPLEXITY");
                    c.neighbors.push(other.id);
                    other.neighbors.push(c.id);
                }
    }
    return mesh;
}
export function findNavigationPath(mesh: NavigationMesh, from: number, to: number): Vec3[] | undefined {
    if (!mesh.cells[from] || !mesh.cells[to])
        return;
    const previous = new Map<number, number>(), seen = new Set([from]), queue = [from];
    let at = 0;
    while (at < queue.length) {
        const current = queue[at++]!;
        if (current === to) {
            const path: Vec3[] = [];
            for (let id = to;; id = previous.get(id)!) {
                path.push([...mesh.cells[id]!.center]);
                if (id === from)
                    break;
            }
            return path.reverse();
        }
        for (const neighbor of mesh.cells[current]!.neighbors)
            if (!seen.has(neighbor)) {
                seen.add(neighbor);
                previous.set(neighbor, current);
                queue.push(neighbor);
            }
    }
}
