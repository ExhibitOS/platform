// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { writeFile, mkdtemp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import { chromium, expect } from "@playwright/test";
export async function runViewerBrowser({
  origin,
  publicationId,
  reportPath = process.env.EXHIBITOS_VIEWER_REPORT ??
    new URL("../docs/performance/viewer-baseline.json", import.meta.url),
}) {
  const browser = await chromium.launch({ headless: true });
  const screenshotDir = await mkdtemp(`${os.tmpdir()}/exhibitos-viewer-`);
  const screenshots = [];
  const samples = [],
    traces = [],
    checks = [];
  const report = {
    source: {
      head: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      dirty: execFileSync("git", ["status", "--short"], {
        encoding: "utf8",
      }).trim(),
    },
    screenshots,
    environment: {
      os: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpu: os.cpus()[0]?.model,
      node: process.version,
      browser: browser.version(),
      network: {
        downloadBytesPerSecond: 1250000,
        uploadBytesPerSecond: 1250000,
        latencyMs: 100,
      },
      memoryMethod:
        "performance.memory JS heap and renderer geometry/texture/buffer estimates; physical tab RSS unverified",
      warmScope:
        "Same anonymous context HTTP app cache. Publication metadata and artwork endpoints remain no-store; no service worker.",
    },
    samples,
    traces,
    checks,
  };
  const state = (page) =>
    page
      .locator("canvas")
      .evaluate((c) => JSON.parse(c.dataset.viewerState || "{}"));
  const gallery = async (page) => {
    for (let i = 0; i < 4; i++) {
      await page
        .getByRole("button", { name: "다음 작품 불러오기", exact: true })
        .click();
      await expect
        .poll(
          async () => {
            const s = await state(page);
            return s.loadedAssets + s.failed;
          },
          { timeout: 60000 },
        )
        .toBe(Math.min(20, 8 + i * 4));
    }
    await expect
      .poll(async () => (await state(page)).loadedPlacements, {
        timeout: 60000,
      })
      .toBe(20);
  };
  try {
    const testContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      serviceWorkers: "block",
    });
    const testPage = await testContext.newPage();
    testPage.setDefaultTimeout(60000);
    const manifest = await (
      await testContext.request.get(
        `${origin}/api/v1/publications/${publicationId}`,
      )
    ).json();
    report.assets = manifest.exhibition.artworks.flatMap((art) =>
      art.assets.map((asset) => ({
        artworkId: art.id,
        ...asset,
        variant: art.extensions?.["org.exhibitos.viewer/lod"]?.variants.find(
          (v) => v.assetId === asset.id,
        ),
      })),
    );
    const pattern = `${origin}/api/v1/publications/${publicationId}/assets/*`;
    for (const fault of ["missing", "corrupt", "network"]) {
      await testPage.route(pattern, async (route) => {
        if (fault === "network") return route.abort("internetdisconnected");
        if (fault === "missing")
          return route.fulfill({ status: 404, body: "" });
        const response = await route.fetch();
        const body = await response.body();
        body[body.length - 1] ^= 1;
        return route.fulfill({ response, body });
      });
      await testPage.goto(`${origin}/p/${publicationId}`);
      await expect
        .poll(async () => (await state(testPage)).failed, { timeout: 60000 })
        .toBe(4);
      assert.equal((await state(testPage)).loadedAssets, 0);
      await expect(
        testPage.getByRole("region", { name: "작품 목록형 대체 보기" }),
      ).toBeVisible();
      await testPage.unroute(pattern);
      await testPage
        .getByRole("button", { name: "실패한 작품 다시 시도", exact: true })
        .click();
      await expect
        .poll(async () => (await state(testPage)).loadedAssets, {
          timeout: 60000,
        })
        .toBe(4);
      checks.push(
        `${fault} response: zero unverified artworks attached; explicit retry recovers four approved entrance assets`,
      );
    }
    const metadataPath = `${origin}/api/v1/publications/${publicationId}`;
    const coarseIds = new Set(
      manifest.exhibition.artworks.flatMap((a) =>
        a.extensions["org.exhibitos.viewer/lod"].variants
          .filter((v) => v.detail === "coarse")
          .map((v) => v.assetId),
      ),
    );
    const fullImageIds = new Set(
      manifest.exhibition.artworks
        .filter((a) => a.artworkType === "image")
        .map((a) => a.primaryAssetId),
    );
    await testPage.route(metadataPath, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      for (const art of body.exhibition.artworks)
        for (const variant of art.extensions["org.exhibitos.viewer/lod"]
          .variants)
          if (variant.detail === "coarse") {
            if (variant.triangles !== undefined) variant.triangles = 1;
            else variant.textureSize = 1;
          }
      await route.fulfill({ response, json: body });
    });
    await testPage.goto(`${origin}/p/${publicationId}`);
    await expect
      .poll(async () => (await state(testPage)).loadedAssets, {
        timeout: 60000,
      })
      .toBe(4);
    for (let i = 0; i < 4; i++) {
      await testPage
        .getByRole("button", { name: "다음 작품 불러오기", exact: true })
        .click();
      await expect
        .poll(
          async () => {
            const s = await state(testPage);
            return s.loadedAssets + s.failed;
          },
          { timeout: 60000 },
        )
        .toBe(Math.min(20, 8 + i * 4));
    }
    const underclaimed = await state(testPage);
    assert(underclaimed.assetIds.every((id) => !coarseIds.has(id)));
    assert(underclaimed.assetIds.some((id) => fullImageIds.has(id)));
    assert(underclaimed.budgetTotalBytes <= underclaimed.cache.maxBytes);
    checks.push(
      "injected underclaimed geometry and PNG manifest with unchanged valid byte hashes rejects coarse decode, falls back only to qualified full within device budget",
    );
    await testPage.unroute(metadataPath);
    await testPage.goto(`${origin}/p/${publicationId}`);
    await expect.poll(async () => (await state(testPage)).loadedAssets).toBe(4);
    await testPage.route(pattern, async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue().catch(() => {});
    });
    await testPage
      .getByRole("button", { name: "다음 작품 불러오기", exact: true })
      .click();
    await testPage
      .getByRole("button", { name: "작품 불러오기 취소", exact: true })
      .click();
    await expect
      .poll(async () => {
        const s = await state(testPage);
        return s.scheduler.active + s.scheduler.queued;
      })
      .toBe(0);
    await testPage.unroute(pattern);
    await testPage
      .getByRole("button", { name: "실패한 작품 다시 시도", exact: true })
      .click();
    await expect.poll(async () => (await state(testPage)).loadedAssets).toBe(8);
    await testPage.evaluate(
      () => (window.oldViewerCanvas = document.querySelector("canvas")),
    );
    await testPage
      .locator("canvas")
      .evaluate((c) =>
        c.dispatchEvent(new Event("webglcontextlost", { cancelable: true })),
      );
    await expect(
      testPage.getByRole("button", { name: "시점 왼쪽 회전", exact: true }),
    ).toBeDisabled();
    await expect(
      testPage.getByRole("region", { name: "작품 목록형 대체 보기" }),
    ).toBeVisible();
    await testPage
      .getByRole("button", { name: "3D 다시 시작", exact: true })
      .click();
    await expect
      .poll(async () =>
        testPage.evaluate(() => window.oldViewerCanvas.dataset.disposed),
      )
      .toBe("true");
    await expect.poll(async () => (await state(testPage)).loadedAssets).toBe(4);
    checks.push(
      "cancel/retry and context-loss event preserve keyboard/list alternative; replaced renderer disposes resources",
    );
    await testContext.close();
    if (process.env.EXHIBITOS_VIEWER_SKIP_MEASUREMENT === "1")
      return { checks, reportPath: String(reportPath), summary: {} };
    for (const profile of [
      { name: "desktop", width: 1440, height: 900 },
      { name: "narrow", width: 390, height: 844 },
    ]) {
      for (let n = 0; n < 5; n++) {
        const context = await browser.newContext({
          viewport: { width: profile.width, height: profile.height },
          deviceScaleFactor: 1,
          reducedMotion: "reduce",
          serviceWorkers: "block",
        });
        const page = await context.newPage();
        page.setDefaultTimeout(60000);
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        const cdp = await context.newCDPSession(page);
        await cdp.send("Network.enable");
        await cdp.send("Network.emulateNetworkConditions", {
          offline: false,
          latency: 100,
          downloadThroughput: 1250000,
          uploadThroughput: 1250000,
        });
        for (const phase of ["cold", "warm"]) {
          const requests = new Map();
          const finished = [];
          const received = (e) => {
            requests.set(e.requestId, {
              url: e.response.url,
              status: e.response.status,
              fromDiskCache: e.response.fromDiskCache,
              mime: e.response.mimeType,
              timestamp: e.timestamp,
            });
          };
          const loaded = (e) => {
            const r = requests.get(e.requestId);
            if (r)
              finished.push({
                ...r,
                encodedDataLength: e.encodedDataLength,
                finished: e.timestamp,
              });
          };
          cdp.on("Network.responseReceived", received);
          cdp.on("Network.loadingFinished", loaded);
          const at = performance.now();
          await page.goto(`${origin}/p/${publicationId}`);
          await expect
            .poll(async () => (await state(page)).loadedAssets, {
              timeout: 60000,
            })
            .toBe(4);
          await expect(
            page.getByRole("button", { name: "시점 왼쪽 회전", exact: true }),
          ).toBeEnabled();
          const entranceMs = performance.now() - at,
            entrance = await state(page);
          assert.equal(entrance.deferred, 16);
          assert.equal(entrance.failed, 0);
          assert(
            entrance.scheduler.active <= (profile.name === "narrow" ? 2 : 3),
          );
          const entranceRequests = structuredClone(finished);
          if (n === 0 && phase === "cold") {
            await gallery(page);
            const screenshot = `${screenshotDir}/${profile.name}-qualified-coarse.png`;
            await page.screenshot({ path: screenshot, fullPage: true });
            screenshots.push(screenshot);
            const gl = await page.locator("canvas").evaluate((c) => {
              const gl = c.getContext("webgl2");
              const ext = gl?.getExtension("WEBGL_debug_renderer_info");
              return {
                vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : null,
                renderer: ext
                  ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
                  : null,
              };
            });
            await page
              .locator("canvas")
              .evaluate((c) =>
                c.dispatchEvent(new Event("exhibitos-benchmark")),
              );
            await expect
              .poll(
                async () =>
                  page
                    .locator("canvas")
                    .evaluate((c) => c.viewerTrace?.elapsed ?? 0),
                { timeout: 75000, intervals: [1000] },
              )
              .toBeGreaterThanOrEqual(60000);
            const trace = await page
              .locator("canvas")
              .evaluate((c) => c.viewerTrace);
            assert(trace.samples.length > 100);
            assert(trace.samples.every((s) => s.triangles > 0));
            traces.push({
              profile: profile.name,
              quality: "qualified coarse",
              viewport: {
                width: profile.width,
                height: profile.height,
                deviceScaleFactor: 1,
                reducedMotion: "reduce",
              },
              gl,
              state: await state(page),
              ...trace,
              heap: await page.evaluate(() =>
                performance.memory
                  ? {
                      used: performance.memory.usedJSHeapSize,
                      total: performance.memory.totalJSHeapSize,
                    }
                  : null,
              ),
            });
            await page
              .getByRole("button", {
                name: "불러온 작품 상세 품질",
                exact: true,
              })
              .click();
            await expect
              .poll(
                async () => {
                  const s = await state(page);
                  return s.scheduler.active + s.scheduler.queued;
                },
                { timeout: 60000 },
              )
              .toBe(0);
            const full = await state(page);
            assert(full.budgetTotalBytes <= full.cache.maxBytes);
            await page
              .getByRole("button", {
                name: "불러온 작품 입구 품질",
                exact: true,
              })
              .click();
            await expect
              .poll(
                async () => {
                  const s = await state(page);
                  return s.scheduler.active + s.scheduler.queued;
                },
                { timeout: 60000 },
              )
              .toBe(0);
            if (profile.name === "desktop")
              assert((await state(page)).cacheHits > 0);
            else assert.equal((await state(page)).loadedPlacements, 20);
            checks.push(
              `${profile.name}: entrance4/deferred16, twenty actual artworks,60s render, bounded detail, ${profile.name === "desktop" ? "renderer-scoped verified cache reuse" : "compact profile retains qualified coarse"}`,
            );
          }
          console.log(
            `MEASURE ${profile.name} ${phase} ${n + 1}/5 entrance ${entranceMs.toFixed(0)}ms`,
          );
          samples.push({
            viewport: {
              width: profile.width,
              height: profile.height,
              deviceScaleFactor: 1,
              reducedMotion: "reduce",
            },
            profile: profile.name,
            phase,
            index: n,
            entranceMs,
            entrance,
            entranceTransferBytes: entranceRequests.reduce(
              (s, r) => s + r.encodedDataLength,
              0,
            ),
            entranceRequests,
            completeRequests: finished,
          });
          cdp.off("Network.responseReceived", received);
          cdp.off("Network.loadingFinished", loaded);
          assert.deepEqual(errors, []);
        }
        await context.close();
      }
    }
    for (const trace of traces) {
      const intervals = trace.samples
          .slice(1)
          .map((sample, i) => sample.at - trace.samples[i].at)
          .sort((a, b) => a - b),
        durations = trace.samples.map((s) => s.ms).sort((a, b) => a - b);
      trace.summary = {
        frames: trace.samples.length,
        elapsedMs: trace.elapsed,
        averageFps: trace.samples.length / (trace.elapsed / 1000),
        frameIntervalP95Ms: intervals[Math.ceil(intervals.length * 0.95) - 1],
        renderCallP95Ms: durations[Math.ceil(durations.length * 0.95) - 1],
        fpsTarget: trace.profile === "desktop" ? 60 : 30,
      };
    }
    report.summary = Object.fromEntries(
      ["desktop", "narrow"].map((profile) => [
        profile,
        Object.fromEntries(
          ["cold", "warm"].map((phase) => {
            const values = samples.filter(
              (s) => s.profile === profile && s.phase === phase,
            );
            return [
              phase,
              {
                samples: values.length,
                p95EntranceMs: Math.max(...values.map((s) => s.entranceMs)),
                maxInitialTransferBytes: Math.max(
                  ...values.map((s) => s.entranceTransferBytes),
                ),
                targetPass: values.every(
                  (s) =>
                    s.entranceMs <= 5000 && s.entranceTransferBytes <= 15728640,
                ),
              },
            ];
          }),
        ),
      ]),
    );
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
    return { checks, reportPath: String(reportPath), summary: report.summary };
  } finally {
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
    await browser.close();
  }
}
