import {FURNISHING_NAMESPACE,validateFurnishings,furnishingsFor,remapFurnishings,type FurnishingAsset} from '@exhibitos/studio-contract';
import {furnishingResourcePair} from './furnishings.ts';
import {VIEWING_PLAN_NAMESPACE,validateViewingPlan,remapViewingPlan,type ViewingPlan} from '@exhibitos/studio-contract';
import {ARTWORK_THUMBNAIL_NAMESPACE,artworkThumbnailFor,validateArtworkThumbnail} from '@exhibitos/studio-contract';
import {validateThumbnailBytes} from './artwork-thumbnail.ts';
import {ArtworkThumbnailReceipts} from './artwork-thumbnail-receipts.ts';
import {cachedDisplayDerivative} from './display-derivative-cache.ts';
import {PublicationByteStage,withReadinessStage,stageReadinessBytes,PublicationStageError,type PublicationStagedBytes,type ReadinessStage} from './publication-byte-stage.ts';
import {PublicationFileOperation} from './publication-file-operation.ts';
import {FOOTSTEP_RESOURCE_NAMESPACE,footstepResourcesFor} from '@exhibitos/spec/footstep-resources';
import {footstepResourceBytes} from './footstep-resources.ts';
import {FLOOR_NAMESPACE,validateStudioFloors,remapStudioFloors,type StudioFloors,remapStudioMaterials,type StudioMaterials} from '@exhibitos/studio-contract';
import {ARCHITECTURAL_FINISH_NAMESPACE,remapArchitecturalFinishes,type ArchitecturalFinishes} from '@exhibitos/studio-contract';
import {validateArchitecturalFinishes} from '@exhibitos/studio-contract';
import {PLAQUE_NAMESPACE,remapStudioPlaques,type StudioPlaques} from '@exhibitos/studio-contract';
import {validateStudioPlaques} from '@exhibitos/studio-contract';
import {SPACE_LIGHTING_NAMESPACE} from '@exhibitos/studio-contract';
import {validateStudioLightDetails,LIGHT_DETAILS_NAMESPACE,remapStudioLightDetails,type StudioLightDetails,validateLightAttachments,LIGHT_ATTACHMENT_NAMESPACE,remapLightAttachments,type StudioLightAttachments} from '@exhibitos/studio-contract';
import {validateStudioBenches,BENCH_NAMESPACE,remapStudioBenches,type StudioBenches} from '@exhibitos/studio-contract';
import {qualifyDemoDisplay} from './demo-display-policy.ts';
import {publicationImageDerivative,publicationModelDerivative} from './demo-display-derivative.ts';
import {approvedCoverProjection} from './approved-cover-projection.ts';
import {watermarkFor,watermarkLabel,presentationFor} from '@exhibitos/studio-contract';
import {DISPLAY_POLICY_NAMESPACE,validateArtworkDisplayPolicy} from '@exhibitos/studio-contract';
import {INSTALLATION_NAMESPACE,validateStudioInstallation,remapStudioInstallation,type StudioInstallation} from '@exhibitos/studio-contract';
import { ENTRANCE_NAMESPACE, validateViewerEntrance } from '@exhibitos/studio-contract';
// SPDX-License-Identifier: AGPL-3.0-or-later
import {SPATIAL_NAMESPACE,spatialAudioWithoutTranscript,validateSpatialProfile,remapSpatialProgram,type SpatialProgram} from '@exhibitos/studio-contract';
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { transaction, sha256, type BlobStore } from "@exhibitos/storage";
import { validateExhibition, revisionHash, type Artwork, type Exhibition } from "@exhibitos/spec";
import { DAYLIGHT_NAMESPACE, TEMPLATE_NAMESPACE, validateViewerCuration, curationDurationValid, CURATION_NAMESPACE, validateArchitecture, MATERIAL_NAMESPACE, PRESENTATION_NAMESPACE, validateStudioMaterials, validateStudioPresentation, validateViewerLod, LOD_NAMESPACE, NEAR_TEXTURE_PAIR_PROFILE, EXPERIENCE_NAMESPACE, validateViewerExperience, ARTWORK_DETAILS_NAMESPACE, validateArtworkDetails } from "@exhibitos/studio-contract";
import { ApiError, uuid, type Session } from "./auth.ts";
import { Studio, etag } from "./studio.ts";
import { Cms, validMetadata } from "./cms.ts";
import { viewerVariants, measureFullVariant, type GeneratedVariants } from "./viewer-variants.ts";
import { qualifyApprovedTexturedPair, qualifyApprovedTextureDerivativePair, qualifyApprovedImagePair } from "./approved-lod-pair.ts";
import { Audio, audioMedia, validatePcmWav, type MediaAsset } from "./audio.ts";
import {CoverImages,coverImageAsset} from './cover-images.ts';
import {SPACE_STILL_NAMESPACE,spaceStillFor,type SpaceStillAsset} from '@exhibitos/spec/space-still';
import { allowedRights } from "./rights.ts";
export interface PublicationIssue {
    code: string;
    path: string;
    message: string;
    remediation: string;
}
type PublicationBytes=Buffer|PublicationStagedBytes;
const publicationBytesHash=(value:PublicationBytes)=>Buffer.isBuffer(value)?sha256(value):value.sha256;
type PreparedVariants=Omit<GeneratedVariants,'bytes'>&{bytes?:PublicationBytes};
interface PreparedAsset {
    artwork: Artwork;
    sourceAssetId: string;
    sourceSha256: string;
    bytes: PublicationBytes;
    mime: "model/gltf-binary" | "image/png";
    variants?: PreparedVariants;
    coarseSource?: {id:string;sha256:string};
    thumbnail?:{sourceAssetId:string;sourceSha256:string;bytes:PublicationBytes;receiptId?:string};
    thumbnailReceiptId?:string;
}
interface PreparedFurnishing {source:FurnishingAsset;model:Buffer;notice:Buffer}
/** Only explicitly selected, qualified catalogue identities are public sources.
 * Stored imported resources remain tenant/exhibition scoped; invalid rows never
 * fall back to a catalogue file. Both roles are required on every admission. */
export async function admittedPublicationFurnishings(c:PoolClient,blobs:BlobStore|undefined,tenantId:string,exhibitionId:string,candidate:Exhibition):Promise<PreparedFurnishing[]> {
 if(!validateFurnishings(candidate).valid)throw new ApiError(409,'FURNISHING_UNAVAILABLE');
 const assets=furnishingsFor(candidate)?.assets??[];
 if(assets.length&&!blobs)throw new ApiError(409,'FURNISHING_UNAVAILABLE');
 const result:PreparedFurnishing[]=[];
 for(const source of assets){
  const {model,notice}=await furnishingResourcePair(c,blobs!,tenantId,exhibitionId,source);
  result.push({source,model,notice});
 }
 return result;
}
function checkedPreparedFurnishings(candidate:Exhibition,prepared:PreparedFurnishing[]){
 if(!validateFurnishings(candidate).valid)throw new ApiError(422,'PUBLICATION_NOT_READY');
 const assets=furnishingsFor(candidate)?.assets??[];
 if(assets.length!==prepared.length||new Set(prepared.map(p=>p.source.id.toLowerCase())).size!==prepared.length)throw new ApiError(422,'PUBLICATION_NOT_READY');
 for(const source of assets){const p=prepared.find(p=>p.source.id.toLowerCase()===source.id.toLowerCase());if(!p||!equal(source,p.source)||p.model.length!==source.bytes||sha256(p.model)!==source.sha256||p.notice.length!==source.rights.notice.bytes||sha256(p.notice)!==source.rights.notice.sha256)throw new ApiError(422,'PUBLICATION_NOT_READY');}
}
interface PreparedMedia { source:MediaAsset; bytes:PublicationBytes }
interface PreparedCover {source:SpaceStillAsset;bytes:PublicationBytes}
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
    artwork_deleted?:unknown;artist_deleted?:unknown;tenant_deleted?:unknown;exhibition_deleted?:unknown;asset_deleted?:unknown;rights_deleted?:unknown;
    asset_state?:string;current_revision?:number;approved_revision?:number|null;source_artwork_id?:string;source_approval?:unknown;
    current_source_bytes?:number|string;current_source_mime?:string;approved_asset_id?:string|null;current_source_sha256?:string;current_metadata?:unknown;current_rights?:unknown;
    receipt_artwork_id?:string;receipt_revision?:number;receipt_source_id?:string;receipt_source_sha256?:string;receipt_thumbnail_id?:string;receipt_sha256?:string;receipt_bytes?:number|string;
}
const PUBLIC_REFERENCE_FIELDS = new Set(['id','revisionId','primaryAssetId','sourceAssetIds','appliedToAssetIds','roomId','surfaceId','connectsToOpeningId','artworkRevisionId','assetId','imageAssetId','targetPlacementId','viaOpeningId','routeIds','placementId','targetId','annotationId','zoneId','routeId']);
const issue = (code: string, path: string, message: string, remediation: string): PublicationIssue => ({ code, path, message, remediation });
const equal = (a: unknown, b: unknown): boolean => {
    const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sorted(x)])) : v;
    return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
};
/** Revalidate current source authority after long staging/final writes. Existing
 * CMS/audio/still approvals remain the authority; no second approval registry. */
