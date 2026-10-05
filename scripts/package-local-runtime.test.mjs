// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, access, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageLocalRuntime } from "./package-local-runtime.mjs";

const fixture = async () => realpath(await mkdtemp(join(tmpdir(), "exhibitos-package-guard-")));
test("unsupported platforms and invalid root options refuse before creating output or calling an engine", async () => {
  const root = join(await fixture(), "output");
  await assert.rejects(packageLocalRuntime(root, { targetPlatform: "windows/amd64" }), /LOCAL_PLATFORM_UNSUPPORTED/);
  await assert.rejects(packageLocalRuntime(root, { existingRoot: "yes" }), /LOCAL_ROOT_OPTION_INVALID/);
  await assert.rejects(access(root));
});
test("existing bundle and installed marker are preserved before engine operations", async () => {
  const root = await fixture(); await mkdir(join(root, "bundle"));
  await writeFile(join(root, "bundle", "witness"), "preserved");
  await assert.rejects(packageLocalRuntime(root, { existingRoot: true }), { code: "EEXIST" });
  assert.equal(await readFile(join(root, "bundle", "witness"), "utf8"), "preserved");
  const installed = await fixture(); await writeFile(join(installed, "installed.json"), "preserved-installation");
  await assert.rejects(packageLocalRuntime(installed, { existingRoot: true }), /LOCAL_ROOT_ALREADY_INSTALLED/);
  assert.equal(await readFile(join(installed, "installed.json"), "utf8"), "preserved-installation");
  await assert.rejects(access(join(installed, "bundle")));
});
test("default packaging refuses an existing root and preserves its contents", async () => {
  const root = await fixture(); await writeFile(join(root, "witness"), "existing");
  await assert.rejects(packageLocalRuntime(root), { code: "EEXIST" });
  assert.equal(await readFile(join(root, "witness"), "utf8"), "existing");
});
test("requested architecture must match engine inspection before image export", { skip: process.platform === "win32" }, async () => {
  // Synthetic subprocess tests the packaging boundary; this is not an actual Engine proof.
  const parent = await fixture(), engine = join(parent, "docker"), calls = join(parent, "calls.jsonl");
  await writeFile(engine, `#!${process.execPath}
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2); appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + "\\n");
if (args[0] === "image" && args[3] === "{{.Id}}") console.log("sha256:" + "a".repeat(64));
else if (args[0] === "image") console.log(JSON.stringify({Os:"linux",Architecture:"arm64"}));
`, { mode: 0o700 });
  await assert.rejects(packageLocalRuntime(join(parent, "output"), { engine, targetPlatform: "linux/amd64" }), /LOCAL_IMAGE_PLATFORM_MISMATCH/);
  const invoked = (await readFile(calls, "utf8")).trim().split("\n").filter(Boolean).map(x => JSON.parse(x));
  assert.deepEqual(invoked[0].slice(0,3), ["build", "--platform", "linux/amd64"]);
  assert.equal(invoked.some(args => args[0] === "save"), false);
  await assert.rejects(access(join(parent, "output", "bundle", "manifest.json")));
});
