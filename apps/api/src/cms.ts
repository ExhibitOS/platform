import { randomUUID, createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { artworkAccess, type BlobStore, sha256 } from "@exhibitos/storage";
import { ApiError, type Session, uuid } from "./auth.ts";
import { validRights, allowedRights } from "./rights.ts";
import { derivative } from "./derivative.ts";
export interface ArtworkMetadata {
  title: string;
  description: string;
  dimensions: { width: number; height: number; depth: number; unit: "m" };
  rights: unknown;
  provenance: {
    source: "human-authored" | "ai-assisted" | "ai-generated";
    sourceUnits: "m" | "cm" | "mm";
    scaleApplied: boolean;
    notes: string;
  };
}
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, canonical(x)]),
        )
      : v;
const json = (v: unknown) => JSON.stringify(canonical(v));
const exact = (v: unknown, keys: string[]) =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => k in v);
function text(v: unknown, max: number, min = 0) {
  return typeof v === "string" && v.length >= min && v.length <= max;
}
export function validMetadata(v: unknown): v is ArtworkMetadata {
  if (!exact(v, ["title", "description", "dimensions", "rights", "provenance"]))
    return false;
  const m = v as ArtworkMetadata,
    d = m.dimensions,
    p = m.provenance;
  return (
    text(m.title, 512, 1) &&
    text(m.description, 16384) &&
    exact(d, ["width", "height", "depth", "unit"]) &&
    d.unit === "m" &&
    [d.width, d.height, d.depth].every(
      (x) => Number.isFinite(x) && x > 0 && x <= 1000000,
    ) &&
    validRights(m.rights) &&
    exact(p, ["source", "sourceUnits", "scaleApplied", "notes"]) &&
    ["human-authored", "ai-assisted", "ai-generated"].includes(p.source) &&
    ["m", "cm", "mm"].includes(p.sourceUnits) &&
    typeof p.scaleApplied === "boolean" &&
    text(p.notes, 4096)
  );
}
export class Cms {
  readonly blobs: BlobStore | undefined;
  constructor(blobs?: BlobStore) {
    this.blobs = blobs;
  }
  async artist(c: PoolClient, s: Session, id: string, archived = false) {
    uuid(id);
    const r = await c.query(
      "SELECT * FROM artists WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [s.tenantId, id],
    );
    const a = r.rows[0];
    if (
      !a ||
      (!archived && a.deleted_at) ||
      (s.role !== "admin" && (s.role !== "artist" || a.user_id !== s.userId))
    )
      throw new ApiError(403, "FORBIDDEN");
    return a;
  }
  artistView(a: Record<string, unknown>) {
    const m = a.metadata as { name?: unknown; bio?: unknown };
    return {
      id: a.id,
      userId: a.user_id,
      revision: a.revision,
      name: typeof m?.name === "string" ? m.name : "Unnamed artist",
      bio: typeof m?.bio === "string" ? m.bio : "",
      archived: !!a.deleted_at,
    };
  }
  async createArtist(
    c: PoolClient,
    s: Session,
    b: { name: string; bio: string; userId?: string | null },
  ) {
    if (!["admin", "artist"].includes(s.role))
      throw new ApiError(403, "FORBIDDEN");
    const owner = b.userId === undefined ? s.userId : b.userId;
    if (s.role !== "admin" && owner !== s.userId)
      throw new ApiError(403, "FORBIDDEN");
    if (owner !== null) {
      uuid(owner);
      if (
        !(
          await c.query(
            "SELECT 1 FROM memberships WHERE tenant_id=$1 AND user_id=$2",
            [s.tenantId, owner],
          )
        ).rowCount
      )
        throw new ApiError(403, "FORBIDDEN");
    }
    const id = randomUUID(),
      m = { name: b.name, bio: b.bio };
    await c.query(
      "INSERT INTO artists(tenant_id,id,user_id,metadata) VALUES($1,$2,$3,$4)",
      [s.tenantId, id, owner, m],
    );
    await c.query(
      "INSERT INTO artist_revisions(tenant_id,artist_id,revision,snapshot) VALUES($1,$2,1,$3)",
      [s.tenantId, id, { ...m, userId: owner }],
    );
    return this.artistView(await this.artist(c, s, id));
  }
  async reviseArtist(
    c: PoolClient,
    s: Session,
    id: string,
    b: { revision: number; name: string; bio: string },
  ) {
    await this.artist(c, s, id);
    const r = await c.query(
      "UPDATE artists SET metadata=$4,revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND revision=$3 RETURNING *",
      [s.tenantId, id, b.revision, { name: b.name, bio: b.bio }],
    );
    if (!r.rowCount) throw new ApiError(409, "REVISION_CONFLICT");
    const a = r.rows[0];
    await c.query(
      "INSERT INTO artist_revisions(tenant_id,artist_id,revision,snapshot) VALUES($1,$2,$3,$4)",
      [
        s.tenantId,
        id,
        a.revision,
        { name: b.name, bio: b.bio, userId: a.user_id },
      ],
    );
    return this.artistView(a);
  }
  async ownArtwork(c: PoolClient, s: Session, id: string, archived = false) {
    uuid(id);
    const r = await c.query(
      "SELECT * FROM artworks WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [s.tenantId, id],
    );
    const a = r.rows[0];
    if (!a || (!archived && a.deleted_at)) throw new ApiError(403, "FORBIDDEN");
    await this.artist(c, s, a.artist_id, archived);
    return a;
  }
  async createArtwork(
    c: PoolClient,
    s: Session,
    b: ArtworkMetadata & { artistId: string },
  ) {
    await this.artist(c, s, b.artistId);
    const { artistId, ...metadata } = b;
    if (!validMetadata(metadata)) throw new ApiError(400, "INVALID_METADATA");
    const id = randomUUID();
    await c.query(
      "INSERT INTO artworks(tenant_id,id,artist_id,metadata,cms_managed) VALUES($1,$2,$3,$4,true)",
      [s.tenantId, id, artistId, metadata],
    );
    await c.query(
      "INSERT INTO artwork_revisions(tenant_id,artwork_id,revision,snapshot) VALUES($1,$2,1,$3)",
      [s.tenantId, id, metadata],
    );
    return this.detail(c, s, id);
  }
  async detail(c: PoolClient, s: Session, id: string, archived = false) {
    const a = await this.ownArtwork(c, s, id, archived);
    const assets = await c.query(
      "SELECT id,mime,state,sha256,bytes FROM assets WHERE tenant_id=$1 AND artwork_id=$2 AND deleted_at IS NULL ORDER BY id LIMIT 100",
      [s.tenantId, id],
    );
    return {
      id: a.id,
      artistId: a.artist_id,
      revision: a.revision,
      approvedRevision:
        a.approved_revision === a.revision ? a.approved_revision : null,
      approvedAssetId: a.approved_asset_id,
      metadata: validMetadata(a.metadata) ? a.metadata : null,
      archived: !!a.deleted_at,
      assets: assets.rows.map((x) => ({ ...x, bytes: Number(x.bytes) })),
    };
  }
  async revise(
    c: PoolClient,
    s: Session,
    id: string,
    b: ArtworkMetadata & { revision: number },
  ) {
    await this.ownArtwork(c, s, id);
    const { revision, ...metadata } = b;
    if (!validMetadata(metadata)) throw new ApiError(400, "INVALID_METADATA");
    const r = await c.query(
      "UPDATE artworks SET metadata=$4,cms_managed=true,revision=revision+1,approved_revision=NULL,approved_asset_id=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND revision=$3 RETURNING revision",
      [s.tenantId, id, revision, metadata],
    );
    if (!r.rowCount) throw new ApiError(409, "REVISION_CONFLICT");
    await c.query(
      "INSERT INTO artwork_revisions(tenant_id,artwork_id,revision,snapshot) VALUES($1,$2,$3,$4)",
      [s.tenantId, id, r.rows[0].revision, metadata],
    );
    await c.query(
      "UPDATE rights SET metadata=$3,revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id IN(SELECT rights_id FROM assets WHERE tenant_id=$1 AND artwork_id=$2)",
      [s.tenantId, id, metadata.rights],
    );
    return this.detail(c, s, id);
  }
  async archive(
    c: PoolClient,
    s: Session,
    kind: "artists" | "artworks",
    id: string,
    restore: boolean,
    revision: number,
  ) {
    const a =
      kind === "artists"
        ? await this.artist(c, s, id, true)
        : await this.ownArtwork(c, s, id, true);
    if (a.revision !== revision) throw new ApiError(409, "REVISION_CONFLICT");
    if (
      kind === "artists" &&
      !restore &&
      (
        await c.query(
          "SELECT 1 FROM artworks WHERE tenant_id=$1 AND artist_id=$2 AND deleted_at IS NULL LIMIT 1",
          [s.tenantId, id],
        )
      ).rowCount
    )
      throw new ApiError(409, "ARTIST_HAS_ARTWORKS");
    const r = await c.query(
      `UPDATE ${kind} SET deleted_at=${restore ? "NULL" : "now()"},revision=revision+1,updated_at=now()${kind === "artworks" ? ",approved_revision=NULL,approved_asset_id=NULL" : ""} WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [s.tenantId, id],
    );
    const row = r.rows[0];
    const entity = kind === "artists" ? "artist" : "artwork";
    const snapshot =
      kind === "artists"
        ? { ...row.metadata, userId: row.user_id, archived: !restore }
        : { ...row.metadata, archived: !restore };
    await c.query(
      `INSERT INTO ${entity}_revisions(tenant_id,${entity}_id,revision,snapshot) VALUES($1,$2,$3,$4)`,
      [s.tenantId, id, row.revision, snapshot],
    );
    return kind === "artists"
      ? this.artistView(row)
      : this.detail(c, s, id, true);
  }
  async list(
    c: PoolClient,
    s: Session,
    kind: "artists" | "artworks",
    q: { limit?: string; cursor?: string; q?: string; archived?: string },
  ) {
    if (!["admin", "artist"].includes(s.role))
      throw new ApiError(403, "FORBIDDEN");
    const limit = q.limit === undefined ? 20 : Number(q.limit);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      (q.q && q.q.length > 100) ||
      (q.archived && !["true", "false"].includes(q.archived))
    )
      throw new ApiError(400, "INVALID_INPUT");
    if (q.cursor) uuid(q.cursor);
    const art = kind === "artworks";
    const r = await c.query(
      `SELECT e.* FROM ${kind} e ${art ? "JOIN artists a ON (a.tenant_id,a.id)=(e.tenant_id,e.artist_id)" : ""} WHERE e.tenant_id=$1 AND ($2::uuid IS NULL OR e.id>$2) AND ($3::boolean OR ${art ? "a" : "e"}.user_id=$4) AND (e.deleted_at IS NOT NULL)=$5 AND ($6='' OR strpos(lower(e.metadata->>'${art ? "title" : "name"}'),lower($6))>0) ${art ? "AND a.deleted_at IS NULL" : ""} ORDER BY e.id LIMIT $7`,
      [
        s.tenantId,
        q.cursor ?? null,
        s.role === "admin",
        s.userId,
        q.archived === "true",
        q.q ?? "",
        limit + 1,
      ],
    );
    const more = r.rows.length > limit,
      rows = r.rows.slice(0, limit);
    return {
      items: art
        ? rows.map((a) => ({
            id: a.id,
            artistId: a.artist_id,
            revision: a.revision,
            title:
              typeof a.metadata.title === "string"
                ? a.metadata.title
                : "Untitled",
            archived: !!a.deleted_at,
            approvedRevision:
              a.approved_revision === a.revision ? a.approved_revision : null,
          }))
        : rows.map((a) => this.artistView(a)),
      nextCursor: more ? rows.at(-1)?.id : null,
    };
  }
  async revisions(
    c: PoolClient,
    s: Session,
    id: string,
    kind: "artists" | "artworks" = "artworks",
  ) {
    if (kind === "artists") await this.artist(c, s, id, true);
    else await this.ownArtwork(c, s, id, true);
    const entity = kind === "artists" ? "artist" : "artwork";
    return {
      items: (
        await c.query(
          `SELECT revision,snapshot,created_at AS "createdAt" FROM ${entity}_revisions WHERE tenant_id=$1 AND ${entity}_id=$2 ORDER BY revision DESC LIMIT 100`,
          [s.tenantId, id],
        )
      ).rows,
    };
  }
  async approve(
    c: PoolClient,
    s: Session,
    id: string,
    b: { revision: number; assetId: string },
  ) {
    const a = await this.ownArtwork(c, s, id);
    if (a.revision !== b.revision) throw new ApiError(409, "REVISION_CONFLICT");
    if (!validMetadata(a.metadata)) throw new ApiError(400, "INVALID_METADATA");
    uuid(b.assetId);
    const result = await c.query(
      "SELECT a.*,r.metadata AS rights,r.revision AS rights_revision FROM assets a JOIN rights r ON (r.tenant_id,r.id)=(a.tenant_id,a.rights_id) WHERE a.tenant_id=$1 AND a.artwork_id=$2 AND a.id=$3 AND a.state='approved' AND a.deleted_at IS NULL AND r.deleted_at IS NULL",
      [s.tenantId, id, b.assetId],
    );
    const asset = result.rows[0];
    if (!asset) throw new ApiError(409, "ASSET_NOT_APPROVED");
    if (!allowedRights(a.metadata.rights, "display"))
      throw new ApiError(403, "RIGHTS_DENIED");
    if (json(a.metadata.rights) !== json(asset.rights)) {
      await c.query(
        "UPDATE rights SET metadata=$3,revision=revision+1 WHERE tenant_id=$1 AND id=$2",
        [s.tenantId, asset.rights_id, a.metadata.rights],
      );
      asset.rights_revision++;
    }
    if (!this.blobs) throw new ApiError(503, "STORAGE_UNAVAILABLE");
    const bytes = Buffer.from(await this.blobs.get(asset.object_key));
    if (bytes.length !== Number(asset.bytes) || sha256(bytes) !== asset.sha256)
      throw new ApiError(409, "ASSET_INTEGRITY");
    await derivative(bytes, asset.mime);
    const snapshot = {
      metadata: a.metadata,
      asset: {
        id: asset.id,
        sha256: asset.sha256,
        bytes: Number(asset.bytes),
        mime: asset.mime,
        rightsRevision: asset.rights_revision,
      },
    };
    const prior = await c.query(
      "SELECT snapshot FROM artwork_approvals WHERE tenant_id=$1 AND artwork_id=$2 AND revision=$3",
      [s.tenantId, id, b.revision],
    );
    if (prior.rowCount && json(prior.rows[0].snapshot) !== json(snapshot))
      throw new ApiError(409, "APPROVAL_CONFLICT");
    if (!prior.rowCount)
      await c.query(
        "INSERT INTO artwork_approvals VALUES($1,$2,$3,$4,$5,now())",
        [s.tenantId, id, b.revision, b.assetId, snapshot],
      );
    await c.query(
      "UPDATE artworks SET approved_revision=$3,approved_asset_id=$4 WHERE tenant_id=$1 AND id=$2",
      [s.tenantId, id, b.revision, b.assetId],
    );
    return this.detail(c, s, id);
  }
  async display(c: PoolClient, s: Session, id: string, preview = false) {
    let a;
    if (s.role === "viewer") {
      const assigned = await c.query(
        "SELECT a.* FROM artworks a JOIN artists ar ON (ar.tenant_id,ar.id)=(a.tenant_id,a.artist_id) JOIN placements p ON (p.tenant_id,p.artwork_id)=(a.tenant_id,a.id) JOIN rooms r ON (r.tenant_id,r.id)=(p.tenant_id,p.room_id) JOIN exhibitions e ON (e.tenant_id,e.id)=(r.tenant_id,r.exhibition_id) JOIN exhibition_assignments ea ON (ea.tenant_id,ea.exhibition_id)=(e.tenant_id,e.id) WHERE a.tenant_id=$1 AND a.id=$2 AND ea.user_id=$3 AND ea.can_view AND a.deleted_at IS NULL AND ar.deleted_at IS NULL AND p.deleted_at IS NULL AND r.deleted_at IS NULL AND e.deleted_at IS NULL",
        [s.tenantId, id, s.userId],
      );
      if (!assigned.rowCount) throw new ApiError(403, "FORBIDDEN");
      a = assigned.rows[0];
    } else
      a = await artworkAccess(
        c,
        { tenantId: s.tenantId, userId: s.userId },
        id,
      );
    if (a.approved_revision !== a.revision || !validMetadata(a.metadata))
      throw new ApiError(409, "REVISION_NOT_APPROVED");
    const m = a.metadata;
    if (!allowedRights(m.rights, "display"))
      throw new ApiError(403, "RIGHTS_DENIED");
    const asset = (
      await c.query(
        "SELECT a.*,r.metadata AS rights FROM assets a JOIN rights r ON (r.tenant_id,r.id)=(a.tenant_id,a.rights_id) WHERE a.tenant_id=$1 AND a.id=$2 AND a.state='approved' AND a.deleted_at IS NULL AND r.deleted_at IS NULL",
        [s.tenantId, a.approved_asset_id],
      )
    ).rows[0];
    if (!asset || !allowedRights(asset.rights, "display"))
      throw new ApiError(403, "RIGHTS_DENIED");
    const artist = (
      await c.query(
        "SELECT metadata FROM artists WHERE tenant_id=$1 AND id=$2",
        [s.tenantId, a.artist_id],
      )
    ).rows[0];
    if (!preview)
      return {
        id: a.id,
        revision: a.revision,
        title: m.title,
        description: m.description,
        artist:
          typeof artist?.metadata.name === "string"
            ? artist.metadata.name
            : "Unnamed artist",
        dimensions: m.dimensions,
        creditLine: (m.rights as { creditLine?: string }).creditLine ?? "",
        previewMime: asset.mime,
        watermarked: true,
        originalDownload:
          ["admin","artist"].includes(s.role) && allowedRights(m.rights, "download") &&
          allowedRights(asset.rights, "download"),
        export:
          ["admin","artist"].includes(s.role) && allowedRights(m.rights, "export") &&
          allowedRights(asset.rights, "export"),
      };
    if (!this.blobs) throw new ApiError(503, "STORAGE_UNAVAILABLE");
    await c.query("SELECT pg_advisory_xact_lock_shared(82002)");
    const original = Buffer.from(await this.blobs.get(asset.object_key));
    if (
      original.length !== Number(asset.bytes) ||
      sha256(original) !== asset.sha256
    )
      throw new ApiError(409, "ASSET_INTEGRITY");
    const bytes = await derivative(original, asset.mime);
    const key = `${s.tenantId}/derivatives/${asset.sha256}-watermark-v1/${sha256(bytes)}`;
    await this.blobs.put(key, bytes);
    const did = createHash("sha256")
      .update(`${s.tenantId}:${asset.id}:watermark-v1`)
      .digest("hex");
    const derivativeId = `${did.slice(0, 8)}-${did.slice(8, 12)}-4${did.slice(13, 16)}-8${did.slice(17, 20)}-${did.slice(20, 32)}`;
    await c.query(
      "INSERT INTO asset_derivatives(tenant_id,id,metadata,asset_id) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,id) DO NOTHING",
      [
        s.tenantId,
        derivativeId,
        {
          objectKey: key,
          sha256: sha256(bytes),
          mime: asset.mime,
          bytes: bytes.length,
          watermarked: true,
          policy: "display",
          sourceSha256: asset.sha256,
        },
        asset.id,
      ],
    );
    return { bytes, mime: asset.mime };
  }
}
