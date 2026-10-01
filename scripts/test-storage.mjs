import { execFileSync } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";
import {
  Storage,
  FileBlobStore,
  S3BlobStore,
  migrate,
  sha256,
} from "../packages/storage/dist/index.js";
const docker = process.env.DOCKER_BIN ?? "docker";
const id = `exhibitos-test-${randomUUID()}`,
  password = randomBytes(24).toString("hex");
const images = JSON.parse(
  await readFile(new URL("../database/images.json", import.meta.url), "utf8"),
);
const run = (...args) =>
  execFileSync(docker, args, {
    encoding: "utf8",
    timeout: 120000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const names = [],
  volumes = [];
let pool, maintenance;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evidence = [];
async function container(suffix, image, args, port) {
  const name = `${id}-${suffix}`,
    volume = `${name}-data`;
  run("volume", "create", "--label", `exhibitos.test=${id}`, volume);
  volumes.push(volume);

  run(
    "run",
    "-d",
    "--name",
    name,
    "--label",
    `exhibitos.test=${id}`,
    "-p",
    `127.0.0.1::${port}`,
    "-v",
    `${volume}:${suffix === "pg" ? "/var/lib/postgresql" : "/s3mockroot"}`,
    ...args,
    image,
  );
  names.push(name);
  return Number(run("port", name, `${port}/tcp`).split(":").at(-1));
}
try {
  const pgPort = await container(
    "pg",
    images.postgres,
    ["-e", `POSTGRES_PASSWORD=${password}`],
    5432,
  );
  const s3Port = await container(
    "s3",
    images.s3mock,
    [
      "-e",
      "COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS=synthetic",
      "-e",
      "COM_ADOBE_TESTING_S3MOCK_STORE_ROOT=/s3mockroot",
      "-e",
      "COM_ADOBE_TESTING_S3MOCK_STORE_RETAIN_FILES_ON_EXIT=true",
    ],
    9090,
  );
  pool = new Pool({
    host: "127.0.0.1",
    port: pgPort,
    user: "postgres",
    password,
    database: "postgres",
  });
  for (let tries = 0; ; tries++) {
    try {
      await pool.query("SELECT 1");
      break;
    } catch (error) {
      if (tries > 90) throw error;
      await pause(1000);
    }
  }
  const directory = new URL("../database/migrations/", import.meta.url)
    .pathname;
  await migrate(pool, directory, "001_metadata.sql");
  const tenant = randomUUID(),
    user = randomUUID(),
    artist = randomUUID(),
    foreignTenant = randomUUID();
  await pool.query(
    "INSERT INTO tenants(id,name) VALUES($1,'synthetic'),($2,'other')",
    [tenant, foreignTenant],
  );
  await pool.query("INSERT INTO users(id,subject) VALUES($1,'synthetic')", [user]);
  await pool.query("INSERT INTO memberships VALUES($1,$2,'admin')", [
    tenant,
    user,
  ]);
  await pool.query(
    "INSERT INTO artists(tenant_id,id,user_id,metadata) VALUES($1,$2,$3,'{}')",
    [tenant, artist, user],
  );
  await migrate(pool, directory);
  await migrate(pool, directory);
  assert.equal(
    (await pool.query("SELECT count(*) FROM schema_migrations")).rows[0].count,
    "3",
  );
  assert.equal(
    (await pool.query("SELECT count(*) FROM artists")).rows[0].count,
    "1",
  );
  const altered = await mkdtemp(`${tmpdir()}/exhibitos-migrations-`);
  for (const name of await readdir(directory))
    await writeFile(
      `${altered}/${name}`,
      await readFile(`${directory}/${name}`),
    );
  await writeFile(
    `${altered}/001_metadata.sql`,
    "-- changed applied migration",
  );
  await assert.rejects(migrate(pool, altered), /checksum mismatch/);
  await writeFile(
    `${altered}/001_metadata.sql`,
    await readFile(`${directory}/001_metadata.sql`),
  );
  await writeFile(
    `${altered}/004_failed.sql`,
    "CREATE TABLE must_rollback(id integer); INVALID SQL;",
  );
  await assert.rejects(migrate(pool, altered));
  assert.equal(
    (await pool.query("SELECT to_regclass('must_rollback') AS table_name"))
      .rows[0].table_name,
    null,
  );
  evidence.push("fresh/forward/no-op migrations preserve data");
  const s3 = new S3Client({
    endpoint: `http://127.0.0.1:${s3Port}`,
    region: "us-east-1",
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: { accessKeyId: "synthetic", secretAccessKey: "synthetic" },
  });
  const s3Store = new S3BlobStore(s3, "synthetic");
  for (let tries = 0; ; tries++) {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: "synthetic" }));
      break;
    } catch (error) {
      if (tries > 90) throw error;
      await pause(1000);
    }
  }
  const stores = [
    new FileBlobStore(await mkdtemp(`${tmpdir()}/exhibitos-blobs-`)),
    s3Store,
  ];
  const s3Pool = pool;
  const actor = { tenantId: tenant, userId: user };
  let sequence = 0;
  for (const blobs of stores) {
    if (blobs instanceof FileBlobStore) {
      await s3Pool.query("CREATE DATABASE filesystem_case");
      pool = new Pool({
        host: "127.0.0.1",
        port: pgPort,
        user: "postgres",
        password,
        database: "filesystem_case",
      });
      await migrate(pool, directory);
      await pool.query(
        "INSERT INTO tenants(id,name) VALUES($1,'synthetic'),($2,'other')",
        [tenant, foreignTenant],
      );
      await pool.query("INSERT INTO users(id,subject) VALUES($1,'synthetic')", [user]);
      await pool.query("INSERT INTO memberships VALUES($1,$2,'admin')", [
        tenant,
        user,
      ]);
      await pool.query(
        "INSERT INTO artists(tenant_id,id,user_id,metadata) VALUES($1,$2,$3,'{}')",
        [tenant, artist, user],
      );
    }
    const bytes = Buffer.from(
      `synthetic ${blobs.constructor.name} artwork bytes`,
    );
    const storage = new Storage(pool, blobs);
    let wrongWrites = 0;
    const hostileList = {
      get: (key) => blobs.get(key),
      put: async () => {
        wrongWrites++;
      },
      remove: async () => {
        wrongWrites++;
      },
      list: async () => [
        `${foreignTenant}/stored/foreign`,
        `${tenant}/unrelated/stored/nested`,
      ],
    };
    assert.deepEqual(
      await new Storage(pool, hostileList).reconcile(actor, true),
      [],
    );
    assert.equal(wrongWrites, 0);
    const key = `ingest-${sequence++}`;
    const input = {
      artistId: artist,
      metadata: { title: key },
      rights: { display: true },
      mime: "application/octet-stream",
      scaleMeters: 1,
      bytes,
    };
    const count = async () =>
      Number((await pool.query("SELECT count(*) FROM artworks")).rows[0].count);
    const before = await count();
    await assert.rejects(
      storage.ingest(actor, key, input, () => {
        throw Error("injected database failure");
      }),
    );
    assert.equal(await count(), before);
    const orphaned = await storage.reconcile(actor, true);
    assert.equal(orphaned.length, 1);
    const manifest = (await blobs.list(`${tenant}/trash`)).find((x) =>
      x.endsWith(".json"),
    );
    assert.ok(manifest);
    await assert.rejects(
      storage.restoreOrphan(
        { tenantId: foreignTenant, userId: user },
        manifest,
      ),
    );
    await pool.query(
      "UPDATE memberships SET role='viewer' WHERE tenant_id=$1 AND user_id=$2",
      [tenant, user],
    );
    await assert.rejects(storage.restoreOrphan(actor, manifest));
    await pool.query(
      "UPDATE memberships SET role='admin' WHERE tenant_id=$1 AND user_id=$2",
      [tenant, user],
    );
    const foreignKey = `${foreignTenant}/stored/foreign`;
    const archiveKey = `${tenant}/trash/${sha256(Buffer.from(foreignKey))}/${sha256(bytes)}`;
    await blobs.put(archiveKey, bytes);
    await blobs.put(
      `${archiveKey}.json`,
      Buffer.from(
        JSON.stringify({
          key: foreignKey,
          archiveKey,
          sha256: sha256(bytes),
          bytes: bytes.length,
        }),
      ),
    );
    await assert.rejects(storage.restoreOrphan(actor, `${archiveKey}.json`));
    await storage.restoreOrphan(actor, manifest);
    assert.equal(sha256(await blobs.get(orphaned[0])), sha256(bytes));
    const concurrent = await Promise.all(
      Array.from({ length: 4 }, () => storage.ingest(actor, key, input)),
    );
    assert.equal(new Set(concurrent).size, 1);
    const artwork = concurrent[0];
    assert.equal(await storage.ingest(actor, key, input), artwork);
    assert.equal(await count(), before + 1);
    await assert.rejects(
      storage.ingest(actor, key, {
        ...input,
        metadata: { title: "different" },
      }),
    );
    assert.equal(
      await storage.work(() => {
        throw Error("injected worker failure");
      }),
      false,
    );
    await pause(1100);
    assert.equal(await storage.work(), true);
    assert.equal(await storage.work(), false);
    assert.equal(
      (
        await pool.query("SELECT state FROM assets WHERE artwork_id=$1", [
          artwork,
        ])
      ).rows[0].state,
      "stored",
    );
    assert.equal(await count(), before + 1);
    await blobs.put(`${tenant}/stored/conflict`, bytes);
    await assert.rejects(
      blobs.put(`${tenant}/stored/conflict`, Buffer.from("different bytes")),
    );
    await assert.rejects(blobs.get("../escape"));
    assert.equal(
      await storage.revise(actor, artwork, 1, { title: "revision two" }),
      2,
    );
    await assert.rejects(storage.revise(actor, artwork, 1, {}));
    await assert.rejects(
      pool.query(
        "UPDATE artwork_revisions SET snapshot='{}' WHERE artwork_id=$1",
        [artwork],
      ),
    );
    await assert.rejects(
      storage.readArtwork({ tenantId: foreignTenant, userId: user }, artwork),
    );
    await assert.rejects(
      pool.query(
        "INSERT INTO artworks(tenant_id,id,artist_id,metadata) VALUES($1,$2,$3,'{}')",
        [foreignTenant, randomUUID(), artist],
      ),
    );
    if (blobs instanceof FileBlobStore) {
      await pool.end();
      pool = s3Pool;
    }
    evidence.push(
      `${blobs.constructor.name}: file-success/DB-fail, orphan archive/restore, idempotency, DB-success/worker-fail retry, immutable bytes/revisions, tenant isolation`,
    );
  }
  // Quiesced synthetic backup: no concurrent writers; pg_dump plus all object bytes.
  const backup = await mkdtemp(`${tmpdir()}/exhibitos-backup-`);
  const inventory = [];
  maintenance = await pool.connect();
  await maintenance.query("SELECT pg_advisory_lock(82002)");
  for (const key of await s3Store.list(tenant)) {
    const bytes = await s3Store.get(key);
    inventory.push({ key, sha256: sha256(bytes), bytes: bytes.length });
    await writeFile(`${backup}/${sha256(Buffer.from(key))}`, bytes, {
      flag: "wx",
    });
  }
  const restoredKeys = new Set(inventory.map((object) => object.key));
  for (const row of (await pool.query("SELECT object_key,sha256,bytes FROM assets")).rows)
    { assert.ok(restoredKeys.has(row.object_key)); const object=inventory.find(entry=>entry.key===row.object_key); assert.equal(object.sha256,row.sha256); assert.equal(object.bytes,Number(row.bytes)); }
  const dump = execFileSync(
    docker,
    ["exec", names[0], "pg_dump", "-U", "postgres", "-Fc", "postgres"],
    { timeout: 120000 },
  );
  await writeFile(`${backup}/database.dump`, dump, { flag: "wx" });
  await maintenance.query("SELECT pg_advisory_unlock(82002)");
  maintenance.release();
  maintenance = undefined;
  run("exec", names[0], "createdb", "-U", "postgres", "restored");
  execFileSync(
    docker,
    ["exec", "-i", names[0], "pg_restore", "-U", "postgres", "-d", "restored"],
    { input: dump, timeout: 120000, stdio: ["pipe", "pipe", "pipe"] },
  );
  const restored = new Pool({
    host: "127.0.0.1",
    port: pgPort,
    user: "postgres",
    password,
    database: "restored",
  });
  let restoredAssets;
  try {
    assert.equal(
      (await restored.query("SELECT count(*) FROM artworks")).rows[0].count,
      "1",
    );
    for (const table of [
      "artworks",
      "artwork_revisions",
      "assets",
      "rights",
      "outbox",
      "ingest_requests",
      "artists",
      "memberships",
      "tenants",
      "schema_migrations",
    ]) {
      const source = (
        await pool.query(
          `SELECT row_to_json(t) AS value FROM ${table} t ORDER BY row_to_json(t)::text`,
        )
      ).rows;
      const target = (
        await restored.query(
          `SELECT row_to_json(t) AS value FROM ${table} t ORDER BY row_to_json(t)::text`,
        )
      ).rows;
      assert.deepEqual(target, source);
    }
    restoredAssets = (
      await restored.query("SELECT object_key,sha256,bytes FROM assets")
    ).rows;
  } finally {
    await restored.end();
  }
  const restoreStore = new FileBlobStore(
    await mkdtemp(`${tmpdir()}/exhibitos-restored-blobs-`),
  );
  for (const object of inventory) {
    const bytes = await readFile(
      `${backup}/${sha256(Buffer.from(object.key))}`,
    );
    assert.equal(sha256(bytes), object.sha256);
    await restoreStore.put(object.key, bytes);
    assert.equal(sha256(await restoreStore.get(object.key)), object.sha256);
  }
  for (const asset of restoredAssets) {
    const bytes = await restoreStore.get(asset.object_key);
    assert.equal(sha256(bytes), asset.sha256);
    assert.equal(bytes.length, Number(asset.bytes));
  }
  await writeFile(
    `${backup}/inventory.json`,
    JSON.stringify(inventory, null, 2),
    { flag: "wx" },
  );
  evidence.push(
    `quiesced synthetic pg_dump/pg_restore + ${inventory.length} blob hash roundtrip`,
  );
  run("restart", names[1]);
  const restartedPort = Number(
    run("port", names[1], "9090/tcp").split(":").at(-1),
  );
  const restartedClient = new S3Client({
    endpoint: `http://127.0.0.1:${restartedPort}`,
    region: "us-east-1",
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: { accessKeyId: "synthetic", secretAccessKey: "synthetic" },
  });
  const restartedStore = new S3BlobStore(restartedClient, "synthetic");
  for (let tries = 0; ; tries++) {
    try {
      await restartedClient.send(
        new HeadBucketCommand({ Bucket: "synthetic" }),
      );
      break;
    } catch (error) {
      if (tries > 90) throw error;
      await pause(1000);
    }
  }
  for (const object of inventory)
    assert.equal(sha256(await restartedStore.get(object.key)), object.sha256);
  evidence.push(
    "pinned S3Mock retain-files restart preserves complete inventory",
  );
  console.log(
    JSON.stringify({ valid: true, evidence, images, backup }, null, 2),
  );
} finally {
  if (maintenance) {
    await maintenance.query("SELECT pg_advisory_unlock(82002)").catch(() => {});
    maintenance.release();
  }
  await pool?.end();
  for (const name of names.reverse())
    if (
      run(
        "inspect",
        "--format",
        '{{index .Config.Labels "exhibitos.test"}}',
        name,
      ) === id
    )
      run("rm", "-f", name);
  for (const volume of volumes)
    if (
      run(
        "volume",
        "inspect",
        "--format",
        '{{index .Labels "exhibitos.test"}}',
        volume,
      ) === id
    )
      run("volume", "rm", volume);
}
