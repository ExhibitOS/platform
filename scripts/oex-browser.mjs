// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";
import { sha256 } from "../packages/storage/dist/index.js";
import { validateOex } from "@exhibitos/spec";

export async function runOexBrowser({ origin, tenantId, subject, password, other, archive, work, publicationCount }) {
  const browser = await chromium.launch(), directory = await mkdtemp(`${tmpdir()}/exhibitos-oex-browser-`), checks = [], page = await browser.newPage();
  const authoringWrites = [];
  page.on("request", request => { if (["POST", "PUT"].includes(request.method()) && /\/studio\/exhibitions(?:\/[^/]+)?$/.test(new URL(request.url()).pathname)) {
    const body = request.postDataJSON(); authoringWrites.push({ method: request.method(), path: new URL(request.url()).pathname, draftId: body.draft?.id, title: body.draft?.candidate?.title });
  } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  let importedJobId;
  const jobRow = () => page.locator("li").filter({ hasText: `작업 ${importedJobId} ·` });
  const openImported = () => jobRow().getByRole("button", { name: "가져온 전시 열기", exact: true });
  const button = name => page.getByRole("button", { name, exact: true });
  const check = async (title, fn) => { await fn(); checks.push(title); console.log(`PASS ${title}`); };
  try {
    await page.goto(`${origin}/cms`);
    await page.getByLabel("기관 ID", { exact: true }).fill(tenantId);
    await page.getByLabel("계정", { exact: true }).fill(subject);
    await page.getByLabel("비밀번호", { exact: true }).fill(password);
    await button("로그인").click();
    await expect(button("로그아웃")).toBeVisible();
    await page.goto(`${origin}/studio`); await button("새 로컬 전시").click();
    await expect(page.getByLabel("전시 제목", { exact: true })).toBeVisible();
    await button("현재 서버 계정 확인").click();
    await expect(page.getByRole("status", { name: "전시 편집 상태" })).toContainText("현재 서버 계정을 확인했습니다");
    const before = await publicationCount();
    await check("actual Studio file upload and explicit worker completion create a new private editable local copy", async () => {
      await page.getByLabel("OEX 가져오기 파일").setInputFiles({ name: "original-synthetic.oex", mimeType: "application/zip", buffer: archive });
      const created = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/oex/imports"));
      await button("파일 전달·가져오기 시작").click();
      importedJobId = (await (await created).json()).id;
      await expect(page.getByRole("status", { name: "OEX 처리 상태" })).toContainText("파일을 전달했습니다");
      await work(); await button("가져오기 상태 새로고침").click();
      await expect(jobRow()).toContainText("complete");
      await openImported().click();
      await expect(page.getByLabel("전시 제목", { exact: true })).toHaveValue("Synthetic OEX preservation exhibition");
      assert.equal(await publicationCount(), before);
      await expect(button("OEX 내보내기")).toBeEnabled();
    });
    await check("actual Studio download is a valid self-contained OEX archive", async () => {
      const downloadPromise = page.waitForEvent("download"); await button("OEX 내보내기").click();
      const download = await downloadPromise, filename = await download.path(), bytes = await readFile(filename);
      assert.match(download.suggestedFilename(), /^exhibition-.*\.oex$/);
      assert.equal((await validateOex(bytes)).valid, true, JSON.stringify(await validateOex(bytes)));
      await writeFile(`${directory}/download-summary.json`, JSON.stringify({ bytes: bytes.length, sha256: sha256(bytes) }) + "\n");
    });
    await check("unsaved title edits prevent export and imported-record opening without discarding local input", async () => {
      await page.getByLabel("전시 제목", { exact: true }).fill("Unsaved synthetic OEX title");
      await expect(button("OEX 내보내기")).toBeDisabled();
      await expect(openImported()).toBeDisabled();
      await expect(page.getByLabel("전시 제목", { exact: true })).toHaveValue("Unsaved synthetic OEX title");
      assert.equal(await publicationCount(), before);
    });
    await check("imported draft stays private through editing and server save; publication requires explicit READY and publish clicks", async () => {
      await expect(button("기록된 ETag로 서버 저장")).toBeEnabled();
      const savedResponse = page.waitForResponse(response => response.request().method() === "PUT" && /\/studio\/exhibitions\/[^/]+$/.test(new URL(response.url()).pathname));
      await button("기록된 ETag로 서버 저장").click();
      const response = await savedResponse; assert.equal(response.status(), 200);
      assert.equal((await response.json()).draft.candidate.title, "Unsaved synthetic OEX title");
      await expect(page.getByRole("status", { name: "전시 편집 상태" })).toContainText("서버 revision");
      assert.equal(await publicationCount(), before);
      await openImported().click();
      await expect(page.getByRole("status", { name: "OEX 처리 상태" })).toContainText("가져온 전시");
      await expect(page.getByLabel("전시 제목", { exact: true })).toHaveValue("Unsaved synthetic OEX title");
      await button("서버 revision READY 검사").click();
      await expect(page.getByTestId("ready-state")).toHaveText("READY");
      assert.equal(await publicationCount(), before);
      await button("READY revision 공개").click();
      await expect(page.getByTestId("publication-status")).toContainText("immutable Publication으로 공개했습니다");
      assert.equal(await publicationCount(), before + 1);
      const path = await page.getByRole("link", { name: "익명 공개 preview 열기", exact: true }).first().getAttribute("href");
      const anonymous = await browser.newContext(), preview = await anonymous.newPage();
      try {
        await preview.goto(new URL(path, origin).href);
        await expect(preview.getByRole("heading", { name: "Unsaved synthetic OEX title", exact: true })).toBeVisible();
        await expect(preview.getByRole("button", { name: "Original OEX sculpture 상세 보기", exact: true })).toBeVisible();
        await preview.getByRole("button", { name: "Original OEX sculpture 상세 보기", exact: true }).click();
        await expect(preview.getByRole("dialog")).toContainText("Original synthetic artist voice transcript");
        assert.deepEqual(await anonymous.cookies(), []);
      } finally { await anonymous.close(); }
    });
    await check("real A to B to A session changes discard a delayed prior-account job response without opening another local record", async () => {
      let releaseResponse, sawResponse;
      const release = new Promise(resolve => { releaseResponse = resolve; });
      const saw = new Promise(resolve => { sawResponse = resolve; });
      await page.route("**/oex/imports/*", async route => {
        if (route.request().method() !== "GET") return route.continue();
        const response = await route.fetch(); assert.equal(response.status(), 200); sawResponse(); await release; await route.fulfill({ response });
      });
      try {
        await openImported().click(); await saw;
        const switchSession = async (nextTenant, nextSubject) => {
          const response = await page.context().request.post(`${origin}/api/v1/auth/login`, { headers: { origin }, data: { tenantId: nextTenant, subject: nextSubject, password } });
          assert.equal(response.status(), 200);
          const sessionResponse = await page.context().request.get(`${origin}/api/v1/auth/session`); assert.equal(sessionResponse.status(), 200);
          const nextSession = await sessionResponse.json(); await button("현재 서버 계정 확인").click();
          await expect(page.getByRole("status", { name: "전시 편집 상태" })).toContainText("현재 서버 계정을 확인했습니다");
          await expect(page.getByText(`기관 ${nextTenant} · 사용자 ${nextSession.userId} · 역할 ${nextSession.role}`, { exact: true })).toBeVisible();
        };
        await switchSession(other.tenantId, other.subject); await switchSession(tenantId, subject);
        await button("새 로컬 전시").click();
        const selectedTitle = await page.getByLabel("전시 제목", { exact: true }).inputValue();
        const finished = page.waitForResponse(response => response.request().method() === "GET" && /\/oex\/imports\/[^/]+$/.test(new URL(response.url()).pathname));
        releaseResponse(); await finished;
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await expect(page.getByLabel("전시 제목", { exact: true })).toHaveValue(selectedTitle);
        assert.notEqual(selectedTitle, "Unsaved synthetic OEX title");
      } finally { releaseResponse(); await page.unroute("**/oex/imports/*"); }
    });
    assert.deepEqual(errors, []);
    const report = { checks, browser: browser.version(), checkedAt: new Date().toISOString(), limits: ["Synthetic local fixture only; import never automatically publishes. No physical device qualification."] };
    await writeFile(`${directory}/oex-browser.json`, JSON.stringify(report, null, 2) + "\n");
    return { ...report, reportPath: `${directory}/oex-browser.json` };
  } catch (error) {
    await page.screenshot({ path: `${directory}/failure.png` }).catch(() => {});
    const selected = await page.getByTestId("draft-id").textContent().catch(() => null), visibleTitle = await page.getByLabel("전시 제목", { exact: true }).inputValue().catch(() => null);
    await writeFile(`${directory}/failure.json`, JSON.stringify({ error: String(error), errors, checks, authoringWrites, selected, visibleTitle, importedJobId }) + "\n");
    console.error(`OEX browser failure evidence: ${directory}`); throw error;
  } finally { await browser.close(); }
}
