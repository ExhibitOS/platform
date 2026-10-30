import "./viewer/input-surface.css";
import type {ViewingRenderer,ViewingStyle} from './viewer/viewing-session';
import {createSculptureOrbit,type SculptureOrbitState} from './viewer/sculpture-orbit';
import {SculptureOrbitControls} from './viewer/SculptureOrbitControls';
import {floorTexturePlan,createFloorTextureRenderer,floorUvs} from './floor-texture-renderer';
import type {MapTravelBridge} from './viewer/map-travel';
import {retainMapMinimum} from './viewer/map-minimum';
import {surfaceTexturePlan,createSurfaceTextureRenderer} from './surface-texture-renderer';
import {materialPhaseBytes} from './material-texture-plan';
import {WatermarkOverlay} from './WatermarkOverlay';
import {borrowedDetailPreview,createFlatDetailRetry,type SharedDetailPreview} from './viewer/borrowed-detail-preview';
import {surfaceTextureFor,materialFor} from '@exhibitos/studio-contract';
import {floorFor,floorMaterial,validateStudioFloors,MATERIAL_NAMESPACE,type StudioMaterials} from '@exhibitos/studio-contract';
import {surfacePanels as panels,wallFinishesFor} from '@exhibitos/studio-contract';
import {installArchitecturalFinishes} from './architectural-finishes-renderer';
import {installPlaques,plaqueTextureReserve} from './plaque-renderer';
import {createMapThumbnailRoster,mapThumbnailRosterReserve} from './viewer/map-thumbnail';
import {publicThumbnailReserve,type createPublicThumbnailCache} from './viewer/public-thumbnail';
import {artworkThumbnailFor} from '@exhibitos/studio-contract';
import {installBoundedShadows,SHADOW_RESERVE_BYTES} from './viewer/shadows';
import {createPortal} from 'react-dom';
import {visitingFov,visitingBuffer} from './viewer/framing';
import {installPanelResume} from './viewer/panel-resume';
import {DEFAULT_REFERENCE_TONE,applyReferenceOutput,installReferenceEnvironment,environmentEstimate,type ReferenceTone} from './viewer/render-quality';
import type {EditorBridge,EditorSelection} from './geometry/direct-edit';
import {selectionKey} from './geometry/direct-edit';
import {floorInteriorView} from './geometry/floor-view';
import {installPreviewEditing} from './geometry/preview-editing';
import type {PlacementPreviewInstaller} from './geometry/placement-preview';
import {installLightDetails} from './light-details-renderer';
import {installBenches} from './bench-renderer';
import {benchesFor} from '@exhibitos/studio-contract';
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
  AssetScheduler, minimumDetailPending, minimumRoomInterest, minimumFootprintVisible,
  MemoryAssetCache,
  fetchVerifiedAsset,
  checkImageDecode,
  prioritizePlacements,
  selectAssetVariant, detailScreenBounds, detailDemand, DetailTransition, ArtworkAttention, artworkDemandContext, nearbyPreparation, displayedDetailReclamation, settleAssetGeneration, authoredImagePair, imageFullDecodeCeiling, AssetPeakBudget, retainEncodedBuffer, assetDecodeReserve, textureResidentBytes, geometryResidentBytes,
  type DeviceBudget,
} from "./viewer/loading";
import { validateArchitecture, spaceLightingFor, daylightFor, daylightDirection, presentationFor, lodVariantsFor, artifactCorners } from "@exhibitos/studio-contract";
import {
  WalkingControls,
  WalkingTouch,
  type WalkingActions,
  type WalkingSettings,
} from "./WalkingControls";
import { viewpointPose } from "./viewer/navigation-teleport";
import type { ViewerInputMode } from "./ViewerInputGuide";
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
  mountPreview?:SharedDetailPreview;
  resumeViewing?: () => void;
}
export type GeometrySelection=EditorSelection;
export interface EntranceSceneScope {enter(signal:AbortSignal):Promise<void>;cancelEntry():void;close():void}
export interface EntranceScenePreview {begin():EntranceSceneScope}

