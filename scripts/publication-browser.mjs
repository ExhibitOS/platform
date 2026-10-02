import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";
import { buildApp } from "../apps/api/dist/app.js";

export async function runPublicationBrowser({
  pool,
  blobs,
  tenantId,
  subject,
  password,
  artworkIds,
}) {
  const checks = [],
    screenshots = [],
    dist = new URL("../apps/web/dist/", import.meta.url),
    assets = new Set(await readdir(new URL("assets/", dist)));
  const check = async (name, fn) => {
    await fn();
    checks.push(name);
    console.log(`PASS ${name}`);
  };
  let app, browser;
  try {
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
    for (const path of ["/studio", "/offline", "/cms", "/p/:id"])
      app.get(path, async (_req, reply) =>
        reply
          .header(
            "cache-control",
            ["/studio","/offline"].includes(path) ? "public,max-age=0,must-revalidate" : "no-store",
          )
          .type("text/html")
          .send(await readFile(new URL("index.html", dist))),
      );
    app.get("/studio-sw.js", async (_req, reply) =>
      reply
        .header("cache-control", "no-cache")
        .type("application/javascript")
        .send(await readFile(new URL("studio-sw.js", dist))),
    );
    app.get("/freeze-runtime.json",async(_req,reply)=>reply.header("cache-control","public,max-age=0,must-revalidate").type("application/json").send(await readFile(new URL("freeze-runtime.json",dist))));
    app.get("/THIRD_PARTY_NOTICES.txt", async (_req, reply) =>
      reply
        .header("cache-control","public,max-age=0,must-revalidate")
        .type("text/plain")
        .send(await readFile(new URL("THIRD_PARTY_NOTICES.txt", dist))),
    );
    app.get("/assets/:file", async (req, reply) => {
      const file = req.params.file;
      if (!assets.has(file) || !/^[-\w.]+$/.test(file))
        return reply.code(404).send();
      return reply
        .header("cache-control","public,max-age=0,must-revalidate")
        .type(file.endsWith(".js") ? "application/javascript" : "text/css")
        .send(await readFile(new URL(`assets/${file}`, dist)));
    });
    await app.listen({ host: "127.0.0.1", port });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext(),
      page = await context.newPage(),
      anon = await browser.newContext(),
      publicPage = await anon.newPage(),
      errors = [];
    for (const p of [page, publicPage]) {
      p.setDefaultTimeout(25000);
      p.on("pageerror", (e) => errors.push(e.message));
    }
    const login = await context.request.post(`${origin}/api/v1/auth/login`, {
      headers: { origin },
      data: { tenantId, subject, password },
    });
    assert.equal(login.status(), 200, await login.text());
    const session = await (
      await context.request.get(`${origin}/api/v1/auth/session`)
    ).json();
    const privateApi = async (method, path, data) => {
      const response = await context.request.fetch(
        `${origin}/api/v1/tenants/${tenantId}${path}`,
        {
          method,
          headers: { origin, "x-csrf-token": session.csrfToken },
          ...(data === undefined ? {} : { data }),
        },
      );
      assert(
        response.ok(),
        `${method} ${path}: ${response.status()} ${await response.text()}`,
      );
      return response.json();
    };
    const click = (name) =>
      page.getByRole("button", { name, exact: true }).click();
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
        .poll(async () => JSON.stringify((await stored()).draft.candidate))
        .toBe(JSON.stringify(expected));
      await expect(page.getByTestId("local-state")).toContainText(
        "로컬 version",
      );
    };
    const remoteSave = async () => {
      await saved();
      const record = await stored();
      await click(
        record.remote
          ? "기록된 ETag로 서버 저장"
          : "현재 계정에 새 서버 전시 저장",
      );
      await expect(page.getByRole("status", { name: "전시 편집 상태", exact: true })).toContainText("서버 revision");
      await expect
        .poll(async () => (await stored()).remote?.etag ?? "")
        .not.toBe("");
      await saved();
    };
    const publicApi = (id) =>
      anon.request.get(`${origin}/api/v1/publications/${id}`, {
        headers: { "cache-control": "no-cache" },
      });
    const visiblePublic = async () => {
      await expect(publicPage.getByTestId("public-state")).toContainText(
        "서버가 현재 공개 상태",
      );
      const start3D = publicPage.getByRole("button", { name: "3D 관람 시작", exact: true });
      if (await start3D.count()) await start3D.click();
      await expect(
        publicPage.getByTestId("geometry-render-state"),
      ).toContainText("승인된 작품 derivative 2개");
      await expect(
        publicPage.locator(".geometry-preview canvas"),
      ).toBeVisible();
    };
    let original,
      localId,
      draftId,
      publicationId,
      publicUrl,
      publicResponse,
      firstPublicHash;
    const hiddenMarker = "DO_NOT_PUBLISH_PRIVATE_EXTENSION";
    await check(
      "production Studio READY shows safe failure codes and actionable remediation, then corrected approved GLB/PNG snapshots become READY",
      async () => {
        await page.goto(`${origin}/studio`);
        await expect(page.getByTestId("shell-status")).toContainText(
          "오프라인 앱 준비 완료",
        );
        await click("새 로컬 전시");
        await click("현재 서버 계정 확인");
        await click("두 방 template 복제");await saved();
        const templateBefore=await candidate();assert.equal(templateBefore.rooms.length,2);
        // Keep the original GLB/PNG camera sightline in room1 unobstructed.
        // Customize room2 through the real target-room control instead.
        await page.getByLabel('건축 대상 방',{exact:true}).selectOption(templateBefore.rooms[1].id);
        await page.getByLabel('건축 유형',{exact:true}).selectOption('curve');await click('건축 추가');await saved();
        await page.getByLabel('건축 유형',{exact:true}).selectOption('stairs');await click('건축 추가');await saved();
        await page.getByLabel('자연광 hour',{exact:true}).fill('8');await saved();
        const customized=await candidate();assert.equal(customized.surfaces.length,24);assert.equal(customized.openings.filter(o=>o.type==='window').length,1);
        assert.deepEqual(customized.surfaces.slice(0,12),templateBefore.surfaces);
        assert(customized.surfaces.slice(12).every(surface=>surface.roomId===templateBefore.rooms[1].id));
        const templateLocalId=await page.getByTestId('draft-id').innerText();await page.reload();await page.getByTestId(`draft-${templateLocalId}`).click();await saved();await click('현재 서버 계정 확인');
        for (const id of artworkIds) {
          await page.getByLabel("CMS 작품 ID", { exact: true }).fill(id);
          await click("승인된 CMS 작품 가져오기");
          await expect(
            page.getByLabel("배치할 작품", { exact: true }).locator("option"),
          ).toHaveCount(artworkIds.indexOf(id) + 2);
          await click("실제 크기로 작품 배치");
        }
        const doc = await candidate();
        doc.title = "Synthetic published exhibition";
        doc.extensions = {
          ...doc.extensions,
          "org.synthetic.fixture/private": { notes: hiddenMarker },
        };
        const sculpture = doc.placements[0],
          painting = doc.placements[1];
        sculpture.transform.position = [-2, 1, -2];
        painting.transform.position = [0, 2, -3.98];
        doc.extensions["org.exhibitos.studio/presentation"] = {
          version: 1,
          startCamera: {
            roomId: doc.rooms[0].id,
            position: [0, 1.6, 3],
            target: [0, 1.6, -3],
            fov: 45,
          },
          viewpoints: [],
          credits: "Synthetic public exhibition credits",
        };
        await page
          .getByLabel("전시 문서 JSON", { exact: true })
          .fill(JSON.stringify(doc, null, 2));
        await saved();
        original = await candidate();
        localId = await page.getByTestId("draft-id").innerText();
        draftId = (await stored()).draft.exhibitionId;
        const unlicensed=structuredClone(original);unlicensed.extensions['org.exhibitos.studio/template'].license='private';
        await page.getByLabel('전시 문서 JSON',{exact:true}).fill(JSON.stringify(unlicensed));await remoteSave();await click('서버 revision READY 검사');
        await expect(page.getByTestId('ready-state')).toHaveText('BLOCKED');await expect(page.getByRole('region',{name:'READY 검사 결과'})).toContainText('TEMPLATE_REDISTRIBUTION_DENIED');
        const deniedPublish=await context.request.post(`${origin}/api/v1/tenants/${tenantId}/studio/exhibitions/${draftId}/publications`,{headers:{origin,'x-csrf-token':session.csrfToken,'if-match':(await stored()).remote.etag},data:{requestId:crypto.randomUUID()}});assert.equal(deniedPublish.status(),422);assert.equal((await deniedPublish.json()).code,'PUBLICATION_NOT_READY');
        const bad = structuredClone(original);
        bad.artworks[0].dimensions.width += 0.2;
        await page
          .getByLabel("전시 문서 JSON", { exact: true })
          .fill(JSON.stringify(bad, null, 2));
        await remoteSave();
        await click("서버 revision READY 검사");
        await expect(page.getByTestId("ready-state")).toHaveText("BLOCKED");
        await expect(
          page.getByRole("region", { name: "READY 검사 결과" }),
        ).toContainText("ARTWORK_SNAPSHOT_CHANGED");
        await expect(
          page.getByRole("region", { name: "READY 검사 결과" }),
        ).toContainText("수정 안내:");
        await expect(
          page.getByRole("button", {
            name: "READY revision 공개",
            exact: true,
          }),
        ).toBeDisabled();
        await page
          .getByLabel("전시 문서 JSON", { exact: true })
          .fill(JSON.stringify(original, null, 2));
        await remoteSave();
        await click("서버 revision READY 검사");
        await expect(page.getByTestId("ready-state")).toHaveText("READY");
        await expect(
          page.getByRole("button", {
            name: "READY revision 공개",
            exact: true,
          }),
        ).toBeEnabled();
      },
    );
    await check(
      "explicit READY publication produces immutable anonymous URL and private drafts remain inaccessible",
      async () => {
        await click("READY revision 공개");
        await expect(page.getByTestId("publication-status")).toContainText(
          "immutable Publication",
        );
        const link = page.getByRole("link", {
          name: "익명 공개 preview 열기",
          exact: true,
        });
        publicUrl = await link.getAttribute("href");
        publicationId = publicUrl.split("/")[2];
        const response = await publicApi(publicationId);
        assert.equal(response.status(), 200);
        assert.equal(response.headers()["cache-control"], "no-store");
        publicResponse = await response.json();
        firstPublicHash = publicResponse.publication.revisionSha256;
        assert.equal(publicResponse.exhibition.extensions['org.exhibitos.studio/template'].license,'CC0-1.0');
        assert.equal(publicResponse.exhibition.extensions['org.exhibitos.studio/template'].creator,'ExhibitOS contributors');
        assert.equal(publicResponse.exhibition.extensions['org.exhibitos.studio/daylight'].hour,8);
        assert.equal(publicResponse.exhibition.rooms.length,2);assert.equal(publicResponse.exhibition.surfaces.length,24);
        assert(publicResponse.exhibition.surfaces.slice(12).every(surface=>surface.roomId===publicResponse.exhibition.rooms[1].id));
        const serialized = JSON.stringify(publicResponse);
        for (const forbidden of [
          hiddenMarker,
          tenantId,
          draftId,
          session.userId,
          "org.exhibitos.studio/cms",
          "object_key",
          "objectKey",
          ...artworkIds,
        ])
          assert(
            !serialized.includes(forbidden),
            `Public projection leaked ${forbidden}`,
          );
        const denied = await anon.request.get(
          `${origin}/api/v1/tenants/${tenantId}/studio/exhibitions/${draftId}`,
        );
        assert.equal(denied.status(), 401);
        assert.deepEqual(await anon.cookies(), []);
        // Install the real public Studio shell in the anonymous profile before
        // visiting a publication; it must never cache metadata or asset bytes.
        await publicPage.goto(`${origin}/studio`);
        await expect(publicPage.getByTestId("shell-status")).toContainText(
          "오프라인 앱 준비 완료",
        );

        await expect(
          page.getByLabel("전시 문서 JSON", { exact: true }),
        ).toBeDisabled();
        await expect(
          page.getByLabel("전시 제목", { exact: true }),
        ).toBeDisabled();
      },
    );
    await check(
      "anonymous production preview renders real hash-qualified GLB/PNG derivatives with no authoring/CMS requests and list alternative",
      async () => {
        const requests = [];
        publicPage.on("request", (request) =>
          requests.push(new URL(request.url()).pathname),
        );
        await publicPage.goto(`${origin}${publicUrl}`);
        await publicPage.getByRole("button", { name: "3D 관람 시작", exact: true }).click();
        await visiblePublic();
        await publicPage
          .getByRole("button", { name: "시작 camera 보기", exact: true })
          .click();
        const colorful = await publicPage
          .locator(".geometry-preview canvas")
          .evaluate((canvas) => {
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
            let count = 0;
            for (let i = 0; i < data.length; i += 4)
              if (
                Math.max(data[i], data[i + 1], data[i + 2]) -
                  Math.min(data[i], data[i + 1], data[i + 2]) >
                45
              )
                count++;
            return count;
          });
        const renderDir = await mkdtemp(`${tmpdir()}/exhibitos-publication-render-`);
        const renderScreenshot = `${renderDir}/anonymous-derivative-pixels.png`;
        await publicPage.locator('.geometry-preview').screenshot({path:renderScreenshot});
        screenshots.push(renderScreenshot);
        console.log(JSON.stringify({publicDerivativePixels:colorful,renderScreenshot}));
        assert(colorful > 200, `Actual public GLB/PNG pixels: ${colorful}; screenshot ${renderScreenshot}`);
        assert(
          !requests.some(
            (path) => path.includes("/tenants/") || path.includes("/cms/"),
          ),
          JSON.stringify(requests),
        );
        await expect(
          publicPage.getByRole("region", { name: "작품 목록형 대체 보기" }),
        ).toBeVisible();
        for (const asset of publicResponse.assets) {
          const response = await anon.request.get(`${origin}${asset.url}`);
          assert.equal(response.status(), 200);
          assert.equal(response.headers()["cache-control"], "no-store");
          assert.equal(
            response.headers()["x-exhibitos-publication-revision"],
            firstPublicHash,
          );
          assert.notEqual(
            response.headers()["content-type"],
            "application/json",
          );
        }
        const dir = await mkdtemp(`${tmpdir()}/exhibitos-publication-`);
        screenshots.push(`${dir}/anonymous-preview.png`);
        await publicPage
          .locator(".geometry-preview")
          .screenshot({ path: screenshots.at(-1) });
        await publicPage.setViewportSize({ width: 375, height: 812 });
        assert.equal(
          await publicPage.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        const camera = publicPage.getByRole("button", {
          name: "시점 왼쪽 회전",
          exact: true,
        });
        await camera.focus();
        await publicPage.keyboard.press("Enter");
        await expect(camera).toBeFocused();
        screenshots.push(`${dir}/anonymous-mobile.png`);
        await publicPage.screenshot({
          path: screenshots.at(-1),
          fullPage: true,
        });
      },
    );
    await check(
      "published edits fork a separate local and remote draft while anonymous immutable revision remains unchanged",
      async () => {
        await click("공개 revision에서 새 로컬 draft");
        await expect(page.getByTestId("draft-id")).not.toHaveText(localId);
        await page
          .getByLabel("전시 제목", { exact: true })
          .fill("Unpublished next draft");
        await remoteSave();
        const next = await stored();
        assert.notEqual(next.draft.exhibitionId, draftId);
        const response = await publicApi(publicationId);
        assert.equal(response.status(), 200);
        const current = await response.json();
        assert.equal(current.publication.revisionSha256, firstPublicHash);
        assert.equal(current.exhibition.title, original.title);
        await page.getByTestId(`draft-${localId}`).click();
        await click("Publication 상태 다시 읽기");
        await expect(
          page.getByLabel("전시 문서 JSON", { exact: true }),
        ).toBeDisabled();
      },
    );
    await check(
      "unpublish clears anonymous preview and invalidates cached metadata/assets without ETag or service-worker bypass; explicit republish restores same immutable URL",
      async () => {
        await click("Publication 철회");
        await expect(page.getByTestId("publication-status")).toContainText(
          "철회했습니다",
        );
        const response = await anon.request.get(
          `${origin}/api/v1/publications/${publicationId}`,
          { headers: { "if-none-match": firstPublicHash } },
        );
        assert.equal(response.status(), 404);
        assert.equal(response.headers()["cache-control"], "no-store");
        for (const asset of publicResponse.assets)
          assert.equal(
            (await anon.request.get(`${origin}${asset.url}`)).status(),
            404,
          );
        await publicPage
          .getByRole("button", { name: "공개 상태 다시 확인", exact: true })
          .click();
        await expect(publicPage.getByTestId("public-state")).toContainText(
          "공개 전시를 확인할 수 없습니다",
        );
        await expect(
          publicPage.locator(".geometry-preview canvas"),
        ).toHaveCount(0);
        await expect(
          publicPage.getByRole("heading", {
            name: original.title,
            exact: true,
          }),
        ).toHaveCount(0);
        await click("기존 Publication 다시 공개");
        await expect(page.getByTestId("publication-status")).toContainText(
          "다시 공개했습니다",
        );
        await publicPage
          .getByRole("button", { name: "공개 상태 다시 확인", exact: true })
          .click();
        await visiblePublic();
        assert.equal(
          (await (await publicApi(publicationId)).json()).publication
            .revisionSha256,
          firstPublicHash,
        );
      },
    );
    await check(
      "current artwork rights revocation fails anonymous metadata and every derivative closed, clearing a previously loaded browser projection",
      async () => {
        const artwork = await privateApi(
          "GET",
          `/cms/artworks/${artworkIds[1]}`,
        );
        await privateApi("PATCH", `/cms/artworks/${artwork.id}`, {
          revision: artwork.revision,
          ...artwork.metadata,
          rights: {
            ...artwork.metadata.rights,
            permissions: {
              ...artwork.metadata.rights.permissions,
              display: false,
            },
          },
        });
        assert.equal((await publicApi(publicationId)).status(), 404);
        for (const asset of publicResponse.assets) {
          const denied = await anon.request.get(`${origin}${asset.url}`, {
            headers: { "if-none-match": firstPublicHash },
          });
          assert.equal(denied.status(), 404);
          assert.equal(denied.headers()["cache-control"], "no-store");
        }
        await publicPage
          .getByRole("button", { name: "공개 상태 다시 확인", exact: true })
          .click();
        await expect(publicPage.getByTestId("public-state")).toContainText(
          "공개 전시를 확인할 수 없습니다",
        );
        await expect(
          publicPage.locator(".geometry-preview canvas"),
        ).toHaveCount(0);
        assert.deepEqual(errors, []);
      },
    );
    await anon.close();
    await context.close();
    return { checks, screenshots };
  } finally {
    await browser?.close();
    await app?.close();
  }
}
