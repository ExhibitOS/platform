// SPDX-License-Identifier: AGPL-3.0-or-later
export type WalkAction =
  "forward" | "backward" | "left" | "right" | "turn-left" | "turn-right";
export function createWalkingInput(
  canvas: HTMLCanvasElement,
  onPause: () => void,
  onCaptureError: (message: string) => void,
) {
  const keys = new Set<string>(),
    touch = new Map<number, WalkAction>();
  let disposed = false, captureGeneration = 0;
  let enabled = false,
    look: { id: number; x: number; y: number } | undefined,
    yawDelta = 0,
    pitchDelta = 0,
    hadLock = false;
  const clear = () => {
    keys.clear();
    touch.clear();
    look = undefined;
    yawDelta = 0;
    pitchDelta = 0;
  };
  const stop = () => {
    captureGeneration++;
    clear();
    enabled = false;
    onPause();
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
      stop();
      return;
    }
    if (codes.has(event.code)) {
      event.preventDefault();
      keys.add(event.code);
    }
  };
  const keyup = (event: KeyboardEvent) => keys.delete(event.code);
  const move = (event: MouseEvent) => {
    if (enabled && document.pointerLockElement === canvas) {
      yawDelta -= event.movementX * 0.002;
      pitchDelta -= event.movementY * 0.002;
    }
  };
  const visibility = () => {
    if (document.hidden) stop();
  };
  const lockchange = () => {
    const locked = document.pointerLockElement === canvas;
    if (hadLock && !locked) stop();
    hadLock = locked;
  };
  const pointerdown = (event: PointerEvent) => {
    if (
      !enabled ||
      event.pointerType !== "touch" ||
      event.clientX <
        canvas.getBoundingClientRect().left +
          canvas.getBoundingClientRect().width / 2
    )
      return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    look = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  };
  const pointermove = (event: PointerEvent) => {
    if (!enabled || look?.id !== event.pointerId) return;
    event.preventDefault();
    yawDelta -= (event.clientX - look.x) * 0.004;
    pitchDelta -= (event.clientY - look.y) * 0.004;
    look.x = event.clientX;
    look.y = event.clientY;
  };
  const pointerend = (event: PointerEvent) => {
    if (look?.id === event.pointerId) look = undefined;
    touch.delete(event.pointerId);
  };
  window.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);
  window.addEventListener("mousemove", move);
  window.addEventListener("blur", stop);
  canvas.addEventListener("blur", stop);
  document.addEventListener("visibilitychange", visibility);
  document.addEventListener("pointerlockchange", lockchange);
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
      canvas.focus({ preventScroll: true });
    },
    pause() {
      stop();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    },
    press(action: WalkAction, id: number) {
      if (enabled) touch.set(id, action);
    },
    release(id: number) {
      touch.delete(id);
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
        pitchDelta,
      };
      yawDelta = 0;
      pitchDelta = 0;
      return output;
    },
    async capture() {
      if (!enabled || disposed) return;
      const generation = ++captureGeneration;
      try {
        await canvas.requestPointerLock();
        if ((disposed || !enabled || generation !== captureGeneration) && document.pointerLockElement === canvas)
          document.exitPointerLock();
      } catch (error) {
        void error;
        if (!disposed && enabled && generation === captureGeneration)
          onCaptureError(
            "마우스 시점을 잡을 수 없습니다. 화살표와 터치 시점을 사용할 수 있습니다.",
          );
      }
    },
    dispose() {
      disposed = true;
      captureGeneration++;
      clear();
      enabled = false;
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("blur", stop);
      canvas.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("pointerlockchange", lockchange);
      canvas.removeEventListener("pointerdown", pointerdown);
      canvas.removeEventListener("pointermove", pointermove);
      canvas.removeEventListener("pointerup", pointerend);
      canvas.removeEventListener("pointercancel", pointerend);
      canvas.removeEventListener("lostpointercapture", pointerend);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    },
  };
}
