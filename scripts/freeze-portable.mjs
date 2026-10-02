// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";
import { sha256 } from "../packages/storage/dist/index.js";

async function start(runtimeServer, file, keyId) {
  const child = spawn(process.execPath, [runtimeServer, file, "--trust-key", keyId, "--port", "0"], { cwd: tmpdir(), stdio: ["ignore", "pipe", "pipe"] });
  let output = "", errors = ""; child.stderr.on("data", part => { errors += part.toString(); });
  const exited = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(Error(`Portable fixture did not start: ${errors}`)); }, 15000);
    child.stdout.on("data", part => { output += part.toString(); const match = output.match(/ExhibitOS offline (http:\/\/127\.0\.0\.1:\d+)\/offline/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.once("exit", code => { clearTimeout(timer); reject(Error(`Portable fixture exited ${code}: ${errors}`)); });
  });
  try { return { origin: await ready, stop: async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM"); await exited; } }; }
  catch (error) { if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM"); await exited; throw error; }
}

/** A fresh working directory reconstructs only the retained runtime with an explicit operator trust fingerprint. */
export async function runPortableFreeze({ bundle, shortBundle }) {
  const directory = await mkdtemp(`${tmpdir()}/exhibitos-freeze-portable-`), file = `${directory}/synthetic.oef`, checks = [];
  const check = async (title, fn) => { await fn(); checks.push(title); console.log(`PASS ${title}`); };
  await writeFile(file, JSON.stringify(bundle));
  const runtimeServer = `${directory}/retained-offline-server.mjs`, included = bundle.runtimeFiles.find(value => value.path === "offline-server.mjs"); assert(included);
  const serverBytes = Buffer.from(included.data, "base64");
  assert.equal(sha256(serverBytes), bundle.manifest.runtime.files.find(value => value.path === included.path).sha256);
  await writeFile(runtimeServer, serverBytes);
  await check("portable launch rejects an operator fingerprint that does not trust the embedded signing key", async () => {
    await assert.rejects(start(runtimeServer, file, "0".repeat(64)), /exited/);
  });
  const server = await start(runtimeServer, file, bundle.manifest.authority.keyId), browser = await chromium.launch(), page = await browser.newPage();
  const requests = [], errors = []; page.on("pageerror", error => errors.push(error.message)); page.on("request", request => requests.push(request.url()));
  try {
    await check("fresh portable process serves only exact signed runtime files and package without project or API dependencies", async () => {
      const response = await fetch(`${server.origin}/offline-package`); assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), bundle);
      for (const file of bundle.manifest.runtime.files) {
        const response = await fetch(`${server.origin}/${file.path}`); assert.equal(response.status, 200, file.path);
        const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(bytes.length, file.bytes); assert.equal(sha256(bytes), file.sha256);
      }
      assert.equal((await fetch(`${server.origin}/api/v1/auth/session`)).status, 404);
      assert.equal((await fetch(`${server.origin}/assets/unlisted.js`)).status, 404);
    });
    await check("actual retained portable browser runtime prepares displays and decodes synthetic geometry image and audio without external requests", async () => {
      await page.goto(`${server.origin}/offline`);
      await page.getByLabel("운영자가 신뢰 키를 확인한 로컬 오프라인 서버", { exact: true }).check();
      await page.getByRole("button", { name: "표시 계정 및 신뢰 키 준비", exact: true }).click();
      await expect(page.getByRole("button", { name: "로컬 서명 패키지 준비", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: "로컬 서명 패키지 준비", exact: true }).click();
      await expect(page.getByRole("button", { name: "고정 전시 열기", exact: true })).toHaveCount(1);
      await page.getByRole("button", { name: "고정 전시 열기", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Synthetic OEX preservation exhibition", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "3D 관람 시작", exact: true }).click();
      await expect(page.getByTestId("audio-state")).toBeVisible();
      for (const title of ["Original OEX sculpture", "Original OEX image"]) {
        await page.getByRole("button", { name: `${title} 상세 보기`, exact: true }).click(); await expect(page.getByRole("dialog").locator("canvas")).toHaveCount(1, { timeout: 30000 }); await page.keyboard.press("Escape");
      }
      await page.getByRole("button", { name: "소리 켜기", exact: true }).click();
      await expect.poll(() => page.getByTestId("audio-state").evaluate(value => JSON.parse(value.dataset.audioState).loaded)).toBeGreaterThan(0);
      assert(requests.every(url => new URL(url).origin === server.origin));
      assert(!requests.some(url => /\/api\/v1\//.test(new URL(url).pathname)));
      assert.deepEqual(errors, []);
    });
  } finally { await browser.close(); await server.stop(); }
  const expiring = await shortBundle(), shortFile = `${directory}/short-synthetic.oef`; await writeFile(shortFile, JSON.stringify(expiring));
  const shortServer = await start(runtimeServer, shortFile, expiring.manifest.authority.keyId), expiryBrowser = await chromium.launch(), expiryPage = await expiryBrowser.newPage();
  try {
    await check("portable renderer audio and package access stop at the real signed grant deadline as wall-clock time advances", async () => {
      assert.equal((await fetch(`${shortServer.origin}/offline-package`)).status, 200);
      await expiryPage.goto(`${shortServer.origin}/offline`);
      await expiryPage.getByLabel("운영자가 신뢰 키를 확인한 로컬 오프라인 서버", { exact: true }).check();
      await expiryPage.getByRole("button", { name: "표시 계정 및 신뢰 키 준비", exact: true }).click();
      await expect(expiryPage.getByRole("button", { name: "로컬 서명 패키지 준비", exact: true })).toBeEnabled();
      await expiryPage.getByRole("button", { name: "로컬 서명 패키지 준비", exact: true }).click();
      await expect(expiryPage.getByRole("button", { name: "고정 전시 열기", exact: true })).toBeVisible();
      await expiryPage.getByRole("button", { name: "고정 전시 열기", exact: true }).click();
      await expect(expiryPage.getByRole("button", { name: "오프라인 관람 닫기", exact: true })).toBeVisible();
      await expiryPage.getByRole("button", { name: "3D 관람 시작", exact: true }).click(); await expect(expiryPage.getByTestId("audio-state")).toBeVisible();
      await expiryPage.getByRole("button", { name: "소리 켜기", exact: true }).click();
      await expect.poll(() => expiryPage.getByTestId("audio-state").evaluate(value => JSON.parse(value.dataset.audioState).loaded)).toBeGreaterThan(0);
      await expiryPage.getByRole("button", { name: /^공간 소리 재생 / }).click();
      await expect.poll(() => expiryPage.getByTestId("audio-state").evaluate(value => JSON.parse(value.dataset.audioState).active)).toBeGreaterThan(0);
      const remaining = Date.parse(expiring.authorization.grant.expiresAt) - Date.now(); assert(remaining > 0 && remaining < 15000);
      await new Promise(resolve => setTimeout(resolve, remaining + 100));
      await expect(expiryPage.getByRole("button", { name: "오프라인 관람 닫기", exact: true })).toHaveCount(0);
      await expect(expiryPage.getByTestId("audio-state")).toHaveCount(0);
      await expect(expiryPage.getByRole("heading", { name: "Synthetic OEX preservation exhibition", exact: true })).toHaveCount(0);
      assert.equal((await fetch(`${shortServer.origin}/offline-package`)).ok, false);
      assert.equal((await fetch(`${shortServer.origin}/offline-authority`)).ok, false);
    });
  } finally { await expiryBrowser.close(); await shortServer.stop(); }
  const report = { checks, requests, checkedAt: new Date().toISOString(), limits: ["Retained browser runtime only, not OCI or external deployment qualification."] };
  await writeFile(`${directory}/freeze-portable.json`, JSON.stringify(report, null, 2) + "\n"); return { ...report, reportPath: `${directory}/freeze-portable.json` };
}
