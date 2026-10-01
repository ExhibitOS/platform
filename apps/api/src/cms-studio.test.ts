import { describe, it, expect, vi } from "vitest";
import type { PoolClient } from "pg";
import { validateArtwork } from "@exhibitos/spec";
import { Cms } from "./cms.ts";
import type { Session } from "./auth.ts";
const tenantId = "10000000-0000-4000-8000-000000000001", id = "10000000-0000-4000-8000-000000000002", assetId = "10000000-0000-4000-8000-000000000003";
const session = { tenantId, userId: "10000000-0000-4000-8000-000000000004", role: "artist" } as Session;
const rights = { holder: "Synthetic owner", ownership: "owner", licenseId: "CC0-1.0", permissions: { display: true, download: false, export: false, commercial: false }, creditLine: "Synthetic credit" };
function setup(mime = "model/gltf-binary") {
    const metadata = { title: "Synthetic approved", description: "Physical artwork", dimensions: { width: 1.2, height: 2, depth: 0.05, unit: "m" }, rights, provenance: { source: "human-authored", sourceUnits: "m", scaleApplied: true, notes: "private authoring notes must stay hidden" } };
    const approval = { revision: 7, created_at: "2026-01-01T00:00:00.000Z", snapshot: { metadata, asset: { id: assetId, mime, bytes: 1516, sha256: "a".repeat(64), rightsRevision: 4, object_key: "private/original" } } };
    const query = vi.fn().mockResolvedValue({ rows: [approval], rowCount: 1 });
    const c = { query } as unknown as PoolClient, cms = new Cms();
    // Membership, resource ownership and current rights are exercised by the actual integration suite.
    const gate = vi.spyOn(cms, "display").mockResolvedValue({ id, revision: 7, title: metadata.title, description: metadata.description, artist: "Synthetic artist", dimensions: metadata.dimensions, creditLine: rights.creditLine, previewMime: mime, watermarked: true, originalDownload: false, export: false });
    return { cms, c, gate, query, approval };
}
describe("protected approved CMS to Studio metadata projection", () => {
    it("produces stable full public snapshots for sculpture and painting without fetching bytes or private notes/keys", async () => {
        for (const mime of ["model/gltf-binary", "image/png"]) {
            const { cms, c, query } = setup(mime);
            const first = await cms.studioArtwork(c, session, id), second = await cms.studioArtwork(c, session, id);
            expect(validateArtwork(first.artwork)).toEqual({ valid: true, errors: [] });
            expect(first).toEqual(second);
            expect(first.artwork.dimensions).toEqual({ width: 1.2, height: 2, depth: 0.05 });
            expect(first.artwork.artworkType).toBe(mime === "image/png" ? "image" : "sculpture");
            expect(first.artwork.transform.scale).toEqual([1, 1, 1]);
            expect(first.artwork.extensions?.["org.exhibitos.studio/cms"]).toEqual({ tenantId, artworkId: id, revision: 7 });
            expect(first.previewUrl).toBe(`/api/v1/tenants/${tenantId}/cms/artworks/${id}/preview`);
            expect(JSON.stringify(first)).not.toContain("private");
            expect(JSON.stringify(first)).not.toContain("rightsRevision");
            expect(query.mock.calls[0]?.[1]).toEqual([tenantId, id]);
        }
    });
    it("rejects viewer before metadata lookup and preserves current gate denial without accessing immutable snapshot", async () => {
        const { cms, c, gate, query } = setup();
        await expect(cms.studioArtwork(c, { ...session, role: "viewer" }, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(query).not.toHaveBeenCalled();
        expect(gate).not.toHaveBeenCalled();
        gate.mockRejectedValue(Object.assign(new Error("rights denied"), { code: "RIGHTS_DENIED" }));
        await expect(cms.studioArtwork(c, session, id)).rejects.toMatchObject({ code: "RIGHTS_DENIED" });
        expect(query).not.toHaveBeenCalled();
    });
    it("fails closed when immutable approval is absent, invalid, or no longer grants display", async () => {
        const { cms, c, query, approval } = setup();
        query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
        await expect(cms.studioArtwork(c, session, id)).rejects.toMatchObject({ code: "REVISION_NOT_APPROVED" });
        approval.snapshot.metadata.rights = { ...rights, permissions: { ...rights.permissions, display: false } };
        await expect(cms.studioArtwork(c, session, id)).rejects.toMatchObject({ code: "RIGHTS_DENIED" });
        approval.snapshot.metadata.rights = rights;
        approval.snapshot.asset.mime = "application/octet-stream";
        await expect(cms.studioArtwork(c, session, id)).rejects.toMatchObject({ code: "APPROVAL_INVALID" });
    });
});