export async function recheckPublicationSources(c:PoolClient,s:Session,candidate:Exhibition,exhibitionId:string,cms:Cms,blobs?:BlobStore){
 for(const artwork of candidate.artworks)if(!equal((await cms.studioArtwork(c,s,artwork.id)).artwork,artwork))throw new ApiError(409,'ARTWORK_SNAPSHOT_CHANGED');
 for(const media of candidate.mediaAssets)if(!equal(audioMedia(await new Audio(blobs).approved(c,s,exhibitionId,media.id)),media))throw new ApiError(409,'AUDIO_APPROVAL_CHANGED');
 const still=spaceStillFor(candidate);
 if(still&&!equal(coverImageAsset(await new CoverImages(blobs).approved(c,s,exhibitionId,still.id)),still))throw new ApiError(409,'COVER_IMAGE_APPROVAL_CHANGED');
 // Capture the clock after all source queries, including an earlier source
 // whose grant could expire while a later approval was being checked.
 if(!validateExhibition(candidate,{publicationTime:new Date().toISOString()}).valid)throw new ApiError(422,'PUBLICATION_NOT_READY');
}
/** A secondary publication source must be the exact coarse member of its immutable import approval. */
export function approvedPublicationSource(snapshot:unknown,source:{id:string;sha256:string;bytes:number;mime:string},primary:string):boolean {
    if(!snapshot||typeof snapshot!=='object')return false;
    const approval=snapshot as {asset?:{id:string;sha256:string;bytes:number;mime:string};importedArtwork?:Artwork;modelPair?:{version:number;profileId:string;full:{id:string;sha256:string;bytes:number;triangles:number;textureSize:number};reduced:{id:string;sha256:string;bytes:number;triangles:number;textureSize:number}}};
    if(approval.asset?.id!==primary)return false;
    if(source.id===primary)return approval.asset.sha256===source.sha256&&approval.asset.bytes===source.bytes&&approval.asset.mime===source.mime;
    const imported=approval.importedArtwork;
    const importedPrimary=Array.isArray(imported?.assets)?imported.assets.find(a=>a.id===primary):undefined;
    const importedPrimaryMatches=imported?.primaryAssetId===primary&&importedPrimary?.sha256===approval.asset.sha256&&importedPrimary?.bytes===approval.asset.bytes&&importedPrimary?.mime===approval.asset.mime;
    const thumbnail=imported&&importedPrimaryMatches&&validateViewerLod(imported).valid?artworkThumbnailFor(imported):undefined;
    if(thumbnail&&thumbnail.id===source.id)return thumbnail.sha256===source.sha256&&thumbnail.bytes===source.bytes&&thumbnail.mime===source.mime;
    const pair=approval.modelPair;
    if(pair){
      const full=pair.full,low=pair.reduced;
      return pair.version===1&&pair.profileId===NEAR_TEXTURE_PAIR_PROFILE&&source.mime==='model/gltf-binary'&&approval.asset.mime==='model/gltf-binary'&&full?.id===primary&&full.sha256===approval.asset.sha256&&full.bytes===approval.asset.bytes&&low?.id===source.id&&low.sha256===source.sha256&&low.bytes===source.bytes&&low.bytes<full.bytes&&low.triangles===full.triangles&&low.textureSize<full.textureSize&&low.textureSize<=512;
    }
    const a=approval.importedArtwork;
    if(!a||!importedPrimaryMatches||!validateViewerLod(a).valid)return false;
    const lod=a.extensions?.[LOD_NAMESPACE] as unknown as {variants:{assetId:string;detail:string}[]}|undefined;
    const low=lod?.variants.find(v=>v.detail==='coarse');
    const asset=a.assets.find(v=>v.id===source.id);
    return low?.assetId===source.id&&asset?.sha256===source.sha256&&asset.bytes===source.bytes&&asset.mime===source.mime;
}
/** Preview unavailability is isolated; every required display source remains gated. */
export function authorizedArtworkAssets(snapshot:Exhibition,records:AssetRow[],now:number){
 const inventory=snapshot.artworks.flatMap(a=>a.assets),requiredIds=new Set(snapshot.artworks.flatMap(a=>{const preview=artworkThumbnailFor(a)?.id.toLowerCase();return a.assets.filter(asset=>asset.id.toLowerCase()!==preview).map(asset=>asset.id.toLowerCase());}));
 const optionalPreviewIds=new Set(snapshot.artworks.map(a=>artworkThumbnailFor(a)?.id.toLowerCase()).filter((id):id is string=>!!id&&!requiredIds.has(id)));
 const permitted:AssetRow[]=[];
 for(const r of records){
  const approval=r.source_approval as {asset?:{id?:string;sha256?:string}}|undefined;
  // The joined approval belongs to this publication's immutable artwork
  // revision. A later private edit clears the current approval pointer; that
  // does not revoke the earlier approved source or authorize a different one.
  const historicalPrimary=approval?.asset?.id;
  const receipt=optionalPreviewIds.has(String(r.id).toLowerCase())&&r.receipt_artwork_id===r.artwork_id&&r.receipt_revision===r.artwork_revision&&r.receipt_source_id===historicalPrimary&&approval?.asset?.sha256===r.receipt_source_sha256&&r.receipt_thumbnail_id===r.source_asset_id&&r.receipt_sha256===r.source_sha256&&Number(r.receipt_bytes)===Number(r.current_source_bytes)&&r.current_source_mime==='image/png';
  const item=inventory.find(a=>a.id===r.id),valid=item&&item.sha256===r.sha256&&item.bytes===Number(r.bytes)&&item.mime===r.mime&&!r.artwork_deleted&&!r.artist_deleted&&!r.tenant_deleted&&!r.exhibition_deleted&&!r.asset_deleted&&!r.rights_deleted&&r.asset_state==='approved'&&r.source_artwork_id===r.artwork_id&&typeof r.current_source_mime==='string'&&typeof historicalPrimary==='string'&&(receipt||approvedPublicationSource(r.source_approval,{id:r.source_asset_id,sha256:r.source_sha256,bytes:Number(r.current_source_bytes),mime:r.current_source_mime},historicalPrimary))&&r.current_source_sha256===r.source_sha256&&validMetadata(r.current_metadata)&&allowedRights(r.current_metadata.rights,'display',now)&&allowedRights(r.current_rights,'display',now);
  if(!valid){if(optionalPreviewIds.has(String(r.id).toLowerCase()))continue;throw new ApiError(404,'PUBLICATION_UNAVAILABLE');}
  permitted.push(r);
 }
 if(inventory.some(a=>!optionalPreviewIds.has(a.id.toLowerCase())&&!permitted.some(r=>r.id===a.id)))throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
 return permitted;
}
/** Required content gets the budget first; previews are admitted only into the remainder. */
export function admitOptionalThumbnails(prepared:PreparedAsset[],requiredBytes:number,limit=67108864){
 let remaining=Math.max(0,limit-requiredBytes);
 for(const item of prepared){if(!item.thumbnail)continue;if(item.thumbnail.bytes.length>remaining)delete item.thumbnail;else remaining-=item.thumbnail.bytes.length;}
}
/** Only complete public fields and known presentation/material extensions cross the anonymous boundary. */
export function projectPublication(candidate: Exhibition, prepared: PreparedAsset[], at: string, media: PreparedMedia[] = [],cover?:PreparedCover, furnishings:PreparedFurnishing[] = []) {
    // The exported projection retains its original byte-based integrity boundary.
    // Private staging never grants authority to caller-supplied descriptors.
    if(prepared.some(p=>!Buffer.isBuffer(p.bytes)||p.thumbnail&&!Buffer.isBuffer(p.thumbnail.bytes)||p.variants?.bytes&&!Buffer.isBuffer(p.variants.bytes))||media.some(p=>!Buffer.isBuffer(p.bytes))||cover&&!Buffer.isBuffer(cover.bytes))throw new ApiError(422,'PUBLICATION_NOT_READY');
    return projectPublicationCore(candidate,prepared,at,media,cover,furnishings,publicationBytesHash);
}
function projectPublicationCore(candidate:Exhibition,prepared:PreparedAsset[],at:string,media:PreparedMedia[],cover:PreparedCover|undefined,furnishings:PreparedFurnishing[],byteHash:(bytes:PublicationBytes)=>string){
    if(!validateViewingPlan(candidate).valid||!validateStudioMaterials(candidate).valid||!validateStudioFloors(candidate).valid||!validateStudioLightDetails(candidate).valid||!validateLightAttachments(candidate).valid||!validateArchitecturalFinishes(candidate).valid || !validateStudioPlaques(candidate).valid || !validateStudioBenches(candidate).valid||!validateStudioInstallation(candidate).valid)throw new ApiError(422,'PUBLICATION_NOT_READY');
    checkedPreparedFurnishings(candidate,furnishings);
    const furniture=furnishingsFor(candidate);
    const doc = structuredClone(candidate), ids = new Map<string, string>(), assets: {
        id: string;
        prepared: PreparedAsset;
    }[] = [];
    const still=spaceStillFor(candidate);
    if(!!still!==!!cover||still&&cover&&(!equal(still,cover.source)||cover.bytes.length!==still.bytes||byteHash(cover.bytes)!==still.sha256))throw new ApiError(422,'PUBLICATION_NOT_READY');
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
    doc.extensions = Object.fromEntries(Object.entries(doc.extensions ?? {}).filter(([key]) => [FURNISHING_NAMESPACE, DAYLIGHT_NAMESPACE, TEMPLATE_NAMESPACE, MATERIAL_NAMESPACE, PRESENTATION_NAMESPACE, INSTALLATION_NAMESPACE, FLOOR_NAMESPACE, BENCH_NAMESPACE, ARCHITECTURAL_FINISH_NAMESPACE, PLAQUE_NAMESPACE, LIGHT_DETAILS_NAMESPACE, LIGHT_ATTACHMENT_NAMESPACE, SPACE_LIGHTING_NAMESPACE, ENTRANCE_NAMESPACE, SPACE_STILL_NAMESPACE,EXPERIENCE_NAMESPACE, CURATION_NAMESPACE, VIEWING_PLAN_NAMESPACE, SPATIAL_NAMESPACE, FOOTSTEP_RESOURCE_NAMESPACE].includes(key)));
    doc.extensions[PRESENTATION_NAMESPACE]={...presentationFor(doc),watermark:watermarkFor(doc)} as unknown as NonNullable<Exhibition['extensions']>[string];
    const lightDetails=doc.extensions?.[LIGHT_DETAILS_NAMESPACE] as unknown as StudioLightDetails|undefined;
    const attachments=doc.extensions?.[LIGHT_ATTACHMENT_NAMESPACE] as unknown as StudioLightAttachments|undefined;
    const finishes=doc.extensions?.[ARCHITECTURAL_FINISH_NAMESPACE] as unknown as ArchitecturalFinishes|undefined;
    const plaques=doc.extensions?.[PLAQUE_NAMESPACE] as unknown as StudioPlaques|undefined;
    for(const p of plaques?.plaques??[])map(p.id);
    const viewingPlan=doc.extensions?.[VIEWING_PLAN_NAMESPACE] as unknown as ViewingPlan|undefined;
    const benches=doc.extensions?.[BENCH_NAMESPACE] as unknown as StudioBenches|undefined;
    for(const b of benches?.benches??[])map(b.id);
    const spatial=doc.extensions?.[SPATIAL_NAMESPACE] as unknown as SpatialProgram|undefined;
    const floors=doc.extensions?.[FLOOR_NAMESPACE] as unknown as StudioFloors|undefined;
    const materials=doc.extensions?.[MATERIAL_NAMESPACE] as unknown as StudioMaterials|undefined;
    const installation=doc.extensions?.[INSTALLATION_NAMESPACE] as unknown as StudioInstallation|undefined;
    if(doc.extensions){delete doc.extensions[MATERIAL_NAMESPACE];delete doc.extensions[FLOOR_NAMESPACE];delete doc.extensions[ARCHITECTURAL_FINISH_NAMESPACE];delete doc.extensions[PLAQUE_NAMESPACE];delete doc.extensions[LIGHT_DETAILS_NAMESPACE];delete doc.extensions[LIGHT_ATTACHMENT_NAMESPACE];delete doc.extensions[BENCH_NAMESPACE];delete doc.extensions[SPATIAL_NAMESPACE];delete doc.extensions[INSTALLATION_NAMESPACE];}
    collect(doc);
    doc.artworks = prepared.map(p => {
        const a = structuredClone(p.artwork), assetId = map(p.sourceAssetId);
        assets.push({ id: assetId, prepared: p });
        const details=a.extensions?.[ARTWORK_DETAILS_NAMESPACE],displayPolicy=a.extensions?.[DISPLAY_POLICY_NAMESPACE],approvedSource=qualifyDemoDisplay(p.artwork),approvedDisplay=approvedSource?.canonicalAssetSha256===byteHash(p.bytes)?approvedSource:undefined;
        delete a.extensions;
        if(details!==undefined&&validateArtworkDetails(p.artwork).valid)a.extensions={[ARTWORK_DETAILS_NAMESPACE]:structuredClone(details)};
        if(displayPolicy!==undefined&&approvedDisplay)a.extensions={...a.extensions,[DISPLAY_POLICY_NAMESPACE]:structuredClone(displayPolicy)};
        a.assets = [{ id: p.sourceAssetId, path: `assets/${assetId}/${p.mime === "image/png" ? "image.png" : "model.glb"}`, role: p.mime === "image/png" ? "image" : "model", mime: p.mime, bytes: p.bytes.length, sha256: byteHash(p.bytes) }];
        a.primaryAssetId = p.sourceAssetId;
        if(p.thumbnail){
            const thumbnailId=map(p.thumbnail.sourceAssetId);
            assets.push({id:thumbnailId,prepared:{...p,sourceAssetId:p.thumbnail.sourceAssetId,sourceSha256:p.thumbnail.sourceSha256,bytes:p.thumbnail.bytes,mime:'image/png',thumbnailReceiptId:p.thumbnail.receiptId,thumbnail:undefined,variants:undefined}});
            a.assets.push({id:p.thumbnail.sourceAssetId,path:`assets/${thumbnailId}/thumbnail.png`,role:'preview',mime:'image/png',bytes:p.thumbnail.bytes.length,sha256:byteHash(p.thumbnail.bytes)});
            a.extensions={...a.extensions,[ARTWORK_THUMBNAIL_NAMESPACE]:{version:1,assetId:p.thumbnail.sourceAssetId}};
        }
        if (p.variants) {
            const metric=(v:GeneratedVariants['full']):Record<string,number>=>{const key=p.mime==='image/png'?'textureSize':'triangles',n=v[key];if(!Number.isSafeInteger(n)||n===undefined||n<1)throw new ApiError(422,'PUBLICATION_NOT_READY');if(p.variants?.profile){if(!Number.isSafeInteger(v.textureSize)||!v.textureSize)throw new ApiError(422,'PUBLICATION_NOT_READY');return {triangles:n,textureSize:v.textureSize};}return {[key]:n};};
            const variants = [{assetId:p.sourceAssetId,detail:"full",...metric(p.variants.full)}];
            if (p.variants.coarse && p.variants.bytes) {
                const coarseId=randomUUID();
                assets.push({id:coarseId,prepared:{...p,bytes:p.variants.bytes,...(p.coarseSource?{sourceAssetId:p.coarseSource.id,sourceSha256:p.coarseSource.sha256}:{})}});
                a.assets.push({id:coarseId,path:`assets/${coarseId}/${p.mime==="image/png"?"image.png":"model.glb"}`,role:p.mime==="image/png"?"image":"model",mime:p.mime,bytes:p.variants.bytes.length,sha256:byteHash(p.variants.bytes)});
                variants.push({assetId:coarseId,detail:"coarse",...metric(p.variants.coarse)});
            }
            a.extensions={...a.extensions,[LOD_NAMESPACE]:{version:1,variants,...(p.variants.profile?{profile:p.variants.profile}:{})}};
        }
        a.provenance = { authorship: a.provenance.authorship, events: [{ id: randomUUID(), type: "exhibited", at, description: approvedDisplay?`Approved exact selected open-access display. Object ${approvedDisplay.officialObjectURL}; raw SHA256 ${approvedDisplay.rawSourceSha256}; canonical SHA256 ${approvedDisplay.canonicalAssetSha256}; recipe SHA256 ${approvedDisplay.recipeSha256}; rights evidence SHA256 ${approvedDisplay.rightsEvidenceSha256}.`:"Approved display derivative explicitly published by its authorized exhibition editor." }] };
        return a;
    });
    doc.mediaAssets=media.map(p=>({...structuredClone(p.source),path:`media/${map(p.source.id)}/audio.wav`}));
    if(still&&doc.extensions)doc.extensions[SPACE_STILL_NAMESPACE]={version:1,asset:{...structuredClone(still),path:`space-still/${map(still.id)}/image.png`}};
    const remap = (v: unknown, field=""): unknown => typeof v === "string" ? (PUBLIC_REFERENCE_FIELDS.has(field) ? ids.get(v.toLowerCase()) ?? v : v) : Array.isArray(v) ? v.map(x=>remap(x,field)) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [field === 'surfaces' ? ids.get(k.toLowerCase()) ?? k : k, remap(x,k)])) : v;
    const snapshot = remap(doc) as Exhibition;
    if(materials)snapshot.extensions={...snapshot.extensions,[MATERIAL_NAMESPACE]:remapStudioMaterials(materials,ids) as unknown as {[key:string]:import('@exhibitos/spec').JsonValue}};
    if(floors)snapshot.extensions={...snapshot.extensions,[FLOOR_NAMESPACE]:remapStudioFloors(floors,ids) as unknown as {[key:string]:import('@exhibitos/spec').JsonValue}};
    if(lightDetails)snapshot.extensions={...snapshot.extensions,[LIGHT_DETAILS_NAMESPACE]:remapStudioLightDetails(lightDetails,ids) as unknown as {[key:string]:import('@exhibitos/spec').JsonValue}};
    if(attachments)snapshot.extensions={...snapshot.extensions,[LIGHT_ATTACHMENT_NAMESPACE]:remapLightAttachments(attachments,ids) as unknown as {[key:string]:import('@exhibitos/spec').JsonValue}};
    if(finishes)snapshot.extensions={...snapshot.extensions,[ARCHITECTURAL_FINISH_NAMESPACE]:remapArchitecturalFinishes(finishes,ids) as unknown as {[key:string]:import('@exhibitos/spec').JsonValue}};
    if(plaques)snapshot.extensions={...snapshot.extensions,[PLAQUE_NAMESPACE]:remapStudioPlaques(plaques,ids) as unknown as {[key:string]:import('@exhibitos/spec').JsonValue}};
    if(viewingPlan)snapshot.extensions={...snapshot.extensions,[VIEWING_PLAN_NAMESPACE]:remapViewingPlan(viewingPlan,ids) as unknown as {[key:string]:import('@exhibitos/spec').JsonValue}};
    if(benches)snapshot.extensions={...snapshot.extensions,[BENCH_NAMESPACE]:remapStudioBenches(benches,ids) as unknown as {[key:string]:import('@exhibitos/spec').JsonValue}};
    if(installation)snapshot.extensions={...snapshot.extensions,[INSTALLATION_NAMESPACE]:remapStudioInstallation(installation,ids) as unknown as {[key:string]:import('@exhibitos/spec').JsonValue}};
    if(spatial)snapshot.extensions={...snapshot.extensions,[SPATIAL_NAMESPACE]:remapSpatialProgram(spatial,map) as unknown as {[key:string]:import("@exhibitos/spec").JsonValue}};
    if(furniture)snapshot.extensions={...snapshot.extensions,[FURNISHING_NAMESPACE]:remapFurnishings(furniture,ids) as unknown as NonNullable<Exhibition['extensions']>[string]};
    if(!validateFurnishings(snapshot).valid)throw new ApiError(422,'PUBLICATION_NOT_READY');
    snapshot.createdAt = at;
    snapshot.revision = 1;
    if(!validateStudioMaterials(snapshot).valid||!validateStudioFloors(snapshot).valid)throw new ApiError(422,'PUBLICATION_NOT_READY');
    return { snapshot, assets, media:media.map(p=>({id:map(p.source.id),prepared:p})),cover:cover?{id:map(cover.source.id),prepared:cover}:undefined };
}
/** Optional read-only approved Pages projection for the selected hosted profile.
 * This never supplies private roles or opening host authority. */
