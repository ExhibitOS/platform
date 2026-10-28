// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Exhibition } from "@exhibitos/spec";
import type { PerspectiveCamera } from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { artifactPoint, presentationFor, benchSeat } from "@exhibitos/studio-contract";
import type { WalkingActions, WalkingSettings } from "../WalkingControls";
import type { NavigationState } from "./navigation";
import { createNavigationController, NAVIGATION_PROFILE } from "./navigation";
import { teleportToViewpoint, viewpointPose } from "./navigation-teleport";
import { createWalkingInput, type WalkingPauseReason } from "./navigation-input";
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
  isPanelFocus,
  resumeMovement,
  onSeat,
}: {
  document: Exhibition;
  camera: PerspectiveCamera;
  initialCamera?: PerspectiveCamera;
  controls: OrbitControls;
  canvas: HTMLCanvasElement;
  settings: WalkingSettings;
  render: () => void;
  onMode: (walking: boolean, paused: boolean, reason?: WalkingPauseReason) => void;
  onMessage: (text: string) => void;
  onState?: (state: NavigationState) => void;
  isPanelFocus?: (target: EventTarget | null) => boolean;
  resumeMovement?: () => boolean;
  onSeat?: (benchId:string|null) => void;
}): Promise<{ actions: WalkingActions; dispose: () => void }> {
  const { Euler, Vector3 } = await import("three");
  const defaultEntry = !initialCamera && !presentationFor(document).startCamera;
  const angles = defaultEntry ? new Euler(0, 0, 0, "YXZ") : new Euler().setFromQuaternion((initialCamera ?? camera).quaternion, "YXZ");
  const controller = await createNavigationController(document, {
    position: defaultEntry ? undefined : (initialCamera ?? camera).position.toArray() as [number, number, number],
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
  let orderedViewing=false;
  let seated: {benchId:string;eye:[number,number,number];yaw:number;pitch:number;fov:number;returnPosition:[number,number,number];returnQuaternion:[number,number,number,number];returnTarget:[number,number,number];returnFov:number;returnPitch:number;returnWalking:boolean;returnPaused:boolean}|undefined;
  const publish = () => {
    const raw = controller.state();
    const state:NavigationState=seated?{...raw,eyePosition:[...seated.eye],yaw:seated.yaw,velocity:[0,0,0],grounded:false,paused:true}:raw;
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
  const stop = (reason: WalkingPauseReason) => {
    if (disposed) return;
    paused = true;
    controller.pause();
    targetYaw = controller.state().yaw;
    targetPitch = pitch;
    cancelAnimationFrame(frame);
    onMode(walking, true, reason);
    publish();
    onMessage(reason === "escape" || reason === "pointerlock" || reason === "user"
      ? "걷기가 멈췄습니다. W/A/S/D 또는 빈 공간 클릭으로 다시 걸을 수 있어요."
      : "걷기가 일시 정지되었습니다. 다시 걷기는 직접 선택하세요.");
  };
  const input = createWalkingInput(canvas, stop, (message) => {
    captureMessage = message;
    onMessage(message);
  }, isPanelFocus, resumeMovement);
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
    if (disposed || seated || orderedViewing) return;
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
  const prepareViewpoint = (id:string) => {
    if(disposed||seated)return undefined;
    try{const authored=viewpointPose(document,id),position=controller.qualifiedStandingEye(authored.position);if(!position)return undefined;const angle=Math.atan2(authored.target[1]-position[1],Math.hypot(authored.target[0]-position[0],authored.target[2]-position[2]));return Math.abs(angle)<=1.396?{...authored,position}:undefined;}catch{return undefined;}
  };
  const actions: WalkingActions = {
    start,
    prepareViewpoint:async id=>prepareViewpoint(id),
    visitViewpoint:(id,ordered)=>{
      const destination=prepareViewpoint(id);if(!destination)return false;
      input.pause('panel');
      const state=controller.reset({position:destination.position,yaw:destination.yaw});
      pitch=Math.atan2(destination.target[1]-state.eyePosition[1],Math.hypot(destination.target[0]-state.eyePosition[0],destination.target[2]-state.eyePosition[2]));
      targetPitch=pitch;targetYaw=state.yaw;orderedViewing=ordered;walking=true;paused=true;
      controls.enabled=false;canvas.style.touchAction=ordered?'manipulation':previousTouchAction;
      camera.fov=destination.fov;camera.updateProjectionMatrix();
      camera.position.fromArray(state.eyePosition);camera.rotation.set(pitch,state.yaw,0,'YXZ');controls.target.fromArray(destination.target);
      onMode(walking,true,'panel');apply();return true;
    },
    freeViewing:()=>{if(disposed||seated)return false;if(!orderedViewing)return true;orderedViewing=false;walking=true;controls.enabled=false;canvas.style.touchAction='none';onMode(true,true,'settings');publish();return true;},
    sit: benchId => {
      if(disposed||seated||orderedViewing)return;
      try {
        const {bench,floor,top,floorCorners}=benchSeat(document,benchId), destination=presentationFor(document).viewpoints.find(v=>v.id.toLowerCase()===bench.viewpointId.toLowerCase());
        if(!destination)throw Error('BENCH_REFERENCE');
        const room=document.rooms.find(r=>r.id.toLowerCase()===bench.roomId.toLowerCase())!;
        const eye=artifactPoint(destination.position,room.transform),target=artifactPoint(destination.target,room.transform);
        if(!controller.seatedClear(eye,floor,top[1],bench.id,floorCorners))throw Error('BENCH_SEAT_UNSAFE');
        const yaw=Math.atan2(-(target[0]-eye[0]),-(target[2]-eye[2])),seatPitch=Math.max(-1.396,Math.min(1.396,Math.atan2(target[1]-eye[1],Math.hypot(target[0]-eye[0],target[2]-eye[2]))));
        const snapshot={benchId:bench.id,eye,yaw,pitch:seatPitch,fov:destination.fov,returnPosition:camera.position.toArray() as [number,number,number],returnQuaternion:camera.quaternion.toArray() as [number,number,number,number],returnTarget:controls.target.toArray() as [number,number,number],returnFov:camera.fov,returnPitch:pitch,returnWalking:walking,returnPaused:paused};
        input.pause();seated=snapshot;walking=false;paused=true;controls.enabled=false;
        pitch=seatPitch;targetPitch=pitch;targetYaw=yaw;
        camera.fov=destination.fov;camera.updateProjectionMatrix();apply();onMode(false,true);onSeat?.(bench.id);
        onMessage('앉아서 감상 중입니다. 일어서서 돌아가기를 선택하면 이전 위치로 돌아갑니다.');
      } catch {onMessage('이 벤치의 바닥·눈높이·여유 공간이 안전하지 않습니다. 현재 위치와 작품 목록을 유지합니다.');}
    },
    stand: () => {
      if(!seated||disposed)return;
      const saved=seated;input.pause();seated=undefined;
      pitch=saved.returnPitch;targetPitch=pitch;targetYaw=controller.state().yaw;walking=saved.returnWalking;paused=true;
      camera.position.fromArray(saved.returnPosition);camera.quaternion.fromArray(saved.returnQuaternion);camera.fov=saved.returnFov;camera.updateProjectionMatrix();
      controls.target.fromArray(saved.returnTarget);controls.enabled=!walking;canvas.style.touchAction=walking?'none':previousTouchAction;
      onMode(walking,true);onSeat?.(null);publish();render();
      canvas.focus({preventScroll:true});
      onMessage('이전 위치와 시점으로 돌아왔습니다. 걷기는 직접 재개하세요.');
    },
    teleport: (viewpointId) => {
      if(seated||orderedViewing)return;
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
    pause: (reason) => input.pause(reason),
    stationary: () => {
      if(seated||orderedViewing)return;
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
      if(orderedViewing)return;
      start();
      void input.capture();
    },
    reset: () => {
      if(seated||orderedViewing)return;
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
      if(seated)return;
      input.pause("settings");
      try {
        controller.setSettings(value);
        Object.assign(settings, value);
        if (walking) apply();
        else publish();
      } catch {
        onMessage("보행 설정을 적용할 수 없습니다.");
      }
    },
    press: (action, id) => {if(!orderedViewing)input.press(action,id);},
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
