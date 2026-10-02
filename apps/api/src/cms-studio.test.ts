import { describe, it, expect, vi } from "vitest";
import type { PoolClient } from "pg";
import { validateArtwork } from "@exhibitos/spec";
import { ARTWORK_DETAILS_NAMESPACE, creationYearFor } from "@exhibitos/studio-contract";
import { Cms, validMetadata, type ArtworkMetadata } from "./cms.ts";
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
    it("retains trusted immutable imported OES identity/provenance/paths and denies changed current inventory or artist identity", async()=>{
        const {cms,c,gate,query,approval}=setup();
        const original=(await cms.studioArtwork(c,session,id)).artwork;
        original.revisionId='10000000-0000-4000-8000-000000000099';original.createdAt='2025-01-01T00:00:00Z';original.assets[0]!.path='imported/original/model.glb';original.provenance.events[0]!.description='Original preserved source provenance';
        Object.assign(approval.snapshot,{importedArtwork:original});
        const displayView=await cms.display(c,session,id)as Extract<Awaited<ReturnType<Cms['display']>>,{id:unknown;artist:unknown}>;
        const current={...approval.snapshot.asset,rights:approval.snapshot.metadata.rights};
        query.mockImplementation(async(sql:string)=>sql.includes('a.id=ANY')?{rows:[current],rowCount:1}:{rows:[{...approval,current_metadata:approval.snapshot.metadata,approved_asset_id:assetId}],rowCount:1});
        expect((await cms.studioArtwork(c,session,id)).artwork).toEqual(original);
        expect(original.createdAt).toBe('2025-01-01T00:00:00Z');
        current.sha256='b'.repeat(64);await expect(cms.studioArtwork(c,session,id)).rejects.toMatchObject({code:'APPROVAL_INVALID'});current.sha256=original.assets[0]!.sha256;
        current.rights={...rights,permissions:{...rights.permissions,download:true}};await expect(cms.studioArtwork(c,session,id)).rejects.toMatchObject({code:'APPROVAL_INVALID'});current.rights=rights;
        gate.mockResolvedValue({...displayView,artist:'Changed current artist identity'});await expect(cms.studioArtwork(c,session,id)).rejects.toMatchObject({code:'APPROVAL_INVALID'});
        delete original.metadata.artist;gate.mockResolvedValue({...displayView,artist:'Imported artist'});expect((await cms.studioArtwork(c,session,id)).artwork.metadata.artist).toBeUndefined();
        original.metadata.artist='Synthetic artist';gate.mockResolvedValue({...displayView,artist:'Synthetic artist'});original.extensions!['com.unreviewed/executable']={url:'https://invalid.example'};await expect(cms.studioArtwork(c,session,id)).rejects.toMatchObject({code:'APPROVAL_INVALID'});
    });
    it("accepts optional authored medium/year and keeps legacy metadata compatible", async () => {
        const {cms,c,approval}=setup();
        const legacy=approval.snapshot.metadata;
        expect(validMetadata(legacy)).toBe(true);
        for(const bad of [{medium:""},{medium:"   "},{medium:"x".repeat(513)},{creationYear:0},{creationYear:10000},{creationYear:2024.5},{creationYear:"2024"},{creationYear:null},{creationYear:undefined},{medium:undefined},{extra:"private"}])expect(validMetadata({...legacy,...bad})).toBe(false);
        const metadata=legacy as ArtworkMetadata;
        metadata.medium="Synthetic painted polymer";metadata.creationYear=2024;
        expect(validMetadata(metadata)).toBe(true);
        const {artwork}=await cms.studioArtwork(c,session,id);
        expect(validateArtwork(artwork).valid).toBe(true);
        expect(artwork.metadata.medium).toBe(metadata.medium);
        expect(artwork.extensions?.[ARTWORK_DETAILS_NAMESPACE]).toEqual({version:1,creationYear:2024});
        expect(creationYearFor(artwork)).toBe(2024);
        expect(JSON.stringify(artwork)).not.toContain(metadata.provenance.notes);
        delete metadata.medium;delete metadata.creationYear;
        const old=(await cms.studioArtwork(c,session,id)).artwork;
        expect(old.metadata.medium).toBeUndefined();expect(creationYearFor(old)).toBeUndefined();
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

describe("preview snapshot revision precondition", () => {
  it("rejects stale and malformed expected revisions before reading asset bytes", async () => {
    const { approval } = setup();
    const get = vi.fn();
    const cms = new Cms({ get } as unknown as import("@exhibitos/storage").BlobStore);
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT m.role")) return { rows: [{ role: "artist" }] };
      if (sql.includes("owner_user_id")) return { rows: [{ id, artist_id: assetId, owner_user_id: session.userId, revision: 8, approved_revision: 8, approved_asset_id: assetId, metadata: approval.snapshot.metadata }] };
      if (sql.includes("AS rights")) return { rows: [{ id: assetId, rights, mime: "model/gltf-binary", object_key: "private/original", bytes: 1516, sha256: "a".repeat(64) }] };
      if (sql.includes("SELECT metadata FROM artists")) return { rows: [{ metadata: { name: "Synthetic artist" } }] };
      return { rows: [] };
    });
    const c = { query } as unknown as PoolClient;
    await expect(cms.display(c, session, id, true, 7)).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(get).not.toHaveBeenCalled();
    for (const value of [0, -1, NaN, Infinity, 1.5, 2147483648]) {
      const calls = query.mock.calls.length;
      await expect(cms.display(c, session, id, true, value)).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(query.mock.calls.length).toBe(calls);
    }
    expect(await cms.display(c, session, id, false, 8)).toMatchObject({ revision: 8, title: "Synthetic approved" });
    expect(get).not.toHaveBeenCalled();
  });
});
