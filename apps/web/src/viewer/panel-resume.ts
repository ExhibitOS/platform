// SPDX-License-Identifier: AGPL-3.0-or-later
import type { WalkingPauseReason } from "./navigation-input";

// Temporary panel obstruction clears on last close. Explicit stops retain their own
// cause and need a fresh deliberate input; no stored keys, gesture or velocity replay.
export function createPanelResumeGate() {
  let active = false, eligible = false, panelOwned = false, stopGeneration = 0;
  let gesture: { id: number; x: number; y: number; released: boolean } | undefined;
  const cancel = () => { gesture = undefined; };
  return {
    mode(walking: boolean, paused: boolean, reason?: WalkingPauseReason) {
      const explicitPause = reason === "escape" || reason === "pointerlock" || reason === "user";
      const retained = active || eligible;
      if (explicitPause) {
        stopGeneration++; eligible = walking && retained; panelOwned = false;
      } else if (reason === "panel") {
        if (active) { eligible = walking; panelOwned = true; }
      } else if (reason !== "settings" || !eligible) {
        eligible = false; panelOwned = false;
        if (paused) stopGeneration++;
      }
      if (!walking) { eligible = false; panelOwned = false; }
      active = walking && !paused;
      cancel();
    },
    invalidate() { active = false; eligible = false; panelOwned = false; stopGeneration++; cancel(); },
    cancel,
    canResume: () => eligible,
    isActive: () => active,
    requiresPanel: () => panelOwned,
    panelClosed() {
      if (!panelOwned || !eligible) return false;
      panelOwned = false; eligible = false; cancel(); return true;
    },
    intent() {
      const generation = stopGeneration;
      return (allowed: boolean) => generation === stopGeneration && this.movement(allowed);
    },
    movement(allowed: boolean) {
      const result = eligible && allowed;
      if (result) { eligible = false; panelOwned = false; cancel(); }
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

export function installPanelResume(canvas: HTMLCanvasElement, pause: (reason?: WalkingPauseReason) => void, resume: () => void, availabilityChanged: (available: boolean) => void = () => {}, allowed: () => boolean = () => true) {
  const root = canvas.closest(".publication-shell");
  const gate = createPanelResumeGate(), pointers = new Set<number>();
  let gestureBlocked = false;
  let panelFocus = false, focusTimer: ReturnType<typeof setTimeout> | undefined;
  const panels = () => [...(root?.querySelectorAll<HTMLDetailsElement>("details[data-visitor-panel]") ?? [])];
  const owns = (target: EventTarget | null) => target instanceof Element &&
    (panels().some(panel => panel.contains(target)) || !!target.closest(".viewer-brief, .artwork-detail"));
  const open = () => panels().some(panel => panel.open);
  const down = (event: PointerEvent) => {
    pointers.add(event.pointerId);
    if (pointers.size > 1) gestureBlocked = true;
    gate.cancel();
    if (!event.isTrusted || !event.isPrimary || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || pointers.size !== 1) return;
    if (owns(event.target)) {
      // Pause before the pointer's default focus change, including browsers
      // whose canvas blur has a null relatedTarget. The opening click is never
      // a canvas gesture and therefore cannot resume the session it just paused.
      panelFocus = true;
      clearTimeout(focusTimer);
      focusTimer = setTimeout(() => { panelFocus = false; }, 0);
      pause();
    } else if (event.target === canvas) {
      gate.begin(event.pointerId, event.clientX, event.clientY, canResume());
    }
  };
  const move = (event: PointerEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) { gate.cancel(); return; }
    for (const sample of event.getCoalescedEvents?.() ?? [event]) gate.move(sample.pointerId, sample.clientX, sample.clientY);
    gate.move(event.pointerId, event.clientX, event.clientY);
  };
  const up = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (!pointers.size) gestureBlocked = false;
    gate.end(event.pointerId, event.clientX, event.clientY, event.target === canvas);
  };
  const cancel = () => gate.cancel();
  const invalid = () => { gate.invalidate(); pointers.clear(); gestureBlocked = false; panelFocus = false; availabilityChanged(false); };
  const key = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    // The input listener pauses the current session. A repeated Escape must not
    // erase that explicit resume choice; closing a mandatory dialog still does.
    if (root?.querySelector('dialog[open], [aria-modal="true"]')) invalid();
    else { gate.cancel(); if (root?.contains(document.activeElement)) pause("escape"); }
  };
  const hidden = () => { if (document.hidden) invalid(); };
  const cancelled = (event: PointerEvent) => { pointers.delete(event.pointerId); if (!pointers.size) gestureBlocked = false; cancel(); };
  const toggle = () => {
    if (open()) pause();
    else if (safe() && gate.panelClosed()) resume();
    availabilityChanged(canResume());
  };
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
  const safe = () => allowed() && !document.hidden &&
    !root?.querySelector('dialog[open], [aria-modal="true"], [inert] canvas');
  const canResume = () => gate.canResume() && !open() && safe();
  return {
    mode(walking: boolean, paused: boolean, reason?: WalkingPauseReason) {
      gate.mode(walking, paused, reason);
      if (walking && !paused && open()) queueMicrotask(() => { if (open() && gate.isActive()) pause(); });
      availabilityChanged(canResume());
    },
    canResume,
    movement(allowed: boolean) {
      if (!gate.movement(allowed && !gestureBlocked && pointers.size <= 1 && canResume())) return false;
      resume();
      return true;
    },
    intent() {
      const consume = gate.intent();
      return () => {
        if (!consume(!open() && safe())) return false;
        resume(); availabilityChanged(canResume()); return true;
      };
    },
    isPanelFocus: (target: EventTarget | null) => panelFocus || owns(target),
    blank(event: MouseEvent, allowed: boolean) {
      if (!gate.consume(event.clientX, event.clientY, allowed && event.isTrusted && event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && canResume())) return;
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
