// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Exhibition} from '@exhibitos/spec';
const finite=(values:number[])=>values.every(n=>Number.isFinite(n));
/** Existing centered XY hole partition, shared by renderer and collision. */
export function surfacePanels(surface: Exhibition["surfaces"][number], openings: Exhibition["openings"]) {
    const w = surface.dimensions.width, h = surface.dimensions.height;
    if (!finite([w, h]) || w <= 0 || h <= 0 || w > 10000 || h > 10000)
        throw Error("NAVIGATION_GEOMETRY_UNSUPPORTED");
    const holes = openings.filter(o => o.surfaceId.toLowerCase() === surface.id.toLowerCase()).map(o => ({ l: o.offset[0] - o.dimensions.width / 2, r: o.offset[0] + o.dimensions.width / 2, b: o.offset[1] - o.dimensions.height / 2, t: o.offset[1] + o.dimensions.height / 2 }));
    if (holes.some(o => !finite([o.l, o.r, o.b, o.t]) || o.r <= o.l || o.t <= o.b || o.l < -w / 2 || o.r > w / 2 || o.b < -h / 2 || o.t > h / 2))
        throw Error("NAVIGATION_OPENING_INVALID");
    const xs = [...new Set([-w / 2, w / 2, ...holes.flatMap(o => [o.l, o.r])])].sort((a, b) => a - b), panels: {
        x: number;
        y: number;
        width: number;
        height: number;
    }[] = [];
    for (let i = 0; i < xs.length - 1; i++) {
        const l = xs[i]!, r = xs[i + 1]!, mid = (l + r) / 2;
        let bottom = -h / 2;
        for (const o of holes.filter(o => mid > o.l && mid < o.r).sort((a, b) => a.b - b.b)) {
            if (o.b > bottom)
                panels.push({ x: mid, y: (o.b + bottom) / 2, width: r - l, height: o.b - bottom });
            bottom = Math.max(bottom, o.t);
        }
        if (bottom < h / 2)
            panels.push({ x: mid, y: (bottom + h / 2) / 2, width: r - l, height: h / 2 - bottom });
    }
    return panels;
}
