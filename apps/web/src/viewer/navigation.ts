// SPDX-License-Identifier: AGPL-3.0-or-later
import RAPIER from "@dimforge/rapier3d-compat";
import { buildNavigationMesh, findNavigationPath, type NavigationMesh } from "./navigation-mesh";
import type { Exhibition } from "@exhibitos/spec";
export type Vec3 = [
    number,
    number,
    number
];
type Quat = [
    number,
    number,
    number,
    number
];
export const NAVIGATION_PROFILE = Object.freeze({ fixedStep: 1 / 60, maxFrameDelta: 0.25, maxSteps: 15, radius: 0.25, bodyHeight: 1.75, acceleration: 2.6, deceleration: 3.9, maxStepHeight: 0.25, minStepWidth: 0.3, maxSlopeDegrees: 35, slopeSlideDegrees: 45, skin: 0.01 });
export interface NavigationSettings {
    speed: 0.7 | 1.3 | 1.6;
    eyeHeight: number;
    reducedMotion: boolean;
}
export interface NavigationInput {
    forward: number;
    right: number;
    yaw?: number;
    paused?: boolean;
}
export interface NavigationState {
    eyePosition: Vec3;
    yaw: number;
    velocity: Vec3;
    grounded: boolean;
    steps: number;
    paused: boolean;
    blocked: boolean;
    recovered: boolean;
}
export interface CollisionVolume {
    center: Vec3;
    rotation: Quat;
    halfExtents: Vec3;
}
/** Floor support rectangle minus capsule-expanded static collision volumes; not a pathfinding navmesh. */
export interface WalkableRegion {
    roomId: string;
    surfaceId: string;
    corners: Vec3[];
    normal: Vec3;
    exclusions: CollisionVolume[];
    capsuleRadius: number;
    bodyHeight: number;
}
export interface NavigationController {
    advance: (dt: number, input: NavigationInput) => NavigationState;
    state: () => NavigationState;
    pause: () => void;
    setSettings: (settings: Partial<NavigationSettings>) => void;
    reset: (pose?: {
        position?: Vec3;
        yaw?: number;
    }) => NavigationState;
    dispose: () => void;
    readonly walkableRegions: readonly WalkableRegion[];
    readonly physicsVersion: string;
    isWalkable: (position: Vec3) => boolean;
    readonly navigationMesh: NavigationMesh;
    pathBetween: (fromEye: Vec3, toEye: Vec3) => Vec3[] | undefined;
}
let initialized: Promise<void> | undefined;
const v = (p: Vec3) => ({ x: p[0], y: p[1], z: p[2] });
const q = (p: Quat) => ({ x: p[0], y: p[1], z: p[2], w: p[3] });
function rotate(p: Vec3, r: Quat): Vec3 { const [x, y, z] = p, [qx, qy, qz, qw] = r, tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x); return [x + qw * tx + qy * tz - qz * ty, y + qw * ty + qz * tx - qx * tz, z + qw * tz + qx * ty - qy * tx]; }
function multiply(a: Quat, b: Quat): Quat { return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]]; }
const add = (a: Vec3, b: Vec3): Vec3 => a.map((n, i) => n + b[i]!) as Vec3;
const inverse = (r: Quat): Quat => [-r[0], -r[1], -r[2], r[3]];
const finite = (p: readonly number[]) => p.every(Number.isFinite);
function rigid(p: Exhibition["rooms"][number]["transform"]) {
    if (!finite([...p.position, ...p.rotation, ...p.scale]) || p.position.some(n => Math.abs(n) > 10000) || p.scale.some(n => n !== 1) || Math.abs(Math.hypot(...p.rotation) - 1) > 0.001)
        throw Error("NAVIGATION_GEOMETRY_UNSUPPORTED");
}
/** Exact wall-local rectangle partition: apertures remove colliders, including their true head/sill clearance. */
export function wallCollisionPanels(surface: Exhibition["surfaces"][number], openings: Exhibition["openings"]) {
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
export async function createNavigationController(doc: Exhibition, options: {
    position: Vec3;
    yaw?: number;
    eyeHeight?: number;
    speed?: 0.7 | 1.3 | 1.6;
    reducedMotion?: boolean;
}): Promise<NavigationController> {
    if (doc.rooms.length > 32 || doc.surfaces.length > 256 || doc.openings.length > 128 || doc.placements.length > 128 || !doc.rooms.length)
        throw Error("NAVIGATION_COMPLEXITY");
    await (initialized ??= RAPIER.init());
    const kinds = new Map<number, "floor" | "solid">(), regions: WalkableRegion[] = [], solids: CollisionVolume[] = [];
    const settings: NavigationSettings = { speed: options.speed ?? 1.3, eyeHeight: options.eyeHeight ?? 1.6, reducedMotion: options.reducedMotion ?? false };
    const checkSettings = (s: NavigationSettings) => {
        if (![0.7, 1.3, 1.6].includes(s.speed) || !Number.isFinite(s.eyeHeight) || s.eyeHeight < 1.2 || s.eyeHeight > 1.7 || typeof s.reducedMotion !== "boolean")
            throw Error("NAVIGATION_SETTINGS_INVALID");
    };
    checkSettings(settings);
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const rooms = new Map(doc.rooms.map(r => [r.id.toLowerCase(), r]));
    let colliderCount = 0;
    function box(position: Vec3, rotation: Quat, half: Vec3, kind: "floor" | "solid") {
        if (++colliderCount > 8192 || !finite(half) || half.some(n => n <= 0 || n > 10000))
            throw Error("NAVIGATION_COMPLEXITY");
        const c = world.createCollider(RAPIER.ColliderDesc.cuboid(...half).setTranslation(...position).setRotation(q(rotation)));
        kinds.set(c.handle, kind);
        if (kind === "solid")
            solids.push({ center: position, rotation, halfExtents: half });
    }
    function surface(s: Exhibition["surfaces"][number]) {
        const room = rooms.get(s.roomId.toLowerCase());
        if (!room)
            throw Error("NAVIGATION_REFERENCE");
        rigid(s.transform);
        const rot = multiply(room.transform.rotation, s.transform.rotation), origin = add(room.transform.position, rotate(s.transform.position, room.transform.rotation));
        const floor = s.type === "floor";
        for (const p of wallCollisionPanels(s, doc.openings)) {
            if (floor) {
                if (++colliderCount > 8192)
                    throw Error("NAVIGATION_COMPLEXITY");
                const points = [[-p.width / 2, -p.height / 2, 0], [p.width / 2, -p.height / 2, 0], [p.width / 2, p.height / 2, 0], [-p.width / 2, p.height / 2, 0]].map(a => add(origin, rotate([a[0]! + p.x, a[1]! + p.y, 0], rot)));
                const desc = RAPIER.ColliderDesc.trimesh(new Float32Array(points.flat()), new Uint32Array([0, 1, 2, 0, 2, 3]), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES);
                const c = world.createCollider(desc);
                kinds.set(c.handle, "floor");
                regions.push({ roomId: room.id, surfaceId: s.id, exclusions: solids, capsuleRadius: NAVIGATION_PROFILE.radius, bodyHeight: NAVIGATION_PROFILE.bodyHeight, normal: rotate([0, 0, 1], rot), corners: points });
            }
            else
                box(add(origin, rotate([p.x, p.y, 0], rot)), rot, [p.width / 2, p.height / 2, 0.01], "solid");
        }
    }
    let character: ReturnType<typeof world.createCollider> | undefined;
    try {
        for (const room of doc.rooms) {
            rigid(room.transform);
            if (!finite(Object.values(room.dimensions)) || Object.values(room.dimensions).some(n => n <= 0 || n > 10000))
                throw Error("NAVIGATION_GEOMETRY_UNSUPPORTED");
        }
        for (const opening of doc.openings)
            if (doc.surfaces.find(s => s.id.toLowerCase() === opening.surfaceId.toLowerCase())?.type !== "wall")
                throw Error("NAVIGATION_OPENING_UNSUPPORTED");
        for (const s of doc.surfaces)
            surface(s);
        // OES room volume has an implicit level base when no explicit floor is authored.
        for (const room of doc.rooms)
            if (!doc.surfaces.some(s => s.roomId.toLowerCase() === room.id.toLowerCase() && s.type === "floor"))
                surface({ id: `implicit-floor:${room.id}`, roomId: room.id, type: "floor", dimensions: { width: room.dimensions.width, height: room.dimensions.depth }, transform: { position: [0, 0, 0], rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], scale: [1, 1, 1] } });
        for (const p of doc.placements) {
            const room = rooms.get(p.roomId.toLowerCase()), art = doc.artworks.find(a => a.revisionId.toLowerCase() === p.artworkRevisionId.toLowerCase());
            if (!room || !art)
                throw Error("NAVIGATION_REFERENCE");
            if (!finite([...p.transform.position, ...p.transform.rotation, ...p.transform.scale]) || Math.abs(Math.hypot(...p.transform.rotation) - 1) > 0.001 || p.transform.scale.some(n => n <= 0 || n > 100))
                throw Error("NAVIGATION_GEOMETRY_UNSUPPORTED");
            const d = art.dimensions;
            if (art.units !== "meter")
                throw Error("NAVIGATION_GEOMETRY_UNSUPPORTED");
            box(add(room.transform.position, rotate(p.transform.position, room.transform.rotation)), multiply(room.transform.rotation, p.transform.rotation), [d.width * p.transform.scale[0] / 2, d.height * p.transform.scale[1] / 2, Math.max(0.002, (d.depth ?? 0.02) * p.transform.scale[2] / 2)], "solid");
        }
        const half = NAVIGATION_PROFILE.bodyHeight / 2, radius = NAVIGATION_PROFILE.radius;
        character = world.createCollider(RAPIER.ColliderDesc.capsule(half - radius, radius).setTranslation(0, 10000, 0));
        const controller = world.createCharacterController(NAVIGATION_PROFILE.skin);
        controller.setNormalNudgeFactor(0.001);
        controller.enableAutostep(0.25, 0.3, false);
        controller.enableSnapToGround(0.3);
        controller.setMaxSlopeClimbAngle(35 * Math.PI / 180);
        controller.setMinSlopeSlideAngle(45 * Math.PI / 180);
        world.timestep = NAVIGATION_PROFILE.fixedStep;
        world.step();
        let center: Vec3 = [0, 0, 0], yaw = options.yaw ?? 0, velocity: Vec3 = [0, 0, 0], accumulator = 0, steps = 0, paused = true, grounded = false, blocked = false, recovered = false, disposed = false;
        const shape = new RAPIER.Capsule(half - radius, radius), initial = structuredClone(options.position);
        const snapshot = (): NavigationState => ({ eyePosition: [center[0], center[1] - half + settings.eyeHeight, center[2]], yaw, velocity: [...velocity], grounded, steps, paused, blocked, recovered });
        const ensure = () => {
            if (disposed)
                throw Error("NAVIGATION_DISPOSED");
        };
        const inside = (p: Vec3) => doc.rooms.some(room => { const local = rotate(p.map((n, i) => n - room.transform.position[i]!) as Vec3, inverse(room.transform.rotation)); return Math.abs(local[0]) <= room.dimensions.width / 2 && Math.abs(local[2]) <= room.dimensions.depth / 2 && local[1] >= -0.02 && local[1] <= room.dimensions.height; });
        function groundInfo(x: number, z: number, foot: number) { const hit = world.castRayAndGetNormal(new RAPIER.Ray({ x, y: foot + 0.4, z }, { x: 0, y: -1, z: 0 }), 2, true, undefined, undefined, character, undefined, c => kinds.get(c.handle) === "floor"); return hit && hit.normal.y >= Math.cos(35 * Math.PI / 180) - 0.001 ? { height: foot + 0.4 - hit.timeOfImpact, normalY: hit.normal.y } : undefined; }
        function support(x: number, z: number, foot: number) { return groundInfo(x, z, foot)?.height; }
        function standingAt(eye: Vec3): Vec3 | undefined { const ground = groundInfo(eye[0], eye[2], eye[1] - settings.eyeHeight); return ground ? [eye[0], ground.height + half + (radius + 0.011) / ground.normalY - radius, eye[2]] : undefined; }
        function supported(p: Vec3) {
            const foot = p[1] - half;
            if (!inside([p[0], p[1] + half, p[2]]) || !inside([p[0], foot, p[2]]))
                return false;
            let highest = -Infinity;
            for (let i = 0; i < 8; i++) {
                const angle = i * Math.PI / 4, x = p[0] + Math.cos(angle) * radius, z = p[2] + Math.sin(angle) * radius, y = support(x, z, foot);
                if (!inside([x, p[1], z]) || y === undefined || Math.abs(y - foot) > 0.35)
                    return false;
                highest = Math.max(highest, y);
            }
            return highest >= foot - 0.09 && highest <= foot + radius * Math.tan(35 * Math.PI / 180) + 0.05;
        }
        function isWalkable(eye: Vec3) {
            ensure();
            if (!finite(eye))
                return false;
            const next = standingAt(eye);
            return !!next && supported(next) && !world.intersectionWithShape(v(next), q([0, 0, 0, 1]), shape, undefined, undefined, character);
        }
        function reset(pose: {
            position?: Vec3;
            yaw?: number;
        } = {}) {
            ensure();
            const eye = pose.position ?? initial, nextYaw = pose.yaw ?? options.yaw ?? 0;
            if (!finite(eye) || !Number.isFinite(nextYaw))
                throw Error("NAVIGATION_SPAWN_UNSAFE");
            const next = standingAt(eye);
            if (!next)
                throw Error("NAVIGATION_SPAWN_UNSAFE");
            if (!supported(next) || world.intersectionWithShape(v(next), q([0, 0, 0, 1]), shape, undefined, undefined, character))
                throw Error("NAVIGATION_SPAWN_UNSAFE");
            center = next;
            yaw = nextYaw;
            character!.setTranslation(v(center));
            world.step();
            velocity = [0, 0, 0];
            accumulator = 0;
            grounded = true;
            paused = true;
            blocked = false;
            recovered = false;
            return snapshot();
        }
        function corridorCovered(a: Vec3, b: Vec3) {
            for (let sample = -1; sample < 8; sample++) {
                const dx = sample < 0 ? 0 : Math.cos(sample * Math.PI / 4) * radius, dz = sample < 0 ? 0 : Math.sin(sample * Math.PI / 4) * radius, intervals: [
                    number,
                    number
                ][] = [];
                for (const region of regions) {
                    if (region.normal[1] < Math.cos(35 * Math.PI / 180) - 0.001)
                        continue;
                    let lo = 0, hi = 1;
                    const corners = region.corners, orientation = Math.sign(corners.reduce((sum, p, i) => { const n = corners[(i + 1) % 4]!; return sum + p[0] * n[2] - n[0] * p[2]; }, 0));
                    for (let i = 0; i < 4; i++) {
                        const p = corners[i]!, n = corners[(i + 1) % 4]!, ex = n[0] - p[0], ez = n[2] - p[2], start = orientation * (ex * (a[2] + dz - p[2]) - ez * (a[0] + dx - p[0])), rate = orientation * (ex * (b[2] - a[2]) - ez * (b[0] - a[0]));
                        if (Math.abs(rate) < 1e-10) {
                            if (start < -1e-8) {
                                hi = -1;
                                break;
                            }
                        }
                        else {
                            const t = (-1e-8 - start) / rate;
                            if (rate > 0)
                                lo = Math.max(lo, t);
                            else
                                hi = Math.min(hi, t);
                        }
                    }
                    // Clip the projected interval to reachable floor height as well as XZ.
                    // An overhead floor cannot supply support for a lower-floor gap.
                    const origin = corners[0]!, normal = region.normal;
                    const delta = origin[1] - (normal[0] * (a[0] + dx - origin[0]) + normal[2] * (a[2] + dz - origin[2])) / normal[1] - a[1];
                    const rate = -(normal[0] * (b[0] - a[0]) + normal[2] * (b[2] - a[2])) / normal[1] - (b[1] - a[1]);
                    const limit = NAVIGATION_PROFILE.maxStepHeight + 0.00001;
                    if (Math.abs(rate) < 1e-10) {
                        if (Math.abs(delta) > limit)
                            hi = -1;
                    }
                    else {
                        const t1 = (-limit - delta) / rate, t2 = (limit - delta) / rate;
                        lo = Math.max(lo, Math.min(t1, t2));
                        hi = Math.min(hi, Math.max(t1, t2));
                    }
                    if (lo <= hi)
                        intervals.push([Math.max(0, lo), Math.min(1, hi)]);
                }
                intervals.sort((x, y) => x[0] - y[0]);
                let reached = 0;
                for (const [lo, hi] of intervals) {
                    if (lo > reached + 1e-7)
                        break;
                    reached = Math.max(reached, hi);
                }
                if (reached < 1 - 1e-7)
                    return false;
            }
            return true;
        }
        function clearSegment(a: Vec3, b: Vec3) {
            if (!corridorCovered(a, b))
                return false;
            let previousFloor: number | undefined;
            for (let t = 0; t <= 1; t += 0.125) {
                const p = a.map((n, i) => n + (b[i]! - n) * t) as Vec3;
                const level = support(p[0], p[2], p[1]);
                if (level === undefined || (previousFloor !== undefined && Math.abs(level - previousFloor) > NAVIGATION_PROFILE.maxStepHeight + 0.00001))
                    return false;
                previousFloor = level;
            }
            const start = standingAt([a[0], a[1] + settings.eyeHeight, a[2]]), end = standingAt([b[0], b[1] + settings.eyeHeight, b[2]]);
            if (!start || !end)
                return false;
            const cast = (from: Vec3, to: Vec3, skin = 0) => world.castShape(v(from), q([0, 0, 0, 1]), v(to.map((n, i) => n - from[i]!) as Vec3), shape, skin, 1, true, undefined, undefined, character);
            const clear = (from: Vec3, to: Vec3) => Math.hypot(...to.map((n, i) => n - from[i]!)) < 1e-8 || !cast(from, to);
            if (clear(start, end))
                return true;
            if (Math.abs(a[1] - b[1]) > NAVIGATION_PROFILE.maxStepHeight + 0.00001)
                return false;
            // A legal riser requires the same approach, lift, traverse and landing sweeps
            // as the character motor, rather than a diagonal cast through the step face.
            const horizontalEnd: Vec3 = [end[0], start[1], end[2]], hit = cast(start, horizontalEnd, 0.011);
            const fraction = hit ? Math.max(0, hit.time_of_impact - 0.0001) : 1;
            const approach = start.map((n, i) => n + (horizontalEnd[i]! - n) * fraction) as Vec3;
            const height = Math.max(start[1], end[1]), raised: Vec3 = [approach[0], height, approach[2]], landing: Vec3 = [end[0], height, end[2]];
            return clear(start, approach) && clear(approach, raised) && clear(raised, landing) && clear(landing, end);
        }
        const navigationMesh = buildNavigationMesh(regions, { walkable: foot => { const level = support(foot[0], foot[2], foot[1]); return level !== undefined && Math.abs(level - foot[1]) < 0.005 && isWalkable([foot[0], foot[1] + settings.eyeHeight, foot[2]]); }, cellClear: corners => { const min = [0, 1, 2].map(i => Math.min(...corners.map(p => p[i]!))), max = [0, 1, 2].map(i => Math.max(...corners.map(p => p[i]!))), pos: Vec3 = [(min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2 + half + 0.051, (min[2]! + max[2]!) / 2], boxShape = new RAPIER.Cuboid((max[0]! - min[0]!) / 2 + radius, half + (max[1]! - min[1]!) / 2 + 0.04, (max[2]! - min[2]!) / 2 + radius); return !world.intersectionWithShape(v(pos), q([0, 0, 0, 1]), boxShape, undefined, undefined, character, undefined, c => kinds.get(c.handle) === "solid"); }, segmentClear: clearSegment });
        function pathBetween(fromEye: Vec3, toEye: Vec3) {
            ensure();
            if (!isWalkable(fromEye) || !isWalkable(toEye))
                return;
            const find = (eye: Vec3) => navigationMesh.cells.filter(c => Math.hypot(c.center[0] - eye[0], c.center[2] - eye[2]) <= navigationMesh.cellSize * 1.6 && Math.abs(c.center[1] - (eye[1] - settings.eyeHeight)) < 0.4 && clearSegment([eye[0], eye[1] - settings.eyeHeight, eye[2]], c.center)).sort((a, b) => Math.hypot(a.center[0] - eye[0], a.center[2] - eye[2]) - Math.hypot(b.center[0] - eye[0], b.center[2] - eye[2]))[0];
            const a = find(fromEye), b = find(toEye);
            return a && b ? findNavigationPath(navigationMesh, a.id, b.id) : undefined;
        }
        function stepFallback(desired: Vec3): Vec3 | undefined {
            const distance = Math.hypot(desired[0], desired[2]);
            if (distance < 1e-6)
                return;
            const dx = desired[0] / distance, dz = desired[2] / distance, foot = center[1] - half, lead = radius + distance + 0.03, level = support(center[0] + dx * lead, center[2] + dz * lead, foot);
            if (level === undefined)
                return;
            const base = support(center[0], center[2], foot);
            if (base === undefined || level - base > NAVIGATION_PROFILE.maxStepHeight + 0.00001)
                return;
            const rise = level - foot + 0.011;
            if (rise <= 0.02 || rise > NAVIGATION_PROFILE.maxStepHeight + 0.011)
                return;
            const landing = support(center[0] + dx * (lead + NAVIGATION_PROFILE.minStepWidth), center[2] + dz * (lead + NAVIGATION_PROFILE.minStepWidth), level);
            if (landing === undefined || Math.abs(landing - level) > 0.04)
                return;
            const up: Vec3 = [0, rise, 0], raised = add(center, up), horizontal: Vec3 = [desired[0], 0, desired[2]];
            if (world.castShape(v(center), q([0, 0, 0, 1]), v(up), shape, 0, 1, true, undefined, undefined, character) || world.castShape(v(raised), q([0, 0, 0, 1]), v(horizontal), shape, 0, 1, true, undefined, undefined, character))
                return;
            const next = add(raised, horizontal);
            return supported(next) ? next : undefined;
        }
        function descendFallback(next: Vec3): Vec3 | undefined {
            const foot = next[1] - half, floor = support(next[0], next[2], foot);
            if (floor === undefined || floor > foot || foot - floor > 0.35)
                return;
            const lower: Vec3 = [next[0], floor + half + 0.011, next[2]], delta = lower.map((n, i) => n - next[i]!) as Vec3;
            if (world.castShape(v(next), q([0, 0, 0, 1]), v(delta), shape, 0, 1, true, undefined, undefined, character))
                return;
            return supported(lower) ? lower : undefined;
        }
        reset();
        return { walkableRegions: structuredClone(regions), navigationMesh: structuredClone(navigationMesh), pathBetween, physicsVersion: RAPIER.version(), isWalkable, state: () => { ensure(); return snapshot(); }, pause: () => { ensure(); paused = true; velocity = [0, 0, 0]; accumulator = 0; }, setSettings: changes => { ensure(); const next = { ...settings, ...changes }; checkSettings(next); Object.assign(settings, next); }, reset, dispose: () => {
                if (!disposed) {
                    disposed = true;
                    world.free();
                }
            }, advance: (dt, input) => {
                ensure();
                if (!Number.isFinite(dt) || dt < 0 || !finite([input.forward, input.right, input.yaw ?? yaw]) || Math.abs(input.forward) > 1 || Math.abs(input.right) > 1)
                    throw Error("NAVIGATION_INPUT_INVALID");
                if (input.paused) {
                    paused = true;
                    velocity = [0, 0, 0];
                    accumulator = 0;
                    return snapshot();
                }
                paused = false;
                yaw = input.yaw ?? yaw;
                accumulator = Math.min(accumulator + Math.min(dt, NAVIGATION_PROFILE.maxFrameDelta), NAVIGATION_PROFILE.maxFrameDelta);
                blocked = false;
                recovered = false;
                let count = 0;
                while (accumulator + 1e-9 >= NAVIGATION_PROFILE.fixedStep && count++ < NAVIGATION_PROFILE.maxSteps) {
                    accumulator -= NAVIGATION_PROFILE.fixedStep;
                    steps++;
                    const len = Math.max(1, Math.hypot(input.forward, input.right)), forward = Math.max(-1, Math.min(1, input.forward)) / len, right = Math.max(-1, Math.min(1, input.right)) / len, target: Vec3 = [(-Math.sin(yaw) * forward + Math.cos(yaw) * right) * settings.speed, 0, (-Math.cos(yaw) * forward - Math.sin(yaw) * right) * settings.speed], moving = Math.hypot(target[0], target[2]) > 0, rate = (moving ? NAVIGATION_PROFILE.acceleration : NAVIGATION_PROFILE.deceleration) * NAVIGATION_PROFILE.fixedStep, delta = [target[0] - velocity[0], 0, target[2] - velocity[2]] as Vec3, distance = Math.hypot(delta[0], delta[2]);
                    velocity = distance <= rate ? target.map(n => n === 0 ? 0 : n) as Vec3 : add(velocity, delta.map(n => n / distance * rate) as Vec3);
                    controller.computeColliderMovement(character!, { x: velocity[0] / 60, y: -0.002, z: velocity[2] / 60 });
                    const movement = controller.computedMovement();
                    let next = add(center, [movement.x, movement.y, movement.z]);
                    grounded = controller.computedGrounded();
                    if (Math.hypot(movement.x - velocity[0] / 60, movement.z - velocity[2] / 60) > 0.001) {
                        blocked = true;
                        const step = grounded ? stepFallback([velocity[0] / 60, 0, velocity[2] / 60]) : undefined;
                        if (step) {
                            next = step;
                            blocked = false;
                            grounded = true;
                        }
                    }
                    if (!supported(next)) {
                        const down = descendFallback(next);
                        if (down) {
                            next = down;
                            center = next;
                            character!.setTranslation(v(center));
                            grounded = true;
                        }
                        else {
                            blocked = true;
                            recovered = true;
                            velocity = [0, 0, 0];
                        }
                    }
                    else {
                        center = next;
                        character!.setTranslation(v(center));
                    }
                    world.step();
                }
                return snapshot();
            } };
    }
    catch (error) {
        world.free();
        throw error;
    }
}
