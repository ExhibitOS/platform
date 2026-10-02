import { describe, it, expect } from "vitest";
import { createNavigationController, NAVIGATION_PROFILE, wallCollisionPanels } from "./navigation";
import { newDraft } from "../drafts/example";
import { createGeometryState, applyGeometryCommand } from "../geometry/model";
import { syntheticArtwork, newPlacement } from "../placement/model";
import type { Exhibition } from "@exhibitos/spec";
const id = () => crypto.randomUUID();
function room() { let s = createGeometryState(newDraft().candidate); s = applyGeometryCommand(s, { type: "white-cube", roomId: s.present.rooms[0]!.id }); s.present.artworks = []; s.present.placements = []; s.present.openings = []; return s.present; }
function walk(c: Awaited<ReturnType<typeof createNavigationController>>, seconds: number, hz = 60, input = { forward: 1, right: 0, yaw: 0 }) {
    for (let i = 0; i < seconds * hz; i++)
        c.advance(1 / hz, { ...input, paused: false });
    return c.state();
}
function slab(d: Exhibition, x: number, y: number, z: number, width: number, height: number, rotation: [
    number,
    number,
    number,
    number
] = [0, 0, 0, 1], type: "floor" | "wall" = "wall") {
    const s = { id: id(), roomId: d.rooms[0]!.id, type, dimensions: { width, height }, transform: { position: [x, y, z] as [
                number,
                number,
                number
            ], rotation, scale: [1, 1, 1] as [
                number,
                number,
                number
            ] } };
    d.surfaces.push(s);
    return s;
}
describe("real Rapier fixed-step first-person collision", () => {
    it("moves at all candidate speeds with acceleration/deceleration and equivalent15/30/60/120/144Hz distances", async () => {
        for (const speed of [0.7, 1.3, 1.6] as const) {
            const distances = [];
            for (const hz of [15, 30, 60, 120, 144]) {
                const c = await createNavigationController(room(), { position: [0, 1.6, 3], speed });
                try {
                    const p = walk(c, 2, hz);
                    distances.push(3 - p.eyePosition[2]);
                    expect(p.velocity[2]).toBeCloseTo(-speed, 4);
                    const steady = walk(c, 1, hz);
                    expect(Math.abs(p.eyePosition[2] - steady.eyePosition[2] - speed)).toBeLessThan(0.03);
                    for (let i = 0; i < hz; i++)
                        c.advance(1 / hz, { forward: 0, right: 0 });
                    expect(c.state().velocity).toEqual([0, 0, 0]);
                    expect(p.grounded).toBe(true);
                    expect(c.physicsVersion).toBe("0.21.0");
                }
                finally {
                    c.dispose();
                }
            }
            expect(Math.max(...distances) - Math.min(...distances)).toBeLessThan(0.025);
            expect(distances[0]).toBeLessThan(speed * 2);
            expect(distances[0]).toBeGreaterThan(speed * 1.5);
        }
    }, 30000);
    it("cannot pass walls or actual-size artwork including when bytes are not loaded", async () => {
        const d = room(), a = syntheticArtwork("sculpture");
        d.artworks = [a];
        d.placements = [newPlacement(a, d.rooms[0]!.id)];
        d.placements[0]!.transform.position = [0, 0.5, 0];
        const c = await createNavigationController(d, { position: [0, 1.6, 3] });
        try {
            const p = walk(c, 5);
            expect(p.eyePosition[2]).toBeGreaterThan(0.74);
            expect(p.blocked).toBe(true);
            c.reset({ position: [3, 1.6, 3] });
            const wall = walk(c, 10);
            expect(wall.eyePosition[2]).toBeGreaterThan(-3.76);
            expect(wall.blocked).toBe(true);
        }
        finally {
            c.dispose();
        }
    });
    it("passes real door cutout but adult capsule cannot squeeze through a low window when camera eye is lowered", async () => {
        for (const height of [2.3, 1.0]) {
            const d = room(), wall = slab(d, 0, 2, 0, 12, 4);
            d.openings = [{ id: id(), surfaceId: wall.id, type: height > 2 ? "door" : "window", offset: [0, -2 + height / 2], dimensions: { width: 1.2, height }, exterior: false }];
            expect(wallCollisionPanels(wall, d.openings).length).toBe(3);
            const c = await createNavigationController(d, { position: [0, 1.2, 2], eyeHeight: 1.2 });
            try {
                const p = walk(c, 3);
                if (height > 2)
                    expect(p.eyePosition[2]).toBeLessThan(-1);
                else
                    expect(p.eyePosition[2]).toBeGreaterThan(0.25);
            }
            finally {
                c.dispose();
            }
        }
    });
    it("rejects unsafe spawn/reset and unsupported transforms without mutating a safe state", async () => {
        const d = room(), c = await createNavigationController(d, { position: [0, 1.6, 0] });
        try {
            const before = c.state();
            expect(() => c.reset({ position: [100, 1.6, 0] })).toThrow("NAVIGATION_SPAWN_UNSAFE");
            expect(c.state()).toEqual(before);
            expect(() => c.setSettings({ eyeHeight: 0.6 })).toThrow("NAVIGATION_SETTINGS_INVALID");
            c.pause();
            const paused = c.advance(100, { forward: 1, right: 0, paused: true });
            expect(paused.eyePosition).toEqual(before.eyePosition);
            expect(paused.velocity).toEqual([0, 0, 0]);
            expect(paused.steps).toBe(0);
            c.advance(10, { forward: 1, right: 0 });
            expect(c.state().steps).toBe(NAVIGATION_PROFILE.maxSteps);
        }
        finally {
            c.dispose();
        }
        d.rooms[0]!.transform.scale = [2, 1, 1];
        await expect(createNavigationController(d, { position: [0, 1.6, 0] })).rejects.toThrow("NAVIGATION_GEOMETRY_UNSUPPORTED");
    });
    it("descends25cm from an independent top spawn and refuses larger drops", async () => {
        for (const height of [0.2, 0.25, 0.26, 0.3, 0.35]) {
            const d = room();
            slab(d, 0, height, -1, 4, 3, [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], "floor");
            slab(d, 0, height / 2, 0.5, 4, height);
            const c = await createNavigationController(d, { position: [0, 1.6 + height, -1] });
            try {
                const down = walk(c, 3, 60, { forward: -1, right: 0, yaw: 0 });
                if (height <= 0.25) {
                    expect(down.eyePosition[2]).toBeGreaterThan(1.5);
                    expect(down.eyePosition[1]).toBeLessThan(1.63);
                    expect(down.grounded).toBe(true);
                }
                else {
                    expect(down.eyePosition[2]).toBeLessThan(0.26);
                    expect(down.eyePosition[1]).toBeGreaterThan(1.6 + height - 0.02);
                    expect(down.recovered).toBe(true);
                }
            }
            finally {
                c.dispose();
            }
        }
    });
    it("climbs and descends steps through25cm and ramps through35degrees; rejects26cm steps and45degree slopes", async () => {
        for (const height of [0.2, 0.25, 0.26, 0.4]) {
            const d = room();
            slab(d, 0, height, -1, 4, 3, [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], "floor");
            slab(d, 0, height / 2, 0.5, 4, height);
            const c = await createNavigationController(d, { position: [0, 1.6, 2] });
            try {
                const p = walk(c, 3);
                if (height <= 0.25) {
                    expect(c.pathBetween([0, 1.6, 2], [0, 1.6 + height, -1])?.length).toBeGreaterThan(2);
                    expect(p.eyePosition[2]).toBeLessThan(0);
                    expect(p.eyePosition[1]).toBeGreaterThan(1.78);
                    const down = walk(c, 3, 60, { forward: -1, right: 0, yaw: 0 });
                    expect(down.eyePosition[1]).toBeLessThan(1.63);
                }
                else {
                    expect(p.eyePosition[2]).toBeGreaterThan(0.73);
                    expect(c.pathBetween([0, 1.6, 2], [0, 1.6 + height, -1])).toBeUndefined();
                }
            }
            finally {
                c.dispose();
            }
        }
        for (const angle of [20, 35, 45]) {
            const d = room(), theta = (-90 + angle) * Math.PI / 180, r: [
                number,
                number,
                number,
                number
            ] = [Math.sin(theta / 2), 0, 0, Math.cos(theta / 2)];
            const ramp = slab(d, 0, Math.sin(angle * Math.PI / 180) * 1.5, -1, 4, 3, r, "floor");
            const c = await createNavigationController(d, { position: [0, 1.6, 2] });
            try {
                const p = walk(c, 3);
                if (angle <= 35) {
                    expect(c.navigationMesh.cells.some(cell => cell.surfaceId === ramp.id)).toBe(true);
                    const target: [
                        number,
                        number,
                        number
                    ] = [0, 1.6 + Math.sin(angle * Math.PI / 180) * 1.5, -1];
                    expect(c.pathBetween([0, 1.6, 2], target)?.length).toBeGreaterThan(2);
                    expect(c.reset({ position: target }).grounded).toBe(true);
                    expect(p.eyePosition[2]).toBeLessThan(0);
                    expect(p.eyePosition[1]).toBeGreaterThan(1.85);
                }
                else
                    expect(p.eyePosition[2]).toBeGreaterThan(0.1);
            }
            finally {
                c.dispose();
            }
        }
    }, 20000);
    it("capsule-qualified triangle mesh connects adjacent room doors, excludes artwork and becomes disconnected behind closed wall", async () => {
        for (const open of [true, false]) {
            const d = room(), a = d.rooms[0]!, b = structuredClone(a);
            b.id = id();
            b.transform.position = [0, 0, -8];
            d.rooms.push(b);
            const copy = d.surfaces.map(s => ({ ...structuredClone(s), id: id(), roomId: b.id }));
            d.surfaces.push(...copy);
            if (open)
                for (const surface of d.surfaces.filter(s => (s.roomId === a.id && s.transform.position[2] === -4) || (s.roomId === b.id && s.transform.position[2] === 4)))
                    d.openings.push({ id: id(), surfaceId: surface.id, type: "door", offset: [0, -0.75], dimensions: { width: 1.4, height: 2.5 }, exterior: false });
            const art = syntheticArtwork();
            d.artworks = [art];
            d.placements = [newPlacement(art, a.id)];
            d.placements[0]!.transform.position = [-2, 0.5, 0];
            const c = await createNavigationController(d, { position: [0, 1.6, 3] });
            try {
                expect(c.navigationMesh.cells.length).toBeGreaterThan(100);
                expect(c.navigationMesh.cells.length).toBeLessThanOrEqual(4096);
                expect(c.navigationMesh.triangles.length).toBe(c.navigationMesh.cells.length * 2);
                expect(c.isWalkable([-2, 1.6, 0])).toBe(false);
                expect(c.navigationMesh.cells.some(cell => Math.abs(cell.center[0] + 2) < 0.5 && Math.abs(cell.center[2]) < 0.5)).toBe(false);
                const path = c.pathBetween([0, 1.6, 3], [0, 1.6, -9]);
                if (open) {
                    expect(path?.length).toBeGreaterThan(10);
                    expect(walk(c, 9).eyePosition[2]).toBeLessThan(-5);
                }
                else {
                    expect(path).toBeUndefined();
                    expect(walk(c, 9).eyePosition[2]).toBeGreaterThan(-3.76);
                }
            }
            finally {
                c.dispose();
            }
        }
    }, 20000);
    it("keeps separated floor panels disconnected even across a narrow gap", async () => {
        const d = room();
        d.surfaces = d.surfaces.filter(s => s.type !== "floor");
        const flat: [
            number,
            number,
            number,
            number
        ] = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
        slab(d, 0, 0, 1.05, 4, 2, flat, "floor");
        slab(d, 0, 0, -1.05, 4, 2, flat, "floor");
        const c = await createNavigationController(d, { position: [0, 1.6, 1.5] });
        try {
            expect(c.isWalkable([0, 1.6, 1.5])).toBe(true);
            expect(c.isWalkable([0, 1.6, -1.5])).toBe(true);
            expect(c.pathBetween([0, 1.6, 1.5], [0, 1.6, -1.5])).toBeUndefined();
            expect(walk(c, 4).eyePosition[2]).toBeGreaterThan(0.29);
        }
        finally {
            c.dispose();
        }
    });
    it("does not bridge a lower-floor gap using an unreachable upper floor projection", async () => {
        const d = room();
        d.surfaces = d.surfaces.filter(s => s.type !== "floor");
        const flat: [
            number,
            number,
            number,
            number
        ] = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
        slab(d, 0, 0, 1.045, 4, 2, flat, "floor");
        slab(d, 0, 0, -0.965, 4, 2, flat, "floor");
        slab(d, 0, 2.1, 0, 4, 6, flat, "floor");
        const c = await createNavigationController(d, { position: [0, 1.6, 1.5] });
        try {
            expect(c.isWalkable([0, 1.6, 1.5])).toBe(true);
            expect(c.isWalkable([0, 1.6, -1.5])).toBe(true);
            expect(c.pathBetween([0, 1.6, 1.5], [0, 1.6, -1.5])).toBeUndefined();
            const stopped = walk(c, 4);
            expect(stopped.eyePosition[2]).toBeGreaterThan(0.045);
            expect(stopped.recovered).toBe(true);
        }
        finally {
            c.dispose();
        }
    });
    it("prevents floor-edge falls and implicit-volume ceiling escape, including maximum eyeheight", async () => {
        const d = room();
        d.surfaces = d.surfaces.filter(s => s.type !== "floor");
        slab(d, 0, 0, 0, 2, 2, [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], "floor");
        const c = await createNavigationController(d, { position: [0, 1.7, 0], eyeHeight: 1.7 });
        try {
            const p = walk(c, 4);
            expect(p.eyePosition[2]).toBeGreaterThan(-0.76);
            expect(p.eyePosition[1]).toBeGreaterThan(1.69);
            expect(p.recovered).toBe(true);
            expect(() => c.setSettings({ eyeHeight: 1.9 })).toThrow("NAVIGATION_SETTINGS_INVALID");
        }
        finally {
            c.dispose();
        }
        d.rooms[0]!.dimensions.height = 1.7;
        d.surfaces = d.surfaces.filter(s => s.type === "floor");
        await expect(createNavigationController(d, { position: [0, 1.2, 0], eyeHeight: 1.2 })).rejects.toThrow("NAVIGATION_SPAWN_UNSAFE");
    }, 20000);
    it("applies translated/yaw-rotated room and artwork transforms exactly once", async () => {
        const d = room(), r = d.rooms[0]!;
        r.transform.position = [20, 0, 0];
        r.transform.rotation = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
        const a = syntheticArtwork();
        d.artworks = [a];
        d.placements = [newPlacement(a, r.id)];
        d.placements[0]!.transform.position = [0, 0.5, 0];
        const c = await createNavigationController(d, { position: [23, 1.6, 0], yaw: Math.PI / 2 });
        try {
            const p = walk(c, 5, 60, { forward: 1, right: 0, yaw: Math.PI / 2 });
            expect(p.eyePosition[0]).toBeGreaterThan(20.74);
            expect(p.eyePosition[0]).toBeLessThan(20.85);
            expect(Math.abs(p.eyePosition[2])).toBeLessThan(0.01);
            expect(c.navigationMesh.cells.some(cell => cell.center[0] > 20)).toBe(true);
        }
        finally {
            c.dispose();
        }
    }, 20000);
    it("rejects floor apertures explicitly instead of producing a mesh across a sampled hole", async () => { const d = room(), floor = d.surfaces.find(s => s.type === "floor")!; d.openings = [{ id: id(), surfaceId: floor.id, type: "door", offset: [0, 0], dimensions: { width: 0.2, height: 0.2 }, exterior: false }]; await expect(createNavigationController(d, { position: [0, 1.6, 0] })).rejects.toThrow("NAVIGATION_OPENING_UNSUPPORTED"); });
    it("normalizes equal-time diagonal input and bounds a stalled-frame collision at the wall", async () => {
        const straight = await createNavigationController(room(), { position: [0, 1.6, 2] }), diagonal = await createNavigationController(room(), { position: [0, 1.6, 2] });
        try {
            const a = walk(straight, 2), b = walk(diagonal, 2, 60, { forward: 1, right: 1, yaw: 0 }), diagonalDistance = Math.hypot(b.eyePosition[0], 2 - b.eyePosition[2]);
            expect(Math.abs(diagonalDistance - (2 - a.eyePosition[2]))).toBeLessThan(0.04);
            expect(diagonalDistance).toBeLessThanOrEqual(2 * 1.3 + 0.02);
        }
        finally {
            straight.dispose();
            diagonal.dispose();
        }
        const nearWall = await createNavigationController(room(), { position: [0, 1.6, -3.68], speed: 1.6 });
        try {
            const p = nearWall.advance(10, { forward: 1, right: 0 });
            expect(p.steps).toBe(15);
            expect(p.eyePosition[2]).toBeGreaterThan(-3.76);
            expect(p.eyePosition[2]).toBeLessThan(-3.70);
            expect(p.blocked).toBe(true);
        }
        finally {
            nearWall.dispose();
        }
    }, 20000);
});
