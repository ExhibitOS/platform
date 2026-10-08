import { embeddedPNGManager } from './embedded-glb.js';
import type { PresenceVisitor } from "./viewer/realtime-motion";
import type { ScriptScene } from "./viewer/scripting";
import type { GuideRequest } from "./GuidedRoutes";
import { useEffect, useRef, useState } from "react";
import {
  AssetScheduler,
  MemoryAssetCache,
  fetchVerifiedAsset,
  prioritizePlacements,
  selectAssetVariant,
  type DeviceBudget,
} from "./viewer/loading";
import { validateArchitecture, daylightFor, daylightDirection, presentationFor, lodVariantsFor } from "@exhibitos/studio-contract";
import {
  WalkingControls,
  WalkingTouch,
  type WalkingActions,
  type WalkingSettings,
} from "./WalkingControls";
import { viewpointPose } from "./viewer/navigation-teleport";
import type { NavigationState } from "./viewer/navigation";
import type { PublicAsset } from "./publication-client";
import type { Session } from "./cms-client";
import type { Draft } from "./drafts/store";

type Document = Draft["candidate"];
export interface RealtimeScene { update: (visitors:readonly PresenceVisitor[])=>void; clear:()=>void }
export interface SurfaceAppearance {
  baseColor: [number, number, number];
  roughness: number;
  metalness: number;
}
export interface DetailEntryActions {
  prepare: () => void;
  commit: (pointer: boolean) => void;
}
export interface GeometrySelection {
  kind: "room" | "surface" | "opening";
  id: string;
}

// Partition centered XY rectangles instead of triangulating holes that touch a
// wall edge. A floor-level door is an actual empty region in the rendered wall.
function panels(
  surface: Document["surfaces"][number],
  openings: Document["openings"],
) {
  const width = surface.dimensions.width,
    height = surface.dimensions.height;
  const rectangles = openings
    .filter((item) => item.surfaceId.toLowerCase() === surface.id.toLowerCase())
    .map((item) => ({
      left: item.offset[0] - item.dimensions.width / 2,
      right: item.offset[0] + item.dimensions.width / 2,
      bottom: item.offset[1] - item.dimensions.height / 2,
      top: item.offset[1] + item.dimensions.height / 2,
    }));
  const xs = [
    ...new Set([
      -width / 2,
      width / 2,
      ...rectangles.flatMap((item) => [item.left, item.right]),
    ]),
  ].sort((a, b) => a - b);
  const result: Array<{ x: number; y: number; width: number; height: number }> =
    [];
  for (let i = 0; i < xs.length - 1; i++) {
    const left = xs[i]!,
      right = xs[i + 1]!,
      mid = (left + right) / 2;
    if (right <= left) continue;
    const blocked = rectangles
      .filter((item) => mid > item.left && mid < item.right)
      .sort((a, b) => a.bottom - b.bottom);
    let bottom = -height / 2;
    for (const item of blocked) {
      if (item.bottom > bottom)
        result.push({
          x: mid,
          y: (bottom + item.bottom) / 2,
          width: right - left,
          height: item.bottom - bottom,
        });
      bottom = Math.max(bottom, item.top);
    }
    if (bottom < height / 2)
      result.push({
        x: mid,
        y: (bottom + height / 2) / 2,
        width: right - left,
        height: height / 2 - bottom,
      });
  }
  return result;
}

