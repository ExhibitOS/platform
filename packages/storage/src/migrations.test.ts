// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool, PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { migrateInTransaction } from "./migrations.js";
import { migrate } from "./index.js";

async function fixture(work: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "exhibitos-migrations-"));
  try {
    await writeFile(join(directory, "002_second.sql"), "SELECT 'second';");
    await writeFile(join(directory, "001_first.sql"), "SELECT 'first';");
    await writeFile(join(directory, "003_later.sql"), "SELECT 'later';");
    await writeFile(join(directory, "notes.sql"), "not a migration");
    await work(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("caller-owned migration transaction", () => {
  it("locks, checks existing bytes and applies only the ordered suffix through the requested name without closing the transaction", async () => {
    await fixture(async (directory) => {
      const calls: { sql: string; values?: unknown[] }[] = [];
      const firstHash = createHash("sha256").update("SELECT 'first';").digest("hex");
      const client = {
        async query(sql: string, values?: unknown[]) {
          calls.push({ sql, values });
          return sql.startsWith("SELECT sha256") && values?.[0] === "001_first.sql"
            ? { rowCount: 1, rows: [{ sha256: firstHash }] }
            : { rowCount: 0, rows: [] };
        },
      } as unknown as PoolClient;
      await migrateInTransaction(client, directory, "002_second.sql");
      expect(calls.map((call) => call.sql)).toEqual([
        "SELECT pg_advisory_xact_lock(82001)",
        "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
        "SELECT sha256 FROM schema_migrations WHERE name=$1",
        "SELECT sha256 FROM schema_migrations WHERE name=$1",
        "SELECT 'second';",
        "INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)",
      ]);
      expect(calls[2]?.values).toEqual(["001_first.sql"]);
      expect(calls[3]?.values).toEqual(["002_second.sql"]);
      expect(calls[5]?.values).toEqual([
        "002_second.sql",
        createHash("sha256").update("SELECT 'second';").digest("hex"),
      ]);
    });
  });

  it("leaves rollback to the caller when an existing migration checksum differs", async () => {
    await fixture(async (directory) => {
      const calls: string[] = [];
      const client = {
        async query(sql: string) {
          calls.push(sql);
          return { rowCount: 1, rows: [{ sha256: "different" }] };
        },
      } as unknown as PoolClient;
      await expect(migrateInTransaction(client, directory)).rejects.toThrow("migration checksum mismatch");
      expect(calls).toHaveLength(3);
      expect(calls.some((sql) => /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql))).toBe(false);
    });
  });

  it("keeps the pool wrapper responsible for commit, rollback and release", async () => {
    await fixture(async (directory) => {
      for (const fail of [false, true]) {
        const calls: string[] = [];
        const failure = new Error("synthetic SQL failure");
        const client = {
          async query(sql: string) {
            calls.push(sql);
            if (fail && sql === "SELECT 'second';") throw failure;
            return { rowCount: 0, rows: [] };
          },
          release() { calls.push("release"); },
        };
        const pool = { connect: async () => client } as unknown as Pool;
        if (fail) await expect(migrate(pool, directory, "002_second.sql")).rejects.toBe(failure);
        else await migrate(pool, directory, "002_second.sql");
        expect(calls[0]).toBe("BEGIN");
        expect(calls.slice(-2)).toEqual([fail ? "ROLLBACK" : "COMMIT", "release"]);
        expect(calls.filter((sql) => /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql))).toEqual(["BEGIN", fail ? "ROLLBACK" : "COMMIT"]);
      }
    });
  });
});
