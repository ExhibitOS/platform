// SPDX-License-Identifier: AGPL-3.0-or-later
export type WalkAction =
  "forward" | "backward" | "left" | "right" | "turn-left" | "turn-right" | "look-up" | "look-down";
export type WalkingPauseReason = "user" | "panel" | "settings" | "blur" | "window" | "hidden" | "escape" | "pointerlock";
export function createWalkingInput(
  canvas: HTMLCanvasElement,
  onPause: (reason: WalkingPauseReason) => void,
  onCaptureError: (message: string) => void,
  isPanelFocus: (target: EventTarget | null) => boolean = () => false,
  resumeMovement: () => boolean = () => false,
) {
  const blockedKeys = new Set<string>();
  const keys = new Set<string>(),
    touch = new Map<number, WalkAction>();
  const analog = new Map<number, { right: number; forward: number }>();
  let disposed = false, captureGeneration = 0;
  let pendingCapture: { generation: number } | undefined;
  let enabled = false,
    look: { id: number; x: number; y: number; pending?: boolean } | undefined,
    yawDelta = 0,
    pitchDelta = 0,
    hadLock = false;
  const clearLook = () => {
    const id = look?.id;
    look = undefined;
    if (id !== undefined && canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
  };
  const clear = () => {
    for (const code of keys) blockedKeys.add(code);
    keys.clear();
    touch.clear();
    analog.clear();
    clearLook();
    yawDelta = 0;
    pitchDelta = 0;
  };
  const stop = (reason: WalkingPauseReason = "user") => {
    captureGeneration++;
    clear();
    enabled = false;
    hadLock = false;
    onPause(reason);
  };
  const codes = new Set([
    "KeyW",
    "KeyA",
    "KeyS",
    "KeyD",
    "KeyQ",
    "KeyE",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
  ]);
  const keydown = (event: KeyboardEvent) => {
    // Respect text entry, IME, native controls, and application shortcuts even
    // if a browser leaves the canvas as the reported active element.
    const protectedTarget = (target: EventTarget | null) => typeof Element !== "undefined" && target instanceof Element &&
      !!target.closest('input,textarea,select,button,summary,a[href],[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="slider"],[role="button"],[role="dialog"],[aria-modal="true"]');
    if (event.repeat && codes.has(event.code) && !keys.has(event.code)) return;
    if (!event.repeat) blockedKeys.delete(event.code); // A keyup may have occurred in another app.
    if (blockedKeys.has(event.code) || event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
      event.altKey || event.ctrlKey || event.metaKey || document.hidden ||
      protectedTarget(event.target) || protectedTarget(document.activeElement)) return;
    if (!enabled && /^(KeyQ|KeyW|KeyE|KeyA|KeyS|KeyD)$/.test(event.code) && !event.repeat)
      resumeMovement(); // Synchronous start clears old inputs, then this event is applied below.
    if (
      !enabled ||
      (document.activeElement !== canvas &&
        document.pointerLockElement !== canvas) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    if (event.code === "Escape") {
      stop("escape");
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      return;
    }
    if (codes.has(event.code)) {
      event.preventDefault();
      keys.add(event.code);
    }
  };
  const keyup = (event: KeyboardEvent) => { keys.delete(event.code); blockedKeys.delete(event.code); };
  const move = (event: MouseEvent) => {
    if (enabled && document.pointerLockElement === canvas) {
      yawDelta -= event.movementX * 0.002;
      pitchDelta -= event.movementY * 0.002;
    }
  };
  const visibility = () => {
    if (document.hidden) stop("hidden");
  };
  const lockchange = () => {
    const locked = document.pointerLockElement === canvas;
    if (locked && pendingCapture && pendingCapture.generation !== captureGeneration) return;
    if (hadLock && !locked) stop("pointerlock");
    hadLock = locked;
  };
  const pointerdown = (event: PointerEvent) => {
    if (event.isPrimary === false && (!enabled || (touch.size === 0 && analog.size === 0))) {
      if (look?.pending) clearLook();
      return;
    }
    if (look) return; // A second canvas contact never steals the current look pointer.
    if (event.target !== canvas || event.defaultPrevented || document.hidden ||
      (!enabled && (event.altKey || event.ctrlKey || event.metaKey))) return;
    if (
      document.pointerLockElement === canvas ||
      (event.pointerType === "mouse" && event.button !== 0)
    )
      return;
    if (enabled) { event.preventDefault(); canvas.focus({ preventScroll: true }); }
    look = { id: event.pointerId, x: event.clientX, y: event.clientY, pending: true };
    canvas.setPointerCapture(event.pointerId);
  };
  const pointermove = (event: PointerEvent) => {
    if (look?.id !== event.pointerId) return;
    if (look.pending) {
      if (event.altKey || event.ctrlKey || event.metaKey) { clearLook(); return; }
      if (Math.hypot(event.clientX - look.x, event.clientY - look.y) <= 5) return;
      const gesture = look;
      if (!enabled) {
        if (!resumeMovement() || !enabled) { clearLook(); return; }
        canvas.setPointerCapture(event.pointerId); // enable releases stale capture; retain this intentional drag.
      }
      look = { ...gesture, pending: false }; // enable clears old input; retain only THIS intentional drag.
    }
    if (!enabled) return;
    event.preventDefault();
    yawDelta -= (event.clientX - look.x) * 0.004;
    pitchDelta -= (event.clientY - look.y) * 0.004;
    look.x = event.clientX;
    look.y = event.clientY;
  };
  const pointerend = (event: PointerEvent) => {
    if (look?.id === event.pointerId) clearLook();
    touch.delete(event.pointerId);
    analog.delete(event.pointerId);
  };
  const cancelPendingLook = () => { if (look?.pending) clearLook(); };
  const windowBlur = () => stop("window");
  const canvasBlur = (event: FocusEvent) => stop(isPanelFocus(event.relatedTarget) ? "panel" : "blur");
  window.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);
  window.addEventListener("mousemove", move);
  window.addEventListener("blur", windowBlur);
  canvas.addEventListener("blur", canvasBlur);
  document.addEventListener("visibilitychange", visibility);
  document.addEventListener("pointerlockchange", lockchange);
  document.addEventListener("wheel", cancelPendingLook, true);
  document.addEventListener("scroll", cancelPendingLook, true);
  document.addEventListener("contextmenu", cancelPendingLook, true);
  canvas.addEventListener("pointerdown", pointerdown);
  canvas.addEventListener("pointermove", pointermove);
  canvas.addEventListener("pointerup", pointerend);
  canvas.addEventListener("pointercancel", pointerend);
  canvas.addEventListener("lostpointercapture", pointerend);
  return {
    enable() {
      captureGeneration++;
      clear();
      enabled = true;
      hadLock = document.pointerLockElement === canvas;
      canvas.focus({ preventScroll: true });
    },
    pause(reason: WalkingPauseReason = "user") {
      stop(reason);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    },
    press(action: WalkAction, id: number) {
      if (enabled) {
        // Only a current control gesture keeps the walking canvas focused.
        // A paused session must still be resumed explicitly.
        canvas.focus({ preventScroll: true });
        touch.set(id, action);
      }
    },
    move(id: number, right: number, forward: number) {
      if (!enabled || !Number.isFinite(right) || !Number.isFinite(forward)) {
        analog.delete(id);
        return;
      }
      const length = Math.max(1, Math.hypot(right, forward));
      canvas.focus({ preventScroll: true });
      analog.set(id, { right: right / length, forward: forward / length });
    },
    release(id: number) {
      touch.delete(id);
      analog.delete(id);
    },
    sample(dt: number) {
      if (!enabled) return { forward: 0, right: 0, yawDelta: 0, pitchDelta: 0 };
      const actions = new Set(touch.values());
      const has = (action: WalkAction, ...codes: string[]) =>
        actions.has(action) || codes.some((code) => keys.has(code));
      const output = {
        forward:
          Number(has("forward", "KeyW", "ArrowUp")) -
          Number(has("backward", "KeyS", "ArrowDown")),
        right: Number(has("right", "KeyD")) - Number(has("left", "KeyA")),
        yawDelta:
          yawDelta +
          (Number(has("turn-left", "KeyQ", "ArrowLeft")) -
            Number(has("turn-right", "KeyE", "ArrowRight"))) *
            dt *
            1.2,
        pitchDelta:
          pitchDelta +
          (Number(actions.has("look-up")) - Number(actions.has("look-down"))) * dt * 1.2,
      };
      if (analog.size) {
        for (const value of analog.values()) {
          output.forward += value.forward;
          output.right += value.right;
        }
        const length = Math.max(1, Math.hypot(output.forward, output.right));
        output.forward /= length;
        output.right /= length;
      }
      yawDelta = 0;
      pitchDelta = 0;
      return output;
    },
    async capture() {
      if (!enabled || disposed || pendingCapture || document.pointerLockElement === canvas)
        return;
      const request = { generation: ++captureGeneration };
      pendingCapture = request;
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = (success: boolean) => {
          if (settled)
            return;
          settled = true;
          document.removeEventListener("pointerlockchange", changed);
          document.removeEventListener("pointerlockerror", failed);
          if (pendingCapture === request)
            pendingCapture = undefined;
          const current = !disposed && enabled && request.generation === captureGeneration;
          if (success && !current && document.pointerLockElement === canvas)
            document.exitPointerLock();
          if (!success && current)
            onCaptureError("마우스 시점을 잡을 수 없습니다. 화살표와 터치 시점을 사용할 수 있습니다.");
          resolve();
        };
        const changed = () => {
          if (document.pointerLockElement === canvas)
            finish(true);
        };
        const failed = () => finish(false);
        // Legacy implementations return void and complete only through document events.
        // Keep these guards after disposal until the browser settles its uncancellable
        // request, so a late success cannot leave native capture behind.
        document.addEventListener("pointerlockchange", changed);
        document.addEventListener("pointerlockerror", failed);
        try {
          const result = canvas.requestPointerLock() as Promise<void> | undefined;
          if (result && typeof result.then === "function")
            void result.then(() => finish(true), failed);
        }
        catch {
          failed();
        }
      });
    },
    dispose() {
      disposed = true;
      captureGeneration++;
      clear();
      enabled = false;
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("blur", windowBlur);
      canvas.removeEventListener("blur", canvasBlur);
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("pointerlockchange", lockchange);
      document.removeEventListener("wheel", cancelPendingLook, true);
      document.removeEventListener("scroll", cancelPendingLook, true);
      document.removeEventListener("contextmenu", cancelPendingLook, true);
      canvas.removeEventListener("pointerdown", pointerdown);
      canvas.removeEventListener("pointermove", pointermove);
      canvas.removeEventListener("pointerup", pointerend);
      canvas.removeEventListener("pointercancel", pointerend);
      canvas.removeEventListener("lostpointercapture", pointerend);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    },
  };
}
