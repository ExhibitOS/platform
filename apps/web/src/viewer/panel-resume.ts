// SPDX-License-Identifier: AGPL-3.0-or-later
import type { WalkingPauseReason } from "./navigation-input";

// A panel may return only the active walking session it paused. Focus alone
// never resumes movement, and a drag remains a drag even if it returns to start.
export function createPanelResumeGate() {
  let active = false, eligible = false;
  let gesture: { id: number; x: number; y: number; released: boolean } | undefined;
  const cancel = () => { gesture = undefined; };
  return {
    mode(walking: boolean, paused: boolean, reason?: WalkingPauseReason) {
      eligible = walking && paused && ((reason === "panel" && (active || eligible)) || (reason === "settings" && eligible));
      active = walking && !paused;
      cancel();
    },
    invalidate() { eligible = false; cancel(); },
    cancel,
    canResume: () => eligible,
    movement(allowed: boolean) {
      const result = eligible && allowed;
      if (result) { eligible = false; cancel(); }
      return result;
    },
    begin(id: number, x: number, y: number, allowed: boolean) {
      gesture = eligible && allowed ? { id, x, y, released: false } : undefined;
    },
    move(id: number, x: number, y: number) {
      if (gesture?.id === id && Math.hypot(x - gesture.x, y - gesture.y) > 5) cancel();
    },
    end(id: number, x: number, y: number, onCanvas: boolean) {
      this.move(id, x, y);
      if (gesture?.id === id) { if (onCanvas) gesture.released = true; else cancel(); }
    },
    consume(x: number, y: number, allowed: boolean) {
      const resume = eligible && allowed && !!gesture?.released && Math.hypot(x - gesture.x, y - gesture.y) <= 5;
      cancel();
      if (resume) eligible = false;
      return resume;
    },
  };
}

export function installPanelResume(canvas: HTMLCanvasElement, pause: () => void, resume: () => void, availabilityChanged: (available: boolean) => void = () => {}) {
  const root = canvas.closest(".publication-shell");
  const gate = createPanelResumeGate(), pointers = new Set<number>();
  let panelFocus = false, focusTimer: ReturnType<typeof setTimeout> | undefined;
  const panels = () => [...(root?.querySelectorAll<HTMLDetailsElement>("details[data-visitor-panel]") ?? [])];
  const owns = (target: EventTarget | null) => target instanceof Element && panels().some(panel => panel.contains(target));
  const open = () => panels().some(panel => panel.open);
  const down = (event: PointerEvent) => {
    pointers.add(event.pointerId);
    gate.cancel();
    if (!event.isTrusted || !event.isPrimary || event.button !== 0 || pointers.size !== 1) return;
    if (owns(event.target)) {
      // Pause before the pointer's default focus change, including browsers
      // whose canvas blur has a null relatedTarget. The opening click is never
      // a canvas gesture and therefore cannot resume the session it just paused.
      panelFocus = true;
      clearTimeout(focusTimer);
      focusTimer = setTimeout(() => { panelFocus = false; }, 0);
      pause();
    } else if (event.target === canvas) {
      gate.begin(event.pointerId, event.clientX, event.clientY, open());
    }
  };
  const move = (event: PointerEvent) => {
    for (const sample of event.getCoalescedEvents?.() ?? [event]) gate.move(sample.pointerId, sample.clientX, sample.clientY);
    gate.move(event.pointerId, event.clientX, event.clientY);
  };
  const up = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    gate.end(event.pointerId, event.clientX, event.clientY, event.target === canvas);
  };
  const cancel = () => gate.cancel();
  const invalid = () => { gate.invalidate(); pointers.clear(); panelFocus = false; availabilityChanged(false); };
  const key = (event: KeyboardEvent) => { if (event.key === "Escape") invalid(); };
  const hidden = () => { if (document.hidden) invalid(); };
  const cancelled = (event: PointerEvent) => { pointers.delete(event.pointerId); cancel(); };
  const toggle = () => { if (!open()) gate.invalidate(); availabilityChanged(canResume()); };
  document.addEventListener("pointerdown", down, true);
  document.addEventListener("pointermove", move, true);
  document.addEventListener("pointerup", up, true);
  document.addEventListener("pointercancel", cancelled, true);
  document.addEventListener("keydown", key, true);
  document.addEventListener("visibilitychange", hidden);
  document.addEventListener("wheel", cancel, true);
  document.addEventListener("scroll", cancel, true);
  document.addEventListener("contextmenu", cancel, true);
  root?.addEventListener("toggle", toggle, true);
  window.addEventListener("blur", invalid);
  const canResume = () => gate.canResume() && open() && !document.hidden &&
    !root?.querySelector('dialog[open], [aria-modal="true"], [inert] canvas');
  return {
    mode(walking: boolean, paused: boolean, reason?: WalkingPauseReason) {
      gate.mode(walking, paused, reason); availabilityChanged(canResume());
    },
    canResume,
    movement(allowed: boolean) {
      if (!gate.movement(allowed && canResume())) return false;
      for (const panel of panels()) panel.open = false;
      resume();
      return true;
    },
    isPanelFocus: (target: EventTarget | null) => panelFocus || owns(target),
    blank(event: MouseEvent, allowed: boolean) {
      if (!gate.consume(event.clientX, event.clientY, allowed && event.isTrusted && event.button === 0 && open())) return;
      for (const panel of panels()) panel.open = false;
      // Existing start clears held input and velocity; no pointer-lock request.
      resume();
    },
    dispose() {
      invalid(); clearTimeout(focusTimer);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", cancelled, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("visibilitychange", hidden);
      document.removeEventListener("wheel", cancel, true);
      document.removeEventListener("scroll", cancel, true);
      document.removeEventListener("contextmenu", cancel, true);
      root?.removeEventListener("toggle", toggle, true);
      window.removeEventListener("blur", invalid);
    },
  };
}
