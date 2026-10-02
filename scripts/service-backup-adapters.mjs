// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { S3Client } from "@aws-sdk/client-s3";
import { S3BlobStore } from "../packages/storage/dist/index.js";
import { postgresAdapter } from "./service-backup.mjs";

export class IsolatedBackends {
  constructor(images) { this.images = images; this.owner = `exhibitos-service-backup-${randomUUID()}`; this.containers = []; this.pools = []; this.clients = []; }
  run(args, env = {}) { return execFileSync(process.env.DOCKER_BIN ?? "docker", args, { env: { ...process.env, ...env }, encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"] }).trim(); }
  async postgres(label) {
    const name = `${this.owner}-${label}`, password = randomBytes(24).toString("hex");
    this.run(["run", "-d", "--name", name, "--label", `exhibitos.service.backup.test=${this.owner}`, "-p", "127.0.0.1::5432", "-e", "POSTGRES_PASSWORD", this.images.postgres], { POSTGRES_PASSWORD: password });
    this.containers.push(name);
    const database = { host: "127.0.0.1", port: Number(this.run(["port", name, "5432/tcp"]).split(":").at(-1)), user: "postgres", password, database: "postgres", statement_timeout: 30000 };
    const pool = new Pool(database); this.pools.push(pool);
    for (let attempt = 0; ; attempt++) { try { await pool.query("SELECT 1"); break; } catch { if (attempt >= 90) throw Error("Isolated PostgreSQL failed readiness"); await new Promise(resolve => setTimeout(resolve, 500)); } }
    return { name, password, database, pool };
  }
  async s3() {
    const name = `${this.owner}-s3`;
    this.run(["run", "-d", "--name", name, "--label", `exhibitos.service.backup.test=${this.owner}`, "-p", "127.0.0.1::9090", "-e", "COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS=synthetic", "-e", "COM_ADOBE_TESTING_S3MOCK_STORE_ROOT=/s3mockroot", "-e", "COM_ADOBE_TESTING_S3MOCK_STORE_RETAIN_FILES_ON_EXIT=true", this.images.s3mock]); this.containers.push(name);
    const config = { endpoint: `http://127.0.0.1:${Number(this.run(["port", name, "9090/tcp"]).split(":").at(-1))}`, region: "us-east-1", forcePathStyle: true, maxAttempts: 1, credentials: { accessKeyId: "synthetic", secretAccessKey: randomBytes(24).toString("hex") } };
    const client = new S3Client(config); this.clients.push(client); const store = new S3BlobStore(client, "synthetic");
    for (let attempt = 0; ; attempt++) { try { await store.listAll(); break; } catch { if (attempt >= 90) throw Error("Isolated S3Mock failed readiness"); await new Promise(resolve => setTimeout(resolve, 500)); } }
    return { name, store, config: { client: config, bucket: "synthetic" } };
  }
  async pgFile(source, path, mode, snapshotId) {
    const connection = `postgresql://postgres:${encodeURIComponent(source.password)}@127.0.0.1:${source.database.port}/postgres`;
    const adapter = postgresAdapter(connection, { ...process.env, BACKUP_POSTGRES_CONTAINER: source.name });
    if (mode === "dump") await adapter.dump(path, snapshotId); else await adapter.restore(path);
  }
  stop(name) { assert(this.containers.includes(name)); this.run(["stop", "-t", "1", name]); }
  async close() {
    for (const pool of this.pools) await pool.end().catch(() => {});
    for (const client of this.clients) client.destroy();
    for (const name of [...this.containers].reverse()) {
      assert.equal(this.run(["inspect", "--format", '{{index .Config.Labels "exhibitos.service.backup.test"}}', name]), this.owner);
      this.run(["rm", "-fv", name]);
    }
  }
}
