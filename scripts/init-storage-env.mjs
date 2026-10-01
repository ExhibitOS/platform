import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
await mkdir(".local", { recursive: true });
await writeFile(
  ".local/storage.env",
  `POSTGRES_PASSWORD=${randomBytes(24).toString("hex")}\n`,
  { flag: "wx", mode: 0o600 },
);
console.log(
  "Created ignored .local/storage.env; existing files are never overwritten.",
);
