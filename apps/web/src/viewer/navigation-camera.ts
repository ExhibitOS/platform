import type {MountedFurnishingCollision} from './furnishing-collision-mesh';
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Exhibition } from "@exhibitos/spec";
import type { PerspectiveCamera } from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { artifactPoint, presentationFor, benchesFor, benchSeat, type WorkspaceBenchVisual } from "@exhibitos/studio-contract";
import type { WalkingActions, WalkingSettings } from "../WalkingControls";
import type { NavigationState } from "./navigation";
import { createNavigationController, NAVIGATION_PROFILE } from "./navigation";
import { teleportToViewpoint, viewpointPose } from "./navigation-teleport";
import { createWalkingInput, type WalkingPauseReason } from "./navigation-input";
import {sculptureOrbitPose} from './sculpture-orbit';
export async function createWalkingCamera({
  document,
  camera,
  initialCamera,
  initialWalking,
  signal,
  controls,
  canvas,
  settings,
  render,
  onMode,
  onMessage,
  onState,
  isPanelFocus,
  resumeMovement,
  resumeDrag,
  resumeBenchArrow,
  activateContextAction,
  canLookSeated = () => true,
  onSeat,
  onNearbyBench,
  workspaceBenchAvailability,
  stoolVisible,
  furnishingCollisions,
  wasWalkingBeforeSeat,
  onViewpointFov,
}: {
  document: Exhibition;
  camera: PerspectiveCamera;
  initialCamera?: PerspectiveCamera;
  /** Rebuild an existing view in a paused state without scheduling movement. */
  initialWalking?: boolean;
  signal?: AbortSignal;
  controls: OrbitControls;
  canvas: HTMLCanvasElement;
  settings: WalkingSettings;
  render: () => void;
  onMode: (walking: boolean, paused: boolean, reason?: WalkingPauseReason) => void;
  onMessage: (text: string) => void;
  onState?: (state: NavigationState) => void;
  isPanelFocus?: (target: EventTarget | null) => boolean;
  resumeMovement?: () => boolean;
  resumeDrag?: () => boolean;
  resumeBenchArrow?: () => boolean;
  activateContextAction?: () => boolean;
  canLookSeated?: () => boolean;
  onSeat?: (benchId:string|null) => void;
  onNearbyBench?: (benchId: string | null) => void;
  stoolVisible?: (placementId:string)=>boolean;
  furnishingCollisions?:()=>readonly MountedFurnishingCollision[];
  workspaceBenchAvailability?: (link:WorkspaceBenchVisual) => 'pending'|'ready'|'unavailable';
  wasWalkingBeforeSeat?: () => boolean;
  /** The embedding projection owner retains the authored FOV and applies its
   * existing responsive/user display policy before this visit renders. */
  onViewpointFov?: (fov:number) => void;
}): Promise<{ actions: WalkingActions; dispose: () => void }> {
  signal?.throwIfAborted();
  const { Euler, Vector3, Quaternion } = await import("three");
  signal?.throwIfAborted();
  const defaultEntry = !initialCamera && !presentationFor(document).startCamera;
  const angles = defaultEntry ? new Euler(0, 0, 0, "YXZ") : new Euler().setFromQuaternion((initialCamera ?? camera).quaternion, "YXZ");
  const controller = await createNavigationController(document, {
    position: defaultEntry ? undefined : (initialCamera ?? camera).position.toArray() as [number, number, number],
    yaw: angles.y,
    stoolVisible,
    furnishingCollisions:furnishingCollisions?.(),
    ...settings,
  });
  if(signal?.aborted){controller.dispose();signal.throwIfAborted();}
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
    walking = initialWalking ?? false,
    paused = true,
    pitch = angles.x,
    targetPitch = angles.x,
    targetYaw = angles.y,
    captureMessage = "",
    frame = 0,
    last = 0;
  let orderedViewing=false;
  let orderedViewpointId:string|undefined;
  let seated: {benchId:string;roomId:string;workspaceVisual?:WorkspaceBenchVisual;eye:[number,number,number];floor:[number,number,number];floorCorners:readonly [number,number,number][];yaw:number;pitch:number;fov:number;returnFov:number;returnWalking:boolean;resumeInput:boolean}|undefined;
  let seatTransition:{phase:'sit'|'stand';startedAt:number;progress:number;
    from:import('three').Vector3;to:import('three').Vector3;fromRotation:import('three').Quaternion;toRotation:import('three').Quaternion;
    fromFov:number;toFov:number;complete:()=>void}|undefined;
  const seatPose = (benchId: string) => {
    const {bench, floor, top, floorCorners} = benchSeat(document, benchId);
    const destination = presentationFor(document).viewpoints.find(v => v.id.toLowerCase() === bench.viewpointId.toLowerCase());
    if (!destination) throw Error('BENCH_REFERENCE');
    const room = document.rooms.find(r => r.id.toLowerCase() === bench.roomId.toLowerCase())!;
    const eye = artifactPoint(destination.position, room.transform);
    const target = artifactPoint(destination.target, room.transform);
    if (!controller.seatedClear(eye, floor, top[1], bench.id, floorCorners)) throw Error('BENCH_SEAT_UNSAFE');
    return {bench, floor, floorCorners, eye, target, fov: destination.fov};
  };
  // The authored bench geometry and clearance are immutable for this adapter.
  const nearbySeats = onNearbyBench ? benchesFor(document).flatMap(bench => {
    try { return [seatPose(bench.id)]; } catch { return []; }
  }) : [];
  const nearbyBenchRadius = 1.6;
  let nearbyBenchId: string | null = null;
  const nearbyBench = (state: NavigationState): string | null => {
    if (disposed || seated || orderedViewing || !state.grounded || !state.roomId) return null;
    // In stationary orbit the camera can leave the controller's last walking pose.
    const [x, y, z] = state.eyePosition;
    // The controller rests slightly above the physical floor.
    if (!walking && (Math.hypot(camera.position.x - x, camera.position.z - z) > 1e-4 || Math.abs(camera.position.y - y) > .02)) return null;
    const roomId = state.roomId.toLowerCase();
    let nearest: string | null = null;
    let distance = nearbyBenchRadius;
    for (const {bench, floor} of nearbySeats) {
      if (bench.roomId.toLowerCase() !== roomId || bench.workspaceVisual && workspaceBenchAvailability?.(bench.workspaceVisual)!=='ready') continue;
      const meters = Math.hypot(floor[0] - x, floor[2] - z);
      if (meters > nearbyBenchRadius) continue;
      if (bench.id === nearbyBenchId) return bench.id;
      if (meters < distance || (meters === distance && (!nearest || bench.id < nearest))) {
        nearest = bench.id;
        distance = meters;
      }
    }
    return nearest;
  };
  const reportNearbyBench = (id: string | null) => {
    if (id === nearbyBenchId) return;
    nearbyBenchId = id;
    onNearbyBench?.(id);
  };
  const publish = () => {
    const raw = controller.state();
    const movingAngles=seatTransition?new Euler().setFromQuaternion(camera.quaternion,'YXZ'):undefined;
    const state:NavigationState=seated?{...raw,eyePosition:seatTransition?camera.position.toArray() as [number,number,number]:[...seated.eye],yaw:movingAngles?.y??seated.yaw,velocity:[0,0,0],grounded:false,paused:true}:raw;
    canvas.dataset.navigationState = JSON.stringify({
      ...state,
      walking,
      pitch,
      targetYaw,
      targetPitch,
      lookTransition: settings.reducedMotion ? "immediate" : "smoothed",
      seatTransition:seatTransition?{phase:seatTransition.phase,progress:seatTransition.progress,duration:350}:null,
      cameraQuaternion:seatTransition?camera.quaternion.toArray():undefined,
      settings,
    });
    onState?.(state);
    reportNearbyBench(nearbyBench(raw));
    return state;
  };
  const orbitChanged = () => {
    if (!disposed && !walking) reportNearbyBench(nearbyBench(controller.state()));
  };
  if (onNearbyBench) controls.addEventListener?.('change', orbitChanged);
  const apply = () => {
    const state = publish();
    if(!seatTransition){camera.position.fromArray(state.eyePosition);camera.rotation.set(pitch,state.yaw,0,'YXZ');}
    orbitChanged();
    render();
  };
  const seatTransitionClear=(transition:NonNullable<typeof seatTransition>)=>{
    try{
      if(transition.phase==='sit'){
        if(!seated)return false;
        const destination=seatPose(seated.benchId);
        if(destination.bench.workspaceVisual&&workspaceBenchAvailability?.(destination.bench.workspaceVisual)!=='ready')return false;
      }else{
        const standing=controller.qualifiedStandingEye(transition.to.toArray() as [number,number,number]);
        if(!standing||new Vector3(...standing).distanceTo(transition.to)>.005)return false;
      }
      return controller.viewSegmentClear(camera.position.toArray() as [number,number,number],transition.to.toArray() as [number,number,number]);
    }catch{return false;}
  };
  const abortSeatTransition=(transition:NonNullable<typeof seatTransition>)=>{
    seatTransition=undefined;cancelAnimationFrame(frame);paused=true;controller.pause();
    const saved=seated;if(!saved)return;
    const fromAngles=new Euler().setFromQuaternion(transition.fromRotation,'YXZ');
    const from=transition.from.toArray() as [number,number,number];
    const rollback=transition.phase==='sit'?controller.qualifiedStandingEye(from):from;
    let clear=!!rollback&&controller.viewSegmentClear(camera.position.toArray() as [number,number,number],rollback);
    if(clear&&transition.phase==='stand'){try{seatPose(saved.benchId);}catch{clear=false;}}
    if(clear&&rollback){
      if(transition.phase==='sit'){
        controller.reset({position:rollback,yaw:fromAngles.y});seated=undefined;walking=saved.returnWalking;
        controls.enabled=!walking;canvas.style.touchAction=walking?'none':previousTouchAction;
        onSeat?.(null);onMode(walking,true,saved.resumeInput?'bench-return':undefined);
      }else{saved.eye=[...rollback];saved.yaw=fromAngles.y;saved.pitch=fromAngles.x;}
      camera.position.fromArray(rollback);camera.quaternion.copy(transition.fromRotation);camera.fov=transition.fromFov;camera.updateProjectionMatrix();
      pitch=fromAngles.x;targetPitch=pitch;targetYaw=fromAngles.y;
      controls.target.copy(camera.position).add(new Vector3(0,0,-2).applyQuaternion(camera.quaternion));
      apply();
    }else{
      // No certified endpoint is reachable after a scene change: do not move
      // through the obstruction or create standing eligibility at this point.
      const current=new Euler().setFromQuaternion(camera.quaternion,'YXZ');
      saved.eye=camera.position.toArray() as [number,number,number];saved.yaw=current.y;saved.pitch=current.x;
      pitch=current.x;targetPitch=pitch;targetYaw=current.y;walking=false;controls.enabled=false;onMode(false,true);
      publish();render();
    }
    onMessage('이동 경로가 바뀌어 안전한 위치에서 멈췄습니다.');
  };
  const finishSeatTransition=()=>{
    const transition=seatTransition;if(!transition||disposed)return;
    if(!seatTransitionClear(transition)){abortSeatTransition(transition);return;}
    seatTransition=undefined;cancelAnimationFrame(frame);
    try{transition.complete();}catch{
      // reset revalidates the standing capsule. Keep the qualified seat if a
      // newly active obstacle invalidates the landing before this completion.
      if(seated){camera.position.fromArray(seated.eye);camera.rotation.set(pitch,seated.yaw,0,'YXZ');camera.fov=transition.fromFov;camera.updateProjectionMatrix();}
      onMessage('주변 공간이 바뀌어 앉은 상태를 유지합니다.');apply();return;
    }
    camera.position.copy(transition.to);camera.quaternion.copy(transition.toRotation);camera.fov=transition.toFov;camera.updateProjectionMatrix();
    const end=new Euler().setFromQuaternion(camera.quaternion,'YXZ');pitch=end.x;targetPitch=pitch;targetYaw=end.y;
    if(seated){seated.yaw=end.y;seated.pitch=end.x;}
    controls.target.copy(camera.position).add(new Vector3(0,0,-2).applyQuaternion(camera.quaternion));
    apply();if(transition.phase==='stand')canvas.focus({preventScroll:true});
  };
  const animateSeat=(phase:'sit'|'stand',eye:[number,number,number],yaw:number,nextPitch:number,fov:number,complete:()=>void)=>{
    cancelAnimationFrame(frame);
    const transition={phase,startedAt:performance.now(),progress:0,from:camera.position.clone(),to:new Vector3(...eye),
      fromRotation:camera.quaternion.clone(),toRotation:new Quaternion().setFromEuler(new Euler(nextPitch,yaw,0,'YXZ')),fromFov:camera.fov,toFov:fov,complete};
    seatTransition=transition;
    if(settings.reducedMotion){finishSeatTransition();return;}
    const advance=(now:number)=>{
      if(disposed||seatTransition!==transition)return;
      if(!seatTransitionClear(transition)){abortSeatTransition(transition);return;}
      const t=Math.min(1,Math.max(0,(now-transition.startedAt)/350));transition.progress=t;
      if(t===1){finishSeatTransition();return;}
      const ease=t*t*(3-2*t);
      camera.position.lerpVectors(transition.from,transition.to,ease);
      camera.quaternion.slerpQuaternions(transition.fromRotation,transition.toRotation,ease);
      camera.fov=transition.fromFov+(transition.toFov-transition.fromFov)*ease;camera.updateProjectionMatrix();
      pitch=new Euler().setFromQuaternion(camera.quaternion,'YXZ').x;
      apply();if(!disposed&&seatTransition===transition)frame=requestAnimationFrame(advance);
    };
    apply();frame=requestAnimationFrame(advance);
  };
  const standLanding=(saved:NonNullable<typeof seated>)=>{
    const current=camera.position.toArray() as [number,number,number],height=saved.floor[1]+settings.eyeHeight;
    const qualify=(x:number,z:number)=>{const eye=controller.qualifiedStandingEye([x,height,z]);return eye&&controller.viewSegmentClear(current,eye)?eye:undefined;};
    const vertical=qualify(current[0],current[2]);if(vertical)return {eye:vertical,displaced:false};
    const [a,b,c]=saved.floorCorners;if(!a||!b||!c)return undefined;
    const u=new Vector3(c[0]-a[0],0,c[2]-a[2]),v=new Vector3(b[0]-a[0],0,b[2]-a[2]),width=u.length(),depth=v.length();
    if(width<1e-6||depth<1e-6)return undefined;u.divideScalar(width);v.divideScalar(depth);
    const offset=new Vector3(current[0]-a[0],0,current[2]-a[2]),x=Math.max(0,Math.min(width,offset.dot(u))),z=Math.max(0,Math.min(depth,offset.dot(v))),gap=NAVIGATION_PROFILE.radius+NAVIGATION_PROFILE.skin;
    const point=(du:number,dv:number)=>new Vector3(a[0],height,a[2]).addScaledVector(u,du).addScaledVector(v,dv).toArray() as [number,number,number];
    // Authored front wins equal-distance ties, independent of the current gaze.
    const candidates=[point(x,-gap),point(x,depth+gap),point(-gap,z),point(width+gap,z)];
    const cells=controller.navigationMesh.cells.filter(cell=>cell.roomId.toLowerCase()===saved.roomId.toLowerCase()&&Math.abs(cell.center[1]-saved.floor[1])<.05).map(cell=>{
      const points=cell.vertices.map(i=>controller.navigationMesh.vertices[i]!);
      return [Math.max(Math.min(...points.map(p=>p[0])),Math.min(Math.max(...points.map(p=>p[0])),current[0])),height,Math.max(Math.min(...points.map(p=>p[2])),Math.min(Math.max(...points.map(p=>p[2])),current[2]))] as [number,number,number];
    }).filter(p=>Math.hypot(p[0]-current[0],p[2]-current[2])<=2).sort((a,b)=>Math.hypot(a[0]-current[0],a[2]-current[2])-Math.hypot(b[0]-current[0],b[2]-current[2])).slice(0,32);
    candidates.push(...cells);
    const ranked=candidates.map((seed,index)=>({seed,index,distance:Math.hypot(seed[0]-current[0],seed[2]-current[2])})).filter(candidate=>candidate.distance<=2).sort((a,b)=>Math.abs(a.distance-b.distance)>1e-7?a.distance-b.distance:a.index-b.index);
    for(const {seed}of ranked){const eye=qualify(seed[0],seed[2]);if(eye)return {eye,displaced:true};}
    return undefined;
  };
  const stop = (reason: WalkingPauseReason) => {
    if (disposed) return;
    paused = true;
    if (seated && (reason === "hidden" || reason === "window" || reason === "escape" || reason === "user")) {
      seated.resumeInput = false;
    }
    finishSeatTransition();
    controller.pause();
    targetYaw = seated?.yaw ?? controller.state().yaw;
    targetPitch = pitch;
    cancelAnimationFrame(frame);
    onMode(walking, true, reason);
    publish();
    if(seated)return;
    onMessage(reason === "escape" || reason === "pointerlock" || reason === "user"
      ? "걷기가 멈췄습니다. W/A/S/D 또는 빈 공간 클릭으로 다시 걸을 수 있어요."
      : "걷기가 일시 정지되었습니다. 다시 걷기는 직접 선택하세요.");
  };
  const startPointerLook = () => {
    if(!seated)return (resumeDrag??resumeMovement)?.()??false;
    if(disposed||seatTransition||!canLookSeated())return false;
    input.enable();
    return true;
  };
  const queueSeatedLook = () => {
    if(!seated||disposed||seatTransition)return;
    cancelAnimationFrame(frame);
    frame=requestAnimationFrame(()=>{
      if(!seated||disposed)return;
      const {yawDelta,pitchDelta}=input.sample(0);
      if(!canLookSeated())return;
      seated.yaw+=yawDelta;
      pitch=Math.max(-1.396,Math.min(1.396,pitch+pitchDelta));
      targetYaw=seated.yaw;
      targetPitch=pitch;
      apply();
    });
  };
  const input = createWalkingInput(canvas, stop, (message) => {
    captureMessage = message;
    onMessage(message);
  }, isPanelFocus, resumeMovement, startPointerLook, resumeBenchArrow, activateContextAction, queueSeatedLook, ()=>!seatTransition&&(!seated||canLookSeated()));
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
  const start = (shouldFocus?:()=>boolean) => {
    if (disposed || seated || orderedViewing) return;
    walking = true;
    captureMessage = "";
    paused = false;
    controls.enabled = false;
    canvas.style.touchAction = "none";
    const focus=shouldFocus?.()!==false;
    input.enable(focus);
    onMode(true, false);
    last = performance.now();
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(tick);
    onMessage(focus?"걷기를 시작했습니다. 화면에 초점이 있습니다.":"걷기를 시작했습니다.");
  };
  const prepareViewpoint = (id:string) => {
    if(disposed||seated)return undefined;
    try{const authored=viewpointPose(document,id),position=controller.qualifiedStandingEye(authored.position);if(!position)return undefined;const angle=Math.atan2(authored.target[1]-position[1],Math.hypot(authored.target[0]-position[0],authored.target[2]-position[2]));return Math.abs(angle)<=1.396?{...authored,position}:undefined;}catch{return undefined;}
  };
  const applyViewpointFov = (fov:number) => {
    if(onViewpointFov)onViewpointFov(fov);
    else {camera.fov=fov;camera.updateProjectionMatrix();}
  };
  const actions: WalkingActions = {
    start,
    prepareViewpoint:async id=>prepareViewpoint(id),
    visitViewpoint:(id,ordered)=>{
      const destination=prepareViewpoint(id);if(!destination)return false;
      input.pause('panel');
      const state=controller.reset({position:destination.position,yaw:destination.yaw});
      pitch=Math.atan2(destination.target[1]-state.eyePosition[1],Math.hypot(destination.target[0]-state.eyePosition[0],destination.target[2]-state.eyePosition[2]));
      targetPitch=pitch;targetYaw=state.yaw;orderedViewing=ordered;orderedViewpointId=ordered?id:undefined;walking=true;paused=true;
      controls.enabled=false;canvas.style.touchAction=ordered?'manipulation':'none';
      applyViewpointFov(destination.fov);
      camera.position.fromArray(state.eyePosition);camera.rotation.set(pitch,state.yaw,0,'YXZ');controls.target.fromArray(destination.target);
      onMode(walking,true,'panel');apply();return true;
    },
    orbitViewpoint:(id,relativeYaw)=>{
      if(disposed||seated||!orderedViewing||orderedViewpointId!==id||!paused)return false;
      const base=prepareViewpoint(id),destination=base&&sculptureOrbitPose(base.position,base.target,relativeYaw);
      if(!base||!destination||!controller.standingSegmentClear(controller.state().eyePosition,destination.position))return false;
      const state=controller.reset({position:destination.position,yaw:destination.yaw});
      pitch=Math.atan2(base.target[1]-state.eyePosition[1],Math.hypot(base.target[0]-state.eyePosition[0],base.target[2]-state.eyePosition[2]));targetPitch=pitch;targetYaw=state.yaw;
      controls.enabled=false;controls.target.fromArray(base.target);applyViewpointFov(base.fov);apply();return true;
    },
    freeViewing:()=>{if(disposed||seated)return false;if(!orderedViewing)return true;orderedViewing=false;orderedViewpointId=undefined;walking=true;controls.enabled=false;canvas.style.touchAction='none';onMode(true,true,'settings');publish();return true;},
    sit: benchId => {
      if(disposed||seated||orderedViewing)return;
      try {
        const {bench, floor, floorCorners, eye, target, fov} = seatPose(benchId);
        if(bench.workspaceVisual&&workspaceBenchAvailability?.(bench.workspaceVisual)!=='ready'){
          onMessage('벤치가 아직 표시되지 않아 앉을 수 없어요.');
          return;
        }
        const yaw=Math.atan2(-(target[0]-eye[0]),-(target[2]-eye[2])),seatPitch=Math.max(-1.396,Math.min(1.396,Math.atan2(target[1]-eye[1],Math.hypot(target[0]-eye[0],target[2]-eye[2]))));
        if(!controller.viewSegmentClear(camera.position.toArray() as [number,number,number],eye))throw Error('BENCH_VIEW_PATH_UNSAFE');
        const snapshot={benchId:bench.id,roomId:bench.roomId,workspaceVisual:bench.workspaceVisual,eye,floor,floorCorners,yaw,pitch:seatPitch,fov,returnFov:camera.fov,returnWalking:walking,resumeInput:walking && wasWalkingBeforeSeat?.() === true};
        input.pause("panel");seated=snapshot;walking=false;paused=true;controls.enabled=false;canvas.style.touchAction="none";
        targetPitch=seatPitch;targetYaw=yaw;onMode(false,true);onSeat?.(bench.id);
        onMessage('벤치에 앉습니다.');
        animateSeat('sit',eye,yaw,seatPitch,fov,()=>onMessage('앉은 위치에서 드래그해 둘러볼 수 있어요. 일어서면 현재 시선을 유지합니다.'));
      } catch {onMessage('이 벤치의 바닥·눈높이·여유 공간이 안전하지 않습니다. 현재 위치와 작품 목록을 유지합니다.');}
    },
    sitNearby: expectedBenchId => {
      if (disposed || !nearbyBenchId || expectedBenchId !== nearbyBenchId) return false;
      const current = nearbyBench(controller.state());
      reportNearbyBench(current);
      if (current !== expectedBenchId) return false;
      actions.sit?.(expectedBenchId);
      return seated?.benchId === expectedBenchId;
    },
    refreshFurnishingCollisions:()=>{if(!disposed)controller.setFurnishingCollisions(furnishingCollisions?.()??[]);},
    refreshWorkspaceBench: () => {
      if(disposed)return;
      if(seated?.workspaceVisual&&workspaceBenchAvailability?.(seated.workspaceVisual)==='unavailable')actions.stand?.();
      else reportNearbyBench(nearbyBench(controller.state()));
    },
    stand: () => {
      if(!seated||disposed||seatTransition?.phase==='stand')return;
      finishSeatTransition();
      const saved=seated,angle=new Euler().setFromQuaternion(camera.quaternion,'YXZ'),landing=standLanding(saved);
      input.pause('panel');
      if(!landing){onMessage('주변에 안전하게 일어설 공간이 없어요. 앉은 상태를 유지합니다.');return;}
      onMessage(landing.displaced?'앉은 자리에는 서 있을 공간이 없어 가까운 빈 곳에서 일어납니다.':'현재 시선을 유지하며 일어납니다.');
      animateSeat('stand',landing.eye,angle.y,angle.x,saved.returnFov,()=>{
        controller.reset({position:landing.eye,yaw:angle.y});
        seated=undefined;walking=saved.returnWalking;paused=true;
        controls.enabled=!walking;canvas.style.touchAction=walking?'none':previousTouchAction;
        onSeat?.(null);onMode(walking,true,saved.resumeInput&&controller.state().grounded?'bench-return':undefined);
        onMessage('현재 시선을 유지해 일어났습니다.');
      });
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
      if(seated||orderedViewing)return;
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
      if(seated){
        settings.reducedMotion=value.reducedMotion;controller.setSettings({reducedMotion:value.reducedMotion});
        if(value.reducedMotion)finishSeatTransition();publish();return;
      }
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
    move: (id, right, forward) => {if(!orderedViewing)input.move(id,right,forward);},
    release: (id) => input.release(id),
  };
  if(initialWalking!==undefined){if(walking)controls.enabled=false;onMode(walking,true,'settings');}
  publish();
  onMessage("정지 관람 중입니다. 걷기 시작을 선택하면 실제 충돌이 적용됩니다.");
  return {
    actions,
    dispose: () => {
      if (disposed) return;
      disposed = true;seatTransition=undefined;
      reportNearbyBench(null);
      if (onNearbyBench) controls.removeEventListener?.('change', orbitChanged);
      cancelAnimationFrame(frame);
      input.dispose();
      canvas.style.touchAction = previousTouchAction;
      controller.dispose();
      canvas.dataset.navigationDisposed = "true";
    },
  };
}
