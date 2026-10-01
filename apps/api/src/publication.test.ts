// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fixtureURL, validateExhibition, type Exhibition } from "@exhibitos/spec";
import { sha256 } from "@exhibitos/storage";
import { MATERIAL_NAMESPACE, PRESENTATION_NAMESPACE, validateStudioMaterials, validateStudioPresentation } from "@exhibitos/studio-contract";
import { projectPublication } from "./publication.ts";
describe("immutable anonymous publication projection", () => {
    it("remaps all references, strips private and foreign extensions, and inventories actual qualified bytes", async () => {
        const candidate = JSON.parse(await readFile(fixtureURL("oes/v1/examples/exhibition.json"), "utf8")) as Exhibition;
        candidate.extensions = { "private.example/notes": { secret: "Private authoring extension" }, [MATERIAL_NAMESPACE]: { version: 1, surfaces: { [candidate.surfaces[0]!.id]: { color: "#112233", roughness: 0.5, metalness: 0 } } }, [PRESENTATION_NAMESPACE]: { version: 1, viewpoints: [], credits: "Public credit", startCamera: { roomId: candidate.rooms[0]!.id, position: [0, 1.6, 3], target: [0, 1.6, 0], fov: 60 } } };
        for (const artwork of candidate.artworks)
            artwork.extensions = { "org.exhibitos.studio/cms": { tenantId: "10000000-0000-4000-8000-000000000001", artworkId: artwork.id, revision: artwork.revision }, "private.example/capture": { secret: "Original capture note" } };
        const before = structuredClone(candidate);
        const prepared = candidate.artworks.map(a => ({ artwork: a, sourceAssetId: a.primaryAssetId, sourceSha256: a.assets[0]!.sha256, bytes: Buffer.from(`Qualified synthetic derivative ${a.id}`), mime: a.artworkType === "image" ? "image/png" as const : "model/gltf-binary" as const }));
        const { snapshot, assets } = projectPublication(candidate, prepared, "2026-10-01T00:00:00.000Z");
        expect(validateExhibition(snapshot, { publicationTime: "2026-10-01T00:00:00.000Z" })).toEqual({ valid: true, errors: [] });
        expect(validateStudioMaterials(snapshot).valid).toBe(true);
        expect(validateStudioPresentation(snapshot).valid).toBe(true);
        expect(candidate).toEqual(before);
        expect(snapshot.id).not.toBe(candidate.id);
        expect(snapshot.rooms[0]!.id).not.toBe(candidate.rooms[0]!.id);
        expect(JSON.stringify(snapshot)).not.toContain("Private");
        expect(JSON.stringify(snapshot)).not.toContain("capture");
        expect(JSON.stringify(snapshot)).not.toContain("org.exhibitos.studio/cms");
        for (const [i, a] of snapshot.artworks.entries()) {
            expect(a.id).not.toBe(candidate.artworks[i]!.id);
            expect(a.revisionId).not.toBe(candidate.artworks[i]!.revisionId);
            expect(a.primaryAssetId).not.toBe(candidate.artworks[i]!.primaryAssetId);
            expect(a.assets[0]!.id).toBe(assets[i]!.id);
            expect(a.assets[0]!.sha256).toBe(sha256(prepared[i]!.bytes));
            expect(a.assets[0]!.bytes).toBe(prepared[i]!.bytes.length);
        }
        expect(snapshot.placements[0]!.artworkRevisionId).toBe(snapshot.artworks[0]!.revisionId);
        expect(snapshot.placements[0]!.roomId).toBe(snapshot.rooms[0]!.id);
    });
});