export function GeometryPreview({
  document,
  selection,
  appearance,
  session,
  publicSource,
  viewerBudget,
  suspendNavigation = false,
  onNavigationState,
  onCameraPose,
  onNavigationMode,
  onArtworkSelect,
  proximityDetail = false,
  onDetailEntryReady,
  reducedMotion,
  onReducedMotionChange,
  guideRequest,
  onScriptSceneReady,
  onScriptPose,
  onScriptClick,
  onPresenceSceneReady,
  onPresencePose,
  openingViewpoint,
}: {
  document: Document;
  viewerBudget?: DeviceBudget;
  suspendNavigation?: boolean;
  onNavigationState?: (state: NavigationState) => void;
  onCameraPose?: (position: [number,number,number],yaw: number) => void;
  onNavigationMode?: (walking: boolean, paused: boolean) => void;
  onArtworkSelect?: (id: string) => void;
  proximityDetail?: boolean;
  onDetailEntryReady?: (actions: DetailEntryActions | null) => void;
  reducedMotion?: boolean;
  guideRequest?: GuideRequest;
  onScriptSceneReady?: (scene:ScriptScene|null)=>void;
  onScriptPose?: (position:[number,number,number],forward:[number,number,number])=>void;
  onScriptClick?: (placementId:string)=>void;
  onPresenceSceneReady?: (scene:RealtimeScene|null)=>void;
  onPresencePose?: (position:[number,number,number],yaw:number)=>void;
  openingViewpoint?: {viewpointId:string;sequence:number};
  onReducedMotionChange?: (value: boolean) => void;
  session: Session | null;
  publicSource?: {
    publicationId: string;
    revisionSha256: string;
    assets: PublicAsset[];
    fetcher?: typeof fetch;
    check?: () => Promise<void>;
  };
  selection: GeometrySelection | null;
  appearance: (surfaceId: string) => SurfaceAppearance;
}) {
  const openingConsumed=useRef<number|undefined>(undefined);
  const guideAction=useRef<((routeId:string,index:number)=>void)|null>(null);
  const consumedGuide=useRef<number|undefined>(undefined);
  const host = useRef<HTMLDivElement>(null),
    action = useRef<
      | ((
          view:
            "isometric" | "top" | "front" | "left" | "right" | "start" | string,
        ) => void)
      | null
    >(null);
  const navigationCallbacks = useRef({ onNavigationState, onCameraPose, onNavigationMode, onArtworkSelect, proximityDetail, onScriptSceneReady, onScriptPose, onScriptClick, onPresenceSceneReady, onPresencePose });
  navigationCallbacks.current = { onNavigationState, onCameraPose, onNavigationMode, onArtworkSelect, proximityDetail, onScriptSceneReady, onScriptPose, onScriptClick, onPresenceSceneReady, onPresencePose };
  const suspendedRef = useRef(suspendNavigation);
  suspendedRef.current = suspendNavigation;
  const suspendedWasWalking = useRef(false);
  const orbitEnabled = useRef<((enabled: boolean) => void) | null>(null);
  const currentWalkMode = useRef({ walking: false, paused: true });
  const preparedEntry = useRef<boolean | null>(null);
  const committedEntry = useRef<boolean | null>(null);
  const detailEntry = useRef<DetailEntryActions>({
    prepare: () => { preparedEntry.current = currentWalkMode.current.walking && !currentWalkMode.current.paused; },
    commit: (pointer) => {
      committedEntry.current = pointer && preparedEntry.current !== null
        ? preparedEntry.current
        : currentWalkMode.current.walking && !currentWalkMode.current.paused;
      preparedEntry.current = null;
    },
  });
  useEffect(() => {
    onDetailEntryReady?.(detailEntry.current);
    return () => onDetailEntryReady?.(null);
  }, [onDetailEntryReady]);
  const walkingActions = useRef<WalkingActions | null>(null);
  const [walkingMode, setWalkingMode] = useState(false),
    [walkPaused, setWalkPaused] = useState(true),
    [walkLoading, setWalkLoading] = useState(false),
    [walkMessage, setWalkMessage] = useState(
      "정지 관람입니다. 걷기 시작을 선택하세요.",
    );
  const [walkSettings, setWalkSettings] = useState<WalkingSettings>(() => ({
    speed: 1.3,
    eyeHeight: 1.65,
    reducedMotion: reducedMotion ?? matchMedia("(prefers-reduced-motion: reduce)").matches,
  }));
  const walkSettingsRef = useRef(walkSettings);
  useEffect(() => {
    if(reducedMotion === undefined || reducedMotion === walkSettingsRef.current.reducedMotion)return;
    const next={...walkSettingsRef.current,reducedMotion};
    walkSettingsRef.current=next;setWalkSettings(next);walkingActions.current?.settings(next);
  },[reducedMotion]);
  const demand = useRef<
    ((kind: "next" | "full" | "coarse" | "retry" | "cancel") => void) | null
  >(null);
  const [restart, setRestart] = useState(0);
  const [message, setMessage] = useState("공간 미리보기를 준비합니다."),
    [ready, setReady] = useState(false);
  useEffect(()=>{if(openingViewpoint&&ready&&!suspendNavigation&&!walkLoading&&openingConsumed.current!==openingViewpoint.sequence&&walkingActions.current?.teleport){openingConsumed.current=openingViewpoint.sequence;walkingActions.current.teleport(openingViewpoint.viewpointId);}},[openingViewpoint,ready,suspendNavigation,walkLoading]);
  useEffect(()=>{if(guideRequest && ready && !suspendNavigation && !walkLoading && guideAction.current && consumedGuide.current!==guideRequest.sequence){consumedGuide.current=guideRequest.sequence;guideAction.current(guideRequest.routeId,guideRequest.index);}},[guideRequest,ready,suspendNavigation,walkLoading]);
  useEffect(() => {
    if (suspendNavigation) {
      suspendedWasWalking.current = committedEntry.current ?? (currentWalkMode.current.walking && !currentWalkMode.current.paused);
      committedEntry.current = null;
      preparedEntry.current = null;
      walkingActions.current?.pause();
      orbitEnabled.current?.(false);
    } else {
      orbitEnabled.current?.(!currentWalkMode.current.walking);
      // Active walking returns focus to its canvas; focusing the opener would
      // trigger the input blur safety stop immediately after resuming.
      // Paused/stationary modes leave focus restoration to the detail dialog.
      if (suspendedWasWalking.current) walkingActions.current?.start();
      suspendedWasWalking.current = false;
    }
  }, [suspendNavigation]);
  useEffect(() => {
    const abort = new AbortController();
    let gpuLost = false;
    let disposed = false,
      release = () => {};
    let walkingRelease = () => {};
    let nearPlacement: string | undefined;
    walkingActions.current = null;
    setWalkingMode(false);
    setWalkPaused(true);
    setWalkLoading(false);
    setReady(false);
    setMessage("공간 미리보기를 준비합니다.");
    const build = async () => {
      if (
        document.rooms.length > 32 ||
        document.surfaces.length > 256 ||
        document.openings.length > 128 ||
        document.placements.length > 128 ||
        document.lights.length > 128
      )
        throw Error("PREVIEW_COMPLEXITY");
      const values = [
        ...document.rooms.flatMap((room) => [
          ...Object.values(room.dimensions),
          ...room.transform.position,
        ]),
        ...document.surfaces.flatMap((surface) => [
          ...Object.values(surface.dimensions),
          ...surface.transform.position,
        ]),
      ];
      if (
        values.some(
          (value) => !Number.isFinite(value) || Math.abs(value) > 10000,
        )
      )
        throw Error("PREVIEW_COMPLEXITY");
      const rectangles = document.surfaces.map((surface) =>
        panels(surface, document.openings),
      );
      if (rectangles.reduce((total, items) => total + items.length, 0) > 8192)
        throw Error("PREVIEW_COMPLEXITY");
      if(!validateArchitecture(document).valid)throw Error("PREVIEW_COMPLEXITY");
      const three = await import("three");
      const { OrbitControls } =
        await import("three/addons/controls/OrbitControls.js");
      if(document.lights.some(l=>l.type==='area')){const {RectAreaLightUniformsLib}=await import('three/addons/lights/RectAreaLightUniformsLib.js');RectAreaLightUniformsLib.init();}
      if (disposed || !host.current) return;
      const renderer = new three.WebGLRenderer({
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
      });
      renderer.setPixelRatio(
        Math.min(devicePixelRatio, viewerBudget?.maxPixelRatio ?? 2),
      );
      renderer.outputColorSpace = three.SRGBColorSpace;
      const scene = new three.Scene();
      scene.background = new three.Color("#e9e9e1");
      const model = new three.Group(),
        owned: Array<{ dispose: () => void }> = [];
      scene.add(model);
      scene.add(
        new three.HemisphereLight(
          0xffffff,
          0x71806a,
          document.lights.length ? 0.4 : 2.5,
        ),
      );
      const sun = new three.DirectionalLight(
        0xffffff,
        document.lights.length ? 0 : 3,
      );
      const daylight=daylightFor(document);
      if(daylight){const direction=daylightDirection(daylight);sun.position.fromArray(direction.map(n=>n*100) as [number,number,number]);sun.intensity=daylight.enabled&&direction[1]>0?daylight.intensity:0;}else sun.position.set(20, 30, 25);
      renderer.domElement.dataset.daylight=JSON.stringify(daylight?{...daylight,direction:daylightDirection(daylight),effectiveIntensity:sun.intensity}:null);
      scene.add(sun);
      const rooms = new Map<string, InstanceType<typeof three.Group>>(),
        surfaces = new Map<string, InstanceType<typeof three.Group>>();
      const pose = (
        target: InstanceType<typeof three.Object3D>,
        transform: Document["rooms"][number]["transform"],
      ) => {
        target.position.fromArray(transform.position);
        target.quaternion.fromArray(transform.rotation);
        target.scale.fromArray(transform.scale);
      };
      for (const room of document.rooms) {
        const group = new three.Group();
        pose(group, room.transform);
        rooms.set(room.id.toLowerCase(), group);
        model.add(group);
        const box = new three.BoxGeometry(
            room.dimensions.width,
            room.dimensions.height,
            room.dimensions.depth,
          ),
          edges = new three.EdgesGeometry(box);
        const material = new three.LineBasicMaterial({
          color:
            selection?.kind === "room" && selection.id === room.id
              ? "#765723"
              : "#829180",
        });
        const outline = new three.LineSegments(edges, material);
        outline.position.y = room.dimensions.height / 2;
        group.add(outline);
        owned.push(box, edges, material);
      }
      document.surfaces.forEach((surface, index) => {
        const group = new three.Group();
        pose(group, surface.transform);
        surfaces.set(surface.id.toLowerCase(), group);
        rooms.get(surface.roomId.toLowerCase())?.add(group);
        const looks = appearance(surface.id),
          material = new three.MeshStandardMaterial({
            color: new three.Color().setRGB(
              ...looks.baseColor,
              three.SRGBColorSpace,
            ),
            roughness: looks.roughness,
            metalness: looks.metalness,
            side: three.DoubleSide,
          });
        owned.push(material);
        for (const rectangle of rectangles[index]!) {
          const geometry = new three.PlaneGeometry(
              rectangle.width,
              rectangle.height,
            ),
            mesh = new three.Mesh(geometry, material);
          mesh.position.set(rectangle.x, rectangle.y, 0);
          group.add(mesh);
          owned.push(geometry);
        }
        if (selection?.kind === "surface" && selection.id === surface.id) {
          const shape = new three.PlaneGeometry(
              surface.dimensions.width,
              surface.dimensions.height,
            ),
            edges = new three.EdgesGeometry(shape),
            line = new three.LineBasicMaterial({ color: "#765723" });
          group.add(new three.LineSegments(edges, line));
          owned.push(shape, edges, line);
        }
      });
      for (const opening of document.openings) {
        const geometry = new three.PlaneGeometry(
            opening.dimensions.width,
            opening.dimensions.height,
          ),
          edges = new three.EdgesGeometry(geometry);
        const material = new three.LineBasicMaterial({
            color:
              selection?.kind === "opening" && selection.id === opening.id
                ? "#d45222"
                : "#203d2c",
          }),
          line = new three.LineSegments(edges, material);
        line.position.set(opening.offset[0], opening.offset[1], 0.002);
        surfaces.get(opening.surfaceId.toLowerCase())?.add(line);
        owned.push(geometry, edges, material);
      }
      const placements = new Map<string, InstanceType<typeof three.Group>>();
      for (const placement of document.placements) {
        const artwork = document.artworks.find(
          (a) =>
            a.revisionId.toLowerCase() ===
            placement.artworkRevisionId.toLowerCase(),
        );
        if (!artwork) continue;
        const group = new three.Group();
        group.userData.placementId = placement.id;
        pose(group, placement.transform);
        rooms.get(placement.roomId.toLowerCase())?.add(group);
        placements.set(placement.id.toLowerCase(), group);
        const geometry = new three.BoxGeometry(
          artwork.dimensions.width,
          artwork.dimensions.height,
          artwork.dimensions.depth ?? 0.01,
        );
        const edges = new three.EdgesGeometry(geometry),
          material = new three.LineDashedMaterial({
            color: 0x9a623b,
            dashSize: 0.08,
            gapSize: 0.05,
          });
        const bounds = new three.LineSegments(edges, material);
        bounds.computeLineDistances();
        group.add(bounds);
        owned.push(geometry, edges, material);
      }
      const scriptLights=new Map<string,{light:InstanceType<typeof three.Light>;original:number}>();
      for (const item of document.lights) {
        const color = new three.Color().setRGB(
          ...item.color,
          three.LinearSRGBColorSpace,
        );
        const light =
          item.type === "spot"
            ? new three.SpotLight(
                color,
                item.intensity,
                0,
                (item.beamAngle ?? 0.6) / 2,
              )
            : item.type === "directional"
              ? new three.DirectionalLight(color, item.intensity)
              : item.type==='area'?new three.RectAreaLight(color,1,item.dimensions!.width,item.dimensions!.height): new three.PointLight(color, item.intensity);
        if(light instanceof three.RectAreaLight)light.power=item.intensity;
        scriptLights.set(item.id,{light,original:light.intensity});
        pose(light, item.transform);
        rooms.get(item.roomId.toLowerCase())?.add(light);
        if (
          light instanceof three.SpotLight ||
          light instanceof three.DirectionalLight
        ) {
          const target = item.targetPlacementId
            ? placements.get(item.targetPlacementId.toLowerCase())
            : undefined;
          if (target) light.target = target;
          else {
            const aimed = new three.Object3D();
            aimed.position
              .copy(light.position)
              .add(
                new three.Vector3(0, 0, -1).applyQuaternion(light.quaternion),
              );
            rooms.get(item.roomId.toLowerCase())?.add(aimed);
            light.target = aimed;
          }
        }
      }
      model.updateMatrixWorld(true);
      const bounds = new three.Box3().setFromObject(model),
        center = bounds.getCenter(new three.Vector3()),
        size = bounds.getSize(new three.Vector3());
      const extent = Math.max(size.x, size.y, size.z, 1),
        camera = new three.PerspectiveCamera(
          45,
          1,
          extent / 1000,
          extent * 100,
        );
      const controls = new OrbitControls(camera, renderer.domElement);
      let pointerStart: [number,number] | undefined;
      const down = (event: PointerEvent) => { pointerStart=[event.clientX,event.clientY]; };
      renderer.domElement.addEventListener("pointerdown",down);
      const pick = (event: MouseEvent) => {
        if(!pointerStart || Math.hypot(event.clientX-pointerStart[0],event.clientY-pointerStart[1])>5)return;
        if (suspendedRef.current || (!navigationCallbacks.current.onArtworkSelect&&!navigationCallbacks.current.onScriptClick)) return;
        const box = renderer.domElement.getBoundingClientRect(), ray = new three.Raycaster();
        ray.setFromCamera(globalThis.document.pointerLockElement===renderer.domElement?new three.Vector2(0,0):new three.Vector2((event.clientX-box.left)/box.width*2-1,-(event.clientY-box.top)/box.height*2+1), camera);
        const hit=ray.intersectObject(model,true)[0];
        let object=hit?.object;
        while(object) { if(typeof object.userData.placementId === "string") { navigationCallbacks.current.onScriptClick?.(object.userData.placementId); if(navigationCallbacks.current.onArtworkSelect){detailEntry.current.prepare(); detailEntry.current.commit(true); navigationCallbacks.current.onArtworkSelect(object.userData.placementId);} return; } object=object.parent ?? undefined; }
      };
      renderer.domElement.addEventListener("click",pick);
      controls.enableDamping = false;
      controls.enablePan = true;
      controls.minDistance = extent / 20;
      controls.maxDistance = extent * 10;
      const trace: {
        started: number;
        samples: Array<{ at: number; ms: number; triangles: number }>;
        frame: number;
      } = { started: 0, samples: [], frame: 0 };
      const render = () => {
        if (!disposed && !gpuLost) {
          const at = performance.now();
          renderer.render(scene, camera);
          navigationCallbacks.current.onPresencePose?.(camera.position.toArray() as [number,number,number],new three.Euler().setFromQuaternion(camera.quaternion,"YXZ").y);
          navigationCallbacks.current.onScriptPose?.(camera.position.toArray() as [number,number,number],camera.getWorldDirection(new three.Vector3()).toArray() as [number,number,number]);
          navigationCallbacks.current.onCameraPose?.(camera.position.toArray() as [number,number,number],new three.Euler().setFromQuaternion(camera.quaternion,"YXZ").y);
          if (trace.started)
            trace.samples.push({
              at,
              ms: performance.now() - at,
              triangles: renderer.info.render.triangles,
            });
        }
      };
      const remoteAvatars=new Map<string,InstanceType<typeof three.Group>>();
      let avatarResources:{body:InstanceType<typeof three.CapsuleGeometry>;head:InstanceType<typeof three.SphereGeometry>;nose:InstanceType<typeof three.BoxGeometry>;material:InstanceType<typeof three.MeshBasicMaterial>}|undefined;
      const avatarAssets=()=>{if(!avatarResources){avatarResources={body:new three.CapsuleGeometry(.14,.8,4,8),head:new three.SphereGeometry(.16,8,6),nose:new three.BoxGeometry(.07,.05,.08),material:new three.MeshBasicMaterial({color:0x987aee})};owned.push(avatarResources.body,avatarResources.head,avatarResources.nose,avatarResources.material);}return avatarResources;};
      const presenceDiagnostics=()=>{renderer.domElement.dataset.realtimeAvatars=JSON.stringify([...remoteAvatars].map(([visitorId,group])=>({visitorId,position:group.position.toArray(),yaw:group.rotation.y})));};
      const presenceScene:RealtimeScene={update:visitors=>{if(disposed||gpuLost)return;const ids=new Set(visitors.map(v=>v.visitorId));for(const [id,group]of remoteAvatars)if(!ids.has(id)){scene.remove(group);remoteAvatars.delete(id);}for(const visitor of visitors){let group=remoteAvatars.get(visitor.visitorId);if(!group){group=new three.Group();group.userData.remoteVisitorId=visitor.visitorId;const assets=avatarAssets(),body=new three.Mesh(assets.body,assets.material),head=new three.Mesh(assets.head,assets.material),nose=new three.Mesh(assets.nose,assets.material);body.position.y=-.7;head.position.y=-.12;nose.position.set(0,-.12,-.18);group.add(body,head,nose);remoteAvatars.set(visitor.visitorId,group);scene.add(group);}group.position.fromArray(visitor.position);group.rotation.y=visitor.yaw;}presenceDiagnostics();render();},clear:()=>{for(const group of remoteAvatars.values())scene.remove(group);remoteAvatars.clear();presenceDiagnostics();render();}};
      presenceDiagnostics();navigationCallbacks.current.onPresenceSceneReady?.(presenceScene);
      const scriptDiagnostics=()=>{renderer.domElement.dataset.scriptScene=JSON.stringify({lights:Object.fromEntries([...scriptLights].map(([id,{light}])=>[id,light.intensity])),visibility:Object.fromEntries([...placements].map(([id,g])=>[id,g.visible]))});};
      const scriptScene:ScriptScene={setLight:(id,multiplier)=>{const entry=scriptLights.get(id);if(entry&&Number.isFinite(multiplier)){entry.light.intensity=entry.original*Math.max(0,Math.min(1,multiplier));scriptDiagnostics();render();}},setArtworkVisible:(id,visible)=>{const group=placements.get(id.toLowerCase());if(group){group.visible=visible;scriptDiagnostics();render();}},reset:()=>{for(const {light,original}of scriptLights.values())light.intensity=original;for(const group of placements.values())group.visible=true;scriptDiagnostics();render();}};
      scriptDiagnostics();navigationCallbacks.current.onScriptSceneReady?.(scriptScene);
      const benchmark = () => {
        if (!viewerBudget || trace.started) return;
        trace.started = performance.now();
        trace.samples = [];
        const tick = () => {
          if (disposed) return;
          const elapsed = performance.now() - trace.started;
          camera.position
            .copy(center)
            .add(
              new three.Vector3(
                Math.cos(elapsed / 8000) * extent * 1.4,
                extent * 0.7,
                Math.sin(elapsed / 8000) * extent * 1.4,
              ),
            );
          camera.lookAt(center);
          render();
          (
            renderer.domElement as HTMLCanvasElement & { viewerTrace?: unknown }
          ).viewerTrace = {
            elapsed,
            samples: trace.samples,
            geometry: renderer.info.memory.geometries,
            textures: renderer.info.memory.textures,
          };
          if (elapsed < 60000) trace.frame = requestAnimationFrame(tick);
        };
        trace.frame = requestAnimationFrame(tick);
      };
      renderer.domElement.addEventListener("exhibitos-benchmark", benchmark);
      const view = (
        kind:
          "isometric" | "top" | "front" | "left" | "right" | "start" | string,
      ) => {
        camera.up.set(0, 1, 0);
        controls.target.copy(center);
        const savedCamera =
          kind === "start"
            ? presentationFor(document).startCamera
            : presentationFor(document).viewpoints.find((v) => v.id === kind);
        if (savedCamera) {
          const room = rooms.get(savedCamera.roomId.toLowerCase());
          camera.position.copy(
            room
              ? room.localToWorld(new three.Vector3(...savedCamera.position))
              : new three.Vector3(...savedCamera.position),
          );
          controls.target.copy(
            room
              ? room.localToWorld(new three.Vector3(...savedCamera.target))
              : new three.Vector3(...savedCamera.target),
          );
          camera.fov = savedCamera.fov;
          camera.updateProjectionMatrix();
        } else if (kind === "front" && selection) {
          const surfaceId =
            selection.kind === "surface"
              ? selection.id
              : selection.kind === "opening"
                ? document.openings.find((item) => item.id === selection.id)
                    ?.surfaceId
                : undefined;
          const selected = surfaceId
            ? surfaces.get(surfaceId.toLowerCase())
            : undefined;
          if (selected) {
            const point = selected.getWorldPosition(new three.Vector3()),
              rotation = selected.getWorldQuaternion(new three.Quaternion());
            const normal = new three.Vector3(0, 0, 1).applyQuaternion(rotation);
            const surface = document.surfaces.find(
              (item) => item.id.toLowerCase() === surfaceId?.toLowerCase(),
            );
            const room = document.rooms.find(
              (item) => item.id.toLowerCase() === surface?.roomId.toLowerCase(),
            );
            const owner = room ? rooms.get(room.id.toLowerCase()) : undefined;
            if (room && owner) {
              const roomCenter = owner.localToWorld(
                new three.Vector3(0, room.dimensions.height / 2, 0),
              );
              if (normal.dot(point.clone().sub(roomCenter)) < 0)
                normal.negate();
            }
            camera.position
              .copy(point)
              .add(normal.multiplyScalar(extent * 1.6));
            camera.up.copy(
              new three.Vector3(0, 1, 0).applyQuaternion(rotation),
            );
            controls.target.copy(point);
          } else
            camera.position
              .copy(center)
              .add(new three.Vector3(0, extent * 0.4, extent * 1.8));
        } else if (kind === "top") {
          camera.position.copy(center).add(new three.Vector3(0, extent * 2, 0));
          camera.up.set(0, 0, -1);
        } else if (kind === "left" || kind === "right") {
          const delta = camera.position.clone().sub(controls.target);
          delta.applyAxisAngle(
            new three.Vector3(0, 1, 0),
            kind === "left" ? -Math.PI / 6 : Math.PI / 6,
          );
          camera.position.copy(controls.target).add(delta);
        } else
          camera.position
            .copy(center)
            .add(new three.Vector3(extent * 1.2, extent * 0.9, extent * 1.4));
        camera.lookAt(controls.target);
        controls.update();
        render();
      };
      const resize = () => {
        if (!host.current) return;
        const width = Math.max(host.current.clientWidth, 1),
          height = 360;
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        render();
      };
      renderer.domElement.setAttribute("aria-label", "전시 공간 3D 미리보기");
      renderer.domElement.setAttribute("role", "img");
      const lost = (event: Event) => {
        event.preventDefault();
        gpuLost = true;
        cancelAnimationFrame(trace.frame);
        walkingActions.current?.pause();
        demand.current?.("cancel");
        setReady(false);
        setMessage(
          viewerBudget
            ? "3D 그래픽 연결이 중단되었습니다. 작품 목록을 계속 사용할 수 있습니다. 3D 다시 시작으로 재시도할 수 있습니다."
            : "3D 그래픽 연결이 중단되었습니다. 작품 metadata와 저장본은 유지됩니다. JSON과 숫자 편집을 사용할 수 있습니다.",
        );
      };
      renderer.domElement.addEventListener("webglcontextlost", lost);
      host.current.replaceChildren(renderer.domElement);
      const observer = new ResizeObserver(resize);
      observer.observe(host.current);
      controls.addEventListener("change", render);
      guideAction.current=(routeId,index)=>{
        if(suspendedRef.current)return;
        const waypoint=document.navigation.find(r=>r.id===routeId)?.waypoints[index];
        if(!waypoint)return;
        const room=rooms.get(waypoint.roomId.toLowerCase());if(!room)return;
        walkingActions.current?.stationary();
        const pos=room.localToWorld(new three.Vector3(...waypoint.position));
        const curation=document.extensions?.['org.exhibitos.viewer/curation'] as unknown as {routes?:{routeId:string;stops:{placementId?:string}[]}[]}|undefined;
        const id=curation?.routes?.find(r=>r.routeId===routeId)?.stops[index]?.placementId;
        const placement=document.placements.find(p=>p.id===id);
        const owner=placement?rooms.get(placement.roomId.toLowerCase()):undefined;
        const target=placement&&owner?owner.localToWorld(new three.Vector3(...placement.transform.position)):room.localToWorld(new three.Vector3(...waypoint.position).add(new three.Vector3(0,0,-1)));
        if(pos.distanceToSquared(target)<.000001)target.copy(pos).add(new three.Vector3(0,0,-1));
        camera.up.set(0,1,0);camera.position.copy(pos);controls.target.copy(target);camera.lookAt(target);controls.update();render();
        setWalkMessage('선택한 안내 정류점의 정지 시점입니다. 보행이나 소리를 자동으로 시작하지 않습니다. 글 안내도 계속 읽을 수 있습니다.');
      };
      action.current = view;
      resize();
      view(
        viewerBudget && presentationFor(document).startCamera
          ? "start"
          : "isometric",
      );
      setMessage(
        `공간 ${document.rooms.length} · 표면 ${document.surfaces.length} · 실제 개구부 ${document.openings.length}. 작품 bounds는 실제 치수입니다. 작품 derivative 미사용: metadata만 표시합니다.`,
      );
      setReady(true);
      release = () => {
        walkingRelease();
        orbitEnabled.current = null;
        renderer.domElement.removeEventListener("click",pick);
        renderer.domElement.removeEventListener("pointerdown",down);
        walkingActions.current = null;
        action.current = null;
        guideAction.current=null;
        demand.current = null;
        cancelAnimationFrame(trace.frame);
        renderer.domElement.removeEventListener(
          "exhibitos-benchmark",
          benchmark,
        );
        observer.disconnect();
        controls.dispose();
        renderer.domElement.removeEventListener("webglcontextlost", lost);
        for (const resource of owned) resource.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      };
      orbitEnabled.current = (enabled) => { controls.enabled = enabled; };
      if (suspendedRef.current) controls.enabled = false;
      if (viewerBudget) {
        renderer.domElement.tabIndex = 0;
        renderer.domElement.setAttribute(
          "aria-describedby",
          "walking-instructions",
        );
        let initialization: Promise<void> | undefined;
        const initialize = async (teleportViewpointId?: string) => {
          if (disposed) return;
          if (!initialization) {
            setWalkLoading(true);
            setWalkMessage(
              "걷기와 안전한 충돌을 준비합니다. 작품 목록은 계속 사용할 수 있습니다.",
            );
            let initialCamera: InstanceType<typeof three.PerspectiveCamera> | undefined;
            if(teleportViewpointId) {
              try {
                const destination=viewpointPose(document,teleportViewpointId);
                initialCamera=camera.clone();
                initialCamera.position.fromArray(destination.position);
                initialCamera.lookAt(new three.Vector3(...destination.target));
              } catch {
                setWalkLoading(false);setWalkMessage("이 viewpoint의 참조나 시점 방향을 지원하지 않습니다. 기존 위치와 정지 관람을 유지합니다.");return;
              }
            } else view("start");
            controls.enabled = false;
            initialization = (async () => {
              const { createWalkingCamera } =
                await import("./viewer/navigation-camera");
              if (disposed) return;
              const adapter = await createWalkingCamera({
                document,
                camera,
                initialCamera,
                controls,
                canvas: renderer.domElement,
                settings: { ...walkSettingsRef.current },
                render,
                onState: (state) => {
                  navigationCallbacks.current.onNavigationState?.(state);
                  const cb = navigationCallbacks.current;
                  if (cb.proximityDetail && cb.onArtworkSelect && !suspendedRef.current && !state.paused) {
                    const placement = document.placements.find(p => {
                      const room = document.rooms.find(r => r.id === p.roomId);
                      if (!room || room.id !== state.roomId) return false;
                      const [x,y,z,w] = room.transform.rotation, [a,b,c] = p.transform.position;
                      const tx=2*(y*c-z*b), ty=2*(z*a-x*c), tz=2*(x*b-y*a);
                      const position=[a+w*tx+y*tz-z*ty+room.transform.position[0],b+w*ty+z*tx-x*tz+room.transform.position[1],c+w*tz+x*ty-y*tx+room.transform.position[2]];
                      return Math.hypot(position[0]!-state.eyePosition[0],position[2]!-state.eyePosition[2]) < 1;
                    });
                    if (placement && nearPlacement !== placement.id) { nearPlacement = placement.id; detailEntry.current.prepare(); detailEntry.current.commit(true); cb.onArtworkSelect(placement.id); }
                    else if (!placement) nearPlacement = undefined;
                  }
                },
                onMode: (walking, paused) => {
                  currentWalkMode.current = { walking, paused };
                  navigationCallbacks.current.onNavigationMode?.(walking, paused);
                  if (!disposed) {
                    setWalkingMode(walking);
                    setWalkPaused(paused);
                  }
                },
                onMessage: (message) => {
                  if (!disposed) setWalkMessage(message);
                },
              });
              if (disposed) {
                adapter.dispose();
                return;
              }
              // Media/user preferences can change while the physics module loads.
              adapter.actions.settings({ ...walkSettingsRef.current });
              walkingRelease = adapter.dispose;
              walkingActions.current = adapter.actions;
            })()
              .catch(() => {
                if (!disposed) {
                  controls.enabled = true;
                  setWalkMessage(
                    "이 전시의 시작 위치나 바닥에서 안전한 걷기를 준비할 수 없습니다. 정지 관람과 작품 목록을 사용할 수 있습니다.",
                  );
                }
                initialization = undefined;
              })
              .finally(() => {
                if (!disposed) setWalkLoading(false);
              });
          }
          await initialization;
        };
        const pending: WalkingActions = {
          start: () => {
            void initialize().then(() => {
              if (!disposed && !suspendedRef.current && walkingActions.current !== pending)
                walkingActions.current?.start();
            });
          },
          capture: () => {
            void initialize().then(() => {
              if (!disposed && !suspendedRef.current && walkingActions.current !== pending)
                walkingActions.current?.capture();
            });
          },
          teleport: (viewpointId) => {
            void initialize(viewpointId).then(() => {
              if (!disposed && !suspendedRef.current && walkingActions.current !== pending)
                walkingActions.current?.teleport?.(viewpointId);
            });
          },
          pause: () => {},
          stationary: () => {},
          reset: () => {},
          settings: () => {},
          press: () => {},
          release: () => {},
        };
        walkingActions.current = pending;
      }
      let rendered = 0,
        unavailable = 0;
      const sources = new Map<
        string,
        Promise<InstanceType<typeof three.Object3D>>
      >();
      const byteCache = new MemoryAssetCache<ArrayBuffer>(
        viewerBudget?.maxCacheBytes ?? 33554432,
      );
      let cacheHits = 0;
      const decodedResources = new Map<
        InstanceType<typeof three.Object3D>,
        Array<{ dispose: () => void }>
      >();
      const loadArtwork = async (
        artwork: Document["artworks"][number],
        inventory = artwork.assets.find(
          (a) => a.id === artwork.primaryAssetId,
        )!,
        taskSignal = abort.signal,
      ) => {
        const signal = AbortSignal.any([abort.signal, taskSignal]);
        let bytes: ArrayBuffer;
        let response: Response;
        if (publicSource) {
          const source = publicSource.assets.find(
            (a) => a.assetId === inventory.id,
          );
          if (!source) throw Error("PUBLIC_DERIVATIVE_UNAVAILABLE");
          const cached = byteCache.get(inventory.id);
          if (cached) {
            // Reuse is scoped to this renderer/publication and still checks authoritative availability.
            if (publicSource.check) await publicSource.check();
            else {
            const current = await fetch(
              `/api/v1/publications/${publicSource.publicationId}`,
              { credentials: "omit", cache: "no-store", signal },
            );
            if (
              !current.ok ||
              (await current.json()).publication.revisionSha256 !==
                publicSource.revisionSha256
            )
              throw Error("PUBLIC_DERIVATIVE_UNAVAILABLE");
            }
            bytes = cached;
            cacheHits++;
          } else {
            bytes = await fetchVerifiedAsset({
              ...publicSource,
              asset: source,
              inventory,
              signal,
            });
            byteCache.set(inventory.id, bytes, bytes.byteLength);
          }
        } else {
          const binding = artwork.extensions?.["org.exhibitos.studio/cms"];
          if (
            !session ||
            !binding ||
            binding.tenantId !== session.tenantId ||
            typeof binding.artworkId !== "string"
          )
            throw Error("DERIVATIVE_UNAVAILABLE");
          const base = `/api/v1/tenants/${session.tenantId}`;
          const meta = await fetch(
            `${base}/studio/artworks/${encodeURIComponent(binding.artworkId)}`,
            {
              credentials: "same-origin",
              cache: "no-store",
              signal: abort.signal,
            },
          );
          if (!meta.ok) throw Error("DERIVATIVE_UNAUTHORIZED");
          const bridge = (await meta.json()) as {
            artwork: Document["artworks"][number];
            previewUrl: string;
          };
          if (
            bridge.artwork.revisionId !== artwork.revisionId ||
            bridge.previewUrl !==
              `${base}/cms/artworks/${binding.artworkId}/preview`
          )
            throw Error("DERIVATIVE_REVISION_CHANGED");
          response = await fetch(
            `${bridge.previewUrl}?expectedRevision=${artwork.revision}`,
            {
              credentials: "same-origin",
              cache: "no-store",
              signal: abort.signal,
            },
          );
          if (
            !response.ok ||
            response.headers.get("x-exhibitos-artwork-revision") !==
              String(artwork.revision)
          )
            throw Error("DERIVATIVE_UNAVAILABLE");
        }
        if (!publicSource) bytes = await response!.arrayBuffer();
        if (bytes!.byteLength > 33554432 || disposed || signal.aborted)
          throw Error("DERIVATIVE_UNAVAILABLE");
        const resources: Array<{ dispose: () => void }> = [];
        try {
          let object: InstanceType<typeof three.Object3D>;
          if (artwork.artworkType === "image") {
            let bitmap = await createImageBitmap(
              new Blob([bytes!], { type: "image/png" }),
            );
            resources.push({ dispose: () => bitmap.close() });
            const declared = lodVariantsFor(artwork).find(
              (v) => v.assetId.toLowerCase() === inventory.id.toLowerCase(),
            )?.textureSize;
            if (
              publicSource &&
              declared !== undefined &&
              Math.max(bitmap.width, bitmap.height) > declared
            )
              throw Error("DECODE_VARIANT_UNDERCLAIM");
            if (
              viewerBudget &&
              Math.max(bitmap.width, bitmap.height) >
                viewerBudget.maxTextureSize
            ) {
              const factor =
                viewerBudget.maxTextureSize /
                Math.max(bitmap.width, bitmap.height);
              const resized = await createImageBitmap(bitmap, {
                resizeWidth: Math.max(1, Math.round(bitmap.width * factor)),
                resizeHeight: Math.max(1, Math.round(bitmap.height * factor)),
              });
              bitmap.close();
              bitmap = resized;
            }
            if (disposed || signal.aborted) {
              bitmap.close();
              throw Error("DISPOSED");
            }
            const texture = new three.Texture(bitmap);
            texture.colorSpace = three.SRGBColorSpace;
            texture.needsUpdate = true;
            resources.push(texture);
            const geometry = new three.PlaneGeometry(
              artwork.dimensions.width,
              artwork.dimensions.height,
            );
            const material = new three.MeshStandardMaterial({
              map: texture,
              side: three.DoubleSide,
              roughness: 0.8,
            });
            resources.push(geometry, material);
            object = new three.Mesh(geometry, material);
          } else {
            const { GLTFLoader } =
              await import("three/addons/loaders/GLTFLoader.js");
            const manager = new three.LoadingManager();
            const protectedBytes = embeddedPNGManager(manager, bytes!);
            resources.push(protectedBytes);
            const cancelDecode=()=>protectedBytes.dispose();signal.addEventListener("abort",cancelDecode,{once:true});
            let gltf;try{gltf=await new GLTFLoader(manager).parseAsync(protectedBytes.bytes, "");}finally{signal.removeEventListener("abort",cancelDecode);}
            gltf.scene.traverse((node) => {
              if (node instanceof three.Mesh) {
                resources.push(node.geometry);
                for (const material of Array.isArray(node.material)
                  ? node.material
                  : [node.material]) {
                  resources.push(material);
                  for (const value of Object.values(material))
                    if (value instanceof three.Texture) resources.push(value);
                }
              }
            });
            protectedBytes.assertLoaded();
            if (disposed || signal.aborted) {
              gltf.scene.traverse((node) => {
                if (node instanceof three.Mesh) {
                  node.geometry.dispose();
                  for (const material of Array.isArray(node.material)
                    ? node.material
                    : [node.material]) {
                    for (const value of Object.values(material))
                      if (value instanceof three.Texture) value.dispose();
                    material.dispose();
                  }
                }
              });
              throw Error("DISPOSED");
            }
            object = gltf.scene;
            const bounds = new three.Box3().setFromObject(object),
              center = bounds.getCenter(new three.Vector3()),
              size = bounds.getSize(new three.Vector3());
            if (Math.min(size.x, size.y, size.z) <= 0)
              throw Error("DERIVATIVE_DIMENSIONS");
            // Qualified derivatives are centered and calibrated to the approved physical dimensions.
            const normalized = new three.Group();
            normalized.scale.set(
              artwork.dimensions.width / size.x,
              artwork.dimensions.height / size.y,
              (artwork.dimensions.depth ?? size.z) / size.z,
            );
            object.position.sub(center);
            normalized.add(object);
            object = normalized;
          }
          let triangles = 0,
            decodedBytes = 0;
          const buffers = new Set<ArrayBufferLike>(),
            textures = new Set<InstanceType<typeof three.Texture>>();
          object.traverse((node) => {
            if (node instanceof three.Mesh) {
              triangles +=
                (node.geometry.index?.count ??
                  node.geometry.attributes.position?.count ??
                  0) / 3;
              for (const attribute of Object.values(
                node.geometry.attributes,
              ) as Array<InstanceType<typeof three.BufferAttribute>>) {
                if ("array" in attribute) {
                  const data = attribute.array;
                  if (!buffers.has(data.buffer)) {
                    buffers.add(data.buffer);
                    decodedBytes += data.buffer.byteLength;
                  }
                }
              }
              if (node.geometry.index) {
                const data = node.geometry.index.array;
                if (!buffers.has(data.buffer)) {
                  buffers.add(data.buffer);
                  decodedBytes += data.buffer.byteLength;
                }
              }
              for (const material of Array.isArray(node.material)
                ? node.material
                : [node.material])
                for (const value of Object.values(material))
                  if (value instanceof three.Texture && !textures.has(value)) {
                    textures.add(value);
                    const image = value.image as {
                      width?: number;
                      height?: number;
                    };
                    decodedBytes +=
                      ((image?.width ?? 0) * (image?.height ?? 0) * 4 * 4) / 3;
                  }
            }
          });
          if (
            signal.aborted ||
            disposed ||
            (viewerBudget && triangles > viewerBudget.maxTriangles) ||
            (publicSource &&
              (lodVariantsFor(artwork).find(
                (v) => v.assetId.toLowerCase() === inventory.id.toLowerCase(),
              )?.triangles ?? Infinity) < triangles)
          ) {
            for (const resource of resources) resource.dispose();
            throw Error("DECODE_BUDGET_EXCEEDED");
          }
          object.userData.viewer = {
            triangles,
            decodedBytes,
            textureSizes: [...textures].map((t) => {
              const image = t.image as { width: number; height: number };
              return [image.width, image.height];
            }),
          };
          decodedResources.set(object, resources);
          return object;
        } catch (error) {
          for (const resource of resources) resource.dispose();
          throw error;
        }
      };
      if (viewerBudget && publicSource) {
        const start = presentationFor(document).startCamera;
        const ordered = prioritizePlacements(
          document,
          start?.roomId ?? document.rooms[0]!.id,
          start?.position ?? [0, 0, 0],
        );
        const arts = ordered
          .map((p) =>
            document.artworks.find(
              (a) => a.revisionId === p.artworkRevisionId,
            )!,
          )
          .filter(
            (a, i, all) =>
              a && all.findIndex((b) => b.revisionId === a.revisionId) === i,
          );
        const objects = new Map<string, InstanceType<typeof three.Object3D>>();
        const destroy = (object: InstanceType<typeof three.Object3D>) => {
          for (const resource of decodedResources.get(object) ?? [])
            resource.dispose();
          decodedResources.delete(object);
        };
        const active = new Map<string, string>(),
          requested = new Set<string>(),
          failed = new Set<string>();
        const desired = new Map<string, string>();
        const tasks = new Map<
          string,
          {
            art: Document["artworks"][number];
            inventory: Document["artworks"][number]["assets"][number];
          }
        >();
        const scheduler = new AssetScheduler<
          InstanceType<typeof three.Object3D>
        >({
          concurrency: viewerBudget.concurrency,
          load: (key, signal) => {
            const t = tasks.get(key)!;
            return loadArtwork(t.art, t.inventory, signal);
          },
          onDiscard: destroy,
        });
        const update = () => {
          if (disposed || gpuLost) return;
          const decodedTotal = [...objects.values()].reduce(
            (sum, value) => sum + (value.userData.viewer?.decodedBytes ?? 0),
            0,
          );
          for (const key of tasks.keys()) {
            if (
              decodedTotal + byteCache.stats().bytes <=
              viewerBudget.maxCacheBytes
            )
              break;
            byteCache.delete(key);
          }
          const loaded = ordered.filter((p) =>
            active.has(p.artworkRevisionId),
          ).length;
          renderer.domElement.dataset.viewerState = JSON.stringify({
            loadedPlacements: loaded,
            authoredLights: document.lights.length,
            loadedAssets: active.size,
            entranceLoaded: arts
              .slice(0, viewerBudget.entranceAssets)
              .filter((a) => active.has(a.revisionId)).length,
            total: arts.length,
            deferred: arts.length - requested.size,
            failed: failed.size,
            cacheHits,
            budgetTotalBytes: decodedTotal + byteCache.stats().bytes,
            cache: byteCache.stats(),
            scheduler: scheduler.stats(),
            assetIds: [...active.values()],
            pixelRatio: renderer.getPixelRatio(),
            decodedBytes: [...objects.values()].reduce(
              (sum, value) => sum + (value.userData.viewer?.decodedBytes ?? 0),
              0,
            ),
            decoded: [...objects.values()].map(
              (value) => value.userData.viewer,
            ),
            geometry: renderer.info.memory.geometries,
            textures: renderer.info.memory.textures,
          });
          setMessage(
            `공간 ${document.rooms.length} · 표면 ${document.surfaces.length} · 실제 개구부 ${document.openings.length} · 승인된 작품 derivative ${loaded}개 · bytes 사용 불가 ${failed.size}개 · 입구 ${arts.slice(0, viewerBudget.entranceAssets).filter((a) => active.has(a.revisionId)).length}/${Math.min(arts.length, viewerBudget.entranceAssets)} · 갤러리 대기 ${arts.length - requested.size}개 (점선은 실제 치수 metadata bounds).`,
          );
        };
        const request = (art: (typeof arts)[number], full = false) => {
          requested.add(art.revisionId);
          let inventory: (typeof art.assets)[number];
          try {
            inventory = selectAssetVariant(
              art,
              full ? 0 : Infinity,
              viewerBudget,
            );
          } catch {
            failed.add(art.revisionId);
            update();
            return;
          }
          if (active.get(art.revisionId) === inventory.id) {
            update();
            return;
          }
          desired.set(art.revisionId, inventory.id);
          tasks.set(inventory.id, { art, inventory });
          void scheduler
            .request(inventory.id, arts.indexOf(art))
            .then((object) => {
              if (disposed) {
                destroy(object);
                return;
              }
              if (desired.get(art.revisionId) !== inventory.id) {
                destroy(object);
                return;
              }
              const old = objects.get(art.revisionId);
              const used = [...objects.values()]
                .filter((value) => value !== old)
                .reduce(
                  (sum, value) =>
                    sum + (value.userData.viewer?.decodedBytes ?? 0),
                  0,
                );
              if (
                used +
                  byteCache.stats().bytes +
                  (object.userData.viewer?.decodedBytes ?? 0) >
                viewerBudget.maxCacheBytes
              ) {
                destroy(object);
                failed.add(art.revisionId);
                update();
                return;
              }
              for (const p of ordered.filter(
                (p) => p.artworkRevisionId === art.revisionId,
              )) {
                const group = placements.get(p.id.toLowerCase());
                if (group) {
                  group.clear();
                  group.add(object.clone(true));
                }
              }
              if (old && old !== object) destroy(old);
              objects.set(art.revisionId, object);
              active.set(art.revisionId, inventory.id);
              failed.delete(art.revisionId);
              render();
              update();
            })
            .catch((error) => {
              if (!disposed) {
                if (error?.name !== "AbortError" && !full) {
                  try {
                    const fallback = selectAssetVariant(art, 0, viewerBudget);
                    if (fallback.id !== inventory.id) {
                      request(art, true);
                      return;
                    }
                  } catch {
                    /* No qualified asset fits this device budget. */
                  }
                }
                failed.add(art.revisionId);
                update();
              }
            });
          update();
        };
        demand.current = (kind) => {
          if (kind === "cancel") {
            scheduler.cancelAll();
            update();
            return;
          }
          const selected =
            kind === "next"
              ? arts
                  .filter((a) => !requested.has(a.revisionId))
                  .slice(0, viewerBudget.entranceAssets)
              : kind === "retry"
                ? arts.filter((a) => failed.has(a.revisionId))
                : arts.filter((a) => requested.has(a.revisionId));
          for (const art of selected) request(art, kind === "full");
        };
        const statsTimer = setInterval(update, 100);
        const originalRelease = release;
        release = () => {
          clearInterval(statsTimer);
          scheduler.dispose();
          originalRelease();
          for (const object of objects.values()) destroy(object);
          byteCache.clear();
          renderer.domElement.dataset.disposed = "true";
        };
        for (const art of arts.slice(0, viewerBudget.entranceAssets))
          request(art);
        update();
        return;
      }
      for (const placement of document.placements) {
        const artwork = document.artworks.find(
          (a) =>
            a.revisionId.toLowerCase() ===
            placement.artworkRevisionId.toLowerCase(),
        );
        const group = placements.get(placement.id.toLowerCase());
        if (!artwork || !group) continue;
        try {
          let source = sources.get(artwork.revisionId);
          if (!source) {
            source = loadArtwork(artwork);
            sources.set(artwork.revisionId, source);
          }
          const object = await source;
          if (disposed) {
            for (const r of decodedResources.get(object) ?? []) r.dispose();
            return;
          }
          owned.push(...(decodedResources.get(object) ?? []));
          decodedResources.delete(object);
          const bounds = group.children[0];
          if (bounds) group.remove(bounds);
          group.add(object.clone(true));
          rendered++;
          render();
        } catch {
          unavailable++;
        }
        if (!disposed)
          setMessage(
            `공간 ${document.rooms.length} · 표면 ${document.surfaces.length} · 실제 개구부 ${document.openings.length} · 승인된 작품 derivative ${rendered}개 · bytes 사용 불가 ${unavailable}개 (점선은 실제 치수 metadata bounds).`,
          );
      }
    };
    void build().catch((error) => {
      if (!disposed)
        setMessage(
          error instanceof Error && error.message === "PREVIEW_COMPLEXITY"
            ? "미리보기 한도(방 32개, 표면 256개, 개구부·작품 배치·조명 각각 128개, 사각 패널 8192개, 좌표·치수 10,000m)를 초과했습니다. 문서는 유지됩니다."
            : viewerBudget
              ? "3D를 표시할 수 없습니다. 작품 목록을 계속 사용할 수 있습니다. 3D 다시 시작으로 재시도할 수 있습니다."
              : "3D 미리보기를 표시할 수 없습니다. WebGL 지원을 확인하세요. 숫자 편집과 JSON 백업은 계속 사용할 수 있습니다.",
        );
    });
    return () => {
      navigationCallbacks.current.onPresenceSceneReady?.(null);
      navigationCallbacks.current.onScriptSceneReady?.(null);
      disposed = true;
      abort.abort();
      release();
    };
  }, [
    document,
    selection,
    appearance,
    session,
    publicSource,
    viewerBudget,
    restart,
  ]);
  return (
    <figure data-reduced-motion={walkSettings.reducedMotion} className="geometry-preview" aria-hidden={suspendNavigation || undefined} inert={suspendNavigation || undefined}>
      <div className="geometry-stage">
        <div ref={host} />
        {viewerBudget && walkingMode && (
          <WalkingTouch
            available={ready && !suspendNavigation}
            paused={walkPaused}
            actions={walkingActions.current}
          />
        )}
      </div>
      <figcaption data-testid="geometry-render-state">{message}</figcaption>
      <div className="cms-actions">
        <button
          disabled={
            !ready || walkingMode || !presentationFor(document).startCamera
          }
          onClick={() => action.current?.("start")}
        >
          시작 camera 보기
        </button>
        {presentationFor(document).viewpoints.map((v) => (
          <button
            key={v.id}
            disabled={!ready || walkingMode}
            onClick={() => action.current?.(v.id)}
          >
            viewpoint 보기 {v.name}
          </button>
        ))}
        <button
          disabled={!ready || walkingMode}
          onClick={() => action.current?.("isometric")}
        >
          전체 공간 보기
        </button>
        <button
          disabled={!ready || walkingMode}
          onClick={() => action.current?.("front")}
        >
          선택 표면 정면
        </button>
        <button
          disabled={!ready || walkingMode}
          onClick={() => action.current?.("top")}
        >
          위에서 보기
        </button>
        <button
          disabled={!ready || walkingMode}
          onClick={() => action.current?.("left")}
        >
          시점 왼쪽 회전
        </button>
        <button
          disabled={!ready || walkingMode}
          onClick={() => action.current?.("right")}
        >
          시점 오른쪽 회전
        </button>
      </div>
      {viewerBudget && (
        <WalkingControls
          available={ready && !walkLoading && !suspendNavigation}
          walking={walkingMode}
          paused={walkPaused}
          settings={walkSettings}
          onSettings={(value) => {
            if(value.reducedMotion!==walkSettingsRef.current.reducedMotion)onReducedMotionChange?.(value.reducedMotion);
            walkSettingsRef.current = value;
            setWalkSettings(value);
            walkingActions.current?.settings(value);
          }}
          actions={walkingActions.current}
          message={walkMessage}
        />
      )}
      {viewerBudget && presentationFor(document).viewpoints.length>0 && (
        <section aria-label="검증된 viewpoint 순간 이동">
          <p>직접 선택한 위치의 바닥·몸 여유 공간을 검사하고 움직임 없이 이동합니다. 안전하지 않은 위치는 거부하며 정지 상태를 유지합니다.</p>
          {presentationFor(document).viewpoints.map(viewpoint=><button key={viewpoint.id} disabled={!ready||walkLoading||suspendNavigation} onClick={()=>walkingActions.current?.teleport?.(viewpoint.id)}>안전한 viewpoint로 이동 {viewpoint.name}</button>)}
        </section>
      )}
      {viewerBudget && (
        <div className="cms-actions">
          <button disabled={!ready} onClick={() => demand.current?.("next")}>
            다음 작품 불러오기
          </button>
          <button disabled={!ready} onClick={() => demand.current?.("coarse")}>
            불러온 작품 입구 품질
          </button>
          <button disabled={!ready} onClick={() => demand.current?.("full")}>
            불러온 작품 상세 품질
          </button>
          <button disabled={!ready} onClick={() => demand.current?.("retry")}>
            실패한 작품 다시 시도
          </button>
          <button disabled={!ready} onClick={() => demand.current?.("cancel")}>
            작품 불러오기 취소
          </button>
          <button onClick={() => setRestart((n) => n + 1)}>3D 다시 시작</button>
        </div>
      )}
      <p className="cms-note">
        {publicSource
          ? "사각형 표면과 실제 사각 개구부의 전시 보기입니다. 걷기는 벽·작품 충돌과 제한된 단차·경사를 지원합니다. 안전한 시작 위치나 지원되는 바닥이 없으면 정지 관람을 이용하세요."
          : "사각형 표면과 실제 사각 개구부의 편집 미리보기입니다. 분할 곡선벽·계단·경사로를 동일한 평면으로 렌더링합니다. 실제 보행 가능성은 공개 Viewer에서 검사하세요."}
        저장된 조명은 시각적 근사이며 물리적 조도 측정을 지원하지
        않습니다. 마우스 없이 위 버튼으로 시점을 바꿀 수 있습니다.
      </p>
    </figure>
  );
}
