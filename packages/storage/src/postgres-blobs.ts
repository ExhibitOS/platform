// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Pool } from "pg";
import { sha256, type BlobStore } from "./blobs.js";
const MAX_BYTES = 32 * 1024 * 1024;
function key(value: string) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+$/.test(value) || value.split("/").some(part => part === "." || part === "..")) throw Error("invalid object key");
}
/** Uses the existing service DB and its backup; never Render's ephemeral disk.
 * Public assets are exported separately to Pages. API authorization remains the
 * caller's responsibility, exactly as for FileBlobStore. */
export class PostgresBlobStore implements BlobStore {
  constructor(readonly pool: Pool, readonly options: { allowUninitialized?: boolean } = {}) {}
  async put(name: string, value: Uint8Array) {
    key(name);
    if (!value.length || value.length > MAX_BYTES) throw Error("object size limit");
    const bytes = Buffer.from(value), hash = sha256(bytes);
    await this.pool.query("INSERT INTO hosted_objects(object_key,bytes,sha256) VALUES($1,$2,$3) ON CONFLICT(object_key) DO NOTHING", [name, bytes, hash]);
    // A conflicting write must never replace the preserved object.
    const existing = await this.get(name);
    if (sha256(existing) !== hash) throw Error("immutable object conflict");
  }
  async get(name: string) {
    key(name);
    const row = (await this.pool.query("SELECT bytes,sha256 FROM hosted_objects WHERE object_key=$1", [name])).rows[0] as { bytes: Buffer; sha256: string } | undefined;
    if (!row) throw Error("object not found");
    if (!Buffer.isBuffer(row.bytes) || !row.bytes.length || row.bytes.length > MAX_BYTES || sha256(row.bytes) !== row.sha256) throw Error("object integrity invalid");
    return Buffer.from(row.bytes);
  }
  async list(prefix: string) {
    key(`${prefix}/sentinel`);
    // Prefix is compared as text, never an SQL LIKE pattern or SQL identifier.
    return (await this.pool.query("SELECT object_key FROM hosted_objects WHERE starts_with(object_key,$1) ORDER BY object_key", [`${prefix}/`])).rows.map((r: { object_key: string }) => r.object_key);
  }
  async listAll() {
    try { return (await this.pool.query("SELECT object_key FROM hosted_objects ORDER BY object_key")).rows.map((r: { object_key: string }) => r.object_key); }
    catch (error) { if (this.options.allowUninitialized && (error as {code?:string}).code === "42P01") return []; throw error; }
  }
  async remove(name: string) {
    key(name);
    await this.pool.query("DELETE FROM hosted_objects WHERE object_key=$1", [name]);
  }
}
