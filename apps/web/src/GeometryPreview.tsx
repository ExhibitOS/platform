import {installBoundedShadows,SHADOW_RESERVE_BYTES} from './viewer/shadows';
import {createPortal} from 'react-dom';
import {visitingFov,visitingBuffer} from './viewer/framing';
import {installPanelResume} from './viewer/panel-resume';
import {DEFAULT_REFERENCE_TONE,applyReferenceOutput,installReferenceEnvironment,environmentEstimate,type ReferenceTone} from './viewer/render-quality';
import type {EditorBridge,EditorSelection} from './geometry/direct-edit';
import {selectionKey} from './geometry/direct-edit';
import {installPreviewEditing} from './geometry/preview-editing';
import {installDecor} from './installation-renderer';
import type {Camera,Object3D,Scene,WebGLRenderer} from 'three';
import {basisLoader} from './basis-loader.js';
import {centerMetricModel,artifactMetricModel} from './viewer/metric-model.js';
import { embeddedPNGManager } from './embedded-glb.js';
import type { PresenceVisitor } from "./viewer/realtime-motion";
import type { ScriptScene } from "./viewer/scripting";
import type { GuideRequest } from "./GuidedRoutes";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AssetScheduler,
  MemoryAssetCache,
  fetchVerifiedAsset,
  checkImageDecode,
  prioritizePlacements,
  selectAssetVariant, detailScreenBounds, detailDemand, DetailTransition, ArtworkAttention, nearbyPreparation, displayedDetailReclamation, settleAssetGeneration, authoredImagePair, imageFullDecodeCeiling, AssetPeakBudget, assetDecodeReserve,
  type DeviceBudget,
} from "./viewer/loading";
import { validateArchitecture, daylightFor, daylightDirection, presentationFor, lodVariantsFor, artifactCorners } from "@exhibitos/studio-contract";
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
export interface GeometryXrArtwork {revisionId:string;assetId:string;label:string;object:Object3D}
export interface GeometryXrBridge {renderer:WebGLRenderer;camera:Camera;scene:Scene;artworks:()=>GeometryXrArtwork[];frame:(callback:((time:number,frame?:XRFrame)=>void)|null)=>void;suspend:(active:boolean)=>void}
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
export type GeometrySelection=EditorSelection;

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
  editing,
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
  focusedPlacementId,
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
  onXrReady,
  onXrArtworks,
  onRenderState,
  cameraRequest,
  spaceTransparency,
  referenceTone = DEFAULT_REFERENCE_TONE,
  immersive = false,
  controlsHost,
  viewFov,
}: {
  immersive?: boolean;
  controlsHost?: HTMLElement|null;
  viewFov?: number;
  cameraRequest?: {kind:"isometric"|"top"|"front"|"left"|"right";sequence:number};
  spaceTransparency?: boolean;
  onRenderState?: (state:{ready:boolean;message:string;loaded:number;failed:number;navigationReady:boolean;navigationFailed:boolean})=>void;
  referenceTone?: ReferenceTone;
  onXrReady?: (bridge:GeometryXrBridge|null)=>void;
  onXrArtworks?: (artworks:GeometryXrArtwork[])=>void;
  document: Document;
  editing?:EditorBridge;
  viewerBudget?: DeviceBudget;
  suspendNavigation?: boolean;
  onNavigationState?: (state: NavigationState) => void;
  onCameraPose?: (position: [number,number,number],yaw: number) => void;
  onNavigationMode?: (walking: boolean, paused: boolean) => void;
  onArtworkSelect?: (id: string) => void;
  proximityDetail?: boolean;
  focusedPlacementId?: string | null;
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
  const editingEnabled=!!editing;
  const [inputMode,setInputMode]=useState<"auto"|"pointer"|"touch">("auto");
  const viewFovRef=useRef(viewFov);viewFovRef.current=viewFov;
  const resizeAction=useRef<(()=>void)|null>(null);
  useEffect(()=>{resizeAction.current?.();},[viewFov]);
  const [localTransparentSpace,setTransparentSpace]=useState(false);
  const transparentSpace=spaceTransparency??localTransparentSpace;
  const consumedCameraRequest=useRef<number|undefined>(undefined);
  const [installationIssueCount,setInstallationIssueCount]=useState(0);
  const editorCamera=useRef<{documentId:string;position:[number,number,number];quaternion:[number,number,number,number];target:[number,number,number]}|null>(null);
  const selectionRef=useRef(selection);selectionRef.current=selection;
  const editingRef=useRef(editing);editingRef.current=editing;
  const editingSync=useRef<(()=>void)|null>(null);
  useEffect(()=>{editingSync.current?.();},[editing,selection]);
  const xrCallbacks=useRef({onXrReady,onXrArtworks});xrCallbacks.current={onXrReady,onXrArtworks};
  const xrActive=useRef(false);
  const [xrRunning,setXrRunning]=useState(false);
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
  const focusedPlacement = useRef(focusedPlacementId);focusedPlacement.current=focusedPlacementId;
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
    [walkPreparation,setWalkPreparation]=useState<'pending'|'ready'|'failed'>('pending'),
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
    ((kind: "next" | "auto" | "full" | "coarse" | "retry" | "cancel") => void) | null
  >(null);
  const [assetReport,setAssetReport]=useState({loaded:0,failed:0});
  const [restart, setRestart] = useState(0);
  const [shadowMessage,setShadowMessage]=useState('');
  const [publicMessage, setPublicMessage] = useState("전시를 준비하고 있어요.");
  const ViewControls = publicSource ? "details" : "div";
  const [message, setMessage] = useState("공간 미리보기를 준비합니다."),
    [ready, setReady] = useState(false);
  const enteredWalking=useRef(false);
  useEffect(()=>{if(immersive&&ready&&(assetReport.loaded>0||document.placements.length===0)&&!suspendNavigation&&!enteredWalking.current&&walkingActions.current){enteredWalking.current=true;walkingActions.current.start();}},[immersive,ready,assetReport.loaded,document.placements.length,suspendNavigation,walkPreparation]);
  useEffect(()=>{if(cameraRequest&&ready&&action.current&&consumedCameraRequest.current!==cameraRequest.sequence){consumedCameraRequest.current=cameraRequest.sequence;action.current(cameraRequest.kind);}},[cameraRequest?.sequence,cameraRequest?.kind,ready]);
  const nativeReport=useRef(onRenderState);nativeReport.current=onRenderState;
  useEffect(()=>{nativeReport.current?.({ready,message:publicSource?publicMessage:message,...assetReport,navigationReady:!immersive||(walkPreparation==='ready'&&walkingMode),navigationFailed:immersive&&walkPreparation==='failed'});},[ready,message,publicMessage,publicSource,assetReport,immersive,walkPreparation,walkingMode]);
  useEffect(()=>{if(openingViewpoint&&ready&&!xrRunning&&!suspendNavigation&&!walkLoading&&openingConsumed.current!==openingViewpoint.sequence&&walkingActions.current?.teleport){openingConsumed.current=openingViewpoint.sequence;walkingActions.current.teleport(openingViewpoint.viewpointId);}},[openingViewpoint,ready,suspendNavigation,walkLoading]);
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
    xrActive.current=false;setXrRunning(false);
    setWalkingMode(false);
    setWalkPaused(true);
    setWalkLoading(false);
    setWalkPreparation('pending');
    setReady(false);
    setAssetReport({loaded:0,failed:0});
    setMessage("공간 미리보기를 준비합니다.");
    setPublicMessage("전시를 준비하고 있어요.");
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
      applyReferenceOutput(three,renderer,referenceTone);
      const compactQuality=(viewerBudget?.maxTextureSize??2048)<=512;
      const environmentReserve=environmentEstimate(compactQuality?64:128).generationPeakBytes;
      const shadowReserve=compactQuality?0:SHADOW_RESERVE_BYTES;
      const assetBudgetBytes=Math.max(1,(viewerBudget?.maxCacheBytes??33554432)-environmentReserve-shadowReserve);
      const scene = new three.Scene();
      scene.background = new three.Color("#e9e9e1");
      const model = new three.Group(),
        owned: Array<{ dispose: () => void }> = [];
      scene.add(model);
      const hemisphere = new three.HemisphereLight(
          0xffffff,
          0x71806a,
          document.lights.length ? 0.4 : 2.5,
        );
      scene.add(hemisphere);
      const sun = new three.DirectionalLight(
        0xffffff,
        document.lights.length ? 0 : 3,
      );
      const daylight=daylightFor(document);
      if(daylight){const direction=daylightDirection(daylight);sun.position.fromArray(direction.map(n=>n*100) as [number,number,number]);sun.intensity=daylight.enabled&&direction[1]>0?daylight.intensity:0;}else sun.position.set(20, 30, 25);
      renderer.domElement.dataset.daylight=JSON.stringify(daylight?{...daylight,direction:daylightDirection(daylight),effectiveIntensity:sun.intensity}:null);
      scene.add(sun);
      const editTargets=new Map<string,InstanceType<typeof three.Object3D>>();
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
        group.userData.editorSelection={kind:"room",id:room.id};editTargets.set(selectionKey(group.userData.editorSelection),group);
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
            "#829180",
        });
        const outline = new three.LineSegments(edges, material);
        outline.position.y = room.dimensions.height / 2;
        outline.userData.dimensionReference={...room.dimensions};group.userData.dimensionOutline=outline;
        group.add(outline);
        owned.push(box, edges, material);
      }
      document.surfaces.forEach((surface, index) => {
        const group = new three.Group();
        pose(group, surface.transform);
        group.userData.editorSelection={kind:"surface",id:surface.id};editTargets.set(selectionKey(group.userData.editorSelection),group);
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
            transparent:!!editingRef.current&&transparentSpace,opacity:editingRef.current&&transparentSpace ? .32:1,depthWrite:!editingRef.current||!transparentSpace,
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

      });
      for (const opening of document.openings) {
        const geometry = new three.PlaneGeometry(
            opening.dimensions.width,
            opening.dimensions.height,
          ),
          edges = new three.EdgesGeometry(geometry);
        const material = new three.LineBasicMaterial({
            color:"#203d2c",
          }),
          line = new three.LineSegments(edges, material);
        line.userData.editorSelection={kind:"opening",id:opening.id};editTargets.set(selectionKey(line.userData.editorSelection),line);
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
        group.userData.editorSelection={kind:"placement",id:placement.id};editTargets.set(selectionKey(group.userData.editorSelection),group);
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
        const assertionPose=new three.Group();pose(assertionPose,artwork.transform);assertionPose.add(bounds);group.add(assertionPose);
        owned.push(geometry, edges, material);
      }
      const installation=installDecor(three,document,rooms);owned.push(installation);setInstallationIssueCount(installation.issues.length);
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
      const shadowCandidates=[...scriptLights.values()].flatMap(({light})=>{
        const item=document.lights.find(item=>scriptLights.get(item.id)?.light===light),room=item&&rooms.get(item.roomId.toLowerCase());
        return room&&(light instanceof three.DirectionalLight||light instanceof three.SpotLight)?[{light,room}]:[];
      });
      for(const room of rooms.values())shadowCandidates.push({light:sun,room});
      const shadowPass=installBoundedShadows(three,renderer,shadowCandidates,compactQuality,shadowReserve,value=>{
        renderer.domElement.dataset.shadows=JSON.stringify({...value,reserveBytes:shadowReserve});
        setShadowMessage(value.mode==='bounded'?'주요 조명의 제한된 공간 그림자를 표시합니다.':value.mode==='compact'?'경량 화면에서는 공간 그림자를 생략합니다.':'이 공간에서는 그림자를 생략하고 작품과 조명을 표시합니다.');
      });owned.push(shadowPass);
      const controls = new OrbitControls(camera, renderer.domElement);
      let authoredFov = camera.fov;
      const applyProjection = () => {
        camera.fov = immersive ? visitingFov(authoredFov,viewFovRef.current,camera.aspect) : authoredFov;
        camera.updateProjectionMatrix();
      };
      let pointerStart: [number,number] | undefined;
      let panelResume: ReturnType<typeof installPanelResume> | undefined;
      const down = (event: PointerEvent) => { pointerStart=[event.clientX,event.clientY]; };
      renderer.domElement.addEventListener("pointerdown",down);
      const pick = (event: MouseEvent) => {
        if(!pointerStart || Math.hypot(event.clientX-pointerStart[0],event.clientY-pointerStart[1])>5)return;
        if (xrActive.current || suspendedRef.current || (!panelResume && !navigationCallbacks.current.onArtworkSelect && !navigationCallbacks.current.onScriptClick)) return;
        const box = renderer.domElement.getBoundingClientRect(), ray = new three.Raycaster();
        ray.setFromCamera(globalThis.document.pointerLockElement===renderer.domElement?new three.Vector2(0,0):new three.Vector2((event.clientX-box.left)/box.width*2-1,-(event.clientY-box.top)/box.height*2+1), camera);
        const hit=ray.intersectObject(model,true)[0];
        let object=hit?.object;
        while(object) { if(typeof object.userData.placementId === "string") { navigationCallbacks.current.onScriptClick?.(object.userData.placementId); if(navigationCallbacks.current.onArtworkSelect){detailEntry.current.prepare(); detailEntry.current.commit(true); navigationCallbacks.current.onArtworkSelect(object.userData.placementId);} return; } object=object.parent ?? undefined; }
        panelResume?.blank(event, currentWalkMode.current.walking && currentWalkMode.current.paused && !gpuLost);
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
      let projectionStamp = "", framePixelBudget:number|undefined;
      const render = () => {
        const canvas=renderer.domElement, stamp=`${authoredFov}/${camera.fov}/${camera.aspect}/${canvas.width}/${canvas.height}`;
        if(stamp!==projectionStamp){projectionStamp=stamp;canvas.dataset.cameraProjection=JSON.stringify({width:canvas.clientWidth,height:canvas.clientHeight,aspect:camera.aspect,authoredVerticalFov:authoredFov,verticalFov:camera.fov,horizontalFov:2*Math.atan(Math.tan(camera.fov*Math.PI/360)*camera.aspect)*180/Math.PI,bufferWidth:canvas.width,bufferHeight:canvas.height,pixelBudget:framePixelBudget});}
        if (!disposed && !gpuLost && !xrActive.current) {
          const at = performance.now();
          shadowPass.flush();
          try { renderer.render(scene, camera); } finally { shadowPass.afterRender(); }
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
      const scriptScene:ScriptScene={setLight:(id,multiplier)=>{const entry=scriptLights.get(id);if(entry&&Number.isFinite(multiplier)){const next=entry.original*Math.max(0,Math.min(1,multiplier));if((entry.light.intensity>0)!==(next>0))shadowPass.invalidate();entry.light.intensity=next;scriptDiagnostics();render();}},setArtworkVisible:(id,visible)=>{const group=placements.get(id.toLowerCase());if(group){group.visible=visible;const decor=installation.groups.get(id.toLowerCase());if(decor)decor.visible=visible;shadowPass.invalidate();scriptDiagnostics();render();}},reset:()=>{for(const {light,original}of scriptLights.values())light.intensity=original;for(const group of placements.values())group.visible=true;for(const group of installation.groups.values())group.visible=true;shadowPass.invalidate();scriptDiagnostics();render();}};
      scriptDiagnostics();navigationCallbacks.current.onScriptSceneReady?.(scriptScene);
      const benchmark = () => {
        if (!viewerBudget || trace.started || xrActive.current) return;
        trace.started = performance.now();
        trace.samples = [];
        const tick = () => {
          if (disposed || xrActive.current) return;
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
        if(xrActive.current)return;
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
          authoredFov = savedCamera.fov;
          applyProjection();
        } else if (kind === "front" && selectionRef.current) {
          const selection=selectionRef.current;
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
          height = immersive ? Math.max(host.current.clientHeight, 1) : 360;
        const preferredRatio = Math.min(devicePixelRatio, viewerBudget?.maxPixelRatio ?? 2);
        // Desktop gets a bounded full-HD buffer; compact keeps its former cost.
        const {pixelBudget,ratio} = visitingBuffer(width,height,preferredRatio,compactQuality);
        framePixelBudget = immersive ? pixelBudget : undefined;
        renderer.setPixelRatio(immersive ? ratio : preferredRatio);
        renderer.setSize(width, height);
        camera.aspect = width / height;
        applyProjection();
        render();
      };
      resizeAction.current = resize;
      renderer.domElement.setAttribute("aria-label", "전시 공간 3D 미리보기");
      renderer.domElement.setAttribute("role", "img");
      const lost = (event: Event) => {
        event.preventDefault();
        gpuLost = true;
        xrCallbacks.current.onXrReady?.(null);renderer.setAnimationLoop(null);
        cancelAnimationFrame(trace.frame);
        walkingActions.current?.pause();
        demand.current?.("cancel");
        setReady(false);
        setPublicMessage("3D 화면 연결이 중단됐어요. 작품 목록을 이용하거나 ‘3D 다시 시작’을 눌러 주세요.");
        setMessage(
          viewerBudget
            ? "3D 그래픽 연결이 중단되었습니다. 작품 목록을 계속 사용할 수 있습니다. 3D 다시 시작으로 재시도할 수 있습니다."
            : "3D 그래픽 연결이 중단되었습니다. 작품 metadata와 저장본은 유지됩니다. JSON과 숫자 편집을 사용할 수 있습니다.",
        );
      };
      renderer.domElement.addEventListener("webglcontextlost", lost);
      host.current.replaceChildren(renderer.domElement);
      // Panel scope requires the attached public canvas; before attachment its
      // closest publication shell is null.
      if (immersive) panelResume = installPanelResume(renderer.domElement, () => walkingActions.current?.pause("panel"), () => walkingActions.current?.start());
      const observer = new ResizeObserver(resize);
      observer.observe(host.current);
      controls.addEventListener("change", render);
      guideAction.current=(routeId,index)=>{
        if(suspendedRef.current||xrActive.current)return;
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
      if(editingRef.current&&editorCamera.current?.documentId===document.id){const saved=editorCamera.current;camera.position.fromArray(saved.position);camera.quaternion.fromArray(saved.quaternion);controls.target.fromArray(saved.target);controls.update();render();}
      setMessage(
        `공간 ${document.rooms.length} · 표면 ${document.surfaces.length} · 실제 개구부 ${document.openings.length}. 작품 bounds는 실제 치수입니다. 작품 derivative 미사용: metadata만 표시합니다.`,
      );
      setReady(true);
      if(immersive)renderer.domElement.tabIndex=0;
      setPublicMessage(document.placements.length ? "공간을 볼 수 있어요. 가까운 작품부터 불러오고 있어요." : "전시 공간을 볼 수 있어요.");
      const xrArtworks=new Map<string,GeometryXrArtwork>();
      let xrSaved:{position:typeof camera.position;quaternion:typeof camera.quaternion;up:typeof camera.up;target:typeof controls.target}|null=null;
      const xrBridge:GeometryXrBridge={renderer,camera,scene,artworks:()=>[...xrArtworks.values()],frame:callback=>{renderer.setAnimationLoop(callback?(time,frame)=>{shadowPass.flush();try{callback(time,frame);}finally{shadowPass.afterRender();}}:null);},suspend:active=>{if(disposed)return;if(active&&!xrActive.current){xrSaved={position:camera.position.clone(),quaternion:camera.quaternion.clone(),up:camera.up.clone(),target:controls.target.clone()};walkingActions.current?.stationary();walkingActions.current?.pause();cancelAnimationFrame(trace.frame);controls.enabled=false;}xrActive.current=active;setXrRunning(active);if(!active){if(xrSaved){camera.position.copy(xrSaved.position);camera.quaternion.copy(xrSaved.quaternion);camera.up.copy(xrSaved.up);controls.target.copy(xrSaved.target);xrSaved=null;}controls.enabled=!suspendedRef.current&&!currentWalkMode.current.walking;render();}}};
      if(publicSource&&viewerBudget)xrCallbacks.current.onXrReady?.(xrBridge);
      const editor=editingRef.current ? installPreviewEditing({scene,camera,renderer,model,targets:editTargets,orbit:controls,bridge:()=>editingRef.current,previewDocument:(doc,selection)=>{if(!disposed&&selection.kind==='placement')setInstallationIssueCount(installation.preview(doc,selection.id));},render:()=>{shadowPass.invalidate();render();}}):null;
      editingSync.current=()=>editor?.sync();
      release = () => {
        if(editingEnabled)editorCamera.current={documentId:document.id,position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),target:controls.target.toArray()};
        xrCallbacks.current.onXrReady?.(null);xrCallbacks.current.onXrArtworks?.([]);renderer.setAnimationLoop(null);xrActive.current=false;xrArtworks.clear();
        editor?.dispose();editingSync.current=null;
        walkingRelease();
        panelResume?.dispose();
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
      // Async environment setup starts only AFTER scene teardown is registered.
      // Failed/cancelled generation keeps the existing lighting and text/navigation.
      void installReferenceEnvironment(three,renderer,scene,environmentReserve,compactQuality,()=>disposed||gpuLost).then(environment=>{
        if(!environment)return;
        if(disposed||gpuLost){environment.dispose();return;}
        owned.push(environment);scene.environmentIntensity=.45;
        hemisphere.intensity=document.lights.length ? .2 : .6;
        if(!daylight&&!document.lights.length)sun.intensity=2;
        renderer.domElement.dataset.renderQuality=JSON.stringify({tone:referenceTone,exposure:1,environmentSize:environment.size,environmentReserveBytes:environmentReserve,shadowReserveBytes:shadowReserve,assetBudgetBytes});
        render();
      }).catch(()=>{if(!disposed)renderer.domElement.dataset.renderQuality=JSON.stringify({tone:referenceTone,exposure:1,environment:'unavailable',assetBudgetBytes});});
      orbitEnabled.current = (enabled) => { controls.enabled = enabled&&!xrActive.current; };
      if (suspendedRef.current) controls.enabled = false;
      if (viewerBudget) {
        renderer.domElement.tabIndex = 0;
        renderer.domElement.setAttribute(
          "aria-describedby",
          "walking-instructions",
        );
        let initialization: Promise<void> | undefined;
        const initialize = async (teleportViewpointId?: string) => {
          if (disposed || xrActive.current) return;
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
                isPanelFocus: panelResume?.isPanelFocus,
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
                onMode: (walking, paused, reason) => {
                  panelResume?.mode(walking, paused, reason);
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
              setWalkPreparation('ready');
            })()
              .catch(() => {
                if (!disposed) {
                  setWalkPreparation('failed');
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
              if (!disposed && !xrActive.current && !suspendedRef.current && walkingActions.current !== pending)
                walkingActions.current?.start();
            });
          },
          capture: () => {
            void initialize().then(() => {
              if (!disposed && !xrActive.current && !suspendedRef.current && walkingActions.current !== pending)
                walkingActions.current?.capture();
            });
          },
          teleport: (viewpointId) => {
            void initialize(viewpointId).then(() => {
              if (!disposed && !xrActive.current && !suspendedRef.current && walkingActions.current !== pending)
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
        assetBudgetBytes,
      );
      let cacheHits = 0;
      const decodedResources = new Map<
        InstanceType<typeof three.Object3D>,
        Array<{ dispose: () => void }>
      >();
      const checkPublicAvailability=async(signal:AbortSignal)=>{
        if(!publicSource)throw Error('PUBLIC_DERIVATIVE_UNAVAILABLE');
        if(publicSource.check)await publicSource.check();
        else{
          const current=await fetch(`/api/v1/publications/${publicSource.publicationId}`,{credentials:'omit',cache:'no-store',signal});
          if(!current.ok||(await current.json()).publication.revisionSha256!==publicSource.revisionSha256)throw Error('PUBLIC_DERIVATIVE_UNAVAILABLE');
        }
        signal.throwIfAborted();
      };
      const readArtworkBytes = async (
        artwork: Document["artworks"][number], inventory: Document["artworks"][number]["assets"][number], taskSignal:AbortSignal,
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
            // Reuse still checks authoritative availability.
            await checkPublicAvailability(signal);
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
        return bytes!;
      };
      const loadArtwork = async (
        artwork: Document["artworks"][number],
        inventory = artwork.assets.find(a=>a.id===artwork.primaryAssetId)!,
        taskSignal = abort.signal,
        reserveDecode?: (bytes:ArrayBuffer)=>void,
        stage?: (value:string)=>void,
      ) => {
        const signal=AbortSignal.any([abort.signal,taskSignal]);
        const bytes=await readArtworkBytes(artwork,inventory,signal);
        stage?.('verified-download');
        reserveDecode?.(bytes!);
        stage?.(artwork.artworkType==='image'?'cpu-image-decode':'cpu-glb-parse');
        const resources: Array<{ dispose: () => void }> = [];
        try {
          let object: InstanceType<typeof three.Object3D>;
          if (artwork.artworkType === "image") {
            const sourceSize=viewerBudget?checkImageDecode(bytes!,artwork,inventory,viewerBudget):undefined;
            let bitmap = await createImageBitmap(
              new Blob([bytes!], { type: "image/png" }),
              { imageOrientation: "flipY" },
            );
            resources.push({ dispose: () => bitmap.close() });
            if(sourceSize&&(bitmap.width!==sourceSize.width||bitmap.height!==sourceSize.height))throw Error('IMAGE_DECODE_BUDGET');
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
                // The initial bitmap is already oriented for GPU upload; do not flip it again.
                imageOrientation: "none",
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
            const material = new three.MeshBasicMaterial({
              map: texture,
              side: three.DoubleSide,
              toneMapped: false,
            });
            resources.push(geometry, material);
            object = new three.Mesh(geometry, material);
          } else {
            const { GLTFLoader } =
              await import("three/addons/loaders/GLTFLoader.js");
            const manager = new three.LoadingManager();
            const basis=await basisLoader(renderer,bytes!);if(basis)resources.push(basis);
            if(disposed||signal.aborted){basis?.dispose();throw new DOMException('Aborted','AbortError');}
            const protectedBytes = embeddedPNGManager(manager, bytes!,basis);
            resources.push(protectedBytes);
            const cancelDecode=()=>protectedBytes.dispose();signal.addEventListener("abort",cancelDecode,{once:true});
            let gltf;try{const loader=new GLTFLoader(manager);if(protectedBytes.ktx2Loader)loader.setKTX2Loader(protectedBytes.ktx2Loader as never);gltf=await loader.parseAsync(protectedBytes.bytes, "");}finally{signal.removeEventListener("abort",cancelDecode);}
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
                    decodedBytes += data.buffer.byteLength*2;
                  }
                }
              }
              if (node.geometry.index) {
                const data = node.geometry.index.array;
                if (!buffers.has(data.buffer)) {
                  buffers.add(data.buffer);
                  decodedBytes += data.buffer.byteLength*2;
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
                      (image?.width ?? 0) * (image?.height ?? 0) * 4 * (1+4/3);
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
          if(artwork.artworkType!=="image"){const centered=centerMetricModel(three,object);object=centered.object;object.userData.metricGeometry=centered.measured;}
          const metricGeometry=object.userData.metricGeometry;const artifact=artifactMetricModel(three,object,artwork.transform);object=artifact.object;object.userData.metricGeometry=metricGeometry;object.userData.artifactGeometry=artifact.measured;
          object.userData.viewer = {
            triangles,
            decodedBytes,
            measuredGeometry:object.userData.metricGeometry,
            artifactGeometry:object.userData.artifactGeometry,
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
        const pending=new Map<string,string>(), transitions=new Map<string,DetailTransition>(), retryAfter=new Map<string,number>(), awaySince=new Map<string,number>();
        const attention=new ArtworkAttention();
        const prepared=new Map<string,{artId:string;object:InstanceType<typeof three.Object3D>;lastUseful:number}>();
        const stages=new Map<string,{stage:string;at:number;durationsMs:Record<string,number>}>();
        const stage=(id:string,value:string)=>{
          const now=performance.now(),previous=stages.get(id),durationsMs={...previous?.durationsMs};
          if(previous)durationsMs[previous.stage]=(durationsMs[previous.stage]??0)+now-previous.at;
          stages.delete(id);stages.set(id,{stage:value,at:now,durationsMs});while(stages.size>32)stages.delete(stages.keys().next().value!);
        };
        let currentArtwork:string|undefined;
        let preparing=new Set<string>();
        const reclaiming=new Set<string>(), lastAttended=new Map<string,number>(), observedVisible=new Map<string,boolean>();
        const placeholders=new Map([...placements].map(([id,group])=>[id,[...group.children]]));
        let sequence=0, automatic=true, manualFull=false;
        const resident=()=>[...objects.values(),...[...prepared.values()].map(v=>v.object)].reduce((sum,value)=>sum+(value.userData.viewer?.decodedBytes??0),0)+byteCache.stats().bytes;
        const peak=new AssetPeakBudget(assetBudgetBytes,resident);
        const reserve=(key:string,bytes:number)=>{
          // Encoded bytes and prepared objects are expendable; displayed objects stay pinned through replacement.
          for(const art of arts)for(const asset of art.assets){if(peak.total(key)+bytes<=assetBudgetBytes)break;byteCache.delete(asset.id);}
          if(!tasks.get(key)?.prepareOnly)for(const [id,value] of prepared){if(peak.total(key)+bytes<=assetBudgetBytes)break;prepared.delete(id);destroy(value.object);stage(id,'evicted-preparation');}
          peak.reserve(key,bytes);
        };
        const tasks = new Map<
          string,
          {
            art: Document["artworks"][number];
            inventory: Document["artworks"][number]["assets"][number];
            prepareOnly:boolean; downloadOnly:boolean;
          }
        >();
        const scheduler = new AssetScheduler<
          {object?:InstanceType<typeof three.Object3D>;key:string}
        >({
          // Fetch, decode/parse and texture/shader preparation share this serial slot.
          concurrency: 1,
          load: async (key, signal) => {
            const t = tasks.get(key)!;
            try {
              const ready=prepared.get(t.inventory.id);
              if(ready&&!t.prepareOnly){
                // Recheck current rights/revision before displaying a retained object.
                await checkPublicAvailability(signal);
                signal.throwIfAborted();
                prepared.delete(t.inventory.id);
                try{reserve(key,ready.object.userData.viewer?.decodedBytes??0);}catch(error){prepared.set(t.inventory.id,ready);throw error;}
                ready.object.userData.loadKey=key;
                return {object:ready.object,key};
              }
              reserve(key,t.inventory.bytes*4);
              stage(t.inventory.id,'fetch-verify');
              if(t.downloadOnly){
                await readArtworkBytes(t.art,t.inventory,signal);
                signal.throwIfAborted();
                stage(t.inventory.id,'verified-download');
                return {key};
              }
              const object=await loadArtwork(t.art,t.inventory,signal,bytes=>reserve(key,assetDecodeReserve(t.art,t.inventory,viewerBudget,bytes)),value=>stage(t.inventory.id,value));
              object.userData.loadKey=key;
              try{
                signal.throwIfAborted();
                stage(t.inventory.id,'texture-upload-shader-prepare');
                object.traverse(node=>{if(node instanceof three.Mesh)for(const material of Array.isArray(node.material)?node.material:[node.material])for(const value of Object.values(material))if(value instanceof three.Texture)renderer.initTexture(value);});
                renderer.compile(object,camera,scene);
                signal.throwIfAborted();
                // Geometry buffers are uploaded by the first draw, not compile().
                stage(t.inventory.id,'textures-shaders-prepared-geometry-awaits-draw');
                return {object,key};
              }catch(error){destroy(object);throw error;}
            } catch(error){
              stage(t.inventory.id,signal.aborted?'cancelled-settled':error instanceof Error&&error.message==='ASSET_TRANSITION_PEAK'?'deferred-budget':'failed');
              peak.release(key);tasks.delete(key);throw error;
            }
          },
          onDiscard: result=>{const task=tasks.get(result.key);if(task)stage(task.inventory.id,'cancelled-settled');peak.release(result.key);tasks.delete(result.key);if(result.object)destroy(result.object);},
        });
        const update = () => {
          if (disposed || gpuLost) return;
          const decodedTotal = [...objects.values(),...[...prepared.values()].map(v=>v.object)].reduce(
            (sum, value) => sum + (value.userData.viewer?.decodedBytes ?? 0),
            0,
          );
          for (const key of tasks.keys()) {
            if (
              decodedTotal + byteCache.stats().bytes <=
              assetBudgetBytes
            )
              break;
            byteCache.delete(tasks.get(key)!.inventory.id);
          }
          const loaded = ordered.filter((p) =>
            active.has(p.artworkRevisionId),
          ).length;
          setAssetReport(previous=>previous.loaded===loaded&&previous.failed===failed.size?previous:{loaded,failed:failed.size});
          renderer.domElement.dataset.viewerState = JSON.stringify({
            loadedPlacements: loaded,
            authoredLights: document.lights.length,
            installationPrimitives:installation.primitiveCount,installationIssues:installation.issues,
            loadedAssets: active.size,
            entranceLoaded: arts
              .slice(0, viewerBudget.entranceAssets)
              .filter((a) => active.has(a.revisionId)).length,
            total: arts.length,
            deferred: arts.length - requested.size,
            failed: failed.size,
            cacheHits,
            budgetTotalBytes: decodedTotal + byteCache.stats().bytes,
            transitionPeakBytes: peak.total(),
            automaticDetail:automatic,
            currentArtwork, preparedAssetIds:[...prepared.keys()], preparationStages:[...stages].map(([assetId,value])=>({assetId,...value})),
            allocationEstimateOnly:true,
            cache: byteCache.stats(),
            scheduler: scheduler.stats(),
            assetIds: [...active.values()],
            pixelRatio: renderer.getPixelRatio(),
            decodedBytes: [...objects.values(),...[...prepared.values()].map(v=>v.object)].reduce(
              (sum, value) => sum + (value.userData.viewer?.decodedBytes ?? 0),
              0,
            ),
            artifactPlacements:[...placements.entries()].flatMap(([id,group])=>{const result:{placementId:string;matrix:number[]}[]=[];group.traverse(node=>{if(node.userData.artifactGeometry)result.push({placementId:id,matrix:node.matrixWorld.elements.slice()});});return result;}),
            decoded: [...objects.values()].map(
              (value) => value.userData.viewer,
            ),
            geometry: renderer.info.memory.geometries,
            textures: renderer.info.memory.textures,
          });
          setPublicMessage(failed.size > 0
            ? "일부 작품을 불러오지 못했어요. 다시 시도하거나 작품 목록을 이용해 주세요."
            : "공간에서 관람할 수 있어요. 작품 목록에서도 감상할 수 있어요.");
          setMessage(
            `공간 ${document.rooms.length} · 표면 ${document.surfaces.length} · 실제 개구부 ${document.openings.length} · 승인된 작품 derivative ${loaded}개 · bytes 사용 불가 ${failed.size}개 · 입구 ${arts.slice(0, viewerBudget.entranceAssets).filter((a) => active.has(a.revisionId)).length}/${Math.min(arts.length, viewerBudget.entranceAssets)} · 갤러리 대기 ${arts.length - requested.size}개 (점선은 실제 치수 metadata bounds).`,
          );
        };
        const request = (art: (typeof arts)[number], full = false, prepareOnly=false):void => {
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
            const prior=pending.get(art.revisionId);
            if(prior&&desired.get(art.revisionId)!==inventory.id){desired.set(art.revisionId,inventory.id);scheduler.cancel(prior);pending.delete(art.revisionId);}
            update();
            return;
          }
          const prior=pending.get(art.revisionId);
          if(prior&&desired.get(art.revisionId)===inventory.id)return;
          const ready=prepared.get(inventory.id);
          if(ready&&prepareOnly)return;
          const cached=byteCache.get(inventory.id);
          let downloadOnly=false;
          if(!ready&&full&&authoredImagePair(art)){
            try{
              const ceiling=cached?assetDecodeReserve(art,inventory,viewerBudget,cached):imageFullDecodeCeiling(art,inventory,viewerBudget)!;
              // A speculative load cannot spend a peer's retained preparation.
              const reclaimable=prepareOnly?0:[...prepared.values()].reduce((sum,v)=>sum+(v.object.userData.viewer?.decodedBytes??0),0);
              // Fetch a verified header first when the conservative declared square cannot fit.
              downloadOnly=peak.total()-byteCache.stats().bytes-reclaimable+ceiling>assetBudgetBytes;
              if(downloadOnly&&cached){
                if(art.revisionId===currentArtwork){reclaimForCurrent();stage(inventory.id,'deferred-budget');}
                if(!active.has(art.revisionId))request(art,false,prepareOnly);return;
              }
            }catch{if(!active.has(art.revisionId))request(art,false,prepareOnly);return;}
          }
          if(prior)scheduler.cancel(prior);
          desired.set(art.revisionId, inventory.id);
          const key=`${inventory.id}/${sequence++}`;
          pending.set(art.revisionId,key);
          tasks.set(key, { art, inventory, prepareOnly, downloadOnly });
          void scheduler
            .request(key, art.revisionId===currentArtwork?-100:prepareOnly?100:arts.indexOf(art))
            .then(({object}) => {
              peak.release(key);
              const current=settleAssetGeneration(pending,art.revisionId,key);
              tasks.delete(key);
              if(!object){update();return;}
              if (disposed || !current || desired.get(art.revisionId) !== inventory.id) {
                destroy(object);
                return;
              }
              if(peak.total()+(object.userData.viewer?.decodedBytes??0)>assetBudgetBytes){
                destroy(object);retryAfter.set(art.revisionId,performance.now()+5000);update();return;
              }
              if(prepareOnly&&currentArtwork!==art.revisionId){
                if(preparing.has(art.revisionId)){prepared.set(inventory.id,{artId:art.revisionId,object,lastUseful:performance.now()});stage(inventory.id,'prepared-resident');}
                else destroy(object);
                update();return;
              }
              const old = objects.get(art.revisionId);
              for (const p of ordered.filter(
                (p) => p.artworkRevisionId === art.revisionId,
              )) {
                const group = placements.get(p.id.toLowerCase());
                if (group) {
                  group.clear();
                  group.add(object.clone(true));
                }
              }
              if (old && old !== object){xrArtworks.delete(art.revisionId);xrCallbacks.current.onXrArtworks?.([...xrArtworks.values()]);destroy(old);}
              objects.set(art.revisionId, object);
              const oldId=active.get(art.revisionId);
              active.set(art.revisionId, inventory.id);
              if(art.revisionId===currentArtwork&&full)reclaiming.clear();
              stage(inventory.id,'attached-awaiting-draw');
              if(oldId&&oldId!==inventory.id)byteCache.delete(oldId);
              xrArtworks.set(art.revisionId,{revisionId:art.revisionId,assetId:inventory.id,label:art.metadata.title,object});xrCallbacks.current.onXrArtworks?.([...xrArtworks.values()]);
              failed.delete(art.revisionId);retryAfter.delete(art.revisionId);
              shadowPass.invalidate();
              render();
              stage(inventory.id,'display-attached-render-requested');
              update();
            })
            .catch((error) => {
              const current=settleAssetGeneration(pending,art.revisionId,key);
              // A late non-abort failure belongs to its old request, not its successor.
              if(!current){if(error?.name==='AbortError')tasks.delete(key);if(!disposed)update();return;}
              if (!disposed) {
                if(error?.name === 'AbortError'){tasks.delete(key);update();return;}
                retryAfter.set(art.revisionId,error?.message==='ASSET_TRANSITION_PEAK'?performance.now()+(art.revisionId===currentArtwork?500:5000):Infinity);
                if(error?.message==='ASSET_TRANSITION_PEAK'&&art.revisionId===currentArtwork)reclaimForCurrent();
                if(prepareOnly||active.has(art.revisionId)){update();return;}
                if (error?.name !== "AbortError" && !full && !authoredImagePair(art)) {
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
        const reclaimForCurrent=()=>{
          // Let one ready-before-swap downgrade settle before reclaiming another.
          if([...reclaiming].some(id=>pending.has(id)))return;
          const candidate=displayedDetailReclamation(arts.filter(art=>active.has(art.revisionId)&&!reclaiming.has(art.revisionId)).map(art=>({
            id:art.revisionId,artwork:art,assetId:active.get(art.revisionId)!,visible:observedVisible.get(art.revisionId)??true,lastAttended:lastAttended.get(art.revisionId)??-Infinity,
          })),currentArtwork,performance.now(),viewerBudget);
          if(!candidate)return;
          const art=arts.find(v=>v.revisionId===candidate.id)!;
          reclaiming.add(candidate.id);
          if(!candidate.evict){retryAfter.delete(candidate.id);request(art,false);return;}
          const key=pending.get(candidate.id);if(key){scheduler.cancel(key);pending.delete(candidate.id);}
          desired.delete(candidate.id);
          const old=objects.get(candidate.id),oldAsset=active.get(candidate.id);
          for(const p of ordered.filter(p=>p.artworkRevisionId===candidate.id)){
            const group=placements.get(p.id.toLowerCase());if(group){group.clear();for(const bound of placeholders.get(p.id.toLowerCase())??[])group.add(bound);}
          }
          objects.delete(candidate.id);active.delete(candidate.id);requested.delete(candidate.id);xrArtworks.delete(candidate.id);
          xrCallbacks.current.onXrArtworks?.([...xrArtworks.values()]);
          if(old)destroy(old);if(oldAsset)byteCache.delete(oldAsset);
          shadowPass.invalidate();render();
        };
        demand.current = (kind) => {
          if (kind === 'auto'){automatic=true;return;}
          if(kind==='cancel'||kind==='coarse'){
            preparing.clear();
            for(const [id,value] of prepared){destroy(value.object);stage(id,'released-manual-preparation');}
            prepared.clear();
            if(kind==='coarse')for(const [artId,key] of pending)if(tasks.get(key)?.prepareOnly){scheduler.cancel(key);pending.delete(artId);}
            // Unsettled jobs retain their own peak reservations until loader settlement.
          }
          if (kind === 'full'||kind==='coarse'){automatic=false;manualFull=kind==='full';}
          if (kind === "cancel") {
            automatic=false;
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
          for (const art of selected) {retryAfter.delete(art.revisionId);request(art, (kind === "full" || (kind==='next'&&!automatic&&manualFull)));}
        };
        const automaticDemand=()=>{
          if(disposed||gpuLost||xrActive.current||!automatic)return;
          const now=performance.now();camera.updateMatrixWorld();model.updateMatrixWorld(true);
          const frustum=new three.Frustum().setFromProjectionMatrix(new three.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
          const wallMeshes=document.surfaces.filter(v=>v.type==='wall').map(v=>surfaces.get(v.id.toLowerCase())!).filter(Boolean);
          const clearPath=(from:InstanceType<typeof three.Vector3>,to:InstanceType<typeof three.Vector3>)=>{
            const direction=to.clone().sub(from),length=direction.length();if(length<.2)return true;
            const ray=new three.Raycaster(from,direction.normalize(),.05,Math.max(.05,length-.15));
            return !ray.intersectObjects(wallMeshes,true).some(hit=>hit.object instanceof three.Mesh);
          };
          const contains=(room:Document['rooms'][number],point:InstanceType<typeof three.Vector3>,margin=0)=>{
            const local=rooms.get(room.id.toLowerCase())!.worldToLocal(point.clone()),d=room.dimensions;
            return Math.abs(local.x)<=d.width/2+margin&&Math.abs(local.z)<=d.depth/2+margin&&local.y>=-margin&&local.y<=d.height+margin;
          };
          const cameraRoom=document.rooms.find(room=>contains(room,camera.position));
          const doors=document.openings.filter(v=>v.type==='door').flatMap(door=>{
            const surface=document.surfaces.find(v=>v.id.toLowerCase()===door.surfaceId.toLowerCase()),group=surfaces.get(door.surfaceId.toLowerCase());
            if(!surface||!group)return [];
            const point=group.localToWorld(new three.Vector3(door.offset[0],door.offset[1],0));
            return camera.position.distanceTo(point)<=3&&clearPath(camera.position,point)?[{point,roomId:surface.roomId}]:[];
          });
          const observations=arts.map(art=>{
            let visible=false,distance=Infinity,focused=false,screenDemand=false,maxOccupancy=0,gazeDistance=Infinity,eligible=false;
            const low=lodVariantsFor(art).find(v=>v.detail==='coarse');
            for(const p of ordered.filter(p=>p.artworkRevisionId===art.revisionId)){
              const group=placements.get(p.id.toLowerCase());if(!group||!group.visible)continue;
              let shown=true;for(let parent=group.parent;parent;parent=parent.parent)shown=shown&&parent.visible;
              if(!shown)continue;
              const points=artifactCorners(art.dimensions,[art.transform]).map(v=>group.localToWorld(new three.Vector3(...v)));
              const box=new three.Box3().setFromPoints(points),center=box.getCenter(new three.Vector3());
              const d=box.distanceToPoint(camera.position);distance=Math.min(distance,d);
              const room=document.rooms.find(v=>v.id.toLowerCase()===p.roomId.toLowerCase());
              const sameRoom=cameraRoom?.id.toLowerCase()===p.roomId.toLowerCase();
              const unobstructed=clearPath(camera.position,center);
              const viaDoor=room&&doors.some(door=>(sameRoom||contains(room,door.point,.4))&&door.point.distanceTo(center)<=6&&clearPath(door.point,center));
              const plausible=!!((sameRoom&&unobstructed)||viaDoor);
              eligible=eligible||plausible;
              const screen=detailScreenBounds({corners:points.map(v=>{const clip=v.clone().project(camera);return {x:clip.x,y:clip.y,z:clip.z,depth:v.clone().applyMatrix4(camera.matrixWorldInverse).z};}),near:camera.near,intersectsFrustum:frustum.intersectsBox(box),width:renderer.domElement.width,height:renderer.domElement.height});
              if(!screen.visible||!unobstructed)continue;
              visible=true;const isFocused=focusedPlacement.current===p.id;focused=focused||isFocused;
              const {occupancy,projectedPixels:pixels}=screen;
              gazeDistance=Math.min(gazeDistance,screen.gazeDistance);
              maxOccupancy=Math.max(maxOccupancy,occupancy);
              screenDemand=screenDemand||detailDemand({kind:art.artworkType,visible:true,distance:Math.max(.001,d),occupancy,projectedPixels:pixels,coarseTextureSize:low?.textureSize,gazeDistance:screen.gazeDistance,focused:isFocused});
            }
            let transition=transitions.get(art.revisionId);if(!transition){transition=new DetailTransition();transitions.set(art.revisionId,transition);}
            const want=transition.update(screenDemand,now);
            return {art,visible,distance,focused,want,occupancy:maxOccupancy,gazeDistance,eligible};
          });
          const candidates=observations.map(v=>({id:v.art.revisionId,demand:v.want,occupancy:v.occupancy,focused:v.focused,gazeDistance:v.gazeDistance,distance:v.distance,eligible:v.eligible}));
          currentArtwork=attention.update(candidates,now);
          if(currentArtwork){lastAttended.set(currentArtwork,now);reclaiming.delete(currentArtwork);}
          for(const observation of observations)observedVisible.set(observation.art.revisionId,observation.visible);
          preparing=new Set(automatic?nearbyPreparation(candidates,currentArtwork):[]);
          // Cancel obsolete preparation without releasing its unsettled reservation.
          for(const [artId,key] of pending){const task=tasks.get(key);if(task?.prepareOnly&&(artId===currentArtwork||!preparing.has(artId))){scheduler.cancel(key);pending.delete(artId);}}
          for(const [id,value] of prepared){
            if(preparing.has(value.artId)||value.artId===currentArtwork)value.lastUseful=now;
            else if(now-value.lastUseful>=1800){prepared.delete(id);destroy(value.object);stage(id,'evicted-preparation');}
          }
          const sorted=[...observations].sort((a,b)=>Number(b.art.revisionId===currentArtwork)-Number(a.art.revisionId===currentArtwork));
          for(const {art,visible,distance,focused,want} of sorted){
            if(!visible&&!focused&&distance>12){
              const since=awaySince.get(art.revisionId)??now;awaySince.set(art.revisionId,since);
              if(now-since>=5000){
                const key=pending.get(art.revisionId);if(key){scheduler.cancel(key);pending.delete(art.revisionId);}
                desired.delete(art.revisionId);
                const old=objects.get(art.revisionId);if(old){
                  for(const p of ordered.filter(p=>p.artworkRevisionId===art.revisionId)){const group=placements.get(p.id.toLowerCase());if(group){group.clear();for(const bound of placeholders.get(p.id.toLowerCase())??[])group.add(bound);}}
                  objects.delete(art.revisionId);const id=active.get(art.revisionId);active.delete(art.revisionId);requested.delete(art.revisionId);xrArtworks.delete(art.revisionId);xrCallbacks.current.onXrArtworks?.([...xrArtworks.values()]);destroy(old);if(id)byteCache.delete(id);shadowPass.invalidate();render();
                }
                continue;
              }
            }else awaySince.delete(art.revisionId);
            const isCurrent=art.revisionId===currentArtwork,neighbor=preparing.has(art.revisionId);
            const wantFull=isCurrent&&want;
            if((retryAfter.get(art.revisionId)??0)>now)continue;
            if(isCurrent)request(art,wantFull);
            else if(reclaiming.has(art.revisionId)){
              if(active.has(art.revisionId))request(art,false);
            }
            else if(neighbor){
              if(visible&&!active.has(art.revisionId))request(art,false);
              else request(art,true,true);
            }
            else if(requested.has(art.revisionId)||visible)request(art,false);

          }
        };
        const statsTimer = setInterval(()=>{automaticDemand();update();}, 200);
        const originalRelease = release;
        release = () => {
          clearInterval(statsTimer);
          scheduler.dispose();
          originalRelease();
          for (const object of objects.values()) destroy(object);
          for(const value of prepared.values())destroy(value.object);
          prepared.clear();
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
          shadowPass.invalidate();
          render();
        } catch {
          unavailable++;
        }
        if (!disposed) {
          setAssetReport({loaded:rendered,failed:unavailable});
          if (publicSource) setPublicMessage(unavailable ? "일부 작품을 불러오지 못했어요. 다시 시도하거나 작품 목록을 이용해 주세요." : "공간에서 관람할 수 있어요.");
          setMessage(
            `공간 ${document.rooms.length} · 표면 ${document.surfaces.length} · 실제 개구부 ${document.openings.length} · 승인된 작품 derivative ${rendered}개 · bytes 사용 불가 ${unavailable}개 (점선은 실제 치수 metadata bounds).`,
          );
        }
      }
    };
    void build().catch((error) => {
      if (!disposed) setPublicMessage(error instanceof Error && error.message === "PREVIEW_COMPLEXITY"
        ? "이 전시의 공간이 표시 한도를 넘었어요. 작품 목록에서 감상해 주세요."
        : "3D 화면을 표시하지 못했어요. 작품 목록을 이용하거나 ‘3D 다시 시작’을 눌러 주세요.");
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
      resizeAction.current = null;
      abort.abort();
      release();
    };
  }, [referenceTone,
    document,
    appearance,
    session,
    publicSource,
    viewerBudget,
    restart,
    transparentSpace,
    editingEnabled,
    immersive,
  ]);
  const ControlsFrame = immersive ? "details" : "div";
  return (
    <figure data-input-mode={inputMode} data-reduced-motion={walkSettings.reducedMotion} className={`geometry-preview${immersive ? " geometry-immersive" : ""}`} aria-hidden={suspendNavigation || undefined} inert={suspendNavigation || undefined}>
      {editing&&spaceTransparency===undefined&&<label><input type="checkbox" checked={transparentSpace} onChange={e=>setTransparentSpace(e.target.checked)}/>편집할 때 공간을 투명하게 보기 · 저장된 재질은 바뀌지 않아요</label>}
      {installationIssueCount>0&&<p role="status">받침대·프레임 {installationIssueCount}개를 표시하지 못했어요. 작품과 텍스트는 계속 볼 수 있어요.</p>}
      <div className="geometry-stage">
        <div className="geometry-render-host" ref={host} />
        {viewerBudget && walkingMode && (
          <WalkingTouch
            available={ready && !xrRunning && !suspendNavigation}
            paused={walkPaused}
            actions={walkingActions.current}
          />
        )}
      </div>
      <figcaption hidden={immersive && ready && assetReport.loaded===document.placements.length && assetReport.failed===0} role="status" data-testid={publicSource ? undefined : "geometry-render-state"}>{publicSource ? publicMessage : message}</figcaption>
      {((content:ReactNode)=>immersive&&controlsHost?createPortal(content,controlsHost):content)(<ControlsFrame className="geometry-controls">
      {immersive && <summary>공간 조작</summary>}
      {immersive && <label>조작 방식<select aria-label="조작 방식" value={inputMode} onChange={event=>setInputMode(event.target.value as typeof inputMode)}><option value="auto">기기에 맞게</option><option value="pointer">마우스·키보드</option><option value="touch">화면 버튼</option></select></label>}
      {publicSource && <details className="viewer-options"><summary>표시 상태 자세히</summary><p data-testid="geometry-render-state">{message}</p><p>{shadowMessage}</p></details>}
      <ViewControls className={publicSource ? "viewer-options" : undefined}>
      {publicSource && <summary>시점 조정</summary>}
      <div className="cms-actions">
        <button
          disabled={
            !ready || walkingMode || !presentationFor(document).startCamera
          }
          onClick={() => action.current?.("start")}
        >
          {publicSource ? "입구 시점 보기" : "시작 camera 보기"}
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
      </ViewControls>
      {viewerBudget && (
        <WalkingControls
          available={ready && !xrRunning && !walkLoading && !suspendNavigation}
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
        <details className="viewer-options"><summary>다른 관람 위치</summary>
        <section aria-label="검증된 viewpoint 순간 이동">
          <p>직접 선택한 위치의 바닥·몸 여유 공간을 검사하고 움직임 없이 이동합니다. 안전하지 않은 위치는 거부하며 정지 상태를 유지합니다.</p>
          {presentationFor(document).viewpoints.map(viewpoint=><button key={viewpoint.id} disabled={!ready||xrRunning||walkLoading||suspendNavigation} onClick={()=>walkingActions.current?.teleport?.(viewpoint.id)}>안전한 viewpoint로 이동 {viewpoint.name}</button>)}
        </section></details>
      )}
      {viewerBudget && (
        <div className="cms-actions">
          <button disabled={!ready} onClick={() => demand.current?.("next")}>
            다음 작품 불러오기
          </button>
          <details className="viewer-options"><summary>작품 불러오기 설정</summary>
          <button disabled={!ready} onClick={() => demand.current?.("auto")}>화면에 맞춰 자동 조절</button>
          <button disabled={!ready} onClick={() => demand.current?.("coarse")}>
            불러온 작품 입구 품질
          </button>
          <button disabled={!ready} onClick={() => demand.current?.("full")}>
            불러온 작품 상세 품질
          </button>
          <button disabled={!ready} onClick={() => demand.current?.("cancel")}>
            작품 불러오기 취소
          </button>
          </details>
          <button disabled={!ready} onClick={() => demand.current?.("retry")}>
            실패한 작품 다시 시도
          </button>
          <button onClick={() => setRestart((n) => n + 1)}>3D 다시 시작</button>
        </div>
      )}
      {publicSource ? <details className="viewer-options"><summary>이동 도움말과 화면 표현</summary><p>걷기를 시작하지 않아도 작품을 선택하거나 목록에서 감상할 수 있어요. 표시된 시점으로 이동할 때는 이동 가능한 공간을 확인합니다. 소리는 직접 켤 때만 재생돼요.</p><p>저장된 조명은 화면에서 비슷하게 표현하며 실제 밝기 측정값은 아닙니다. 마우스 없이 위 버튼으로도 시점을 바꿀 수 있어요.</p></details> : <p className="cms-note">사각형 표면과 실제 사각 개구부의 편집 미리보기입니다. 분할 곡선벽·계단·경사로를 동일한 평면으로 렌더링합니다. 실제 보행 가능성은 공개 Viewer에서 검사하세요. 저장된 조명은 시각적 근사이며 물리적 조도 측정을 지원하지 않습니다. 마우스 없이 위 버튼으로 시점을 바꿀 수 있습니다.</p>}
      </ControlsFrame>)}
    </figure>
  );
}
