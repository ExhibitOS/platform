import assert from "node:assert/strict";
import { createServer } from "node:net";
import { readFile, readdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";
import { fixtureURL } from "@exhibitos/spec";
import { buildApp } from "../apps/api/dist/app.js";

// Production web bytes and real PostgreSQL/API/storage/worker. Only the owned
// synthetic PUT connection is aborted to exercise retry; responses are not mocked.
export async function runCmsBrowser({
  pool,
  blobs,
  tenantId,
  subject,
  password,
  otherSubject,
  work,
}) {
  const evidence = [],
    screenshots = [];
  const check = async (title, fn) => {
    await fn();
    evidence.push(title);
  };
  const dist = new URL("../apps/web/dist/", import.meta.url),
    assetNames = new Set(await readdir(new URL("assets/", dist)));
  let app, browser, origin;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const reserve = createServer();
      await new Promise((resolve, reject) => {
        reserve.once("error", reject);
        reserve.listen(0, "127.0.0.1", resolve);
      });
      const port = reserve.address().port;
      await new Promise((resolve) => reserve.close(resolve));
      origin = `http://127.0.0.1:${port}`;
      app = buildApp({
        pool,
        blobs,
        auth: { mode: "local", origin, bindHost: "127.0.0.1" },
      });
      app.get("/cms", async (_req, reply) =>
        reply
          .type("text/html")
          .send(await readFile(new URL("index.html", dist), "utf8")),
      );
      app.get("/assets/:file", async (req, reply) => {
        const name = req.params.file;
        if (!assetNames.has(name) || !/^[-\w.]+$/.test(name))
          return reply.code(404).send();
        return reply
          .type(
            name.endsWith(".js")
              ? "application/javascript"
              : name.endsWith(".css")
                ? "text/css"
                : "application/octet-stream",
          )
          .send(await readFile(new URL(`assets/${name}`, dist)));
      });
      try {
        await app.listen({ host: "127.0.0.1", port });
        break;
      } catch (error) {
        await app.close();
        if (error.code !== "EADDRINUSE" || attempt === 2) throw error;
      }
    }
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext(),
      page = await context.newPage(),
      pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.setDefaultTimeout(15000);
    await check(
      "built CMS: actual login cookie, distinct artist identity, metadata escaped as text",
      async () => {
        await page.goto(`${origin}/cms`);
        await page.getByLabel("기관 ID", { exact: true }).fill(tenantId);
        await page.getByLabel("계정", { exact: true }).fill(subject);
        await page.getByLabel("비밀번호", { exact: true }).fill(password);
        await page.getByRole("button", { name: "로그인", exact: true }).click();
        await expect(
          page.getByRole("button", { name: "로그아웃", exact: true }),
        ).toBeVisible();
        const cookies = await context.cookies();
        assert(
          cookies.some(
            (c) => c.httpOnly && c.name === "exhibitos_local_session",
          ),
        );
        assert.equal(await page.evaluate(() => localStorage.length), 0);
        await page.getByRole("button", { name: "작가", exact: true }).click();
        await page
          .getByLabel("작가 이름", { exact: true })
          .fill("Synthetic browser artist");
        await page
          .getByLabel("작가 소개", { exact: true })
          .fill(
            '<script>throw new Error("untrusted")</script> Synthetic fixture only.',
          );
        await page
          .getByRole("button", { name: "작가 저장", exact: true })
          .click();
        await expect(page.getByRole("status")).toContainText(
          "작가 identity를 저장했습니다",
        );
        const rows = (
          await pool.query(
            "SELECT a.id,a.user_id FROM artists a JOIN users u ON u.id=a.user_id WHERE a.tenant_id=$1 AND u.subject=$2 ORDER BY a.created_at DESC",
            [tenantId, subject],
          )
        ).rows;
        assert(rows.length);
        assert.notEqual(rows[0].id, rows[0].user_id);
        await page
          .getByLabel("이전 작가 revision", { exact: true })
          .selectOption("1");
        await expect(page.locator(".cms-comparison pre").first()).toContainText(
          "<script>",
        );
        assert.equal(pageErrors.length, 0);
      },
    );
    async function createArtwork(title) {
      await page.getByRole("button", { name: "작품", exact: true }).click();
      await page.getByRole("button", { name: "새 작품", exact: true }).click();
      await page.getByLabel("작품 제목", { exact: true }).fill(title);
      await page
        .getByLabel("작품 설명", { exact: true })
        .fill("Synthetic CC0 fixture. No actual artwork.");
      await page.getByLabel("너비", { exact: true }).fill("0.8");
      await page.getByLabel("높이", { exact: true }).fill("1.2");
      await page.getByLabel("깊이", { exact: true }).fill("0.1");
      await page
        .getByLabel("권리자", { exact: true })
        .fill("ExhibitOS synthetic fixture authors");
      await page
        .getByLabel("권리·크레딧 고지", { exact: true })
        .fill("Synthetic CC0 fixture — display derivative");
      await page
        .getByLabel("출처·단위 변환 메모", { exact: true })
        .fill("Meters already represented in the synthetic fixture.");
      const pending = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" && r.url().endsWith("/cms/artworks"),
      );
      await page
        .getByRole("button", { name: "작품 메타데이터 저장", exact: true })
        .click();
      const response = await pending;
      assert.equal(response.status(), 201, await response.text());
      const artwork = await response.json();
      await expect(page.getByRole("status")).toContainText(
        "작품 메타데이터를 저장했습니다",
      );
      return artwork.id;
    }
    const sculpture = await createArtwork("Browser sculpture");
    await check(
      "actual upload disconnect resumes same idempotent job, worker validates and UI approves revision",
      async () => {
        const bytes = await readFile(
          fixtureURL("fixtures/synthetic/sculpture.glb"),
        );
        await page
          .getByLabel("작품 파일", { exact: true })
          .setInputFiles({
            name: "synthetic.glb",
            mimeType: "model/gltf-binary",
            buffer: bytes,
          });
        await page.getByLabel("권리자", {exact:true}).fill("");
        const invalid = page.waitForResponse(r => r.request().method()==="POST" && r.url().endsWith("/imports"));
        await page.getByRole("button", {name:"파일 업로드·검사 요청",exact:true}).click();
        assert.equal((await invalid).status(),400);
        await expect(page.getByRole("status")).toContainText("입력 형식을 확인");
        assert.equal((await pool.query("SELECT count(*) FROM import_jobs WHERE tenant_id=$1 AND artwork_id=$2",[tenantId,sculpture])).rows[0].count,"0");
        await page.getByLabel("권리자", {exact:true}).fill("ExhibitOS synthetic fixture authors");
        let initInterrupted = false;
        await page.route("**/imports", async (route) => {
          if (!initInterrupted && route.request().method() === "POST") {
            initInterrupted = true;
            // Commit against the actual API, then lose its response: the client
            // must recover the original intent without creating another job.
            const real = await route.fetch();
            assert.equal(real.status(), 201, await real.text());
            await route.abort("connectionreset");
          } else await route.continue();
        });
        let interrupted = false;
        await page.route("**/imports/*/bytes", async (route) => {
          if (!interrupted) {
            interrupted = true;
            await route.abort("connectionreset");
          } else await route.continue();
        });
        await page
          .getByRole("button", { name: "파일 업로드·검사 요청", exact: true })
          .click();
        await expect(page.getByRole("status")).toContainText(
          "연결 또는 처리에 실패",
        );
        await page.getByLabel("파일의 미터 scale", {exact:true}).fill("2");
        await page.getByRole("button", {name:"파일 업로드·검사 요청",exact:true}).click();
        await expect(page.getByRole("status")).toContainText("파일 또는 권리 입력이 바뀌었습니다");
        await page.getByRole("button", {name:"이전 업로드 요청 찾기",exact:true}).click();
        await expect(page.getByRole("status")).toContainText("이전 요청의 파일·권리·scale과 동일한 검사 요청을 찾았습니다");
        await page.unroute("**/imports");
        await page.getByLabel("파일의 미터 scale", {exact:true}).fill("1");
        await page.getByRole("button", {name:"파일 업로드 재시도",exact:true}).click();
        await expect(page.getByRole("status")).toContainText("연결 또는 처리에 실패");
        const before = (
          await pool.query(
            "SELECT id FROM import_jobs WHERE tenant_id=$1 AND artwork_id=$2",
            [tenantId, sculpture],
          )
        ).rows;
        assert.equal(before.length, 1);
        let completeInterrupted = false;
        await page.route("**/imports/*/complete", async (route) => {
          if (!completeInterrupted) {
            completeInterrupted = true;
            await route.abort("connectionreset");
          } else await route.continue();
        });
        await page
          .getByRole("button", { name: "파일 업로드 재시도", exact: true })
          .click();
        await expect(page.getByRole("status")).toContainText(
          "연결 또는 처리에 실패",
        );
        await expect(page.getByTestId("import-state")).toContainText(
          "uploading",
        );
        await page
          .getByRole("button", { name: "업로드 완료 재시도", exact: true })
          .click();
        await expect(page.getByTestId("import-state")).toContainText("queued");
        await page.unroute("**/imports/*/bytes");
        await page.unroute("**/imports/*/complete");
        const after = (
          await pool.query(
            "SELECT id FROM import_jobs WHERE tenant_id=$1 AND artwork_id=$2",
            [tenantId, sculpture],
          )
        ).rows;
        assert.deepEqual(after, before);
        await work();
        await expect(page.getByTestId("import-state")).toContainText(
          "approved",
        );
        await page
          .getByRole("button", { name: "검사된 파일 목록 읽기", exact: true })
          .click();
        await expect(
          page.getByLabel("검사 승인된 파일", { exact: true }),
        ).not.toHaveValue("");
        assert.equal(await page.getByLabel("작품 파일", {exact:true}).evaluate(input => input.files.length),0);
        await page
          .getByRole("button", { name: "현재 revision 검토 승인", exact: true })
          .click();
        await expect(page.getByRole("status")).toContainText(
          "검토 승인했습니다",
        );
      },
    );
    await check(
      "GLB display derivative renders actual WebGL; original/export remain denied independently",
      async () => {
        await page
          .getByRole("button", { name: "전시용 미리보기", exact: true })
          .click();
        await expect(page.locator(".cms-preview figcaption")).toContainText(
          "전시용 3D 미리보기. 아래 버튼으로 회전할 수 있습니다.",
        );
        await expect(page.locator("canvas")).toHaveCount(1);
        await page
          .getByRole("button", { name: "오른쪽 회전", exact: true })
          .click();
        const canvasImage = await page.locator("canvas").screenshot();
        const redPixels = await page.evaluate(async (base64) => {
          const img = new Image();
          img.src = `data:image/png;base64,${base64}`;
          await img.decode();
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let count = 0;
          for (let i = 0; i < data.length; i += 4)
            if (
              data[i] > 100 &&
              data[i] > data[i + 1] * 2 &&
              data[i] > data[i + 2] * 2
            )
              count++;
          return count;
        }, canvasImage.toString("base64"));
        assert(
          redPixels > 10,
          `Actual GLB preview should visibly render red display watermark; pixels=${redPixels}`,
        );
        const location = await mkdtemp(`${tmpdir()}/exhibitos-cms-ui-`);
        screenshots.push(`${location}/glb-preview.png`);
        await page.screenshot({ path: screenshots.at(-1), fullPage: true });
        const denied = page.waitForResponse(
          (r) => r.url().endsWith("/bytes") && r.request().method() === "GET",
        );
        await page
          .getByRole("button", { name: "원본 접근 확인", exact: true })
          .click();
        assert.equal((await denied).status(), 403);
        await expect(page.getByRole("status")).toContainText("서버가 권한");
        const exported = page.waitForResponse((r) =>
          r.url().endsWith("/export-check"),
        );
        await page
          .getByRole("button", { name: "내보내기 권리 확인", exact: true })
          .click();
        assert.equal((await exported).status(), 403);
        await expect(page.locator("canvas")).toHaveCount(1);
      },
    );
    await check(
      "real stale revision conflict retains unsaved input and allows explicit history comparison/reload",
      async () => {
        const session = await (
          await context.request.get(`${origin}/api/v1/auth/session`)
        ).json();
        const path = `${origin}/api/v1/tenants/${tenantId}/cms/artworks/${sculpture}`,
          detail = await (await context.request.get(path)).json();
        const changed = await context.request.patch(path, {
          headers: { origin, "x-csrf-token": session.csrfToken },
          data: {
            revision: detail.revision,
            ...detail.metadata,
            description: "Concurrent server edit",
          },
        });
        assert.equal(changed.status(), 200, await changed.text());
        await page
          .getByLabel("작품 설명", { exact: true })
          .fill("UNSAVED browser input");
        await page
          .getByRole("button", { name: "작품 메타데이터 저장", exact: true })
          .click();
        await expect(page.getByRole("status")).toContainText(
          "입력은 보존되었습니다",
        );
        await expect(page.getByLabel("작품 설명", { exact: true })).toHaveValue(
          "UNSAVED browser input",
        );
        await page
          .getByLabel("이전 revision", { exact: true })
          .selectOption("1");
        await expect(page.locator(".cms-comparison pre").last()).toContainText(
          "UNSAVED browser input",
        );
        await page
          .getByRole("button", { name: "서버 내용 새로 읽기", exact: true })
          .click();
        await expect(page.getByLabel("작품 설명", { exact: true })).toHaveValue(
          "Concurrent server edit",
        );
        await expect(
          page.getByRole("button", { name: "전시용 미리보기", exact: true }),
        ).toBeDisabled();
      },
    );
    const painting = await createArtwork("Browser painting");
    await check(
      "PNG upload/worker/approved watermarked image, physical dimensions and complete rights edit",
      async () => {
        const source = await readFile(
            fixtureURL("fixtures/synthetic/painting.png"),
          ),
          chunks = [source.subarray(0, 8)];
        // CC0 synthetic painting fixture: strip ancillary metadata to the supported
        // IHDR/IDAT/IEND import profile; keep original critical chunk bytes/CRCs.
        for (let offset = 8; offset < source.length;) {
          const length = source.readUInt32BE(offset),
            end = offset + length + 12,
            type = source.toString("ascii", offset + 4, offset + 8);
          if (["IHDR", "IDAT", "IEND"].includes(type))
            chunks.push(source.subarray(offset, end));
          offset = end;
        }
        const bytes = Buffer.concat(chunks);
        await page
          .getByLabel("작품 파일", { exact: true })
          .setInputFiles({
            name: "synthetic.png",
            mimeType: "image/png",
            buffer: bytes,
          });
        await page
          .getByRole("button", { name: "파일 업로드·검사 요청", exact: true })
          .click();
        await expect(page.getByTestId("import-state")).toContainText("queued");
        await work();
        await expect(page.getByTestId("import-state")).toContainText(
          "approved",
        );
        await page
          .getByRole("button", { name: "검사된 파일 목록 읽기", exact: true })
          .click();
        await page
          .getByRole("button", { name: "현재 revision 검토 승인", exact: true })
          .click();
        await expect(page.getByRole("status")).toContainText(
          "검토 승인했습니다",
        );
        await page
          .getByRole("button", { name: "전시용 미리보기", exact: true })
          .click();
        await expect(page.locator(".cms-preview img")).toBeVisible();
        assert(
          await page
            .locator(".cms-preview img")
            .evaluate((img) => img.complete && img.naturalWidth > 0),
        );
        await expect(page.locator(".cms-preview figcaption")).toContainText(
          "워터마크가 포함된 전시용 이미지입니다.",
        );
        await page.getByLabel("원본 다운로드 허용", { exact: true }).check();
        await page
          .getByLabel("효력 시작 (UTC)", { exact: true })
          .fill("2020-01-01T00:00:00Z");
        await page
          .getByRole("button", { name: "작품 메타데이터 저장", exact: true })
          .click();
        await expect(page.getByRole("status")).toContainText(
          "작품 메타데이터를 저장했습니다",
        );
        await expect(
          page.getByRole("button", { name: "전시용 미리보기", exact: true }),
        ).toBeDisabled();
        const downloaded = page.waitForEvent("download");
        await page
          .getByRole("button", { name: "원본 접근 확인", exact: true })
          .click();
        const download = await downloaded;
        assert.equal(await download.failure(), null);
        const detail = await (
          await context.request.get(
            `${origin}/api/v1/tenants/${tenantId}/cms/artworks/${painting}`,
          )
        ).json();
        assert.equal(detail.metadata.dimensions.height, 1.2);
        assert.equal(detail.metadata.rights.validFrom, "2020-01-01T00:00:00Z");
        assert.equal(detail.metadata.rights.permissions.download, true);
        assert.equal(detail.metadata.rights.permissions.export, false);
      },
    );
    await check(
      "reversible artwork archive/restore, filter and narrow viewport keyboard accessibility",
      async () => {
        await page
          .getByRole("button", { name: "작품 보관", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "작품 복원", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByLabel("작품 제목", { exact: true }),
        ).toBeDisabled();
        await page
          .getByRole("button", { name: "작품 복원", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "작품 보관", exact: true }),
        ).toBeVisible();
        await page
          .getByLabel("작품 제목 검색", { exact: true })
          .fill("Browser painting");
        await page.getByRole("button", { name: "검색", exact: true }).click();
        await expect(page.locator(".cms-list li")).toHaveCount(1);
        await expect(page.locator(".cms-list li")).toContainText(
          "Browser painting",
        );
        await page.setViewportSize({ width: 375, height: 812 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await page.getByLabel("작품 제목 검색", { exact: true }).focus();
        await page.keyboard.press("Tab");
        await expect(
          page.getByRole("button", { name: "검색", exact: true }),
        ).toBeFocused();
        const location = await mkdtemp(`${tmpdir()}/exhibitos-cms-ui-`);
        screenshots.push(`${location}/mobile-cms.png`);
        await page.screenshot({ path: screenshots.at(-1), fullPage: true });
        assert.equal(pageErrors.length, 0, JSON.stringify(pageErrors));
      },
    );
    await page.getByRole("button", { name: "작가", exact: true }).click();
    await page.getByRole("button", { name: "새 작가", exact: true }).click();
    await page
      .getByLabel("작가 이름", { exact: true })
      .fill("PRIVATE UNSAVED A");
    await page
      .getByLabel("작가 소개", { exact: true })
      .fill("PRIVATE UNSAVED BIO A");
    await check(
      "logout revokes actual session and clears workspace UI",
      async () => {
        await page
          .getByRole("button", { name: "로그아웃", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name: "CMS 로그인", exact: true }),
        ).toBeVisible();
        assert.equal(
          (await context.request.get(`${origin}/api/v1/auth/session`)).status(),
          401,
        );
      },
    );
    if (otherSubject)
      await check(
        "different actual login account never receives previous private profile drafts/history",
        async () => {
          await page.getByLabel("기관 ID", { exact: true }).fill(tenantId);
          await page.getByLabel("계정", { exact: true }).fill(otherSubject);
          await page.getByLabel("비밀번호", { exact: true }).fill(password);
          await page
            .getByRole("button", { name: "로그인", exact: true })
            .click();
          await expect(
            page.getByRole("button", { name: "로그아웃", exact: true }),
          ).toBeVisible();
          await expect(
            page.getByRole("button", { name: "작품", exact: true }),
          ).toHaveAttribute("aria-pressed", "true");
          await page.getByRole("button", { name: "작가", exact: true }).click();
          await expect(
            page.getByLabel("작가 이름", { exact: true }),
          ).toHaveValue("");
          await expect(
            page.getByLabel("작가 소개", { exact: true }),
          ).toHaveValue("");
          await expect(
            page.getByText("PRIVATE UNSAVED A", { exact: true }),
          ).toHaveCount(0);
          await expect(
            page.getByLabel("이전 작가 revision", { exact: true }),
          ).toHaveCount(0);
          assert.equal(pageErrors.length, 0, JSON.stringify(pageErrors));
        },
      );
    return { checks: evidence, screenshots };
  } finally {
    await browser?.close();
    await app?.close();
  }
}
