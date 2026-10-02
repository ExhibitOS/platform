// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { chromium, expect } from "@playwright/test";
export async function runExperienceBrowser({ origin, publicationId, projection, fixture, authoring, revoke, restore }) {
  const browser = await chromium.launch(), checks = [], sequences = [], screenshots = [];
  const dir = await mkdtemp(`${tmpdir()}/exhibitos-experience-`);
  const report = { source: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    dirtySource: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(), browser: browser.version(), fixture, checks, sequences, screenshots,
    limits: ["Production Chromium with emulated keyboard/mouse, actual Web Audio decoding and node state; physical speaker audibility, physical mobile/GPU/RSS are not qualified.", "Explicit request404 and AudioContext refusal injection checks are failure controls, not successful native playback evidence."] };
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const requests = [], audioResponses = [], pageErrors = [];
  let currentCheck = "production page load", failureRecorded = false;
  page.on("pageerror", error => pageErrors.push(error.message));
  const audioURL = projection.assets.find(a => a.mime === "audio/wav").url;
  page.on("request", r => { if (new URL(r.url()).pathname === audioURL) requests.push(r.url()); });
  page.on("response", response => {
    if (new URL(response.url()).pathname === audioURL) audioResponses.push({ status: response.status(), contentType: response.headers()["content-type"], revision: response.headers()["x-exhibitos-publication-revision"] });
  });
  const state = () => page.getByTestId("audio-state").evaluate(e => JSON.parse(e.getAttribute("data-audio-state")));
  const nav = () => page.getByRole("region", { name: "전시 Viewer", exact: true }).locator("canvas").first().evaluate(c => JSON.parse(c.dataset.navigationState ?? "null"));
  // section aria-label is exposed as region; this selects only the persistent gallery canvas.
  const button = name => page.getByRole("button", { name, exact: true });
  const check = async (name, fn) => { currentCheck = name; await fn(); checks.push(name); console.log(`PASS ${name}`); };
  const recordFailure = async error => {
    if (failureRecorded) return;
    failureRecorded = true;
    const safe = async operation => { try { return await operation(); } catch (failure) { return { unavailable: String(failure?.message ?? failure).slice(0, 1000) }; } };
    const [audio, navigation, visibleStatus] = await Promise.all([
      safe(state), safe(nav), safe(() => page.getByRole("status").allTextContents()),
    ]);
    const screenshotPath = `${dir}/failure.png`;
    const screenshot = await safe(async () => { await page.screenshot({ path: screenshotPath, timeout: 5000 }); screenshots.push(screenshotPath); return screenshotPath; });
    const diagnostic = { check: currentCheck, observedAt: new Date().toISOString(), error: String(error?.message ?? error).slice(0, 4000), audio, navigation, visibleStatus, audioRequests: requests, audioResponses, pageErrors, screenshot };
    const failure = { ...report, outcome: "failed", diagnostic };
    const reportPath = `${dir}/experience-run.json`;
    await writeFile(reportPath, JSON.stringify(failure, null, 2) + "\n");
    await writeFile(`${dir}/failure.json`, JSON.stringify(diagnostic, null, 2) + "\n");
    console.error(JSON.stringify({ experienceFailure: diagnostic, reportPath }, null, 2));
  };
  const load = async () => { await page.goto(`${origin}/p/${publicationId}`); await expect(page.getByRole("heading", { name: projection.exhibition.title, exact: true })).toBeVisible(); await expect(page.getByTestId("audio-state")).toBeVisible(); };
  const pause = async () => { await page.keyboard.press("Escape"); await expect.poll(async () => (await nav())?.paused).toBe(true); };
  try {
    await load();
    await check("production load requires no audio context or WAV request before user opt-in; automatic detail defaults off", async () => {
      await page.waitForTimeout(300);
      assert.equal(requests.length, 0); assert.equal((await state()).context, "not-created"); assert.equal((await state()).enabled, false);
      await expect(page.getByLabel(/작품에 가까워지면 상세 보기/)).not.toBeChecked();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });
    await check("actual GLB and PNG detail render, keyboard rotation/zoom, original/translation/annotation/rights and focus return", async () => {
      for (const placement of projection.exhibition.placements) {
        const artwork = projection.exhibition.artworks.find(a => a.revisionId === placement.artworkRevisionId);
        const opener = page.getByRole("button", { name: `${artwork.metadata.title} 상세 보기`, exact: true });
        await opener.focus(); await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
        const canvas = dialog.locator("canvas"); await expect(canvas).toHaveCount(1, { timeout: 30000 });
        await expect(dialog.getByText(artwork.rights.holder, { exact: true })).toBeVisible();
        await expect(dialog.getByText(artwork.metadata.medium ?? "미기록", { exact: true }).first()).toBeVisible();
        await expect(dialog.getByTestId("artwork-creation-year")).toHaveText(artwork.artworkType === "sculpture" ? "2024" : "미기록");
        if (artwork.artworkType === "sculpture") await expect(dialog.getByText("Synthetic painted polymer", { exact: true })).toBeVisible();
        await expect(dialog).not.toContainText("PRIVATE AUTHORING NOTES");
        const detail = () => canvas.evaluate(c => JSON.parse(c.dataset.detailState ?? "null"));
        await expect.poll(async () => (await detail())?.zoom).toBe(1);
        await dialog.getByLabel("작품 회전", { exact: true }).focus(); await page.keyboard.press("ArrowRight");
        await expect.poll(async () => (await detail())?.rotationY).toBeCloseTo(5 * Math.PI / 180, 5);
        await dialog.getByLabel("작품 확대", { exact: true }).focus(); await page.keyboard.press("ArrowRight");
        await expect.poll(async () => (await detail())?.zoom).toBe(1.1);
        assert.deepEqual((await detail()).dimensions, artwork.dimensions);
        if (placement.id === projection.exhibition.placements[0].id) {
          await expect(dialog.getByRole("heading", { name: /번역 \(en\)/ })).toBeVisible();
          await expect(dialog.getByText("Translated synthetic description", { exact: true })).toBeVisible();
          await expect(dialog.getByText(/Original synthetic artist voice transcript/)).toBeVisible();
          await expect(dialog.getByText(/Original synthetic material annotation/)).toBeVisible();
          assert.deepEqual((await detail()).anchors, [[.1, .1, .1]]);
        }
        sequences.push({ artworkType: artwork.artworkType, detail: await detail(), noAudioRequests: requests.length });
        const path = `${dir}/detail-${artwork.artworkType}.png`; await page.screenshot({ path }); screenshots.push(path);
        await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
      }
      assert.equal(requests.length, 0);
    });
    await check("opening and credits are keyboard dialogs with return focus and no required audio", async () => {
      for (const name of ["전시 시작 안내", "전시 크레딧"]) {
        const opener = button(name); await opener.focus(); await page.keyboard.press("Enter");
        await expect(page.getByRole("dialog")).toBeVisible();
        if (name === "전시 크레딧") await expect(page.getByRole("dialog").getByText("Original synthetic experience credits", { exact: true })).toBeVisible();
        await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0); await expect(opener).toBeFocused();
      }
    });
    await check("detail pauses walking and preserves camera within1micrometer grounding tolerance and prior paused state", async () => {
      const toleranceMeters = 1e-6, toleranceRadians = 1e-6;
      const sameCamera = (actual, expected) => {
        for (let axis = 0; axis < 3; axis++) assert(Math.abs(actual.eyePosition[axis] - expected.eyePosition[axis]) <= toleranceMeters,
          `Camera axis${axis} changed beyond ${toleranceMeters}m: ${actual.eyePosition} / ${expected.eyePosition}`);
        assert(Math.abs(actual.yaw - expected.yaw) <= toleranceRadians,
          `Camera yaw changed beyond ${toleranceRadians}rad: ${actual.yaw} / ${expected.yaw}`);
      };
      const canvas = page.getByRole("region", { name: "전시 Viewer", exact: true }).locator("canvas").first();
      await button("걷기 시작").click(); await expect.poll(async () => (await nav())?.paused).toBe(false);
      await page.waitForTimeout(300);
      const before = await nav(), opener = page.getByRole("button", { name: /상세 보기$/, exact: false }).first();
      await opener.click(); await expect.poll(async () => (await nav())?.paused).toBe(true);
      const duringDetail = await nav(); sameCamera(duringDetail, before);
      await page.keyboard.press("Escape"); await expect.poll(async () => (await nav())?.paused).toBe(false);
      const restoredActive = await nav(); sameCamera(restoredActive, before); await expect(canvas).toBeFocused();
      await pause(); const paused = await nav(); await opener.click(); await page.keyboard.press("Escape");
      await expect.poll(async () => (await nav())?.paused).toBe(true);
      const restoredPaused = await nav(); sameCamera(restoredPaused, paused); await expect(opener).toBeFocused();
      sequences.push({ cameraRestore: { toleranceMeters, toleranceRadians, before, duringDetail, restoredActive, paused, restoredPaused } });
    });
    await check("user opt-in actually decodes verified WAV, spatial zone distance gain and room reverb; mute/volume/pause stop sound", async () => {
      await button("소리 켜기").click(); await expect.poll(async () => (await state()).enabled).toBe(true);
      await expect.poll(async () => (await state()).loaded).toBeGreaterThan(0);
      assert((await state()).decodedBytes > 0); assert(requests.length > 0);
      await button(`공간 소리 재생 ${projection.exhibition.audioZones[0].id}`).click();
      await expect.poll(async () => (await state()).active).toBeGreaterThan(0);
      const stationary = await state(); assert(stationary.zoneGain > 0 && stationary.zoneGain < .7); assert(stationary.reverbSeconds > 0);
      const volume = page.getByLabel("소리 크기", { exact: true }); await volume.focus(); await page.keyboard.press("Home");
      await expect.poll(async () => (await state()).volume).toBe(0); await page.keyboard.press("End"); await expect.poll(async () => (await state()).volume).toBe(1);
      await page.getByLabel("소리 끄기", { exact: true }).check(); await expect.poll(async () => (await state()).active).toBe(0);
      await page.getByLabel("소리 끄기", { exact: true }).uncheck();
      // Choose zone playback while paused, then explicitly resume walking.
      // Clicking an external zone control after resume intentionally blurs and
      // pauses the navigation canvas; mere canvas focus must not auto-resume.
      await button(`공간 소리 재생 ${projection.exhibition.audioZones[0].id}`).click();
      await expect.poll(async () => (await state()).active).toBeGreaterThan(0);
      await button("걷기 재개").click(); await expect.poll(async () => (await nav())?.paused).toBe(false);
      await expect(page.getByRole("region", { name: "전시 Viewer", exact: true }).locator("canvas").first()).toBeFocused();
      await page.keyboard.down("w"); await page.waitForTimeout(1300); await page.keyboard.up("w");
      await expect.poll(async () => (await state()).footsteps).toBeGreaterThan(0);
      const moved = await state(); assert.equal(moved.material, "wood"); assert(moved.zoneGain > stationary.zoneGain);
      await page.keyboard.down("w"); await page.waitForTimeout(4700); await page.keyboard.up("w");
      await expect.poll(async () => (await state()).roomId).not.toBe(stationary.roomId);
      const adjacent = await state(); assert.equal(adjacent.material, "carpet"); assert.equal(adjacent.zoneGain, 0); assert(adjacent.reverbSeconds > stationary.reverbSeconds);
      await pause(); await expect.poll(async () => (await state()).active).toBe(0); assert.equal((await state()).suspended, true);
      sequences.push({ stationary, moved, adjacent, pausedAudio: await state() });
    });
    await check("artist voice explicit playback actually uses decoded buffer and closes without delayed audio", async () => {
      await page.getByRole("button", { name: /상세 보기$/, exact: false }).first().click();
      await button("작가 음성 듣기 (ko)").click(); await expect.poll(async () => (await state()).active).toBeGreaterThan(0);
      await page.keyboard.press("Escape"); await expect.poll(async () => (await state()).active).toBe(0);
      await page.waitForTimeout(250); assert.equal((await state()).active, 0);
    });
    await check("real authoritative revocation blocks reuse and retains transcript alternative", async () => {
      await revoke();
      await page.getByRole("button", { name: /상세 보기$/, exact: false }).first().click();
      await button("작가 음성 듣기 (ko)").click();
      await expect(page.getByRole("dialog").getByText(/음성을 재생할 수 없습니다/)).toBeVisible();
      assert.equal((await state()).active, 0);
      await expect(page.getByRole("dialog").getByText(/Original synthetic artist voice transcript/)).toBeVisible();
      await page.keyboard.press("Escape"); await restore();
    });
    await check("labeled404 failure control retains reading fallback without claiming successful playback", async () => {
      await page.route(`**${audioURL}`, route => route.fulfill({ status: 404, body: "" }));
      await load(); await page.getByRole("button", { name: /상세 보기$/, exact: false }).first().click();
      await button("작가 음성 듣기 (ko)").click(); await expect(page.getByRole("dialog").getByText(/음성을 재생할 수 없습니다/)).toBeVisible();
      await expect(page.getByRole("dialog").getByText(/Original synthetic artist voice transcript/)).toBeVisible();
      await page.unroute(`**${audioURL}`);
    });
    await check("labeled AudioContext refusal control preserves transcript and retry guidance", async () => {
      const denied = await browser.newPage();
      await denied.addInitScript(() => { Object.defineProperty(window, "AudioContext", { configurable: true, value: class { constructor() { throw Error("SYNTHETIC_AUTOPLAY_REFUSAL"); } } }); });
      await denied.goto(`${origin}/p/${publicationId}`); await denied.getByRole("button", { name: "소리 켜기", exact: true }).click();
      await expect(denied.getByText("소리를 시작할 수 없습니다. 음성 설명은 글로 읽을 수 있습니다.", { exact: true })).toBeVisible();
      await denied.getByRole("button", { name: /상세 보기$/, exact: false }).first().click(); await expect(denied.getByRole("dialog").getByText(/Original synthetic artist voice transcript/)).toBeVisible();
      await denied.close();
    });
    await check("production Studio author uses actual login, separate WAV rights upload/approval, transcript binding and READY publication", async () => {
      const author = await browser.newPage();
      try {
        await author.goto(`${origin}/cms`);
        await author.getByLabel("기관 ID", { exact: true }).fill(authoring.tenantId);
        await author.getByLabel("계정", { exact: true }).fill(authoring.subject);
        await author.getByLabel("비밀번호", { exact: true }).fill(authoring.password);
        await author.getByRole("button", { name: "로그인", exact: true }).click();
        await expect(author.getByRole("button", { name: "로그아웃", exact: true })).toBeVisible();
        await author.goto(`${origin}/studio`);
        await author.getByRole("button", { name: "새 로컬 전시", exact: true }).click();
        const input = author.getByLabel("전시 문서 JSON", { exact: true });
        const initial = JSON.parse(await input.inputValue()), candidate = structuredClone(authoring.candidate);
        candidate.id = initial.id; candidate.revisionId = initial.revisionId; candidate.title = "Synthetic browser-authored experience";
        candidate.mediaAssets = []; candidate.audioZones = []; candidate.annotations = [];
        delete candidate.extensions["org.exhibitos.viewer/experience"];
        await input.fill(JSON.stringify(candidate)); await author.waitForTimeout(1000);
        await author.getByRole("button", { name: "현재 서버 계정 확인", exact: true }).click();
        await author.getByRole("button", { name: "현재 계정에 새 서버 전시 저장", exact: true }).click();
        const editor = author.getByRole("region", { name: "관람 오디오와 작품 설명 편집", exact: true });
        await editor.getByLabel("작가 음성 WAV 파일", { exact: true }).setInputFiles({ name: "original-synthetic.wav", mimeType: "audio/wav", buffer: authoring.wave });
        await editor.getByLabel("오디오 권리자", { exact: true }).fill("Synthetic browser voice owner");
        await editor.getByLabel("오디오 크레딧", { exact: true }).fill("Original browser uploaded voice");
        await editor.getByLabel("오디오 라이선스 식별자", { exact: true }).fill("CC0-1.0");
        await editor.getByLabel("이 녹음의 권리자로서 공개 재생을 허용합니다", { exact: true }).check();
        await editor.getByRole("button", { name: "오디오 업로드·검증", exact: true }).click();
        await expect(editor.getByRole("button", { name: "오디오 승인", exact: true })).toBeVisible();
        await editor.getByRole("button", { name: "오디오 승인", exact: true }).click();
        await editor.getByLabel("설명할 작품 배치", { exact: true }).selectOption(candidate.placements[0].id);
        await editor.getByLabel("승인된 오디오", { exact: true }).selectOption({ label: "Original browser uploaded voice" });
        await editor.getByLabel("음성 대본", { exact: true }).fill("Original browser authored transcript");
        await editor.getByRole("button", { name: "작품 음성 연결", exact: true }).click();
        await expect.poll(async () => JSON.parse(await input.inputValue()).extensions["org.exhibitos.viewer/experience"]?.voices[0]?.transcript).toBe("Original browser authored transcript");
        await author.waitForTimeout(1000);
        await author.getByRole("button", { name: "기록된 ETag로 서버 저장", exact: true }).click();
        await author.getByRole("button", { name: "서버 revision READY 검사", exact: true }).click();
        await expect(author.getByRole("button", { name: "READY revision 공개", exact: true })).toBeEnabled();
        await author.getByRole("button", { name: "READY revision 공개", exact: true }).click();
        const publicLink = author.getByRole("link", { name: "익명 공개 preview 열기", exact: true }); await expect(publicLink).toBeVisible();
        const response = await author.request.get(`${origin}/api/v1/publications/${(await publicLink.getAttribute("href")).split("/").at(-1)}`);
        assert.equal(response.status(), 200); const published = await response.json();
        assert.equal(published.exhibition.mediaAssets.length, 1);
        assert.equal(published.exhibition.extensions["org.exhibitos.viewer/experience"].voices[0].transcript, "Original browser authored transcript");
        sequences.push({ browserAuthoring: { publication: published.publication, audioInventory: published.assets.filter(a => a.mime === "audio/wav") } });
      } catch (error) {
        // Read the still-open authoring page before teardown; never serialize
        // input values, request headers, passwords, cookies or session tokens.
        try {
          const read = async operation => { try { return await operation(); } catch (failure) { return { unavailable: String(failure.message).slice(0, 1000) }; } };
          const [selects, visibleStatus] = await Promise.all([
            read(() => author.locator("select").evaluateAll(elements => elements.map(select => ({
              ariaLabel: select.getAttribute("aria-label"),
              wrappingLabels: [...(select.labels ?? [])].map(label => label.textContent?.trim()),
              disabled: select.disabled,
              options: [...select.options].map(option => ({ text: option.textContent, value: option.value, disabled: option.disabled, selected: option.selected })),
            })))),
            read(() => author.getByRole("status").allTextContents()),
          ]);
          const path = `${dir}/authoring-failure.png`;
          const screenshot = await read(async () => {
            await author.screenshot({ path, timeout: 5000, mask: [author.locator('input[type="password"], input[name="subject"], input[name="tenantId"]')] });
            screenshots.push(path); return path;
          });
          report.authoringFailure = { observedAt: new Date().toISOString(), check: currentCheck, selects, visibleStatus, screenshot };
          await writeFile(`${dir}/authoring-failure.json`, JSON.stringify(report.authoringFailure, null, 2) + "\n");
          console.error(JSON.stringify({ authoringFailure: report.authoringFailure, reportPath: `${dir}/authoring-failure.json` }, null, 2));
        } catch (diagnosticError) { console.error(`Authoring diagnostics unavailable: ${diagnosticError.message}`); }
        throw error;
      } finally { await author.close(); }
    });
    currentCheck = "synthetic microphone lifecycle verification";
    const recording = await runSyntheticRecording({ origin, authoring, dir, onCheck: name => { currentCheck = name; }, onFailure: diagnostic => { report.microphoneFailure = diagnostic; } });
    checks.push(...recording.checks); sequences.push({ microphone: recording });
    await writeFile(`${dir}/experience-run.json`, JSON.stringify(report, null, 2) + "\n"); return { ...report, reportPath: `${dir}/experience-run.json` };
  } catch (error) {
    // Best-effort diagnostics preserve the original failed assertion even when
    // the page is unavailable. Only this isolated synthetic publication is read.
    try { await recordFailure(error); } catch (diagnosticError) { console.error(`Experience diagnostics unavailable: ${diagnosticError.message}`); }
    throw error;
  } finally { await restore(); await browser.close(); }
}

