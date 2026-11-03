// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from "vitest";
import assert from "node:assert/strict";
import { recordedStepPolicy, RecordedStepSession, type StepConditions, type VerifiedStepSample } from "./recorded-step-policy.ts";
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
test("two clips retain the previous selection instead of forcing A/B alternation", () => {
  for (const selection of [0, 1, -Infinity, Infinity]) {
    const result = recordedStepPolicy([sample("a"), sample("b")], conditions,
      { nextSide: "right", previousId: "b" }, { ...random, selection });
    assert.equal(result.play, true);
    if (result.play) { assert.equal(result.plan.sampleId, "b"); assert.equal(result.plan.side, "right");
      assert.equal(result.plan.nextHistory.nextSide, "left"); }
  }
});
test('a session draws lazily once per material/bank/revision and reuses the choice after other floors',()=>{
  const session=new RecordedStepSession();let draws=0;
  const random=()=>{draws++;return .9;};
  assert.equal(session.select('wood/bank1/rev1',['a','b'],random),'b');
  assert.equal(session.select('tile/bank2/rev1',['c','d'],random),'d');
  for(let i=0;i<20;i++)assert.equal(session.select('wood/bank1/rev1',['a','b'],random),'b');
  assert.equal(draws,2);
  assert.equal(session.select('wood/bank1/rev2',['a','b'],random),'b');assert.equal(draws,3);
  assert.equal(new RecordedStepSession().select('wood/bank1/rev1',['a','b'],()=>0),'a');
});
test('failure advances a fixed approved bank order once, without redrawing or retrying failed clips',()=>{
  const session=new RecordedStepSession();let draws=0;const random=()=>{draws++;return .4;};
  assert.equal(session.select('bank',['a','b','c'],random),'b');
  session.failed('bank','unrelated');assert.equal(session.select('bank',['a','b','c'],random),'b');
  session.failed('bank','b');session.failed('bank','b');assert.equal(session.select('bank',['a','b','c'],random),'c');
  session.failed('bank','c');assert.equal(session.select('bank',['a','b','c'],random),'a');
  session.failed('bank','a');for(let i=0;i<20;i++)assert.equal(session.select('bank',['a','b','c'],random),undefined);
  assert.equal(draws,1);
});
test('empty, invalid and single-file banks never need a random draw',()=>{
  const session=new RecordedStepSession(),random=()=>{throw Error('Unexpected random draw');};
  for(const ids of [[],['a','a'],[''],Array.from({length:17},(_,i)=>String(i))])assert.equal(session.select(JSON.stringify(ids),ids,random),undefined);
  assert.equal(session.select('single',['a'],random),'a');session.failed('single','a');assert.equal(session.select('single',['a'],random),undefined);
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
