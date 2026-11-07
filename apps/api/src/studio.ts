import {assertWorkspaceFurnishingSnapshot} from './workspace-furnishing-snapshot.ts';
import {ordinaryFrameDelta} from './workspace-frame-delta.ts';
import {ordinaryPortalDelta,portalStateChanged} from './workspace-portal-delta.ts';
import type {WorkspaceFurnishingIntakes} from './workspace-furnishing-intakes.ts';
import {assertWorkspaceMaterialSnapshot} from './workspace-material-snapshot.ts';
import type {WorkspaceMaterialIntakes} from './workspace-material-intakes.ts';
import {validateViewingPlan} from '@exhibitos/studio-contract';
import {validateStudioFloors} from '@exhibitos/studio-contract';
import {validateArchitecturalFinishes} from '@exhibitos/studio-contract';
import {validateStudioPlaques} from '@exhibitos/studio-contract';
import {validateStudioLightDetails,validateLightAttachments} from '@exhibitos/studio-contract';
import {validateStudioBenches} from '@exhibitos/studio-contract';
import {validateArtworkDisplayPolicy} from '@exhibitos/studio-contract';
import {validateStudioInstallation,validateWorkspaceFurnishings,WORKSPACE_FURNISHING_NAMESPACE} from '@exhibitos/studio-contract';
import { validateViewerEntrance } from '@exhibitos/studio-contract';
import {validateSpatialProfile} from '@exhibitos/studio-contract';
import { validateViewerCuration, validateArchitecture, validateStudioMaterials, validateStudioPresentation, validateViewerLod, validateViewerExperience, validateArtworkDetails } from "@exhibitos/studio-contract";
import {validateArtworkThumbnail} from '@exhibitos/studio-contract';
import { createHash, randomUUID } from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {replaceArtworkReferences} from "./artwork-snapshot-replacement.ts";
import type {Artwork} from "@exhibitos/spec";
import {consumeNativeSelectedDraftGrant,hasNativeBoundedProvenance,type NativeOexWorkspaceContext,type NativeSelectedDraftGrant} from "./native-oex-provenance.ts";
import { validateLifecycle, type Lifecycle } from "@exhibitos/spec";
import type { PoolClient } from "pg";
import { ApiError, uuid, type Session } from "./auth.ts";
export type Draft = Extract<Lifecycle, { kind: "exhibition-draft" }>;
export interface StudioResponse {
  revision: number;
  etag: string;
  draft: Draft;
}
export interface StudioInput {
  draft: Draft;
  requestId: string;
}
function sorted(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(sorted).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (key) =>
            JSON.stringify(key) +
            ":" +
            sorted((value as Record<string, unknown>)[key]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
const hash = (value: unknown) =>
  createHash("sha256").update(sorted(value)).digest("hex");
function checked(input: StudioInput, bounded=false) {
  uuid(input.requestId);
  if (
    input.draft?.kind !== "exhibition-draft" ||
    !validateLifecycle(input.draft,undefined,bounded?{archiveProfile:"bounded-file-v1"}:undefined).valid ||
    !validateArchitecture(input.draft.candidate).valid ||
    !validateStudioMaterials(input.draft.candidate).valid ||
    !validateStudioPresentation(input.draft.candidate).valid ||
    !validateArchitecturalFinishes(input.draft.candidate).valid || !validateStudioPlaques(input.draft.candidate).valid || !validateStudioBenches(input.draft.candidate).valid || !validateViewingPlan(input.draft.candidate).valid ||
    !validateStudioLightDetails(input.draft.candidate).valid || !validateLightAttachments(input.draft.candidate).valid ||
    !validateStudioInstallation(input.draft.candidate).valid ||
    !validateStudioFloors(input.draft.candidate).valid ||
    !validateViewerEntrance(input.draft.candidate).valid ||
    !validateSpatialProfile(input.draft.candidate).valid || !validateViewerCuration(input.draft.candidate).valid || !validateViewerExperience(input.draft.candidate).valid ||
    input.draft.candidate.artworks.some(a=>!validateViewerLod(a).valid||!validateArtworkDetails(a).valid||!validateArtworkDisplayPolicy(a).valid||!validateArtworkThumbnail(a).valid)
  )
    throw new ApiError(422, "DRAFT_INVALID");
}
/** Only one existing placement transform can change in the bounded slice. */
function boundedPlacementOnly(before:Draft,after:Draft):boolean {
 const a=structuredClone(before),b=structuredClone(after),left=a.candidate.placements,right=b.candidate.placements;
 if(left.length!==right.length)return false;
 let changed=0;
 for(let i=0;i<left.length;i++){
  const old=left[i]!,next=right[i]!;if(old.id!==next.id)return false;
  if(!isDeepStrictEqual(old.transform,next.transform)){if(++changed>1)return false;old.transform=structuredClone(next.transform);}
 }
 a.editVersion=b.editVersion;a.updatedAt=b.updatedAt;
 return isDeepStrictEqual(a,b);
}
export function etag(revision: number, draft: Draft) {
  return `"studio-r${revision}-${hash(draft)}"`;
}
export function requiredMatch(value: unknown): string {
  if (value === undefined) throw new ApiError(428, "IF_MATCH_REQUIRED");
  if (
    typeof value !== "string" ||
    !/^"studio-r[1-9][0-9]*-[a-f0-9]{64}"$/.test(value)
  )
    throw new ApiError(400, "IF_MATCH_INVALID");
  return value;
}
export class Studio {
  private readonly nativeOexWorkspace:NativeOexWorkspaceContext|undefined;
  private readonly nativeBoundedEditing:boolean;
  private readonly workspaceMaterial:WorkspaceMaterialIntakes|undefined;
  private readonly workspaceFurnishing:WorkspaceFurnishingIntakes|undefined;
  constructor(nativeOexWorkspace?:NativeOexWorkspaceContext,nativeBoundedEditing=false,workspaceMaterial?:WorkspaceMaterialIntakes,workspaceFurnishing?:WorkspaceFurnishingIntakes) {this.nativeOexWorkspace=nativeOexWorkspace;this.nativeBoundedEditing=nativeBoundedEditing;this.workspaceMaterial=workspaceMaterial;this.workspaceFurnishing=workspaceFurnishing;}
  private boundedCapability(s:Session,row:{id:string;revision:number;metadata:Draft}) {
    if(!this.nativeOexWorkspace||!this.nativeBoundedEditing)throw new ApiError(403,'FORBIDDEN');
    return {version:1 as const,kind:'native-bounded-edit-v1' as const,tenantId:s.tenantId,principalId:s.userId,workspaceId:this.nativeOexWorkspace.workspaceId,exhibitionId:row.id,revision:row.revision,etag:etag(row.revision,row.metadata)};
  }
  private role(s: Session) {
    if (!["admin", "curator", "artist"].includes(s.role))
      throw new ApiError(403, "FORBIDDEN");
  }
  /** Same role/tenant/owner policy as access; only small authoring summaries. */
  async list(c: PoolClient, s: Session, q: { limit?: string; cursor?: string; q?: string }) {
    this.role(s);
    const limit = Number(q.limit ?? 20);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || (q.q?.length ?? 0) > 100)
      throw new ApiError(400, "INVALID_INPUT");
    if (q.cursor) uuid(q.cursor);
    const result = await c.query(
      `SELECT id,revision,metadata->'candidate'->>'title' AS title FROM exhibitions
       WHERE tenant_id=$1 AND studio_managed AND deleted_at IS NULL
       AND ($2::boolean OR studio_owner_user_id=$3) AND ($4::uuid IS NULL OR id>$4)
       AND ($5='' OR strpos(lower(metadata->'candidate'->>'title'),lower($5))>0)
       ORDER BY id LIMIT $6`,
      [s.tenantId, s.role === "admin", s.userId, q.cursor ?? null, q.q ?? "", limit + 1],
    );
    const more = result.rows.length > limit, rows = result.rows.slice(0, limit);
    return { items: rows.map(r => ({ id: r.id as string, revision: r.revision as number, title: typeof r.title === "string" ? r.title : "Untitled" })), nextCursor: more ? rows.at(-1)?.id as string : null };
  }
  async access(c: PoolClient, s: Session, id: string) {
    this.role(s);
    uuid(id);
    const result = await c.query(
      "SELECT id,revision,metadata,studio_owner_user_id FROM exhibitions WHERE tenant_id=$1 AND id=$2 AND studio_managed AND deleted_at IS NULL FOR UPDATE",
      [s.tenantId, id],
    );
    const row = result.rows[0];
    if (!row || (s.role !== "admin" && row.studio_owner_user_id !== s.userId))
      throw new ApiError(403, "FORBIDDEN");
    const nativeBounded=await hasNativeBoundedProvenance(c,s,id,this.nativeOexWorkspace);
    if (
      row.metadata?.kind !== "exhibition-draft" ||
      !validateLifecycle(row.metadata,undefined,nativeBounded?{archiveProfile:"bounded-file-v1"}:undefined).valid ||
      !validateArchitecture(row.metadata.candidate).valid ||
      !validateStudioMaterials(row.metadata.candidate).valid ||
      !validateStudioFloors(row.metadata.candidate).valid ||
      !validateStudioPresentation(row.metadata.candidate).valid ||
      !validateArchitecturalFinishes(row.metadata.candidate).valid || !validateStudioPlaques(row.metadata.candidate).valid || !validateStudioBenches(row.metadata.candidate).valid || !validateViewingPlan(row.metadata.candidate).valid ||
      !validateStudioLightDetails(row.metadata.candidate).valid || !validateLightAttachments(row.metadata.candidate).valid ||
      !validateViewerEntrance(row.metadata.candidate).valid ||
      !validateSpatialProfile(row.metadata.candidate).valid || !validateViewerCuration(row.metadata.candidate).valid || !validateViewerExperience(row.metadata.candidate).valid ||
      row.metadata.candidate.artworks.some((a:unknown)=>!validateViewerLod(a).valid||!validateArtworkDetails(a).valid||!validateArtworkDisplayPolicy(a).valid||!validateArtworkThumbnail(a).valid)
    )
      throw new ApiError(409, "DRAFT_CORRUPT");
    return nativeBounded?{...row,nativeBounded:true}:row;
  }
  async get(c: PoolClient, s: Session, id: string): Promise<StudioResponse> {
    const row = await this.access(c, s, id);
    return {
      revision: row.revision,
      etag: etag(row.revision, row.metadata),
      draft: row.metadata,
    };
  }
  /** The persisted, owner-bound provenance controls profile selection. */
  async validateNativeViewport(c:PoolClient,s:Session,id:string,input:StudioInput,match?:string) {
    const row=await this.access(c,s,id);
    const frameDelta=!!input?.draft?.candidate&&ordinaryFrameDelta(row.metadata,input.draft,WORKSPACE_FURNISHING_NAMESPACE);
    const ext=input?.draft?.candidate?.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as unknown as {frameAttachments?:{furnishingId:string;furnishingVersion:1}[]}|undefined;
    const frameNoop=isDeepStrictEqual(row.metadata,input?.draft)&&Array.isArray(ext?.frameAttachments)&&ext.frameAttachments.length>0;
    const portalDelta=!!input?.draft?.candidate&&ordinaryPortalDelta(row.metadata,input.draft,WORKSPACE_FURNISHING_NAMESPACE),portalExt=ext as typeof ext&{openingAttachments?:unknown[]},portalNoop=isDeepStrictEqual(row.metadata,input?.draft)&&Array.isArray(portalExt?.openingAttachments)&&portalExt.openingAttachments.length>0;
    if(frameDelta||frameNoop||portalDelta||portalNoop){
      if((frameDelta||frameNoop)&&!this.workspaceFurnishing?.supportsArtworkFrame()||(portalDelta||portalNoop)&&!this.workspaceFurnishing?.supportsPortalFinish())throw new ApiError(403,'FORBIDDEN');
      await this.workspaceFurnishing!.authorize(c,s);
      if(match===undefined)throw new ApiError(428,'IF_MATCH_REQUIRED');
      if(etag(row.revision,row.metadata)!==match)throw new ApiError(412,'REMOTE_CONFLICT');
      const fit=validateWorkspaceFurnishings(input.draft.candidate);if(!fit.valid)throw new ApiError(422,fit.errors[0]?.code??'DRAFT_INVALID');
      if(!row.nativeBounded){checked(input);await assertWorkspaceFurnishingSnapshot(c,s,input.draft.candidate,this.workspaceFurnishing);return {valid:true as const};}
    }
    if(!row.nativeBounded)throw new ApiError(403,'FORBIDDEN');
    if(typeof input.draft?.exhibitionId!=='string'||typeof input.draft?.id!=='string'||input.draft.exhibitionId.toLowerCase()!==id.toLowerCase()||input.draft.id.toLowerCase()!==row.metadata.id.toLowerCase())throw new ApiError(422,'DRAFT_ID_MISMATCH');
    checked(input,true);
    await assertWorkspaceMaterialSnapshot(c,s,input.draft.candidate,this.workspaceMaterial);
    await assertWorkspaceFurnishingSnapshot(c,s,input.draft.candidate,this.workspaceFurnishing);
    if(match!==undefined){if(etag(row.revision,row.metadata)!==match)throw new ApiError(412,'REMOTE_CONFLICT');if(this.nativeBoundedEditing&&!validateLifecycle(row.metadata).valid){if(!boundedPlacementOnly(row.metadata,input.draft)&&!(this.workspaceFurnishing?.supportsPortalFinish()&&portalDelta))throw new ApiError(422,'BOUNDED_EDIT_UNSUPPORTED');return {valid:true as const,editingCapability:this.boundedCapability(s,row)};}}
    return {valid:true as const};
  }
  async nativeViewportPolicy(c:PoolClient,s:Session,id:string) {
    if(!this.nativeOexWorkspace)throw new ApiError(404,'NOT_FOUND');
    const row=await this.access(c,s,id),ordinary=validateLifecycle(row.metadata);
    if(!ordinary.valid&&(!row.nativeBounded||!ordinary.errors.length||!ordinary.errors.every(error=>error.code==='ASSET_TOTAL_LIMIT'&&error.path==='/candidate/artworks')))throw new ApiError(409,'DRAFT_CORRUPT');
    const boundedProfile=!!row.nativeBounded,boundedEditRequired=boundedProfile&&!ordinary.valid,editable=boundedEditRequired&&this.nativeBoundedEditing;
    return {exhibitionId:row.id,revision:row.revision,etag:etag(row.revision,row.metadata),boundedReadOnly:boundedEditRequired&&!editable,boundedProfile,boundedEditRequired,...(editable?{editingCapability:this.boundedCapability(s,row)}:{})};
  }
  private async receipt(
    c: PoolClient,
    s: Session,
    input: StudioInput,
    payloadHash: string,
  ): Promise<StudioResponse | null> {
    const r = await c.query(
      "SELECT * FROM studio_requests WHERE tenant_id=$1 AND user_id=$2 AND request_id=$3",
      [s.tenantId, s.userId, input.requestId],
    );
    if (!r.rowCount) return null;
    await this.access(c, s, r.rows[0].exhibition_id);
    if (r.rows[0].payload_sha256 !== payloadHash)
      throw new ApiError(409, "REQUEST_CONFLICT");
    return r.rows[0].response;
  }
  private async record(
    c: PoolClient,
    s: Session,
    input: StudioInput,
    payloadHash: string,
    response: StudioResponse,
  ) {
    await c.query(
      "INSERT INTO studio_requests(tenant_id,user_id,request_id,payload_sha256,exhibition_id,response) VALUES($1,$2,$3,$4,$5,$6)",
      [
        s.tenantId,
        s.userId,
        input.requestId,
        payloadHash,
        input.draft.exhibitionId,
        response,
      ],
    );
    await c.query(
      "INSERT INTO audit_events(tenant_id,id,metadata) VALUES($1,$2,$3)",
      [
        s.tenantId,
        randomUUID(),
        {
          action: "studio.saved",
          actor: s.userId,
          target: input.draft.exhibitionId,
          revision: response.revision,
        },
      ],
    );
  }
  async create(
    c: PoolClient,
    s: Session,
    input: StudioInput,
    selectedGrant?:NativeSelectedDraftGrant,
  ): Promise<StudioResponse> {
    this.role(s);
    if(selectedGrant)await consumeNativeSelectedDraftGrant(selectedGrant,c,s,input.draft);
    checked(input,!!selectedGrant);
    const payloadHash = hash({ method: "POST", input });
    const replay = await this.receipt(c, s, input, payloadHash);
    if (replay) return replay;
    await assertWorkspaceMaterialSnapshot(c,s,input.draft.candidate,this.workspaceMaterial);
    await assertWorkspaceFurnishingSnapshot(c,s,input.draft.candidate,this.workspaceFurnishing);
    const id = input.draft.exhibitionId;
    const existing = await c.query(
      "SELECT 1 FROM exhibitions WHERE tenant_id=$1 AND id=$2",
      [s.tenantId, id],
    );
    if (existing.rowCount) throw new ApiError(409, "EXHIBITION_EXISTS");
    await c.query(
      "INSERT INTO exhibitions(tenant_id,id,metadata,studio_managed,studio_owner_user_id) VALUES($1,$2,$3,true,$4)",
      [s.tenantId, id, input.draft, s.userId],
    );
    await c.query(
      "INSERT INTO exhibition_revisions(tenant_id,exhibition_id,revision,snapshot) VALUES($1,$2,1,$3)",
      [s.tenantId, id, input.draft],
    );
    const response = {
      revision: 1,
      etag: etag(1, input.draft),
      draft: input.draft,
    };
    await this.record(c, s, input, payloadHash, response);
    return response;
  }
  async put(c:PoolClient,s:Session,id:string,input:StudioInput,match:string):Promise<StudioResponse>{
    return this.putInternal(c,s,id,input,match);
  }
  /** Server-only narrow operation; authorization and verified approval remain caller obligations. */
  async putArtworkReplacement(c:PoolClient,s:Session,id:string,prior:Artwork,next:Artwork,requestId:string,match:string):Promise<StudioResponse>{
    if(!this.nativeOexWorkspace||this.nativeOexWorkspace.tenantId!==s.tenantId||this.nativeOexWorkspace.principalId!==s.userId)throw new ApiError(403,'FORBIDDEN');
    await this.nativeOexWorkspace.assertDatabase(c);
    const row=await this.access(c,s,id);if(row.studio_owner_user_id!==s.userId)throw new ApiError(403,'FORBIDDEN');
    const draft=structuredClone(row.metadata) as Draft;
    draft.candidate=replaceArtworkReferences(draft.candidate,prior,next) as Draft['candidate'];
    return this.putInternal(c,s,id,{draft,requestId},match,{prior,next});
  }
  private async putInternal(
    c: PoolClient,
    s: Session,
    id: string,
    input: StudioInput,
    match: string,
    replacement?:{prior:Artwork;next:Artwork},
  ): Promise<StudioResponse> {
    if(!this.nativeOexWorkspace)checked(input);
    const row = await this.access(c, s, id);
    if(this.nativeOexWorkspace)checked(input,!!row.nativeBounded);
    // Producer-only slice permits the selected identical confirmation save,
    // not edits exceeding ordinary validation before scoped edit is integrated.
    if(row.nativeBounded&&(!validateLifecycle(row.metadata).valid||!validateLifecycle(input.draft).valid)&&!(this.nativeBoundedEditing?(boundedPlacementOnly(row.metadata,input.draft)||!!this.workspaceFurnishing?.supportsPortalFinish()&&ordinaryPortalDelta(row.metadata,input.draft,WORKSPACE_FURNISHING_NAMESPACE)||!!replacement&&isDeepStrictEqual({...row.metadata,candidate:replaceArtworkReferences(row.metadata.candidate,replacement.prior,replacement.next)},input.draft)):isDeepStrictEqual(row.metadata,input.draft)))throw new ApiError(422,"BOUNDED_EDIT_UNSUPPORTED");
    if (
      input.draft.exhibitionId.toLowerCase() !== id.toLowerCase() ||
      input.draft.id.toLowerCase() !== row.metadata.id.toLowerCase()
    )
      throw new ApiError(422, "DRAFT_ID_MISMATCH");
    if(portalStateChanged(row.metadata,input.draft,WORKSPACE_FURNISHING_NAMESPACE)){
      if(!this.workspaceFurnishing?.supportsPortalFinish())throw new ApiError(403,'FORBIDDEN');
      await this.workspaceFurnishing.authorize(c,s);
    }
    const payloadHash = hash({ method: "PUT", id, match, input });
    const replay = await this.receipt(c, s, input, payloadHash);
    if (replay) return replay;
    if (match !== etag(row.revision, row.metadata))
      throw new ApiError(412, "REMOTE_CONFLICT");
    await assertWorkspaceMaterialSnapshot(c,s,input.draft.candidate,this.workspaceMaterial);
    await assertWorkspaceFurnishingSnapshot(c,s,input.draft.candidate,this.workspaceFurnishing);
    // This row is the private active draft. Published snapshots and their
    // immutable asset bindings are separate and are never changed by a save.
    if (row.revision >= 2147483647) throw new ApiError(409, "REVISION_LIMIT");
    const revision = row.revision + 1;
    await c.query(
      "UPDATE exhibitions SET metadata=$3,revision=$4,updated_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2",
      [s.tenantId, id, input.draft, revision],
    );
    await c.query(
      "INSERT INTO exhibition_revisions(tenant_id,exhibition_id,revision,snapshot) VALUES($1,$2,$3,$4)",
      [s.tenantId, id, revision, input.draft],
    );
    const response = {
      revision,
      etag: etag(revision, input.draft),
      draft: input.draft,
    };
    await this.record(c, s, input, payloadHash, response);
    return response;
  }
}
