// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Exhibition } from "@exhibitos/spec";
import type { PerspectiveCamera } from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { WalkingActions, WalkingSettings } from "../WalkingControls";
import type { NavigationState } from "./navigation";
import { createNavigationController, NAVIGATION_PROFILE } from "./navigation";
import { teleportToViewpoint } from "./navigation-teleport";
import { createWalkingInput } from "./navigation-input";
export async function createWalkingCamera({
  document,
  camera,
  initialCamera,
  controls,
  canvas,
  settings,
  render,
  onMode,
  onMessage,
  onState,
}: {
  document: Exhibition;
  camera: PerspectiveCamera;
  initialCamera?: PerspectiveCamera;
  controls: OrbitControls;
  canvas: HTMLCanvasElement;
  settings: WalkingSettings;
  render: () => void;
  onMode: (walking: boolean, paused: boolean) => void;
  onMessage: (text: string) => void;
  onState?: (state: NavigationState) => void;
}): Promise<{ actions: WalkingActions; dispose: () => void }> {
  const { Euler, Vector3 } = await import("three");
  const angles = new Euler().setFromQuaternion((initialCamera ?? camera).quaternion, "YXZ");
  const controller = await createNavigationController(document, {
    position: (initialCamera ?? camera).position.toArray() as [number, number, number],
    yaw: angles.y,
    ...settings,
  });
  canvas.dataset.navigationProfile = JSON.stringify({
    physicsVersion: controller.physicsVersion,
    ...NAVIGATION_PROFILE,
    walkableRegions: controller.walkableRegions.length,
    mesh: {
      cells: controller.navigationMesh.cells.length,
      triangles: controller.navigationMesh.triangles.length,
      edges:
        controller.navigationMesh.cells.reduce(
          (n, c) => n + c.neighbors.length,
          0,
        ) / 2,
      crossRoomEdges:
        controller.navigationMesh.cells.reduce(
          (n, c) =>
            n +
            c.neighbors.filter(
              (id) => controller.navigationMesh.cells[id]?.roomId !== c.roomId,
            ).length,
          0,
        ) / 2,
    },
  });
  const previousTouchAction = canvas.style.touchAction;
  let disposed = false,
    walking = false,
    paused = true,
    pitch = angles.x,
    targetPitch = angles.x,
    targetYaw = angles.y,
    captureMessage = "",
    frame = 0,
    last = 0;
  const publish = () => {
    const state = controller.state();
    canvas.dataset.navigationState = JSON.stringify({
      ...state,
      walking,
      pitch,
      targetYaw,
      targetPitch,
      lookTransition: settings.reducedMotion ? "immediate" : "smoothed",
      settings,
    });
    onState?.(state);
    return state;
  };
  const apply = () => {
    const state = publish();
    camera.position.fromArray(state.eyePosition);
    camera.rotation.set(pitch, state.yaw, 0, "YXZ");
    render();
  };
  const stop = () => {
    if (disposed) return;
    paused = true;
    controller.pause();
    targetYaw = controller.state().yaw;
    targetPitch = pitch;
    cancelAnimationFrame(frame);
    onMode(walking, true);
    publish();
    onMessage("걷기가 일시 정지되었습니다. 다시 걷기는 직접 선택하세요.");
  };
  const input = createWalkingInput(canvas, stop, (message) => {
    captureMessage = message;
    onMessage(message);
  });
  const tick = (now: number) => {
    if (disposed || paused) return;
    const dt = Math.max(0, (now - last) / 1000);
    last = now;
    const value = input.sample(Math.min(dt, 0.25));
    targetYaw += value.yawDelta;
    targetPitch = Math.max(
      -1.396,
      Math.min(1.396, targetPitch + value.pitchDelta),
    );
    const blend = settings.reducedMotion
      ? 1
      : 1 - Math.exp(-Math.min(dt, 0.25) * 14);
    pitch += (targetPitch - pitch) * blend;
    const state = controller.advance(dt, {
      forward: value.forward,
      right: value.right,
      yaw:
        controller.state().yaw + (targetYaw - controller.state().yaw) * blend,
      paused: false,
    });
    apply();
    if (captureMessage) onMessage(captureMessage);
    else if (state.blocked)
      onMessage(
        "벽·작품·바닥 경계가 이동을 막았습니다. 다른 방향으로 이동할 수 있습니다.",
      );
    else onMessage("걷기 중입니다. Esc 또는 일시 정지로 멈출 수 있습니다.");
    frame = requestAnimationFrame(tick);
  };
  const start = () => {
    if (disposed) return;
    walking = true;
    captureMessage = "";
    paused = false;
    controls.enabled = false;
    canvas.style.touchAction = "none";
    input.enable();
    onMode(true, false);
    last = performance.now();
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(tick);
    onMessage("걷기를 시작했습니다. 화면에 초점이 있습니다.");
  };
  const actions: WalkingActions = {
    start,
    teleport: (viewpointId) => {
      input.pause();
      try {
        const result=teleportToViewpoint(controller,document,viewpointId);
        pitch=result.pitch;targetPitch=pitch;targetYaw=result.state.yaw;
        walking=false;
        controls.enabled=true;
        canvas.style.touchAction=previousTouchAction;
        camera.fov=result.fov;
        camera.updateProjectionMatrix();
        camera.position.fromArray(result.state.eyePosition);
        camera.rotation.set(pitch,result.state.yaw,0,"YXZ");
        controls.target.copy(camera.position).add(new Vector3(0,0,-2).applyQuaternion(camera.quaternion));
        controls.update();
        onMode(false,true);
        apply();
        onMessage("검증된 viewpoint의 바닥과 눈높이로 즉시 이동했습니다. 정지 관람 중이며 걷기는 직접 선택하세요.");
      } catch {
        if(!walking)controls.enabled=true;
        onMessage("이 viewpoint는 몸의 여유 공간·바닥·시점 조건을 만족하지 않습니다. 기존 위치에서 정지했습니다. 작품 목록을 사용할 수 있습니다.");
      }
    },
    pause: () => input.pause(),
    stationary: () => {
      input.pause();
      walking = false;
      controls.enabled = true;
      canvas.style.touchAction = previousTouchAction;
      controls.target
        .copy(camera.position)
        .add(new Vector3(0, 0, -2).applyQuaternion(camera.quaternion));
      controls.update();
      onMode(false, true);
      publish();
      onMessage("정지 관람입니다. 시점 버튼과 작품 목록을 사용할 수 있습니다.");
    },
    capture: () => {
      start();
      void input.capture();
    },
    reset: () => {
      input.pause();
      try {
        controller.reset();
        pitch = angles.x;
        targetPitch = angles.x;
        targetYaw = angles.y;
        apply();
        onMessage("검증된 시작 위치로 돌아왔습니다. 걷기 재개를 선택하세요.");
      } catch {
        onMessage(
          "시작 위치가 안전하지 않습니다. 정지 관람과 작품 목록을 사용할 수 있습니다.",
        );
      }
    },
    settings: (value) => {
      input.pause();
      try {
        controller.setSettings(value);
        Object.assign(settings, value);
        if (walking) apply();
        else publish();
      } catch {
        onMessage("보행 설정을 적용할 수 없습니다.");
      }
    },
    press: (action, id) => input.press(action, id),
    release: (id) => input.release(id),
  };
  publish();
  onMessage("정지 관람 중입니다. 걷기 시작을 선택하면 실제 충돌이 적용됩니다.");
  return {
    actions,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      input.dispose();
      canvas.style.touchAction = previousTouchAction;
      controller.dispose();
      canvas.dataset.navigationDisposed = "true";
    },
  };
}
