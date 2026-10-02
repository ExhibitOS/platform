// SPDX-License-Identifier: AGPL-3.0-or-later
// Isolated test subprocess accepts synthetic credentials only on stdin.
import { Pool } from "pg";
import { FileBlobStore } from "../packages/storage/dist/index.js";
import { Oex } from "../apps/api/dist/oex.js";
const parts = []; for await (const part of process.stdin) parts.push(part);
const input = JSON.parse(Buffer.concat(parts).toString("utf8"));
const pool = new Pool(input.database);
try { await new Oex(pool, new FileBlobStore(input.blobRoot)).run(input.jobId); }
finally { await pool.end(); }
