import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Plugin } from "vite";

// Only immutable build code and /studio HTML enter this cache. The worker
// neither intercepts nor caches authenticated API responses or artwork bytes.
export function studioOfflineShell(): Plugin {
  let output: URL;
  return {
    name: "exhibitos-studio-offline-shell",
    apply: "build",
    configResolved(config) {
      output = pathToFileURL(`${resolve(config.root, config.build.outDir)}/`);
    },
    async closeBundle() {
      const files = (await readdir(new URL("assets/", output)))
        .filter((name) => /^[-\w.]+\.(?:js|css)$/.test(name))
        .sort();
      const html = await readFile(new URL("index.html", output));
      const digest = createHash("sha256").update(html);
      const expected: Record<string, string> = {
        "/studio": createHash("sha256").update(html).digest("hex"),
      };
      const notices = await readFile(
        new URL("THIRD_PARTY_NOTICES.txt", output),
      );
      digest.update(notices);
      expected["/THIRD_PARTY_NOTICES.txt"] = createHash("sha256")
        .update(notices)
        .digest("hex");
      for (const name of files) {
        const bytes = await readFile(new URL(`assets/${name}`, output));
        digest.update(name).update(bytes);
        expected[`/assets/${name}`] = createHash("sha256")
          .update(bytes)
          .digest("hex");
      }
      const name = `exhibitos-studio-shell-v1-${digest.digest("hex").slice(0, 24)}`;
      const assets = [
        "/THIRD_PARTY_NOTICES.txt",
        ...files.map((file) => `/assets/${file}`),
      ];
      const source = `// Generated from this public web build. No data or credentials are cached.
const CACHE = ${JSON.stringify(name)};
const ASSETS = new Set(${JSON.stringify(assets)});
const HASHES = ${JSON.stringify(expected)};
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const urls = ['/studio', ...ASSETS];
    const responses = await Promise.all(urls.map(async url => {
      const response = await fetch(new Request(url, {credentials:'omit', cache:'reload', redirect:'error'}));
      if (!response.ok || /\\b(?:private|no-store)\\b/i.test(response.headers.get('cache-control') ?? '')) throw Error('PUBLIC_SHELL_REQUIRED');
      const digest = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
      const hash = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
      if (hash !== HASHES[url]) throw Error('SHELL_INTEGRITY');
      return response;
    }));
    // Only verified exact public build bytes enter the cache. A quota/install
    // failure leaves the prior worker and all IndexedDB drafts unchanged.
    await Promise.all(urls.map((url, index) => cache.put(url, responses[index])));
  })());
});
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  if (event.data?.type === 'APPLY_STUDIO_SHELL_UPDATE') event.waitUntil(self.skipWaiting());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.search || event.request.headers.has('authorization')) return;
  const studio = event.request.mode === 'navigate' && url.pathname === '/studio';
  if (!studio && !ASSETS.has(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const stored = await cache.match(studio ? '/studio' : url.pathname);
    return stored ?? fetch(event.request);
  })());
});
`;
      await writeFile(new URL("studio-sw.js", output), source);
    },
  };
}
