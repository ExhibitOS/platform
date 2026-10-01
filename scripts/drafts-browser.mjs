import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { readFile, readdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";
import { fixtureURL } from "@exhibitos/spec";
import { buildApp } from "../apps/api/dist/app.js";

export async function runDraftsBrowser({
  pool,
  blobs,
  tenantId,
  subject,
  password,
  otherSubject,
}) {
  const checks = [],
    screenshots = [];
  const check = async (title, work) => {
    await work();
    checks.push(title);
  };
  const dist = new URL("../apps/web/dist/", import.meta.url),
    files = new Set(await readdir(new URL("assets/", dist)));
  const fixture = JSON.parse(
    await readFile(fixtureURL("oes/v1/examples/draft.json"), "utf8"),
  );
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
      for (const route of ["/studio", "/cms"])
        app.get(route, async (_req, reply) =>
          reply
            .header("cache-control", "public,max-age=0")
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
          .header("cache-control", "public,max-age=0")
          .type("text/plain")
          .send(await readFile(new URL("THIRD_PARTY_NOTICES.txt", dist))),
      );
      app.get("/assets/:file", async (req, reply) => {
        const file = req.params.file;
        if (!files.has(file) || !/^[-\w.]+$/.test(file))
          return reply.code(404).send();
        return reply
          .header("cache-control", "public,max-age=31536000,immutable")
          .type(file.endsWith(".js") ? "application/javascript" : "text/css")
          .send(await readFile(new URL(`assets/${file}`, dist)));
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
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.setDefaultTimeout(20000);
    const currentId = () => page.getByTestId("draft-id").innerText();
    const records = async (target = page) =>
      target.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const op = indexedDB.open("exhibitos-studio", 2);
            op.onerror = () => reject(op.error);
            op.onsuccess = () => {
              const db = op.result,
                request = db
                  .transaction("drafts")
                  .objectStore("drafts")
                  .getAll();
              request.onsuccess = () => {
                db.close();
                resolve(request.result);
              };
              request.onerror = () => {
                db.close();
                reject(request.error);
              };
            };
          }),
      );
    const histories = async (id) =>
      page.evaluate(
        (id) =>
          new Promise((resolve, reject) => {
            const op = indexedDB.open("exhibitos-studio", 2);
            op.onerror = () => reject(op.error);
            op.onsuccess = () => {
              const db = op.result,
                request = db
                  .transaction("history")
                  .objectStore("history")
                  .getAll();
              request.onsuccess = () => {
                db.close();
                resolve(request.result.filter((row) => row.id === id));
              };
              request.onerror = () => {
                db.close();
                reject(request.error);
              };
            };
          }),
        id,
      );
    const local = async () => {
      const id = await currentId();
      return (await records()).find((row) => row.id === id);
    };
    async function saved() {
      const candidate = JSON.parse(
        await page.getByLabel("전시 문서 JSON", { exact: true }).inputValue(),
      );
      await expect
        .poll(async () => JSON.stringify((await local())?.draft.candidate))
        .toBe(JSON.stringify(candidate));
      await expect(page.getByTestId("local-state")).toContainText(
        "로컬 version",
      );
    }
    async function login(who) {
      const loginPage = await context.newPage();
      const initialSession = loginPage.waitForResponse(response =>
        response.url() === `${origin}/api/v1/auth/session` && response.request().method() === 'GET');
      await loginPage.goto(`${origin}/cms`);
      const sessionResponse = await initialSession;
      if (sessionResponse.status() === 200) {
        await expect(loginPage.getByRole("button", {name:"로그아웃",exact:true})).toBeVisible();
        await loginPage.getByRole("button", {name:"로그아웃",exact:true}).click();
      }
      await expect(loginPage.getByRole("button", {name:"로그인",exact:true})).toBeEnabled();
      await loginPage.getByLabel("기관 ID", { exact: true }).fill(tenantId);
      await loginPage.getByLabel("계정", { exact: true }).fill(who);
      await loginPage.getByLabel("비밀번호", { exact: true }).fill(password);
      await loginPage
        .getByRole("button", { name: "로그인", exact: true })
        .click();
      await expect(
        loginPage.getByRole("button", { name: "로그아웃", exact: true }),
      ).toBeVisible();
      await loginPage.close();
      await page
        .getByRole("button", { name: "현재 서버 계정 확인", exact: true })
        .click();
      await expect(page.getByRole("status")).toContainText(
        "현재 서버 계정을 확인했습니다",
      );
    }
    await check(
      "account-free local creation, full geometry/placements autosave, true offline shell reload and reopen",
      async () => {
        await page.goto(`${origin}/studio`);
        await expect(page.getByTestId("shell-status")).toContainText(
          "오프라인 앱 준비 완료",
        );
        assert.equal((await context.cookies()).length, 0);
        await page
          .getByRole("button", { name: "새 로컬 전시", exact: true })
          .click();
        await expect(page.getByRole("status")).toContainText(
          "계정 없이 로컬 전시",
        );
        const base = await local(),
          candidate = structuredClone(fixture.candidate);
        candidate.id = base.draft.exhibitionId;
        candidate.title = "Offline geometry preserved";
        candidate.rooms[0].dimensions.width = 14;
        candidate.placements[0].transform.position = [1, 0, 0];
        await page
          .getByLabel("전시 문서 JSON", { exact: true })
          .fill(JSON.stringify(candidate, null, 2));
        await saved();
        const good = await local();
        assert.equal(good.draft.candidate.title, candidate.title);
        assert.deepEqual(good.draft.candidate.rooms, candidate.rooms);
        assert.deepEqual(good.draft.candidate.placements, candidate.placements);
        const cacheControl = await context.newCDPSession(page);
        await cacheControl.send('Network.enable');
        await cacheControl.send('Network.setCacheDisabled', { cacheDisabled: true });
        await context.setOffline(true);
        const offlineNavigation = await page.reload();
        assert.equal(offlineNavigation.fromServiceWorker(), true);
        await page.getByTestId(`draft-${good.id}`).click();
        await expect(page.getByLabel("전시 제목", { exact: true })).toHaveValue(
          candidate.title,
        );
        assert.deepEqual((await local()).draft.candidate, candidate);
        assert.equal((await context.cookies()).length, 0);
        await page
          .getByLabel("전시 제목", { exact: true })
          .fill("Offline edit");
        await saved();
        await page.reload();
        await page.getByTestId(`draft-${good.id}`).click();
        await expect(page.getByLabel("전시 제목", { exact: true })).toHaveValue(
          "Offline edit",
        );
        await context.setOffline(false);
        await cacheControl.detach();
      },
    );
    await check(
      "schema failures retain current/history; real aborted IndexedDB transaction rolls back previous good versions",
      async () => {
        const before = await local(),
          history = await histories(before.id);
        await page
          .getByLabel("전시 문서 JSON", { exact: true })
          .fill("{ broken JSON");
        await expect(page.getByRole("status")).toContainText(
          "전시 JSON의 구조",
        );
        assert.deepEqual(await local(), before);
        assert.deepEqual(await histories(before.id), history);
        await page
          .getByLabel("전시 문서 JSON", { exact: true })
          .fill(JSON.stringify(before.draft.candidate, null, 2));
        await saved();
        await page.evaluate(() => {
          window.__originalIDBTransaction = IDBDatabase.prototype.transaction;
          let abort = true;
          IDBDatabase.prototype.transaction = function (...args) {
            const tx = window.__originalIDBTransaction.apply(this, args);
            if (abort && args[1] === "readwrite") {
              abort = false;
              queueMicrotask(() => tx.abort());
            }
            return tx;
          };
        });
        await page
          .getByLabel("전시 제목", { exact: true })
          .fill("Interrupted save must survive");
        await expect(page.getByRole("status")).toContainText(
          "저장이 중단되었습니다",
        );
        assert.deepEqual(await local(), before);
        assert.deepEqual(await histories(before.id), history);
        await expect(page.getByLabel("전시 제목", { exact: true })).toHaveValue(
          "Interrupted save must survive",
        );
        await page.evaluate(() => {
          IDBDatabase.prototype.transaction = window.__originalIDBTransaction;
          delete window.__originalIDBTransaction;
        });
        await page
          .getByRole("button", { name: "로컬 저장 다시 시도", exact: true })
          .click();
        await saved();
        assert.equal(
          (await local()).draft.candidate.title,
          "Interrupted save must survive",
        );
      },
    );
    await check(
      "actual Chromium origin quota causes failed durable write, preserves current/history and offers both file backups",
      async () => {
        const before = await local(),
          history = await histories(before.id),
          cdp = await context.newCDPSession(page);
        await cdp.send("Storage.overrideQuotaForOrigin", {
          origin,
          quotaSize: 1,
        });
        const usage = await cdp.send("Storage.getUsageAndQuota", { origin });
        assert.equal(usage.quota, 1);
        // Chromium's native IndexedDB bucket quota grant is cached for 30s.
        // Expire that cache before testing the actual lowered quota; no write
        // or mocked exception occurs during this interval.
        // https://chromium.googlesource.com/chromium/src/+/1ef1c1e6d3d38a1f19cb1c21c65c62364c4c60af/content/browser/indexed_db/instance/bucket_context.h
        await page.waitForTimeout(31000);
        // Reopen the real database after lowering quota to discard Chromium's
        // previously reserved small-write budget. Random extension data avoids
        // compression hiding the native allocation being tested.
        await page.reload();
        await page.getByTestId(`draft-${before.id}`).click();
        const quotaCandidate = structuredClone(before.draft.candidate);
        quotaCandidate.title = "Quota unsaved input";
        quotaCandidate.extensions = Object.fromEntries(Array.from({length:32},(_,index)=>[
          `org.exhibitos.synthetic/quota${index}`, {data:randomBytes(11900).toString('base64')}
        ]));
        await page.getByLabel("전시 문서 JSON", {exact:true}).fill(JSON.stringify(quotaCandidate,null,2));
        await expect(page.getByRole("status")).toContainText(
          "브라우저 저장 공간이 부족",
        );
        assert.deepEqual(await local(), before);
        assert.deepEqual(await histories(before.id), history);
        const downloads = [];
        page.on("download", (download) => downloads.push(download));
        await page
          .getByRole("button", {
            name: "저장본·현재 입력 파일 백업",
            exact: true,
          })
          .click();
        await expect.poll(() => downloads.length).toBe(2);
        const inputs = await Promise.all(
          downloads.map(async (file) => ({
            name: file.suggestedFilename(),
            text: await readFile(await file.path(), "utf8"),
          })),
        );
        assert(
          inputs.some(
            (file) =>
              file.name.endsWith(".txt") &&
              file.text.includes("Quota unsaved input"),
          ),
        );
        assert(
          inputs.some(
            (file) =>
              file.name.endsWith(".json") &&
              JSON.parse(file.text).record.version === before.version,
          ),
        );
        await cdp.send("Storage.overrideQuotaForOrigin", { origin });
        await page
          .getByRole("button", { name: "로컬 저장 다시 시도", exact: true })
          .click();
        await saved();
        assert.equal(
          (await local()).draft.candidate.title,
          "Quota unsaved input",
        );
        await cdp.detach();
      },
    );
    await check(
      "independent tab CAS preserves newer original and forks current input without overwriting",
      async () => {
        const original = await local(),
          other = await context.newPage();
        other.setDefaultTimeout(20000);
        await other.goto(`${origin}/studio`);
        await other.getByTestId(`draft-${original.id}`).click();
        await other
          .getByLabel("전시 제목", { exact: true })
          .fill("Other tab winner");
        await expect
          .poll(async () =>
            JSON.stringify(
              (await records(other)).find((row) => row.id === original.id)
                ?.draft.candidate.title,
            ),
          )
          .toBe(JSON.stringify("Other tab winner"));
        await expect(other.getByTestId("local-state")).toContainText(
          "로컬 version",
        );
        await page
          .getByLabel("전시 제목", { exact: true })
          .fill("Current tab preserved fork");
        await expect(page.getByRole("status")).toContainText(
          "다른 탭이 이 draft",
        );
        await expect(page.getByLabel("전시 제목", { exact: true })).toHaveValue(
          "Current tab preserved fork",
        );
        assert.equal(
          (await records()).find((row) => row.id === original.id).draft
            .candidate.title,
          "Other tab winner",
        );
        await page
          .getByRole("button", {
            name: "현재 입력으로 새 로컬 사본",
            exact: true,
          })
          .click();
        await expect(page.getByRole("status")).toContainText(
          "현재 입력을 새 로컬 사본",
        );
        const fork = await local();
        assert.notEqual(fork.id, original.id);
        assert.equal(fork.remote, undefined);
        assert.equal(
          (await records()).find((row) => row.id === original.id).draft
            .candidate.title,
          "Other tab winner",
        );
        await other.close();
      },
    );
    await check(
      "local history recovery and JSON import restore as a new ID without deleting prior drafts",
      async () => {
        const prior = await local();
        await page
          .getByLabel("전시 제목", { exact: true })
          .fill("History later edit");
        await saved();
        await page
          .getByLabel("이전 로컬 저장본", { exact: true })
          .selectOption(String(prior.version));
        await page
          .getByRole("button", { name: "선택한 저장본 복구", exact: true })
          .click();
        await expect(page.getByRole("status")).toContainText(
          "새로운 version으로 복구",
        );
        await expect(page.getByLabel("전시 제목", { exact: true })).toHaveValue(
          prior.draft.candidate.title,
        );
        const download = page.waitForEvent("download");
        await page
          .getByRole("button", {
            name: "저장본·현재 입력 파일 백업",
            exact: true,
          })
          .click();
        const file = await download,
          content = await readFile(await file.path());
        const ids = (await records()).map((row) => row.id);
        await page
          .getByLabel("JSON 백업을 새 사본으로 복원", { exact: true })
          .setInputFiles({
            name: "local-backup.json",
            mimeType: "application/json",
            buffer: content,
          });
        await expect(page.getByRole("status")).toContainText(
          "새로운 로컬 사본",
        );
        const imported = await local();
        assert(!ids.includes(imported.id));
        const after = await records();
        assert(ids.every((id) => after.some((row) => row.id === id)));
        assert.deepEqual(
          imported.draft.candidate.rooms,
          prior.draft.candidate.rooms,
        );
        assert.deepEqual(
          imported.draft.candidate.placements,
          prior.draft.candidate.placements,
        );
      },
    );
    await check(
      "actual authenticated remote create receipt replay, stale ETag compare, explicit apply and local fork",
      async () => {
        await login(subject);
        const original = await local();
        let dropped = false;
        await page.route("**/studio/exhibitions", async (route) => {
          if (!dropped && route.request().method() === "POST") {
            dropped = true;
            const real = await route.fetch();
            assert.equal(real.status(), 201, await real.text());
            await route.abort("connectionreset");
          } else await route.continue();
        });
        await page
          .getByRole("button", {
            name: "현재 계정에 새 서버 전시 저장",
            exact: true,
          })
          .click();
        await expect(page.getByRole("status")).toContainText(
          "연결 또는 처리에 실패",
        );
        await page
          .getByRole("button", {
            name: "현재 계정에 새 서버 전시 저장",
            exact: true,
          })
          .click();
        await expect(page.getByRole("status")).toContainText(
          "서버 revision 1을 저장",
        );
        await page.unroute("**/studio/exhibitions");
        const bound = await local();
        assert.equal(
          bound.remote.userId,
          (
            await (
              await context.request.get(`${origin}/api/v1/auth/session`)
            ).json()
          ).userId,
        );
        const api = `${origin}/api/v1/tenants/${tenantId}/studio/exhibitions/${bound.remote.id}`,
          remote = await (await context.request.get(api)).json(),
          session = await (
            await context.request.get(`${origin}/api/v1/auth/session`)
          ).json();
        remote.draft.candidate.title = "Concurrent remote winner";
        const change = await context.request.put(api, {
          headers: {
            origin,
            "x-csrf-token": session.csrfToken,
            "if-match": remote.etag,
          },
          data: { draft: remote.draft, requestId: randomUUID() },
        });
        assert.equal(change.status(), 200, await change.text());
        await page
          .getByLabel("전시 제목", { exact: true })
          .fill("Local remote conflict");
        await saved();
        await page
          .getByRole("button", { name: "기록된 ETag로 서버 저장", exact: true })
          .click();
        await expect(page.getByRole("status")).toContainText(
          "서버 revision이 바뀌었습니다",
        );
        await expect(page.getByLabel("전시 제목", { exact: true })).toHaveValue(
          "Local remote conflict",
        );
        await page
          .getByRole("button", { name: "서버 내용 비교", exact: true })
          .click();
        await expect(page.getByRole("status")).toContainText("비교만 수행");
        await expect(page.locator(".cms-comparison pre").first()).toContainText(
          "Concurrent remote winner",
        );
        await page
          .getByRole("button", {
            name: "현재 로컬 입력을 비교한 서버에 적용",
            exact: true,
          })
          .click();
        await expect(page.getByRole("status")).toContainText(
          "서버 revision 3을 저장",
        );
        assert.equal(
          (await (await context.request.get(api)).json()).draft.candidate.title,
          "Local remote conflict",
        );
        await page
          .getByRole("button", { name: "서버 내용 비교", exact: true })
          .click();
        await page
          .getByRole("button", {
            name: "충돌 입력의 새 로컬 사본",
            exact: true,
          })
          .click();
        await expect(page.getByRole("status")).toContainText("새 로컬 사본");
        assert.equal((await local()).remote, undefined);
        assert.equal(
          (await (await context.request.get(api)).json()).revision,
          3,
        );
        await page.getByTestId(`draft-${bound.id}`).click();
        await expect(page.getByTestId("draft-id")).toHaveText(bound.id);
        await expect(page.getByRole("status")).toContainText("완료된 로컬 저장본");
        assert.equal((await local()).remote.id, original.draft.exhibitionId);
      },
    );
    await check(
      "account switch cannot push old binding; offline shell cache excludes APIs and credentials; mobile layout",
      async () => {
        if (otherSubject) {
          const before = await local();
          await login(otherSubject);
          await expect(
            page.getByText("현재 계정과 이 draft의 서버 연결이 다릅니다.", {
              exact: false,
            }),
          ).toBeVisible();
          await expect(
            page.getByRole("button", {
              name: "기록된 ETag로 서버 저장",
              exact: true,
            }),
          ).toBeDisabled();
          assert.deepEqual(await local(), before);
        }
        const cacheKeys = await page.evaluate(async () => {
          const keys = [];
          for (const name of await caches.keys()) {
            for (const request of await (await caches.open(name)).keys())
              keys.push({
                url: request.url,
                authorization: request.headers.has("authorization"),
              });
          }
          return keys;
        });
        assert(cacheKeys.length > 0);
        assert(
          cacheKeys.every(
            (row) =>
              !row.authorization &&
              !new URL(row.url).pathname.startsWith("/api/"),
          ),
        );
        assert(
          cacheKeys.every(
            (row) =>
              new URL(row.url).pathname === "/studio" ||
              new URL(row.url).pathname === "/THIRD_PARTY_NOTICES.txt" ||
              new URL(row.url).pathname.startsWith("/assets/"),
          ),
        );
        await page.setViewportSize({ width: 375, height: 812 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        const directory = await mkdtemp(`${tmpdir()}/exhibitos-studio-ui-`);
        screenshots.push(`${directory}/mobile-studio.png`);
        await page.screenshot({ path: screenshots.at(-1), fullPage: true });
        assert.equal(errors.length, 0, JSON.stringify(errors));
      },
    );
    await check(
      "actual blocked v1 migration retries same UI, preserves original legacy data and rescues malformed records",
      async () => {
        const legacyContext = await browser.newContext(),
          held = await legacyContext.newPage();
        await held.goto(`${origin}/api/v1/health`);
        const v1 = {
          id: fixture.id,
          format: 1,
          version: fixture.editVersion,
          draft: fixture,
          updatedAt: fixture.updatedAt,
        };
        await held.evaluate(
          (record) =>
            new Promise((resolve, reject) => {
              const op = indexedDB.open("exhibitos-studio", 1);
              op.onupgradeneeded = () =>
                op.result.createObjectStore("drafts", { keyPath: "id" });
              op.onerror = () => reject(op.error);
              op.onsuccess = () => {
                window.__heldDB = op.result;
                const tx = op.result.transaction("drafts", "readwrite");
                tx.objectStore("drafts").put(record);
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
              };
            }),
          v1,
        );
        const migrated = await legacyContext.newPage();
        migrated.setDefaultTimeout(20000);
        await migrated.goto(`${origin}/studio`);
        await expect(migrated.getByRole("status")).toContainText(
          "브라우저 저장소에 접근할 수 없습니다",
        );
        await held.evaluate(() => window.__heldDB.close());
        await migrated
          .getByRole("button", { name: "저장소 다시 읽기", exact: true })
          .click();
        await expect(migrated.getByRole("status")).toContainText(
          "로컬 저장소를 다시 읽었습니다",
        );
        const rows = await records(migrated);
        assert.equal(rows[0].format, 2);
        const malformed = { id: randomUUID(), format: 2, version: 1 };
        await migrated.evaluate(
          (value) =>
            new Promise((resolve, reject) => {
              const op = indexedDB.open("exhibitos-studio", 2);
              op.onsuccess = () => {
                const db = op.result,
                  tx = db.transaction("drafts", "readwrite");
                tx.objectStore("drafts").put(value);
                tx.oncomplete = () => {
                  db.close();
                  resolve();
                };
                tx.onerror = () => reject(tx.error);
              };
            }),
          malformed,
        );
        await migrated
          .getByRole("button", { name: "저장소 다시 읽기", exact: true })
          .click();
        await expect(migrated.getByRole("status")).toContainText(
          "로컬 기록의 구조",
        );
        const download = migrated.waitForEvent("download");
        await migrated
          .getByRole("button", { name: "원문 구조 백업", exact: true })
          .click();
        const raw = JSON.parse(
          await readFile(await (await download).path(), "utf8"),
        );
        assert(
          raw.legacy.some((row) => JSON.stringify(row) === JSON.stringify(v1)),
        );
        assert(
          raw.drafts.some(
            (row) => row.id === malformed.id && row.version === 1 && !row.draft,
          ),
        );
        await legacyContext.close();
      },
    );
    await check(
      "future local format is rejected and exported unchanged without writes",
      async () => {
        const futureContext = await browser.newContext(),
          futurePage = await futureContext.newPage();
        await futurePage.goto(`${origin}/api/v1/health`);
        const raw = {
          id: randomUUID(),
          format: 3,
          version: 1,
          future: "owned synthetic future fixture",
        };
        await futurePage.evaluate(
          (value) =>
            new Promise((resolve, reject) => {
              const op = indexedDB.open("exhibitos-studio", 2);
              op.onupgradeneeded = () => {
                op.result.createObjectStore("drafts", { keyPath: "id" });
                op.result.createObjectStore("history", {
                  keyPath: ["id", "version"],
                });
                op.result.createObjectStore("legacy", { keyPath: "id" });
              };
              op.onsuccess = () => {
                const db = op.result,
                  tx = db.transaction("drafts", "readwrite");
                tx.objectStore("drafts").put(value);
                tx.oncomplete = () => {
                  db.close();
                  resolve();
                };
                tx.onerror = () => reject(tx.error);
              };
            }),
          raw,
        );
        await futurePage.goto(`${origin}/studio`);
        await expect(futurePage.getByRole("status")).toContainText(
          "이 앱보다 새로운 형식",
        );
        const download = futurePage.waitForEvent("download");
        await futurePage
          .getByRole("button", { name: "원문 구조 백업", exact: true })
          .click();
        const rescued = JSON.parse(
          await readFile(await (await download).path(), "utf8"),
        );
        assert.deepEqual(rescued.drafts, [raw]);
        await futureContext.close();
      },
    );
    await context.close();
    return { checks, screenshots };
  } finally {
    await browser?.close();
    await app?.close();
  }
}
