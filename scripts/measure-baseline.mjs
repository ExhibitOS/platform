import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { arch, platform, release, cpus, totalmem } from 'node:os';
import { execFileSync } from 'node:child_process';

const osProduct = platform() === 'darwin' ? {
  osProductName: execFileSync('/usr/bin/sw_vers', ['-productName'], { encoding: 'utf8' }).trim(),
  osProductVersion: execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(),
  osBuildVersion: execFileSync('/usr/bin/sw_vers', ['-buildVersion'], { encoding: 'utf8' }).trim(),
} : {};

const dist = resolve('apps/web/dist');
await stat(resolve(dist, 'index.html')); // Fail if the production build is absent.
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
    const inside = relative(dist, file);
    if (inside.startsWith(`..${sep}`) || inside === '..' || inside.startsWith(sep)) {
      response.writeHead(403); response.end(); return;
    }
    const bytes = await readFile(file);
    response.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store', 'content-length': bytes.length });
    response.end(bytes);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((resolveReady, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveReady); });
let browser;
const results = [];
try {
  browser = await chromium.launch();
  for (const [name, viewport] of Object.entries({ desktop: { width: 1440, height: 900 }, narrow: { width: 375, height: 812 } })) {
    for (let run = 1; run <= 5; run++) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'ko-KR', reducedMotion: 'reduce' });
      try {
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 100, downloadThroughput: 1250000, uploadThroughput: 1250000 });
        await page.addInitScript(() => {
          let scheduled = false;
          const observer = new MutationObserver(() => {
            if (scheduled || !document.querySelector('h1') || !document.querySelector('button') || !document.querySelector('[role="status"]')) return;
            scheduled = true;
            requestAnimationFrame(() => {
              const heading = document.querySelector('h1');
              const button = document.querySelector('button');
              const box = heading.getBoundingClientRect();
              if (box.width > 0 && box.height > 0 && !button.disabled) {
                window.__baselineUsableMs = performance.now();
                observer.disconnect();
              } else { scheduled = false; }
            });
          });
          observer.observe(document, { childList: true, subtree: true, attributes: true });
        });
        const address = server.address();
        await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'load' });
        await page.waitForFunction(() => typeof window.__baselineUsableMs === 'number');
        const sample = await page.evaluate(() => {
          const nav = performance.getEntriesByType('navigation')[0];
          const entries = [nav, ...performance.getEntriesByType('resource')];
          return {
            domUsableMs: window.__baselineUsableMs,
            domContentLoadedMs: nav.domContentLoadedEventEnd,
            loadMs: nav.loadEventEnd,
            transferBytes: entries.reduce((sum, entry) => sum + entry.transferSize, 0),
            encodedBodyBytes: entries.reduce((sum, entry) => sum + entry.encodedBodySize, 0),
            resources: entries.map(entry => ({ path: new URL(entry.name).pathname, transferBytes: entry.transferSize, bodyBytes: entry.encodedBodySize })),
            horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
        results.push({ viewport: name, run, ...sample });
      } finally { await context.close(); }
    }
  }
  const files = [];
  async function inventory(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, item.name);
      if (item.isDirectory()) await inventory(path);
      else { const bytes = await readFile(path); files.push({ path: relative(dist, path).split(sep).join('/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); }
    }
  }
  await inventory(dist);
  const summary = Object.fromEntries(['desktop', 'narrow'].map(name => {
    const samples = results.filter(result => result.viewport === name);
    const times = samples.map(result => result.domUsableMs).sort((a, b) => a - b);
    return [name, { runs: samples.length, domUsableMedianMs: times[2], domUsableP95NearestRankMs: times[4], maxTransferBytes: Math.max(...samples.map(sample => sample.transferBytes)), horizontalOverflow: samples.some(sample => sample.horizontalOverflow) }];
  }));
  const report = {
    measuredAt: new Date().toISOString(),
    environment: { node: process.version, browser: browser.version(), os: platform(), kernelRelease: release(), ...osProduct, arch: arch(), cpuModel: cpus()[0]?.model ?? 'unknown', logicalCpuCount: cpus().length, systemMemoryBytes: totalmem(), gpu: 'not verified; headless Chromium only' },
    conditions: { build: 'npm run build: Vite production dist, static HTTP server without compression', network: { downloadMbps: 10, uploadMbps: 10, latencyMs: 100, method: 'Chromium CDP Network.emulateNetworkConditions' }, cache: 'fresh browser context per sample, cache disabled, no service worker', cpu: 'unthrottled host CPU', concurrency: 'sequential samples, one page', viewports: { desktop: [1440, 900], narrow: [375, 812] }, deviceScaleFactor: 1, fixture: 'foundation entry page only; synthetic gallery assets are not loaded', usableDefinition: 'first requestAnimationFrame with a visible h1 and enabled connection button, status element present', p95Method: 'nearest rank; with n=5 this is sample maximum, not a population estimate' },
    buildFiles: files.sort((a, b) => a.path.localeCompare(b.path)), summary, samples: results,
  };
  await mkdir('docs/performance', { recursive: true });
  await writeFile('docs/performance/baseline.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ environment: report.environment, summary }, null, 2));
} finally {
  if (browser) await browser.close();
  await new Promise(resolveClosed => server.close(resolveClosed));
}
