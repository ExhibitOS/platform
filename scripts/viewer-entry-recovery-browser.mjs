// SPDX-License-Identifier: AGPL-3.0-or-later
// Targeted production-static regression, using only the public synthetic demo.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { exportStaticStudioDemo } from "./export-static-publication.mjs";

const [runtimeArgument, evidenceArgument] = process.argv.slice(2);
assert(runtimeArgument && evidenceArgument, "Usage: viewer-entry-recovery-browser.mjs DIST_STATIC NEW_EVIDENCE_DIR");
const evidence = resolve(evidenceArgument);
await mkdir(evidence, { mode: 0o700 }); // Existing evidence is never replaced.
const output = join(evidence, "site");
await exportStaticStudioDemo({ runtimeRoot: resolve(runtimeArgument), output });
const viewerChunks = (await readdir(join(output, "assets"))).filter(name => /^Viewer-.*\.js$/.test(name));
assert.equal(viewerChunks.length, 1, "Require one actual lazy Viewer chunk");
const viewerPath = "/assets/" + viewerChunks[0];
const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm" };
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://local").pathname;
    assert(request.method === "GET" && !pathname.startsWith("/api/"));
    const path = resolve(output, "." + (pathname === "/" ? "/index.html" : pathname));
    assert(path.startsWith(output + "/"));
    const metadata = await lstat(path);
    assert(metadata.isFile() && !metadata.isSymbolicLink());
    response.setHeader("content-type", mime[extname(path)] ?? "application/octet-stream");
    response.end(await readFile(path));
  } catch { response.writeHead(404).end(); }
});
let browser, context;
const checks = [], requests = [], pageErrors = [];
let functionalResult, primaryError;
const cleanup = {};
try {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on("request", request => requests.push(request.url()));
  page.on("pageerror", error => pageErrors.push(error.message));
  let blocked = 0;
  const blockViewer = route => { blocked++; return route.abort("failed"); };
  await page.route(origin + viewerPath, blockViewer);
  await page.goto(origin);
  const list = page.getByRole("region", { name: "작품 목록형 대체 보기", exact: true });
  const title = page.getByRole("heading", { level: 1 });
  await expect(list).toBeVisible();
  const originalTitle = await title.innerText();
  assert(!requests.some(url => new URL(url).pathname === viewerPath), "No 3D module before opt-in");
  assert(!requests.some(url => /\/data\/.*\.bin$/.test(url)), "No media before opt-in");
  await page.getByRole("button", { name: "관람 시작", exact: true }).click();
  const failure = page.getByRole("region", { name: "3D 관람 오류", exact: true });
  await expect(failure.getByRole("alert")).toContainText("작품 목록과 설명은 계속");
  const returnButton = failure.getByRole("button", { name: "작품 목록으로 돌아가기", exact: true });
  await expect(returnButton).toBeFocused();
  assert.equal(blocked, 1, "The actual Viewer import failed once; no automatic retry");
  await expect(title).toHaveText(originalTitle);
  await expect(list).toBeVisible();
  checks.push("Rejected lazy Viewer import preserves publication title/list and focuses explicit fallback action");
  const opener = list.getByRole("button", { name: /상세 보기$/ }).first();
  await opener.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { level: 2 })).toBeVisible();
  await expect(dialog.getByText("실제 치수 (너비 × 높이 × 깊이)", { exact: true })).toBeVisible();
  await expect(dialog.locator("canvas")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  assert.equal(blocked, 1);
  await returnButton.click();
  const reload = page.getByRole("button", { name: "3D 다시 시도 · 페이지 새로고침", exact: true });
  await expect(reload).toBeFocused();
  await expect(failure).toHaveCount(0);
  checks.push("Detail stays text-only even before mode return; Escape restores its opener, and explicit text return restores entry focus");
  await page.unroute(origin + viewerPath, blockViewer);
  await reload.click();
  await expect(page.getByRole("button", { name: "관람 시작", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "관람 시작", exact: true }).click();
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("region", { name: "3D 관람 오류", exact: true })).toHaveCount(0);
  checks.push("Explicit page reload clears rejected lazy module state; a later user entry loads real 3D");
  await context.close();
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const delayedPage = await context.newPage();
  delayedPage.on("request", request => requests.push(request.url()));
  delayedPage.on("pageerror", error => pageErrors.push(error.message));
  let delayedRoute;
  await delayedPage.route(origin + viewerPath, route => { delayedRoute = route; });
  await delayedPage.goto(origin);
  await delayedPage.getByRole("button", { name: "관람 시작", exact: true }).click();
  await expect.poll(() => delayedRoute !== undefined).toBe(true);
  const delayedOpener = delayedPage.getByRole("region", { name: "작품 목록형 대체 보기", exact: true }).getByRole("button", { name: /상세 보기$/ }).first();
  await delayedOpener.click();
  const delayedDialog = delayedPage.getByRole("dialog");
  const dialogClose = delayedDialog.getByRole("button", { name: "전시로 돌아가기", exact: true });
  await expect(dialogClose).toBeFocused();
  await delayedRoute.abort("failed");
  await expect(delayedPage.locator('section[aria-label="3D 관람 오류"]')).toBeVisible();
  await expect(dialogClose).toBeFocused();
  await expect(delayedDialog.locator("canvas")).toHaveCount(0);
  await expect(delayedDialog.getByText("글·목록 관람에서는 음성을 요청하지 않습니다. 아래 대본으로 같은 설명을 읽을 수 있습니다.", { exact: true })).toBeVisible();
  await delayedPage.keyboard.press("Escape");
  await expect(delayedDialog).toHaveCount(0);
  await expect(delayedOpener).toBeFocused();
  checks.push("Delayed module rejection preserves an already-open detail dialog focus, switches to text-only preview and Escape restores its opener");
  assert(requests.every(url => url.startsWith(origin + "/")), "No external request");
  assert(!requests.some(url => new URL(url).pathname.startsWith("/api/")), "No API required for static recovery");
  assert.deepEqual(pageErrors, [], "Boundary prevents an uncaught React/root error");
  functionalResult = { browser: browser.version(), checks, blockedImports: blocked, uncaughtPageErrors: pageErrors, noApiOrExternalRequests: true };
} catch (error) {
  primaryError = error;
} finally {
  async function closeOwned(name, action, closed) {
    const entry = { status: "fulfilled", closed: false };
    try {
      await action();
    } catch (error) {
      entry.status = "rejected";
      entry.errorName = String(error?.name ?? "Error").slice(0, 80);
    }
    try { entry.closed = closed(); }
    catch (error) { entry.status = "rejected"; entry.proofErrorName = String(error?.name ?? "Error").slice(0, 80); }
    cleanup[name] = entry;
  }
  // Always attempt the next resource, even when an earlier close fails.
  await closeOwned("context", async () => { await context?.close(); }, () => !context || !browser.contexts().includes(context));
  await closeOwned("browser", async () => { await browser?.close(); }, () => !browser || !browser.isConnected());
  await closeOwned("server", async () => { if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }, () => !server.listening);
}
const cleanupComplete = Object.values(cleanup).every(result => result.status === "fulfilled" && result.closed);
const passed = !primaryError && functionalResult !== undefined && cleanupComplete;
const result = { state: passed ? "PASS_TARGETED_STATIC_VIEWER_ENTRY_RECOVERY" : "FAIL_TARGETED_STATIC_VIEWER_ENTRY_RECOVERY", ...functionalResult, checks, functionalChecksComplete: functionalResult !== undefined, primaryErrorName: primaryError ? String(primaryError?.name ?? "Error").slice(0, 80) : null, cleanup, browserConnectedAfterCleanup: browser?.isConnected() ?? false, serverListeningAfterCleanup: server.listening, actualSupportedDeviceOrHumanGUIAcceptance: false };
try {
  await writeFile(join(evidence, "result.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
} catch (error) { throw primaryError ?? error; }
console.log(JSON.stringify({ state: result.state, checks, cleanup, browserConnectedAfterCleanup: result.browserConnectedAfterCleanup, serverListeningAfterCleanup: result.serverListeningAfterCleanup, evidence, actualSupportedDeviceOrHumanGUIAcceptance: false }));
if (primaryError) throw primaryError;
assert(passed, "Owned cleanup incomplete; see per-resource status in result.json");
