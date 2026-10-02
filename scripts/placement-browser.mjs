import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { fixtureURL } from "@exhibitos/spec";
import { buildApp } from "../apps/api/dist/app.js";

export async function runPlacementBrowser({
  pool,
  blobs,
  tenantId,
  subject,
  password,
  work,
}) {
  const checks = [],
    screenshots = [],
    dist = new URL("../apps/web/dist/", import.meta.url),
    assets = new Set(await readdir(new URL("assets/", dist)));
  let app, browser;
  const check = async (name, fn) => {
    await fn();
    checks.push(name);
    console.log(`PASS ${name}`);
  };
  try {
    // Auth origin requires the actual chosen listening port, so reserve first.
    const { createServer } = await import("node:net");
    const reserve = createServer();
    await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
    const port = reserve.address().port;
    await new Promise((resolve) => reserve.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    app = buildApp({
      pool,
      blobs,
      auth: { mode: "local", origin, bindHost: "127.0.0.1" },
    });
    for (const path of ["/studio", "/cms"])
      app.get(path, async (_req, reply) =>
        reply
          .type("text/html")
          .send(await readFile(new URL("index.html", dist))),
      );
    app.get("/studio-sw.js", async (_req, reply) =>
      reply
        .header("cache-control", "no-cache")
        .type("application/javascript")
        .send(await readFile(new URL("studio-sw.js", dist))),
    );
    app.get("/THIRD_PARTY_NOTICES.txt", async (_req, reply) =>
      reply
        .type("text/plain")
        .send(await readFile(new URL("THIRD_PARTY_NOTICES.txt", dist))),
    );
    app.get("/assets/:file", async (req, reply) => {
      const file = req.params.file;
      if (!assets.has(file) || !/^[-\w.]+$/.test(file))
        return reply.code(404).send();
      return reply
        .type(file.endsWith(".js") ? "application/javascript" : "text/css")
        .send(await readFile(new URL(`assets/${file}`, dist)));
    });
    await app.listen({ host: "127.0.0.1", port });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext(),
      page = await context.newPage(),
      errors = [];
    page.setDefaultTimeout(25000);
    page.on("pageerror", (e) => errors.push(e.message));
    const login = await context.request.post(`${origin}/api/v1/auth/login`, {
      headers: { origin },
      data: { tenantId, subject, password },
    });
    assert.equal(login.status(), 200, await login.text());
    const session = await (
      await context.request.get(`${origin}/api/v1/auth/session`)
    ).json();
    const api = async (method, path, data) => {
      const res = await context.request.fetch(
        `${origin}/api/v1/tenants/${tenantId}${path}`,
        {
          method,
          headers: {
            origin,
            "x-csrf-token": session.csrfToken,
            ...(Buffer.isBuffer(data)
              ? { "content-type": "application/octet-stream" }
              : {}),
          },
          ...(data === undefined ? {} : { data }),
        },
      );
      assert(res.ok(), `${method} ${path} ${res.status()} ${await res.text()}`);
      return res.json();
    };
    const artist = await api("POST", "/cms/artists", {
      name: "Placement synthetic artist",
      bio: "Original fixtures only",
      userId: null,
    });
    const rights = {
      holder: "ExhibitOS synthetic authors",
      ownership: "owner",
      licenseId: "CC0-1.0",
      permissions: {
        display: true,
        download: false,
        export: false,
        commercial: false,
      },
      creditLine: "Synthetic CC0 placement fixture",
    };
    const artworkIds = [];
    for (const [type, name, mime, dimensions] of [
      [
        "sculpture",
        "sculpture.glb",
        "model/gltf-binary",
        { width: 1, height: 1, depth: 1, unit: "m" },
      ],
      [
        "image",
        "painting.png",
        "image/png",
        { width: 1.5, height: 1, depth: 0.02, unit: "m" },
      ],
    ]) {
      const metadata = {
        title: `Placement ${type}`,
        description: "Original synthetic fixture",
        dimensions,
        rights,
        provenance: {
          source: "human-authored",
          sourceUnits: "m",
          scaleApplied: false,
          notes: "Original synthetic fixture",
        },
      };
      const a = await api("POST", "/cms/artworks", {
        artistId: artist.id,
        ...metadata,
      });
      let bytes = await readFile(fixtureURL(`fixtures/synthetic/${name}`));
      if (mime === "image/png") {
        const chunks = [bytes.subarray(0, 8)];
        // Keep the original synthetic fixture's supported critical PNG chunks.
        for (let offset = 8; offset < bytes.length;) {
          const length = bytes.readUInt32BE(offset),
            end = offset + length + 12,
            type = bytes.toString("ascii", offset + 4, offset + 8);
          if (["IHDR", "IDAT", "IEND"].includes(type))
            chunks.push(bytes.subarray(offset, end));
          offset = end;
        }
        bytes = Buffer.concat(chunks);
      }
      const job = await api("POST", "/imports", {
        artworkId: a.id,
        idempotencyKey: randomUUID(),
        mime,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
        scaleMeters: 1,
        rights,
      });
      await api("PUT", `/imports/${job.id}/bytes`, bytes);
      await api("POST", `/imports/${job.id}/complete`);
      await work();
      const ready = await api("GET", `/imports/${job.id}`);
      assert.equal(ready.state, "approved", JSON.stringify(ready));
      await api("POST", `/cms/artworks/${a.id}/approve`, {
        revision: a.revision,
        assetId: ready.assetId,
      });
      artworkIds.push(a.id);
    }
    const candidate = async () =>
      JSON.parse(
        await page.getByLabel("전시 문서 JSON", { exact: true }).inputValue(),
      );
    const stored = async () => {
      const id = await page.getByTestId("draft-id").innerText();
      return page.evaluate(
        (id) =>
          new Promise((resolve, reject) => {
            const open = indexedDB.open("exhibitos-studio", 2);
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const db = open.result,
                get = db.transaction("drafts").objectStore("drafts").get(id);
              get.onsuccess = () => {
                db.close();
                resolve(get.result.draft.candidate);
              };
              get.onerror = () => reject(get.error);
            };
          }),
        id,
      );
    };
    const saved = async () => {
      const expected = await candidate();
      await expect
        .poll(async () => JSON.stringify(await stored()))
        .toBe(JSON.stringify(expected));
      await expect(page.getByTestId("local-state")).toContainText(
        "로컬 version",
      );
    };
    const render = async () => {
      await expect(page.getByTestId("geometry-render-state")).toContainText(
        "승인된 작품 derivative 2개",
      );
      await expect(page.locator(".geometry-preview canvas")).toBeVisible();
    };
    const click = (name) =>
      page.getByRole("button", { name, exact: true }).click();
    const pixels = () =>
      page.locator(".geometry-preview canvas").evaluate((canvas) => {
        const gl = canvas.getContext("webgl2"),
          data = new Uint8Array(
            gl.drawingBufferWidth * gl.drawingBufferHeight * 4,
          );
        gl.readPixels(
          0,
          0,
          gl.drawingBufferWidth,
          gl.drawingBufferHeight,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          data,
        );
        let colorful = 0,
          sum = 0;
        for (let i = 0; i < data.length; i += 4) {
          sum += data[i] + data[i + 1] + data[i + 2];
          if (
            Math.max(data[i], data[i + 1], data[i + 2]) -
              Math.min(data[i], data[i + 1], data[i + 2]) >
            45
          )
            colorful++;
        }
        return { colorful, sum };
      });
    let localId, paintingId, sculptureId, wallId;
    await check(
      "production Studio imports real approved CMS GLB/PNG snapshots, actual physical placement and wall snap persist",
      async () => {
        await page.goto(`${origin}/studio`);
        await expect(page.getByTestId("shell-status")).toContainText(
          "오프라인 앱 준비 완료",
        );
        await click("새 로컬 전시");
        await click("현재 서버 계정 확인");
        await click("선택 방 white-cube 생성");
        for (const id of artworkIds) {
          await page.getByLabel("CMS 작품 ID", { exact: true }).fill(id);
          await click("승인된 CMS 작품 가져오기");
          await expect(
            page.getByLabel("배치할 작품", { exact: true }).locator("option"),
          ).toHaveCount(artworkIds.indexOf(id) + 2);
          await click("실제 크기로 작품 배치");
        }
        let doc = await candidate();
        sculptureId = doc.placements[0].id;
        paintingId = doc.placements[1].id;
        wallId = doc.surfaces.find(
          (s) => s.type === "wall" && s.transform.position[2] === -4,
        ).id;
        await page
          .getByLabel("정렬할 벽", { exact: true })
          .selectOption(wallId);
        await page
          .getByLabel("벽 중심 offset (m) X", { exact: true })
          .fill("0.06");
        await click("벽 내부 정렬·snap 적용");
        doc = await candidate();
        assert.equal(doc.placements[1].transform.position[0], 0.1);
        assert.equal(doc.placements[1].transform.position[1], 2);
        assert.equal(doc.artworks[1].dimensions.width, 1.5);
        assert(
          doc.artworks.every((a) => a.extensions["org.exhibitos.studio/cms"]),
        );
        await page
          .getByLabel("작품 배치 선택", { exact: true })
          .selectOption(sculptureId);
        await page.getByLabel("작품 위치 (m) X", { exact: true }).fill("-2");
        await page.getByLabel("작품 위치 (m) Y", { exact: true }).fill("1");
        await page.getByLabel("작품 위치 (m) Z", { exact: true }).fill("-2");
        await click("작품 수동 위치·회전 적용");
        await saved();
        localId = await page.getByTestId("draft-id").innerText();
        await render();
      },
    );
    await check(
      "spot target, brightness/color, start camera, viewpoints, route and title/credits render and save with shared undo",
      async () => {
        await click("spotlight 추가");
        await page
          .getByLabel("spotlight target", { exact: true })
          .selectOption(paintingId);
        await page
          .getByLabel("조명 밝기 (candela)", { exact: true })
          .fill("200");
        await page.getByLabel("조명 색상", { exact: true }).fill("#ffcc88");
        await click("조명 속성 적용");
        await click("시작 camera 적용");
        await click("viewpoint 추가");
        await page
          .getByLabel("전시 credits", { exact: true })
          .fill("Synthetic exhibition credits");
        await click("credits 적용");
        await page
          .getByLabel("편집 전시 제목", { exact: true })
          .fill("Synthetic placement exhibition");
        await click("제목 적용");
        await click("현재 camera로 waypoint 준비");
        await click("추천 동선 추가");
        await saved();
        await render();
        await click("시작 camera 보기");
        const before = await pixels();
        assert(
          before.colorful > 200,
          `Artwork derivatives must draw colorful pixels: ${JSON.stringify(before)}`,
        );
        await page.getByLabel("조명 밝기 (candela)", { exact: true }).fill("0");
        await click("조명 속성 적용");
        await render();
        await click("시작 camera 보기");
        const dark = await pixels();
        assert.notEqual(
          dark.sum,
          before.sum,
          "Authored light must affect real rendered pixels",
        );
        await click("공간 편집 undo");
        await render();
        await click("시작 camera 보기");
        assert.equal((await candidate()).lights[0].intensity, 200);
        const dir = await mkdtemp(`${tmpdir()}/exhibitos-placement-`);
        screenshots.push(`${dir}/approved-placement.png`);
        await page
          .locator(".geometry-preview")
          .screenshot({ path: screenshots.at(-1) });
        const doc = await candidate();
        assert.equal(doc.title, "Synthetic placement exhibition");
        assert.equal(doc.navigation.length, 1);
        assert.equal(
          doc.extensions["org.exhibitos.studio/presentation"].credits,
          "Synthetic exhibition credits",
        );
        await page
          .getByRole("button", { name: "시점 왼쪽 회전", exact: true })
          .focus();
        await page.keyboard.press("Enter");
        await expect(
          page.getByRole("button", { name: "시점 왼쪽 회전", exact: true }),
        ).toBeFocused();
      },
    );
    await check(
      "loaded nonunit placement scale survives manual position/rotation edits and actual rendered dimensions",
      async () => {
        const original = await candidate();
        await render();
        await click("시작 camera 보기");
        const baseline = await pixels();
        const scaled = structuredClone(original);
        scaled.placements.find((p) => p.id === paintingId).transform.scale = [
          0.5, 0.5, 1,
        ];
        await page
          .getByLabel("전시 문서 JSON", { exact: true })
          .fill(JSON.stringify(scaled, null, 2));
        await saved();
        await page.reload();
        await page.getByTestId(`draft-${localId}`).click();
        await click("현재 서버 계정 확인");
        await render();
        await click("시작 camera 보기");
        const small = await pixels();
        assert(
          small.colorful < baseline.colorful * 0.85,
          `Physical PNG plane must visibly shrink after scale: baseline=${baseline.colorful},scaled=${small.colorful}`,
        );
        await page
          .getByLabel("작품 배치 선택", { exact: true })
          .selectOption(paintingId);
        await page.getByLabel("작품 위치 (m) X", { exact: true }).fill("0.2");
        await page.getByLabel("작품 회전 W", { exact: true }).fill("1");
        await click("작품 수동 위치·회전 적용");
        await saved();
        const edited = await candidate();
        assert.deepEqual(
          edited.placements.find((p) => p.id === paintingId).transform.scale,
          [0.5, 0.5, 1],
        );
        assert.equal(
          edited.placements.find((p) => p.id === paintingId).transform
            .position[0],
          0.2,
        );
        await expect(page.locator(".placement-credits")).toContainText(
          "0.75 × 0.5",
        );
        await render();
        await click("시작 camera 보기");
        assert((await pixels()).colorful < baseline.colorful * 0.85);
        await click("공간 편집 undo");
        await saved();
        assert.deepEqual(await candidate(), scaled);
        await page
          .getByLabel("전시 문서 JSON", { exact: true })
          .fill(JSON.stringify(original, null, 2));
        await saved();
      },
    );
    await check(
      "wall overflow and invalid start camera fail without replacing candidate or consuming undo; missing artwork JSON rejects save",
      async () => {
        await page
          .getByLabel("작품 배치 선택", { exact: true })
          .selectOption(paintingId);
        const before = await candidate();
        await page
          .getByLabel("정렬할 벽", { exact: true })
          .selectOption(wallId);
        await page
          .getByLabel("벽 중심 offset (m) X", { exact: true })
          .fill("100");
        await click("벽 내부 정렬·snap 적용");
        await expect(page.getByTestId("geometry-error")).toContainText(
          "PLACEMENT_OUTSIDE_WALL",
        );
        assert.deepEqual(await candidate(), before);
        await page.getByLabel("camera FOV", { exact: true }).fill("0");
        await click("시작 camera 적용");
        await expect(page.getByTestId("geometry-error")).not.toHaveText("");
        assert.deepEqual(await candidate(), before);
        const bad = structuredClone(before);
        bad.placements[0].artworkRevisionId = randomUUID();
        await page
          .getByLabel("전시 문서 JSON", { exact: true })
          .fill(JSON.stringify(bad));
        await page.waitForTimeout(1000);
        await expect(page.getByTestId("local-state")).toContainText("미저장");
        await page
          .getByLabel("전시 문서 JSON", { exact: true })
          .fill(JSON.stringify(before, null, 2));
        await saved();
      },
    );
    await check(
      "reload resolves exact approved derivatives; offline reload retains metadata, lights, camera and route without claiming rendered bytes; mobile keyboard works",
      async () => {
        const before = await candidate();
        await page.reload();
        await page.getByTestId(`draft-${localId}`).click();
        assert.deepEqual(await candidate(), before);
        await click("현재 서버 계정 확인");
        await render();
        await page
          .getByLabel("편집 전시 제목", { exact: true })
          .fill("Temporary after reload");
        await click("제목 적용");
        await saved();
        await click("공간 편집 undo");
        await saved();
        assert.deepEqual(await candidate(), before);
        const cdp = await context.newCDPSession(page);
        await cdp.send("Network.enable");
        await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
        await context.setOffline(true);
        assert.equal((await page.reload()).fromServiceWorker(), true);
        await page.getByTestId(`draft-${localId}`).click();
        assert.deepEqual(await candidate(), before);
        await expect(page.getByTestId("geometry-render-state")).toContainText(
          "bytes 사용 불가 2개",
        );
        await expect(page.getByTestId("geometry-render-state")).toContainText(
          "derivative 0개",
        );
        await click("시작 camera 보기");
        await page.setViewportSize({ width: 375, height: 812 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        const dir = await mkdtemp(`${tmpdir()}/exhibitos-placement-mobile-`);
        screenshots.push(`${dir}/offline-mobile.png`);
        await page.screenshot({ path: screenshots.at(-1), fullPage: true });
        await cdp.detach();
        await context.setOffline(false);
        assert.deepEqual(errors, []);
      },
    );
    await check(
      "revoked display rights deny bridge and derivative; local snapshot remains exact metadata with bounds-only preview",
      async () => {
        const a = await api("GET", `/cms/artworks/${artworkIds[1]}`);
        await api("PATCH", `/cms/artworks/${a.id}`, {
          revision: a.revision,
          ...a.metadata,
          rights: {
            ...a.metadata.rights,
            permissions: { ...a.metadata.rights.permissions, display: false },
          },
        });
        const denied = await context.request.get(
          `${origin}/api/v1/tenants/${tenantId}/studio/artworks/${a.id}`,
        );
        assert([403, 409].includes(denied.status()), await denied.text());
        const preview = await context.request.get(
          `${origin}/api/v1/tenants/${tenantId}/cms/artworks/${a.id}/preview`,
        );
        assert([403, 409].includes(preview.status()), await preview.text());
        await page.reload();
        await page.getByTestId(`draft-${localId}`).click();
        const before = await candidate();
        await click("현재 서버 계정 확인");
        await expect(page.getByTestId("geometry-render-state")).toContainText(
          "승인된 작품 derivative 1개",
        );
        await expect(page.getByTestId("geometry-render-state")).toContainText(
          "bytes 사용 불가 1개",
        );
        assert.deepEqual(await candidate(), before);
      },
    );
    await check(
      "exact approved revision precondition prevents later reviewed bytes from rendering under an older Studio snapshot",
      async () => {
        const before = await candidate(),
          a = await api("GET", `/cms/artworks/${artworkIds[0]}`);
        const prior = await context.request.get(
          `${origin}/api/v1/tenants/${tenantId}/cms/artworks/${a.id}/preview?expectedRevision=${a.revision}`,
        );
        assert.equal(prior.status(), 200);
        assert.equal(
          prior.headers()["x-exhibitos-artwork-revision"],
          String(a.revision),
        );
        const changed = await api("PATCH", `/cms/artworks/${a.id}`, {
          revision: a.revision,
          ...a.metadata,
          title: "New reviewed sculpture revision",
        });
        await api("POST", `/cms/artworks/${a.id}/approve`, {
          revision: changed.revision,
          assetId: a.approvedAssetId,
        });
        const stale = await context.request.get(
          `${origin}/api/v1/tenants/${tenantId}/cms/artworks/${a.id}/preview?expectedRevision=${a.revision}`,
        );
        assert.equal(stale.status(), 409);
        assert.equal((await stale.json()).code, "REVISION_CONFLICT");
        assert(stale.headers()["content-type"].includes("application/json"));
        const latest = await context.request.get(
          `${origin}/api/v1/tenants/${tenantId}/cms/artworks/${a.id}/preview?expectedRevision=${changed.revision}`,
        );
        assert.equal(latest.status(), 200);
        assert.equal(
          latest.headers()["x-exhibitos-artwork-revision"],
          String(changed.revision),
        );
        const invalid = await context.request.get(
          `${origin}/api/v1/tenants/${tenantId}/cms/artworks/${a.id}/preview?expectedRevision=0`,
        );
        assert.equal(invalid.status(), 400);
        await page.reload();
        await page.getByTestId(`draft-${localId}`).click();
        await click("현재 서버 계정 확인");
        await expect(page.getByRole("status", { name: "전시 편집 상태", exact: true })).toContainText(
          "현재 서버 계정을 확인했습니다",
        );
        await expect(page.getByTestId("geometry-render-state")).toContainText(
          "승인된 작품 derivative 0개",
        );
        await expect(page.getByTestId("geometry-render-state")).toContainText(
          "bytes 사용 불가 2개",
        );
        assert.deepEqual(await candidate(), before);
      },
    );
    await check(
      "webglcontextlost event handler preserves metadata and usable numeric commands",
      async () => {
        const before = await candidate();
        // Wait for the current renderer after the asynchronous session check;
        // cleanup force-loses the outgoing canvas as a replacement is built.
        await expect
          .poll(() =>
            page
              .locator(".geometry-preview canvas")
              .evaluate(
                (canvas) => !canvas.getContext("webgl2").isContextLost(),
              ),
          )
          .toBe(true);
        // Exercise the standard browser event without physical GPU certification. Exercise the
        await page
          .locator(".geometry-preview canvas")
          .evaluate((canvas) =>
            canvas.dispatchEvent(
              new WebGLContextEvent("webglcontextlost", { cancelable: true }),
            ),
          );
        await expect(page.getByTestId("geometry-render-state")).toContainText(
          "3D 그래픽 연결이 중단",
        );
        assert.deepEqual(await candidate(), before);
        await page
          .getByLabel("편집 전시 제목", { exact: true })
          .fill("Numeric editing after WebGL loss");
        await click("제목 적용");
        await saved();
        assert.equal(
          (await candidate()).title,
          "Numeric editing after WebGL loss",
        );
        await click("공간 편집 undo");
        await saved();
        assert.deepEqual(await candidate(), before);
        assert.deepEqual(errors, []);
      },
    );
    await context.close();
    return { checks, screenshots };
  } finally {
    await browser?.close();
    await app?.close();
  }
}
