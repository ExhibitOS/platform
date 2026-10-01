import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { build } from "vite";
import { chromium } from "@playwright/test";
import { fixtureURL } from "@exhibitos/spec";

// Test-only IIFE bundles the exact product module into an isolated temporary
// directory. No debug globals, routes or instrumentation enter the product.
export async function runDraftStoreBrowser() {
  const output = await mkdtemp(`${tmpdir()}/exhibitos-draft-store-proof-`);
  await build({
    configFile: false,
    logLevel: "error",
    root: new URL("../apps/web/", import.meta.url).pathname,
    build: {
      outDir: output,
      emptyOutDir: false,
      copyPublicDir: false,
      minify: false,
      lib: {
        entry: new URL("../apps/web/src/drafts/store.ts", import.meta.url)
          .pathname,
        name: "DraftStoreProof",
        formats: ["iife"],
        fileName: () => "store.js",
      },
    },
  });
  const script = await readFile(`${output}/store.js`);
  const server = createServer((req, res) => {
    res.setHeader("cache-control", "no-store");
    if (req.url === "/store.js") {
      res.setHeader("content-type", "application/javascript");
      res.end(script);
    } else if (req.url === "/") {
      res.setHeader("content-type", "text/html");
      res.end(
        '<!doctype html><title>Isolated native draft store proof</title><script src="/store.js"></script>',
      );
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  let browser;
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(origin);
    const candidate = JSON.parse(
        await readFile(fixtureURL("oes/v1/examples/exhibition.json"), "utf8"),
      ),
      time = new Date().toISOString();
    const draft = {
      schemaVersion: "1.0.0-draft.1",
      kind: "exhibition-draft",
      id: randomUUID(),
      exhibitionId: candidate.id,
      editVersion: 1,
      createdAt: time,
      updatedAt: time,
      candidate,
    };
    const result = await page.evaluate(async (input) => {
      const { DraftStore } = globalThis.DraftStoreProof,
        store = new DraftStore("native-window-proof");
      let current = await store.save(input);
      for (let i = 2; i <= 51; i++) {
        const next = structuredClone(current.draft);
        next.candidate.title = `Synthetic version ${i}`;
        current = await store.save(next, current.version);
      }
      const window = await store.history(current.id),
        rescue = JSON.parse(await store.rescue());
      const recovered = await store.recover(current.id, 1, current.version),
        all = JSON.parse(await store.rescue());
      await store.close();
      const future = await new Promise((resolve, reject) => {
        const op = indexedDB.open("native-future-proof", 3);
        op.onupgradeneeded = () =>
          op.result.createObjectStore("drafts", { keyPath: "id" });
        op.onerror = () => reject(op.error);
        op.onsuccess = () => resolve(op.result);
      });
      await new Promise((resolve, reject) => {
        const tx = future.transaction("drafts", "readwrite");
        tx.objectStore("drafts").put({
          id: "future-preserved",
          format: 99,
          payload: "untouched future metadata",
        });
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
      });
      future.close();
      const newer = new DraftStore("native-future-proof");
      let code;
      try {
        await newer.list();
      } catch (error) {
        code = error.code;
      }
      const exported = JSON.parse(await newer.rescue());
      await newer.close();
      return {
        visible: window.length,
        oldest: window.at(-1).version,
        newest: window[0].version,
        persisted: rescue.history.length,
        oldTitle: rescue.history.find((row) => row.version === 1).draft
          .candidate.title,
        recoveredVersion: recovered.version,
        recoveredTitle: recovered.draft.candidate.title,
        afterRecovery: all.history.length,
        futureCode: code,
        futureExport: exported,
      };
    }, draft);
    assert.equal(result.visible, 50);
    assert.equal(result.oldest, 2);
    assert.equal(result.newest, 51);
    assert.equal(result.persisted, 51);
    assert.equal(result.afterRecovery, 52);
    assert.equal(result.recoveredVersion, 52);
    assert.equal(result.recoveredTitle, result.oldTitle);
    assert.equal(result.futureCode, "FUTURE_VERSION");
    assert.equal(result.futureExport.databaseVersion, 3);
    assert.equal(
      result.futureExport.drafts[0].payload,
      "untouched future metadata",
    );
    return [
      "native IndexedDB newest50 window retains51 immutable histories and explicitly recovers older version",
      "future IndexedDB version3 rejects normal reads while raw rescue preserves version/data without downgrade",
    ];
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
