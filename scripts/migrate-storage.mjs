import { Pool } from "pg";
import { migrate } from "../packages/storage/dist/index.js";
if (!process.env.DATABASE_URL)
  throw new Error(
    "DATABASE_URL required; never pass credentials on command line",
  );
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await migrate(
    pool,
    new URL("../database/migrations/", import.meta.url).pathname,
  );
  console.log("Migrations applied and checksums verified.");
} finally {
  await pool.end();
}
