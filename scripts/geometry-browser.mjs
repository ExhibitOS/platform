import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";

export async function runGeometryBrowser() {
  const dist = new URL("../apps/web/dist/", import.meta.url),
    assets = new Set(await readdir(new URL("assets/", dist))),
    checks = [],
    screenshots = [];
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      let file, type;
      if (req.method !== "GET") {
        res.writeHead(405).end();
        return;
      }
      if (path === "/studio") {
        file = "index.html";
        type = "text/html";
      } else if (path === "/studio-sw.js") {
        file = "studio-sw.js";
        type = "application/javascript";
      } else if (path === "/THIRD_PARTY_NOTICES.txt") {
        file = "THIRD_PARTY_NOTICES.txt";
        type = "text/plain";
      } else if (
        path.startsWith("/assets/") &&
        assets.has(path.slice(8)) &&
        /^[-\w.]+$/.test(path.slice(8))
      ) {
        file = path.slice(1);
        type = file.endsWith(".js") ? "application/javascript" : "text/css";
      } else {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        "content-type": type,
        "cache-control":
          path === "/studio-sw.js" ? "no-cache" : "public,max-age=0",
      });
      res.end(await readFile(new URL(file, dist)));
    } catch {
      res.writeHead(500).end();
    }
  });
  let browser;
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext(),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.setDefaultTimeout(20000);
    const check = async (title, work) => {
      await work();
      checks.push(title);
      console.log(`PASS ${title}`);
    };
    const candidate = async () =>
      JSON.parse(
        await page.getByLabel("전시 문서 JSON", { exact: true }).inputValue(),
      );
    const record = async () => {
      const id = await page.getByTestId("draft-id").innerText();
      return page.evaluate(
        (id) =>
          new Promise((resolve, reject) => {
            const request = indexedDB.open("exhibitos-studio", 2);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result,
                get = db.transaction("drafts").objectStore("drafts").get(id);
              get.onsuccess = () => {
                db.close();
                resolve(get.result);
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
        .poll(async () => JSON.stringify((await record()).draft.candidate))
        .toBe(JSON.stringify(expected));
      await expect(page.getByTestId("local-state")).toContainText(
        "로컬 version",
      );
    };
    const select = async (kind, id) => {
      await page
        .getByLabel("공간 요소 선택", { exact: true })
        .selectOption(`${kind}:${id}`);
      await expect(page.getByTestId("geometry-selected-id")).toHaveText(id);
    };
    const apply = () =>
      page
        .getByRole("button", { name: "선택 요소 속성 적용", exact: true })
        .click();
    const render = async () => {
      await expect(page.getByTestId("geometry-render-state")).toContainText(
        "실제 개구부",
      );
      await expect(page.locator(".geometry-preview canvas")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "선택 표면 정면", exact: true }),
      ).toBeEnabled();
    };
    let roomId, frontId, doorId, localId;
    await check(
      "production accessible room transform and white-cube controls persist native IndexedDB geometry",
      async () => {
        await page.goto(`${origin}/studio`);
        await expect(page.getByTestId("shell-status")).toContainText(
          "오프라인 앱 준비 완료",
        );
        await page
          .getByRole("button", { name: "새 로컬 전시", exact: true })
          .click();
        await expect(page.getByRole("status", { name: "전시 편집 상태", exact: true })).toContainText(
          "계정 없이 로컬 전시",
        );
        const initial = await candidate();
        initial.extensions = {
          "org.synthetic.fixture/retained": { notes: "keep foreign extension" },
        };
        await page
          .getByLabel("전시 문서 JSON", { exact: true })
          .fill(JSON.stringify(initial, null, 2));
        await saved();
        localId = await page.getByTestId("draft-id").innerText();
        roomId = initial.rooms[0].id;
        await page
          .getByLabel("방 이름", { exact: true })
          .fill("Synthetic white cube");
        await page.getByLabel("폭 (m)", { exact: true }).fill("14");
        await page.getByLabel("위치 X (m)", { exact: true }).fill("2");
        await apply();
        await saved();
        assert.equal(
          (await record()).draft.candidate.rooms[0].dimensions.width,
          14,
        );
        assert.deepEqual(
          (await record()).draft.candidate.rooms[0].transform.position,
          [2, 0, 0],
        );
        await page
          .getByRole("button", { name: "선택 방 white-cube 생성", exact: true })
          .click();
        await saved();
        const document = await candidate();
        assert.equal(document.surfaces.length, 6);
        frontId = document.surfaces.find(
          (surface) =>
            surface.type === "wall" && surface.transform.position[2] === 4,
        ).id;
        await render();
      },
    );
    await check(
      "PBR material and actual floor-touching doorway edit survive undo and redo without losing foreign metadata",
      async () => {
        await select("surface", frontId);
        await page.getByLabel("표면 색상", { exact: true }).fill("#cc3020");
        await page.getByLabel("거칠기 (0–1)", { exact: true }).fill("0.4");
        await page.getByLabel("금속성 (0–1)", { exact: true }).fill("0.2");
        await page
          .getByRole("button", { name: "표면 재질 적용", exact: true })
          .click();
        await saved();
        assert.deepEqual(
          (await candidate()).extensions["org.exhibitos.studio/materials"]
            .surfaces[frontId],
          { color: "#cc3020", roughness: 0.4, metalness: 0.2 },
        );
        const mixedCase = await candidate();
        mixedCase.surfaces.find(item=>item.id===frontId).roomId = roomId.toUpperCase();
        const materialMap = mixedCase.extensions["org.exhibitos.studio/materials"].surfaces;
        materialMap[frontId.toUpperCase()] = materialMap[frontId];
        delete materialMap[frontId];
        await page.getByLabel("전시 문서 JSON",{exact:true}).fill(JSON.stringify(mixedCase,null,2));
        await saved();
        await expect(page.getByLabel("표면 소유 방",{exact:true})).toHaveValue(roomId);
        await expect(page.getByLabel("표면 색상",{exact:true})).toHaveValue('#cc3020');
        await page
          .getByRole("button", { name: "선택 벽에 외부 문 추가", exact: true })
          .click();
        await saved();
        doorId = (await candidate()).openings[0].id;
        await expect(page.getByTestId("geometry-selected-id")).toHaveText(
          doorId,
        );
        await page.getByLabel("폭 (m)", { exact: true }).fill("1.4");
        await page.getByLabel("높이 (m)", { exact: true }).fill("2.3");
        await page
          .getByLabel("개구부 중심 Y (m)", { exact: true })
          .fill("-0.85");
        await apply();
        await saved();
        const edited = await candidate();
        assert.deepEqual(edited.openings[0].dimensions, {
          width: 1.4,
          height: 2.3,
        });
        await page
          .getByRole("button", { name: "공간 편집 undo", exact: true })
          .click();
        await saved();
        assert.deepEqual((await candidate()).openings[0].dimensions, {
          width: 1,
          height: 2.1,
        });
        await page
          .getByRole("button", { name: "공간 편집 redo", exact: true })
          .click();
        await saved();
        assert.deepEqual(
          (await candidate()).openings[0].dimensions,
          edited.openings[0].dimensions,
        );
        assert.deepEqual(
          (await candidate()).extensions["org.synthetic.fixture/retained"],
          { notes: "keep foreign extension" },
        );
      },
    );
    await check(
      "real Three rendered doorway removes wall pixels and undo restores the same physical opening",
      async () => {
        const redPixels = async () =>
          page.locator(".geometry-preview canvas").evaluate((canvas) => {
            const gl = canvas.getContext("webgl2"),
              pixels = new Uint8Array(
                gl.drawingBufferWidth * gl.drawingBufferHeight * 4,
              );
            gl.readPixels(
              0,
              0,
              gl.drawingBufferWidth,
              gl.drawingBufferHeight,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              pixels,
            );
            let count = 0;
            for (let i = 0; i < pixels.length; i += 4)
              if (
                pixels[i] > 100 &&
                pixels[i] > pixels[i + 1] * 1.7 &&
                pixels[i] > pixels[i + 2] * 1.7
              )
                count++;
            return count;
          });
        await select("surface", frontId);
        await render();
        await page
          .getByRole("button", { name: "선택 표면 정면", exact: true })
          .click();
        const openPixels = await redPixels();

        const directory = await mkdtemp(`${tmpdir()}/exhibitos-geometry-`);
        screenshots.push(`${directory}/door-opening.png`);
        await page
          .locator(".geometry-preview")
          .screenshot({ path: screenshots.at(-1) });
        assert(openPixels > 1000,`Actual selected red wall must render; red pixels=${openPixels}, screenshot=${screenshots.at(-1)}`);
        await select("opening", doorId);
        await page
          .getByRole("button", { name: "선택 요소 삭제", exact: true })
          .click();
        await saved();
        assert.equal((await candidate()).openings.length, 0);
        await select("surface", frontId);
        await render();
        await page
          .getByRole("button", { name: "선택 표면 정면", exact: true })
          .click();
        const closedPixels = await redPixels();
        assert(
          closedPixels > openPixels + 50,
          `Actual wall filling must add red pixels: open=${openPixels}, closed=${closedPixels}`,
        );
        await page
          .getByRole("button", { name: "공간 편집 undo", exact: true })
          .click();
        await saved();
        await render();
        await page
          .getByRole("button", { name: "선택 표면 정면", exact: true })
          .click();
        assert.equal((await candidate()).openings[0].id, doorId);
        assert(Math.abs((await redPixels()) - openPixels) < 100);
      },
    );
    await check(
      "negative dimensions, invalid quaternion, dangling door deletion and invalid PBR values retain previous good document",
      async () => {
        await select("room", roomId);
        const before = await candidate();
        await page.getByLabel("폭 (m)", { exact: true }).fill("-1");
        await apply();
        await expect(page.getByTestId("geometry-error")).not.toHaveText("");
        assert.deepEqual(await candidate(), before);
        assert.deepEqual((await record()).draft.candidate, before);
        await page.getByLabel("폭 (m)", { exact: true }).fill("14");
        await page.getByLabel("회전 quaternion W", { exact: true }).fill("0");
        await apply();
        await expect(page.getByTestId("geometry-error")).not.toHaveText("");
        assert.deepEqual(await candidate(), before);
        await select("surface", frontId);
        await page
          .getByRole("button", { name: "선택 요소 삭제", exact: true })
          .click();
        await expect(page.getByTestId("geometry-error")).not.toHaveText("");
        assert.deepEqual(await candidate(), before);
        await page.getByLabel("거칠기 (0–1)", { exact: true }).fill("1.1");
        await page
          .getByRole("button", { name: "표면 재질 적용", exact: true })
          .click();
        await expect(page.getByTestId("geometry-error")).not.toHaveText("");
        assert.deepEqual(await candidate(), before);
      },
    );
    await check(
      "true offline reload retains exact room walls openings and PBR; keyboard camera controls and mobile layout",
      async () => {
        const before = await candidate(),
          cdp = await context.newCDPSession(page);
        await cdp.send("Network.enable");
        await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
        await context.setOffline(true);
        assert.equal((await page.reload()).fromServiceWorker(), true);
        await page.getByTestId(`draft-${localId}`).click();
        await expect(page.getByTestId("draft-id")).toHaveText(localId);
        assert.deepEqual(await candidate(), before);
        await render();
        const camera = page.getByRole("button", {
          name: "시점 왼쪽 회전",
          exact: true,
        });
        await camera.focus();
        await page.keyboard.press("Enter");
        await expect(camera).toBeFocused();
        await expect(
          page
            .getByText("곡선벽·계단은 지원하지 않습니다.", { exact: false })
            .first(),
        ).toBeVisible();
        await page.setViewportSize({ width: 375, height: 812 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        const directory = await mkdtemp(
          `${tmpdir()}/exhibitos-geometry-mobile-`,
        );
        screenshots.push(`${directory}/mobile-geometry.png`);
        await page.screenshot({ path: screenshots.at(-1), fullPage: true });
        assert.deepEqual(errors, []);
        await cdp.detach();
      },
    );
    await context.close();
    return { checks, screenshots };
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
