// SPDX-License-Identifier: AGPL-3.0-or-later
import { Pool } from "pg";
import { S3Client } from "@aws-sdk/client-s3";
import { FileBlobStore, S3BlobStore } from "../packages/storage/dist/index.js";
import { buildApp } from "../apps/api/dist/app.js";
import { loadFreezeConfig } from "../apps/api/dist/freeze.js";

// All synthetic session, key-path and database details use stdin rather than command arguments or logs.
let raw = ""; for await (const part of process.stdin) raw += part;
const input = JSON.parse(raw), pool = new Pool(input.database);
const s3 = input.s3 ? new S3Client(input.s3.client) : null;
const blobs = s3 ? new S3BlobStore(s3, input.s3.bucket) : new FileBlobStore(input.blobRoot);
const freeze = await loadFreezeConfig(input.freeze);
const app = buildApp({ pool, blobs, freeze, auth: { mode: "local", origin: input.freeze.origin, bindHost: "127.0.0.1" } });
try {
  const response = await app.inject({ method: "POST", url: input.url,
    headers: { host: new URL(input.freeze.origin).host, origin: input.freeze.origin, cookie: input.cookie, "x-csrf-token": input.csrfToken, "if-match": input.etag }, payload: { requestId: input.requestId } });
  if (response.statusCode !== 201) throw Error(`Synthetic pending freeze fixture failed HTTP ${response.statusCode}`);
} finally { await app.close(); await pool.end(); s3?.destroy(); }
