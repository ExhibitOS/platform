// SPDX-License-Identifier: AGPL-3.0-or-later
import { Pool } from "pg";
import { FileBlobStore } from "../packages/storage/dist/index.js";
import { buildApp } from "../apps/api/dist/app.js";
import { loadFreezeConfig } from "../apps/api/dist/freeze.js";

// Isolated synthetic connection/session data arrive through stdin, never command arguments or logs.
let input = ""; for await (const part of process.stdin) input += part;
const args = JSON.parse(input), pool = new Pool(args.database);
const freeze = await loadFreezeConfig({ runtimeRoot: args.runtimeRoot, signingKeyFile: args.signingKeyFile, origin: args.origin });
const app = buildApp({ pool, blobs: new FileBlobStore(args.blobRoot), auth: { mode: "local", origin: args.origin, bindHost: "127.0.0.1" }, freeze });
try {
  const response = await app.inject({ method: "POST", url: args.url,
    headers: { host: new URL(args.origin).host, origin: args.origin, cookie: args.cookie, "x-csrf-token": args.csrfToken, "if-match": args.etag }, payload: { requestId: args.requestId } });
  if (response.statusCode !== 201) throw Error(`Synthetic freeze worker failed: HTTP ${response.statusCode}`);
} finally { await app.close(); await pool.end(); }
