import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { sha256, type BlobStore } from "./blobs.js";
export * from "./blobs.js";
export * from "./policy.js";
import { membership, artworkAccess, AccessDenied } from "./policy.js";
export async function transaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function migrate(pool: Pool, directory: string, through?: string) {
  return transaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(82001)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of (await readdir(directory))
      .filter((x) => /^\d+.*\.sql$/.test(x))
      .sort()) {
      if (through && name > through) continue;
      const sql = await readFile(`${directory}/${name}`);
      const hash = sha256(sql);
      const existing = await client.query(
        "SELECT sha256 FROM schema_migrations WHERE name=$1",
        [name],
      );
      if (existing.rowCount) {
        if (existing.rows[0].sha256 !== hash)
          throw new Error("migration checksum mismatch");
        continue;
      }
      await client.query(sql.toString());
      await client.query(
        "INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)",
        [name, hash],
      );
    }
  });
}
export interface Actor {
  tenantId: string;
  userId: string;
}
const authorize = membership;
const lock = (client: PoolClient) =>
  client.query("SELECT pg_advisory_xact_lock_shared(82002)");
export interface Ingest {
  artistId: string;
  metadata: Record<string, unknown>;
  rights: Record<string, unknown>;
  mime: string;
  scaleMeters: number;
  bytes: Uint8Array;
}
export class Storage {
  constructor(
    readonly pool: Pool,
    readonly blobs: BlobStore,
  ) {}
  async ingest(
    actor: Actor,
    key: string,
    input: Ingest,
    afterBlob?: () => void,
  ) {
    if (
      !key.length ||
      key.length > 200 ||
      !Number.isFinite(input.scaleMeters) ||
      input.scaleMeters <= 0
    )
      throw new Error("invalid ingest");
    const hash = sha256(input.bytes);
    const payloadHash = sha256(
      Buffer.from(JSON.stringify({ ...input, bytes: hash })),
    );
    return transaction(this.pool, async (client) => {
      const role = await authorize(client, actor);
      await lock(client);
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`${actor.tenantId}:${key}`],
      );
      const artist = await client.query(
        "SELECT user_id FROM artists WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL",
        [actor.tenantId, input.artistId],
      );
      if (
        !artist.rowCount ||
        (role !== "admin" && (role !== "artist" || artist.rows[0].user_id !== actor.userId))
      )
        throw new AccessDenied();
      const previous = await client.query(
        "SELECT payload_hash,artwork_id FROM ingest_requests WHERE tenant_id=$1 AND key=$2",
        [actor.tenantId, key],
      );
      if (previous.rowCount) {
        if (previous.rows[0].payload_hash !== payloadHash)
          throw new Error("idempotency conflict");
        return previous.rows[0].artwork_id as string;
      }
      const objectKey = `${actor.tenantId}/quarantine/${payloadHash}/${hash}`;
      await this.blobs.put(objectKey, input.bytes);
      afterBlob?.();
      const artwork = randomUUID(),
        rights = randomUUID(),
        asset = randomUUID();
      await client.query(
        "INSERT INTO artworks(tenant_id,id,artist_id,metadata) VALUES($1,$2,$3,$4)",
        [actor.tenantId, artwork, input.artistId, input.metadata],
      );
      await client.query(
        "INSERT INTO artwork_revisions(tenant_id,artwork_id,revision,snapshot) VALUES($1,$2,1,$3)",
        [actor.tenantId, artwork, input.metadata],
      );
      await client.query(
        "INSERT INTO rights(tenant_id,id,metadata) VALUES($1,$2,$3)",
        [actor.tenantId, rights, input.rights],
      );
      await client.query(
        "INSERT INTO assets(tenant_id,id,artwork_id,rights_id,object_key,target_key,sha256,bytes,mime,scale_meters,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'quarantine')",
        [
          actor.tenantId,
          asset,
          artwork,
          rights,
          objectKey,
          `${actor.tenantId}/stored/${hash}`,
          hash,
          input.bytes.length,
          input.mime,
          input.scaleMeters,
        ],
      );
      await client.query(
        "INSERT INTO outbox(tenant_id,id,asset_id) VALUES($1,$2,$3)",
        [actor.tenantId, randomUUID(), asset],
      );
      await client.query("INSERT INTO ingest_requests VALUES($1,$2,$3,$4)", [
        actor.tenantId,
        key,
        payloadHash,
        artwork,
      ]);
      return artwork;
    });
  }
  async readArtwork(actor: Actor, id: string) {
    return transaction(this.pool, async (client) => {
      const row = await artworkAccess(client, actor, id);
      const { owner_user_id: _owner, ...result } = row;
      void _owner;
      return result;
    });
  }
  async revise(
    actor: Actor,
    id: string,
    expected: number,
    metadata: Record<string, unknown>,
  ) {
    return transaction(this.pool, async (client) => {
      await artworkAccess(client, actor, id, true);
      await lock(client);
      const result = await client.query(
        "UPDATE artworks SET metadata=$4,revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND revision=$3 AND deleted_at IS NULL  RETURNING revision",
        [actor.tenantId, id, expected, metadata],
      );
      if (!result.rowCount) throw new Error("revision conflict or denied");
      const revision = result.rows[0].revision as number;
      await client.query(
        "INSERT INTO artwork_revisions VALUES($1,$2,$3,$4,now())",
        [actor.tenantId, id, revision, metadata],
      );
      return revision;
    });
  }
  async work(afterCopy?: () => void) {
    return transaction(this.pool, async (client) => {
      await lock(client);
      const jobs = await client.query(
        "SELECT o.*,a.object_key,a.target_key,a.sha256 FROM outbox o JOIN assets a ON (a.tenant_id,a.id)=(o.tenant_id,o.asset_id) WHERE o.status='pending' AND available_at<=now() ORDER BY available_at FOR UPDATE OF o SKIP LOCKED LIMIT 1",
      );
      if (!jobs.rowCount) return false;
      const job = jobs.rows[0];
      await client.query("SAVEPOINT attempt");
      try {
        const bytes = await this.blobs.get(job.object_key);
        if (sha256(bytes) !== job.sha256)
          throw new Error("object hash mismatch");
        await this.blobs.put(job.target_key, bytes);
        afterCopy?.();
        await client.query(
          "UPDATE assets SET object_key=target_key,state='stored',revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [job.tenant_id, job.asset_id],
        );
        await client.query(
          "UPDATE outbox SET status='done',attempts=attempts+1,last_error=NULL WHERE tenant_id=$1 AND id=$2",
          [job.tenant_id, job.id],
        );
      } catch {
        await client.query("ROLLBACK TO SAVEPOINT attempt");
        await client.query(
          "UPDATE outbox SET attempts=attempts+1,status=CASE WHEN attempts+1>=5 THEN 'dead' ELSE 'pending' END,available_at=now()+interval '1 second',last_error='storage attempt failed' WHERE tenant_id=$1 AND id=$2",
          [job.tenant_id, job.id],
        );
        return false;
      }
      return true;
    });
  }
  async reconcile(actor: Actor, apply = false) {
    return transaction(this.pool, async (client) => {
      if ((await authorize(client, actor)) !== "admin")
        throw new Error("admin required");
      await client.query("SELECT pg_advisory_xact_lock(82002)");
      const refs = await client.query(
        "SELECT object_key,target_key FROM assets WHERE tenant_id=$1",
        [actor.tenantId],
      );
      const jobsTable = await client.query("SELECT to_regclass('import_jobs') AS name");
      if (jobsTable.rows[0].name) { const jobs = await client.query('SELECT object_key,approved_key AS target_key FROM import_jobs WHERE tenant_id=$1',[actor.tenantId]); refs.rows.push(...jobs.rows); }
      const publicationTable=await client.query("SELECT to_regclass('publication_assets') AS name");if(publicationTable.rows[0].name){const publications=await client.query('SELECT object_key FROM publication_assets WHERE tenant_id=$1',[actor.tenantId]);for(const row of publications.rows)refs.rows.push({object_key:row.object_key,target_key:row.object_key});}
      const derivatives=await client.query('SELECT metadata FROM asset_derivatives WHERE tenant_id=$1 AND deleted_at IS NULL',[actor.tenantId]);for(const row of derivatives.rows){if(typeof row.metadata.objectKey==='string')refs.rows.push({object_key:row.metadata.objectKey,target_key:row.metadata.objectKey});}
      const referenced = new Set(
        refs.rows.flatMap((row) => [row.object_key, row.target_key]),
      );
      const orphaned: string[] = [];
      for (const key of await this.blobs.list(actor.tenantId)) {
        if (
          (!key.startsWith(`${actor.tenantId}/quarantine/`) &&
            !key.startsWith(`${actor.tenantId}/stored/`) && !key.startsWith(`${actor.tenantId}/approved/`)) ||
          referenced.has(key)
        )
          continue;
        orphaned.push(key);
        if (apply) {
          const bytes = await this.blobs.get(key);
          const archiveKey = `${actor.tenantId}/trash/${sha256(Buffer.from(key))}/${sha256(bytes)}`;
          await this.blobs.put(archiveKey, bytes);
          if (sha256(await this.blobs.get(archiveKey)) !== sha256(bytes))
            throw new Error("archive verification failed");
          await this.blobs.put(
            `${archiveKey}.json`,
            Buffer.from(
              JSON.stringify({
                key,
                archiveKey,
                sha256: sha256(bytes),
                bytes: bytes.length,
              }),
            ),
          );
          await this.blobs.remove(key);
        }
      }
      return orphaned;
    });
  }
  async restoreOrphan(actor: Actor, manifestKey: string) {
    return transaction(this.pool, async (client) => {
      if ((await authorize(client, actor)) !== "admin")
        throw new Error("admin required");
      await client.query("SELECT pg_advisory_xact_lock(82002)");
      const prefix = `${actor.tenantId}/trash/`;
      if (
        !manifestKey.startsWith(prefix) ||
        !/^([0-9a-f]{64})\/([0-9a-f]{64})\.json$/.test(
          manifestKey.slice(prefix.length),
        )
      )
        throw new Error("invalid tenant manifest");
      const manifest = JSON.parse(
        Buffer.from(await this.blobs.get(manifestKey)).toString(),
      ) as { key: string; archiveKey: string; sha256: string; bytes: number };
      if (
        typeof manifest.key !== "string" ||
        !manifest.key.startsWith(`${actor.tenantId}/`) ||
        !/^(quarantine|stored|approved)\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(
          manifest.key.slice(actor.tenantId.length + 1),
        ) ||
        manifest.key.split("/").some((x) => x === "." || x === "..") ||
        !/^[0-9a-f]{64}$/.test(manifest.sha256) ||
        !Number.isSafeInteger(manifest.bytes) ||
        manifest.bytes <= 0 ||
        manifest.bytes > 32 * 1024 * 1024
      )
        throw new Error("invalid archive manifest");
      const archiveKey = `${prefix}${sha256(Buffer.from(manifest.key))}/${manifest.sha256}`;
      if (
        manifest.archiveKey !== archiveKey ||
        manifestKey !== `${archiveKey}.json`
      )
        throw new Error("archive identity mismatch");
      const bytes = await this.blobs.get(archiveKey);
      if (sha256(bytes) !== manifest.sha256 || bytes.length !== manifest.bytes)
        throw new Error("archive integrity mismatch");
      await this.blobs.put(manifest.key, bytes);
    });
  }
}

export * from "./service-inventory.js";
export * from "./encrypted-files.js";
export * from "./service-backup.js";

export * from "./encrypted-streams.js";
