// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { chromium, expect } from "@playwright/test";
export async function runNavigationBrowser({ origin, publicationId, fixture }) {
  const browser = await chromium.launch({ headless: process.env.EXHIBITOS_NAVIGATION_HEADED !== "1", channel: process.env.EXHIBITOS_NAVIGATION_CHANNEL || undefined }),
    checks = [],
    sequences = [],
    screenshots = [],
    dir = await mkdtemp(`${tmpdir()}/exhibitos-navigation-`);
  const report = {
    source: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    browser: browser.version(),
    headed: process.env.EXHIBITOS_NAVIGATION_HEADED === "1",
    channel: process.env.EXHIBITOS_NAVIGATION_CHANNEL || "bundled-chromium",
    nativeCaptureQualification: "Strict native acquisition check unless explicitly excluded by named filter; excluded checks are not passes.",
    filter: process.env.EXHIBITOS_NAVIGATION_FILTER || null,
    dirtySource: execFileSync("git", ["status", "--porcelain"], {encoding:"utf8"}).trim(),
    fixture,
    checks,
    sequences,
    screenshots,
    limits: [
      "Headless Chromium emulated input; physical mobile, GPU and RSS unverified.",
      "Window blur and hidden lifecycle handler injections are labeled separately from actual canvas focus and pointer-lock transitions.",
    ],
  };
  const near = (actual, expected, tolerance = 0.002) =>
    assert(
      Math.hypot(...actual.map((v, i) => v - expected[i])) < tolerance,
      `position differs by more than ${tolerance}m: ${actual} / ${expected}`,
    );
  const state = (page) =>
    page
      .locator("canvas")
      .evaluate((c) => JSON.parse(c.dataset.navigationState || "null"));
  const assets = (page) =>
    page
      .locator("canvas")
      .evaluate((c) => JSON.parse(c.dataset.viewerState || "{}"));
  const check = async (name, fn) => {
    if (
      process.env.EXHIBITOS_NAVIGATION_FILTER &&
      !new RegExp(process.env.EXHIBITOS_NAVIGATION_FILTER).test(name)
    )
      return;
    await fn();
    checks.push(name);
    console.log(`PASS ${name}`);
  };
  const button = (page, name) =>
    page.getByRole("button", { name, exact: true });
  const start = async (page) => {
    await button(
      page,
      (await state(page))?.walking ? "걷기 재개" : "걷기 시작",
    ).click();
    await expect
      .poll(async () => (await state(page))?.paused, { timeout: 30000 })
      .toBe(false);
  };
  const reset = async (page) => {
    await button(page, "안전한 시작 위치로").click();
    await expect.poll(async () => (await state(page)).paused).toBe(true);
  };
  const hold = async (page, key, ms) => {
    const from = await state(page),
      at = performance.now();
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(500);
    const to = await state(page);
    sequences.push({
      key,
      requestedMs: ms,
      elapsedMs: performance.now() - at,
      from,
      to,
    });
    return { from, to };
  };
  const artworkProbe = async (page, duration) => {
    const trajectory = [];
    await page.keyboard.down("KeyW");
    for (let at = 0; at < duration; at += 100) {
      await page.waitForTimeout(100);
      const s = await state(page),
        dx = s.eyePosition[0] + 2,
        dz = s.eyePosition[2],
        x = (dx - dz) * Math.SQRT1_2,
        z = (dx + dz) * Math.SQRT1_2,
        clearance = Math.hypot(
          Math.max(Math.abs(x) - 0.5, 0),
          Math.max(Math.abs(z) - 0.5, 0),
        );
      assert(clearance >= 0.23, `artwork clearance ${clearance}m`);
      trajectory.push({ ...s, clearance });
    }
    await page.keyboard.up("KeyW");
    await page.waitForTimeout(500);
    assert(trajectory.some((s) => s.blocked));
    sequences.push({ rotatedArtworkTrajectory: trajectory });
  };
  let context;
  try {
    context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    await page.addInitScript(() => {
      const request = Element.prototype.requestPointerLock;
      Element.prototype.requestPointerLock = async function (...args) {
        this.dataset.captureRequest = JSON.stringify({isConnected:this.isConnected,ownerMatches:this.ownerDocument===document,activation:navigator.userActivation.isActive,focus:document.hasFocus(),active:document.activeElement===this});
        try { return await request.apply(this,args); }
        catch (error) { this.dataset.captureError = `${error.name}: ${error.message}`; throw error; }
      };
    });

    const requests = [],
      errors = [];
    page.on("request", (r) => requests.push(r.url()));
    page.on("pageerror", (e) => errors.push(e.message));
    const entranceAt = performance.now();
    await page.goto(`${origin}/p/${publicationId}`);
    await expect
      .poll(async () => (await assets(page)).loadedPlacements)
      .toBe(2);
    report.entrance = {
      ms: performance.now() - entranceAt,
      requests: [...requests],
      physicsRequested: requests.some((u) =>
        /navigation-camera|rapier/.test(u),
      ),
    };
    assert.equal(report.entrance.physicsRequested, false);
    await check(
      "qualified artwork entrance is usable before physics is requested; explicit walking initializes safe first-person controller",
      async () => {
        await start(page);
        const s = await state(page);
        assert.equal(s.settings.speed, 1.3);
        assert.equal(s.settings.eyeHeight, 1.65);
        assert.equal(s.settings.reducedMotion, true);
        assert(
          Math.abs(s.eyePosition[0]) < 0.02 &&
            Math.abs(s.eyePosition[2] - 3) < 0.02,
        );
        assert.equal(s.grounded, true);
        report.profile = await page
          .locator("canvas")
          .evaluate((c) => JSON.parse(c.dataset.navigationProfile));
        assert(
          report.profile.mesh.cells > 0 &&
            report.profile.mesh.crossRoomEdges > 0,
        );
        await expect(button(page, "전체 공간 보기")).toBeDisabled();
        assert(requests.some((u) => /navigation-camera/.test(u)));
      },
    );
    await check(
      "actual focused WASD speeds accelerate, decelerate and pause/resume at the current position",
      async () => {
        const distances = [];
        for (const speed of [0.7, 1.3, 1.6]) {
          await reset(page);
          await page
            .getByLabel("보행 속도", { exact: true })
            .selectOption(String(speed));
          await start(page);
          const { from, to } = await hold(page, "KeyW", 1500);
          const distance = from.eyePosition[2] - to.eyePosition[2];
          distances.push(distance);
          assert(distance > speed * 0.8 && distance < speed * 1.9);
          assert(Math.hypot(...to.velocity) < 0.01);
        }
        assert(distances[0] < distances[1] && distances[1] < distances[2]);
        const before = await state(page);
        await button(page, "걷기 일시 정지").click();
        await page.waitForTimeout(600);
        near((await state(page)).eyePosition, before.eyePosition);
        await start(page);
        near((await state(page)).eyePosition, before.eyePosition);
      },
    );
    await check(
      "held movement loses canvas focus on settings; eye height changes preserve feet and fixed body clearance",
      async () => {
        await reset(page);
        await start(page);
        await page.keyboard.down("KeyW");
        await page.waitForTimeout(350);
        await page
          .getByLabel("보행 속도", { exact: true })
          .selectOption(".7")
          .catch(() =>
            page.getByLabel("보행 속도", { exact: true }).selectOption("0.7"),
          );
        await expect.poll(async () => (await state(page)).paused).toBe(true);
        const stopped = await state(page);
        await page.waitForTimeout(700);
        near((await state(page)).eyePosition, stopped.eyePosition);
        await page.keyboard.up("KeyW");
        await page.getByLabel("눈높이", { exact: true }).fill("1.2");
        const lower = await state(page);
        assert(
          Math.abs(lower.eyePosition[1] - stopped.eyePosition[1] + 0.45) <
            0.015,
        );
        assert.equal(lower.eyePosition[0], stopped.eyePosition[0]);
        assert.equal(lower.eyePosition[2], stopped.eyePosition[2]);
        assert.equal(lower.paused, true);
        await page.getByLabel("눈높이", { exact: true }).fill("1.65");
      },
    );
    await check(
      "reduced-motion setting removes look interpolation without forced camera motion",
      async () => {
        await reset(page);
        await page
          .getByRole("checkbox", { name: "움직임 효과 줄이기", exact: true })
          .uncheck();
        await start(page);
        await page.keyboard.down("ArrowRight");
        await page.waitForTimeout(100);
        const smooth = await state(page);
        assert.equal(smooth.lookTransition, "smoothed");
        assert(Math.abs(smooth.targetYaw - smooth.yaw) > 0.01);
        await page.keyboard.up("ArrowRight");
        await page.waitForTimeout(500);
        await page
          .getByRole("checkbox", { name: "움직임 효과 줄이기", exact: true })
          .check();
        await start(page);
        await page.keyboard.down("ArrowLeft");
        await page.waitForTimeout(100);
        const reduced = await state(page);
        assert.equal(reduced.lookTransition, "immediate");
        assert(Math.abs(reduced.targetYaw - reduced.yaw) < 0.001);
        await page.keyboard.up("ArrowLeft");
      },
    );
    await check(
      "actual room wall and rotated artwork collision prevent penetration at maximum speed",
      async () => {
        await reset(page);
        await page.getByLabel("보행 속도", { exact: true }).selectOption("1.6");
        await start(page);
        await hold(page, "KeyA", 4000);
        let s = await state(page);
        assert(s.eyePosition[0] >= -3.76 && s.eyePosition[0] < -3.3);
        await reset(page);
        await start(page);
        await page.keyboard.down("KeyA");
        await expect
          .poll(async () => (await state(page)).eyePosition[0], {
            intervals: [30],
          })
          .toBeLessThan(-1.65);
        await page.keyboard.up("KeyA");
        await page.waitForTimeout(500);
        await artworkProbe(page, 3500);
        s = await state(page);
        assert(s.grounded);
      },
    );
    await check(
      "real door cutout permits adjacent-room crossing; solid outer boundary retains grounded in-bounds camera",
      async () => {
        await reset(page);
        await start(page);
        await page.keyboard.down("KeyW");
        await expect
          .poll(async () => (await state(page)).eyePosition[2], {
            timeout: 15000,
          })
          .toBeLessThan(-4.5);
        const crossing = await state(page);
        assert(crossing.grounded);
        await expect
          .poll(async () => (await state(page)).eyePosition[2], {
            timeout: 15000,
          })
          .toBeLessThan(-11.3);
        await page.waitForTimeout(500);
        await page.keyboard.up("KeyW");
        await page.waitForTimeout(500);
        const s = await state(page);
        assert(s.eyePosition[2] >= -11.76 && s.eyePosition[2] <= -11.3);
        assert(s.grounded);
        sequences.push({ doorCrossing: crossing, boundary: s });
      },
    );
    await check(
      "lowering eye height cannot pass the raised narrow window",
      async () => {
        await reset(page);
        await page.getByLabel("눈높이", { exact: true }).fill("1.2");
        await start(page);
        await page.keyboard.down("KeyD");
        await expect
          .poll(async () => (await state(page)).eyePosition[0], {
            intervals: [30],
          })
          .toBeGreaterThan(1.65);
        await page.keyboard.up("KeyD");
        await page.waitForTimeout(450);
        await hold(page, "KeyW", 6500);
        const s = await state(page);
        assert(s.eyePosition[2] >= -3.76);
        assert(s.eyePosition[0] > 1.6 && s.eyePosition[0] < 2.6);
        assert(s.grounded);
        await page.getByLabel("눈높이", { exact: true }).fill("1.65");
      },
    );
    await check(
      "injected pointer-lock refusal keeps visible fallback and focused keyboard look usable",
      async () => {
        await reset(page);
        await page.evaluate(() => {
          window.nativeLockRequest = Element.prototype.requestPointerLock;
          Element.prototype.requestPointerLock = async () => { throw new DOMException("Synthetic qualification refusal", "NotAllowedError"); };
        });
        try {
          await button(page,"마우스 시점 잡기").click();
          await page.waitForTimeout(700);
          await expect(page.getByRole("status",{name:"보행 상태"})).toContainText("화살표와 터치");
          const before=await state(page);
          await hold(page,"ArrowRight",150);
          assert(Math.abs((await state(page)).yaw-before.yaw)>.05);
          assert.equal(await page.evaluate(()=>document.pointerLockElement),null);
        } finally {
          await page.evaluate(()=>{Element.prototype.requestPointerLock=window.nativeLockRequest;});
          await reset(page);
        }
      },
    );
    await check(
      "browser pointer lock is opt-in, changes actual yaw, and loss pauses without automatic resume",
      async () => {
        await reset(page);
        await button(page, "마우스 시점 잡기").click();
        report.captureStatus = await page
          .getByRole("region", { name: "걷기 조작" })
          .getByRole("status", { name: "보행 상태" })
          .innerText();
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                document.pointerLockElement ===
                document.querySelector("canvas"),
            ),
          )
          .toBe(true)
          .catch(async (error) => {
            report.captureDebug = await page
              .locator("canvas")
              .evaluate((c) => ({
                error: c.dataset.captureError,
                request: c.dataset.captureRequest,
                connected: c.isConnected,
                activation: navigator.userActivation.isActive,
                focus: document.hasFocus(),
                active: document.activeElement?.tagName,
                locked: document.pointerLockElement === c,
                state: c.dataset.navigationState,
              }));
            console.log(JSON.stringify(report.captureDebug));
            throw error;
          });
        report.captureDebug = await page.locator("canvas").evaluate((c) => ({
          error: c.dataset.captureError,
          request: c.dataset.captureRequest,
          connected: c.isConnected,
          activation: navigator.userActivation.isActive,
          focus: document.hasFocus(),
          active: document.activeElement?.tagName,
          locked: document.pointerLockElement === c,
          state: c.dataset.navigationState,
        }));
        const before = await state(page);
        await page.mouse.move(700, 300);
        await page.mouse.move(900, 300);
        await expect
          .poll(async () => Math.abs((await state(page)).yaw - before.yaw))
          .toBeGreaterThan(0.05);
        await page.keyboard.press("Escape");
        await expect.poll(async () => (await state(page)).paused).toBe(true);
        await expect
          .poll(() => page.evaluate(() => document.pointerLockElement === null))
          .toBe(true);
        const stopped = await state(page);
        await page.keyboard.down("KeyW");
        await page.waitForTimeout(500);
        await page.keyboard.up("KeyW");
        near((await state(page)).eyePosition, stopped.eyePosition);
      },
    );
    if (process.env.EXHIBITOS_NAVIGATION_CAPTURE_ONLY === "1")
      return { checks, screenshots, reportPath: "targeted capture debug" };
    await check(
      "window-blur and hidden lifecycle handler injections clear movement and require explicit resume",
      async () => {
        for (const kind of ["blur", "hidden"]) {
          await reset(page);
          await start(page);
          await page.keyboard.down("KeyW");
          await page.waitForTimeout(200);
          await page.evaluate((kind) => {
            if (kind === "blur") window.dispatchEvent(new Event("blur"));
            else {
              Object.defineProperty(document, "hidden", {
                configurable: true,
                value: true,
              });
              document.dispatchEvent(new Event("visibilitychange"));
              Object.defineProperty(document, "hidden", {
                configurable: true,
                value: false,
              });
            }
          }, kind);
          await expect.poll(async () => (await state(page)).paused).toBe(true);
          const stopped = await state(page);
          await page.waitForTimeout(400);
          near((await state(page)).eyePosition, stopped.eyePosition);
          await page.keyboard.up("KeyW");
        }
      },
    );
    await check(
      "stationary mode and quality replacement stop walking and dispose physics/input resources",
      async () => {
        await start(page);
        await button(page, "정지 관람으로 전환").click();
        await expect(button(page, "전체 공간 보기")).toBeEnabled();
        assert.equal((await state(page)).walking, false);
        await page.evaluate(
          () => (window.oldWalkCanvas = document.querySelector("canvas")),
        );
        await page
          .getByLabel("Viewer 품질", { exact: true })
          .selectOption("compact");
        await expect
          .poll(() =>
            page.evaluate(
              () => window.oldWalkCanvas.dataset.navigationDisposed,
            ),
          )
          .toBe("true");
        await expect
          .poll(async () => (await assets(page)).loadedPlacements)
          .toBe(2);
        assert.equal(await state(page), null);
      },
    );
    await check(
      "missing approved artwork bytes retain physical collision bounds and the keyboard/list alternative",
      async () => {
        await page.route(
          `${origin}/api/v1/publications/${publicationId}/assets/*`,
          (route) => route.fulfill({ status: 404, body: "" }),
        );
        await page.reload();
        await expect.poll(async () => (await assets(page)).failed).toBe(2);
        await start(page);
        await page.getByLabel("보행 속도", { exact: true }).selectOption("1.6");
        await start(page);
        await page.keyboard.down("KeyA");
        await expect
          .poll(async () => (await state(page)).eyePosition[0], {
            intervals: [30],
          })
          .toBeLessThan(-1.65);
        await page.keyboard.up("KeyA");
        await page.waitForTimeout(500);
        await artworkProbe(page, 3000);
        await expect(
          page.getByRole("region", { name: "작품 목록형 대체 보기" }),
        ).toBeVisible();
        await page.unroute(
          `${origin}/api/v1/publications/${publicationId}/assets/*`,
        );
      },
    );
    await check(
      "invalid spawn fails closed with stationary/list alternative",
      async () => {
        const path = `${origin}/api/v1/publications/${publicationId}`;
        await page.route(path, async (route) => {
          const r = await route.fetch(),
            body = await r.json();
          const camera =
            body.exhibition.extensions["org.exhibitos.studio/presentation"]
              .startCamera;
          camera.position = [-2, 1.65, 0];
          camera.target = [-2, 1.65, -1];
          await route.fulfill({ response: r, json: body });
        });
        await page.reload();
        await expect
          .poll(async () => (await assets(page)).loadedPlacements)
          .toBe(2);
        await button(page, "걷기 시작").click();
        await expect(
          page
            .getByRole("region", { name: "걷기 조작" })
            .getByRole("status", { name: "보행 상태" }),
        ).toContainText("안전한 걷기");
        assert.equal(await state(page), null);
        await expect(button(page, "전체 공간 보기")).toBeEnabled();
        await page.unroute(path);
      },
    );
    assert.deepEqual(errors, []);
    await context.close();
    context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    const mobile = await context.newPage();
    mobile.setDefaultTimeout(30000);
    await mobile.goto(`${origin}/p/${publicationId}`);
    await expect
      .poll(async () => (await assets(mobile)).loadedPlacements)
      .toBe(2);
    await start(mobile);
    await mobile.locator("canvas").scrollIntoViewIfNeeded();
    const cdp = await context.newCDPSession(mobile),
      box = await mobile.locator("canvas").boundingBox(),
      forward = await button(mobile, "앞으로 이동").boundingBox();
    assert(box && forward);
    const left = {
        x: forward.x + forward.width / 2,
        y: forward.y + forward.height / 2,
        id: 1,
      },
      right = {
        x: box.x + box.width * 0.82,
        y: box.y + box.height * 0.45,
        id: 2,
      };
    const touch = (type, points) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: points.map((p) => ({
          ...p,
          radiusX: 3,
          radiusY: 3,
          force: 1,
        })),
      });
    await mobile.evaluate(() => {window.touchEvents=[]; for(const type of ["pointerdown","pointerup","pointercancel","lostpointercapture"]) document.addEventListener(type,e=>window.touchEvents.push({type,id:e.pointerId,target:e.target.dataset.walkTouch||e.target.tagName}));});
    await check(
      "narrow real two-pointer touch moves and looks independently; release and cancellation do not leave movement held",
      async () => {
        const before = await state(mobile);
        await touch("touchStart", [left]);
        await touch("touchStart", [left, right]);
        await mobile.waitForTimeout(600);
        right.x -= 45;
        await touch("touchMove", [left, right]);
        await mobile.waitForTimeout(350);
        const both = await state(mobile);
        assert(both.eyePosition[2] < before.eyePosition[2] - 0.35);
        assert(Math.abs(both.yaw - before.yaw) > 0.05);
        await touch("touchEnd", [left]);
        await mobile.waitForTimeout(500);
        const released = await state(mobile);
        report.touchEvents=await mobile.evaluate(()=>window.touchEvents);
        report.touchReleased=released;
        console.log(JSON.stringify({touchEvents:report.touchEvents,released}));
        assert(Math.hypot(...released.velocity) < 0.01);
        await touch("touchCancel", []);
        const stopped = await state(mobile);
        await mobile.waitForTimeout(400);
        near((await state(mobile)).eyePosition, stopped.eyePosition);
        sequences.push({
          touchBefore: before,
          touchBoth: both,
          touchReleased: released,
        });
      },
    );
    const shot = `${dir}/narrow-walking.png`;
    await mobile.screenshot({ path: shot, fullPage: true });
    screenshots.push(shot);
    assert(
      await mobile.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await context.close();
    if (!process.env.EXHIBITOS_NAVIGATION_FILTER || process.env.EXHIBITOS_NAVIGATION_FILTER === "^(?!browser pointer lock)") await writeFile(
      new URL("../docs/performance/navigation-results.json", import.meta.url),
      JSON.stringify(report, null, 2) + "\n",
    );
    return {
      checks,
      screenshots,
      reportPath: "docs/performance/navigation-results.json",
    };
  } finally {
    await context?.close().catch(() => {});
    await browser.close();
    await writeFile(
      `${dir}/navigation-run.json`,
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(`Navigation raw report ${dir}/navigation-run.json`);
  }
}
