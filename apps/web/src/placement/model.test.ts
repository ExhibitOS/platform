import { describe, it, expect } from "vitest";
import { applyGeometryCommand, createGeometryState, undoGeometry, redoGeometry } from "../geometry/model";
import { newDraft } from "../drafts/example";
import { validateDraft } from "../drafts/validator";
import { newPlacement, newLight, syntheticArtwork, placementDimensions } from "./model";
import { PRESENTATION_NAMESPACE, validateStudioPresentation } from "@exhibitos/studio-contract";
function scene() { let state = createGeometryState(newDraft().candidate); state = applyGeometryCommand(state, { type: "white-cube", roomId: state.present.rooms[0]!.id }); for (const artworkType of ["sculpture", "image"] as const) {
    const artwork = syntheticArtwork(artworkType);
    state = applyGeometryCommand(state, { type: "add-artwork", artwork });
    state = applyGeometryCommand(state, { type: "add-placement", placement: newPlacement(artwork, state.present.rooms[0]!.id) });
} return state; }
describe("physical artwork placement and presentation commands", () => {
    it("places both complete public snapshots at actual meter dimensions and snap-aligns painting on transformed wall, reversible without modifying source", () => {
        const base = scene(), painting = base.present.placements[1]!, art = base.present.artworks[1]!;
        expect(placementDimensions(art, painting)).toEqual({ width: 1, height: 1, depth: 0.02 });
        expect(base.present.artworks[0]!.dimensions).toEqual({ width: 1, height: 1, depth: 1 });
        expect(base.present.placements[0]!.transform.position[1]).toBe(0.5);
        const wall = base.present.surfaces[3]!;
        const state = applyGeometryCommand(base, { type: "align-placement", id: painting.id, surfaceId: wall.id, offset: [0.36, 0.44], snap: 0.25 });
        expect(state.present.placements[1]!.transform.position[0]).toBeCloseTo(5.988);
        expect(state.present.placements[1]!.transform.position[1]).toBeCloseTo(2.5);
        expect(state.present.placements[1]!.transform.position[2]).toBeCloseTo(0.25);
        expect(state.present.placements[1]!.transform.rotation).toEqual(wall.transform.rotation);
        expect(state.present.placements[1]!.transform.scale).toEqual([1, 1, 1]);
        expect(undoGeometry(state).present).toEqual(base.present);
        expect(redoGeometry(undoGeometry(state)).present).toEqual(state.present);
    });
    it("rejects outside wall, opening overlap, missing artwork, invalid quaternion and dangling spotlight target without consuming history", () => {
        const base = scene(), p = base.present.placements[1]!, wall = base.present.surfaces[0]!;
        const before = JSON.stringify(base);
        const errors = [{ type: "align-placement", id: p.id, surfaceId: wall.id, offset: [6, 0], snap: 0 }, { type: "align-placement", id: p.id, surfaceId: wall.id, offset: [0, 0], snap: NaN }, { type: "add-placement", placement: { ...p, id: crypto.randomUUID(), artworkRevisionId: crypto.randomUUID() } }, { type: "set-placement", id: p.id, placement: { ...p, transform: { ...p.transform, rotation: [0, 0, 0, 2] } } }, { type: "add-light", light: { ...newLight(p.roomId, "spot"), targetPlacementId: crypto.randomUUID() } }] as Parameters<typeof applyGeometryCommand>[1][];
        for (const command of errors) {
            expect(() => applyGeometryCommand(base, command)).toThrow();
            expect(JSON.stringify(base)).toBe(before);
        }
        const opening = applyGeometryCommand(base, { type: "add-opening", opening: { id: crypto.randomUUID(), surfaceId: wall.id, type: "window", offset: [0, 0], dimensions: { width: 1, height: 1 } } });
        expect(() => applyGeometryCommand(opening, { type: "align-placement", id: p.id, surfaceId: wall.id, offset: [0, 0], snap: 0 })).toThrow("PLACEMENT_OVERLAPS_OPENING");
    });
    it("preserves manual transform, spotlight target/color/intensity, title, optional route and credits through complete public draft save validation", () => {
        let state = scene();
        const p = state.present.placements[0]!, roomId = p.roomId;
        state = applyGeometryCommand(state, { type: "set-placement", id: p.id, placement: { ...p, transform: { ...p.transform, position: [1, 0.5, 1], scale: [2, 1, 0.5] } } });
        state = applyGeometryCommand(state, { type: "add-light", light: { ...newLight(roomId, "spot"), color: [0.3, 0.5, 1], intensity: 450, targetPlacementId: p.id } });
        state = applyGeometryCommand(state, { type: "set-navigation", navigation: [{ id: crypto.randomUUID(), name: "Optional tour", accessible: true, waypoints: [{ roomId, position: [0, 1.6, 0] }] }] });
        state = applyGeometryCommand(state, { type: "set-title", title: "Placed exhibition" });
        state = applyGeometryCommand(state, { type: "set-presentation", presentation: { version: 1, credits: "Curated by synthetic fixture", startCamera: { roomId, position: [0, 1.6, 3], target: [0, 1.6, 0], fov: 60 }, viewpoints: [{ id: crypto.randomUUID(), name: "Sculpture view", roomId, position: [1, 1.6, 3], target: [1, 0.5, 1], fov: 50 }] } });
        const draft = newDraft();
        draft.exhibitionId = state.present.id;
        draft.candidate = state.present;
        expect(validateDraft(JSON.parse(JSON.stringify(draft))).valid).toBe(true);
        expect(state.present.accessibility.stationaryNavigation).toBe(true);
        expect(state.present.lights[0]!.targetPlacementId).toBe(p.id);
        expect(undoGeometry(state).present.extensions?.[PRESENTATION_NAMESPACE]).toBeUndefined();
        expect(() => applyGeometryCommand(state, { type: "remove-placement", id: p.id })).toThrow();
    });
    it("fails closed for invalid start cameras including NaN, out-of-room, same target, future version and unknown fields", () => {
        const state = scene(), roomId = state.present.rooms[0]!.id, camera = { roomId, position: [0, 1.6, 3], target: [0, 1.6, 0], fov: 60 };
        const extensions = [{ version: 2, viewpoints: [], credits: "" }, { version: 1, viewpoints: [], credits: "", freeNavigation: false }, ...[{ ...camera, fov: NaN }, { ...camera, fov: 180 }, { ...camera, position: [50, 1, 0] }, { ...camera, roomId: crypto.randomUUID() }, { ...camera, target: camera.position }].map(startCamera => ({ version: 1, viewpoints: [], credits: "", startCamera }))];
        for (const ext of extensions) {
            const doc = structuredClone(state.present);
            doc.extensions = { [PRESENTATION_NAMESPACE]: ext as unknown as NonNullable<typeof doc.extensions>[string] };
            expect(validateStudioPresentation(doc).valid).toBe(false);
        }
    });
});
it('preserves artwork affine during placement and accounts for shifted rotated dimensions at wall alignment',()=>{
 const art=syntheticArtwork();art.dimensions={width:1,height:2,depth:1};art.transform={position:[1,2,3],rotation:[0,0,Math.SQRT1_2,Math.SQRT1_2],scale:[2,1,1]};const p=newPlacement(art,'room');expect(p.transform.position[1]).toBe(0);const d=placementDimensions(art,p);expect(d.width).toBeCloseTo(2);expect(d.height).toBeCloseTo(2);expect(d.depth).toBeCloseTo(1);expect(art.transform.position).toEqual([1,2,3]);
});