export function GeometryPreview({
  document,
  selection,
  editing,
  appearance,
  session,
  publicSource,
  viewerBudget,
  resourceBudget,
  suspendNavigation = false,
  onNavigationState,
  onCameraPose,
  onMapReady,
  onMapPose,
  onNavigationMode,
  onArtworkSelect,
  onPlaqueSelect,
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
  onEntranceSceneReady,
  cameraRequest,
  onSelectionFindReady,
  placementPreview,
  placementPreviewVersion,
  spaceTransparency,
  fillHost = false,
  compactControls = false,
  referenceTone = DEFAULT_REFERENCE_TONE,
  immersive = false,
  controlsHost,
  viewFov,
  inputMode = "auto",
  onInputModeChange,
  onViewingReady,
  mapThumbnailsEnabled,
  thumbnailCache,
  suppliedThumbnails,
  onMapThumbnail,
}: {
  mapThumbnailsEnabled?:boolean;
  thumbnailCache?:ReturnType<typeof createPublicThumbnailCache>|null;
  suppliedThumbnails?:Readonly<Record<string,string>>;
  onMapThumbnail?:(value:{revisionSha256:string;items:ReadonlyArray<{placementId:string;thumbnail:string}>}|null)=>void;
  onViewingReady?:(renderer:ViewingRenderer|null)=>void;
  inputMode?: ViewerInputMode;
  onInputModeChange?: (mode: ViewerInputMode) => void;
  immersive?: boolean;
  controlsHost?: HTMLElement|null;
  viewFov?: number;
  onSelectionFindReady?: (action:((id:string)=>boolean)|null)=>void;
  onEntranceSceneReady?:(preview:EntranceScenePreview|null)=>void;
  placementPreview?: PlacementPreviewInstaller;
  placementPreviewVersion?: number;
  cameraRequest?: {kind:"isometric"|"top"|"front"|"left"|"right"|"ceiling";sequence:number};
  spaceTransparency?: boolean;
  fillHost?: boolean;
  compactControls?: boolean;
  onRenderState?: (state:{ready:boolean;message:string;loaded:number;failed:number;navigationReady:boolean;navigationFailed:boolean})=>void;
  referenceTone?: ReferenceTone;
  onXrReady?: (bridge:GeometryXrBridge|null)=>void;
  onXrArtworks?: (artworks:GeometryXrArtwork[])=>void;
  document: Document;
  editing?:EditorBridge;
  viewerBudget?: DeviceBudget;
  /** Editor host resource accounting; does not enable visitor navigation. */
  resourceBudget?: Pick<DeviceBudget,'maxCacheBytes'|'maxTransitionBytes'|'maxTextureSize'>;
  suspendNavigation?: boolean;
  onNavigationState?: (state: NavigationState) => void;
  onCameraPose?: (position: [number,number,number],yaw: number) => void;
  onMapReady?: (bridge:MapTravelBridge|null) => void;
  onMapPose?: (position:[number,number,number],yaw:number,horizontalFovDegrees:number) => void;
  onNavigationMode?: (walking: boolean, paused: boolean) => void;
  onArtworkSelect?: (id: string) => void;
  onPlaqueSelect?: (id:string)=>void;
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
    floorFetcher?: typeof fetch;
    retainedMaterialBytes?:number;
    check?: () => Promise<void>;
  };
  selection: GeometrySelection | null;
  appearance: (surfaceId: string) => SurfaceAppearance;
}) {
  const editingEnabled=!!editing;
  const viewFovRef=useRef(viewFov);viewFovRef.current=viewFov;
  const resizeAction=useRef<(()=>void)|null>(null);
  useEffect(()=>{resizeAction.current?.();},[viewFov]);
  const [localTransparentSpace,setTransparentSpace]=useState(false);
  const transparentSpace=spaceTransparency??localTransparentSpace;
  const consumedCameraRequest=useRef<number|undefined>(undefined);
  const [installationIssueCount,setInstallationIssueCount]=useState(0);
  const [materialIssueCount,setMaterialIssueCount]=useState(0);
  const editorCamera=useRef<{documentId:string;position:[number,number,number];quaternion:[number,number,number,number];target:[number,number,number]}|null>(null);
  const selectionRef=useRef(selection);selectionRef.current=selection;
  const editingRef=useRef(editing);editingRef.current=editing;
  const entranceSceneCallback=useRef(onEntranceSceneReady);entranceSceneCallback.current=onEntranceSceneReady;
  const entranceScope=useRef<EntranceSceneScope|null>(null),[entranceWalking,setEntranceWalking]=useState(false);
  const editingSync=useRef<(()=>void)|null>(null);
  const placementInstaller=useRef(placementPreview);placementInstaller.current=placementPreview;
  const placementSync=useRef<(()=>void)|null>(null);
  useEffect(()=>{placementSync.current?.();},[placementPreviewVersion]);
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
  const selectionFindAction=useRef<{document:typeof document;find:(id:string)=>boolean}|null>(null),selectionFindDocument=useRef(document);selectionFindDocument.current=document;
  useEffect(()=>{onSelectionFindReady?.(id=>selectionFindAction.current?.document===selectionFindDocument.current?selectionFindAction.current.find(id):false);return()=>onSelectionFindReady?.(null);},[onSelectionFindReady]);
  const navigationCallbacks = useRef({ onNavigationState, onCameraPose, onNavigationMode, onArtworkSelect, onPlaqueSelect, proximityDetail, onScriptSceneReady, onScriptPose, onScriptClick, onPresenceSceneReady, onPresencePose });
  navigationCallbacks.current = { onNavigationState, onCameraPose, onNavigationMode, onArtworkSelect, onPlaqueSelect, proximityDetail, onScriptSceneReady, onScriptPose, onScriptClick, onPresenceSceneReady, onPresencePose };
  const mapCallbacks=useRef({onMapReady,onMapPose,onMapThumbnail});mapCallbacks.current={onMapReady,onMapPose,onMapThumbnail};
  const mapThumbnailEnabled=useRef(mapThumbnailsEnabled);mapThumbnailEnabled.current=mapThumbnailsEnabled;
  const suppliedThumbnailRef=useRef(suppliedThumbnails);suppliedThumbnailRef.current=suppliedThumbnails;
  const publicThumbnailCacheRef=useRef(thumbnailCache);publicThumbnailCacheRef.current=thumbnailCache;
  const mapThumbnailRefresh=useRef<(()=>void)|null>(null);
  useEffect(()=>{mapThumbnailRefresh.current?.();},[mapThumbnailsEnabled,suppliedThumbnails]);
  const focusedPlacement = useRef(focusedPlacementId);focusedPlacement.current=focusedPlacementId;
  const suspendedRef = useRef(suspendNavigation);
  suspendedRef.current = suspendNavigation;
  const suspendedWasWalking = useRef(false);
  const orbitEnabled = useRef<((enabled: boolean) => void) | null>(null);
  const seatedBenchRef=useRef<string|null>(null);
  const benchReturnButton=useRef<HTMLButtonElement|null>(null);
  const [seatedBenchId,setSeatedBenchId]=useState<string|null>(null);
  useEffect(()=>{if(seatedBenchId)benchReturnButton.current?.focus({preventScroll:true});},[seatedBenchId]);
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
  const [panelResumeAvailable,setPanelResumeAvailable]=useState(false);
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
  const sculptureOrbitRuntime=useRef<ReturnType<typeof createSculptureOrbit>|null>(null);
  const [sculptureOrbitState,setSculptureOrbitState]=useState<SculptureOrbitState>();
  useEffect(()=>{sculptureOrbitRuntime.current?.refresh();},[walkSettings.reducedMotion]);
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
  const viewingCallback=useRef(onViewingReady);viewingCallback.current=onViewingReady;
  const viewingStyleRef=useRef<ViewingStyle>('free');
  const [viewingStyle,setViewingStyle]=useState<ViewingStyle>('free');
  const enteredWalking=useRef(false);
  useEffect(()=>{if(immersive&&ready&&(assetReport.loaded>0||document.placements.length===0)&&!suspendNavigation&&!enteredWalking.current&&walkingActions.current){enteredWalking.current=true;walkingActions.current.start();}},[immersive,ready,assetReport.loaded,document.placements.length,suspendNavigation,walkPreparation]);
  useEffect(()=>{if(cameraRequest&&ready&&action.current&&consumedCameraRequest.current!==cameraRequest.sequence){consumedCameraRequest.current=cameraRequest.sequence;action.current(cameraRequest.kind);}},[cameraRequest?.sequence,cameraRequest?.kind,ready]);
  const nativeReport=useRef(onRenderState);nativeReport.current=onRenderState;
  useEffect(()=>{nativeReport.current?.({ready,message:publicSource?publicMessage:message,...assetReport,navigationReady:!immersive&&!entranceWalking||(walkPreparation==='ready'&&walkingMode),navigationFailed:(immersive||entranceWalking)&&walkPreparation==='failed'});},[ready,message,publicMessage,publicSource,assetReport,immersive,entranceWalking,walkPreparation,walkingMode]);
  useEffect(()=>{if(openingViewpoint&&ready&&!xrRunning&&!suspendNavigation&&!walkLoading&&openingConsumed.current!==openingViewpoint.sequence&&walkingActions.current?.teleport){openingConsumed.current=openingViewpoint.sequence;walkingActions.current.teleport(openingViewpoint.viewpointId);}},[openingViewpoint,ready,suspendNavigation,walkLoading]);
  useEffect(()=>{if(guideRequest && ready && !suspendNavigation && !walkLoading && guideAction.current && consumedGuide.current!==guideRequest.sequence){consumedGuide.current=guideRequest.sequence;guideAction.current(guideRequest.routeId,guideRequest.index);}},[guideRequest,ready,suspendNavigation,walkLoading]);
  useEffect(() => {
    if (suspendNavigation) {
      sculptureOrbitRuntime.current?.actions.stop();
      suspendedWasWalking.current = committedEntry.current ?? (currentWalkMode.current.walking && !currentWalkMode.current.paused);
      committedEntry.current = null;
      preparedEntry.current = null;
      walkingActions.current?.pause("panel");
      orbitEnabled.current?.(false);
    } else {
      orbitEnabled.current?.(!currentWalkMode.current.walking);
      // Active walking returns focus to its canvas; focusing the opener would
      // trigger the input blur safety stop immediately after resuming.
      // Paused/stationary modes leave focus restoration to the detail dialog.
      // Closing the obstruction does not create a new user stop. Its explicit
      // return action may resume through the same gate after this commit.
      suspendedWasWalking.current = false;
    }
  }, [suspendNavigation]);
  useEffect(() => {
    const abort = new AbortController();
    sculptureOrbitRuntime.current?.dispose();sculptureOrbitRuntime.current=null;setSculptureOrbitState(undefined);
    viewingStyleRef.current='free';setViewingStyle('free');viewingCallback.current?.(null);
    let gpuLost = false;
    let disposed = false,
      release = () => {};
    let walkingRelease = () => {};
    let placementRelease = () => {};
    let nearPlacement: string | undefined;
    let sharedDetail:ReturnType<typeof borrowedDetailPreview>|undefined;
    let sharedDetailUnavailable:((reason:'rights'|'graphics')=>void)|undefined;
    let cancelSharedDetail=()=>{};
    walkingActions.current = null;
    seatedBenchRef.current=null;setSeatedBenchId(null);
    xrActive.current=false;setXrRunning(false);
    setWalkingMode(false);
    setWalkPaused(true);
    setPanelResumeAvailable(false);
    setWalkLoading(false);
    setWalkPreparation('pending');
    setReady(false);
    setAssetReport({loaded:0,failed:0});
    setMessage("공간 미리보기를 준비합니다.");
    setMaterialIssueCount(0);
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
      if(!validateStudioFloors(document).valid||!validateArchitecture(document).valid)throw Error("PREVIEW_COMPLEXITY");
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
      const resources=viewerBudget??resourceBudget;
      const compactQuality=(resources?.maxTextureSize??2048)<=512;
      const environmentReserve=environmentEstimate(compactQuality?64:128).generationPeakBytes;
      const shadowReserve=compactQuality?0:SHADOW_RESERVE_BYTES;
      const plaqueReserve=plaqueTextureReserve(document,compactQuality);
      const mapImageIds=document.placements.filter(p=>document.artworks.some(a=>a.revisionId.toLowerCase()===p.artworkRevisionId.toLowerCase()&&a.artworkType==='image')).map(p=>p.id);
      const mapThumbnailReserve=viewerBudget&&onMapThumbnail?mapThumbnailRosterReserve(mapImageIds.length):0;
      const publicThumbnailCount=document.artworks.filter(a=>artworkThumbnailFor(a)).length;
      const suppliedThumbnailReserve=viewerBudget&&publicThumbnailCount?publicThumbnailReserve(publicThumbnailCount):0;
      const retainedMaterialBytes=publicSource?.retainedMaterialBytes??0;
      if(!Number.isSafeInteger(retainedMaterialBytes)||retainedMaterialBytes<0)throw Error('MATERIAL_SOURCE_BUDGET');
      const availableAssetBytes=Math.max(1,(resources?.maxCacheBytes??33554432)-environmentReserve-shadowReserve-plaqueReserve-mapThumbnailReserve-suppliedThumbnailReserve-retainedMaterialBytes);
      const floorPlan=floorTexturePlan(document,resources?.maxTextureSize??2048,availableAssetBytes);
      const floorTextures=createFloorTextureRenderer(three,floorPlan,abort.signal,()=>disposed||gpuLost,publicSource?.floorFetcher);
      const surfacePlan=surfaceTexturePlan(document,resources?.maxTextureSize??2048,Math.max(0,availableAssetBytes-floorPlan.reserveBytes));
      const surfaceTextures=createSurfaceTextureRenderer(three,surfacePlan,abort.signal,()=>disposed||gpuLost,publicSource?.floorFetcher);
      let assetBudgetBytes=Math.max(1,availableAssetBytes-floorPlan.reserveBytes-surfacePlan.reserveBytes);
      let transitionBudgetBytes=Math.max(assetBudgetBytes,(resources?.maxTransitionBytes??resources?.maxCacheBytes??33554432)-environmentReserve-shadowReserve-plaqueReserve-mapThumbnailReserve-suppliedThumbnailReserve-retainedMaterialBytes-floorPlan.reserveBytes-surfacePlan.reserveBytes);
      let floorSettled=false,surfaceSettled=false,growAssetLimits=()=>{};
      const releaseMaterialLoadHold=(kind:'floor'|'surface')=>{
        if(disposed||gpuLost)return;
        if(kind==='floor')floorSettled=true;else surfaceSettled=true;
        const materialBytes=materialPhaseBytes(floorPlan,floorSettled)+materialPhaseBytes(surfacePlan,surfaceSettled);
        assetBudgetBytes=Math.max(1,availableAssetBytes-materialBytes);
        transitionBudgetBytes=Math.max(assetBudgetBytes,(resources?.maxTransitionBytes??resources?.maxCacheBytes??33554432)-environmentReserve-shadowReserve-plaqueReserve-mapThumbnailReserve-suppliedThumbnailReserve-retainedMaterialBytes-materialBytes);
        renderer.domElement.dataset.materialBudget=JSON.stringify({phase:floorSettled&&surfaceSettled?'resident':'loading',materialBytes,retainedMaterialBytes,mapThumbnailReserve,suppliedThumbnailReserve,assetBudgetBytes,transitionBudgetBytes});
        const quality=renderer.domElement.dataset.renderQuality;
        if(quality)renderer.domElement.dataset.renderQuality=JSON.stringify({...JSON.parse(quality),assetBudgetBytes});
        growAssetLimits();
      };
      const scene = new three.Scene();
      scene.background = new three.Color("#e9e9e1");
      const model = new three.Group(),
        owned: Array<{ dispose: () => void }> = [];
      scene.add(model);owned.push(floorTextures,surfaceTextures);
      const spaceLighting=spaceLightingFor(document);
      const hemisphere = new three.HemisphereLight(
          0xffffff,
          0x71806a,
          spaceLighting?.baselineIntensity ?? (document.lights.length ? 0.4 : 2.5),
        );
      scene.add(hemisphere);
      const sun = new three.DirectionalLight(
        0xffffff,
        spaceLighting || document.lights.length ? 0 : 3,
      );
      const daylight=daylightFor(document);
      if(daylight){const direction=daylightDirection(daylight);sun.position.fromArray(direction.map(n=>n*100) as [number,number,number]);sun.intensity=daylight.enabled&&direction[1]>0?daylight.intensity:0;}else sun.position.set(20, 30, 25);
      renderer.domElement.dataset.daylight=JSON.stringify(daylight?{...daylight,direction:daylightDirection(daylight),effectiveIntensity:sun.intensity}:null);
      const reportSpaceLighting=()=>{renderer.domElement.dataset.spaceLighting=JSON.stringify({settings:spaceLighting??null,baselineIntensity:hemisphere.intensity,reflectionIntensity:scene.environment?scene.environmentIntensity:0,environmentReady:!!scene.environment,solarIntensity:sun.intensity});};
      reportSpaceLighting();
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
      const legacyMaterials=(document.extensions?.[MATERIAL_NAMESPACE] as StudioMaterials|undefined)?.surfaces;
      const floorAppearance=(binding:Parameters<typeof floorMaterial>[0],surfaceId?:string)=>{
        const legacy=surfaceId?Object.entries(legacyMaterials??{}).find(([id])=>id.toLowerCase()===surfaceId.toLowerCase())?.[1]:undefined;
        const value=floorMaterial(binding,legacy);return {color:new three.Color(value.color),roughness:value.roughness,metalness:value.metalness};
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
        const binding=floorFor(document,{roomId:room.id});
        if(binding){
          const geometry=new three.PlaneGeometry(room.dimensions.width,room.dimensions.depth),floorMaterial=new three.MeshStandardMaterial({...floorAppearance(binding),side:three.DoubleSide,transparent:!!editingRef.current&&transparentSpace,opacity:editingRef.current&&transparentSpace ? .32:1,depthWrite:!editingRef.current||!transparentSpace});
          const floor=new three.Mesh(geometry,floorMaterial);floor.rotation.x=-Math.PI/2;floor.userData.editorSelection={kind:'room',id:room.id};group.add(floor);
          floorUvs(three,geometry,floor,binding);floorTextures.add(floorMaterial,binding);owned.push(geometry,floorMaterial);
        }
      }
      const styledWalls=new Set(wallFinishesFor(document).map(w=>w.surfaceId.toLowerCase())),surfaceMaterials=new Map<string,InstanceType<typeof three.MeshStandardMaterial>>();
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
        const floorBinding=surface.type==='floor'?floorFor(document,{roomId:surface.roomId,surfaceId:surface.id}):undefined;
        if(floorBinding){const looks=floorAppearance(floorBinding,surface.id);material.color.copy(looks.color);material.roughness=looks.roughness;material.metalness=looks.metalness;floorTextures.add(material,floorBinding);}
        const surfaceBinding=surfaceTextureFor(document,surface.id);
        if(surfaceBinding){const looks=materialFor(document,surface.id);material.color.set(looks.color);material.roughness=looks.roughness;material.metalness=looks.metalness;surfaceTextures.add(material,surfaceBinding);}
        owned.push(material);surfaceMaterials.set(surface.id.toLowerCase(),material);
        if(styledWalls.has(surface.id.toLowerCase()))return;
        for (const rectangle of rectangles[index]!) {
          const geometry = new three.PlaneGeometry(
              rectangle.width,
              rectangle.height,
            ),
            mesh = new three.Mesh(geometry, material);
          if(floorBinding)floorUvs(three,geometry,group,floorBinding,rectangle);
          if(surfaceBinding)floorUvs(three,geometry,group,surfaceBinding,rectangle);
          mesh.position.set(rectangle.x, rectangle.y, 0);
          group.add(mesh);
          owned.push(geometry);
        }

      });
      const architecturalFinishes=installArchitecturalFinishes(three,document,surfaces,surfaceMaterials);owned.push(architecturalFinishes);
      if(architecturalFinishes.records.length)renderer.domElement.dataset.architecturalFinishes=JSON.stringify(architecturalFinishes.records);
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
      const plaques=installPlaques(three,document,rooms,compactQuality);owned.push(plaques);
      const benches=installBenches(three,document,rooms);owned.push(benches);
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
      const lightDetails=installLightDetails(three,document,rooms,scriptLights,editingEnabled);owned.push(lightDetails);
      if(lightDetails.records.length)renderer.domElement.dataset.lightDetails=JSON.stringify(lightDetails.records);
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
      let resumeFrame = 0;
      const down = (event: PointerEvent) => { pointerStart=event.isPrimary === false ? undefined : [event.clientX,event.clientY]; };
      const cancelPick = () => { pointerStart=undefined; };
      const multiPointerPick = (event: PointerEvent) => { if(event.isPrimary===false)cancelPick(); };
      renderer.domElement.ownerDocument.addEventListener("pointerdown",multiPointerPick,true);
      const canvasMenu = (event: MouseEvent) => { if (immersive) event.preventDefault(); };
      renderer.domElement.addEventListener("contextmenu",canvasMenu);
      const movePick = (event: PointerEvent) => {
        for (const sample of event.getCoalescedEvents?.() ?? [event]) {
          if (pointerStart && Math.hypot(sample.clientX-pointerStart[0],sample.clientY-pointerStart[1])>5) cancelPick();
        }
      };
      renderer.domElement.addEventListener("pointermove",movePick);
      renderer.domElement.addEventListener("pointercancel",cancelPick);
      renderer.domElement.addEventListener("pointerdown",down);
      const pick = (event: MouseEvent) => {
        if(!pointerStart || Math.hypot(event.clientX-pointerStart[0],event.clientY-pointerStart[1])>5)return;
        if (xrActive.current || suspendedRef.current || (!panelResume && !navigationCallbacks.current.onArtworkSelect && !navigationCallbacks.current.onPlaqueSelect && !navigationCallbacks.current.onScriptClick)) return;
        const box = renderer.domElement.getBoundingClientRect(), ray = new three.Raycaster();
        ray.setFromCamera(globalThis.document.pointerLockElement===renderer.domElement?new three.Vector2(0,0):new three.Vector2((event.clientX-box.left)/box.width*2-1,-(event.clientY-box.top)/box.height*2+1), camera);
        const hit=ray.intersectObject(model,true)[0];
        let object=hit?.object;
        while(object) { if(typeof object.userData.plaqueId === "string") {if(navigationCallbacks.current.onPlaqueSelect){detailEntry.current.prepare();detailEntry.current.commit(true);navigationCallbacks.current.onPlaqueSelect(object.userData.plaqueId);}return;} if(typeof object.userData.placementId === "string") { navigationCallbacks.current.onScriptClick?.(object.userData.placementId); if(navigationCallbacks.current.onArtworkSelect){detailEntry.current.prepare(); detailEntry.current.commit(true); navigationCallbacks.current.onArtworkSelect(object.userData.placementId);} return; } object=object.parent ?? undefined; }
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
        if(sharedDetail){if(!disposed&&!gpuLost)sharedDetail.render();return;}
        const canvas=renderer.domElement, stamp=`${authoredFov}/${camera.fov}/${camera.aspect}/${canvas.width}/${canvas.height}`;
        if(stamp!==projectionStamp){projectionStamp=stamp;canvas.dataset.cameraProjection=JSON.stringify({width:canvas.clientWidth,height:canvas.clientHeight,aspect:camera.aspect,authoredVerticalFov:authoredFov,verticalFov:camera.fov,horizontalFov:2*Math.atan(Math.tan(camera.fov*Math.PI/360)*camera.aspect)*180/Math.PI,bufferWidth:canvas.width,bufferHeight:canvas.height,pixelBudget:framePixelBudget});}
        if (!disposed && !gpuLost && !xrActive.current) {
          const at = performance.now();
          camera.updateMatrixWorld();plaques.update(camera);if(plaques.meshes.length)renderer.domElement.dataset.plaques=JSON.stringify(plaques.stats());
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
        if(xrActive.current||seatedBenchRef.current)return;
        const selectedFloorId=kind==='front'&&selectionRef.current?.kind==='surface'?document.surfaces.find(s=>s.type==='floor'&&s.id.toLowerCase()===selectionRef.current!.id.toLowerCase())?.id:undefined;
        const floorView=selectedFloorId?floorInteriorView(document,selectedFloorId):undefined;
        if(selectedFloorId&&!floorView){setMessage('이 바닥을 공간 안에서 볼 수 있는 위치를 찾지 못했습니다. 현재 시점을 유지합니다.');return;}
        delete renderer.domElement.dataset.floorView;
        camera.near=extent/1000;camera.far=extent*100;camera.updateProjectionMatrix();
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
        } else if(kind==='ceiling'){
          const selection=selectionRef.current,roomId=selection?.kind==='room'?selection.id:selection?.kind==='surface'?document.surfaces.find(s=>s.id===selection.id)?.roomId:undefined;
          const room=document.rooms.find(r=>r.id===roomId)??document.rooms[0],owner=room&&rooms.get(room.id.toLowerCase());
          if(room&&owner){camera.position.copy(owner.localToWorld(new three.Vector3(0,Math.min(1.65,room.dimensions.height*.5),room.dimensions.depth*.3)));controls.target.copy(owner.localToWorld(new three.Vector3(0,room.dimensions.height-.01,0)));camera.near=.01;authoredFov=60;applyProjection();}
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
          if(floorView){
            camera.position.fromArray(floorView.position);controls.target.fromArray(floorView.target);camera.up.fromArray(floorView.up);
            camera.near=Math.min(camera.near,floorView.near);camera.updateProjectionMatrix();
            renderer.domElement.dataset.floorView=JSON.stringify({surfaceId:selectedFloorId,...floorView});
          } else if (selected) {
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
        if(sharedDetail){sharedDetail.render();return;}
        if (!host.current) return;
        const width = Math.max(host.current.clientWidth, 1),
          height = immersive || fillHost ? Math.max(host.current.clientHeight, 1) : 360;
        const preferredRatio = Math.min(devicePixelRatio, viewerBudget?.maxPixelRatio ?? 2);
        // Desktop gets a bounded full-HD buffer; compact keeps its former cost.
        const {pixelBudget,ratio} = visitingBuffer(width,height,preferredRatio,compactQuality);
        framePixelBudget = immersive || fillHost ? pixelBudget : undefined;
        renderer.setPixelRatio(immersive || fillHost ? ratio : preferredRatio);
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
        mapThumbnailRefresh.current?.();
        sculptureOrbitRuntime.current?.actions.stop();
        mapCallbacks.current.onMapReady?.(null);
        cancelSharedDetail();
        sharedDetailUnavailable?.('graphics');
        sharedDetail?.dispose();
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
      if (immersive) panelResume = installPanelResume(renderer.domElement, (reason = "panel") => walkingActions.current?.pause(reason), () => walkingActions.current?.start(), available => { if(!disposed)setPanelResumeAvailable(available); }, () => !disposed && !gpuLost && !suspendedRef.current && !xrActive.current&&viewingStyleRef.current==='free');
      detailEntry.current.resumeViewing = () => {
        const intent = panelResume?.intent();
        cancelAnimationFrame(resumeFrame);
        resumeFrame = requestAnimationFrame(() => { resumeFrame = 0; if (!disposed) intent?.(); });
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host.current);
      controls.addEventListener("change", render);
      guideAction.current=(routeId,index)=>{
        if(suspendedRef.current||xrActive.current||seatedBenchRef.current)return;
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
      selectionFindAction.current={document,find:id=>{
        if(xrActive.current||selectionRef.current?.kind!=='placement'||selectionRef.current.id!==id)return false;
        const selected=placements.get(id.toLowerCase());if(!selected)return false;
        const box=new three.Box3().setFromObject(selected,true);if(box.isEmpty())return false;
        const point=box.getCenter(new three.Vector3()),size=box.getSize(new three.Vector3()),extent=Math.max(...size.toArray());
        if(!point.toArray().concat(size.toArray()).every(Number.isFinite)||extent<1e-6||extent>10000)return false;
        const delta=camera.position.clone().sub(controls.target);if(delta.lengthSq()<1e-8)delta.set(1,.7,1);
        const distance=extent*2.1/Math.min(1,camera.aspect);camera.near=Math.max(extent/100,distance-extent*4);camera.far=distance+extent*4;camera.updateProjectionMatrix();
        camera.up.set(0,1,0);controls.target.copy(point);camera.position.copy(point).add(delta.normalize().multiplyScalar(distance));camera.lookAt(point);controls.update();render();return true;
      }};
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
        sharedDetail?.dispose();
        entranceScope.current?.close();entranceSceneCallback.current?.(null);
        if(editingEnabled)editorCamera.current={documentId:document.id,position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),target:controls.target.toArray()};
        xrCallbacks.current.onXrReady?.(null);xrCallbacks.current.onXrArtworks?.([]);renderer.setAnimationLoop(null);xrActive.current=false;xrArtworks.clear();
        placementRelease();placementSync.current=null;
        editor?.dispose();editingSync.current=null;
        walkingRelease();
        cancelAnimationFrame(resumeFrame);
        detailEntry.current.resumeViewing = undefined;
        panelResume?.dispose();
        orbitEnabled.current = null;
        renderer.domElement.removeEventListener("click",pick);
        renderer.domElement.removeEventListener("pointerdown",down);
        renderer.domElement.ownerDocument.removeEventListener("pointerdown",multiPointerPick,true);
        renderer.domElement.removeEventListener("pointermove",movePick);
        renderer.domElement.removeEventListener("pointercancel",cancelPick);
        renderer.domElement.removeEventListener("contextmenu",canvasMenu);
        walkingActions.current = null;
        action.current = null;selectionFindAction.current=null;
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
      void floorTextures.start(()=>{if(!disposed&&!gpuLost){shadowPass.invalidate();render();}}).then(status=>{if(!disposed&&!gpuLost)renderer.domElement.dataset.floorTextures=JSON.stringify({status,maxSize:floorPlan.maxSize,reserveBytes:floorPlan.reserveBytes,residentBytes:floorPlan.residentBytes});}).finally(()=>releaseMaterialLoadHold('floor'));
      void surfaceTextures.start(()=>{if(!disposed&&!gpuLost){shadowPass.invalidate();render();}}).then(status=>{if(!disposed&&!gpuLost){renderer.domElement.dataset.surfaceTextures=JSON.stringify({status,reserveBytes:surfacePlan.reserveBytes,residentBytes:surfacePlan.residentBytes,geometryReserve:surfacePlan.geometryReserve});setMaterialIssueCount(Object.values(status).filter(value=>value!=='ready').length);}}).finally(()=>releaseMaterialLoadHold('surface'));
      // Async environment setup starts only AFTER scene teardown is registered.
      // Failed/cancelled generation keeps the existing lighting and text/navigation.
      void installReferenceEnvironment(three,renderer,scene,environmentReserve,compactQuality,()=>disposed||gpuLost).then(environment=>{
        if(!environment)return;
        if(disposed||gpuLost){environment.dispose();return;}
        owned.push(environment);scene.environmentIntensity=spaceLighting?.reflectionIntensity ?? .45;
        hemisphere.intensity=spaceLighting?.baselineIntensity ?? (document.lights.length ? .2 : .6);
        if(!spaceLighting&&!daylight&&!document.lights.length)sun.intensity=2;
        reportSpaceLighting();
        renderer.domElement.dataset.renderQuality=JSON.stringify({tone:referenceTone,exposure:1,environmentSize:environment.size,environmentReserveBytes:environmentReserve,shadowReserveBytes:shadowReserve,assetBudgetBytes});
        render();
      }).catch(()=>{if(!disposed)renderer.domElement.dataset.renderQuality=JSON.stringify({tone:referenceTone,exposure:1,environment:'unavailable',assetBudgetBytes});});
      orbitEnabled.current = (enabled) => { controls.enabled = enabled&&!xrActive.current&&!seatedBenchRef.current&&viewingStyleRef.current==='free'; };
      if (suspendedRef.current) controls.enabled = false;
      if (viewerBudget) {
        renderer.domElement.tabIndex = 0;
        renderer.domElement.setAttribute(
          "aria-describedby",
          "walking-instructions",
        );
        let initialization: Promise<void> | undefined;
        const initialize = async (teleportViewpointId?: string, preserveCurrent=false) => {
          if (disposed || xrActive.current) return;
          if (!initialization) {
            setWalkLoading(true);
            setWalkMessage(
              "걷기와 안전한 충돌을 준비합니다. 작품 목록은 계속 사용할 수 있습니다.",
            );
            let initialCamera: InstanceType<typeof three.PerspectiveCamera> | undefined;
            if(preserveCurrent)initialCamera=camera.clone();
            else if(teleportViewpointId) {
              try {
                const destination=viewpointPose(document,teleportViewpointId);
                initialCamera=camera.clone();
                initialCamera.position.fromArray(destination.position);
                initialCamera.lookAt(new three.Vector3(...destination.target));
              } catch {
                setWalkLoading(false);setWalkMessage("이 viewpoint의 참조나 시점 방향을 지원하지 않습니다. 기존 위치와 정지 관람을 유지합니다.");return;
              }
            } else view("start");
            if(!preserveCurrent)controls.enabled = false;
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
                // A dialog may focus before the suspension effect, and Safari can
                // report null relatedTarget. The existing committed entry still
                // identifies this temporary obstruction without erasing its base stop.
                isPanelFocus: target => committedEntry.current !== null || suspendedRef.current || !!panelResume?.isPanelFocus(target),
                resumeMovement: () => viewingStyleRef.current==='free'&&(panelResume?.movement(!gpuLost && !suspendedRef.current && !xrActive.current) ?? false),
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
                onSeat:id=>{if(!disposed){seatedBenchRef.current=id;setSeatedBenchId(id);}},
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
              walkingActions.current = { ...adapter.actions,
                  canResumeInput: () => viewingStyleRef.current==='free' && !gpuLost && !suspendedRef.current && !xrActive.current && !!panelResume?.canResume(),
                  resumeInput: () => viewingStyleRef.current==='free' && (panelResume?.movement(!gpuLost && !suspendedRef.current && !xrActive.current) ?? false),
                };
              setWalkPreparation('ready');
            })()
              .catch(() => {
                if (!disposed) {
                  setWalkPreparation('failed');
                  if(!preserveCurrent)controls.enabled = true;
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
          prepareViewpoint:async id=>{await initialize(undefined,true);return walkingActions.current!==pending?walkingActions.current?.prepareViewpoint?.(id):undefined;},
          visitViewpoint:(id,ordered)=>walkingActions.current!==pending?(walkingActions.current?.visitViewpoint?.(id,ordered)??false):false,
          orbitViewpoint:(id,yaw)=>walkingActions.current!==pending?(walkingActions.current?.orbitViewpoint?.(id,yaw)??false):false,
          freeViewing:()=>walkingActions.current!==pending?(walkingActions.current?.freeViewing?.()??false):false,
          sit: benchId => {void initialize().then(()=>{if(!disposed&&!xrActive.current&&!suspendedRef.current&&walkingActions.current!==pending)walkingActions.current?.sit?.(benchId);});},
          stand:()=>{},
          pause: () => {},
          stationary: () => {},
          reset: () => {},
          settings: () => {},
          press: () => {},
          move: () => {},
          release: () => {},
        };
        walkingActions.current = pending;
      }
      // A native preview borrows this exact scene/camera. It never changes the
      // renderer effect's document, budget, immersive or editing dependencies.
      if(entranceSceneCallback.current&&!viewerBudget){
        let preparing=false;
        const preview:EntranceScenePreview={begin:()=>{
          if(disposed||gpuLost||xrActive.current||entranceScope.current||preparing||currentWalkMode.current.walking)throw Error('ENTRANCE_SCENE_BUSY');
          const saved={position:camera.position.clone(),quaternion:camera.quaternion.clone(),up:camera.up.clone(),target:controls.target.clone(),fov:camera.fov,zoom:camera.zoom,near:camera.near,far:camera.far,enabled:controls.enabled,actions:walkingActions.current,tabIndex:renderer.domElement.getAttribute('tabindex'),focus:renderer.domElement.ownerDocument.activeElement};
          const abortPreview=new AbortController();let abortEntry=new AbortController(),adapter:{actions:WalkingActions;dispose:()=>void}|undefined,entered=false,closed=false;
          controls.enabled=false;
          const restore=(enabled:boolean)=>{
            camera.position.copy(saved.position);camera.quaternion.copy(saved.quaternion);camera.up.copy(saved.up);controls.target.copy(saved.target);camera.fov=saved.fov;camera.zoom=saved.zoom;camera.near=saved.near;camera.far=saved.far;camera.updateProjectionMatrix();controls.enabled=enabled;controls.update();if(!disposed&&!gpuLost)render();
          };
          const scope:EntranceSceneScope={
            enter:async externalSignal=>{
              if(entered||closed)throw Error('ENTRANCE_SCENE_STALE');if(preparing)throw Error('ENTRANCE_SCENE_BUSY');entered=true;
              const signal=AbortSignal.any([abortPreview.signal,abortEntry.signal,externalSignal]);signal.throwIfAborted();
              preparing=true;setEntranceWalking(true);setWalkPreparation('pending');setWalkLoading(true);view('start');controls.enabled=false;renderer.domElement.tabIndex=0;
              try{
                const {createWalkingCamera}=await import('./viewer/navigation-camera');signal.throwIfAborted();
                const created=await createWalkingCamera({document,camera,controls,canvas:renderer.domElement,settings:{...walkSettingsRef.current},render,
                  resumeMovement:()=>!closed&&!disposed&&!gpuLost&&!signal.aborted&&!suspendedRef.current,
                  onState:state=>{if(!closed&&!signal.aborted)navigationCallbacks.current.onNavigationState?.(state);},
                  onMode:(walking,paused)=>{if(!closed&&!signal.aborted){currentWalkMode.current={walking,paused};setWalkingMode(walking);setWalkPaused(paused);}},
                  onMessage:message=>{if(!closed&&!signal.aborted)setWalkMessage(message);},
                });
                if(closed||disposed||signal.aborted){created.dispose();signal.throwIfAborted();throw Error('ENTRANCE_SCENE_STALE');}
                adapter=created;walkingActions.current=created.actions;setWalkPreparation('ready');created.actions.start();
              }catch(error){if(!closed&&!signal.aborted)setWalkPreparation('failed');throw error;}
              finally{preparing=false;if(!closed)setWalkLoading(false);}
            },
            cancelEntry:()=>{
              if(closed)return;abortEntry.abort();abortEntry=new AbortController();adapter?.dispose();adapter=undefined;entered=false;walkingActions.current=saved.actions;
              currentWalkMode.current={walking:false,paused:true};setWalkingMode(false);setWalkPaused(true);setWalkLoading(false);setWalkPreparation('pending');setEntranceWalking(false);restore(false);
            },
            close:()=>{
              if(closed)return;closed=true;abortPreview.abort();adapter?.dispose();walkingActions.current=saved.actions;
              currentWalkMode.current={walking:false,paused:true};setWalkingMode(false);setWalkPaused(true);setWalkLoading(false);setWalkPreparation('pending');setEntranceWalking(false);
              if(entranceScope.current===scope)entranceScope.current=null;restore(saved.enabled);
              if(saved.tabIndex===null)renderer.domElement.removeAttribute('tabindex');else renderer.domElement.setAttribute('tabindex',saved.tabIndex);
              if(saved.focus instanceof HTMLElement&&saved.focus.isConnected&&saved.focus!==renderer.domElement.ownerDocument.body)saved.focus.focus({preventScroll:true});
            },
          };
          entranceScope.current=scope;return scope;
        }};
        entranceSceneCallback.current(preview);
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
          const current=await fetch(`/api/v1/publications/${publicSource.publicationId}?footsteps=1`,{credentials:'omit',cache:'no-store',signal});
          if(!current.ok||(await current.json()).publication.revisionSha256!==publicSource.revisionSha256)throw Error('PUBLIC_DERIVATIVE_UNAVAILABLE');
        }
        signal.throwIfAborted();
      };
      const stopPublicDisplay=()=>{
        sculptureOrbitRuntime.current?.dispose();sculptureOrbitRuntime.current=null;setSculptureOrbitState(undefined);
        sharedDetailUnavailable?.('rights');sharedDetail?.dispose();renderer.domElement.style.visibility='hidden';
        mapThumbnailRefresh.current?.();
        setReady(false);setPublicMessage('공개 상태를 확인할 수 없어 작품 표시를 중단했습니다. 작품 목록을 이용해 주세요.');
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
          const expectedRevision=Number.isSafeInteger(binding.revision)&&Number(binding.revision)>0?Number(binding.revision):artwork.revision;
          const base = `/api/v1/tenants/${session.tenantId}`;
          const meta = await fetch(
            `${base}/studio/artworks/${encodeURIComponent(binding.artworkId)}`,
            {
              credentials: "same-origin",
              cache: "no-store",
              signal,
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
            `${bridge.previewUrl}?expectedRevision=${expectedRevision}`,
            {
              credentials: "same-origin",
              cache: "no-store",
              signal,
            },
          );
          if (
            !response.ok ||
            response.headers.get("x-exhibitos-artwork-revision") !==
              String(expectedRevision)
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
          let retainedModelBytes=0;
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
            const material = new three.MeshStandardMaterial({
              map: texture,
              side: three.DoubleSide,
              roughness:1,metalness:0,
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
            // Pin an identical cached allocation; independently retained bytes
            // stay charged even when the original encoded entry is evicted.
            const backing=retainEncodedBuffer(byteCache,inventory.id,protectedBytes.bytes);
            resources.push(backing);retainedModelBytes=backing.retainedBytes;
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
            decodedBytes = retainedModelBytes;
          const geometryAttributes:Array<InstanceType<typeof three.BufferAttribute>|InstanceType<typeof three.InterleavedBufferAttribute>>=[],
            textures = new Set<InstanceType<typeof three.Texture>>();
          object.traverse((node) => {
            if (node instanceof three.Mesh) {
              triangles +=
                (node.geometry.index?.count ??
                  node.geometry.attributes.position?.count ??
                  0) / 3;
              geometryAttributes.push(...Object.values(node.geometry.attributes) as Array<InstanceType<typeof three.BufferAttribute>|InstanceType<typeof three.InterleavedBufferAttribute>>);
              if(node.geometry.index)geometryAttributes.push(node.geometry.index);
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
                    decodedBytes += textureResidentBytes(image?.width ?? 0,image?.height ?? 0);
                  }
            }
          });
          decodedBytes+=geometryResidentBytes(geometryAttributes);
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
            retainedModelBytes,
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
      if(!publicSource&&editingEnabled&&placementInstaller.current){
        const preview=placementInstaller.current({scene,model,camera,renderer,rooms,surfaces,render,
          load:async(artwork,signal)=>{
            const shared=sources.get(artwork.revisionId);
            if(shared){const object=await shared;signal.throwIfAborted();return {object,release:()=>{}};}
            const object=await loadArtwork(artwork,undefined,signal);
            const resources=decodedResources.get(object)??[];decodedResources.delete(object);
            let released=false;return {object,release:()=>{if(released)return;released=true;for(const r of resources)r.dispose();}};
          },
        });
        placementSync.current=preview.sync;placementRelease=preview.dispose;
      }
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
        const mapThumbnail=createMapThumbnailRoster({
          ids:mapImageIds,
          allowed:()=>!!onMapThumbnail&&!!mapThumbnailEnabled.current&&!disposed&&!gpuLost&&renderer.domElement.style.visibility!=='hidden',
          exclude:id=>{const p=document.placements.find(v=>v.id.toLowerCase()===id.toLowerCase());return !!p&&!!suppliedThumbnailRef.current?.[p.artworkRevisionId.toLowerCase()];},
          image:id=>{
            const placement=document.placements.find(p=>p.id.toLowerCase()===id.toLowerCase());
            const art=document.artworks.find(a=>a.revisionId.toLowerCase()===placement?.artworkRevisionId.toLowerCase());
            if(art?.artworkType!=='image')return;
            let image:ImageBitmap|undefined;
            objects.get(art.revisionId)?.traverse(node=>{if(!image&&node instanceof three.Mesh){const materials=Array.isArray(node.material)?node.material:[node.material];for(const material of materials){const candidate=(material as InstanceType<typeof three.MeshStandardMaterial>).map?.image;if(candidate instanceof ImageBitmap){image=candidate;break;}}}});
            return image;
          },
          changed:items=>mapCallbacks.current.onMapThumbnail?.(items.length?{items,revisionSha256:publicSource.revisionSha256}:null),
        });
        mapThumbnailRefresh.current=mapThumbnail.refresh;
        const mapPins=new Map<string,number>(),mapWaiters=new Set<()=>void>();
        let detailPinned:InstanceType<typeof three.Object3D>|undefined,detailPinnedArtwork:string|undefined,detailRetired=false;
        let settleDetail:(()=>void)|undefined,cancelDetail:(()=>void)|undefined,retryFlatDetail:(()=>void)|undefined;
        const viewingWaiters=new Set<()=>void>(),viewingPins=new Map<string,number>();
        let viewingCurrentArt:string|undefined;
        let viewingPreparing=0;
        const orbitRoot=renderer.domElement.closest('.publication-shell');
        const orbitAllowed=()=>!disposed&&!gpuLost&&!xrActive.current&&!sharedDetail&&!suspendedRef.current&&!seatedBenchRef.current&&!viewingPreparing&&viewingStyleRef.current==='ordered'&&!renderer.domElement.ownerDocument.hidden&&renderer.domElement.style.visibility!=='hidden'&&![...(orbitRoot?.querySelectorAll('details[data-visitor-panel][open],dialog[open],[aria-modal="true"],.viewer-brief')??[])].some(node=>node.getClientRects().length>0&&!node.closest('[hidden],[inert]'));
        const stopSculptureOrbit=()=>sculptureOrbitRuntime.current?.actions.stop();
        const orbitVisibility=()=>{if(renderer.domElement.ownerDocument.hidden)stopSculptureOrbit();sculptureOrbitRuntime.current?.refresh();};
        const orbitKey=(event:KeyboardEvent)=>{if(event.key==='Escape')stopSculptureOrbit();};
        const orbitPointer=(event:PointerEvent)=>{if(!event.isPrimary||!(event.target instanceof Element&&event.target.closest('.viewer-sculpture-orbit')))stopSculptureOrbit();};
        const orbitRelease=(event:PointerEvent)=>sculptureOrbitRuntime.current?.actions.release(event.pointerId,false);
        const orbitPanel=()=>{if(!orbitAllowed())stopSculptureOrbit();sculptureOrbitRuntime.current?.refresh();};
        window.addEventListener('blur',stopSculptureOrbit);window.addEventListener('focus',orbitVisibility);
        renderer.domElement.ownerDocument.addEventListener('visibilitychange',orbitVisibility);
        renderer.domElement.ownerDocument.addEventListener('keydown',orbitKey,true);
        renderer.domElement.ownerDocument.addEventListener('pointerdown',orbitPointer,true);
        renderer.domElement.ownerDocument.addEventListener('pointerup',orbitRelease);
        renderer.domElement.ownerDocument.addEventListener('pointercancel',orbitRelease);
        renderer.domElement.ownerDocument.addEventListener('wheel',stopSculptureOrbit,true);
        renderer.domElement.ownerDocument.addEventListener('scroll',stopSculptureOrbit,true);
        renderer.domElement.ownerDocument.addEventListener('contextmenu',stopSculptureOrbit,true);
        orbitRoot?.addEventListener('toggle',orbitPanel,true);
        const destroy = (object: InstanceType<typeof three.Object3D>) => {
          if(object===detailPinned){detailRetired=true;return;}
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
        const reclaiming=new Set<string>(), lastAttended=new Map<string,number>(), observedVisible=new Map<string,boolean>(), observedEligible=new Map<string,boolean>();
        const minimumObjects=new Map<string,{assetId:string;object:InstanceType<typeof three.Object3D>}>(), minimumBlocked=new Set<string>(),materialBudgetDeferred=new Set<string>();
        let minimumRoomId:string|undefined,minimumRooms:ReadonlySet<string>=new Set();
        const placeholders=new Map([...placements].map(([id,group])=>[id,[...group.children]]));
        let sequence=0, automatic=true, manualFull=false;
        const demandContext=()=>artworkDemandContext(currentArtwork,detailPinnedArtwork);
        const detailBytes=()=>detailRetired?(detailPinned?.userData.viewer?.decodedBytes??0):0;
        const resident=()=>[...objects.values(),...[...prepared.values()].map(v=>v.object),...[...minimumObjects.values()].map(v=>v.object)].reduce((sum,value)=>sum+(value.userData.viewer?.decodedBytes??0),detailBytes())+byteCache.stats().bytes;
        const peak=new AssetPeakBudget(transitionBudgetBytes,resident);
        growAssetLimits=()=>{
          const increased=assetBudgetBytes>byteCache.stats().maxBytes;
          byteCache.raiseLimit(assetBudgetBytes);peak.raiseLimit(transitionBudgetBytes);
          if(increased)for(const id of materialBudgetDeferred){retryAfter.delete(id);failed.delete(id);materialBudgetDeferred.delete(id);}
        };
        growAssetLimits();
        const reserve=(key:string,bytes:number)=>{
          // Encoded bytes and prepared objects are expendable; displayed objects stay pinned through replacement.
          for(const art of arts)for(const asset of art.assets){if(peak.total(key)+bytes<=transitionBudgetBytes)break;byteCache.delete(asset.id);}
          if(!tasks.get(key)?.prepareOnly)for(const [id,value] of prepared){if(peak.total(key)+bytes<=transitionBudgetBytes)break;prepared.delete(id);destroy(value.object);stage(id,'evicted-preparation');}
          for(const [id,value]of minimumObjects){if(peak.total(key)+bytes<=transitionBudgetBytes)break;if(mapPins.has(id)||viewingPins.has(id)||id===viewingCurrentArt||observedVisible.get(id)!==false||observedEligible.get(id)!==false)continue;minimumObjects.delete(id);destroy(value.object);stage(value.assetId,'evicted-offroom-minimum');}
          peak.reserve(key,bytes);
        };
        const tasks = new Map<
          string,
          {
            art: Document["artworks"][number];
            inventory: Document["artworks"][number]["assets"][number];
            prepareOnly:boolean; downloadOnly:boolean;
            thumbnailWork?:(signal:AbortSignal)=>Promise<void>;
          }
        >();
        type LoadResult={object?:InstanceType<typeof three.Object3D>;key:string;borrowedMinimum?:{artId:string;assetId:string}};
        const discardResult=(result:LoadResult)=>{
          const {object,borrowedMinimum:borrowed}=result;if(!object)return;
          if(borrowed){
            if(objects.get(borrowed.artId)===object)return;
            if(!disposed&&(observedVisible.get(borrowed.artId)!==false||observedEligible.get(borrowed.artId)!==false)){
              const prior=minimumObjects.get(borrowed.artId);
              if(!prior){minimumObjects.set(borrowed.artId,{assetId:borrowed.assetId,object});return;}
              if(prior.object===object)return;
            }
          }
          destroy(object);
        };
        const scheduler = new AssetScheduler<LoadResult>({
          // Fetch, decode/parse and texture/shader preparation share this serial slot.
          concurrency: 1,
          load: async (key, signal) => {
            const t = tasks.get(key)!;
            try {
              if(t.thumbnailWork){await t.thumbnailWork(signal);signal.throwIfAborted();return {key};}
              const minimum=minimumObjects.get(t.art.revisionId);
              if(minimum?.assetId===t.inventory.id&&!t.prepareOnly){
                // Transfer ownership synchronously before awaiting rights: offroom eviction cannot dispose a borrowed object.
                const result:LoadResult={object:minimum.object,key,borrowedMinimum:{artId:t.art.revisionId,assetId:minimum.assetId}};
                minimumObjects.delete(t.art.revisionId);
                try{reserve(key,minimum.object.userData.viewer?.decodedBytes??0);await checkPublicAvailability(signal);signal.throwIfAborted();minimum.object.userData.loadKey=key;return result;}
                catch(error){discardResult(result);throw error;}
              }
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
              const object=await loadArtwork(t.art,t.inventory,signal,bytes=>reserve(key,assetDecodeReserve(t.art,t.inventory,{...viewerBudget,maxCacheBytes:assetBudgetBytes},bytes)),value=>stage(t.inventory.id,value));
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
              if(!t.thumbnailWork)stage(t.inventory.id,signal.aborted?'cancelled-settled':error instanceof Error&&error.message==='ASSET_TRANSITION_PEAK'?'deferred-budget':'failed');
              peak.release(key);tasks.delete(key);throw error;
            }
          },
          onDiscard: result=>{const task=tasks.get(result.key);if(task)stage(task.inventory.id,'cancelled-settled');peak.release(result.key);tasks.delete(result.key);discardResult(result);},
        });
        let publicThumbnailTask:string|undefined;
        const cancelPublicThumbnail=()=>{if(publicThumbnailTask){scheduler.cancel(publicThumbnailTask);publicThumbnailTask=undefined;}};
        const update = () => {
          if (disposed || gpuLost) return;
          const decodedTotal = [...objects.values(),...[...prepared.values()].map(v=>v.object),...[...minimumObjects.values()].map(v=>v.object)].reduce(
            (sum, value) => sum + (value.userData.viewer?.decodedBytes ?? 0),
            detailBytes(),
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
          mapThumbnail.refresh();
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
            retainedMinimumAssets:[...minimumObjects.values()].map(v=>v.assetId),minimumRoomIds:[...minimumRooms],minimumBudgetBlocked:[...minimumBlocked],minimumBudgetBytes:assetBudgetBytes,transitionBudgetBytes,
            currentArtwork, preparedAssetIds:[...prepared.keys()], preparationStages:[...stages].map(([assetId,value])=>({assetId,...value})),
            allocationEstimateOnly:true,
            cache: byteCache.stats(),
            scheduler: scheduler.stats(),
            assetIds: [...active.values()],
            pixelRatio: renderer.getPixelRatio(),
            decodedBytes: [...objects.values(),...[...prepared.values()].map(v=>v.object),...[...minimumObjects.values()].map(v=>v.object)].reduce(
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
          setPublicMessage(minimumBlocked.size>0?"표시할 메모리가 부족해 일부 작품을 아직 준비하지 못했어요. 작품 목록에서도 감상할 수 있어요.":failed.size > 0
            ? "일부 작품을 불러오지 못했어요. 다시 시도하거나 작품 목록을 이용해 주세요."
            : "공간에서 관람할 수 있어요. 작품 목록에서도 감상할 수 있어요.");
          setMessage(
            `공간 ${document.rooms.length} · 표면 ${document.surfaces.length} · 실제 개구부 ${document.openings.length} · 승인된 작품 derivative ${loaded}개 · bytes 사용 불가 ${failed.size}개 · 입구 ${arts.slice(0, viewerBudget.entranceAssets).filter((a) => active.has(a.revisionId)).length}/${Math.min(arts.length, viewerBudget.entranceAssets)} · 갤러리 대기 ${arts.length - requested.size}개 (점선은 실제 치수 metadata bounds).`,
          );
          settleDetail?.();for(const check of [...viewingWaiters])check();
        };
        const request = (art: (typeof arts)[number], full = false, prepareOnly=false, detailPromotion=false):void => {
          if(art.revisionId===detailPinnedArtwork&&!detailPromotion)return;
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
          if(prepareOnly&&minimumObjects.get(art.revisionId)?.assetId===inventory.id)return;
          if (active.get(art.revisionId) === inventory.id) {
            const prior=pending.get(art.revisionId);
            if(prior&&desired.get(art.revisionId)!==inventory.id){desired.set(art.revisionId,inventory.id);scheduler.cancel(prior);pending.delete(art.revisionId);}
            update();
            return;
          }
          const prior=pending.get(art.revisionId);
          if(prior&&desired.get(art.revisionId)===inventory.id){
            // Promote the same preparation; aborting here restarts verified
            // download/decode exactly when the viewer turns towards the work.
            if(art.revisionId===currentArtwork){
              const task=tasks.get(prior);if(task)task.prepareOnly=false;
              void scheduler.request(prior,-100);
            }
            return;
          }
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
                if(art.revisionId===demandContext().owner){reclaimForCurrent();stage(inventory.id,'deferred-budget');}
                if(!active.has(art.revisionId))request(art,false,prepareOnly);return;
              }
            }catch{if(!active.has(art.revisionId))request(art,false,prepareOnly);return;}
          }
          if(prior)scheduler.cancel(prior);
          cancelPublicThumbnail();
          desired.set(art.revisionId, inventory.id);
          const key=`${inventory.id}/${sequence++}`;
          pending.set(art.revisionId,key);
          const task={ art, inventory, prepareOnly, downloadOnly };
          tasks.set(key,task);
          void scheduler
            .request(key, art.revisionId===currentArtwork?-100:prepareOnly?100:arts.indexOf(art))
            .then(result => {
              const {object}=result;
              peak.release(key);
              const current=settleAssetGeneration(pending,art.revisionId,key);
              tasks.delete(key);
              if(!object){update();return;}
              if (disposed || !current || desired.get(art.revisionId) !== inventory.id) {
                discardResult(result);
                return;
              }
              if(peak.total()+(object.userData.viewer?.decodedBytes??0)>assetBudgetBytes){
                discardResult(result);retryAfter.set(art.revisionId,performance.now()+5000);update();return;
              }
              if(task.prepareOnly&&currentArtwork!==art.revisionId){
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
              if (old && old !== object){
                xrArtworks.delete(art.revisionId);xrCallbacks.current.onXrArtworks?.([...xrArtworks.values()]);
                // Preserve the qualified textured/silhouette minimum through a full-detail swap.
                const oldId=active.get(art.revisionId);let minimumId:string|undefined;
                try{minimumId=selectAssetVariant(art,Infinity,viewerBudget).id;}catch{/* No unsupported minimum identity is inferred. */}
                if(oldId===minimumId){const prior=minimumObjects.get(art.revisionId);if(prior&&prior.object!==old)destroy(prior.object);minimumObjects.set(art.revisionId,{assetId:oldId!,object:old});}
                else destroy(old);
              }
              objects.set(art.revisionId, object);
              const oldId=active.get(art.revisionId);
              active.set(art.revisionId, inventory.id);
              if(art.revisionId===demandContext().owner&&full)reclaiming.clear();
              stage(inventory.id,'attached-awaiting-draw');
              if(oldId&&oldId!==inventory.id)byteCache.delete(oldId);
              xrArtworks.set(art.revisionId,{revisionId:art.revisionId,assetId:inventory.id,label:art.metadata.title,object});xrCallbacks.current.onXrArtworks?.([...xrArtworks.values()]);
              failed.delete(art.revisionId);minimumBlocked.delete(art.revisionId);retryAfter.delete(art.revisionId);
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
                retryAfter.set(art.revisionId,error?.message==='ASSET_TRANSITION_PEAK'?performance.now()+(art.revisionId===demandContext().owner?500:5000):Infinity);
                if(error?.message==='MODEL_RESIDENT_BUDGET'&&(!floorSettled||!surfaceSettled))materialBudgetDeferred.add(art.revisionId);
                if(error?.message==='ASSET_TRANSITION_PEAK'){if(!active.has(art.revisionId))minimumBlocked.add(art.revisionId);if(art.revisionId===demandContext().owner)reclaimForCurrent();}
                // A visible missing minimum must not wait for detail attention:
                // its placeholder may be too small/off-center to win that slot.
                const visibleMissingMinimum=!active.has(art.revisionId)&&observedVisible.get(art.revisionId)&&observedEligible.get(art.revisionId);
                if(['ASSET_TRANSITION_PEAK','MODEL_RESIDENT_BUDGET'].includes(error?.message)&&(art.revisionId===demandContext().owner||visibleMissingMinimum))reduceSurfaceForCurrent(art.revisionId);
                if(task.prepareOnly||active.has(art.revisionId)){update();return;}
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
          const candidate=displayedDetailReclamation(arts.filter(art=>!mapPins.has(art.revisionId)&&!viewingPins.has(art.revisionId)&&art.revisionId!==viewingCurrentArt&&art.revisionId!==detailPinnedArtwork&&active.has(art.revisionId)&&!reclaiming.has(art.revisionId)).map(art=>({
            id:art.revisionId,artwork:art,assetId:active.get(art.revisionId)!,visible:observedVisible.get(art.revisionId)??true,minimumRequired:observedEligible.get(art.revisionId)??true,lastAttended:lastAttended.get(art.revisionId)??-Infinity,
          })),demandContext().owner,performance.now(),viewerBudget);
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
        let materialReductionPending=false;
        const reduceSurfaceForCurrent=(artId:string)=>{
          if(materialReductionPending||!floorSettled||!surfaceSettled||disposed||gpuLost)return;
          materialReductionPending=true;
          const key='surface-resolution-reduction';
          void surfaceTextures.reduceForArtwork(bytes=>{reserve(key,bytes);return()=>peak.release(key);},texture=>renderer.initTexture(texture)).then(residentBytes=>{
            if(disposed||gpuLost||residentBytes===undefined)return;
            // Only retired material ownership returns bytes to artwork admission.
            surfacePlan.residentBytes=residentBytes;releaseMaterialLoadHold('surface');
            const surfaceState=renderer.domElement.dataset.surfaceTextures;
            if(surfaceState)renderer.domElement.dataset.surfaceTextures=JSON.stringify({...JSON.parse(surfaceState),residentBytes});
            retryAfter.delete(artId);failed.delete(artId);minimumBlocked.delete(artId);
            shadowPass.invalidate();render();update();
          }).catch(()=>{/* Old complete material stays valid; no retry loop. */}).finally(()=>{materialReductionPending=false;});
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
          if(disposed||gpuLost||xrActive.current||!automatic||!demandContext().observeWall)return;
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
          if(cameraRoom?.id!==minimumRoomId){minimumRoomId=cameraRoom?.id;minimumRooms=minimumRoomInterest(document,minimumRoomId);}
          const doors=document.openings.filter(v=>v.type==='door').flatMap(door=>{
            const surface=document.surfaces.find(v=>v.id.toLowerCase()===door.surfaceId.toLowerCase()),group=surfaces.get(door.surfaceId.toLowerCase());
            if(!surface||!group)return [];
            const point=group.localToWorld(new three.Vector3(door.offset[0],door.offset[1],0));
            return camera.position.distanceTo(point)<=3&&clearPath(camera.position,point)?[{point,roomId:surface.roomId}]:[];
          });
          const observations=arts.map(art=>{
            let visible=false,distance=Infinity,focused=false,screenDemand=false,maxOccupancy=0,gazeDistance=Infinity,eligible=false,minimumEligible=false;
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
              minimumEligible=minimumEligible||minimumRooms.has(p.roomId.toLowerCase());
              const unobstructed=clearPath(camera.position,center);
              const viaDoor=room&&doors.some(door=>(sameRoom||contains(room,door.point,.4))&&door.point.distanceTo(center)<=6&&clearPath(door.point,center));
              const plausible=!!((sameRoom&&unobstructed)||viaDoor);
              eligible=eligible||plausible;
              const screen=detailScreenBounds({corners:points.map(v=>{const clip=v.clone().project(camera);return {x:clip.x,y:clip.y,z:clip.z,depth:v.clone().applyMatrix4(camera.matrixWorldInverse).z};}),near:camera.near,intersectsFrustum:frustum.intersectsBox(box),width:renderer.domElement.width,height:renderer.domElement.height});
              if(!screen.visible||!minimumFootprintVisible(points,unobstructed,point=>clearPath(camera.position,point)))continue;
              visible=true;
              // Partial footprints protect the minimum; detail keeps its center-clear requirement.
              if(!unobstructed)continue;
              const isFocused=focusedPlacement.current===p.id;focused=focused||isFocused;
              const {occupancy,projectedPixels:pixels}=screen;
              gazeDistance=Math.min(gazeDistance,screen.gazeDistance);
              maxOccupancy=Math.max(maxOccupancy,occupancy);
              screenDemand=screenDemand||detailDemand({kind:art.artworkType,visible:true,distance:Math.max(.001,d),occupancy,projectedPixels:pixels,coarseTextureSize:low?.textureSize,gazeDistance:screen.gazeDistance,focused:isFocused});
            }
            let transition=transitions.get(art.revisionId);if(!transition){transition=new DetailTransition();transitions.set(art.revisionId,transition);}
            const want=transition.update(screenDemand,now);
            return {art,visible,distance,focused,want,demand:screenDemand,occupancy:maxOccupancy,gazeDistance,eligible,minimumEligible};
          });
          // Attention and detail grace run together rather than adding two
          // consecutive dwell delays before the first detailed request.
          const candidates=observations.map(v=>({id:v.art.revisionId,demand:v.demand||(v.art.revisionId===attention.current()&&v.want),occupancy:v.occupancy,focused:v.focused,gazeDistance:v.gazeDistance,distance:v.distance,eligible:v.eligible}));
          currentArtwork=attention.update(candidates,now);
          if(currentArtwork){lastAttended.set(currentArtwork,now);reclaiming.delete(currentArtwork);}
          for(const observation of observations){observedVisible.set(observation.art.revisionId,observation.visible);observedEligible.set(observation.art.revisionId,observation.minimumEligible);if(!observation.visible&&!observation.minimumEligible)minimumBlocked.delete(observation.art.revisionId);}
          preparing=new Set(automatic?nearbyPreparation(candidates,currentArtwork):[]);
          // Cancel obsolete preparation without releasing its unsettled reservation.
          for(const [artId,key] of pending){const task=tasks.get(key);if(task?.prepareOnly&&artId!==currentArtwork&&!preparing.has(artId)){scheduler.cancel(key);pending.delete(artId);}}
          for(const [id,value] of prepared){
            if(preparing.has(value.artId)||value.artId===currentArtwork)value.lastUseful=now;
            else if(now-value.lastUseful>=1800){prepared.delete(id);destroy(value.object);stage(id,'evicted-preparation');}
          }
          const sorted=[...observations].sort((a,b)=>Number(b.art.revisionId===currentArtwork)-Number(a.art.revisionId===currentArtwork));
          // Current/connected-room minima get the serial slot before speculative or attended detail.
          for(const {art,visible,minimumEligible}of sorted)if((visible||minimumEligible)&&!active.has(art.revisionId)&&(retryAfter.get(art.revisionId)??0)<=now)request(art,false);
          const minimumOutstanding=minimumDetailPending(sorted.map(v=>({visible:v.visible,eligible:v.minimumEligible,active:active.has(v.art.revisionId),pending:pending.has(v.art.revisionId),budgetBlocked:minimumBlocked.has(v.art.revisionId)})));
          for(const {art,visible,minimumEligible,distance,focused,want} of sorted){
            if(!mapPins.has(art.revisionId)&&!viewingPins.has(art.revisionId)&&art.revisionId!==viewingCurrentArt&&art.revisionId!==detailPinnedArtwork&&!visible&&!minimumEligible&&!focused&&distance>12){
              const since=awaySince.get(art.revisionId)??now;awaySince.set(art.revisionId,since);
              if(now-since>=5000){
                const key=pending.get(art.revisionId);if(key){scheduler.cancel(key);pending.delete(art.revisionId);}
                desired.delete(art.revisionId);
                const old=objects.get(art.revisionId);if(old){
                  for(const p of ordered.filter(p=>p.artworkRevisionId===art.revisionId)){const group=placements.get(p.id.toLowerCase());if(group){group.clear();for(const bound of placeholders.get(p.id.toLowerCase())??[])group.add(bound);}}
                  const retained=minimumObjects.get(art.revisionId);if(retained){minimumObjects.delete(art.revisionId);destroy(retained.object);}
                  objects.delete(art.revisionId);const id=active.get(art.revisionId);active.delete(art.revisionId);requested.delete(art.revisionId);xrArtworks.delete(art.revisionId);xrCallbacks.current.onXrArtworks?.([...xrArtworks.values()]);destroy(old);if(id)byteCache.delete(id);shadowPass.invalidate();render();
                }
                continue;
              }
            }else awaySince.delete(art.revisionId);
            const isCurrent=art.revisionId===currentArtwork,neighbor=preparing.has(art.revisionId);
            const wantFull=isCurrent&&want&&!minimumOutstanding;
            if((retryAfter.get(art.revisionId)??0)>now)continue;
            if(isCurrent)request(art,wantFull);
            else if(reclaiming.has(art.revisionId)){
              if(active.has(art.revisionId))request(art,false);
            }
            else if(neighbor){
              if(visible&&!active.has(art.revisionId))request(art,false);
              else if(!minimumOutstanding)request(art,true,true);
            }
            else if(requested.has(art.revisionId)||visible)request(art,false);

          }
        };
        const mapBridge:MapTravelBridge={visit:async(input,externalSignal)=>{
          const signal=AbortSignal.any([abort.signal,externalSignal]);signal.throwIfAborted();
          if(viewingStyleRef.current!=='free'||disposed||gpuLost||xrActive.current||sharedDetail||suspendedRef.current||seatedBenchRef.current||!walkingActions.current?.visitViewpoint)return false;
          const destination=presentationFor(document).viewpoints.find(v=>v.id.toLowerCase()===input.viewpointId.toLowerCase()&&v.roomId.toLowerCase()===input.roomId.toLowerCase());
          if(!destination)return false;
          const selected=input.placementId?document.placements.find(p=>p.id.toLowerCase()===input.placementId!.toLowerCase()&&p.roomId.toLowerCase()===destination.roomId.toLowerCase()):undefined;
          if(input.placementId&&!selected)return false;
          const placement=selected??prioritizePlacements(document,destination.roomId,destination.position).find(p=>p.roomId.toLowerCase()===destination.roomId.toLowerCase());
          const art=placement&&arts.find(a=>a.revisionId.toLowerCase()===placement.artworkRevisionId.toLowerCase());
          const position=camera.position.clone(),quaternion=camera.quaternion.clone();
          let releaseMinimum:(()=>void)|undefined;
          try{
            try{await checkPublicAvailability(signal);}catch(error){if(!signal.aborted&&!disposed)stopPublicDisplay();throw error;}
            signal.throwIfAborted();
            if(art)releaseMinimum=await retainMapMinimum({id:art.revisionId,signal,pins:mapPins,waiters:mapWaiters,ready:()=>objects.has(art.revisionId)&&active.has(art.revisionId),failed:()=>!pending.has(art.revisionId)&&(failed.has(art.revisionId)||minimumBlocked.has(art.revisionId)),request:()=>request(art,false)});
            signal.throwIfAborted();
            if(viewingStyleRef.current!=='free'||disposed||gpuLost||xrActive.current||sharedDetail||suspendedRef.current||seatedBenchRef.current||renderer.domElement.ownerDocument.hidden||!camera.position.equals(position)||!camera.quaternion.equals(quaternion))return false;
            return walkingActions.current?.visitViewpoint?.(destination.id,false)===true;
          }finally{releaseMinimum?.();}
        }};
        mapCallbacks.current.onMapReady?.(mapBridge);
        const viewingBridge:ViewingRenderer={
          async prepare(stop,externalSignal){
            const signal=AbortSignal.any([abort.signal,externalSignal]);signal.throwIfAborted();
            if(disposed||gpuLost||xrActive.current||sharedDetail||suspendedRef.current||seatedBenchRef.current)throw Error('VIEWING_UNAVAILABLE');
            const placement=document.placements.find(p=>p.id.toLowerCase()===stop.placementId.toLowerCase());
            const art=arts.find(a=>a.revisionId.toLowerCase()===placement?.artworkRevisionId.toLowerCase());
            if(!art)throw Error('VIEWING_REFERENCE');
            viewingPreparing++;stopSculptureOrbit();sculptureOrbitRuntime.current?.refresh();
            viewingPins.set(art.revisionId,(viewingPins.get(art.revisionId)??0)+1);let released=false;
            const releasePin=()=>{if(released)return;released=true;signal.removeEventListener('abort',releasePin);const count=(viewingPins.get(art.revisionId)??1)-1;if(count>0)viewingPins.set(art.revisionId,count);else viewingPins.delete(art.revisionId);};
            signal.addEventListener('abort',releasePin,{once:true});
            try{
              await new Promise<void>((resolve,reject)=>{
                let ended=false;
                const finish=(error?:Error)=>{if(ended)return;ended=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);viewingWaiters.delete(check);if(error)reject(error);else resolve();};
                const cancel=()=>finish(Error('VIEWING_CANCELLED'));
                const check=()=>{if(signal.aborted||disposed||gpuLost){cancel();return;}if(objects.has(art.revisionId)&&active.has(art.revisionId)){finish();return;}if(!pending.has(art.revisionId)&&(failed.has(art.revisionId)||minimumBlocked.has(art.revisionId)))finish(Error('VIEWING_MINIMUM_UNAVAILABLE'));};
                const timer=setTimeout(()=>finish(Error('VIEWING_MINIMUM_TIMEOUT')),10000);
                signal.addEventListener('abort',cancel,{once:true});viewingWaiters.add(check);request(art,false);check();
              });
              signal.throwIfAborted();
              const destination=await walkingActions.current?.prepareViewpoint?.(stop.viewpointId);
              signal.throwIfAborted();if(!destination)throw Error('VIEWING_UNSAFE_POSITION');
              const group=placements.get(placement!.id.toLowerCase());if(!group)throw Error('VIEWING_REFERENCE');
              group.updateMatrixWorld(true);const box=new three.Box3().setFromObject(group,true);
              if(box.isEmpty()||box.distanceToPoint(new three.Vector3(...destination.target))>.05)throw Error('VIEWING_TARGET_OUTSIDE_ARTWORK');
              if(art.artworkType==='image'){
                let plane:InstanceType<typeof three.Mesh>|undefined;
                group.traverse(node=>{if(!plane&&node instanceof three.Mesh&&(Array.isArray(node.material)?node.material:[node.material]).some(m=>(m as InstanceType<typeof three.MeshBasicMaterial>).map))plane=node;});
                if(!plane)throw Error('VIEWING_IMAGE_FRONT');
                const determinant=plane.matrixWorld.determinant();if(!Number.isFinite(determinant)||determinant===0)throw Error('VIEWING_IMAGE_FRONT');
                const normal=new three.Vector3(0,0,1).applyNormalMatrix(new three.Matrix3().getNormalMatrix(plane.matrixWorld));
                if(!normal.toArray().every(Number.isFinite)||normal.lengthSq()===0)throw Error('VIEWING_IMAGE_FRONT');
                const eye=new three.Vector3(...destination.position),centre=box.getCenter(new three.Vector3());
                if(normal.dot(eye.sub(centre).normalize())<Math.cos(Math.PI/6))throw Error('VIEWING_IMAGE_FRONT');
              }
              return {commit(style){
                if(released||signal.aborted||disposed||gpuLost||sharedDetail||suspendedRef.current||xrActive.current||!objects.has(art.revisionId))return false;
                if(!walkingActions.current?.visitViewpoint?.(stop.viewpointId,style==='ordered'))return false;
                viewingCurrentArt=art.revisionId;viewingStyleRef.current=style;setViewingStyle(style);controls.enabled=false;currentArtwork=art.revisionId;
                sculptureOrbitRuntime.current?.dispose();sculptureOrbitRuntime.current=null;setSculptureOrbitState(undefined);delete renderer.domElement.dataset.sculptureOrbit;
                if(style==='ordered'&&art.artworkType==='sculpture'&&stop.orbit)sculptureOrbitRuntime.current=createSculptureOrbit({placementId:stop.placementId,bounds:stop.orbit,allowed:orbitAllowed,reducedMotion:()=>walkSettingsRef.current.reducedMotion,move:yaw=>walkingActions.current?.orbitViewpoint?.(stop.viewpointId,yaw)===true,changed:state=>{setSculptureOrbitState(state);renderer.domElement.dataset.sculptureOrbit=JSON.stringify(state);}});
                if(style==='free')panelResume?.resumeTemporary();
                render();update();return true;
              },release:releasePin};
            }catch(error){releasePin();throw error;}finally{viewingPreparing--;sculptureOrbitRuntime.current?.refresh();}
          },
          free(){
            if(disposed||gpuLost||sharedDetail||suspendedRef.current||xrActive.current||!walkingActions.current?.freeViewing?.())return false;
            sculptureOrbitRuntime.current?.dispose();sculptureOrbitRuntime.current=null;setSculptureOrbitState(undefined);delete renderer.domElement.dataset.sculptureOrbit;
            viewingStyleRef.current='free';setViewingStyle('free');viewingCurrentArt=undefined;panelResume?.resumeTemporary();render();return true;
          },
        };
        viewingCallback.current?.(viewingBridge);
        const mountSharedDetail:SharedDetailPreview=async input=>{
          const signal=AbortSignal.any([abort.signal,input.signal]);
          signal.throwIfAborted();
          if(disposed||gpuLost||xrActive.current||sharedDetail||!suspendedRef.current)throw Error('DETAIL_MAIN_VIEWER_UNAVAILABLE');
          const placement=document.placements.find(p=>p.id.toLowerCase()===input.placementId.toLowerCase());
          const art=arts.find(a=>a.revisionId.toLowerCase()===placement?.artworkRevisionId.toLowerCase());
          if(!art)throw Error('DETAIL_ARTWORK_UNAVAILABLE');
          cancelDetail?.();
          try{await checkPublicAvailability(signal);}catch(error){if(!signal.aborted&&!disposed){stopPublicDisplay();input.unavailable('rights');}throw error;}
          signal.throwIfAborted();
          if(!objects.has(art.revisionId))await new Promise<void>((resolve,reject)=>{
            const deadline=performance.now()+10000;let settled=false;
            const finish=(error?:Error)=>{if(settled)return;settled=true;signal.removeEventListener('abort',cancel);if(settleDetail===check)settleDetail=undefined;if(cancelDetail===cancel)cancelDetail=undefined;if(error)reject(error);else resolve();};
            const cancel=()=>finish(Error('DETAIL_CANCELLED'));
            const check=()=>{
              if(signal.aborted||disposed||gpuLost){cancel();return;}
              if(objects.has(art.revisionId)){finish();return;}
              if(performance.now()>deadline||failed.has(art.revisionId)&&!pending.has(art.revisionId))finish(Error('DETAIL_NOT_READY'));
            };
            settleDetail=check;cancelDetail=cancel;signal.addEventListener('abort',cancel,{once:true});request(art,false);check();
          });
          signal.throwIfAborted();
          let object=objects.get(art.revisionId);
          if(!object||disposed||gpuLost||sharedDetail||xrActive.current)throw Error('DETAIL_NOT_READY');
          const markerBytes=(input.anchors.length?16384+input.anchors.length*512:0)+(input.flatImage?2048:0),detailKey='shared-detail-annotations';
          // Verified downloads can outlive a deferred full-image promotion.
          // Spend no extra residency on the borrowed view until unpinned bytes
          // have yielded to the already displayed object and annotations.
          for(const work of arts)for(const asset of work.assets){
            if(resident()+markerBytes<=assetBudgetBytes)break;
            byteCache.delete(asset.id);
          }
          if(resident()+markerBytes>assetBudgetBytes)throw Error('DETAIL_MEMORY_BUDGET');
          reserve(detailKey,markerBytes);
          // Freeze this admitted identity while it is borrowed. A pending peer
          // replacement can be requested again after the detail scope returns.
          const loading=pending.get(art.revisionId);if(loading){pending.delete(art.revisionId);scheduler.cancel(loading);}
          desired.set(art.revisionId,active.get(art.revisionId)!);
          detailPinned=object;detailPinnedArtwork=art.revisionId;detailRetired=false;
          sharedDetailUnavailable=input.unavailable;
          let promoteImage:(()=>void)|undefined,retryPromotion:(()=>void)|undefined;
          let alive=true,checking=false,timer:ReturnType<typeof setInterval>|undefined;
          const visible=()=>{if(globalThis.document.visibilityState==='visible')void check();};
          const restore=()=>{
            if(!alive)return;alive=false;clearInterval(timer);globalThis.document.removeEventListener('visibilitychange',visible);
            if(settleDetail===promoteImage)settleDetail=undefined;
            if(retryFlatDetail===retryPromotion)retryFlatDetail=undefined;
            peak.release(detailKey);
            sharedDetail=undefined;sharedDetailUnavailable=undefined;const retired=detailRetired;detailPinned=undefined;detailPinnedArtwork=undefined;detailRetired=false;if(retired&&object)destroy(object);
            if(!disposed&&!gpuLost){
              resize();update();
              // Dialog teardown may run before the borrowed canvas is returned.
              // Keep a restored opener's focus; otherwise return it to the stage.
              if(!suspendedRef.current&&renderer.domElement.isConnected&&globalThis.document.activeElement===globalThis.document.body)renderer.domElement.focus({preventScroll:true});
            }
          };
          const check=async()=>{
            if(!alive||checking)return;checking=true;
            try{await checkPublicAvailability(signal);}catch{
              if(alive&&!signal.aborted&&!disposed)stopPublicDisplay();
            }finally{checking=false;}
          };
          try{
            const scope=borrowedDetailPreview({three,renderer,object,request:{...input,signal},environment:()=>({map:scene.environment,intensity:scene.environmentIntensity}),onRelease:restore});
            if(!alive){scope.dispose();throw Error('DETAIL_CANCELLED');}
            sharedDetail=scope;timer=setInterval(()=>void check(),10000);globalThis.document.addEventListener('visibilitychange',visible);
            if(input.flatImage){
              // The existing scheduler owns verification, decode and peak admission.
              // Keep the borrowed old texture until the replacement has drawn successfully.
              promoteImage=()=>{
                const next=objects.get(art.revisionId);if(!alive||signal.aborted||!next||next===object)return;
                try{scope.replaceImage(next);}catch{return;}
                const previous=object,retired=detailRetired;object=next;detailPinned=next;detailRetired=false;
                if(retired&&previous)destroy(previous);
              };
              settleDetail=promoteImage;
              retryPromotion=createFlatDetailRetry({
                valid:()=>alive&&!signal.aborted&&!disposed&&!gpuLost&&sharedDetail===scope,
                pending:()=>pending.has(art.revisionId),retryAfter:()=>retryAfter.get(art.revisionId)??0,now:()=>performance.now(),
                ready:()=>active.get(art.revisionId)===selectAssetVariant(art,0,viewerBudget).id,
                request:()=>request(art,true,false,true),
              });
              retryFlatDetail=retryPromotion;retryPromotion();
            }
            update();return scope;
          }catch(error){restore();throw error;}
        };
        detailEntry.current.mountPreview=mountSharedDetail;
        cancelSharedDetail=()=>cancelDetail?.();
        const preparePublicThumbnail=()=>{
          const cache=publicThumbnailCacheRef.current;
          if(!cache||disposed||gpuLost||xrActive.current||sharedDetail||suspendedRef.current||renderer.domElement.ownerDocument.hidden||renderer.domElement.style.visibility==='hidden'){cancelPublicThumbnail();return;}
          if(publicThumbnailTask||scheduler.stats().active||scheduler.stats().queued)return;
          const art=arts.find(value=>cache.canLoad(value));if(!art)return;
          const inventory=artworkThumbnailFor(art);if(!inventory)return;
          const key=`thumbnail/${inventory.id}/${sequence++}`;publicThumbnailTask=key;
          tasks.set(key,{art,inventory,prepareOnly:true,downloadOnly:false,thumbnailWork:async signal=>{await cache.loadOne(art,signal);}});
          void scheduler.request(key,10000).catch(()=>{}).finally(()=>{tasks.delete(key);if(publicThumbnailTask===key)publicThumbnailTask=undefined;});
        };
        const statsTimer = setInterval(()=>{automaticDemand();retryFlatDetail?.();update();preparePublicThumbnail();sculptureOrbitRuntime.current?.refresh();for(const check of [...mapWaiters])check();if(!disposed&&!gpuLost)mapCallbacks.current.onMapPose?.(camera.position.toArray() as [number,number,number],new three.Euler().setFromQuaternion(camera.quaternion,'YXZ').y,2*Math.atan(Math.tan(camera.getEffectiveFOV()*Math.PI/360)*camera.aspect)*180/Math.PI);}, 200);
        const originalRelease = release;
        release = () => {
          sculptureOrbitRuntime.current?.dispose();sculptureOrbitRuntime.current=null;
          window.removeEventListener('blur',stopSculptureOrbit);window.removeEventListener('focus',orbitVisibility);
          renderer.domElement.ownerDocument.removeEventListener('visibilitychange',orbitVisibility);
          renderer.domElement.ownerDocument.removeEventListener('keydown',orbitKey,true);
          renderer.domElement.ownerDocument.removeEventListener('pointerdown',orbitPointer,true);
          renderer.domElement.ownerDocument.removeEventListener('pointerup',orbitRelease);
          renderer.domElement.ownerDocument.removeEventListener('pointercancel',orbitRelease);
          renderer.domElement.ownerDocument.removeEventListener('wheel',stopSculptureOrbit,true);
          renderer.domElement.ownerDocument.removeEventListener('scroll',stopSculptureOrbit,true);
          renderer.domElement.ownerDocument.removeEventListener('contextmenu',stopSculptureOrbit,true);
          orbitRoot?.removeEventListener('toggle',orbitPanel,true);
          mapCallbacks.current.onMapReady?.(null);mapPins.clear();
          if(mapThumbnailRefresh.current===mapThumbnail.refresh)mapThumbnailRefresh.current=null;
          mapThumbnail.dispose();
          viewingCallback.current?.(null);for(const check of [...viewingWaiters])check();viewingPins.clear();
          cancelDetail?.();sharedDetail?.dispose();
          if(detailEntry.current.mountPreview===mountSharedDetail)delete detailEntry.current.mountPreview;
          clearInterval(statsTimer);
          cancelPublicThumbnail();
          scheduler.dispose();
          originalRelease();
          for (const object of objects.values()) destroy(object);
          for(const value of prepared.values())destroy(value.object);
          prepared.clear();
          for(const value of minimumObjects.values())destroy(value.object);minimumObjects.clear();minimumBlocked.clear();
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
    resourceBudget,
    restart,
    transparentSpace,
    editingEnabled,
    immersive,
    fillHost,
  ]);
  const ControlsFrame = immersive || compactControls ? "details" : "div";
  return (
    <figure data-input-mode={inputMode} data-reduced-motion={walkSettings.reducedMotion} className={`geometry-preview${immersive ? " geometry-immersive" : ""}`} aria-hidden={suspendNavigation || undefined} inert={suspendNavigation || undefined}>
      {immersive&&viewingStyle==='ordered'&&sculptureOrbitState&&sculptureOrbitRuntime.current&&<SculptureOrbitControls state={sculptureOrbitState} actions={sculptureOrbitRuntime.current.actions}/>}
      {editing&&spaceTransparency===undefined&&<label><input type="checkbox" checked={transparentSpace} onChange={e=>setTransparentSpace(e.target.checked)}/>편집할 때 공간을 투명하게 보기 · 저장된 재질은 바뀌지 않아요</label>}
      {installationIssueCount>0&&<p role="status">받침대·프레임 {installationIssueCount}개를 표시하지 못했어요. 작품과 텍스트는 계속 볼 수 있어요.</p>}
      {materialIssueCount>0&&<p role="status">마감 텍스처 {materialIssueCount}종의 표시를 완료하지 못했어요. 저장된 재질 설정은 유지됩니다.</p>}
      {seatedBenchId&&<button ref={benchReturnButton} className="bench-return" disabled={suspendNavigation} onClick={()=>walkingActions.current?.stand?.()}>일어서서 이전 위치로 돌아가기</button>}
      <div className="geometry-stage watermark-display-stage">
        <div className="geometry-render-host" ref={host} />
        <WatermarkOverlay candidate={document}/>
        {viewerBudget && walkingMode && viewingStyle==='free' && (
          <WalkingTouch
            available={ready && !xrRunning && !suspendNavigation}
            paused={walkPaused}
            resumable={panelResumeAvailable}
            actions={walkingActions.current}
          />
        )}
      </div>
      <figcaption hidden={immersive && ready && assetReport.loaded===document.placements.length && assetReport.failed===0} role="status" data-testid={publicSource ? undefined : "geometry-render-state"}>{publicSource ? publicMessage : message}</figcaption>
      {((content:ReactNode)=>immersive&&controlsHost?createPortal(content,controlsHost):content)(<ControlsFrame className="geometry-controls">
      {(immersive || compactControls) && <summary>공간 조작</summary>}
      {immersive && <><label>조작 방식<select aria-label="조작 방식" value={inputMode} onChange={event=>{walkingActions.current?.pause("settings");onInputModeChange?.(event.target.value as ViewerInputMode);}}><option value="auto">기기에 맞게 · 드래그 또는 터치</option><option value="pointer">마우스·키보드</option><option value="trackpad">트랙패드·키보드</option><option value="touch">터치·조이스틱</option></select></label><p>터치 기기는 조이스틱과 화면 드래그, 그 외에는 시점 고정 없이 드래그가 기본이에요. 직접 바꾸면 이 관람 동안 선택을 유지해요. 설정을 닫으면 새 이동·시점 조작을 바로 사용할 수 있어요.</p></>}
      {publicSource && <details className="viewer-options"><summary>표시 상태 자세히</summary><p data-testid="geometry-render-state">{message}</p><p>{shadowMessage}</p></details>}
      <ViewControls hidden={viewingStyle==='ordered'} className={publicSource ? "viewer-options" : undefined}>
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
      {viewerBudget && viewingStyle==='free' && (
        <WalkingControls
          allowPointerCapture={!immersive || inputMode==="pointer"}
          available={ready && !xrRunning && !walkLoading && !suspendNavigation && !seatedBenchId}
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
      {viewerBudget && viewingStyle==='free' && benchesFor(document).length>0 && (
        <section aria-label="앉아서 감상" className="viewer-options">
          {seatedBenchId ? <p>앉아서 감상 중입니다. 화면의 돌아가기 버튼으로 종료할 수 있어요.</p> : <details><summary>벤치에서 감상</summary><p>직접 선택하면 앉은 시점에서 멈춰 감상합니다. 돌아온 뒤 걷기는 직접 재개하세요.</p>{benchesFor(document).map(bench=><button key={bench.id} disabled={!ready||xrRunning||walkLoading||suspendNavigation} onClick={()=>walkingActions.current?.sit?.(bench.id)}>{bench.name} · 앉아서 감상</button>)}</details>}
        </section>
      )}
      {viewerBudget && viewingStyle==='free' && presentationFor(document).viewpoints.length>0 && (
        <details className="viewer-options"><summary>다른 관람 위치</summary>
        <section aria-label="검증된 viewpoint 순간 이동">
          <p>직접 선택한 위치의 바닥·몸 여유 공간을 검사하고 움직임 없이 이동합니다. 안전하지 않은 위치는 거부하며 정지 상태를 유지합니다.</p>
          {presentationFor(document).viewpoints.map(viewpoint=><button key={viewpoint.id} disabled={!ready||xrRunning||walkLoading||suspendNavigation||!!seatedBenchId} onClick={()=>walkingActions.current?.teleport?.(viewpoint.id)}>안전한 viewpoint로 이동 {viewpoint.name}</button>)}
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