export interface PublicationSource {
    anonymous(id: string): Promise<unknown>;
    asset(id: string, assetId: string): Promise<{bytes: Buffer;mime: string;revisionSha256: string}>;
    resource?(id:string,sha256:string):Promise<{bytes:Buffer;mime:string;revisionSha256:string}>;
    furnishingNotice?(id:string,assetId:string):Promise<{bytes:Buffer;mime:string;revisionSha256:string}>;
}
export class Publications {
    readonly studio = new Studio();
    readonly cms: Cms;
    readonly pool: Pool;
    readonly blobs: BlobStore | undefined;
    constructor(pool: Pool, blobs?: BlobStore) { this.pool = pool; this.blobs = blobs; this.cms = new Cms(blobs); }
    private summary(row: PublicationRow) { return { publicationId: row.id, publicUrl: `/p/${row.id}`, revisionSha256: row.revision_sha256, publishedAt: new Date(row.published_at).toISOString(), status: row.status }; }
    private async prepare(c: PoolClient, s: Session, candidate: Exhibition, exhibitionId:string,stage?:ReadinessStage,budget=67108864) {
        if(!Number.isSafeInteger(budget)||budget<1||budget>536870912||budget>67108864&&!stage)throw new ApiError(409,'PUBLICATION_STAGE_UNAVAILABLE');
        const store=(bytes:Buffer):Promise<PublicationBytes>=>stageReadinessBytes(stage,bytes);
        const errors: PublicationIssue[] = [], prepared: PreparedAsset[] = [], media:PreparedMedia[]=[];
        let furnishings:PreparedFurnishing[]=[];
        let cover:PreparedCover|undefined;
        let totalBytes = 0;
        const at = new Date().toISOString();
        for(const e of [...validateFurnishings(candidate).errors,...validateStudioFloors(candidate).errors,...validateStudioPresentation(candidate).errors,...validateStudioLightDetails(candidate).errors,...validateLightAttachments(candidate).errors,...validateArchitecturalFinishes(candidate).errors,...validateStudioPlaques(candidate).errors,...validateStudioBenches(candidate).errors,...validateStudioInstallation(candidate).errors,...validateViewerEntrance(candidate).errors,...validateArchitecture(candidate,true).errors,...validateSpatialProfile(candidate).errors,...validateViewerCuration(candidate).errors,...validateViewingPlan(candidate).errors])errors.push(issue(e.code,e.path,e.message,"Correct template licensing, architecture or curation controls before publishing."));
        for(const id of spatialAudioWithoutTranscript(candidate)) errors.push(issue("SPATIAL_AUDIO_TRANSCRIPT","/candidate/extensions/org.exhibitos.runtime~1spatial-scripting","Script audio lacks a readable original transcript: "+id,"Bind the approved audio to an authored voice or audio zone with its original transcript before publishing."));
        const valid = validateExhibition(candidate, { publicationTime: at });
        for (const e of valid.errors.slice(0, 64))
            errors.push(issue(e.code, e.path, e.message, "Correct the referenced geometry, rights or accessibility field and save the draft before retrying."));
        if(candidate.mediaAssets.length>32||!validateViewerExperience(candidate).valid) errors.push(issue("PUBLICATION_LIMIT","/candidate/mediaAssets","Invalid bounded experience or more than32 media assets.","Correct the experience references and use at most32 approved media assets."));
        for(const [i,a]of candidate.artworks.entries())for(const e of validateArtworkDisplayPolicy(a).errors)errors.push(issue(e.code,`/candidate/artworks/${i}${e.path}`,e.message,'Use the exact approved selected-file policy and primary asset.'));
        if (candidate.artworks.length > 64)
            errors.push(issue("PUBLICATION_LIMIT", "/candidate/artworks", "At most 64 artworks per bounded publication.", "Split the exhibition into smaller publication drafts."));
        if (errors.length)
            return { issues: errors, prepared, media, cover,furnishings,at };
        try{
            // Furnishing pairs retain their existing in-memory bound. Do not
            // load an aggregate furnishing inventory of archive-sized buffers.
            const furnishingBytes=(furnishingsFor(candidate)?.assets??[]).reduce((n,a)=>n+a.bytes+a.rights.notice.bytes,0);
            if(!Number.isSafeInteger(furnishingBytes)||furnishingBytes>67108864)throw new ApiError(422,'PUBLICATION_LIMIT');
            furnishings=await admittedPublicationFurnishings(c,this.blobs,s.tenantId,exhibitionId,candidate);
            totalBytes+=furnishings.reduce((n,p)=>n+p.model.length+p.notice.length,0);
            if(totalBytes>budget)throw new ApiError(422,'PUBLICATION_LIMIT');
        }catch(error){errors.push(issue(error instanceof ApiError?error.code:'FURNISHING_UNAVAILABLE','/candidate/extensions/org.exhibitos.studio~1furnishing-visuals','Selected furnishing model or CC0 notice is unavailable or invalid.','Restore the exact supported catalogue bytes and functional host before publication.'));}
        for(const resource of footstepResourcesFor(candidate)){
            try{
                if(!this.blobs)throw new ApiError(409,'FOOTSTEP_RESOURCE_UNAVAILABLE');
                const bytes=await footstepResourceBytes(c,this.blobs,s.tenantId,exhibitionId,resource);
                totalBytes+=bytes.length;if(totalBytes>budget)throw new ApiError(422,'PUBLICATION_LIMIT');
            }catch(error){errors.push(issue(error instanceof ApiError?error.code:'FOOTSTEP_RESOURCE_UNAVAILABLE','/candidate/extensions/org.exhibitos.viewer~1footstep-resources','Selected footstep resource bytes are unavailable or invalid.','Restore the exact registered resource before publication.'));}
        }
        const watermark=watermarkFor(candidate),displayWatermark=watermark.mode==='embedded'?{...watermark,text:watermarkLabel(candidate)}:watermark;
        for(const [i,asset] of candidate.mediaAssets.entries()) {
            try {
                const row=await new Audio(this.blobs).approved(c,s,exhibitionId,asset.id);
                if(!equal(audioMedia(row),asset)||!this.blobs)throw new ApiError(409,"AUDIO_APPROVAL_CHANGED");
                const bytes=Buffer.from(await this.blobs.get(row.object_key));
                if(bytes.length!==asset.bytes||sha256(bytes)!==asset.sha256)throw new ApiError(409,"ASSET_INTEGRITY");
                if(!curationDurationValid(candidate,asset.id,validatePcmWav(bytes).durationSeconds))throw new ApiError(422,"CURATION_AUDIO_DURATION");totalBytes+=bytes.length;
                if(totalBytes>budget)throw new ApiError(422,"PUBLICATION_LIMIT");
                media.push({source:asset,bytes:await store(bytes)});
            }catch(error){if(error instanceof PublicationStageError)throw error;errors.push(issue(error instanceof ApiError?error.code:"AUDIO_UNAVAILABLE",`/candidate/mediaAssets/${i}`,"Current approved audio, bytes or display rights unavailable.","Upload and approve exact PCM16 WAV for this exhibition; correct current rights or restore its availability."));}
        }
        const still=spaceStillFor(candidate);
        if(still){try{
            const source=await new CoverImages(this.blobs).approvedBytes(c,s,exhibitionId,still.id);
            if(!equal(coverImageAsset(source.row),still))throw new ApiError(409,'COVER_IMAGE_APPROVAL_CHANGED');
            totalBytes+=source.bytes.length;if(totalBytes>budget)throw new ApiError(422,'PUBLICATION_LIMIT');cover={source:still,bytes:await store(source.bytes)};
        }catch(error){if(error instanceof PublicationStageError)throw error;errors.push(issue(error instanceof ApiError?error.code:'COVER_IMAGE_UNAVAILABLE','/candidate/extensions/org.exhibitos.viewer~1space-still','Current approved space PNG, exact bytes or display rights unavailable.','Approve the exact separate PNG for this exhibition and restore its current display grant.'));}}
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
                const exactModel=qualifyDemoDisplay(artwork)?.canonicalMime==='model/gltf-binary';
                let result: {bytes:Buffer;mime:"model/gltf-binary"|"image/png"};
                if (artwork.artworkType === "image") {
                    await this.cms.display(c,s,artwork.id,false,artwork.revision);
                    const asset=(await c.query("SELECT id,object_key,bytes,sha256 FROM assets WHERE tenant_id=$1 AND id=$2",[s.tenantId,primary.id])).rows[0];
                    if(!asset||!this.blobs)throw new ApiError(503,"STORAGE_UNAVAILABLE");
                    const original=Buffer.from(await this.blobs.get(asset.object_key));
                    if(original.length!==Number(asset.bytes)||sha256(original)!==asset.sha256)throw new ApiError(409,"ASSET_INTEGRITY");
                    result={bytes:await publicationImageDerivative(artwork,original,artwork.primaryAssetId,{watermark:displayWatermark,cache:{client:c,blobs:this.blobs,tenantId:s.tenantId,assetId:asset.id,sourceSha256:asset.sha256}}),mime:"image/png"};
                } else if(exactModel){
                    const original=await this.cms.approvedVariantOriginal(c,s,artwork.id,primary.id,artwork.revision);
                    result={bytes:await publicationModelDerivative(artwork,original,{watermark:displayWatermark}),mime:'model/gltf-binary'};
                    if(!equal((await this.cms.studioArtwork(c,s,artwork.id)).artwork,artwork))throw new ApiError(409,'REVISION_CONFLICT');
                    if(!(await this.cms.approvedVariantOriginal(c,s,artwork.id,primary.id,artwork.revision)).equals(original))throw new ApiError(409,'ASSET_INTEGRITY');
                } else result=await this.cms.display(c,s,artwork.id,true,artwork.revision,displayWatermark) as {bytes:Buffer;mime:"model/gltf-binary"};
                // Unsupported/nonreducing simplification remains an honest full-only fallback.
                const fullMetric=measureFullVariant(result.bytes,result.mime);
                const lod=artwork.extensions?.[LOD_NAMESPACE] as unknown as {profile?:typeof NEAR_TEXTURE_PAIR_PROFILE;variants:{assetId:string;detail:string;triangles?:number;textureSize?:number}[]}|undefined;
                if(lod&&!validateViewerLod(artwork).valid)throw new ApiError(409,'APPROVAL_INVALID');
                const low=lod?.variants.find(v=>v.detail==='coarse'),high=lod?.variants.find(v=>v.detail==='full');
                const generated:GeneratedVariants=exactModel||(low&&high&&result.mime==='image/png')?{full:fullMetric}:await viewerVariants(result.bytes,result.mime).catch(()=>({full:fullMetric}));
                let variants:GeneratedVariants={...generated,full:fullMetric};
                let coarseSource:PreparedAsset['coarseSource'];
                if(low&&high&&result.mime==='image/png'){
                    const full=await this.cms.approvedVariantOriginal(c,s,artwork.id,high.assetId,artwork.revision);
                    const coarse=await this.cms.approvedVariantOriginal(c,s,artwork.id,low.assetId,artwork.revision);
                    // Both inputs must remain authorized even for unsupported pairs.
                    const displayCoarse=await publicationImageDerivative(artwork,coarse,low.assetId,{watermark:displayWatermark,cache:this.blobs?{client:c,blobs:this.blobs,tenantId:s.tenantId,assetId:low.assetId,sourceSha256:sha256(coarse)}:undefined});
                    try{
                        qualifyApprovedImagePair(full,coarse,high.textureSize!,low.textureSize!);
                        const coarseMetric=measureFullVariant(displayCoarse,'image/png');
                        if(!coarseMetric.textureSize||!fullMetric.textureSize||coarseMetric.textureSize>=fullMetric.textureSize||displayCoarse.length>=result.bytes.length)throw Error('APPROVED_LOD_UNSUPPORTED');
                        variants={full:fullMetric,coarse:coarseMetric,bytes:displayCoarse};
                        const source=artwork.assets.find(a=>a.id.toLowerCase()===low.assetId.toLowerCase())!;
                        coarseSource={id:source.id,sha256:source.sha256};
                    }catch(error){if(!(error instanceof Error)||error.message!=='APPROVED_LOD_UNSUPPORTED')throw new ApiError(422,'APPROVED_LOD_INVALID');variants={full:fullMetric};}
                    if(!equal((await this.cms.studioArtwork(c,s,artwork.id)).artwork,artwork))throw new ApiError(409,'REVISION_CONFLICT');
                    if(!(await this.cms.approvedVariantOriginal(c,s,artwork.id,high.assetId,artwork.revision)).equals(full)||!(await this.cms.approvedVariantOriginal(c,s,artwork.id,low.assetId,artwork.revision)).equals(coarse))throw new ApiError(409,'ASSET_INTEGRITY');
                }
                if(low&&high&&result.mime==='model/gltf-binary'){
                    // Current authorization/integrity failures are never converted to full-only fallback.
                    const full=await this.cms.displayApprovedVariant(c,s,artwork.id,high.assetId,artwork.revision,displayWatermark);
                    const coarse=await this.cms.displayApprovedVariant(c,s,artwork.id,low.assetId,artwork.revision,displayWatermark);
                    if(!full.bytes.equals(result.bytes))throw new ApiError(409,'ASSET_INTEGRITY');
                    try {
                        const textureOnly=lod?.profile===NEAR_TEXTURE_PAIR_PROFILE;
                        if(textureOnly)qualifyApprovedTextureDerivativePair(full.original,coarse.original,{triangles:high.triangles!,fullTextureSize:high.textureSize!,reducedTextureSize:low.textureSize!});
                        else qualifyApprovedTexturedPair(full.original,coarse.original,high.triangles!,low.triangles!);
                        const coarseMetric=measureFullVariant(coarse.bytes,coarse.mime);
                        if(!coarseMetric.triangles||!fullMetric.triangles||(textureOnly?coarseMetric.triangles!==fullMetric.triangles:coarseMetric.triangles>=fullMetric.triangles)||coarse.bytes.length>=result.bytes.length)throw Error('APPROVED_LOD_UNSUPPORTED');
                        variants={full:fullMetric,coarse:coarseMetric,bytes:coarse.bytes,...(textureOnly?{profile:NEAR_TEXTURE_PAIR_PROFILE}:{})};
                        const source=artwork.assets.find(a=>a.id.toLowerCase()===low.assetId.toLowerCase())!;
                        coarseSource={id:source.id,sha256:source.sha256};
                    }catch(error){if(!(error instanceof Error)||error.message!=='APPROVED_LOD_UNSUPPORTED')throw new ApiError(422,'APPROVED_LOD_INVALID');variants={full:fullMetric};}
                    // Reobserve the entire immutable imported inventory after both decoders.
                    if(!equal((await this.cms.studioArtwork(c,s,artwork.id)).artwork,artwork))throw new ApiError(409,'REVISION_CONFLICT');
                    if(!(await this.cms.approvedVariantOriginal(c,s,artwork.id,high.assetId,artwork.revision)).equals(full.original)||!(await this.cms.approvedVariantOriginal(c,s,artwork.id,low.assetId,artwork.revision)).equals(coarse.original))throw new ApiError(409,'ASSET_INTEGRITY');
                }
                // A cached/no-op file still needs a current authorization check
                // after the final asynchronous derivative/variant work.
                if(!equal((await this.cms.studioArtwork(c,s,artwork.id)).artwork,artwork))throw new ApiError(409,'REVISION_CONFLICT');
                let thumbnail:PreparedAsset['thumbnail'];
                const selectedThumbnail=artworkThumbnailFor(artwork);
                if(this.blobs){
                    try{
                        const selected=await new ArtworkThumbnailReceipts(this.blobs).selectedForPublication(c,s,artwork.id,artwork.revision,primary.id,primary.sha256);
                        if(selected){
                            const bytes=await cachedDisplayDerivative(selected.bytes,'image/png',{maxTextureSize:512,watermark:displayWatermark},{client:c,blobs:this.blobs,tenantId:s.tenantId,assetId:selected.assetId,sourceSha256:selected.sha256});
                            await validateThumbnailBytes(bytes);
                            const again=await new ArtworkThumbnailReceipts(this.blobs).selectedForPublication(c,s,artwork.id,artwork.revision,primary.id,primary.sha256);
                            if(!again||again.id!==selected.id||!again.bytes.equals(selected.bytes))throw new ApiError(409,'ASSET_INTEGRITY');
                            thumbnail={sourceAssetId:selected.assetId,sourceSha256:selected.sha256,bytes,receiptId:selected.id};
                        }
                    }catch{/* A receipt or its live rights may be unavailable; keep the artwork. */}
                }
                if(!thumbnail&&selectedThumbnail){
                    try{
                        const original=await this.cms.approvedVariantOriginal(c,s,artwork.id,selectedThumbnail.id,artwork.revision);
                        await validateThumbnailBytes(original);
                        const bytes=await cachedDisplayDerivative(original,'image/png',{maxTextureSize:512,watermark:displayWatermark},this.blobs?{client:c,blobs:this.blobs,tenantId:s.tenantId,assetId:selectedThumbnail.id,sourceSha256:selectedThumbnail.sha256}:undefined);
                        await validateThumbnailBytes(bytes);
                        if(!(await this.cms.approvedVariantOriginal(c,s,artwork.id,selectedThumbnail.id,artwork.revision)).equals(original))throw new ApiError(409,'ASSET_INTEGRITY');
                        thumbnail={sourceAssetId:selectedThumbnail.id,sourceSha256:selectedThumbnail.sha256,bytes};
                    }catch{/* Optional preview failure leaves the artwork available without it. */}
                }
                if(!equal((await this.cms.studioArtwork(c,s,artwork.id)).artwork,artwork))throw new ApiError(409,'REVISION_CONFLICT');
                totalBytes += result.bytes.length + (variants?.bytes?.length??0);
                if (totalBytes > budget) {
                    errors.push(issue("PUBLICATION_LIMIT", path, "Qualified display derivatives exceed the active publication budget.", "Use supported private staging or split the exhibition into smaller publication drafts."));
                    break;
                }
                const storedVariants:PreparedVariants|undefined=variants?.bytes?{...variants,bytes:await store(variants.bytes)}:variants;
                // Keep at most 64 bounded 512KiB previews until required
                // content has its budget; discarded previews never fill disk.
                const storedThumbnail=thumbnail;
                prepared.push({ artwork, sourceAssetId: primary.id, sourceSha256: primary.sha256, bytes: await store(result.bytes), mime: result.mime, variants:storedVariants, ...(coarseSource?{coarseSource}:{}),...(storedThumbnail?{thumbnail:storedThumbnail}:{}) });
            }
            catch (error) {
                if(error instanceof PublicationStageError)throw error;
                const code = error instanceof ApiError ? error.code : "ARTWORK_UNAVAILABLE";
                errors.push(issue(code, path, "Current approved artwork, display rights or qualified derivative is unavailable.", "Review current CMS approval, ownership/assignment and artwork/asset display grants; reimport after correcting them."));
            }
        }
        admitOptionalThumbnails(prepared,totalBytes,budget);
        if(stage)for(const p of prepared)if(p.thumbnail)p.thumbnail={...p.thumbnail,bytes:await store(p.thumbnail.bytes as Buffer)};
        return { issues: errors, prepared, media, cover,furnishings,at };
    }
    async ready(c: PoolClient, s: Session, id: string,fileOperation?:PublicationFileOperation) {
        try{
        const row = await this.studio.access(c, s, id);
        // Larger aggregates require private disk staging. Unsupported
        // unlink/disk conditions retain the existing <=64MiB memory path.
        const prepare=async(stage?:ReadinessStage,budget=67108864)=>{
         const report=await this.prepare(c,s,row.metadata.candidate,id,stage,budget);
         if(!report.issues.length){try{await recheckPublicationSources(c,s,row.metadata.candidate,id,this.cms,this.blobs);}catch(error){if(!(error instanceof ApiError))throw error;report.issues.push(issue(error.code,'/candidate','Source approval or display grant changed during preparation.','Refresh the current approved sources before retrying publication.'));}}
         return { status: report.issues.length ? "BLOCKED" : "READY", etag: etag(row.revision, row.metadata), issues: report.issues };
        };
        if(fileOperation){
         if(!(fileOperation instanceof PublicationFileOperation))throw new ApiError(409,'PUBLICATION_STAGE_UNAVAILABLE');
         const match=etag(row.revision,row.metadata),stage=await fileOperation.claim(c,s,this.blobs,'readiness',id,match),result=await prepare(stage,fileOperation.budget);
         await stage.close();await fileOperation.verify(c,s,this.blobs,'readiness',id,match);return result;
        }
        return withReadinessStage(prepare);
        }finally{await fileOperation?.close();}
    }
    /** Existing Studio roles/ownership, projected metadata only; export rechecks public rights/revision. */
    async catalog(c: PoolClient, s: Session) {
        if (!["admin", "curator", "artist"].includes(s.role)) throw new ApiError(403, "FORBIDDEN");
        const result = await c.query(
            "SELECT p.id,p.exhibition_id,p.revision_sha256,p.published_at,p.snapshot->>'title' AS title FROM studio_publications p JOIN publication_states state ON state.publication_id=p.id JOIN exhibitions e ON e.tenant_id=p.tenant_id AND e.id=p.exhibition_id WHERE p.tenant_id=$1 AND state.status='published' AND e.studio_managed AND e.deleted_at IS NULL AND ($2::boolean OR e.studio_owner_user_id=$3) ORDER BY p.published_at DESC,p.id LIMIT 100",
            [s.tenantId, s.role === "admin", s.userId],
        );
        return { items: result.rows.map(row => ({
            publicationId: row.id as string,
            exhibitionId: row.exhibition_id as string,
            title: typeof row.title === "string" ? row.title.slice(0, 256) : "",
            revisionSha256: row.revision_sha256 as string,
            publishedAt: (row.published_at as Date).toISOString(),
            status: "published" as const,
        })) };
    }
    async list(c: PoolClient, s: Session, id: string) { await this.studio.access(c, s, id); return { items: (await c.query("SELECT p.*,s.status FROM studio_publications p JOIN publication_states s ON s.publication_id=p.id WHERE p.tenant_id=$1 AND p.exhibition_id=$2 ORDER BY p.published_at DESC LIMIT 100", [s.tenantId, id])).rows.map(r => this.summary(r)) }; }
    /** Existing server authoring identity, never an inferred native origin or
     * a restoration of the selected public snapshot. Opening makes no edit. */
    async editingDraft(c: PoolClient, s: Session, id: string) {
        uuid(id);
        const source=(await c.query('SELECT exhibition_id FROM studio_publications WHERE tenant_id=$1 AND id=$2',[s.tenantId,id])).rows[0];
        if(!source)throw new ApiError(403,'FORBIDDEN');
        const saved=await this.studio.get(c,s,source.exhibition_id);
        const publications=(await c.query('SELECT p.*,s.status FROM studio_publications p JOIN publication_states s ON s.publication_id=p.id WHERE p.tenant_id=$1 AND p.exhibition_id=$2 ORDER BY p.draft_revision DESC,p.published_at DESC,p.id DESC LIMIT 2',[s.tenantId,source.exhibition_id])).rows;
        return {capability:'reusable-published-draft-v1' as const,sourcePublicationId:id,authoringExhibitionId:source.exhibition_id,reused:true as const,...saved,currentPublication:publications[0]?this.summary(publications[0]):null,previousPublication:publications[1]?this.summary(publications[1]):null};
    }
    private async owned(c: PoolClient, s: Session, id: string): Promise<PublicationRow> { uuid(id); const row = (await c.query("SELECT p.*,s.status FROM studio_publications p JOIN publication_states s ON s.publication_id=p.id WHERE p.tenant_id=$1 AND p.id=$2 FOR UPDATE OF s", [s.tenantId, id])).rows[0]; if (!row)
        throw new ApiError(403, "FORBIDDEN"); await this.studio.access(c, s, row.exhibition_id); return row; }
    async publish(c: PoolClient, s: Session, id: string, requestId: string, match: string,fileOperation?:PublicationFileOperation) {
        try{
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
        // Studio.access holds the authoring row FOR UPDATE in this same
        // READ COMMITTED transaction. Supported API writers therefore observe
        // a concurrent publication after waiting for the lock, before writing.
        const existing=(await c.query('SELECT p.*,s.status FROM studio_publications p JOIN publication_states s ON s.publication_id=p.id WHERE p.tenant_id=$1 AND p.exhibition_id=$2 AND p.draft_revision=$3 ORDER BY p.published_at DESC,p.id DESC LIMIT 1',[s.tenantId,id,row.revision])).rows[0];
        if(existing){
            await c.query('INSERT INTO publication_requests VALUES($1,$2,$3,$4,$5)',[s.tenantId,s.userId,requestId,payloadHash,existing.id]);
            // A lost response or a second publish click must not republish an
            // explicitly withdrawn version. Its existing status is returned.
            return this.summary(existing);
        }
        // Only stage creation may fall back to the existing bounded path.
        // Never retry publication writes after a staging/read failure.
        if(fileOperation&&!(fileOperation instanceof PublicationFileOperation))throw new ApiError(409,'PUBLICATION_STAGE_UNAVAILABLE');
        const stage=fileOperation?await fileOperation.claim(c,s,this.blobs,'publish',id,match,requestId):await PublicationByteStage.create(96*1024*1024).catch(()=>undefined);
        try{
        const load=async(bytes:PublicationBytes):Promise<Buffer>=>{if(Buffer.isBuffer(bytes))return bytes;if(!stage)throw new ApiError(409,'PUBLICATION_STAGE_UNAVAILABLE');return stage.read(bytes);};
        const byteHash=(bytes:PublicationBytes)=>{if(Buffer.isBuffer(bytes))return sha256(bytes);if(!stage)throw new ApiError(409,'PUBLICATION_STAGE_UNAVAILABLE');return stage.describe(bytes).sha256;};
        const report = await this.prepare(c, s, row.metadata.candidate, id,stage,fileOperation?.budget??67108864);
        if (report.issues.length)
            throw new ApiError(422, "PUBLICATION_NOT_READY");
        if (!this.blobs)
            throw new ApiError(503, "STORAGE_UNAVAILABLE");
        const publicationId = randomUUID(), publishedAt = new Date().toISOString(), { snapshot, assets, media,cover } = projectPublicationCore(row.metadata.candidate, report.prepared, publishedAt, report.media,report.cover,report.furnishings,byteHash);
        const valid = validateExhibition(snapshot, { publicationTime: publishedAt });
        if (!valid.valid || !validateStudioPresentation(snapshot).valid || !validateArchitecture(snapshot,true).valid || !validateSpatialProfile(snapshot).valid || !validateViewerCuration(snapshot).valid || !validateViewerExperience(snapshot).valid || snapshot.artworks.some(a=>!validateViewerLod(a).valid||!validateArtworkDetails(a).valid||!validateArtworkThumbnail(a).valid))
            throw new ApiError(422, "PUBLICATION_NOT_READY");
        const digest = revisionHash(snapshot);
        if(fileOperation)await fileOperation.manifest(publicationId,digest,[
         ...assets.map(({id:assetId,prepared:p})=>{const hash=byteHash(p.bytes);return {key:`${s.tenantId}/publications/${publicationId}/${assetId}/${hash}`,sha256:hash,bytes:p.bytes.length};}),
         ...media.map(({id:mediaId,prepared:p})=>({key:`${s.tenantId}/publications/${publicationId}/${mediaId}/${p.source.sha256}`,sha256:p.source.sha256,bytes:p.source.bytes})),
         ...(cover?[{key:`${s.tenantId}/publications/${publicationId}/${cover.id}/${cover.prepared.source.sha256}`,sha256:cover.prepared.source.sha256,bytes:cover.prepared.source.bytes}]:[])
        ]);
        await c.query("INSERT INTO studio_publications(tenant_id,id,exhibition_id,draft_revision,created_by,snapshot,revision_sha256,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [s.tenantId, publicationId, id, row.revision, s.userId, snapshot, digest, publishedAt]);
        await c.query("INSERT INTO publication_states VALUES($1,'published',now())", [publicationId]);
        for (const { id: assetId, prepared: p } of assets) {
            const hash = byteHash(p.bytes), key = `${s.tenantId}/publications/${publicationId}/${assetId}/${hash}`;
            await this.blobs.put(key, await load(p.bytes));
            await c.query("INSERT INTO publication_assets(tenant_id,publication_id,id,artwork_id,artwork_revision,source_asset_id,source_sha256,object_key,sha256,bytes,mime) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [s.tenantId, publicationId, assetId, p.artwork.id, p.artwork.revision, p.sourceAssetId, p.sourceSha256, key, hash, p.bytes.length, p.mime]);
            if(p.thumbnailReceiptId)await c.query('INSERT INTO publication_thumbnail_bindings(tenant_id,publication_id,asset_id,binding_id) VALUES($1,$2,$3,$4)',[s.tenantId,publicationId,assetId,p.thumbnailReceiptId]);
        }
        for(const {id:mediaId,prepared:p} of media){
            const key=`${s.tenantId}/publications/${publicationId}/${mediaId}/${p.source.sha256}`;
            await this.blobs.put(key,await load(p.bytes));
            await c.query("INSERT INTO publication_media(tenant_id,publication_id,id,source_audio_id,source_sha256,object_key,sha256,bytes,mime) VALUES($1,$2,$3,$4,$5,$6,$5,$7,$8)",[s.tenantId,publicationId,mediaId,p.source.id,p.source.sha256,key,p.source.bytes,p.source.mime]);
        }
        if(cover){const p=cover.prepared,key=`${s.tenantId}/publications/${publicationId}/${cover.id}/${p.source.sha256}`;await this.blobs.put(key,await load(p.bytes));await c.query('INSERT INTO publication_cover_images(tenant_id,publication_id,id,source_image_id,source_sha256,object_key,sha256,bytes,mime) VALUES($1,$2,$3,$4,$5,$6,$5,$7,$8)',[s.tenantId,publicationId,cover.id,p.source.id,p.source.sha256,key,p.source.bytes,p.source.mime]);}
        await stage?.close();
        const final=await this.gate(c,{tenant_id:s.tenantId,id:publicationId,exhibition_id:id,draft_revision:row.revision,snapshot,revision_sha256:digest,published_at:new Date(publishedAt),status:'published'});
        if(final.assets.length!==assets.length+media.length+(cover?1:0))throw new ApiError(422,'PUBLICATION_NOT_READY');
        await recheckPublicationSources(c,s,row.metadata.candidate,id,this.cms,this.blobs);
        await fileOperation?.verify(c,s,this.blobs,'publish',id,match,requestId);
        await c.query("INSERT INTO publication_requests VALUES($1,$2,$3,$4,$5)", [s.tenantId, s.userId, requestId, payloadHash, publicationId]);
        await this.event(c, s, publicationId, "published");
        return this.summary({ id: publicationId, published_at: new Date(publishedAt), revision_sha256: digest, status: "published" } as PublicationRow);
        }finally{await stage?.close();}
        }finally{await fileOperation?.close();}
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
    private async gate(c: PoolClient, row: PublicationRow): Promise<{assets:AssetRow[];furnishings:PreparedFurnishing[]}> {
        if (!(await c.query("SELECT 1 FROM tenants t JOIN exhibitions e ON e.tenant_id=t.id WHERE t.id=$1 AND e.id=$2 AND t.deleted_at IS NULL AND e.deleted_at IS NULL", [row.tenant_id, row.exhibition_id])).rowCount)
            throw new ApiError(404, "PUBLICATION_UNAVAILABLE");
        let furnishings:PreparedFurnishing[];
        try{furnishings=await admittedPublicationFurnishings(c,this.blobs,row.tenant_id,row.exhibition_id,row.snapshot);}catch{throw new ApiError(404,'PUBLICATION_UNAVAILABLE');}
        // Read catalogue bytes before capturing the governing wall clock, so
        // this I/O cannot extend artwork/audio/cover grants past expiry.
        const now = Date.now();
        if (!validateFurnishings(row.snapshot).valid || !validateExhibition(row.snapshot, { publicationTime: new Date(now).toISOString() }).valid || !validateArchitecture(row.snapshot,true).valid || !validateStudioMaterials(row.snapshot).valid || !validateStudioPresentation(row.snapshot).valid || !validateStudioLightDetails(row.snapshot).valid || !validateLightAttachments(row.snapshot).valid || !validateArchitecturalFinishes(row.snapshot).valid || !validateStudioPlaques(row.snapshot).valid || !validateStudioBenches(row.snapshot).valid || !validateStudioInstallation(row.snapshot).valid || !validateStudioFloors(row.snapshot).valid || !validateSpatialProfile(row.snapshot).valid || !validateViewerCuration(row.snapshot).valid || !validateViewingPlan(row.snapshot).valid || !validateViewerExperience(row.snapshot).valid || row.snapshot.artworks.some(a=>!validateViewerLod(a).valid||!validateArtworkDetails(a).valid||!validateArtworkThumbnail(a).valid) || revisionHash(row.snapshot) !== row.revision_sha256)
            throw new ApiError(404, "PUBLICATION_UNAVAILABLE");
        const records = (await c.query("SELECT pa.*,a.revision AS current_revision,a.approved_revision,a.approved_asset_id,a.deleted_at AS artwork_deleted,a.metadata AS current_metadata,ar.deleted_at AS artist_deleted,t.deleted_at AS tenant_deleted,e.deleted_at AS exhibition_deleted,asset.deleted_at AS asset_deleted,asset.state AS asset_state,asset.sha256 AS current_source_sha256,asset.bytes AS current_source_bytes,asset.mime AS current_source_mime,asset.artwork_id AS source_artwork_id,ap.snapshot AS source_approval,r.deleted_at AS rights_deleted,r.metadata AS current_rights,b.artwork_id AS receipt_artwork_id,b.artwork_revision AS receipt_revision,b.source_asset_id AS receipt_source_id,b.source_sha256 AS receipt_source_sha256,b.thumbnail_asset_id AS receipt_thumbnail_id,b.sha256 AS receipt_sha256,b.bytes AS receipt_bytes FROM publication_assets pa JOIN artworks a ON (a.tenant_id,a.id)=(pa.tenant_id,pa.artwork_id) JOIN artists ar ON (ar.tenant_id,ar.id)=(a.tenant_id,a.artist_id) JOIN tenants t ON t.id=pa.tenant_id JOIN exhibitions e ON (e.tenant_id,e.id)=(pa.tenant_id,$2) JOIN assets asset ON (asset.tenant_id,asset.id)=(pa.tenant_id,pa.source_asset_id) JOIN rights r ON (r.tenant_id,r.id)=(asset.tenant_id,asset.rights_id) JOIN artwork_approvals ap ON (ap.tenant_id,ap.artwork_id,ap.revision)=(pa.tenant_id,pa.artwork_id,pa.artwork_revision) LEFT JOIN publication_thumbnail_bindings pb ON (pb.tenant_id,pb.publication_id,pb.asset_id)=(pa.tenant_id,pa.publication_id,pa.id) LEFT JOIN artwork_thumbnail_bindings b ON (b.tenant_id,b.id)=(pb.tenant_id,pb.binding_id) WHERE pa.publication_id=$1", [row.id, row.exhibition_id])).rows;
        const permitted=authorizedArtworkAssets(row.snapshot,records,now);
        const media=(await c.query("SELECT pm.*,a.state,a.revoked,a.sha256 AS current_sha256,a.bytes AS current_bytes,a.rights,ap.snapshot AS approval FROM publication_media pm JOIN studio_audio a ON (a.tenant_id,a.id)=(pm.tenant_id,pm.source_audio_id) JOIN audio_approvals ap ON (ap.tenant_id,ap.audio_id)=(a.tenant_id,a.id) WHERE pm.publication_id=$1 AND a.exhibition_id=$2",[row.id,row.exhibition_id])).rows;
        if(media.length!==row.snapshot.mediaAssets.length)throw new ApiError(404,"PUBLICATION_UNAVAILABLE");
        for(const r of media){
            const inventory=row.snapshot.mediaAssets.find(a=>a.id===r.id);
            if(!inventory||r.state!=="approved"||r.revoked||r.current_sha256!==r.source_sha256||r.source_sha256!==r.sha256||Number(r.current_bytes)!==Number(r.bytes)||!allowedRights(r.rights,"display",now)||!equal(r.rights,inventory.rights)||r.approval.sha256!==r.source_sha256||r.approval.bytes!==Number(r.bytes)||!equal(r.approval.rights,r.rights)||inventory.sha256!==r.sha256||inventory.bytes!==Number(r.bytes)||inventory.mime!==r.mime)throw new ApiError(404,"PUBLICATION_UNAVAILABLE");
        }
        const still=spaceStillFor(row.snapshot),covers=(await c.query('SELECT p.*,a.state,a.revoked,a.sha256 AS current_sha256,a.bytes AS current_bytes,a.rights,ap.snapshot AS approval FROM publication_cover_images p JOIN studio_cover_images a ON (a.tenant_id,a.id)=(p.tenant_id,p.source_image_id) JOIN cover_image_approvals ap ON (ap.tenant_id,ap.image_id)=(a.tenant_id,a.id) WHERE p.publication_id=$1 AND a.exhibition_id=$2',[row.id,row.exhibition_id])).rows;
        if(covers.length!==(still?1:0))throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
        for(const r of covers)if(!still||r.id!==still.id||r.state!=='approved'||r.revoked||r.current_sha256!==r.source_sha256||r.source_sha256!==r.sha256||Number(r.current_bytes)!==Number(r.bytes)||!allowedRights(r.rights,'display',now)||!equal(r.rights,still.rights)||!equal(r.approval,{id:r.source_image_id,path:`space-still/${r.source_image_id}/image.png`,mime:'image/png',bytes:Number(r.bytes),sha256:r.source_sha256,rights:r.rights})||still.sha256!==r.sha256||still.bytes!==Number(r.bytes)||still.mime!==r.mime)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
        return {assets:[...permitted,...media,...covers],furnishings};
    }
    /** Reuse the current public gate inside the caller's policy-fenced transaction. */
    async discoveryMetadata(c: PoolClient, ids: string[]) {
        const items: Array<{publicationId:string;title:string;revisionSha256:string;publishedAt:string}> = [];
        for (const id of ids) {
            uuid(id);
            const row = (await c.query("SELECT p.*,s.status FROM studio_publications p JOIN publication_states s ON s.publication_id=p.id WHERE p.id=$1",[id])).rows[0] as PublicationRow|undefined;
            if (!row || row.status!=="published") continue;
            try { await this.gate(c,row); }
            catch(error) { if(error instanceof ApiError && error.code==="PUBLICATION_UNAVAILABLE")continue;throw error; }
            items.push({publicationId:id,title:row.snapshot.title,revisionSha256:row.revision_sha256,publishedAt:new Date(row.published_at).toISOString()});
        }
        return items;
    }
    /** Format conversion is a fresh export grant, not a consequence of display access. */
    async xrExport(id:string, assetId:string) {
        uuid(id);uuid(assetId);
        return transaction(this.pool,async c=>{
            await c.query('SELECT pg_advisory_xact_lock_shared(82003)');
            await c.query('SELECT pg_advisory_xact_lock_shared(82002)');
            const row=(await c.query("SELECT p.*,s.status FROM studio_publications p JOIN publication_states s ON s.publication_id=p.id WHERE p.id=$1",[id])).rows[0] as PublicationRow|undefined;
            if(!row||row.status!=='published')throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
            const {assets}=await this.gate(c,row);if(!assets.some(a=>a.id===assetId))throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
            const rights=(await c.query('SELECT a.metadata AS artwork,r.metadata AS asset FROM publication_assets pa JOIN artworks a ON (a.tenant_id,a.id)=(pa.tenant_id,pa.artwork_id) JOIN assets x ON (x.tenant_id,x.id)=(pa.tenant_id,pa.source_asset_id) JOIN rights r ON (r.tenant_id,r.id)=(x.tenant_id,x.rights_id) WHERE pa.publication_id=$1 AND pa.id=$2',[id,assetId])).rows[0];
            if(!rights||!allowedRights(rights.artwork?.rights,'export')||!allowedRights(rights.asset,'export'))throw new ApiError(403,'RIGHTS_DENIED');
            return {authorized:true,publicationId:id,assetId,revisionSha256:row.revision_sha256};
        });
    }
    async furnishingNotice(id:string,assetId:string){
        uuid(id);uuid(assetId);
        return transaction(this.pool,async c=>{
            await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');
            const row=(await c.query('SELECT p.*,s.status FROM studio_publications p JOIN publication_states s ON s.publication_id=p.id WHERE p.id=$1',[id])).rows[0] as PublicationRow|undefined;
            if(!row||row.status!=='published')throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
            const {furnishings}=await this.gate(c,row),selected=furnishings.find(p=>p.source.id===assetId);
            if(!selected)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
            if(!(await this.gate(c,row)).furnishings.some(p=>p.source.id===assetId))throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
            return {bytes:selected.notice,mime:'text/plain; charset=utf-8',revisionSha256:row.revision_sha256};
        });
    }
    async resource(id:string,hash:string){
        uuid(id);if(!/^[a-f0-9]{64}$/.test(hash))throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
        return transaction(this.pool,async c=>{
            await c.query('SELECT pg_advisory_xact_lock_shared(82003)');await c.query('SELECT pg_advisory_xact_lock_shared(82002)');
            const row=(await c.query('SELECT p.*,s.status FROM studio_publications p JOIN publication_states s ON s.publication_id=p.id WHERE p.id=$1',[id])).rows[0] as PublicationRow|undefined;
            if(!row||row.status!=='published'||!this.blobs)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
            await this.gate(c,row);const descriptor=footstepResourcesFor(row.snapshot).find(v=>v.sha256===hash);
            if(!descriptor)throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
            let bytes:Buffer;try{bytes=await footstepResourceBytes(c,this.blobs,row.tenant_id,row.exhibition_id,descriptor);}catch{throw new ApiError(404,'PUBLICATION_UNAVAILABLE');}
            await this.gate(c,row);return {bytes,mime:descriptor.mime,revisionSha256:row.revision_sha256};
        });
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
            let {assets,furnishings} = await this.gate(c, row);
            if (assetId) {
                const furnishing=furnishings.find(p=>p.source.id===assetId);
                if(furnishing){
                    if(!(await this.gate(c,row)).furnishings.some(p=>p.source.id===assetId))throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
                    return {bytes:furnishing.model,mime:furnishing.source.mime,revisionSha256:row.revision_sha256};
                }
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
                if(!(await this.gate(c,row)).assets.some(current=>current.id===assetId))throw new ApiError(404,'PUBLICATION_UNAVAILABLE');
                return { bytes, mime: asset.mime, revisionSha256: row.revision_sha256 };
            }
            let coverVariants:Awaited<ReturnType<typeof approvedCoverProjection>>;
            if(this.blobs){
                try{coverVariants=await approvedCoverProjection(row.snapshot,row.revision_sha256,assets,this.blobs);}catch{/* An optional cover pair never replaces the primary. */}
                // I/O can cross a rights expiry. A failed optional pair must not
                // turn a changed or revoked required source into success.
                ({assets,furnishings}=await this.gate(c,row));
                if(coverVariants&&![coverVariants.primary,...coverVariants.variants].every(v=>assets.some(a=>a.id===v.assetId&&a.sha256===v.sha256&&Number(a.bytes)===v.bytes)))coverVariants=undefined;
            }
            const resources=footstepResourcesFor(row.snapshot);
            return { publication: { id: row.id, revisionSha256: row.revision_sha256, publishedAt: new Date(row.published_at).toISOString(), status: "published" }, exhibition: row.snapshot, assets: [...assets.map(a => ({ assetId: a.id, mime: a.mime, url: `/api/v1/publications/${row.id}/assets/${a.id}` })),...furnishings.map(p=>({assetId:p.source.id,mime:p.source.mime,url:`/api/v1/publications/${row.id}/assets/${p.source.id}`}))],...(coverVariants?{coverVariants}:{}),...(furnishings.length?{furnishingNotices:furnishings.map(p=>({assetId:p.source.id,sha256:p.source.rights.notice.sha256,bytes:p.source.rights.notice.bytes,mime:'text/plain; charset=utf-8',url:`/api/v1/publications/${row.id}/furnishing-notices/${p.source.id}`}))}:{}),...(resources.length?{resources:resources.map(resource=>({sha256:resource.sha256,bytes:resource.bytes,mime:resource.mime,url:`/api/v1/publications/${row.id}/resources/${resource.sha256}`}))}:{}) };
        });
    }
}
