// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";
import { verifyFreezeBundle } from "@exhibitos/studio-contract";

export async function runStudioFreezeBrowser({ origin, tenantId, subject, password, archive, keyId, workImport, publicationCount }) {
  const browser = await chromium.launch(), page = await browser.newPage(), checks = [], errors = [];
  const directory = await mkdtemp(`${tmpdir()}/exhibitos-freeze-studio-`);
  page.on("pageerror", error => errors.push(error.message));
  const button = name => page.getByRole("button", { name, exact: true });
  const check = async (title, fn) => { await fn(); checks.push(title); console.log(`PASS ${title}`); };
  try {
    const response = await page.context().request.post(`${origin}/api/v1/auth/login`, { headers: { origin }, data: { tenantId, subject, password } }); assert.equal(response.status(), 200);
    await page.goto(`${origin}/studio`); await button("새 로컬 전시").click(); await button("현재 서버 계정 확인").click();
    await expect(page.getByRole("status", { name: "전시 편집 상태" })).toContainText("현재 서버 계정을 확인했습니다");
    await page.getByLabel("OEX 가져오기 파일").setInputFiles({ name: "synthetic.oex", mimeType: "application/zip", buffer: archive });
    const jobResponse = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/oex/imports"));
    await button("파일 전달·가져오기 시작").click(); const jobId = (await (await jobResponse).json()).id;
    await expect(page.getByRole("status", { name: "OEX 처리 상태" })).toContainText("파일을 전달했습니다");
    await workImport(); await button("가져오기 상태 새로고침").click();
    const jobRow = page.locator("li").filter({ hasText: `작업 ${jobId} ·` }); await expect(jobRow).toContainText("complete");
    await jobRow.getByRole("button", { name: "가져온 전시 열기", exact: true }).click();
    await expect(page.getByLabel("전시 제목", { exact: true })).toHaveValue("Synthetic OEX preservation exhibition");
    const baseline = await publicationCount(), panel = page.getByRole("region", { name: "전시 버전 고정", exact: true });
    await check("actual Studio freezes the exact saved revision and downloads a verified signed package without publishing", async () => {
      const created = page.waitForResponse(response => response.request().method() === "POST" && /\/freezes$/.test(new URL(response.url()).pathname));
      await button("저장본을 새 고정 버전으로 보존").click(); const response = await created; assert.equal(response.status(), 201);
      const summary = await response.json();
      await expect(panel.getByRole("status")).toContainText("새 고정 버전으로 보존했습니다");
      const downloadEvent = page.waitForEvent("download"); await button("오프라인 사본 다운로드").click(); const download = await downloadEvent;
      assert.equal(download.suggestedFilename(), `${summary.id}.oef`);
      const bytes = await readFile(await download.path()), verified = await verifyFreezeBundle(bytes, { trustedKeys: [keyId] });
      assert.equal(verified.bundle.manifest.id, summary.id); assert.deepEqual(verified.bundle.manifest, summary.manifest);
      assert.equal(await publicationCount(), baseline); await writeFile(`${directory}/download.oef`, bytes);
    });
    await check("actual Studio displays fixed revision comparison and unsaved edits disable creating another freeze", async () => {
      await button("현재 저장본과 비교").click(); await expect(panel.getByRole("status")).toContainText("고정본과 같음");
      await page.getByLabel("전시 제목", { exact: true }).fill("Unsaved freeze edit must stay local");
      await expect(button("저장본을 새 고정 버전으로 보존")).toBeDisabled();
      await expect(page.getByLabel("전시 제목", { exact: true })).toHaveValue("Unsaved freeze edit must stay local");
      assert.equal(await publicationCount(), baseline);
    });
    assert.deepEqual(errors, []);
    const report = { checks, browser: browser.version(), checkedAt: new Date().toISOString() }; await writeFile(`${directory}/freeze-studio.json`, JSON.stringify(report, null, 2) + "\n"); return { ...report, reportPath: `${directory}/freeze-studio.json` };
  } catch (error) {
    await page.screenshot({ path: `${directory}/failure.png` }).catch(() => {});
    await writeFile(`${directory}/failure.json`, JSON.stringify({ error: String(error), checks, errors }, null, 2)); console.error(`Freeze Studio failure evidence: ${directory}`); throw error;
  } finally { await browser.close(); }
}