async function runSyntheticRecording({ origin, authoring, dir, onCheck, onFailure }) {
  // Isolated browser synthetic input only. Never requests a human microphone.
  const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  const checks = [], observations = [], pageErrors = [], workletResponses = [], workletFailures = [];
  let currentPage = null, currentCheck = "synthetic microphone initialization";
  async function observe(page) {
    currentPage = page;
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("response", response => { if (new URL(response.url()).pathname === "/voice-pcm-worklet.js") workletResponses.push({ status: response.status(), contentType: response.headers()["content-type"] }); });
    page.on("requestfailed", request => { if (new URL(request.url()).pathname === "/voice-pcm-worklet.js") workletFailures.push(request.failure()?.errorText ?? "unknown"); });
    // Observe native results transparently; never manufacture a stream, audio
    // sample or permission success, and never record device labels or IDs.
    await page.addInitScript(() => {
      window.__syntheticMicProbe = { calls: 0, streams: [], errors: [] };
      if (!navigator.mediaDevices) return;
      const native = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        window.__syntheticMicProbe.calls++;
        try {
          const stream = await native(constraints); window.__syntheticMicProbe.streams.push(stream); return stream;
        } catch (error) {
          window.__syntheticMicProbe.errors.push({ name: error.name, message: error.message }); throw error;
        }
      };
    });
  }
  async function studio(page) {
    await page.goto(`${origin}/cms`);
    await page.getByLabel("기관 ID", { exact: true }).fill(authoring.tenantId);
    await page.getByLabel("계정", { exact: true }).fill(authoring.subject);
    await page.getByLabel("비밀번호", { exact: true }).fill(authoring.password);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page.getByRole("button", { name: "로그아웃", exact: true })).toBeVisible();
    await page.goto(`${origin}/studio`);
    await page.getByRole("button", { name: "새 로컬 전시", exact: true }).click();
  }
  const check = async (title, fn) => { currentCheck = title; onCheck(title); await fn(); checks.push(title); console.log(`PASS ${title}`); };
  try {
    const context = await browser.newContext({ permissions: ["microphone"] }), page = await context.newPage();
    await observe(page);
    const uploads = [];
    page.on("request", r => { if (["POST", "PUT"].includes(r.method()) && new URL(r.url()).pathname.includes("/audio")) uploads.push({ method: r.method(), url: new URL(r.url()).pathname }); });
    await check("synthetic microphone actual AudioWorklet produces local bounded PCM WAV; mount is inert and upload remains explicit", async () => {
      await studio(page);
      await page.getByRole("button", { name: "현재 서버 계정 확인", exact: true }).click();
      await page.getByRole("button", { name: "현재 계정에 새 서버 전시 저장", exact: true }).click();
      const editor = page.getByRole("region", { name: "관람 오디오와 작품 설명 편집", exact: true });
      await editor.getByLabel("오디오 권리자", { exact: true }).fill("Synthetic microphone owner");
      await editor.getByLabel("오디오 크레딧", { exact: true }).fill("Browser generated synthetic microphone input");
      await editor.getByLabel("오디오 라이선스 식별자", { exact: true }).fill("CC0-1.0");
      await editor.getByLabel("이 녹음의 권리자로서 공개 재생을 허용합니다", { exact: true }).check();
      await expect(editor.getByRole("button", { name: "오디오 업로드·검증", exact: true })).toBeDisabled();
      assert.equal(await page.evaluate(() => window.__syntheticMicProbe.calls), 0); assert.equal(uploads.length, 0);
      await editor.getByRole("button", { name: "작가 음성 녹음 시작", exact: true }).click();
      await expect(editor.getByRole("button", { name: "녹음 정지·WAV 준비", exact: true })).toBeEnabled();
      await page.waitForTimeout(1300);
      assert.equal(await page.evaluate(() => window.__syntheticMicProbe.calls), 1); assert.equal(uploads.length, 0);
      await editor.getByRole("button", { name: "녹음 정지·WAV 준비", exact: true }).click();
      await expect(editor.getByText(/준비한 파일: artist-voice.wav/)).toBeVisible();
      assert.equal(uploads.length, 0);
      await expect.poll(() => page.evaluate(() => window.__syntheticMicProbe.streams.flatMap(s => s.getTracks()).every(t => t.readyState === "ended"))).toBe(true);
      const uploaded = page.waitForRequest(r => r.method() === "PUT" && new URL(r.url()).pathname.includes("/audio/") && r.url().endsWith("/bytes"));
      await editor.getByRole("button", { name: "오디오 업로드·검증", exact: true }).click();
      const bytes = (await uploaded).postDataBuffer(); assert(bytes);
      assert.equal(bytes.toString("ascii", 0, 4), "RIFF"); assert.equal(bytes.toString("ascii", 8, 12), "WAVE");
      assert.equal(bytes.readUInt16LE(20), 1); assert.equal(bytes.readUInt16LE(22), 1); assert.equal(bytes.readUInt32LE(24), 48000); assert.equal(bytes.readUInt16LE(34), 16);
      assert.equal(bytes.readUInt32LE(4), bytes.length - 8); assert.equal(bytes.readUInt32LE(40), bytes.length - 44);
      assert(bytes.length > 44 && bytes.length <= 44 + 48000 * 60 * 2);
      await expect(editor.getByRole("button", { name: "오디오 승인", exact: true })).toBeVisible();
      observations.push({ provider: "Chromium --use-fake-device-for-media-stream; no physical microphone", sampleRate: 48000, channels: 1, bits: 16, bytes: bytes.length, durationSeconds: (bytes.length - 44) / 96000, requests: uploads, tracksStopped: true });
    });
    await check("synthetic microphone cancel releases capture and produces no recording upload", async () => {
      const before = uploads.length;
      const start = page.getByRole("button", { name: "작가 음성 녹음 시작", exact: true }); await start.click();
      await expect(page.getByRole("button", { name: "녹음 취소", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: "녹음 취소", exact: true }).click();
      await expect(page.getByText(/녹음을 취소하고 마이크를 닫았습니다/)).toBeVisible();
      assert.equal(uploads.length, before);
      await expect.poll(() => page.evaluate(() => window.__syntheticMicProbe.streams.flatMap(s => s.getTracks()).every(t => t.readyState === "ended"))).toBe(true);
    });
    await check("synthetic microphone automatically closes at60seconds, produces bounded PCM WAV and waits for explicit upload", async () => {
      const beforeUploads = uploads.length;
      const editor = page.getByRole("region", { name: "관람 오디오와 작품 설명 편집", exact: true });
      const start = editor.getByRole("button", { name: "작가 음성 녹음 시작", exact: true });
      await start.click();
      await expect(editor.getByRole("button", { name: "녹음 정지·WAV 준비", exact: true })).toBeEnabled();
      const started = performance.now();
      console.log("VERIFY synthetic microphone automatic cutoff: real AudioWorklet capture for up to75seconds; no physical microphone.");
      // Do not fake timers or invoke the stop handler: production recorder owns
      // its actual60second timer/sample cap, and this harness only observes it.
      await expect(editor.getByText("녹음을 WAV로 준비했습니다. 권리를 확인한 뒤 업로드하세요.", { exact: true })).toBeVisible({ timeout: 75000 });
      const elapsedMs = performance.now() - started;
      assert(elapsedMs >= 55000 && elapsedMs <= 75000, `Actual automatic cutoff elapsed ${elapsedMs}ms outside55–75seconds`);
      await expect(start).toBeEnabled();
      await expect(editor.getByRole("button", { name: "녹음 정지·WAV 준비", exact: true })).toBeDisabled();
      await expect.poll(() => page.evaluate(() => window.__syntheticMicProbe.streams.flatMap(stream => stream.getTracks()).every(track => track.readyState === "ended"))).toBe(true);
      assert.equal(uploads.length, beforeUploads, "Recording and automatic close must not upload audio");
      const prepared = await editor.getByText(/준비한 파일: artist-voice.wav/).textContent();
      const localBytes = Number(prepared.match(/·\s*(\d+) bytes/)[1]);
      assert(localBytes > 44 && localBytes <= 44 + 48000 * 60 * 2);
      const uploaded = page.waitForRequest(request => request.method() === "PUT" && new URL(request.url()).pathname.includes("/audio/") && request.url().endsWith("/bytes"));
      const validated = page.waitForResponse(response => response.request().method() === "PUT" && new URL(response.url()).pathname.includes("/audio/") && response.url().endsWith("/bytes"));
      await editor.getByRole("button", { name: "오디오 업로드·검증", exact: true }).click();
      const bytes = (await uploaded).postDataBuffer(); assert(bytes);
      assert.equal(bytes.length, localBytes); assert.equal(bytes.readUInt16LE(20), 1); assert.equal(bytes.readUInt16LE(22), 1);
      assert.equal(bytes.readUInt32LE(24), 48000); assert.equal(bytes.readUInt16LE(34), 16);
      assert.equal(bytes.readUInt32LE(4), bytes.length - 8); assert.equal(bytes.readUInt32LE(40), bytes.length - 44);
      const samples = (bytes.length - 44) / 2;
      assert(samples > 0 && samples <= 48000 * 60, `Automatic recording ${samples}samples exceeds60seconds`);
      const validationResponse = await validated; assert.equal(validationResponse.status(), 200);
      const validation = await validationResponse.json(); assert.equal(validation.state, "validated");
      assert(validation.durationSeconds > 0 && validation.durationSeconds <= 60);
      await expect(editor.getByRole("button", { name: "오디오 승인", exact: true })).toHaveCount(2);
      observations.push({ provider: "Chromium synthetic microphone; actual automatic timer/sample cap", elapsedMs, maxDurationSeconds: 60, sampleRate: 48000, samples, bytes: bytes.length, tracksStopped: true, uploadOnlyAfterExplicitClick: true });
    });
    await context.close();
    await check("actual browser microphone permission denial keeps PCM file fallback usable", async () => {
      const denied = await browser.newContext(), page = await denied.newPage(), cdp = await denied.newCDPSession(page);
      await observe(page);
      const { targetInfo } = await cdp.send("Target.getTargetInfo");
      await cdp.send("Browser.setPermission", { permission: { name: "microphone" }, setting: "denied", origin, browserContextId: targetInfo.browserContextId });
      await studio(page);
      assert.equal(await page.evaluate(async () => (await navigator.permissions.query({ name: "microphone" })).state), "denied");
      await page.getByRole("button", { name: "작가 음성 녹음 시작", exact: true }).click();
      await expect(page.getByText(/마이크 또는 녹음을 시작할 수 없습니다/)).toBeVisible();
      await page.getByLabel("작가 음성 WAV 파일", { exact: true }).setInputFiles({ name: "denied-fallback.wav", mimeType: "audio/wav", buffer: authoring.wave });
      await expect(page.getByText(/준비한 파일: denied-fallback.wav/)).toBeVisible();
      observations.push({ provider: "isolated Chromium synthetic device", permission: "real Browser.setPermission denied; no mocked getUserMedia rejection", fallback: "original generated WAV selected" });
      await denied.close();
    });
    return { checks, observations, limits: "Fake browser microphone, short capture and actual60second automatic cutoff; physical microphone/privacy UI/device fidelity remain unqualified." };
  } catch (error) {
    try {
      const read = async operation => { try { return await operation(); } catch (failure) { return { unavailable: String(failure.message).slice(0, 1000) }; } };
      const [native, visibleStatus] = await Promise.all([
        read(() => currentPage.evaluate(async () => {
          const probe = window.__syntheticMicProbe;
          let permission; try { permission = (await navigator.permissions.query({ name: "microphone" })).state; } catch (error) { permission = { unavailable: error.name }; }
          return { secureContext: isSecureContext, mediaDevicesPresent: !!navigator.mediaDevices, permission,
            calls: probe?.calls ?? null, errors: probe?.errors ?? [], tracks: probe?.streams.flatMap(stream => stream.getTracks().map(track => ({ kind: track.kind, readyState: track.readyState, muted: track.muted, enabled: track.enabled }))) ?? [] };
        })),
        read(() => currentPage.getByRole("status").allTextContents()),
      ]);
      const screenshotPath = `${dir}/microphone-failure.png`;
      const screenshot = await read(async () => {
        await currentPage.screenshot({ path: screenshotPath, timeout: 5000, mask: [currentPage.locator('input[type="password"], input[name="subject"], input[name="tenantId"]')] }); return screenshotPath;
      });
      const diagnostic = { provider: "isolated Chromium synthetic microphone only", check: currentCheck, observedAt: new Date().toISOString(), checks, error: String(error.message).slice(0, 4000), native, visibleStatus, pageErrors, workletResponses, workletFailures, screenshot };
      onFailure(diagnostic);
      await writeFile(`${dir}/microphone-failure.json`, JSON.stringify(diagnostic, null, 2) + "\n");
      console.error(JSON.stringify({ microphoneFailure: diagnostic, reportPath: `${dir}/microphone-failure.json` }, null, 2));
    } catch (diagnosticError) { console.error(`Microphone diagnostics unavailable: ${diagnosticError.message}`); }
    throw error;
  } finally { await browser.close(); }
}
