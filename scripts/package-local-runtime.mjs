// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, realpath, readFile, writeFile, stat, chmod } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const engineRun = (engine, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(engine, args, { stdio: ["ignore", options.capture ? "pipe" : "inherit", "inherit"] }); let out = "";
  child.stdout?.on("data", value => { out += value; }); child.once("error", reject); child.once("exit", code => code === 0 ? resolve(out.trim()) : reject(Error("LOCAL_PACKAGE_ENGINE_FAILED")));
});
async function fileHash(path) { const digest = createHash("sha256"); for await (const chunk of createReadStream(path)) digest.update(chunk); return digest.digest("hex"); }
export function localCompose({ projectName, bundleId, image, postgres }) {
  const labels = { "com.exhibitos.bundle": bundleId, "com.exhibitos.project": projectName, "com.exhibitos.schema": "1.0.0-draft.1" };
  // JSON is a strict YAML subset. No credentials are interpolated while packaging.
  return JSON.stringify({ name: projectName, services: {
    database: { image: postgres, environment: { POSTGRES_PASSWORD: "${POSTGRES_PASSWORD:?required}", POSTGRES_DB: "exhibitos", POSTGRES_USER: "exhibitos" }, volumes: ["database:/var/lib/postgresql"], labels, healthcheck: { test: ["CMD-SHELL", "pg_isready -U exhibitos -d exhibitos"], interval: "5s", timeout: "3s", retries: 30 }, restart: "unless-stopped" },
    platform: { image, pull_policy: "never", env_file: ["../runtime.env"], environment: { NODE_ENV: "production", EXHIBITOS_PORT: "${EXHIBITOS_PORT:-13200}", AUTH_ORIGIN: "http://127.0.0.1:${EXHIBITOS_PORT:-13200}", BLOB_ROOT: "/data/blobs", CONFIG_ROOT: "/data/config" }, ports: ["127.0.0.1:${EXHIBITOS_PORT:-13200}:8080"], volumes: ["objects:/data/blobs", "configuration:/data/config"], labels, depends_on: { database: { condition: "service_healthy" } }, read_only: true, tmpfs: ["/tmp:rw,nosuid,nodev,size=256m,mode=1777"], cap_drop: ["ALL"], security_opt: ["no-new-privileges:true"], restart: "unless-stopped", stop_grace_period: "30s" }
  }, volumes: { database: { labels }, objects: { labels }, configuration: { labels } }, networks: { default: { labels } } }, null, 2) + "\n";
}
export async function packageLocalRuntime(destination, { engine = process.env.CONTAINER_ENGINE ?? "docker", port = 13200 } = {}) {
  if (port !== 13200) throw Error("LOCAL_BUNDLE_PORT_UNSUPPORTED");
  const source = await realpath(new URL("../", import.meta.url).pathname), root = resolve(destination);
  await mkdir(root, { mode: 0o700 }); const directory = join(await realpath(root), "bundle"); await mkdir(directory, { mode: 0o700 });
  const bundleId = randomUUID(), projectName = `exhibitos-${bundleId}`, tag = `exhibitos-local:${bundleId}`;
  await engineRun(engine, ["build", "--file", join(source, "Dockerfile.local"), "--tag", tag, source]);
  const image = await engineRun(engine, ["image", "inspect", "--format", "{{.Id}}", tag], { capture: true }); if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw Error("LOCAL_IMAGE_ID_INVALID");
  const archive = join(directory, "platform-image.tar"); await engineRun(engine, ["save", "--output", archive, image]); await chmod(archive, 0o600);
  const postgres = JSON.parse(await readFile(join(source, "database/images.json"), "utf8")).postgres;
  const compose = localCompose({ projectName, bundleId, image, postgres }); await writeFile(join(directory, "compose.yaml"), compose, { flag: "wx", mode: 0o600 });
  const manifest = { schemaVersion: "1.0.0-draft.1", bundleId, version: "0.1.0", protocolVersion: "1", composeSha256: createHash("sha256").update(compose).digest("hex"), projectName, services: ["platform", "database"], images: [{ reference: image, archive: { path: "platform-image.tar", sha256: await fileHash(archive), bytes: (await stat(archive)).size } }, { reference: postgres }], ports: [port], openUrl: `http://127.0.0.1:${port}`, readinessUrl: `http://127.0.0.1:${port}/api/v1/readiness`, minimumFreeBytes: 3 * 1024 * 1024 * 1024 };
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 }); return { directory, manifest };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { if (process.argv.length !== 3) throw Error("USAGE"); const result = await packageLocalRuntime(process.argv[2]); console.info(`Local runtime bundle created: ${result.directory}`); }
  catch { console.error("Local runtime packaging failed; existing bundles and data are retained."); process.exitCode = 1; }
}