async function stored(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open("exhibitos-verified-freezes-v1", 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const records = await new Promise((resolve, reject) => { const request = db.transaction("records").objectStore("records").getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      return Promise.all(records.map(async record => ({ key: record.key, title: record.title, sha256: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", record.bytes))).map(value => value.toString(16).padStart(2, "0")).join("") })));
    } finally { db.close(); }
  });
}

/** Real production UI and verified byte-provider; no intercepted successful HTTP responses. */
export async function runFreezeBrowser({ origin, tenantId, subject, password, bundle, revoke, restore, otherSubject }) {
  const browser = await chromium.launch(), context = await browser.newContext({ viewport: { width: 1200, height: 900 } }), page = await context.newPage();
  const directory = await mkdtemp(`${tmpdir()}/exhibitos-freeze-browser-`), checks = [], assetRequests = [], errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (/\/api\/v1\/publications\/[^/]+\/assets\//.test(new URL(request.url()).pathname)) assetRequests.push(request.url()); });
  const button = name => page.getByRole("button", { name, exact: true });
  const status = () => page.getByRole("region", { name: "고정 전시·오프라인", exact: true }).getByRole("status").first();
  const upload = async value => page.getByLabel("오프라인 전시 파일", { exact: true }).setInputFiles({ name: "synthetic.oef", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) });
  const check = async (title, fn) => { await fn(); checks.push(title); console.log(`PASS ${title}`); };
  let revoked = false;
  try {
    const login = await context.request.post(`${origin}/api/v1/auth/login`, { headers: { origin }, data: { tenantId, subject, password } }); assert.equal(login.status(), 200);
    await page.goto(`${origin}/offline`);
    await check("actual offline UI prepares account-pinned key and atomically stores a fully verified synthetic freeze", async () => {
      await button("표시 계정 및 신뢰 키 준비").click(); await expect(status()).toContainText("계정과 신뢰할 서명 키를 준비했습니다");
      await upload(bundle); await expect(status()).toContainText("별도 사본으로 저장했습니다");
      assert.equal((await stored(page)).length, 1);
      await expect(button("고정 전시 열기")).toHaveCount(1);
    });
    await check("actual malformed or duplicate file import never overwrites the earlier verified IndexedDB record", async () => {
      const baseline = await stored(page);
      for (const mutate of [value => { value.signature = Buffer.alloc(64).toString("base64"); }, value => { value.runtimeFiles.pop(); }, value => { value.schemaVersion = "9.0.0"; }, () => {}]) {
        const invalid = structuredClone(bundle); mutate(invalid); await upload(invalid);
        await expect(status()).toContainText("기존 사본은 유지합니다"); assert.deepEqual(await stored(page), baseline);
      }
    });
    await check("actual disconnected reload uses retained shell and GLB PNG PCM byte-provider with no publication asset HTTP calls", async () => {
      await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 15000 }).toBe(true);
      const cached = await page.evaluate(async () => { const urls = []; for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) urls.push(new URL(request.url).pathname); return urls; });
      assert(cached.includes("/offline")); assert(cached.includes("/freeze-runtime.json")); assert(cached.every(path => !path.startsWith("/api/")));
      await context.setOffline(true); await page.reload();
      await expect(button("고정 전시 열기")).toBeVisible(); await button("고정 전시 열기").click();
      await expect(status()).toContainText("고정 전시를 열었습니다");
      const title = "Synthetic OEX preservation exhibition";
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await button("Original OEX sculpture 상세 보기").click(); await expect(page.getByRole("dialog")).toContainText("Original synthetic artist voice transcript");
      await page.keyboard.press("Escape"); await button("3D 관람 시작").click();
      await expect(page.getByTestId("audio-state")).toBeVisible();
      for (const title of ["Original OEX sculpture", "Original OEX image"]) {
        await button(`${title} 상세 보기`).click(); await expect(page.getByRole("dialog").locator("canvas")).toHaveCount(1, { timeout: 30000 }); await page.keyboard.press("Escape");
      }
      const canvas = page.getByRole("region", { name: "전시 Viewer", exact: true }).locator("canvas").first();
      const nav = () => canvas.evaluate(value => JSON.parse(value.dataset.navigationState ?? "null"));
      await button("걷기 시작").click(); await expect.poll(async () => (await nav())?.paused).toBe(false);
      const before = await nav(); await page.keyboard.down("ArrowUp"); await page.waitForTimeout(300); await page.keyboard.up("ArrowUp");
      await expect.poll(async () => (await nav())?.eyePosition).not.toEqual(before.eyePosition); await page.keyboard.press("Escape");
      await button("소리 켜기").click();
      const audio = () => page.getByTestId("audio-state").evaluate(value => JSON.parse(value.dataset.audioState));
      await expect.poll(async () => (await audio()).loaded).toBeGreaterThan(0); assert((await audio()).decodedBytes > 0);
      assert.deepEqual(assetRequests, []);
    });
    await check("disconnected revocation is bounded by existing grant and actual reconnect denial closes renderer and audio", async () => {
      await revoke(); revoked = true;
      await expect(button("오프라인 관람 닫기")).toBeVisible();
      await context.setOffline(false);
      await expect(button("오프라인 관람 닫기")).toHaveCount(0, { timeout: 15000 });
      await expect(page.getByTestId("audio-state")).toHaveCount(0);
      await expect(status()).toContainText("관람을 중단했습니다");
      assert.equal((await stored(page)).length, 1);
      await restore(); revoked = false;
    });
    await check("actual persistent clock rollback rejects opening and reload while retaining the earlier verified bytes", async () => {
      await button("표시 계정 및 신뢰 키 준비").click(); await expect(status()).toContainText("계정과 신뢰할 서명 키를 준비했습니다");
      const baseline = await stored(page);
      const high = await page.evaluate(() => new Promise((resolve, reject) => {
        const request = indexedDB.open("exhibitos-verified-freezes-v1", 1); request.onerror = () => reject(request.error); request.onsuccess = () => {
          const db = request.result, get = db.transaction("control").objectStore("control").get("maxObservedTime"); get.onsuccess = () => { db.close(); resolve(get.result); }; get.onerror = () => { db.close(); reject(get.error); };
        };
      }));
      assert(high - 1000 > Date.parse(bundle.authorization.grant.issuedAt));
      await page.clock.setSystemTime(new Date(high - 1000));
      try {
        await context.setOffline(true); await button("고정 전시 열기").click(); await expect(status()).toContainText("전시를 열지 않았습니다");
        await expect(button("오프라인 관람 닫기")).toHaveCount(0); assert.deepEqual(await stored(page), baseline);
        await page.reload(); await expect(button("고정 전시 열기")).toBeVisible(); await button("고정 전시 열기").click();
        await expect(status()).toContainText("전시를 열지 않았습니다"); await expect(button("오프라인 관람 닫기")).toHaveCount(0); assert.deepEqual(await stored(page), baseline);
      } finally { await page.clock.setSystemTime(new Date()); await context.setOffline(false); }
    });
    await check("real cross-tab logout and A to B to A login discard a delayed prepare authority response without restoring stale profile", async () => {
      const baseline = await stored(page); let release, saw;
      const held = new Promise(resolve => { release = resolve; }), observed = new Promise(resolve => { saw = resolve; });
      await page.route("**/api/v1/freeze/authority", async route => { const response = await route.fetch(); assert.equal(response.status(), 200); saw(); await held; await route.fulfill({ response }); });
      const cms = await context.newPage();
      try {
        await button("표시 계정 및 신뢰 키 준비").click(); await observed;
        await cms.goto(`${origin}/cms`); await expect(cms.getByRole("button", { name: "로그아웃", exact: true })).toBeVisible();
        const logout = async () => { await cms.getByRole("button", { name: "로그아웃", exact: true }).click(); await expect(cms.getByRole("button", { name: "로그인", exact: true })).toBeVisible(); };
        const login = async account => {
          await cms.getByLabel("기관 ID", { exact: true }).fill(tenantId); await cms.getByLabel("계정", { exact: true }).fill(account); await cms.getByLabel("비밀번호", { exact: true }).fill(password);
          await cms.getByRole("button", { name: "로그인", exact: true }).click(); await expect(cms.getByRole("button", { name: "로그아웃", exact: true })).toBeVisible();
        };
        await logout(); await login(otherSubject); await logout(); await login(subject);
        await expect(status()).toContainText("새 계정을 명시적으로 준비하세요");
        const delivered = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/freeze/authority"); release(); await delivered;
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await expect(page.getByLabel("오프라인 전시 파일", { exact: true })).toBeDisabled(); await expect(button("고정 전시 열기")).toHaveCount(0);
        assert.deepEqual(await stored(page), baseline);
      } finally { release(); await page.unroute("**/api/v1/freeze/authority"); await cms.close(); }
    });
    assert.deepEqual(errors, []);
    const report = { checks, browser: browser.version(), assetRequests, checkedAt: new Date().toISOString(), limits: ["Production Chromium and native Web Audio decoding on synthetic data; physical speaker/device and mobile qualification excluded."] };
    await writeFile(`${directory}/freeze-browser.json`, JSON.stringify(report, null, 2) + "\n"); return { ...report, reportPath: `${directory}/freeze-browser.json` };
  } catch (error) {
    await page.screenshot({ path: `${directory}/failure.png` }).catch(() => {});
    await writeFile(`${directory}/failure.json`, JSON.stringify({ error: String(error), checks, errors, assetRequests, status: await page.getByRole("status").allTextContents().catch(() => []) }, null, 2));
    console.error(`Freeze browser failure evidence: ${directory}`); throw error;
  } finally { if (revoked) await restore().catch(() => {}); await browser.close(); }
}
