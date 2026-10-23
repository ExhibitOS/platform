// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from "vitest";
import assert from "node:assert/strict";
import { recordedStepPolicy, type StepConditions, type VerifiedStepSample } from "./recorded-step-policy.ts";
const conditions: StepConditions = { visitorFootstepsEnabled: true, enabled: true, muted: false,
  visible: true, audible: true, detail: false, contextRunning: true, voicePlaying: false };
const history = { nextSide: "left" as const };
const random = { selection: 0.5, gain: 0.5, rate: 0.5 };
const sample = (id = "a", durationSeconds = 0.7): VerifiedStepSample => ({ id, durationSeconds, verified: true });
function plan(samples: readonly VerifiedStepSample[], previousId?: string) {
  const result = recordedStepPolicy(samples, conditions, { ...history, previousId }, random);
  assert.equal(result.play, true);
  return result.plan;
}
test("single clip keeps its natural end and permits the only available ID", () => {
  const p = plan([sample()], "a");
  assert.equal(p.sampleId, "a"); assert.equal(p.mediaDurationSeconds, 0.7);
  assert.equal(p.wallDurationSeconds, 0.7); assert.equal(p.fadeOutStartSeconds + p.fadeOutSeconds, 0.7);
  assert.equal(p.nextHistory.nextSide, "right");
});
test("two clips exclude the previous ID at either random endpoint", () => {
  for (const selection of [0, 1, -Infinity, Infinity]) {
    const result = recordedStepPolicy([sample("a"), sample("b")], conditions,
      { nextSide: "right", previousId: "b" }, { ...random, selection });
    assert.equal(result.play, true);
    if (result.play) { assert.equal(result.plan.sampleId, "a"); assert.equal(result.plan.side, "right");
      assert.equal(result.plan.nextHistory.nextSide, "left"); }
  }
});
test("empty, excessive, duplicate and invalid clip metadata fail closed", () => {
  assert.deepEqual(recordedStepPolicy([], conditions, history, random), { play: false, reason: "empty" });
  const invalidSets = [[sample("a"), sample("a")], Array.from({ length: 17 }, (_, i) => sample(String(i))),
    [sample("", 0.5)], [sample("a", NaN)], [sample("a", 0.039)], [sample("a", 1.501)], [sample("a", 60)],
    [{ ...sample(), verified: false } as unknown as VerifiedStepSample]];
  for (const samples of invalidSets) assert.deepEqual(recordedStepPolicy(samples, conditions, history, random),
    { play: false, reason: "invalid-samples" });
});
test("explicit reviewed segment ends at its own natural end and never at a fixed 0.2 seconds", () => {
  const p = plan([{ ...sample("segment", 34), segment: { startSeconds: 8.2, endSeconds: 9.1, naturalBoundaryVerified: true } }]);
  assert.equal(p.offsetSeconds, 8.2); assert.ok(Math.abs(p.mediaDurationSeconds - 0.9) < 1e-12);
  assert.ok(p.fadeOutStartSeconds > p.fadeInSeconds);
  for (const segment of [{ startSeconds: -1, endSeconds: 0.5, naturalBoundaryVerified: true as const },
    { startSeconds: 1, endSeconds: 0.5, naturalBoundaryVerified: true as const },
    { startSeconds: 0.5, endSeconds: 2, naturalBoundaryVerified: true as const }])
    assert.equal(recordedStepPolicy([{ ...sample(), segment }], conditions, history, random).play, false);
});
test("duration bounds and all extreme random inputs yield finite bounded nonoverlapping fades", () => {
  for (const duration of [0.04, 1.5]) for (const value of [-Infinity, -100, 0, 1, 100, Infinity, NaN]) {
    const result = recordedStepPolicy([sample("a", duration)], conditions, history,
      { selection: value, gain: value, rate: value });
    assert.equal(result.play, true);
    if (!result.play) continue;
    const p = result.plan;
    for (const n of [p.playbackRate, p.peakGain, p.wallDurationSeconds, p.fadeOutStartSeconds]) assert.ok(Number.isFinite(n));
    assert.ok(p.playbackRate >= 0.98 && p.playbackRate <= 1.02);
    assert.ok(p.peakGain >= 0.35 * 0.94 && p.peakGain <= 0.35 * 1.06);
    assert.ok(p.fadeInSeconds < p.fadeOutStartSeconds);
    assert.ok(Math.abs(p.fadeOutStartSeconds + p.fadeOutSeconds - duration / p.playbackRate) < 1e-12);
  }
});
test("visitor off takes precedence; runtime inaudibility blocks and narration only ducks steps", () => {
  assert.deepEqual(recordedStepPolicy([sample("a", NaN)], { ...conditions, visitorFootstepsEnabled: false, muted: true }, history, random),
    { play: false, reason: "visitor-off" });
  for (const extra of [{ muted: true }, { visible: false }, { enabled: false }, { audible: false }, { detail: true }, { contextRunning: false }])
    assert.deepEqual(recordedStepPolicy([sample()], { ...conditions, ...extra }, history, random), { play: false, reason: "inaudible" });
  const normal = plan([sample()]);
  const ducked = recordedStepPolicy([sample()], { ...conditions, voicePlaying: true }, history, random);
  assert.equal(ducked.play, true);
  if (ducked.play) assert.equal(ducked.plan.peakGain, normal.peakGain * 0.35);
});
