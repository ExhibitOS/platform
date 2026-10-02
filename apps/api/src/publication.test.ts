// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fixtureURL, validateExhibition, type Exhibition } from "@exhibitos/spec";
import { sha256 } from "@exhibitos/storage";
import { MATERIAL_NAMESPACE, PRESENTATION_NAMESPACE, validateStudioMaterials, validateStudioPresentation, EXPERIENCE_NAMESPACE, experienceFor, validateViewerExperience, ARTWORK_DETAILS_NAMESPACE, creationYearFor } from "@exhibitos/studio-contract";
import { projectPublication } from "./publication.ts";
describe("immutable anonymous publication projection", () => {
    it("remaps all references, strips private and foreign extensions, and inventories actual qualified bytes", async () => {
        const candidate = JSON.parse(await readFile(fixtureURL("oes/v1/examples/exhibition.json"), "utf8")) as Exhibition;
        candidate.extensions = { "private.example/notes": { secret: "Private authoring extension" }, [MATERIAL_NAMESPACE]: { version: 1, surfaces: { [candidate.surfaces[0]!.id]: { color: "#112233", roughness: 0.5, metalness: 0 } } }, [PRESENTATION_NAMESPACE]: { version: 1, viewpoints: [], credits: "Public credit", startCamera: { roomId: candidate.rooms[0]!.id, position: [0, 1.6, 3], target: [0, 1.6, 0], fov: 60 } } };
        for (const artwork of candidate.artworks)
            artwork.extensions = { "org.exhibitos.studio/cms": { tenantId: "10000000-0000-4000-8000-000000000001", artworkId: artwork.id, revision: artwork.revision }, [ARTWORK_DETAILS_NAMESPACE]:{version:1,creationYear:2024}, "private.example/capture": { secret: "Original capture note" } };
        candidate.artworks[0]!.rights.licenseId = candidate.rooms[0]!.id;
        const before = structuredClone(candidate);
        const prepared = candidate.artworks.map(a => ({ artwork: a, sourceAssetId: a.primaryAssetId, sourceSha256: a.assets[0]!.sha256, bytes: Buffer.from(`Qualified synthetic derivative ${a.id}`), mime: a.artworkType === "image" ? "image/png" as const : "model/gltf-binary" as const }));
        const { snapshot, assets } = projectPublication(candidate, prepared, "2026-10-01T00:00:00.000Z");
        expect(validateExhibition(snapshot, { publicationTime: "2026-10-01T00:00:00.000Z" })).toEqual({ valid: true, errors: [] });
        expect(validateStudioMaterials(snapshot).valid).toBe(true);
        expect(validateStudioPresentation(snapshot).valid).toBe(true);
        expect(candidate).toEqual(before);
        expect(snapshot.id).not.toBe(candidate.id);
        expect(snapshot.rooms[0]!.id).not.toBe(candidate.rooms[0]!.id);
        expect(snapshot.artworks[0]!.rights.licenseId).toBe(candidate.rooms[0]!.id);
        expect(snapshot.artworks[0]!.rights).toEqual(candidate.artworks[0]!.rights);
        expect(JSON.stringify(snapshot)).not.toContain("Private");
        expect(JSON.stringify(snapshot)).not.toContain("capture");
        expect(JSON.stringify(snapshot)).not.toContain("org.exhibitos.studio/cms");
        for (const [i, a] of snapshot.artworks.entries()) {
            expect(a.id).not.toBe(candidate.artworks[i]!.id);
            expect(creationYearFor(a)).toBe(2024);
            expect(a.revisionId).not.toBe(candidate.artworks[i]!.revisionId);
            expect(a.primaryAssetId).not.toBe(candidate.artworks[i]!.primaryAssetId);
            expect(a.assets[0]!.id).toBe(assets[i]!.id);
            expect(a.assets[0]!.sha256).toBe(sha256(prepared[i]!.bytes));
            expect(a.assets[0]!.bytes).toBe(prepared[i]!.bytes.length);
        }
        expect(snapshot.placements[0]!.artworkRevisionId).toBe(snapshot.artworks[0]!.revisionId);
        expect(snapshot.placements[0]!.roomId).toBe(snapshot.rooms[0]!.id);
    });
    it("remaps approved media references while preserving original and translated text verbatim", async () => {
        const candidate=JSON.parse(await readFile(fixtureURL("oes/v1/examples/exhibition.json"),"utf8")) as Exhibition;
        const source={id:"60000000-0000-4000-8000-000000000001",path:"media/60000000-0000-4000-8000-000000000001/audio.wav",mime:"audio/wav" as const,bytes:1600,sha256:sha256(Buffer.alloc(1600)),rights:structuredClone(candidate.artworks[0]!.rights)};
        candidate.mediaAssets=[source];
        candidate.audioZones=[{id:"60000000-0000-4000-8000-000000000002",roomId:candidate.rooms[0]!.id,assetId:source.id,position:[0,1,0],radius:3,volume:0.5,autoplay:false,transcript:source.id}];
        const original=source.id;
        candidate.extensions={[EXPERIENCE_NAMESPACE]:{version:1,footsteps:[],voices:[{placementId:candidate.placements[0]!.id,assetId:source.id,transcript:original,locale:"en"}],annotations:[{annotationId:candidate.annotations[0]!.id,position:[0,0,0]}],rooms:[{roomId:candidate.rooms[0]!.id,reverb:0.3}],translations:[{placementId:candidate.placements[0]!.id,locale:"ko",title:original,description:original}]}};
        const prepared=candidate.artworks.map(a=>({artwork:a,sourceAssetId:a.primaryAssetId,sourceSha256:a.assets[0]!.sha256,bytes:Buffer.from("synthetic bytes"),mime:a.artworkType==="image"?"image/png" as const:"model/gltf-binary" as const}));
        const {snapshot,media}=projectPublication(candidate,prepared,"2026-10-01T00:00:00.000Z",[{source,bytes:Buffer.alloc(1600)}]);
        expect(validateExhibition(snapshot,{publicationTime:"2026-10-01T00:00:00.000Z"}).valid).toBe(true);
        expect(validateViewerExperience(snapshot).valid).toBe(true);
        const experience=experienceFor(snapshot);
        expect(snapshot.mediaAssets[0]!.id).toBe(media[0]!.id);
        expect(snapshot.mediaAssets[0]!.path).toBe(`media/${media[0]!.id}/audio.wav`);
        expect(media[0]!.id).not.toBe(source.id);
        expect(snapshot.audioZones[0]!.assetId).toBe(media[0]!.id);
        expect(experience.voices[0]!.assetId).toBe(media[0]!.id);
        expect(experience.voices[0]!.placementId).toBe(snapshot.placements[0]!.id);
        expect(experience.annotations[0]!.annotationId).toBe(snapshot.annotations[0]!.id);
        expect(experience.rooms[0]!.roomId).toBe(snapshot.rooms[0]!.id);
        expect(experience.voices[0]!.transcript).toBe(original);
        expect(experience.translations[0]!.title).toBe(original);
        expect(snapshot.audioZones[0]!.transcript).toBe(original);
    });
});
