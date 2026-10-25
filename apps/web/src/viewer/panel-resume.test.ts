// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "vitest";
import { createPanelResumeGate } from "./panel-resume";

function panelPaused() {
  const gate = createPanelResumeGate();
  gate.mode(true, false);
  gate.mode(true, true, "panel");
  return gate;
}
function click(gate: ReturnType<typeof createPanelResumeGate>, allowed = true) {
  gate.begin(1, 20, 30, allowed);
  gate.end(1, 20, 30, true);
  return gate.consume(20, 30, allowed);
}
test("only a distinct empty-space click can consume an active panel pause once", () => {
  const gate = panelPaused();
  expect(gate.consume(20, 30, true)).toBe(false); // opening event has no canvas gesture
  expect(click(gate, false)).toBe(false); // panel, artwork, or other interaction
  expect(click(gate)).toBe(true);
  expect(click(gate)).toBe(false);
});
test("prior stopped sessions and explicit stops cannot acquire panel resume", () => {
  for (const reason of ["user", "escape", "window", "hidden", "blur", "pointerlock"] as const) {
    const gate = panelPaused();
    gate.mode(true, true, reason);
    gate.mode(true, true, "panel");
    expect(click(gate)).toBe(false);
  }
  const stationary = createPanelResumeGate();
  stationary.mode(false, true, "panel");
  expect(click(stationary)).toBe(false);
});
test("drag returning to start, cancellation, and release outside canvas reject resume", () => {
  const gate = panelPaused();
  gate.begin(1, 20, 30, true); gate.move(1, 40, 30); gate.move(1, 20, 30); gate.end(1, 20, 30, true);
  expect(gate.consume(20, 30, true)).toBe(false);
  gate.begin(1, 20, 30, true); gate.cancel(); gate.end(1, 20, 30, true);
  expect(gate.consume(20, 30, true)).toBe(false);
  gate.begin(1, 20, 30, true); gate.end(1, 20, 30, false);
  expect(gate.consume(20, 30, true)).toBe(false);
  expect(click(gate)).toBe(true); // a later deliberate tap is still available
});
test("panel settings preserve eligibility but never create it for stopped walking", () => {
  const gate = panelPaused(); gate.mode(true, true, "settings");
  expect(click(gate)).toBe(true);
  gate.mode(true, true, "settings"); gate.mode(true, true, "panel");
  expect(click(gate)).toBe(false);
});
test("tab-away, modal, error, or closed-panel invalidation rejects pending clicks", () => {
  const gate = panelPaused(); gate.begin(1, 20, 30, true); gate.end(1, 20, 30, true);
  gate.invalidate();
  expect(gate.consume(20, 30, true)).toBe(false);
  expect(click(gate)).toBe(false);
});

test("movement consumes only a panel-owned resumable session, never another stop", () => {
 const gate=panelPaused();expect(gate.canResume()).toBe(true);
 expect(gate.movement(false)).toBe(false);expect(gate.movement(true)).toBe(true);
 expect(gate.movement(true)).toBe(false);expect(click(gate)).toBe(false);
 for(const reason of ["user","escape","window","hidden","blur","pointerlock"] as const){
  const stopped=panelPaused();stopped.mode(true,true,reason);expect(stopped.movement(true)).toBe(false);
 }
});
