// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const licensePath = "vendor/notices/ltc-LICENSE.txt";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const source = await readFile(new URL(`../${licensePath}`, import.meta.url));
const expected = JSON.parse(await readFile(new URL("../vendor/notices/ltc-provenance.json", import.meta.url), "utf8")).sha256;
const attributes = await readFile(new URL("../.gitattributes", import.meta.url), "utf8");

async function checkoutWithAutocrlf(attrs) {
  // Real Git checkout with Windows-style conversion enabled, in a new synthetic repository.
  const root = await mkdtemp(join(tmpdir(), "exhibitos-license-checkout-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  git("init", "--quiet");
  git("config", "core.autocrlf", "false");
  git("config", "core.eol", "crlf");
  await mkdir(join(root, "vendor/notices"), { recursive: true });
  await writeFile(join(root, ".gitattributes"), attrs);
  await writeFile(join(root, licensePath), source);
  git("add", "--", ".gitattributes", licensePath);
  // checkout-index does not require a commit, credentials, hooks, or network.
  git("config", "core.autocrlf", "true");
  await unlink(join(root, licensePath));
  git("checkout-index", "--", licensePath);
  return readFile(join(root, licensePath));
}

test("historical auto-text checkout reproduces LTC license hash failure", async () => {
  const historical = attributes.replace(/^\/vendor\/notices\/ltc-LICENSE\.txt -text\r?\n/gm, "");
  const checked = await checkoutWithAutocrlf(historical);
  assert.notEqual(hash(checked), expected);
  assert.ok(checked.includes(Buffer.from("\r\n")));
  assert.equal(hash(source), expected);
});

test("hash-bound license checkout preserves exact provenance bytes under autocrlf", async () => {
  const checked = await checkoutWithAutocrlf(attributes);
  assert.deepEqual(checked, source);
  assert.equal(hash(checked), expected);
  const altered = Buffer.concat([checked, Buffer.from("altered")]);
  assert.notEqual(hash(altered), expected);
});
