import { validateStudioMaterials, validateStudioPresentation, validateViewerLod, validateViewerExperience } from "@exhibitos/studio-contract";
import { createHash, randomUUID } from "node:crypto";
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
function checked(input: StudioInput) {
  uuid(input.requestId);
  if (
    input.draft?.kind !== "exhibition-draft" ||
    !validateLifecycle(input.draft).valid ||
    !validateStudioMaterials(input.draft.candidate).valid ||
    !validateStudioPresentation(input.draft.candidate).valid ||
    !validateViewerExperience(input.draft.candidate).valid ||
    input.draft.candidate.artworks.some(a=>!validateViewerLod(a).valid)
  )
    throw new ApiError(422, "DRAFT_INVALID");
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
  private role(s: Session) {
    if (!["admin", "curator", "artist"].includes(s.role))
      throw new ApiError(403, "FORBIDDEN");
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
    if (
      row.metadata?.kind !== "exhibition-draft" ||
      !validateLifecycle(row.metadata).valid ||
      !validateStudioMaterials(row.metadata.candidate).valid ||
      !validateStudioPresentation(row.metadata.candidate).valid ||
      !validateViewerExperience(row.metadata.candidate).valid ||
      row.metadata.candidate.artworks.some((a:unknown)=>!validateViewerLod(a).valid)
    )
      throw new ApiError(409, "DRAFT_CORRUPT");
    return row;
  }
  async get(c: PoolClient, s: Session, id: string): Promise<StudioResponse> {
    const row = await this.access(c, s, id);
    return {
      revision: row.revision,
      etag: etag(row.revision, row.metadata),
      draft: row.metadata,
    };
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
  ): Promise<StudioResponse> {
    this.role(s);
    checked(input);
    const payloadHash = hash({ method: "POST", input });
    const replay = await this.receipt(c, s, input, payloadHash);
    if (replay) return replay;
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
  async put(
    c: PoolClient,
    s: Session,
    id: string,
    input: StudioInput,
    match: string,
  ): Promise<StudioResponse> {
    checked(input);
    const row = await this.access(c, s, id);
    if (
      input.draft.exhibitionId.toLowerCase() !== id.toLowerCase() ||
      input.draft.id.toLowerCase() !== row.metadata.id.toLowerCase()
    )
      throw new ApiError(422, "DRAFT_ID_MISMATCH");
    const payloadHash = hash({ method: "PUT", id, match, input });
    const replay = await this.receipt(c, s, input, payloadHash);
    if (replay) return replay;
    if (match !== etag(row.revision, row.metadata))
      throw new ApiError(412, "REMOTE_CONFLICT");
    if ((await c.query("SELECT 1 FROM studio_publications WHERE tenant_id=$1 AND exhibition_id=$2", [s.tenantId, id])).rowCount)
      throw new ApiError(409, "PUBLISHED_DRAFT_IMMUTABLE");
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
