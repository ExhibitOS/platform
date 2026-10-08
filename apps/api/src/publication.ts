// SPDX-License-Identifier: AGPL-3.0-or-later
import {SPATIAL_NAMESPACE,spatialAudioWithoutTranscript,validateSpatialProfile,remapSpatialProgram,type SpatialProgram} from '@exhibitos/studio-contract';
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { transaction, sha256, type BlobStore } from "@exhibitos/storage";
import { validateExhibition, revisionHash, type Artwork, type Exhibition } from "@exhibitos/spec";
import { DAYLIGHT_NAMESPACE, TEMPLATE_NAMESPACE, validateViewerCuration, curationDurationValid, CURATION_NAMESPACE, validateArchitecture, MATERIAL_NAMESPACE, PRESENTATION_NAMESPACE, validateStudioMaterials, validateStudioPresentation, validateViewerLod, LOD_NAMESPACE, EXPERIENCE_NAMESPACE, validateViewerExperience, ARTWORK_DETAILS_NAMESPACE, validateArtworkDetails } from "@exhibitos/studio-contract";
import { ApiError, uuid, type Session } from "./auth.ts";
import { Studio, etag } from "./studio.ts";
import { Cms, validMetadata } from "./cms.ts";
import { derivative } from "./derivative.ts";
import { viewerVariants, measureFullVariant, type GeneratedVariants } from "./viewer-variants.ts";
import { qualifyApprovedTexturedPair } from "./approved-lod-pair.ts";
import { Audio, audioMedia, validatePcmWav, type MediaAsset } from "./audio.ts";
import { allowedRights } from "./rights.ts";
export interface PublicationIssue {
    code: string;
    path: string;
    message: string;
    remediation: string;
}
interface PreparedAsset {
    artwork: Artwork;
    sourceAssetId: string;
    sourceSha256: string;
    bytes: Buffer;
    mime: "model/gltf-binary" | "image/png";
    variants?: GeneratedVariants;
    coarseSource?: {id:string;sha256:string};
}
interface PreparedMedia { source:MediaAsset; bytes:Buffer }
interface PublicationRow {
    tenant_id: string;
    id: string;
    exhibition_id: string;
    draft_revision: number;
    snapshot: Exhibition;
    revision_sha256: string;
    published_at: Date;
    status: "published" | "unpublished";
}
interface AssetRow {
    id: string;
    artwork_id: string;
    artwork_revision: number;
    source_asset_id: string;
    source_sha256: string;
    object_key: string;
    sha256: string;
    bytes: number;
    mime: string;
}
const PUBLIC_REFERENCE_FIELDS = new Set(['id','revisionId','primaryAssetId','sourceAssetIds','appliedToAssetIds','roomId','surfaceId','connectsToOpeningId','artworkRevisionId','assetId','targetPlacementId','viaOpeningId','routeIds','placementId','targetId','annotationId','zoneId','routeId']);
const issue = (code: string, path: string, message: string, remediation: string): PublicationIssue => ({ code, path, message, remediation });
const equal = (a: unknown, b: unknown): boolean => {
    const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sorted(x)])) : v;
    return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
};
/** A secondary publication source must be the exact coarse member of its immutable import approval. */
export function approvedPublicationSource(snapshot:unknown,source:{id:string;sha256:string;bytes:number;mime:string},primary:string):boolean {
    if(!snapshot||typeof snapshot!=='object')return false;
    const approval=snapshot as {asset?:{id:string;sha256:string;bytes:number;mime:string};importedArtwork?:Artwork};
    if(approval.asset?.id!==primary)return false;
    if(source.id===primary)return approval.asset.sha256===source.sha256&&approval.asset.bytes===source.bytes&&approval.asset.mime===source.mime;
    const a=approval.importedArtwork;
    if(!a||a.primaryAssetId!==primary||!validateViewerLod(a).valid)return false;
    const lod=a.extensions?.[LOD_NAMESPACE] as unknown as {variants:{assetId:string;detail:string}[]}|undefined;
    const low=lod?.variants.find(v=>v.detail==='coarse');
    const asset=a.assets.find(v=>v.id===source.id);
    return low?.assetId===source.id&&asset?.sha256===source.sha256&&asset.bytes===source.bytes&&asset.mime===source.mime;
}
/** Only complete public fields and known presentation/material extensions cross the anonymous boundary. */
export function projectPublication(candidate: Exhibition, prepared: PreparedAsset[], at: string, media: PreparedMedia[] = []) {
    const doc = structuredClone(candidate), ids = new Map<string, string>(), assets: {
        id: string;
        prepared: PreparedAsset;
    }[] = [];
    const map = (id: string) => { const key = id.toLowerCase(); if (!ids.has(key))
        ids.set(key, randomUUID()); return ids.get(key)!; };
    const collect = (v: unknown): void => { if (Array.isArray(v))
        v.forEach(collect);
    else if (v && typeof v === "object")
        for (const [key, x] of Object.entries(v)) {
            if ((key === "id" || key === "revisionId") && typeof x === "string")
                map(x);
            else
                collect(x);
        } };
    // Unknown namespaces are retained privately but never implicitly published.
    doc.extensions = Object.fromEntries(Object.entries(doc.extensions ?? {}).filter(([key]) => [DAYLIGHT_NAMESPACE, TEMPLATE_NAMESPACE, MATERIAL_NAMESPACE, PRESENTATION_NAMESPACE, EXPERIENCE_NAMESPACE, CURATION_NAMESPACE, SPATIAL_NAMESPACE].includes(key)));
    const spatial=doc.extensions?.[SPATIAL_NAMESPACE] as unknown as SpatialProgram|undefined;
    if(doc.extensions)delete doc.extensions[SPATIAL_NAMESPACE];
    collect(doc);
    doc.artworks = prepared.map(p => {
        const a = structuredClone(p.artwork), assetId = map(p.sourceAssetId);
        assets.push({ id: assetId, prepared: p });
        const details=a.extensions?.[ARTWORK_DETAILS_NAMESPACE];
        delete a.extensions;
        if(details!==undefined&&validateArtworkDetails(p.artwork).valid)a.extensions={[ARTWORK_DETAILS_NAMESPACE]:structuredClone(details)};
        a.assets = [{ id: p.sourceAssetId, path: `assets/${assetId}/${p.mime === "image/png" ? "image.png" : "model.glb"}`, role: p.mime === "image/png" ? "image" : "model", mime: p.mime, bytes: p.bytes.length, sha256: sha256(p.bytes) }];
        a.primaryAssetId = p.sourceAssetId;
        if (p.variants) {
            const variants = [{assetId:p.sourceAssetId,detail:"full",...p.variants.full}];
            if (p.variants.coarse && p.variants.bytes) {
                const coarseId=randomUUID();
                assets.push({id:coarseId,prepared:{...p,bytes:p.variants.bytes,...(p.coarseSource?{sourceAssetId:p.coarseSource.id,sourceSha256:p.coarseSource.sha256}:{})}});
                a.assets.push({id:coarseId,path:`assets/${coarseId}/${p.mime==="image/png"?"image.png":"model.glb"}`,role:p.mime==="image/png"?"image":"model",mime:p.mime,bytes:p.variants.bytes.length,sha256:sha256(p.variants.bytes)});
                variants.push({assetId:coarseId,detail:"coarse",...p.variants.coarse});
            }
            a.extensions={...a.extensions,[LOD_NAMESPACE]:{version:1,variants}};
        }
        a.provenance = { authorship: a.provenance.authorship, events: [{ id: randomUUID(), type: "exhibited", at, description: "Approved display derivative explicitly published by its authorized exhibition editor." }] };
        return a;
    });
    doc.mediaAssets=media.map(p=>({...structuredClone(p.source),path:`media/${map(p.source.id)}/audio.wav`}));
    const remap = (v: unknown, field=""): unknown => typeof v === "string" ? (PUBLIC_REFERENCE_FIELDS.has(field) ? ids.get(v.toLowerCase()) ?? v : v) : Array.isArray(v) ? v.map(x=>remap(x,field)) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [field === 'surfaces' ? ids.get(k.toLowerCase()) ?? k : k, remap(x,k)])) : v;
    const snapshot = remap(doc) as Exhibition;
    if(spatial)snapshot.extensions={...snapshot.extensions,[SPATIAL_NAMESPACE]:remapSpatialProgram(spatial,map) as unknown as {[key:string]:import("@exhibitos/spec").JsonValue}};
    snapshot.createdAt = at;
    snapshot.revision = 1;
    return { snapshot, assets, media:media.map(p=>({id:map(p.source.id),prepared:p})) };
}
export class Publications {
    readonly studio = new Studio();
    readonly cms: Cms;
    readonly pool: Pool;
    readonly blobs: BlobStore | undefined;
    constructor(pool: Pool, blobs?: BlobStore) { this.pool = pool; this.blobs = blobs; this.cms = new Cms(blobs); }
    private summary(row: PublicationRow) { return { publicationId: row.id, publicUrl: `/p/${row.id}`, revisionSha256: row.revision_sha256, publishedAt: new Date(row.published_at).toISOString(), status: row.status }; }
    private async prepare(c: PoolClient, s: Session, candidate: Exhibition, exhibitionId:string) {
        const errors: PublicationIssue[] = [], prepared: PreparedAsset[] = [], media:PreparedMedia[]=[];
        let totalBytes = 0;
        const at = new Date().toISOString();
        for(const e of [...validateArchitecture(candidate,true).errors,...validateSpatialProfile(candidate).errors,...validateViewerCuration(candidate).errors])errors.push(issue(e.code,e.path,e.message,"Correct template licensing, architecture or curation controls before publishing."));
        for(const id of spatialAudioWithoutTranscript(candidate)) errors.push(issue("SPATIAL_AUDIO_TRANSCRIPT","/candidate/extensions/org.exhibitos.runtime~1spatial-scripting","Script audio lacks a readable original transcript: "+id,"Bind the approved audio to an authored voice or audio zone with its original transcript before publishing."));
        const valid = validateExhibition(candidate, { publicationTime: at });
        for (const e of valid.errors.slice(0, 64))
            errors.push(issue(e.code, e.path, e.message, "Correct the referenced geometry, rights or accessibility field and save the draft before retrying."));
        if(candidate.mediaAssets.length>32||!validateViewerExperience(candidate).valid) errors.push(issue("PUBLICATION_LIMIT","/candidate/mediaAssets","Invalid bounded experience or more than32 media assets.","Correct the experience references and use at most32 approved media assets."));
        if (candidate.artworks.length > 64)
            errors.push(issue("PUBLICATION_LIMIT", "/candidate/artworks", "At most 64 artworks per bounded publication.", "Split the exhibition into smaller publication drafts."));
        if (errors.length)
            return { issues: errors, prepared, media, at };
        for(const [i,asset] of candidate.mediaAssets.entries()) {
            try {
                const row=await new Audio(this.blobs).approved(c,s,exhibitionId,asset.id);
                if(!equal(audioMedia(row),asset)||!this.blobs)throw new ApiError(409,"AUDIO_APPROVAL_CHANGED");
                const bytes=Buffer.from(await this.blobs.get(row.object_key));
                if(bytes.length!==asset.bytes||sha256(bytes)!==asset.sha256)throw new ApiError(409,"ASSET_INTEGRITY");
                if(!curationDurationValid(candidate,asset.id,validatePcmWav(bytes).durationSeconds))throw new ApiError(422,"CURATION_AUDIO_DURATION");totalBytes+=bytes.length;
                if(totalBytes>67108864)throw new ApiError(422,"PUBLICATION_LIMIT");
                media.push({source:asset,bytes});
            }catch(error){errors.push(issue(error instanceof ApiError?error.code:"AUDIO_UNAVAILABLE",`/candidate/mediaAssets/${i}`,"Current approved audio, bytes or display rights unavailable.","Upload and approve exact PCM16 WAV for this exhibition; correct current rights or restore its availability."));}
        }
        for (const [i, artwork] of candidate.artworks.entries()) {
            const path = `/candidate/artworks/${i}`;
            const binding = artwork.extensions?.["org.exhibitos.studio/cms"];
            if (!binding || binding.tenantId !== s.tenantId || binding.artworkId !== artwork.id || binding.revision !== artwork.revision) {
                errors.push(issue("ARTWORK_NOT_APPROVED", path, "Artwork must be an approved CMS snapshot from this tenant.", "Import the current approved artwork from CMS and replace its placements."));
                continue;
            }
            try {
                const current = await this.cms.studioArtwork(c, s, artwork.id);
                if (!equal(current.artwork, artwork)) {
                    errors.push(issue("ARTWORK_SNAPSHOT_CHANGED", path, "Draft artwork does not exactly match its current immutable CMS approval.", "Import the current CMS snapshot; do not modify its dimensions, rights or asset inventory in draft JSON."));
                    continue;
                }
                const primary = artwork.assets.find(a => a.id === artwork.primaryAssetId)!;
                let result: {bytes:Buffer;mime:"model/gltf-binary"|"image/png"};
                if (artwork.artworkType === "image") {
                    await this.cms.display(c,s,artwork.id,false,artwork.revision);
                    const asset=(await c.query("SELECT object_key,bytes,sha256 FROM assets WHERE tenant_id=$1 AND id=$2",[s.tenantId,primary.id])).rows[0];
                    if(!asset||!this.blobs)throw new ApiError(503,"STORAGE_UNAVAILABLE");
                    const original=Buffer.from(await this.blobs.get(asset.object_key));
                    if(original.length!==Number(asset.bytes)||sha256(original)!==asset.sha256)throw new ApiError(409,"ASSET_INTEGRITY");
                    result={bytes:await derivative(original,"image/png",{maxTextureSize:2048}),mime:"image/png"};
                } else result=await this.cms.display(c,s,artwork.id,true,artwork.revision) as {bytes:Buffer;mime:"model/gltf-binary"};
                // Unsupported/nonreducing simplification remains an honest full-only fallback.
                const fullMetric=measureFullVariant(result.bytes,result.mime);
                const generated:GeneratedVariants=await viewerVariants(result.bytes,result.mime).catch(()=>({full:fullMetric}));
                let variants:GeneratedVariants={...generated,full:fullMetric};
                let coarseSource:PreparedAsset['coarseSource'];
                const lod=artwork.extensions?.[LOD_NAMESPACE] as unknown as {variants:{assetId:string;detail:string;triangles?:number}[]}|undefined;
                if(lod&&!validateViewerLod(artwork).valid)throw new ApiError(409,'APPROVAL_INVALID');
                const low=lod?.variants.find(v=>v.detail==='coarse'),high=lod?.variants.find(v=>v.detail==='full');
                if(low&&high&&result.mime==='model/gltf-binary'){
                    // Current authorization/integrity failures are never converted to full-only fallback.
                    const full=await this.cms.displayApprovedVariant(c,s,artwork.id,high.assetId,artwork.revision);
                    const coarse=await this.cms.displayApprovedVariant(c,s,artwork.id,low.assetId,artwork.revision);
                    if(!full.bytes.equals(result.bytes))throw new ApiError(409,'ASSET_INTEGRITY');
                    try {
                        qualifyApprovedTexturedPair(full.original,coarse.original,high.triangles!,low.triangles!);
                        const coarseMetric=measureFullVariant(coarse.bytes,coarse.mime);
                        if(!coarseMetric.triangles||!fullMetric.triangles||coarseMetric.triangles>=fullMetric.triangles||coarse.bytes.length>=result.bytes.length)throw Error('APPROVED_LOD_UNSUPPORTED');
                        variants={full:fullMetric,coarse:coarseMetric,bytes:coarse.bytes};
                        const source=artwork.assets.find(a=>a.id.toLowerCase()===low.assetId.toLowerCase())!;
                        coarseSource={id:source.id,sha256:source.sha256};
                    }catch{variants={full:fullMetric};}
                    // Reobserve the entire immutable imported inventory after both decoders.
                    if(!equal((await this.cms.studioArtwork(c,s,artwork.id)).artwork,artwork))throw new ApiError(409,'REVISION_CONFLICT');
                    if(!(await this.cms.approvedVariantOriginal(c,s,artwork.id,high.assetId,artwork.revision)).equals(full.original)||!(await this.cms.approvedVariantOriginal(c,s,artwork.id,low.assetId,artwork.revision)).equals(coarse.original))throw new ApiError(409,'ASSET_INTEGRITY');
                }
                totalBytes += result.bytes.length + (variants?.bytes?.length??0);
                if (totalBytes > 67108864) {
                    errors.push(issue("PUBLICATION_LIMIT", path, "Qualified display derivatives exceed the 64 MiB publication budget.", "Split the exhibition into smaller publication drafts."));
                    break;
                }
                prepared.push({ artwork, sourceAssetId: primary.id, sourceSha256: primary.sha256, bytes: result.bytes, mime: result.mime, variants, ...(coarseSource?{coarseSource}:{}) });
            }
            catch (error) {
                const code = error instanceof ApiError ? error.code : "ARTWORK_UNAVAILABLE";
                errors.push(issue(code, path, "Current approved artwork, display rights or qualified derivative is unavailable.", "Review current CMS approval, ownership/assignment and artwork/asset display grants; reimport after correcting them."));
            }
        }
        return { issues: errors, prepared, media, at };
    }
    async ready(c: PoolClient, s: Session, id: string) {
        const row = await this.studio.access(c, s, id), report = await this.prepare(c, s, row.metadata.candidate, id);
        return { status: report.issues.length ? "BLOCKED" : "READY", etag: etag(row.revision, row.metadata), issues: report.issues };
    }
    async list(c: PoolClient, s: Session, id: string) { await this.studio.access(c, s, id); return { items: (await c.query("SELECT p.*,s.status FROM studio_publications p JOIN publication_states s ON s.publication_id=p.id WHERE p.tenant_id=$1 AND p.exhibition_id=$2 ORDER BY p.published_at DESC LIMIT 100", [s.tenantId, id])).rows.map(r => this.summary(r)) }; }
    private async owned(c: PoolClient, s: Session, id: string): Promise<PublicationRow> { uuid(id); const row = (await c.query("SELECT p.*,s.status FROM studio_publications p JOIN publication_states s ON s.publication_id=p.id WHERE p.tenant_id=$1 AND p.id=$2 FOR UPDATE OF s", [s.tenantId, id])).rows[0]; if (!row)
        throw new ApiError(403, "FORBIDDEN"); await this.studio.access(c, s, row.exhibition_id); return row; }
    async publish(c: PoolClient, s: Session, id: string, requestId: string, match: string) {
        uuid(requestId);
        const row = await this.studio.access(c, s, id), payloadHash = sha256(Buffer.from(JSON.stringify({ id, requestId, match })));
        const receipt = (await c.query("SELECT * FROM publication_requests WHERE tenant_id=$1 AND user_id=$2 AND request_id=$3", [s.tenantId, s.userId, requestId])).rows[0];
        if (receipt) {
            if (receipt.payload_sha256 !== payloadHash)
                throw new ApiError(409, "REQUEST_CONFLICT");
            return this.summary(await this.owned(c, s, receipt.publication_id));
        }
        if (match !== etag(row.revision, row.metadata))
            throw new ApiError(412, "REMOTE_CONFLICT");
        if ((await c.query("SELECT 1 FROM studio_publications WHERE tenant_id=$1 AND exhibition_id=$2", [s.tenantId, id])).rowCount)
            throw new ApiError(409, "PUBLISHED_DRAFT_IMMUTABLE");
        const report = await this.prepare(c, s, row.metadata.candidate, id);
        if (report.issues.length)
            throw new ApiError(422, "PUBLICATION_NOT_READY");
        if (!this.blobs)
            throw new ApiError(503, "STORAGE_UNAVAILABLE");
        const publicationId = randomUUID(), publishedAt = new Date().toISOString(), { snapshot, assets, media } = projectPublication(row.metadata.candidate, report.prepared, publishedAt, report.media);
        const valid = validateExhibition(snapshot, { publicationTime: publishedAt });
        if (!valid.valid || !validateArchitecture(snapshot,true).valid || !validateSpatialProfile(snapshot).valid || !validateViewerCuration(snapshot).valid || !validateViewerExperience(snapshot).valid || snapshot.artworks.some(a=>!validateViewerLod(a).valid||!validateArtworkDetails(a).valid))
            throw new ApiError(422, "PUBLICATION_NOT_READY");
        const digest = revisionHash(snapshot);
        await c.query("INSERT INTO studio_publications(tenant_id,id,exhibition_id,draft_revision,created_by,snapshot,revision_sha256,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [s.tenantId, publicationId, id, row.revision, s.userId, snapshot, digest, publishedAt]);
        await c.query("INSERT INTO publication_states VALUES($1,'published',now())", [publicationId]);
        for (const { id: assetId, prepared: p } of assets) {
            const hash = sha256(p.bytes), key = `${s.tenantId}/publications/${publicationId}/${assetId}/${hash}`;
            await this.blobs.put(key, p.bytes);
            await c.query("INSERT INTO publication_assets(tenant_id,publication_id,id,artwork_id,artwork_revision,source_asset_id,source_sha256,object_key,sha256,bytes,mime) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [s.tenantId, publicationId, assetId, p.artwork.id, p.artwork.revision, p.sourceAssetId, p.sourceSha256, key, hash, p.bytes.length, p.mime]);
        }
        for(const {id:mediaId,prepared:p} of media){
            const key=`${s.tenantId}/publications/${publicationId}/${mediaId}/${p.source.sha256}`;
            await this.blobs.put(key,p.bytes);
            await c.query("INSERT INTO publication_media(tenant_id,publication_id,id,source_audio_id,source_sha256,object_key,sha256,bytes,mime) VALUES($1,$2,$3,$4,$5,$6,$5,$7,$8)",[s.tenantId,publicationId,mediaId,p.source.id,p.source.sha256,key,p.source.bytes,p.source.mime]);
        }
        await c.query("INSERT INTO publication_requests VALUES($1,$2,$3,$4,$5)", [s.tenantId, s.userId, requestId, payloadHash, publicationId]);
        await this.event(c, s, publicationId, "published");
        return this.summary({ id: publicationId, published_at: new Date(publishedAt), revision_sha256: digest, status: "published" } as PublicationRow);
    }
    private async event(c: PoolClient, s: Session, id: string, action: string) { await c.query("INSERT INTO publication_events(id,publication_id,actor_user_id,action) VALUES($1,$2,$3,$4)", [randomUUID(), id, s.userId, action]); await c.query("INSERT INTO audit_events(tenant_id,id,metadata) VALUES($1,$2,$3)", [s.tenantId, randomUUID(), { action: `studio.${action}`, actor: s.userId, target: id }]); }
    async unpublish(c: PoolClient, s: Session, id: string) { const row = await this.owned(c, s, id); if (row.status !== "unpublished") {
        await c.query("UPDATE publication_states SET status='unpublished',updated_at=clock_timestamp() WHERE publication_id=$1", [id]);
        await this.event(c, s, id, "unpublished");
    } return this.summary({ ...row, status: "unpublished" }); }
    async republish(c: PoolClient, s: Session, id: string) { const row = await this.owned(c, s, id); await this.gate(c, row); if (row.status !== "published") {
        await c.query("UPDATE publication_states SET status='published',updated_at=clock_timestamp() WHERE publication_id=$1", [id]);
        await this.event(c, s, id, "republished");
    } return this.summary({ ...row, status: "published" }); }
    /** No private draft metadata is consulted. Snapshot and private immutable asset bindings suffice. */
    private async gate(c: PoolClient, row: PublicationRow): Promise<AssetRow[]> {
        const now = Date.now();
        if (!(await c.query("SELECT 1 FROM tenants t JOIN exhibitions e ON e.tenant_id=t.id WHERE t.id=$1 AND e.id=$2 AND t.deleted_at IS NULL AND e.deleted_at IS NULL", [row.tenant_id, row.exhibition_id])).rowCount)
            throw new ApiError(404, "PUBLICATION_UNAVAILABLE");
        if (!validateExhibition(row.snapshot, { publicationTime: new Date(now).toISOString() }).valid || !validateArchitecture(row.snapshot,true).valid || !validateStudioMaterials(row.snapshot).valid || !validateStudioPresentation(row.snapshot).valid || !validateSpatialProfile(row.snapshot).valid || !validateViewerCuration(row.snapshot).valid || !validateViewerExperience(row.snapshot).valid || row.snapshot.artworks.some(a=>!validateViewerLod(a).valid||!validateArtworkDetails(a).valid) || revisionHash(row.snapshot) !== row.revision_sha256)
            throw new ApiError(404, "PUBLICATION_UNAVAILABLE");
        const records = (await c.query("SELECT pa.*,a.revision AS current_revision,a.approved_revision,a.approved_asset_id,a.deleted_at AS artwork_deleted,a.metadata AS current_metadata,ar.deleted_at AS artist_deleted,t.deleted_at AS tenant_deleted,e.deleted_at AS exhibition_deleted,asset.deleted_at AS asset_deleted,asset.state AS asset_state,asset.sha256 AS current_source_sha256,asset.bytes AS current_source_bytes,asset.mime AS current_source_mime,asset.artwork_id AS source_artwork_id,ap.snapshot AS source_approval,r.deleted_at AS rights_deleted,r.metadata AS current_rights FROM publication_assets pa JOIN artworks a ON (a.tenant_id,a.id)=(pa.tenant_id,pa.artwork_id) JOIN artists ar ON (ar.tenant_id,ar.id)=(a.tenant_id,a.artist_id) JOIN tenants t ON t.id=pa.tenant_id JOIN exhibitions e ON (e.tenant_id,e.id)=(pa.tenant_id,$2) JOIN assets asset ON (asset.tenant_id,asset.id)=(pa.tenant_id,pa.source_asset_id) JOIN rights r ON (r.tenant_id,r.id)=(asset.tenant_id,asset.rights_id) JOIN artwork_approvals ap ON (ap.tenant_id,ap.artwork_id,ap.revision)=(pa.tenant_id,pa.artwork_id,pa.artwork_revision) WHERE pa.publication_id=$1", [row.id, row.exhibition_id])).rows;
        if (records.length !== row.snapshot.artworks.flatMap(a=>a.assets).length)
            throw new ApiError(404, "PUBLICATION_UNAVAILABLE");
        for (const r of records) {
            if (r.artwork_deleted || r.artist_deleted || r.tenant_deleted || r.exhibition_deleted || r.asset_deleted || r.rights_deleted || r.asset_state !== "approved" || r.current_revision !== r.artwork_revision || r.approved_revision !== r.artwork_revision || r.source_artwork_id !== r.artwork_id || !approvedPublicationSource(r.source_approval,{id:r.source_asset_id,sha256:r.source_sha256,bytes:Number(r.current_source_bytes),mime:r.current_source_mime},r.approved_asset_id) || r.current_source_sha256 !== r.source_sha256 || !validMetadata(r.current_metadata) || !allowedRights(r.current_metadata.rights, "display", now) || !allowedRights(r.current_rights, "display", now))
                throw new ApiError(404, "PUBLICATION_UNAVAILABLE");
            const inventory = row.snapshot.artworks.flatMap(a => a.assets).find(a => a.id === r.id);
            if (!inventory || inventory.sha256 !== r.sha256 || inventory.bytes !== Number(r.bytes) || inventory.mime !== r.mime)
                throw new ApiError(404, "PUBLICATION_UNAVAILABLE");
        }
        const media=(await c.query("SELECT pm.*,a.state,a.revoked,a.sha256 AS current_sha256,a.bytes AS current_bytes,a.rights,ap.snapshot AS approval FROM publication_media pm JOIN studio_audio a ON (a.tenant_id,a.id)=(pm.tenant_id,pm.source_audio_id) JOIN audio_approvals ap ON (ap.tenant_id,ap.audio_id)=(a.tenant_id,a.id) WHERE pm.publication_id=$1 AND a.exhibition_id=$2",[row.id,row.exhibition_id])).rows;
        if(media.length!==row.snapshot.mediaAssets.length)throw new ApiError(404,"PUBLICATION_UNAVAILABLE");
        for(const r of media){
            const inventory=row.snapshot.mediaAssets.find(a=>a.id===r.id);
            if(!inventory||r.state!=="approved"||r.revoked||r.current_sha256!==r.source_sha256||r.source_sha256!==r.sha256||Number(r.current_bytes)!==Number(r.bytes)||!allowedRights(r.rights,"display",now)||!equal(r.rights,inventory.rights)||r.approval.sha256!==r.source_sha256||r.approval.bytes!==Number(r.bytes)||!equal(r.approval.rights,r.rights)||inventory.sha256!==r.sha256||inventory.bytes!==Number(r.bytes)||inventory.mime!==r.mime)throw new ApiError(404,"PUBLICATION_UNAVAILABLE");
        }
        return [...records,...media];
    }
    async anonymous(id: string, assetId?: string) {
        uuid(id);
        if (assetId)
            uuid(assetId);
        return transaction(this.pool, async (c) => {
            // The shared current-policy lock excludes authenticated unpublish/reapproval/rights mutations.
            await c.query("SELECT pg_advisory_xact_lock_shared(82003)");
            await c.query("SELECT pg_advisory_xact_lock_shared(82002)");
            const row = (await c.query("SELECT p.*,s.status FROM studio_publications p JOIN publication_states s ON s.publication_id=p.id WHERE p.id=$1", [id])).rows[0] as PublicationRow | undefined;
            if (!row || row.status !== "published")
                throw new ApiError(404, "PUBLICATION_UNAVAILABLE");
            const assets = await this.gate(c, row);
            if (assetId) {
                const asset = assets.find(a => a.id === assetId);
                if (!asset || !this.blobs)
                    throw new ApiError(404, "PUBLICATION_UNAVAILABLE");
                let bytes: Buffer;
                try {
                    bytes = Buffer.from(await this.blobs.get(asset.object_key));
                }
                catch {
                    throw new ApiError(404, "PUBLICATION_UNAVAILABLE");
                }
                if (bytes.length !== Number(asset.bytes) || sha256(bytes) !== asset.sha256)
                    throw new ApiError(404, "PUBLICATION_UNAVAILABLE");
                // Time continues while storage is read even though policy mutations are locked.
                // Recheck expiry immediately before releasing qualified bytes to the response.
                await this.gate(c, row);
                return { bytes, mime: asset.mime, revisionSha256: row.revision_sha256 };
            }
            return { publication: { id: row.id, revisionSha256: row.revision_sha256, publishedAt: new Date(row.published_at).toISOString(), status: "published" }, exhibition: row.snapshot, assets: assets.map(a => ({ assetId: a.id, mime: a.mime, url: `/api/v1/publications/${row.id}/assets/${a.id}` })) };
        });
    }
}
