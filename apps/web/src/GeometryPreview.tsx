import {guardedXrFrame} from './viewer/xr-frame-fence';
import {prepareArtworkGlb} from './viewer/artwork-glb-preparation';
import {OwnerArtworkHold} from './workspace-furnishing/owner-artwork-hold';
import {containedImageSize} from './viewer/flat-image-view';
import {ArtworkBitmapCleanupError,decodeArtworkBitmap} from './viewer/image-budget';
import {createOwnerFurnishingScene,existingSceneCost} from './workspace-furnishing/owner-scene';
import {WORKSPACE_FURNISHING_NAMESPACE,type WorkspaceFurnishings} from '@exhibitos/studio-contract';
import {publicWorkspaceModelSource} from './workspace-furnishing/public-source';
import {PublicWorkspaceCache} from './workspace-furnishing/public-cache';
import {publicWorkspaceFurnishingRights} from './workspace-furnishing/public-rights.mjs';
import {captureScenePng,SCENE_SNAPSHOT_RESERVE_BYTES,type SceneSnapshotCapture,type SceneSnapshotCamera,type SceneSnapshotInput} from './scene-snapshot';
import {createPreparationStages} from './viewer/preparation-stages';
import {createDiagnosticEvents,diagnosticsEnabled,registerDiagnosticSource} from './viewer/diagnostic-source';
import {readRuntimeHistory} from './viewer/runtime-history';
import {inspectionCameraPose} from './scene-snapshot-camera';
// SPDX-License-Identifier: AGPL-3.0-or-later
import {catalogBenchSource,installPrivateCatalogBench,catalogOtherSources,installCatalogOtherVisuals,FURNISHING_RESERVE_BYTES} from './private-editor/catalog-bench-renderer';
import {BENCH_RESERVE_BYTES} from './private-editor/catalog-bench';
import "./viewer/input-surface.css";
import type {ViewingRenderer,ViewingStyle} from './viewer/viewing-session';
import {createSculptureOrbit,type SculptureOrbitState} from './viewer/sculpture-orbit';
import {SculptureOrbitControls} from './viewer/SculptureOrbitControls';
import {floorTexturePlan,createFloorTextureRenderer,floorUvs} from './floor-texture-renderer';
import {workspaceFloorPlan,createWorkspaceFloorRenderer,createPublicWorkspaceFloorRenderer} from './workspace-floor-renderer';
import {MATERIAL_BATCH_STREAM_HOLD} from './workspace-material-batch.mjs';
import type {MapTravelBridge} from './viewer/map-travel';
import {retainMapMinimum} from './viewer/map-minimum';
import {assertArtworkViewpoint,authoredArtworkViewpoint} from './viewer/artwork-viewpoint';
import {viewingPlanFor} from '@exhibitos/studio-contract';
import {surfaceTexturePlan,createSurfaceTextureRenderer} from './surface-texture-renderer';
import {materialPhaseBytes,serialMaterialPhaseBytes,loadMaterialPhases,deferredByMaterialLoad,materialRetryWanted} from './material-texture-plan';
import {WatermarkOverlay} from './WatermarkOverlay';
import {BorrowedDetailInitialObjectError,borrowedDetailPreview,createFlatDetailRetry,detailResidentRetryReady,type SharedDetailPreview} from './viewer/borrowed-detail-preview';
import {createDetailImageSlot,DetailImageBudgetRefusal,qualifiedDetailImageProfile,sameDetailImageViewport,startDetailImageAttempt} from './viewer/detail-image-attempt';
import {createDetailBudgetRetry,detailBudgetRetryReady} from './viewer/detail-budget-retry';
import {residentDemandActive,residentMinimumFits,retryResidentMinimum,sameResidentMinimumAsset} from './viewer/resident-minimum-wait';
import {assertDetailMountCurrent} from './viewer/detail-attempt';
import {completeDetailCommands,focusRestoredDetailCanvas,restoreDetailCanvas} from './viewer/detail-command-completion';
import {matchesDetailRuntime} from './viewer/detail-runtime-profile';
import {isVerifiedStaticDetailAccess,staticDetailAttestation} from './static-publication-source';
import {matchesMeasuredWheatImage} from './viewer/detail-image-eligibility';
import {surfaceTextureFor,materialFor} from '@exhibitos/studio-contract';
import {floorFor,floorMaterial,validateStudioFloors,MATERIAL_NAMESPACE,type StudioMaterials} from '@exhibitos/studio-contract';
import {surfacePanels as panels,wallFinishesFor} from '@exhibitos/studio-contract';
import {installArchitecturalFinishes} from './architectural-finishes-renderer';
import {installPlaques,plaqueTextureReserve} from './plaque-renderer';
import {createMapThumbnailRoster,mapThumbnailRosterReserve,type MapThumbnailSnapshot} from './viewer/map-thumbnail';
import {publicThumbnailReserve,type createPublicThumbnailCache} from './viewer/public-thumbnail';
import {artworkThumbnailFor} from '@exhibitos/studio-contract';
import {installBoundedShadows,SHADOW_RESERVE_BYTES} from './viewer/shadows';
import {createPortal} from 'react-dom';
import {visitingFov,visitingBuffer} from './viewer/framing';
import {installPanelResume} from './viewer/panel-resume';
import {DEFAULT_REFERENCE_TONE,applyReferenceOutput,installReferenceEnvironment,environmentEstimate,type ReferenceTone} from './viewer/render-quality';
import type {EditorBridge,EditorSelection} from './geometry/direct-edit';
import {selectionKey,localPose} from './geometry/direct-edit';
import {floorInteriorView} from './geometry/floor-view';
import {installPreviewEditing} from './geometry/preview-editing';
import type {CameraInteractionMode} from './geometry/camera-mode';
import {onlyLightColorChanged,syncPreviewLightColors} from './geometry/light-preview';
import {boundedOrbitTarget,safePrivateView,type PrivateView} from './viewer/private-view';
import type {PlacementPreviewInstaller} from './geometry/placement-preview';
import {installLightDetails} from './light-details-renderer';
import {installBenches} from './bench-renderer';
import {benchesFor} from '@exhibitos/studio-contract';
import {installDecor} from './installation-renderer';
import type {Camera,Object3D,Scene,WebGLRenderer} from 'three';
import {centerMetricModel,artifactMetricModel} from './viewer/metric-model.js';
import { embeddedPNGManager } from './embedded-glb.js';
import type { PresenceVisitor } from "./viewer/realtime-motion";
import type { ScriptScene } from "./viewer/scripting";
import type { GuideRequest } from "./GuidedRoutes";
import { useCallback, useEffect, useRef, useState, useMemo, type ReactNode } from "react";
import {
  AssetScheduler, minimumDetailPending, minimumRoomInterest, minimumFootprintVisible,
  MemoryAssetCache,
  fetchVerifiedAsset,
  checkImageDecode,
  prioritizePlacements,
  selectAssetVariant, detailScreenBounds, detailDemand, DetailTransition, ArtworkAttention, artworkDemandContext, nearbyPreparation, displayedDetailReclamation, settleAssetGeneration, authoredImagePair, selectedImageDetail, stagingHayesDetailBudget, imageFullDecodeCeiling, AssetPeakBudget, retainEncodedBuffer, assetDecodeReserve, textureResidentBytes, geometryResidentBytes,
  type DeviceBudget,
} from "./viewer/loading";
import { validateArchitecture, spaceLightingFor, daylightFor, daylightDirection, presentationFor, lodVariantsFor, artifactCorners, lightDetailsFor, type DetailTier } from "@exhibitos/studio-contract";
import {
  WalkingControls,
  WalkingTouch,
  type WalkingActions,
  type WalkingSettings,
} from "./WalkingControls";
import { viewpointPose } from "./viewer/navigation-teleport";
import type { ViewerInputMode } from "./ViewerInputGuide";
import type { NavigationState } from "./viewer/navigation";
import type { PublicAsset,PublicResource,PublicPublication } from "./publication-client";
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
  privateCatalogue = false,
  ownerWorkspaceFurnishings,
  initialPrivateView,
  onPrivateViewReady,
  viewerBudget,
  resourceBudget,
  onSceneSnapshotReady,
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
  onCameraInteractionReady,
  onCameraInteractionReset,
  cameraFrameToken,
  initialSnapshot,
  cameraRequest,
  onSelectionFindReady,
  placementPreview,
  placementPreviewVersion,
  spaceTransparency,
  fillHost = false,
  compactControls = false,
  referenceTone = DEFAULT_REFERENCE_TONE,
  immersive = false,
  focusEntry,
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
  onMapThumbnail?:(value:MapThumbnailSnapshot|null)=>void;
  onViewingReady?:(renderer:ViewingRenderer|null)=>void;
  inputMode?: ViewerInputMode;
  onInputModeChange?: (mode: ViewerInputMode) => void;
  immersive?: boolean;
  focusEntry?:()=>boolean;
  controlsHost?: HTMLElement|null;
  viewFov?: number;
  onSelectionFindReady?: (action:((id:string)=>boolean)|null)=>void;
  onEntranceSceneReady?:(preview:EntranceScenePreview|null)=>void;
  placementPreview?: PlacementPreviewInstaller;
  placementPreviewVersion?: number;
  cameraRequest?: {kind:"isometric"|"top"|"front"|"left"|"right"|"ceiling";sequence:number};
  onCameraInteractionReady?:(apply:((mode:CameraInteractionMode,forceReset?:boolean,frameToken?:string,resetReason?:'hidden'|'unavailable')=>boolean)|null)=>void;
  onCameraInteractionReset?:(reason:'hidden'|'unavailable')=>void;
  cameraFrameToken?:string;
  initialSnapshot?:Extract<SceneSnapshotInput,{inspectionCamera:unknown}>;
  spaceTransparency?: boolean;
  fillHost?: boolean;
  compactControls?: boolean;
  onRenderState?: (state:{ready:boolean;message:string;loaded:number;failed:number;navigationReady:boolean;navigationFailed:boolean;error?:boolean})=>void;
  referenceTone?: ReferenceTone;
  onXrReady?: (bridge:GeometryXrBridge|null)=>void;
  onXrArtworks?: (artworks:GeometryXrArtwork[])=>void;
  document: Document;
  editing?:EditorBridge;
  privateCatalogue?: boolean;
  initialPrivateView?:PrivateView;
  onPrivateViewReady?:(getter:(()=>PrivateView|undefined)|null)=>void;
  viewerBudget?: DeviceBudget;
  /** Editor host resource accounting; does not enable visitor navigation. */
  resourceBudget?: Pick<DeviceBudget,'maxCacheBytes'|'maxTransitionBytes'|'maxTextureSize'>;
  onSceneSnapshotReady?:(source:{document:Document;capture:SceneSnapshotCapture;idle():boolean}|null)=>void;
  suspendNavigation?: boolean;
  onNavigationState?: (state: NavigationState) => void;
  onCameraPose?: (position: [number,number,number],yaw: number,pitch?: number) => void;
  onMapReady?: (bridge:MapTravelBridge|null) => void;
  onMapPose?: (position:[number,number,number],yaw:number,horizontalFovDegrees:number,continuous?:boolean) => void;
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
  ownerWorkspaceFurnishings?: {budget:DeviceBudget;signal:AbortSignal;expiresAt:number;invalidate:()=>void};
  publicSource?: {
    publicationId: string;
    revisionSha256: string;
    assets: PublicAsset[];
    resources?: PublicResource[];
    materialMapBatch?: {url:string};
    /** Exact loader-owned object; copied source fields cannot attest capability provenance. */
    detailPublication?:PublicPublication;
    coverOriginalEligible?:()=>boolean;
    fetcher?: typeof fetch;
    floorFetcher?: typeof fetch;
    retainedMaterialBytes?:number;
    check?: () => Promise<void>;
  };
  selection: GeometrySelection | null;
  appearance: (surfaceId: string) => SurfaceAppearance;
}) {
  const editingEnabled=!!editing;
  // Retain only an editor scene whose complete document differs in one light's
  // color. All other transitions continue through the ordinary effect cleanup.
  const [sceneState,setSceneState]=useState(()=>({observed:document,scene:document,editing:editingEnabled}));
  if(sceneState.observed!==document||sceneState.editing!==editingEnabled){
    const scene=editingEnabled&&sceneState.editing&&onlyLightColorChanged(sceneState.observed,document)?sceneState.scene:document;
    setSceneState({observed:document,scene,editing:editingEnabled});
  }
  const sceneDocument=sceneState.observed===document&&sceneState.editing===editingEnabled?sceneState.scene:editingEnabled&&sceneState.editing&&onlyLightColorChanged(sceneState.observed,document)?sceneState.scene:document;
  const viewFovRef=useRef(viewFov);viewFovRef.current=viewFov;
  const resizeAction=useRef<(()=>void)|null>(null);
  useEffect(()=>{resizeAction.current?.();},[viewFov]);
  const [localTransparentSpace,setTransparentSpace]=useState(false);
  const transparentSpace=spaceTransparency??localTransparentSpace;
  const consumedCameraRequest=useRef<number|undefined>(undefined);
  const [installationIssueCount,setInstallationIssueCount]=useState(0);
  const [materialIssueCount,setMaterialIssueCount]=useState(0);
  const publicQualityView=useRef<{scope:object;document:Document;budget:typeof viewerBudget;position:[number,number,number];quaternion:[number,number,number,number];target:[number,number,number];fov:number;walking:boolean}|null>(null);
  const editorCamera=useRef<{documentId:string;position:[number,number,number];quaternion:[number,number,number,number];target:[number,number,number];fov:number}|null>(null);
  const selectionRef=useRef(selection);selectionRef.current=selection;
  const editingRef=useRef(editing);editingRef.current=editing;
  const cameraInteractionCallbacks=useRef({onCameraInteractionReady,onCameraInteractionReset});cameraInteractionCallbacks.current={onCameraInteractionReady,onCameraInteractionReset};
  const cameraInteractionSetter=useRef<((mode:CameraInteractionMode,forceReset?:boolean,frameToken?:string,resetReason?:'hidden'|'unavailable')=>boolean)|null>(null);
  const cameraAppliedToken=useRef<string|undefined>(undefined);
  useEffect(()=>{onCameraInteractionReady?.(cameraInteractionSetter.current);return()=>onCameraInteractionReady?.(null);},[onCameraInteractionReady]);
  const privateViewCallback=useRef(onPrivateViewReady);privateViewCallback.current=onPrivateViewReady;
  const privateViewInitial=useRef(initialPrivateView);privateViewInitial.current=initialPrivateView;
  const entranceSceneCallback=useRef(onEntranceSceneReady);entranceSceneCallback.current=onEntranceSceneReady;
  const entranceScope=useRef<EntranceSceneScope|null>(null),[entranceWalking,setEntranceWalking]=useState(false);
  const editingSync=useRef<(()=>void)|null>(null);
  const cameraInvalidate=useRef<(()=>void)|null>(null);
  const placementInstaller=useRef(placementPreview);placementInstaller.current=placementPreview;
  const placementSync=useRef<(()=>void)|null>(null);
  useEffect(()=>{placementSync.current?.();},[placementPreviewVersion]);
  useEffect(()=>{editingSync.current?.();cameraAppliedToken.current=cameraFrameToken;},[editing,selection,document,cameraFrameToken]);
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
  const selectionFindAction=useRef<{document:typeof document;find:(id:string)=>boolean}|null>(null),selectionFindDocument=useRef(sceneDocument);selectionFindDocument.current=sceneDocument;
  useEffect(()=>{onSelectionFindReady?.(id=>selectionFindAction.current?.document===selectionFindDocument.current?selectionFindAction.current.find(id):false);return()=>onSelectionFindReady?.(null);},[onSelectionFindReady]);
  const navigationCallbacks = useRef({ onNavigationState, onCameraPose, onNavigationMode, onArtworkSelect, onPlaqueSelect, proximityDetail, onScriptSceneReady, onScriptPose, onScriptClick, onPresenceSceneReady, onPresencePose });
  navigationCallbacks.current = { onNavigationState, onCameraPose, onNavigationMode, onArtworkSelect, onPlaqueSelect, proximityDetail, onScriptSceneReady, onScriptPose, onScriptClick, onPresenceSceneReady, onPresencePose };
  const mapCallbacks=useRef({onMapReady,onMapPose,onMapThumbnail});mapCallbacks.current={onMapReady,onMapPose,onMapThumbnail};
  const mapPoseRefresh=useRef<(()=>void)|null>(null),mapPoseOwner=useRef(publicSource);mapPoseOwner.current=publicSource;
  useEffect(()=>{mapPoseRefresh.current?.();},[onMapPose,suspendNavigation]);
  const mapThumbnailEnabled=useRef(mapThumbnailsEnabled);mapThumbnailEnabled.current=mapThumbnailsEnabled;
  const suppliedThumbnailRef=useRef(suppliedThumbnails);suppliedThumbnailRef.current=suppliedThumbnails;
  const publicThumbnailCacheRef=useRef(thumbnailCache);publicThumbnailCacheRef.current=thumbnailCache;
  const mapThumbnailRefresh=useRef<(()=>void)|null>(null);
  useEffect(()=>{mapThumbnailRefresh.current?.();},[mapThumbnailsEnabled,suppliedThumbnails,suspendNavigation]);
  const focusedPlacement = useRef(focusedPlacementId);focusedPlacement.current=focusedPlacementId;
  const suspendedRef = useRef(suspendNavigation);
  suspendedRef.current = suspendNavigation;
  const suspendedWasWalking = useRef(false);
  const orbitEnabled = useRef<((enabled: boolean) => void) | null>(null);
  const seatedBenchRef=useRef<string|null>(null);
  const benchActionButton=useRef<HTMLButtonElement|null>(null);
  const benchAction=useRef<((benchId:string,seated:boolean)=>boolean)|null>(null);
  const nearbyBenchRef=useRef<string|null>(null);
  const [nearbyBenchId,setNearbyBenchId]=useState<string|null>(null);
  const [seatedBenchId,setSeatedBenchId]=useState<string|null>(null);
  useEffect(()=>{if(seatedBenchId)benchActionButton.current?.focus({preventScroll:true});},[seatedBenchId]);
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
  useEffect(()=>{if(walkingMode)cameraInvalidate.current?.();},[walkingMode]);
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
  const [detailRestoreStatus,setDetailRestoreStatus]=useState<'restoring'|'failed'|null>(null);
  const detailRestoreMessage=detailRestoreStatus==='restoring'?'작품 화면을 정리하고 있어요. 잠시 기다리거나 작품 목록을 이용해 주세요.':detailRestoreStatus==='failed'?'3D 화면을 안전하게 정리하지 못했어요. 작품 목록을 이용하거나 3D를 다시 시작해 주세요.':'';
  const [sceneIssue, setSceneIssue] = useState("");
  const [artworkNotice, setArtworkNotice] = useState<"loading" | "unavailable">();
  const [noticePageVisible, setNoticePageVisible] = useState(true);
  useEffect(() => {
    if (!immersive || !publicSource) return;
    const page = globalThis.document;
    const changed = () => setNoticePageVisible(!page.hidden);
    changed();
    page.addEventListener("visibilitychange", changed);
    return () => page.removeEventListener("visibilitychange", changed);
  }, [immersive, publicSource]);
  const ViewControls = publicSource ? "details" : "div";
  const [message, setMessage] = useState("공간 미리보기를 준비합니다."),
    [ready, setReady] = useState(false);
  const [buildFailed,setBuildFailed]=useState(false);
  const viewingCallback=useRef(onViewingReady);viewingCallback.current=onViewingReady;
  const viewingStyleRef=useRef<ViewingStyle>('free');
  const [viewingStyle,setViewingStyle]=useState<ViewingStyle>('free');
  const enteredWalking=useRef(false);
  useEffect(()=>{if(immersive&&ready&&(assetReport.loaded>0||document.placements.length===0)&&!suspendNavigation&&!enteredWalking.current&&walkingActions.current){enteredWalking.current=true;walkingActions.current.start(focusEntry);}},[immersive,ready,assetReport.loaded,document.placements.length,suspendNavigation,walkPreparation,focusEntry]);
  useEffect(()=>{if(cameraRequest&&ready&&action.current&&consumedCameraRequest.current!==cameraRequest.sequence){consumedCameraRequest.current=cameraRequest.sequence;action.current(cameraRequest.kind);}},[cameraRequest?.sequence,cameraRequest?.kind,ready]);
  const nativeReport=useRef(onRenderState);nativeReport.current=onRenderState;
  useEffect(()=>{nativeReport.current?.({ready,error:buildFailed,message:publicSource?(detailRestoreMessage||publicMessage):message,...assetReport,navigationReady:!immersive&&!entranceWalking||(walkPreparation==='ready'&&(walkingMode||qualityRebuildReady.current)),navigationFailed:(immersive||entranceWalking)&&walkPreparation==='failed'});},[ready,buildFailed,message,publicMessage,detailRestoreMessage,publicSource,assetReport,immersive,entranceWalking,walkPreparation,walkingMode]);
  useEffect(()=>{if(openingViewpoint&&ready&&!xrRunning&&!suspendNavigation&&!walkLoading&&openingConsumed.current!==openingViewpoint.sequence&&walkingActions.current?.teleport){openingConsumed.current=openingViewpoint.sequence;walkingActions.current.teleport(openingViewpoint.viewpointId);}},[openingViewpoint,ready,suspendNavigation,walkLoading]);
  useEffect(()=>{if(guideRequest && ready && !suspendNavigation && !walkLoading && guideAction.current && consumedGuide.current!==guideRequest.sequence){consumedGuide.current=guideRequest.sequence;guideAction.current(guideRequest.routeId,guideRequest.index);}},[guideRequest,ready,suspendNavigation,walkLoading]);
  useEffect(() => {
    if (suspendNavigation) {
      cameraInvalidate.current?.();
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
  const snapshotCallback=useRef(onSceneSnapshotReady);snapshotCallback.current=onSceneSnapshotReady;
  const snapshotEnabled=!!onSceneSnapshotReady;
  const snapshotFrameToken=useRef(cameraFrameToken);snapshotFrameToken.current=cameraFrameToken;
  const qualityScope=useMemo(()=>({}),[referenceTone,sceneDocument,appearance,session,publicSource,privateCatalogue,ownerWorkspaceFurnishings,resourceBudget,restart,transparentSpace,editingEnabled,immersive,fillHost,snapshotEnabled]);
  const qualityRebuildReady=useRef(false);
  const qualityIntent=useRef({scope:qualityScope,budget:viewerBudget});
  qualityIntent.current={scope:qualityScope,budget:viewerBudget};
  const qualityFrame=useRef<{scope:typeof qualityScope;canvas:HTMLCanvasElement;timer:number;visibleWorks:string[]}|null>(null);
  const clearQualityFrame=useCallback(()=>{
    const frame=qualityFrame.current;
    if(!frame)return;
    qualityFrame.current=null;
    window.clearTimeout(frame.timer);
    frame.canvas.remove();
    frame.canvas.width=0;
    frame.canvas.height=0;
  },[]);
  useEffect(()=>clearQualityFrame,[clearQualityFrame]);
  useEffect(() => {
    const document=sceneDocument;
    qualityRebuildReady.current=false;
    if(qualityFrame.current?.scope!==qualityScope)clearQualityFrame();
    let preserveQualityFrame=()=>{};
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
    let cancelSharedDetail=()=>{},guardOriginalDetail=()=>{},canvasReturnEpoch=0,detailMountEpoch=0,deferredCanvasRestore=false;
    let canvasRestorePromise:Promise<void>=Promise.resolve();
    walkingActions.current = null;
    seatedBenchRef.current=null;setSeatedBenchId(null);
    nearbyBenchRef.current=null;setNearbyBenchId(null);benchAction.current=null;
    xrActive.current=false;setXrRunning(false);
    setWalkingMode(false);
    setWalkPaused(true);
    setPanelResumeAvailable(false);
    setWalkLoading(false);
    setWalkPreparation('pending');
    setReady(false);
    setBuildFailed(false);
    setAssetReport({loaded:0,failed:0});
    setMessage("공간 미리보기를 준비합니다.");
    setMaterialIssueCount(0);
    setDetailRestoreStatus(null);setPublicMessage("전시를 준비하고 있어요.");
    setSceneIssue("");
    setArtworkNotice(undefined);
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
      const initialSnapshotPose=publicSource&&snapshotEnabled&&initialSnapshot?inspectionCameraPose(document,initialSnapshot.placementId,initialSnapshot.inspectionCamera):undefined;
      const hasWorkspaceFurnishings=!!document.extensions&&Object.hasOwn(document.extensions,WORKSPACE_FURNISHING_NAMESPACE);
      const ownerWorkspaceAvailable=!!ownerWorkspaceFurnishings&&!ownerWorkspaceFurnishings.signal.aborted&&Date.now()<ownerWorkspaceFurnishings.expiresAt&&!!session&&!publicSource&&!viewerBudget;
      const publicWorkspaceAvailable=!!publicSource&&!!viewerBudget&&!session;
      if(hasWorkspaceFurnishings&&!ownerWorkspaceAvailable&&!publicWorkspaceAvailable)throw Error('WORKSPACE_FURNISHING_SOURCE_UNAVAILABLE');
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
      // The bounded 2D frame belongs only to this rebuild. The old WebGL
      // renderer and its allocations are still disposed before the new build.
      let qualityFrameReserve=qualityFrame.current?1024*1024:0;
      const beforeSnapshot=(resources?.maxCacheBytes??33554432)-environmentReserve-shadowReserve-plaqueReserve-mapThumbnailReserve-suppliedThumbnailReserve-retainedMaterialBytes;
      const beforeBench=beforeSnapshot;
      const benchAuthority=publicSource?{...publicSource,fetcher:publicSource.fetcher??fetch,check:publicSource.check??(async()=>{const response=await fetch(`/api/v1/publications/${publicSource.publicationId}?footsteps=1`,{credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(10000)])});if(!response.ok)throw Error('PUBLICATION_UNAVAILABLE');const current=await response.json();if(current.publication?.id!==publicSource.publicationId||current.publication?.status!=='published'||current.publication?.revisionSha256!==publicSource.revisionSha256)throw Error('PUBLICATION_UNAVAILABLE');})}:undefined;
      const benchSource=catalogBenchSource(document,benchAuthority,privateCatalogue);
      const benchReserve=benchSource&&beforeBench>BENCH_RESERVE_BYTES?BENCH_RESERVE_BYTES:0;
      const otherFurnishings=catalogOtherSources(document,benchAuthority);
      const otherReserve=otherFurnishings.length&&beforeBench-benchReserve>FURNISHING_RESERVE_BYTES?FURNISHING_RESERVE_BYTES:0;
      const availableAssetBytes=Math.max(1,beforeBench-benchReserve-otherReserve);
      const materialCapacity=Math.max(0,availableAssetBytes-qualityFrameReserve);
      const builtinFloorPlan=floorTexturePlan(document,resources?.maxTextureSize??2048,materialCapacity);
      const batchStreamHold=!session&&publicSource?.materialMapBatch?MATERIAL_BATCH_STREAM_HOLD:0;
      const workspacePlan=workspaceFloorPlan(document,resources?.maxTextureSize??2048,Math.max(0,materialCapacity-builtinFloorPlan.residentBytes-batchStreamHold));
      if(workspacePlan.targets.size&&!session&&!publicSource){renderer.dispose();renderer.forceContextLoss();throw Error('WORKSPACE_MATERIAL_SOURCE_UNAVAILABLE');}
      const floorPlan={packs:[...builtinFloorPlan.packs,...workspacePlan.packs],blocked:[...builtinFloorPlan.blocked,...workspacePlan.blocked],residentBytes:builtinFloorPlan.residentBytes+workspacePlan.residentBytes,reserveBytes:Math.max(builtinFloorPlan.reserveBytes,builtinFloorPlan.residentBytes+workspacePlan.reserveBytes+(workspacePlan.packs.length?batchStreamHold:0)),maxSize:builtinFloorPlan.maxSize};
      // The surface source peak begins only after the floor source hold ends.
      // Reserve the retained floor even on fallback; never presume floor ready.
      const surfacePlan=surfaceTexturePlan(document,resources?.maxTextureSize??2048,Math.max(0,materialCapacity-materialPhaseBytes(floorPlan,true)),workspacePlan.targets);
      const materialReserve=serialMaterialPhaseBytes(floorPlan,surfacePlan,false,false);
      if(materialReserve>=materialCapacity){renderer.dispose();renderer.forceContextLoss();throw Error('MATERIAL_SOURCE_BUDGET');}
      const floorTextures=createFloorTextureRenderer(three,builtinFloorPlan,abort.signal,()=>disposed||gpuLost,publicSource?.floorFetcher);
      const workspaceTextures=session?createWorkspaceFloorRenderer(three,workspacePlan,abort.signal,()=>disposed||gpuLost,session):workspacePlan.targets.size&&benchAuthority?createPublicWorkspaceFloorRenderer(three,workspacePlan,abort.signal,()=>disposed||gpuLost,benchAuthority):undefined;
      const surfaceTextures=createSurfaceTextureRenderer(three,surfacePlan,abort.signal,()=>disposed||gpuLost,publicSource?.floorFetcher);
      // Snapshot admission must not lower existing floor/surface/catalog quality.
      const snapshotReserve=snapshotEnabled&&materialCapacity-materialReserve>SCENE_SNAPSHOT_RESERVE_BYTES?SCENE_SNAPSHOT_RESERVE_BYTES:0;
      let assetBudgetBytes=Math.max(1,availableAssetBytes-materialReserve-snapshotReserve-qualityFrameReserve);
      let transitionBudgetBytes=Math.max(assetBudgetBytes,(resources?.maxTransitionBytes??resources?.maxCacheBytes??33554432)-qualityFrameReserve-environmentReserve-shadowReserve-plaqueReserve-mapThumbnailReserve-suppliedThumbnailReserve-retainedMaterialBytes-benchReserve-otherReserve-snapshotReserve-materialReserve);
      let floorSettled=false,surfaceSettled=false,growAssetLimits=()=>{};
      const refreshAssetLimits=()=>{
        const materialBytes=serialMaterialPhaseBytes(floorPlan,surfacePlan,floorSettled,surfaceSettled);
        assetBudgetBytes=Math.max(1,availableAssetBytes-materialBytes-snapshotReserve-qualityFrameReserve);
        transitionBudgetBytes=Math.max(assetBudgetBytes,(resources?.maxTransitionBytes??resources?.maxCacheBytes??33554432)-qualityFrameReserve-environmentReserve-shadowReserve-plaqueReserve-mapThumbnailReserve-suppliedThumbnailReserve-retainedMaterialBytes-benchReserve-otherReserve-snapshotReserve-materialBytes);
        renderer.domElement.dataset.materialBudget=JSON.stringify({phase:floorSettled&&surfaceSettled?'resident':'loading',materialBytes,retainedMaterialBytes,mapThumbnailReserve,suppliedThumbnailReserve,assetBudgetBytes,transitionBudgetBytes});
        const quality=renderer.domElement.dataset.renderQuality;
        if(quality)renderer.domElement.dataset.renderQuality=JSON.stringify({...JSON.parse(quality),assetBudgetBytes});
        growAssetLimits();
      };
      const releaseMaterialLoadHold=(kind:'floor'|'surface')=>{
        if(disposed||gpuLost)return;
        if(kind==='floor')floorSettled=true;else surfaceSettled=true;
        refreshAssetLimits();
      };
      const scene = new three.Scene();
      scene.background = new three.Color("#e9e9e1");
      const model = new three.Group(),
        owned: Array<{ dispose: () => void }> = [];
      scene.add(model);owned.push(floorTextures,surfaceTextures);if(workspaceTextures)owned.push(workspaceTextures);
      const spaceLighting=spaceLightingFor(document);
      const roomBaseLightIds = new Set(lightDetailsFor(document)
        .filter(details => details.purpose === 'room-base')
        .map(details => details.lightId.toLowerCase()));
      // A room default adds local fill without changing the exhibition-wide
      // fallback selected by the existing, explicitly authored lights.
      const hasAuthoredLighting = document.lights.some(light => !roomBaseLightIds.has(light.id.toLowerCase()));
      const hemisphere = new three.HemisphereLight(
          0xffffff,
          0x71806a,
          spaceLighting?.baselineIntensity ?? (hasAuthoredLighting ? 0.4 : 2.5),
        );
      scene.add(hemisphere);
      const sun = new three.DirectionalLight(
        0xffffff,
        spaceLighting || hasAuthoredLighting ? 0 : 3,
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
        outline.visible = editingEnabled;
        outline.userData.sceneSnapshotOverlay=true;outline.userData.dimensionReference={...room.dimensions};group.userData.dimensionOutline=outline;
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
        const workspaceBinding=workspacePlan.targets.get(surface.id.toLowerCase());
        const floorBinding=surface.type==='floor'?floorFor(document,{roomId:surface.roomId,surfaceId:surface.id}):undefined;
        if(floorBinding){const looks=floorAppearance(floorBinding,surface.id);material.color.copy(looks.color);material.roughness=looks.roughness;material.metalness=looks.metalness;if(!workspaceBinding)floorTextures.add(material,floorBinding);}
        if(workspaceBinding)workspaceTextures?.add(material,workspaceBinding);
        const surfaceBinding=workspaceBinding?undefined:surfaceTextureFor(document,surface.id);
        if(surfaceBinding){const looks=materialFor(document,surface.id);material.color.set(looks.color);material.roughness=looks.roughness;material.metalness=looks.metalness;surfaceTextures.add(material,surfaceBinding);}
        owned.push(material);surfaceMaterials.set(surface.id.toLowerCase(),material);
        if(styledWalls.has(surface.id.toLowerCase()))return;
        for (const rectangle of rectangles[index]!) {
          const geometry = new three.PlaneGeometry(
              rectangle.width,
              rectangle.height,
            ),
            mesh = new three.Mesh(geometry, material);
          if(workspaceBinding)floorUvs(three,geometry,group,workspaceBinding,rectangle);
          else if(floorBinding)floorUvs(three,geometry,group,floorBinding,rectangle);
          if(surfaceBinding)floorUvs(three,geometry,group,surfaceBinding,rectangle);
          mesh.position.set(rectangle.x, rectangle.y, 0);
          group.add(mesh);
          owned.push(geometry);
        }

      });
      const architecturalFinishes=installArchitecturalFinishes(three,document,surfaces,surfaceMaterials,workspacePlan.targets);owned.push(architecturalFinishes);
      if(architecturalFinishes.records.length)renderer.domElement.dataset.architecturalFinishes=JSON.stringify(architecturalFinishes.records);
      for (const opening of editingEnabled ? document.openings : []) {
        const geometry = new three.PlaneGeometry(
            opening.dimensions.width,
            opening.dimensions.height,
          ),
          edges = new three.EdgesGeometry(geometry);
        const material = new three.LineBasicMaterial({
            color:"#203d2c",
          }),
          line = new three.LineSegments(edges, material);
        line.userData.sceneSnapshotOverlay=true;line.userData.editorSelection={kind:"opening",id:opening.id};editTargets.set(selectionKey(line.userData.editorSelection),line);
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
      const mapPoseEuler=new three.Euler();
      const publishMapPose=()=>{
        const callback=mapCallbacks.current.onMapPose,canvas=renderer.domElement;
        if(!callback||disposed||gpuLost||xrActive.current||sharedDetail||suspendedRef.current||mapPoseOwner.current!==publicSource||canvas.ownerDocument.hidden||!canvas.isConnected||canvas.style.visibility==='hidden'||canvas.closest('[hidden],[inert]'))return;
        callback(camera.position.toArray() as [number,number,number],mapPoseEuler.setFromQuaternion(camera.quaternion,'YXZ').y,2*Math.atan(Math.tan(camera.getEffectiveFOV()*Math.PI/360)*camera.aspect)*180/Math.PI,currentWalkMode.current.walking&&!currentWalkMode.current.paused);
      };
      const mapPoseVisibility=()=>{if(!renderer.domElement.ownerDocument.hidden)publishMapPose();};
      let ownerFurnishings:ReturnType<typeof createOwnerFurnishingScene>|undefined,ownerFurnishingFrame=0;
      const render = (restore=false) => {
        if(deferredCanvasRestore&&restore!==true)return false;
        if(sharedDetail){guardOriginalDetail();if(sharedDetail&&!disposed&&!gpuLost)sharedDetail.render();return false;}
        const canvas=renderer.domElement, stamp=`${authoredFov}/${camera.fov}/${camera.aspect}/${canvas.width}/${canvas.height}`;
        if(stamp!==projectionStamp){projectionStamp=stamp;canvas.dataset.cameraProjection=JSON.stringify({width:canvas.clientWidth,height:canvas.clientHeight,aspect:camera.aspect,authoredVerticalFov:authoredFov,verticalFov:camera.fov,horizontalFov:2*Math.atan(Math.tan(camera.fov*Math.PI/360)*camera.aspect)*180/Math.PI,bufferWidth:canvas.width,bufferHeight:canvas.height,pixelBudget:framePixelBudget});}
        if (!disposed && !gpuLost && !xrActive.current) {
          const at = performance.now();
          ownerFurnishings?.enforce();
          workspaceTextures?.enforce();
          camera.updateMatrixWorld();plaques.update(camera);if(plaques.meshes.length)renderer.domElement.dataset.plaques=JSON.stringify(plaques.stats());
          shadowPass.flush();
          try { renderer.render(scene, camera); } finally { shadowPass.afterRender(); }
          // Only the current camera snapshot rides an existing rendered frame.
          // Loading, thumbnail and quality accounting retain their 200ms cadence.
          publishMapPose();
          navigationCallbacks.current.onPresencePose?.(camera.position.toArray() as [number,number,number],new three.Euler().setFromQuaternion(camera.quaternion,"YXZ").y);
          navigationCallbacks.current.onScriptPose?.(camera.position.toArray() as [number,number,number],camera.getWorldDirection(new three.Vector3()).toArray() as [number,number,number]);
          const cameraRotation = new three.Euler().setFromQuaternion(camera.quaternion,"YXZ");
          navigationCallbacks.current.onCameraPose?.(camera.position.toArray() as [number,number,number],cameraRotation.y,cameraRotation.x);
          if (trace.started)
            trace.samples.push({
              at,
              ms: performance.now() - at,
              triangles: renderer.info.render.triangles,
            });
          return true;
        }
        return false;
      };
      const remoteAvatars=new Map<string,InstanceType<typeof three.Group>>();
      let avatarResources:{body:InstanceType<typeof three.CapsuleGeometry>;head:InstanceType<typeof three.SphereGeometry>;nose:InstanceType<typeof three.BoxGeometry>;material:InstanceType<typeof three.MeshBasicMaterial>}|undefined;
      const avatarAssets=()=>{if(!avatarResources){avatarResources={body:new three.CapsuleGeometry(.14,.8,4,8),head:new three.SphereGeometry(.16,8,6),nose:new three.BoxGeometry(.07,.05,.08),material:new three.MeshBasicMaterial({color:0x987aee})};owned.push(avatarResources.body,avatarResources.head,avatarResources.nose,avatarResources.material);}return avatarResources;};
      const presenceDiagnostics=()=>{renderer.domElement.dataset.realtimeAvatars=JSON.stringify([...remoteAvatars].map(([visitorId,group])=>({visitorId,position:group.position.toArray(),yaw:group.rotation.y})));};
      const presenceScene:RealtimeScene={update:visitors=>{if(disposed||gpuLost)return;const ids=new Set(visitors.map(v=>v.visitorId));for(const [id,group]of remoteAvatars)if(!ids.has(id)){scene.remove(group);remoteAvatars.delete(id);}for(const visitor of visitors){let group=remoteAvatars.get(visitor.visitorId);if(!group){group=new three.Group();group.userData.remoteVisitorId=visitor.visitorId;const assets=avatarAssets(),body=new three.Mesh(assets.body,assets.material),head=new three.Mesh(assets.head,assets.material),nose=new three.Mesh(assets.nose,assets.material);body.position.y=-.7;head.position.y=-.12;nose.position.set(0,-.12,-.18);group.add(body,head,nose);remoteAvatars.set(visitor.visitorId,group);scene.add(group);}group.position.fromArray(visitor.position);group.rotation.y=visitor.yaw;}presenceDiagnostics();render();},clear:()=>{for(const group of remoteAvatars.values())scene.remove(group);remoteAvatars.clear();presenceDiagnostics();render();}};
      presenceDiagnostics();navigationCallbacks.current.onPresenceSceneReady?.(presenceScene);
      const catalogSettled:Promise<unknown>[]=[];
      if(benchReserve&&benchSource){const catalog=installPrivateCatalogBench(three,document,rooms,benches.groups,abort.signal,benchSource.check,()=>disposed||gpuLost,viewerBudget?.maxTriangles??20000,()=>{shadowPass.invalidate();render();},benchSource);owned.push(catalog);catalogSettled.push(catalog.start().then(status=>{if(!disposed&&!gpuLost)renderer.domElement.dataset.privateCatalogBench=status;}));}
      if(otherReserve){const catalog=installCatalogOtherVisuals(three,otherFurnishings,rooms,lightDetails.fixtures,installation.pedestals,abort.signal,()=>disposed||gpuLost,viewerBudget?.maxTriangles??20000,()=>{shadowPass.invalidate();render();});owned.push(catalog);catalogSettled.push(catalog.start().then(status=>{if(!disposed&&!gpuLost)renderer.domElement.dataset.catalogFurnishings=JSON.stringify(status);}));}
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
      const resize = (restore=false) => {
        if(deferredCanvasRestore&&restore!==true)return;
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
        render(restore);
      };
      resizeAction.current = resize;
      renderer.domElement.setAttribute("aria-label", "전시 공간 3D 미리보기");
      renderer.domElement.setAttribute("role", "img");
      const lost = (event: Event) => {
        event.preventDefault();
        gpuLost = true;setDetailRestoreStatus(null);
        if(hasWorkspaceFurnishings){ownerFurnishings?.dispose();cancelAnimationFrame(ownerFurnishingFrame);ownerWorkspaceFurnishings?.invalidate();}
        clearQualityFrame();
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
        const issue = "3D 화면 연결이 중단됐어요. 작품 목록을 이용하거나 ‘3D 다시 시작’을 눌러 주세요.";
        setPublicMessage(issue);
        setSceneIssue(issue);
        setMessage(
          viewerBudget
            ? "3D 그래픽 연결이 중단되었습니다. 작품 목록을 계속 사용할 수 있습니다. 3D 다시 시작으로 재시도할 수 있습니다."
            : "3D 그래픽 연결이 중단되었습니다. 작품 metadata와 저장본은 유지됩니다. JSON과 숫자 편집을 사용할 수 있습니다.",
        );
      };
      renderer.domElement.addEventListener("webglcontextlost", lost);
      host.current.replaceChildren(renderer.domElement);
      const qualityView=publicQualityView.current;
      const restoreQuality=immersive&&qualityView?.scope===qualityScope&&qualityView.document===document&&qualityView.budget!==viewerBudget?qualityView:undefined;

      // Panel scope requires the attached public canvas; before attachment its
      // closest publication shell is null.
      if (immersive) panelResume = installPanelResume(renderer.domElement, (reason = "panel") => walkingActions.current?.pause(reason), () => walkingActions.current?.start(), available => { if(!disposed)setPanelResumeAvailable(available); }, () => !disposed && !gpuLost && !suspendedRef.current && !xrActive.current&&viewingStyleRef.current==='free', !!restoreQuality?.walking);
      detailEntry.current.resumeViewing = () => {
        const intent = panelResume?.intent();
        cancelAnimationFrame(resumeFrame);
        resumeFrame = requestAnimationFrame(() => { resumeFrame = 0; if (!disposed) intent?.(); });
      };
      const observer = new ResizeObserver(()=>resize());
      observer.observe(host.current);
      controls.addEventListener("change", ()=>{render();});
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
      let privateCameraRestored=false;
      if(restoreQuality){camera.position.fromArray(restoreQuality.position);camera.quaternion.fromArray(restoreQuality.quaternion);controls.target.fromArray(restoreQuality.target);authoredFov=restoreQuality.fov;applyProjection();controls.update();render();}
      const savedCamera=editorCamera.current,savedInRoom=savedCamera&&document.rooms.some(room=>safePrivateView(document,{roomId:room.id,position:savedCamera.position,target:savedCamera.target,fov:savedCamera.fov}));
      if((editingRef.current||privateCatalogue)&&savedCamera?.documentId===document.id&&(!privateCatalogue||savedInRoom)){const saved=savedCamera;camera.position.fromArray(saved.position);camera.quaternion.fromArray(saved.quaternion);controls.target.fromArray(saved.target);if(privateCatalogue)controls.target.copy(boundedOrbitTarget(camera.position,controls.target,controls.minDistance,controls.maxDistance));camera.fov=saved.fov;camera.updateProjectionMatrix();controls.update();render();privateCameraRestored=privateCatalogue;}
      else if(privateCatalogue){const initial=safePrivateView(document,privateViewInitial.current);if(initial){camera.position.fromArray(initial.position);controls.target.fromArray(initial.target);controls.target.copy(boundedOrbitTarget(camera.position,controls.target,controls.minDistance,controls.maxDistance));camera.fov=initial.fov;camera.updateProjectionMatrix();camera.lookAt(controls.target);controls.update();render();privateCameraRestored=true;}}
      // A private capture's validated pose also guides ordinary visibility-based
      // loading. It does not change the document or waive target/ray checks.
      if(initialSnapshotPose){camera.position.fromArray(initialSnapshotPose.position);controls.target.fromArray(initialSnapshotPose.target);authoredFov=initialSnapshotPose.fov;applyProjection();camera.lookAt(controls.target);controls.update();render();}
      privateViewCallback.current?.(()=>{
        if(disposed||xrActive.current)return;
        const position=camera.position.toArray() as [number,number,number],direction=camera.getWorldDirection(new three.Vector3()),target=camera.position.clone().add(direction).toArray() as [number,number,number];
        for(const room of document.rooms){const view=safePrivateView(document,{roomId:room.id,position,target,fov:camera.fov});if(view)return view;}
        return undefined;
      });
      setMessage(
        `공간 ${document.rooms.length} · 표면 ${document.surfaces.length} · 실제 개구부 ${document.openings.length}. 작품 bounds는 실제 치수입니다. 작품 derivative 미사용: metadata만 표시합니다.`,
      );
      setReady(true);
      if(immersive)renderer.domElement.tabIndex=0;
      setPublicMessage(document.placements.length ? "공간을 볼 수 있어요. 가까운 작품부터 불러오고 있어요." : "전시 공간을 볼 수 있어요.");
      const xrArtworks=new Map<string,GeometryXrArtwork>();
      let xrSaved:{position:typeof camera.position;quaternion:typeof camera.quaternion;up:typeof camera.up;target:typeof controls.target}|null=null;
      const xrBridge:GeometryXrBridge={renderer,camera,scene,artworks:()=>[...xrArtworks.values()],frame:callback=>{renderer.setAnimationLoop(callback?guardedXrFrame(()=>{ownerFurnishings?.enforce();workspaceTextures?.enforce();},()=>shadowPass.flush(),()=>shadowPass.afterRender(),callback):null);},suspend:active=>{if(disposed)return;if(active&&!xrActive.current){cameraInvalidate.current?.();xrSaved={position:camera.position.clone(),quaternion:camera.quaternion.clone(),up:camera.up.clone(),target:controls.target.clone()};walkingActions.current?.stationary();walkingActions.current?.pause();cancelAnimationFrame(trace.frame);controls.enabled=false;}xrActive.current=active;setXrRunning(active);if(!active){if(xrSaved){camera.position.copy(xrSaved.position);camera.quaternion.copy(xrSaved.quaternion);camera.up.copy(xrSaved.up);controls.target.copy(xrSaved.target);xrSaved=null;}controls.enabled=!suspendedRef.current&&!currentWalkMode.current.walking&&!editingRef.current?.disabled&&!renderer.domElement.ownerDocument.hidden&&!renderer.domElement.closest('[hidden],[inert]');render();}}};
      if(publicSource&&viewerBudget)xrCallbacks.current.onXrReady?.(xrBridge);
      const resetCameraMapping=()=>{controls.touches.ONE=three.TOUCH.ROTATE;controls.mouseButtons.LEFT=three.MOUSE.ROTATE;};
      const editorOrbitAvailable=()=>{const bridge=editingRef.current,canvas=renderer.domElement;return !disposed&&!gpuLost&&!!bridge&&!bridge.disabled&&!canvas.ownerDocument.hidden&&canvas.ownerDocument.hasFocus()&&!canvas.closest('[hidden],[inert]')&&canvas.style.visibility!=='hidden'&&!suspendedRef.current&&!xrActive.current&&!currentWalkMode.current.walking&&!seatedBenchRef.current&&viewingStyleRef.current==='free';};
      const resetEditorOrbit=(ids:readonly number[])=>{if(disposed)return;controls.disconnect();for(const id of ids)if(renderer.domElement.hasPointerCapture(id))renderer.domElement.releasePointerCapture(id);controls.connect(renderer.domElement);controls.enabled=editorOrbitAvailable();};
      const editor=editingRef.current ? installPreviewEditing({scene,camera,renderer,model,targets:editTargets,orbit:controls,bridge:()=>editingRef.current,resetOrbit:resetEditorOrbit,resumeOrbit:()=>{if(editorOrbitAvailable())controls.enabled=true;},onCameraReset:reason=>{resetCameraMapping();cameraInteractionCallbacks.current.onCameraInteractionReset?.(reason);},previewDocument:(doc,selection)=>{if(!disposed&&selection.kind==='placement')setInstallationIssueCount(installation.preview(doc,selection.id));},render:()=>{shadowPass.invalidate();render();}}):null;
      cameraInvalidate.current=editor?()=>editor.invalidate():null;
      const cameraInteraction=(mode:CameraInteractionMode,forceReset=false,frameToken?:string,resetReason:'hidden'|'unavailable'='unavailable')=>{const bridge=editingRef.current,canvas=renderer.domElement;if(!editor||disposed)return false;if(forceReset&&mode==='object'){editor.invalidate(resetReason);resetCameraMapping();return true;}if(gpuLost||!bridge||bridge.disabled||cameraAppliedToken.current!==frameToken||bridge.document!==document&&!onlyLightColorChanged(document,bridge.document)||canvas.ownerDocument.hidden||canvas.closest('[hidden],[inert]')||canvas.style.visibility==='hidden'||suspendedRef.current||xrActive.current||currentWalkMode.current.walking||seatedBenchRef.current||viewingStyleRef.current!=='free')return false;if(!editor.setCameraMode(mode))return false;controls.touches.ONE=mode==='camera-pan'?three.TOUCH.PAN:three.TOUCH.ROTATE;controls.mouseButtons.LEFT=mode==='camera-pan'?three.MOUSE.PAN:three.MOUSE.ROTATE;return true;};
      cameraInteractionSetter.current=editor?cameraInteraction:null;cameraInteractionCallbacks.current.onCameraInteractionReady?.(cameraInteractionSetter.current);
      const editorFocus=()=>{if(editorOrbitAvailable())controls.enabled=true;};
      if(editor)window.addEventListener('focus',editorFocus);
      editingSync.current=()=>{const bridge=editingRef.current,changed=syncPreviewLightColors(scriptLights,bridge?.document??document,bridge?.preview,bridge?.previewLightId);if(changed)shadowPass.invalidate();if(bridge)editor?.sync();else {editor?.invalidate();if(changed)render();}};
      if(editingRef.current)editingSync.current();
      release = () => {
        ownerFurnishings?.dispose();cancelAnimationFrame(ownerFurnishingFrame);
        snapshotCallback.current?.(null);
        if(mapPoseRefresh.current===publishMapPose)mapPoseRefresh.current=null;
        renderer.domElement.ownerDocument.removeEventListener('visibilitychange',mapPoseVisibility);
        sharedDetail?.dispose();
        entranceScope.current?.close();entranceSceneCallback.current?.(null);
        privateViewCallback.current?.(null);
        if(immersive&&viewerBudget&&!seatedBenchRef.current&&!xrActive.current&&viewingStyleRef.current==='free')publicQualityView.current={scope:qualityScope,document,budget:viewerBudget,position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),target:camera.position.clone().add(camera.getWorldDirection(new three.Vector3()).multiplyScalar(2)).toArray(),fov:authoredFov,walking:currentWalkMode.current.walking};
        else publicQualityView.current=null;
        if(editingEnabled||privateCatalogue)editorCamera.current={documentId:document.id,position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),target:controls.target.toArray(),fov:camera.fov};
        xrCallbacks.current.onXrReady?.(null);xrCallbacks.current.onXrArtworks?.([]);renderer.setAnimationLoop(null);xrActive.current=false;xrArtworks.clear();
        placementRelease();placementSync.current=null;
        cameraInteractionSetter.current=null;cameraInteractionCallbacks.current.onCameraInteractionReady?.(null);cameraInvalidate.current=null;if(editor)window.removeEventListener('focus',editorFocus);editor?.dispose();editingSync.current=null;
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
      mapPoseRefresh.current=publishMapPose;
      if(publicSource)renderer.domElement.ownerDocument.addEventListener('visibilitychange',mapPoseVisibility);
      void loadMaterialPhases(
        async()=>{const changed=()=>{if(!disposed&&!gpuLost){shadowPass.invalidate();render();}};const status=await floorTextures.start(changed),workspaceStatus=workspaceTextures?await workspaceTextures.start(changed):{};if(!disposed&&!gpuLost)renderer.domElement.dataset.floorTextures=JSON.stringify({status:{...status,...workspaceStatus},maxSize:floorPlan.maxSize,reserveBytes:floorPlan.reserveBytes,residentBytes:floorPlan.residentBytes});},
        async()=>{const status=await surfaceTextures.start(()=>{if(!disposed&&!gpuLost){shadowPass.invalidate();render();}});if(!disposed&&!gpuLost){renderer.domElement.dataset.surfaceTextures=JSON.stringify({status,reserveBytes:surfacePlan.reserveBytes,residentBytes:surfacePlan.residentBytes,geometryReserve:surfacePlan.geometryReserve});setMaterialIssueCount(Object.values(status).filter(value=>value!=='ready').length);}},
        (kind,error)=>{
          if(error&&!disposed&&!gpuLost){
            const plan=kind==='floor'?floorPlan:surfacePlan,status=Object.fromEntries([...plan.packs.map(pack=>pack.id),...plan.blocked].map(id=>[id,'fallback']));
            renderer.domElement.dataset[kind==='floor'?'floorTextures':'surfaceTextures']=JSON.stringify({status,reserveBytes:plan.reserveBytes,residentBytes:plan.residentBytes});
            if(kind==='surface')setMaterialIssueCount(Object.keys(status).length);
          }
          releaseMaterialLoadHold(kind);
        },()=>disposed||gpuLost||abort.signal.aborted,
      );
      // Async environment setup starts only AFTER scene teardown is registered.
      // Failed/cancelled generation keeps the existing lighting and text/navigation.
      void installReferenceEnvironment(three,renderer,scene,environmentReserve,compactQuality,()=>disposed||gpuLost).then(environment=>{
        if(!environment)return;
        if(disposed||gpuLost){environment.dispose();return;}
        owned.push(environment);scene.environmentIntensity=spaceLighting?.reflectionIntensity ?? .45;
        hemisphere.intensity=spaceLighting?.baselineIntensity ?? (hasAuthoredLighting ? .2 : .6);
        if(!spaceLighting&&!daylight&&!hasAuthoredLighting)sun.intensity=2;
        reportSpaceLighting();
        renderer.domElement.dataset.renderQuality=JSON.stringify({tone:referenceTone,exposure:1,environmentSize:environment.size,environmentReserveBytes:environmentReserve,shadowReserveBytes:shadowReserve,assetBudgetBytes});
        render();
      }).catch(()=>{if(!disposed)renderer.domElement.dataset.renderQuality=JSON.stringify({tone:referenceTone,exposure:1,environment:'unavailable',assetBudgetBytes});});
      orbitEnabled.current = (enabled) => { controls.enabled = enabled&&!xrActive.current&&!seatedBenchRef.current&&!editingRef.current?.disabled&&!renderer.domElement.ownerDocument.hidden&&!renderer.domElement.closest('[hidden],[inert]')&&viewingStyleRef.current==='free'; };
      if (suspendedRef.current) controls.enabled = false;
      if (viewerBudget) {
        renderer.domElement.tabIndex = 0;
        renderer.domElement.setAttribute(
          "aria-describedby",
          "walking-instructions",
        );
        let initialization: Promise<void> | undefined;
        const tryBenchAction=(benchId:string,seated:boolean)=>{
          if(disposed||gpuLost||xrActive.current||suspendedRef.current||sharedDetail||
            viewingStyleRef.current!=='free'||renderer.domElement.ownerDocument.hidden)return false;
          const canvas=renderer.domElement,shell=canvas.closest('.publication-shell');
          if(shell?.querySelector('details[data-visitor-panel][open]')||
            canvas.ownerDocument.querySelector('dialog[open],[aria-modal="true"]'))return false;
          const actions=walkingActions.current;
          if(seated){
            if(seatedBenchRef.current!==benchId||!actions?.stand)return false;
            actions.stand();
            return seatedBenchRef.current===null;
          }
          return !seatedBenchRef.current&&nearbyBenchRef.current===benchId&&actions?.sitNearby?.(benchId)===true;
        };
        benchAction.current=tryBenchAction;
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
                initialWalking:restoreQuality?.walking,
                signal:abort.signal,
                controls,
                canvas: renderer.domElement,
                // A dialog may focus before the suspension effect, and Safari can
                // report null relatedTarget. The existing committed entry still
                // identifies this temporary obstruction without erasing its base stop.
                isPanelFocus: target => target===benchActionButton.current || committedEntry.current !== null || suspendedRef.current || !!panelResume?.isPanelFocus(target),
                resumeMovement: () => viewingStyleRef.current==='free'&&(panelResume?.movement(!gpuLost && !suspendedRef.current && !xrActive.current) ?? false),
                resumeDrag: () => viewingStyleRef.current==='free'&&(panelResume?.drag(!gpuLost && !suspendedRef.current && !xrActive.current) ?? false),
                settings: { ...walkSettingsRef.current },
                render,
                onState: (state) => {
                  if(disposed)return;
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
                resumeBenchArrow: () => viewingStyleRef.current==='free' && panelResume?.isBenchReturn() === true &&
                  panelResume.movement(!gpuLost && !suspendedRef.current && !xrActive.current),
                wasWalkingBeforeSeat:()=>panelResume?.wasWalkingBeforeSeat()??false,
                onNearbyBench:id=>{
                  if(disposed)return;
                  nearbyBenchRef.current=id;setNearbyBenchId(id);
                },
                activateBench:()=>{
                  const button=benchActionButton.current,id=button?.dataset.benchAction;
                  return !!id&&!!button?.getClientRects().length&&tryBenchAction(id,button.dataset.benchSeated==='true');
                },
                onSeat:id=>{
                  if(disposed)return;
                  seatedBenchRef.current=id;setSeatedBenchId(id);
                  if(id){
                    const menu=renderer.domElement.closest(".publication-shell")?.querySelector<HTMLDetailsElement>("details.publication-menu[open]");
                    if(menu)menu.open=false;
                  }
                },
                onViewpointFov:fov=>{authoredFov=fov;applyProjection();},
                onMode: (walking, paused, reason) => {
                  if(disposed)return;
                  panelResume?.mode(walking, paused, reason);
                  currentWalkMode.current = { walking, paused };
                  publishMapPose();
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
              if(restoreQuality)qualityRebuildReady.current=true;
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
          start: (shouldFocus) => {
            void initialize(undefined,privateCameraRestored).then(() => {
              if (!disposed && !xrActive.current && !suspendedRef.current && walkingActions.current !== pending)
                walkingActions.current?.start(shouldFocus);
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
        if(restoreQuality)void initialize(undefined,true);
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
                adapter=created;walkingActions.current=created.actions;setWalkPreparation('ready');created.actions.start(focusEntry);
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
      let publicDisplayStopped = false;
      const stopPublicDisplay=()=>{
        publicDisplayStopped = true;setDetailRestoreStatus(null);
        sculptureOrbitRuntime.current?.dispose();sculptureOrbitRuntime.current=null;setSculptureOrbitState(undefined);
        sharedDetailUnavailable?.('rights');sharedDetail?.dispose();renderer.domElement.style.visibility='hidden';
        mapThumbnailRefresh.current?.();
        const issue = "공개 상태를 확인할 수 없어 작품 표시를 중단했어요. 작품 목록을 이용해 주세요.";
        setReady(false);
        setPublicMessage(issue);
        setSceneIssue(issue);
      };
      const readArtworkBytes = async (
        artwork: Document["artworks"][number], inventory: Document["artworks"][number]["assets"][number], taskSignal:AbortSignal, progress?:(bytes:number)=>void,
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
            cacheHits++;progress?.(bytes.byteLength);
          } else {
            bytes = await fetchVerifiedAsset({
              ...publicSource,
              asset: source,
              inventory,
              signal,progress,
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
        imageBudget = viewerBudget,
        onCleanDecodeFailure?:()=>void,
        progress?:(bytes:number)=>void,
      ) => {
        const signal=AbortSignal.any([abort.signal,taskSignal]);
        const bytes=await readArtworkBytes(artwork,inventory,signal,progress);
        stage?.('verified-download');
        reserveDecode?.(bytes!);
        stage?.(artwork.artworkType==='image'?'cpu-image-decode':'cpu-glb-parse');
        const resources: Array<{ dispose: () => void }> = [];let glbMayOwnAsync=false;
        try {
          let object: InstanceType<typeof three.Object3D>;
          let retainedModelBytes=0,decodeBackingReleased=false;
          if (artwork.artworkType === "image") {
            const sourceSize=imageBudget?checkImageDecode(bytes!,artwork,inventory,imageBudget):undefined;
            let imageWidth=0,imageHeight=0;
            const bitmap=await decodeArtworkBitmap(bytes!,imageBudget,signal,bitmap=>{
              // Use the authored tier aspect before any GPU-budget resize rounds it again.
              imageWidth=bitmap.width;
              imageHeight=bitmap.height;
              if(sourceSize&&(bitmap.width!==sourceSize.width||bitmap.height!==sourceSize.height))throw Error('IMAGE_DECODE_BUDGET');
              const declared=lodVariantsFor(artwork).find(v=>v.assetId.toLowerCase()===inventory.id.toLowerCase())?.textureSize;
              if(publicSource&&declared!==undefined&&Math.max(bitmap.width,bitmap.height)>declared)throw Error('DECODE_VARIANT_UNDERCLAIM');
            });
            resources.push({dispose:()=>bitmap.close()});
            if(disposed||signal.aborted)throw Error('DISPOSED');
            const texture = new three.Texture(bitmap);
            texture.colorSpace = three.SRGBColorSpace;
            texture.needsUpdate = true;
            resources.push(texture);
            const face=containedImageSize({...artwork.dimensions,imageWidth,imageHeight});
            const geometry = new three.PlaneGeometry(face.width,face.height);
            const material = new three.MeshStandardMaterial({
              map: texture,
              side: three.DoubleSide,
              roughness:1,metalness:0,
            });
            resources.push(geometry, material);
            object = new three.Mesh(geometry, material);
            decodeBackingReleased=true;
          } else {
            const {GLTFLoader,basis}=await prepareArtworkGlb(renderer,bytes!,signal,value=>{glbMayOwnAsync=value;});
            const manager = new three.LoadingManager();
            if(basis)resources.push(basis);
            if(disposed||signal.aborted){basis?.dispose();throw new DOMException('Aborted','AbortError');}
            const protectedBytes = embeddedPNGManager(manager, bytes!,basis);
            resources.push(protectedBytes);
            // Pin an identical cached allocation; independently retained bytes
            // stay charged even when the original encoded entry is evicted.
            const backing=retainEncodedBuffer(byteCache,inventory.id,protectedBytes.bytes);
            resources.push(backing);retainedModelBytes=backing.retainedBytes;
            const cancelDecode=()=>protectedBytes.dispose();signal.addEventListener("abort",cancelDecode,{once:true});
            glbMayOwnAsync=true;let gltf;try{const loader=new GLTFLoader(manager);if(protectedBytes.ktx2Loader)loader.setKTX2Loader(protectedBytes.ktx2Loader as never);gltf=await loader.parseAsync(protectedBytes.bytes, "");}finally{signal.removeEventListener("abort",cancelDecode);}
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
            if(protectedBytes.releaseEncoded()){backing.dispose();retainedModelBytes=0;decodeBackingReleased=true;}
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
          const geometryBytes=geometryResidentBytes(geometryAttributes);
          const textureBytes=decodedBytes-retainedModelBytes;
          decodedBytes+=geometryBytes;
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
          object.userData.viewerAssetId=inventory.id;
          object.userData.viewer = {
            triangles,
            decodedBytes,
            ...(diagnosticsEnabled()?{geometryEstimateBytes:geometryBytes,textureEstimateBytes:textureBytes}:{}),
            retainedModelBytes,
            decodeBackingReleased,
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
          let clean=true;for (const resource of resources)try{resource.dispose();}catch{clean=false;}
          if(clean&&!(error instanceof ArtworkBitmapCleanupError)&&(artwork.artworkType==='image'||!glbMayOwnAsync))onCleanDecodeFailure?.();
          throw error;
        }
      };
      if(snapshotEnabled&&snapshotReserve===SCENE_SNAPSHOT_RESERVE_BYTES){
        const posesMatch=()=>{try{for(const target of editTargets.values()){const selection=target.userData.editorSelection as EditorSelection|undefined;if(!selection)continue;const expected=localPose(document,selection);if(target.position.distanceToSquared(new three.Vector3(...expected.position))>1e-12||target.scale.distanceToSquared(new three.Vector3(...expected.scale))>1e-12||1-Math.abs(target.quaternion.clone().normalize().dot(new three.Quaternion(...expected.rotation).normalize()))>1e-8)return false;}return true;}catch{return false;}};
        const valid=()=>!disposed&&!gpuLost&&!xrActive.current&&!sharedDetail&&!entranceScope.current&&!suspendedRef.current&&!renderer.domElement.ownerDocument.hidden&&renderer.domElement.isConnected&&!renderer.domElement.closest('[hidden],[inert]')&&!editor?.busy&&!editingRef.current?.preview&&cameraAppliedToken.current===snapshotFrameToken.current&&(!editingRef.current||editingRef.current.document===document||onlyLightColorChanged(document,editingRef.current.document))&&posesMatch();
        snapshotCallback.current?.({get document(){return editingRef.current?.document??document;},idle:valid,capture:async(request,signal)=>{
          // The native owner captures only its idle screen, never a nested
          // render target belonging to another render pass.
          if(request.width!==640||request.height!==360||!valid()||renderer.getRenderTarget()!==null)throw Error('SCENE_SNAPSHOT_UNAVAILABLE');
          const placement=document.placements.find(p=>p.id===request.placementId);
          const group=placements.get(request.placementId.toLowerCase()),art=document.artworks.find(a=>a.revisionId===placement?.artworkRevisionId);
          const admitted=group?.children.find(node=>node.userData.viewer&&typeof node.userData.viewerAssetId==='string'),assetId=admitted?.userData.viewerAssetId as string|undefined;
          if(!placement||!group||!art||!assetId||!art.assets.some(a=>a.id===assetId))throw Error('SCENE_SNAPSHOT_TARGET_NOT_READY');
          let snapshotCamera:SceneSnapshotCamera;
          if('inspectionCamera' in request){
            snapshotCamera=inspectionCameraPose(document,placement.id,request.inspectionCamera);
            assertArtworkViewpoint(three,group,art.artworkType,snapshotCamera);
          }else{
            const view=presentationFor(document).viewpoints.find(v=>v.id===request.viewpointId);
            if(!view||view.roomId!==placement.roomId)throw Error('SCENE_SNAPSHOT_TARGET_NOT_READY');
            const pose=viewpointPose(document,request.viewpointId);
            snapshotCamera={viewpointId:view.id,roomId:view.roomId,position:pose.position,target:pose.target,fov:pose.fov};
          }
          ownerFurnishings?.enforce();
          return captureScenePng({three,renderer,scene,beforeDiagnostics:()=>ownerFurnishings?.enforce(),near:camera.near,far:camera.far,camera:snapshotCamera,target:group,occluders:model,placementId:placement.id,artworkRevisionId:art.revisionId,assetId,signal,withoutOverlays:draw=>{const overlays:{node:import('three').Object3D;visible:boolean}[]=[];model.traverse(node=>{if(node.userData.sceneSnapshotOverlay)overlays.push({node,visible:node.visible});});try{for(const item of overlays)item.node.visible=false;ownerFurnishings?.enforce();if(editor)editor.withoutOverlays(draw);else draw();}finally{for(const item of overlays)item.node.visible=item.visible;}},valid});
        }});
      }
      if(!publicSource&&editingEnabled&&placementInstaller.current){
        const preview=placementInstaller.current({scene,model,camera,renderer,rooms,surfaces,render,
          load:async(artwork,signal)=>{
            const owner=ownerFurnishings;
            if(hasWorkspaceFurnishings&&!owner)throw Error('WORKSPACE_SCENE_BUDGET');
            const reserveGeometry=(object:InstanceType<typeof three.Object3D>)=>{if(!owner)return ()=>{};const cost=existingSceneCost(three,object,true);return owner.reservePreview(cost.draws+1,cost.triangles);};
            const shared=sources.get(artwork.revisionId);
            if(shared){const object=await shared;signal.throwIfAborted();const key=`owner-preview-art:${crypto.randomUUID()}`;if(owner)owner.ledger.reserve(key,1024*1024);let unreserve:()=>void;try{unreserve=reserveGeometry(object);}catch(error){owner?.ledger.release(key);throw error;}let done=false;return {object,release:()=>{if(!done){done=true;unreserve();owner?.ledger.release(key);}}};}
            const inventory=artwork.assets.find(a=>a.id===artwork.primaryAssetId);if(!inventory)throw Error('WORKSPACE_SCENE_BUDGET');
            const key=`owner-preview-art:${crypto.randomUUID()}`;let decodeReserve=0;const hold=owner?new OwnerArtworkHold(owner.ledger,key,inventory.bytes*4+1024*1024):undefined;
            try{
              const object=await loadArtwork(artwork,undefined,signal,owner?bytes=>{decodeReserve=assetDecodeReserve(artwork,inventory,ownerWorkspaceFurnishings!.budget,bytes)+1024*1024;hold!.reserveDecode(decodeReserve);}:undefined,undefined,ownerWorkspaceFurnishings?.budget,()=>hold?.markCleanFailure());
              const resources=decodedResources.get(object)??[];decodedResources.delete(object);let unreserve:()=>void;
              try{if(owner){const actual=object.userData.viewer?.decodedBytes;if(!Number.isSafeInteger(actual)||actual<0)throw Error('WORKSPACE_SCENE_BUDGET');owner.ledger.reserve(key,Math.max(decodeReserve,actual+1024*1024));}unreserve=reserveGeometry(object);}catch(error){let failed=false;for(const r of resources)try{r.dispose();}catch{failed=true;}if(!failed)hold?.release();throw error;}
              let released=false;return {object,release:()=>{if(released)return;released=true;let failed=false;for(const r of resources)try{r.dispose();}catch{failed=true;}if(!failed){unreserve();hold?.release();}}};
            }catch(error){hold?.failure();throw error;}
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
        const mapThumbnailValid=()=>!!mapCallbacks.current.onMapThumbnail&&!!mapThumbnailEnabled.current&&!disposed&&!gpuLost&&renderer.domElement.style.visibility!=='hidden';
        const mapThumbnail=createMapThumbnailRoster({
          ids:mapImageIds,
          valid:mapThumbnailValid,
          allowed:()=>mapThumbnailValid()&&!suspendedRef.current,
          exclude:id=>{const p=document.placements.find(v=>v.id.toLowerCase()===id.toLowerCase());return !!p&&!!suppliedThumbnailRef.current?.[p.artworkRevisionId.toLowerCase()];},
          image:id=>{
            const placement=document.placements.find(p=>p.id.toLowerCase()===id.toLowerCase());
            const art=document.artworks.find(a=>a.revisionId.toLowerCase()===placement?.artworkRevisionId.toLowerCase());
            if(art?.artworkType!=='image')return;
            let image:ImageBitmap|undefined;
            objects.get(art.revisionId)?.traverse(node=>{if(!image&&node instanceof three.Mesh){const materials=Array.isArray(node.material)?node.material:[node.material];for(const material of materials){const candidate=(material as InstanceType<typeof three.MeshStandardMaterial>).map?.image;if(candidate instanceof ImageBitmap){image=candidate;break;}}}});
            return image;
          },
          changed:items=>mapCallbacks.current.onMapThumbnail?.(items.length?{publicationId:publicSource.publicationId,items,revisionSha256:publicSource.revisionSha256}:null),
        });
        mapThumbnailRefresh.current=mapThumbnail.refresh;
        const mapPins=new Map<string,number>(),mapWaiters=new Set<()=>void>();
        let detailPinned:InstanceType<typeof three.Object3D>|undefined,detailPinnedArtwork:string|undefined,detailRetired=false;
        let detailImageCandidate:InstanceType<typeof three.Object3D>|undefined;
        let detailBudgetWait:{assetId:string;bytes:number;phase:'resident'|'transition'}|undefined;
        let settleDetail:(()=>void)|undefined,cancelDetail:(()=>void)|undefined,retryFlatDetail:(()=>void)|undefined,retryOriginalDetail:(()=>void)|undefined;
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
        // Keep only the verified header cost when expendable encoded bytes are
        // evicted. Losing the bytes must not restart an impossible warm fetch.
        const imageDecodeCeilings=new Map<string,number>();
        const diagnosticEvents=createDiagnosticEvents();
        const stages=createPreparationStages(document.artworks,()=>performance.now(),key=>tasks.has(key),diagnosticsEnabled()?diagnosticEvents.record:undefined);
        const stage=stages.record;
        let currentArtwork:string|undefined;
        let preparing=new Set<string>();
        const reclaiming=new Set<string>(), lastAttended=new Map<string,number>(), observedVisible=new Map<string,boolean>(), observedEligible=new Map<string,boolean>();
        const minimumObjects=new Map<string,{assetId:string;object:InstanceType<typeof three.Object3D>}>(), minimumBlocked=new Set<string>(),materialBudgetDeferred=new Map<string,{full:boolean;prepareOnly:boolean;detailPromotion:boolean;manual:boolean}>();
        // Remember the measured resident requirement so an unchanged budget
        // does not decode and discard the same visible minimum every five seconds.
        const residentMinimumWait=new Map<string,{bytes:number;assetId:string}>();
        let residentRecoveryCancelled=false;
        const retryWaitingMinimum=(id:string,required:number,needed:boolean)=>retryResidentMinimum({required,needed,pending:pending.has(id),used:()=>peak.total(),limit:()=>assetBudgetBytes,reclaim:deficit=>reclaimOffroom(id,deficit)});
        let materialRetryEpoch=0;
        let minimumRoomId:string|undefined,minimumRooms:ReadonlySet<string>=new Set();
        const placeholders=new Map([...placements].map(([id,group])=>[id,[...group.children]]));
        let sequence=0, automatic=true, manualFull=false;
        const demandContext=()=>artworkDemandContext(currentArtwork,detailPinnedArtwork);
        const detailBytes=()=>(detailRetired?(detailPinned?.userData.viewer?.decodedBytes??0):0)+(detailImageCandidate?.userData.viewer?.decodedBytes??0);
        const resident=()=>[...objects.values(),...[...prepared.values()].map(v=>v.object),...[...minimumObjects.values()].map(v=>v.object)].reduce((sum,value)=>sum+(value.userData.viewer?.decodedBytes??0),detailBytes())+byteCache.stats().bytes;
        const selectedBudget=(art:(typeof arts)[number],asset?:typeof art.assets[number])=>{
          const image=selectedImageDetail(art,viewerBudget)?.budget;
          if(image||art.artworkType!=='sculpture')return image;
          return stagingHayesDetailBudget({
            enabled:diagnosticsEnabled(),indexSha256:publicSource.detailPublication?.local?.verifiedIndexSha256,
            assetSha256:(asset??art.assets.find(value=>value.id===art.primaryAssetId))?.sha256,
            deviceMemory:(navigator as Navigator&{deviceMemory?:number}).deviceMemory,
            coarsePointer:matchMedia('(pointer: coarse)').matches,finePointer:matchMedia('(pointer: fine)').matches,budget:viewerBudget,
          });
        };
        let diagnosticPeak=0,diagnosticPeakTexture=0,diagnosticPeakMesh=0;
        let diagnosticOriginal:{artworkRevisionId:string;sha256:string}|null=null;
        let diagnosticDrawn:{assetId:string;tier:'approved-full'|'lightweight'}|null=null;
        let diagnosticDetailPlacement:string|null=null;
        let diagnosticOriginalLimits:{transition:number;scene:number}|null=null;
        const peak=new AssetPeakBudget(transitionBudgetBytes,resident,diagnosticsEnabled()?total=>{diagnosticPeak=Math.max(diagnosticPeak,total);}:undefined);
        const unregisterDiagnostic=registerDiagnosticSource(()=>{
          const history=readRuntimeHistory(renderer.domElement.ownerDocument),records=stages.snapshot();
          const recent=new Map(records.map(row=>[row.assetId,row]));
          const all=arts.flatMap(art=>art.assets.map(asset=>({art,asset})));
          const selectedId=detailPinnedArtwork??currentArtwork??null,selectedArt=arts.find(art=>art.revisionId===selectedId);
          all.sort((a,b)=>Number(b.art.revisionId===selectedId)-Number(a.art.revisionId===selectedId)||Number(recent.has(b.asset.id.toLowerCase()))-Number(recent.has(a.asset.id.toLowerCase())));
          const memory=(navigator as Navigator&{deviceMemory?:number}).deviceMemory;
          const values=[...objects.values(),...[...prepared.values()].map(v=>v.object),...[...minimumObjects.values()].map(v=>v.object)];
          const sum=(key:'textureEstimateBytes'|'geometryEstimateBytes')=>values.reduce((total,value)=>total+(Number.isSafeInteger(value.userData.viewer?.[key])?value.userData.viewer[key]:0),0);
          const displayedId=detailPinnedArtwork?(renderer.domElement.style.visibility==='hidden'?undefined:diagnosticDrawn?.assetId):selectedId?active.get(selectedId):undefined;
          const displayedAsset=selectedArt?.assets.find(asset=>asset.id===displayedId);
          const selectedLimits=selectedArt&&detailPinnedArtwork?requestLimits({detailPromotion:true,detailBudget:selectedBudget(selectedArt)}):undefined;
          const detailOmitted=!!detailPinned||!!detailImageCandidate||detailRetired;
          return {version:1,capturedAt:new Date().toISOString(),lifecycle:gpuLost?'context-lost':disposed||publicDisplayStopped?'stopped':'live',identity:{publicationId:publicSource.publicationId,revisionSha256:publicSource.revisionSha256,indexSha256:publicSource.detailPublication?.local?.verifiedIndexSha256??null,buildId:history.buildId,sourceCommit:history.sourceCommit},
            selected:{placementId:diagnosticDetailPlacement,artworkRevisionId:selectedId,reason:detailPinnedArtwork?'detail':currentArtwork?'attended':null},
            displayed:diagnosticOriginal?{artworkRevisionId:diagnosticOriginal.artworkRevisionId,assetId:null,sha256:diagnosticOriginal.sha256,tier:'acquired-original'}:{artworkRevisionId:displayedAsset?selectedId:null,assetId:displayedAsset?.id??null,sha256:displayedAsset?.sha256??null,tier:displayedAsset?(detailPinnedArtwork?(diagnosticDrawn?.tier==='approved-full'?'detail-approved':'detail-lightweight'):'scene'):null},
            device:{deviceMemoryGiB:typeof memory==='number'&&Number.isFinite(memory)?memory:null,coarsePointer:matchMedia('(pointer: coarse)').matches,finePointer:matchMedia('(pointer: fine)').matches,pixelRatio:renderer.getPixelRatio(),viewportWidth:renderer.domElement.clientWidth,viewportHeight:renderer.domElement.clientHeight,budget:{maxCacheBytes:viewerBudget.maxCacheBytes,maxTransitionBytes:viewerBudget.maxTransitionBytes??viewerBudget.maxCacheBytes,maxTextureSize:viewerBudget.maxTextureSize,maxTriangles:viewerBudget.maxTriangles,effectiveResidentBytes:assetBudgetBytes,effectiveTransitionBytes:transitionBudgetBytes,selectedDetailResidentBytes:selectedLimits?.resident??null,selectedDetailTransitionBytes:selectedLimits?.transition??null,originalDetailTransitionBytes:diagnosticOriginalLimits?.transition??null,originalDetailSceneBytes:diagnosticOriginalLimits?.scene??null}},
            navigation:{roomId:minimumRoomId??null,position:[camera.position.x,camera.position.y,camera.position.z],quaternion:[camera.quaternion.x,camera.quaternion.y,camera.quaternion.z,camera.quaternion.w],verticalFov:camera.fov},
            memory:{residentEstimateBytes:resident(),transitionEstimateBytes:peak.total(),peakTransitionEstimateBytes:Math.max(diagnosticPeak,peak.total()),textureEstimateBytes:detailOmitted?null:sum('textureEstimateBytes'),peakTextureEstimateBytes:diagnosticPeakTexture,meshEstimateBytes:detailOmitted?null:sum('geometryEstimateBytes'),peakMeshEstimateBytes:diagnosticPeakMesh,renderTargetEstimateBytes:null,peakRenderTargetEstimateBytes:null,gpuPhysicalBytes:null},
            assets:all.slice(0,32).map(({art,asset})=>({assetId:asset.id,artworkRevisionId:art.revisionId,sha256:asset.sha256??null,bytes:asset.bytes??null,mime:asset.mime??null,path:null,active:active.get(art.revisionId)===asset.id})),events:diagnosticEvents.snapshot()};
        });
        const originalDetailSlot=createDetailImageSlot();let originalDetailGeneration=0;
        const requestLimits=(task?:{detailPromotion?:boolean;detailBudget?:DeviceBudget})=>{
          const target=task?.detailPromotion?task.detailBudget:undefined;
          return {
            resident:assetBudgetBytes+Math.max(0,(target?.maxCacheBytes??viewerBudget.maxCacheBytes)-viewerBudget.maxCacheBytes),
            transition:transitionBudgetBytes+Math.max(0,(target?.maxTransitionBytes??target?.maxCacheBytes??viewerBudget.maxTransitionBytes??viewerBudget.maxCacheBytes)-(viewerBudget.maxTransitionBytes??viewerBudget.maxCacheBytes)),
          };
        };
        growAssetLimits=()=>{
          const increased=assetBudgetBytes>byteCache.stats().maxBytes;
          byteCache.raiseLimit(assetBudgetBytes);peak.raiseLimit(transitionBudgetBytes);
          if((increased||floorSettled&&surfaceSettled)&&materialBudgetDeferred.size){
            const deferred=[...materialBudgetDeferred];materialBudgetDeferred.clear();const epoch=materialRetryEpoch;
            for(const [id] of deferred)if(retryAfter.get(id)===Infinity)retryAfter.delete(id);
            queueMicrotask(()=>{
              if(disposed||gpuLost||publicDisplayStopped||epoch!==materialRetryEpoch)return;
              for(const [id,intent] of deferred){
                if(pending.has(id)||failed.has(id)||minimumBlocked.has(id))continue;
                const wanted=materialRetryWanted({mapPinned:mapPins.has(id),viewingPinned:viewingPins.has(id),manual:intent.manual,visible:observedVisible.get(id)===true,eligible:observedEligible.get(id)===true,current:id===currentArtwork});
                const art=wanted?arts.find(value=>value.revisionId===id):undefined;
                if(art)request(art,intent.full,intent.prepareOnly,intent.detailPromotion,intent.manual);
              }
            });
          }
        };
        growAssetLimits();
        const evictOffroomArtwork=(id:string)=>{
          const old=objects.get(id),assetId=active.get(id);
          if(!old)return;
          for(const placement of ordered.filter(item=>item.artworkRevisionId===id)){
            const group=placements.get(placement.id.toLowerCase());
            if(group){group.clear();for(const bound of placeholders.get(placement.id.toLowerCase())??[])group.add(bound);}
          }
          const retained=minimumObjects.get(id);
          if(retained){minimumObjects.delete(id);destroy(retained.object);}
          objects.delete(id);active.delete(id);requested.delete(id);desired.delete(id);xrArtworks.delete(id);
          destroy(old);
          if(assetId){byteCache.delete(assetId);stage(assetId,'evicted-offroom-minimum');}
        };
        const reclaimOffroom=(target:string,deficit:()=>number)=>{
          if(deficit()<=0)return;
          const candidates=[...objects.keys()].filter(id=>id!==target&&id!==currentArtwork&&id!==viewingCurrentArt&&id!==detailPinnedArtwork&&
            !mapPins.has(id)&&!viewingPins.has(id)&&!pending.has(id)&&observedVisible.get(id)===false&&observedEligible.get(id)===false);
          // Leave the old working set intact when this phase cannot fit even
          // after reclaiming all eligible off-room display resources.
          const reclaimable=candidates.reduce((sum,id)=>sum+
            (objects.get(id)?.userData.viewer?.decodedBytes??0)+
            (minimumObjects.get(id)?.object.userData.viewer?.decodedBytes??0),0);
          if(reclaimable<deficit())return;
          candidates.sort((a,b)=>(lastAttended.get(a)??0)-(lastAttended.get(b)??0));
          let changed=false;
          for(const id of candidates){
            if(deficit()<=0)break;
            evictOffroomArtwork(id);changed=true;
          }
          if(changed){xrCallbacks.current.onXrArtworks?.([...xrArtworks.values()]);shadowPass.invalidate();render();}
        };
        const neededMinimum=(task: {art: Document["artworks"][number];prepareOnly:boolean;detailPromotion?:boolean})=>{
          const id=task.art.revisionId;
          return !task.prepareOnly&&!task.detailPromotion&&!active.has(id)&&
            (observedVisible.get(id)===true||observedEligible.get(id)===true||mapPins.has(id)||viewingPins.has(id));
        };
        const preparedBytes=()=>[...prepared.values()].reduce((bytes,value)=>bytes+(value.object.userData.viewer?.decodedBytes??0),0);
        const evictPrepared=(deficit:()=>number)=>{
          for(const [id,value] of prepared){
            if(deficit()<=0)break;
            prepared.delete(id);destroy(value.object);stage(id,'evicted-preparation');
          }
        };
        const reserve=(key:string,bytes:number)=>{
          const task=tasks.get(key),limit=requestLimits(task).transition;
          // Encoded bytes and prepared objects are expendable; displayed objects stay pinned through replacement.
          for(const art of arts)for(const asset of art.assets){if(peak.total(key)+bytes<=limit)break;byteCache.delete(asset.id);}
          if(!task?.prepareOnly)evictPrepared(()=>peak.total(key)+bytes-limit);
          for(const [id,value]of minimumObjects){if(peak.total(key)+bytes<=limit)break;if(mapPins.has(id)||viewingPins.has(id)||id===viewingCurrentArt||observedVisible.get(id)!==false||observedEligible.get(id)!==false)continue;minimumObjects.delete(id);destroy(value.object);stage(value.assetId,'evicted-offroom-minimum');}
          if(task&&neededMinimum(task))reclaimOffroom(task.art.revisionId,()=>peak.total(key)+bytes-limit);
          try{peak.reserve(key,bytes,limit);}catch(error){
            if(task?.detailPromotion&&task.detailBudget&&task.art.artworkType==='sculpture'&&task.art.revisionId===detailPinnedArtwork&&Number.isSafeInteger(bytes)&&bytes>0)
              detailBudgetWait={assetId:task.inventory.id,bytes,phase:'transition'};
            throw error;
          }
        };
        type DetailTransfer={loaded(bytes:number):void;finish():void};
        let beginDetailTransfer:((tier:DetailTier,bytes:number)=>DetailTransfer)|undefined;
        const tasks = new Map<
          string,
          {
            art: Document["artworks"][number];
            inventory: Document["artworks"][number]["assets"][number];
            prepareOnly:boolean; downloadOnly:boolean;full?:boolean;manual?:boolean;
            detailBudget?:DeviceBudget;detailPromotion?:boolean;detailTransfer?:DetailTransfer;
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
              stage(t.inventory.id,'fetch-verify',undefined,key);
              if(t.downloadOnly){
                const bytes=await readArtworkBytes(t.art,t.inventory,signal,t.detailTransfer?.loaded),budget=t.detailBudget??viewerBudget;
                signal.throwIfAborted();
                stage(t.inventory.id,'verified-download',undefined,key);
                checkImageDecode(bytes,t.art,t.inventory,budget);
                const ceiling=assetDecodeReserve(t.art,t.inventory,budget,bytes);
                if(!Number.isSafeInteger(ceiling)||ceiling<0)throw Error('IMAGE_DECODE_BUDGET');
                imageDecodeCeilings.set(`${t.inventory.id}/${budget.maxTextureSize}`,ceiling);
                return {key};
              }
              const object=await loadArtwork(t.art,t.inventory,signal,bytes=>reserve(key,assetDecodeReserve(t.art,t.inventory,{...(t.detailBudget??viewerBudget),maxCacheBytes:requestLimits(t).resident},bytes,'cpu')),value=>stage(t.inventory.id,value,undefined,key),t.detailBudget,undefined,t.detailTransfer?.loaded);
              object.userData.loadKey=key;
              try{
                signal.throwIfAborted();
                // Decode has returned. Only retained resources and cache entries
                // share the upload budget with other live allocations.
                if(object.userData.viewer?.decodeBackingReleased)reserve(key,object.userData.viewer.decodedBytes);
                stage(t.inventory.id,'texture-upload-shader-prepare',undefined,key);
                object.traverse(node=>{if(node instanceof three.Mesh)for(const material of Array.isArray(node.material)?node.material:[node.material])for(const value of Object.values(material))if(value instanceof three.Texture)renderer.initTexture(value);});
                renderer.compile(object,camera,scene);
                signal.throwIfAborted();
                // Geometry buffers are uploaded by the first draw, not compile().
                stage(t.inventory.id,'textures-shaders-prepared-geometry-awaits-draw',undefined,key);
                return {object,key};
              }catch(error){destroy(object);throw error;}
            } catch(error){
              if(!t.thumbnailWork)stage(t.inventory.id,signal.aborted?'cancelled-settled':error instanceof Error&&error.message==='ASSET_TRANSITION_PEAK'?'deferred-budget':'failed',signal.aborted?undefined:error,key);
              peak.release(key);tasks.delete(key);throw error;
            }
          },
          onDiscard: result=>{const task=tasks.get(result.key);if(task)stage(task.inventory.id,'cancelled-settled',undefined,result.key);peak.release(result.key);tasks.delete(result.key);discardResult(result);},
        });
        let publicThumbnailTask:string|undefined;
        const cancelPublicThumbnail=()=>{if(publicThumbnailTask){scheduler.cancel(publicThumbnailTask);publicThumbnailTask=undefined;}};
        preserveQualityFrame=()=>{
          const live=renderer.domElement,stage=live.parentElement?.parentElement;
          if(!stage||gpuLost||!live.width||!live.height||qualityFrame.current)return;
          const visibleWorks=[...active.keys()].filter(id=>observedVisible.get(id)===true);
          if(!visibleWorks.length)return;
          const frame=live.ownerDocument.createElement('canvas');
          const scale=Math.min(1,512/Math.max(live.width,live.height));
          frame.width=Math.max(1,Math.floor(live.width*scale));
          frame.height=Math.max(1,Math.floor(live.height*scale));
          const context=frame.getContext('2d');
          if(!context)return;
          try{context.drawImage(live,0,0,frame.width,frame.height);}catch{return;}
          frame.className='geometry-quality-frame';
          frame.setAttribute('aria-hidden','true');
          stage.insertBefore(frame,live.parentElement?.nextSibling??null);
          qualityFrame.current={scope:qualityScope,canvas:frame,timer:window.setTimeout(clearQualityFrame,8000),visibleWorks};
        };
        const visibleWaitStarted = new Map<string, number>();
        const updateArtworkNotice = () => {
          if (!immersive) return;
          if (suspendedRef.current || xrActive.current || renderer.domElement.ownerDocument.hidden) {
            visibleWaitStarted.clear();
            setArtworkNotice(undefined);
            return;
          }
          const now = performance.now();
          let loading = false, unavailable = false;
          for (const { revisionId } of arts) {
            const key = pending.get(revisionId);
            const visibleMinimum = observedVisible.get(revisionId) && !active.has(revisionId);
            const waiting = key !== undefined && !tasks.get(key)?.prepareOnly || materialBudgetDeferred.has(revisionId);
            const failedMinimum = failed.has(revisionId) && (!key || minimumBlocked.has(revisionId));
            if (!visibleMinimum || (!waiting && !failedMinimum)) {
              visibleWaitStarted.delete(revisionId);
              continue;
            }
            const started = visibleWaitStarted.get(revisionId) ?? now;
            visibleWaitStarted.set(revisionId, started);
            const elapsed = now - started;
            unavailable ||= failedMinimum &&
              (!minimumBlocked.has(revisionId) || retryAfter.get(revisionId) === Infinity || elapsed >= 3000);
            loading ||= waiting && elapsed >= 1000;
          }
          setArtworkNotice(unavailable ? "unavailable" : loading ? "loading" : undefined);
        };
        const update = () => {
          if (disposed || gpuLost || publicDisplayStopped) return;
          updateArtworkNotice();
          const detailArt=arts.find(art=>art.revisionId===detailPinnedArtwork);
          const selectedLimits=detailArt?requestLimits({detailPromotion:true,detailBudget:selectedBudget(detailArt)}):undefined;
          // A verified download-only preparation may settle without an object.
          // Its expendable encoded cache must also fit the current steady scope.
          for(const asset of arts.flatMap(work=>work.assets)){if(resident()<=(selectedLimits?.resident??assetBudgetBytes))break;byteCache.delete(asset.id);}
          const decodedTotal = [...objects.values(),...[...prepared.values()].map(v=>v.object),...[...minimumObjects.values()].map(v=>v.object)].reduce(
            (sum, value) => sum + (value.userData.viewer?.decodedBytes ?? 0),
            detailBytes(),
          );
          if(diagnosticsEnabled()){
            const values=[...objects.values(),...[...prepared.values()].map(v=>v.object),...[...minimumObjects.values()].map(v=>v.object)];
            const sum=(key:'textureEstimateBytes'|'geometryEstimateBytes')=>values.reduce((total,value)=>total+(Number.isSafeInteger(value.userData.viewer?.[key])?value.userData.viewer[key]:0),0);
            diagnosticPeakTexture=Math.max(diagnosticPeakTexture,sum('textureEstimateBytes'));
            diagnosticPeakMesh=Math.max(diagnosticPeakMesh,sum('geometryEstimateBytes'));
          }
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
          const previous=qualityFrame.current;
          if(previous?.visibleWorks.every(id=>active.has(id)||failed.has(id)||minimumBlocked.has(id)))clearQualityFrame();
          if(qualityFrameReserve&&!qualityFrame.current){
            qualityFrameReserve=0;
            refreshAssetLimits();
          }
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
            selectedDetailBudgetBytes:selectedLimits?.resident,selectedDetailTransitionBytes:selectedLimits?.transition,
            automaticDetail:automatic,
            retainedMinimumAssets:[...minimumObjects.values()].map(v=>v.assetId),minimumRoomIds:[...minimumRooms],minimumBudgetBlocked:[...minimumBlocked],materialBudgetDeferred:[...materialBudgetDeferred.keys()],minimumBudgetBytes:assetBudgetBytes,transitionBudgetBytes,
            currentArtwork, preparedAssetIds:[...prepared.keys()], preparationStages:stages.snapshot(),
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
            : materialBudgetDeferred.size>0 ? "작품을 준비하고 있어요." : "");
          setMessage(
            `공간 ${document.rooms.length} · 표면 ${document.surfaces.length} · 실제 개구부 ${document.openings.length} · 승인된 작품 derivative ${loaded}개 · bytes 사용 불가 ${failed.size}개 · 입구 ${arts.slice(0, viewerBudget.entranceAssets).filter((a) => active.has(a.revisionId)).length}/${Math.min(arts.length, viewerBudget.entranceAssets)} · 갤러리 대기 ${arts.length - requested.size}개 (점선은 실제 치수 metadata bounds).`,
          );
          settleDetail?.();for(const check of [...viewingWaiters])check();
        };
        const modelFallbackLimits=new Map<string,number>();
        const preferModelCoarse=(id:string,explicitFull:boolean)=>{
          const refusedLimit=modelFallbackLimits.get(id);
          return !explicitFull&&refusedLimit!==undefined&&assetBudgetBytes<=refusedLimit;
        };
        const request = (art: (typeof arts)[number], full = false, prepareOnly=false, detailPromotion=false, manual=false):void => {
          if(publicDisplayStopped)return;
          const ownsDetail=art.revisionId===detailPinnedArtwork;
          if(detailPromotion?(!sharedDetail||!ownsDetail):ownsDetail)return;
          // A new request supersedes only its own material-wait marker.
          if(materialBudgetDeferred.delete(art.revisionId)&&retryAfter.get(art.revisionId)===Infinity)retryAfter.delete(art.revisionId);
          requested.add(art.revisionId);
          let imageTarget:ReturnType<typeof selectedImageDetail>;
          let imageBudget:DeviceBudget;
          let inventory: (typeof art.assets)[number];
          try {
            imageTarget=detailPromotion?selectedImageDetail(art,viewerBudget):undefined;
            imageBudget=imageTarget?.budget??viewerBudget;
            const preferCoarse=!detailPromotion&&preferModelCoarse(art.revisionId,manual&&full);
            inventory = imageTarget?.inventory??selectAssetVariant(
              art,
              full ? 0 : Infinity,
              viewerBudget,
              preferCoarse,
            );
          } catch (error) {
            if(diagnosticsEnabled())diagnosticEvents.record({atMs:performance.now(),assetId:art.primaryAssetId,artworkRevisionId:art.revisionId,stage:'variant-admission-refused',errorCode:error instanceof Error&&/^[A-Z][A-Z0-9_]{0,79}$/.test(error.message)?error.message:null});
            failed.add(art.revisionId);
            update();
            return;
          }
          const detailBudget=detailPromotion?selectedBudget(art,inventory):undefined;
          if(detailPromotion&&detailBudgetWait?.assetId===inventory.id){
            const {bytes,phase}=detailBudgetWait,limit=requestLimits({detailPromotion,detailBudget})[phase];
            if(!detailResidentRetryReady(bytes,peak.total(),limit,preparedBytes()))return;
            detailBudgetWait=undefined;
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
            const task=tasks.get(prior);
            if(task){task.manual=task.manual||manual;task.full=task.full||full;if(!prepareOnly)task.prepareOnly=false;}
            if(art.revisionId===currentArtwork)void scheduler.request(prior,-100);
            if(viewingPins.has(art.revisionId))scheduler.setPriorityOverride(prior,-200);
            return;
          }
          const ready=prepared.get(inventory.id);
          if(ready&&prepareOnly)return;
          const cached=byteCache.get(inventory.id);
          let downloadOnly=false;
          if(!ready&&full&&authoredImagePair(art)){
            try{
              const costKey=`${inventory.id}/${imageBudget.maxTextureSize}`,known=imageDecodeCeilings.get(costKey);
              const ceiling=cached?assetDecodeReserve(art,inventory,imageBudget,cached):known??imageFullDecodeCeiling(art,inventory,imageBudget)!;
              if(cached){if(!Number.isSafeInteger(ceiling)||ceiling<0)throw Error('IMAGE_DECODE_BUDGET');imageDecodeCeilings.set(costKey,ceiling);}
              // A speculative load cannot spend a peer's retained preparation.
              const reclaimable=prepareOnly?0:[...prepared.values()].reduce((sum,v)=>sum+(v.object.userData.viewer?.decodedBytes??0),0);
              // Fetch a verified header first when the conservative declared square cannot fit.
              const preflightLimit=requestLimits({detailPromotion,detailBudget}).transition;
              downloadOnly=peak.total()-byteCache.stats().bytes-reclaimable+ceiling>preflightLimit;
              if(downloadOnly&&(cached||known!==undefined)){
                if(art.revisionId===demandContext().owner){reclaimForCurrent();stage(inventory.id,'deferred-budget');}
                if(!active.has(art.revisionId))request(art,false,prepareOnly,false,manual);return;
              }
            }catch{if(!active.has(art.revisionId))request(art,false,prepareOnly,false,manual);return;}
          }
          if(prior)scheduler.cancel(prior);
          cancelPublicThumbnail();
          desired.set(art.revisionId, inventory.id);
          const key=`${inventory.id}/${sequence++}`;
          pending.set(art.revisionId,key);
          const detailTransfer=detailPromotion?beginDetailTransfer?.('approved-full',inventory.bytes):undefined;
          const task={ art, inventory, prepareOnly, downloadOnly,full,manual,detailBudget,detailPromotion,detailTransfer };
          tasks.set(key,task);
          stages.begin(inventory.id,key);
          const scheduled=scheduler.request(key,art.revisionId===currentArtwork?-100:prepareOnly?100:arts.indexOf(art));
          if(viewingPins.has(art.revisionId))scheduler.setPriorityOverride(key,-200);
          void scheduled
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
              const steady=requestLimits(task).resident;
              const deficit=()=>peak.total()+(object.userData.viewer?.decodedBytes??0)-steady;
              // The cache skips pinned backing buffers. Unpinned encoded bytes
              // are expendable even when this decoder retains its own backing.
              for(const asset of arts.flatMap(work=>work.assets)){if(deficit()<=0)break;byteCache.delete(asset.id);}
              // An owned selected promotion can use the same speculative
              // capacity as a wall promotion. Keep every displayed object.
              const wallPromotion=!task.prepareOnly&&!task.detailPromotion&&demandContext().observeWall&&art.revisionId===currentArtwork&&
                 inventory.id.toLowerCase()===authoredImagePair(art)?.full.assetId.toLowerCase();
              const selectedPromotion=task.detailPromotion&&detailPinnedArtwork===art.revisionId&&!!sharedDetail;
              const shortage=deficit();
              if((selectedPromotion||wallPromotion)&&shortage>0&&preparedBytes()>=shortage)evictPrepared(deficit);
              if(neededMinimum(task))reclaimOffroom(art.revisionId,deficit);
              if(deficit()>0){
                stage(inventory.id,'deferred-budget',undefined,key);
                const missingMinimum=neededMinimum(task);
                const required=object.userData.viewer?.decodedBytes;
                discardResult(result);
                if(missingMinimum){
                  minimumBlocked.add(art.revisionId);
                  if(Number.isSafeInteger(required)&&required>=0){residentMinimumWait.set(art.revisionId,{bytes:required,assetId:inventory.id});retryAfter.set(art.revisionId,Infinity);}
                  else retryAfter.set(art.revisionId,performance.now()+5000);
                  if(art.revisionId===demandContext().owner)reclaimForCurrent();
                  reduceSurfaceForCurrent(art.revisionId);
                }else if(selectedPromotion&&Number.isSafeInteger(required)&&required>0){
                  detailBudgetWait={assetId:inventory.id,bytes:required,phase:'resident'};
                }else retryAfter.set(art.revisionId,performance.now()+5000);
                update();return;
              }
              if(task.prepareOnly&&currentArtwork!==art.revisionId){
                if(preparing.has(art.revisionId)){prepared.set(inventory.id,{artId:art.revisionId,object,lastUseful:performance.now()});stage(inventory.id,'prepared-resident',undefined,key);}
                else destroy(object);
                update();return;
              }
              if(task.detailPromotion){
                // The larger selected texture belongs only to this borrowed
                // detail, never to wall placements, active identities or XR.
                if(detailPinnedArtwork!==art.revisionId||!sharedDetail){discardResult(result);update();return;}
                if(detailImageCandidate)destroy(detailImageCandidate);
                detailImageCandidate=object;stage(inventory.id,'prepared-selected-detail',undefined,key);
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
              stage(inventory.id,'attached-awaiting-draw',undefined,key);
              if(oldId&&oldId!==inventory.id)byteCache.delete(oldId);
              xrArtworks.set(art.revisionId,{revisionId:art.revisionId,assetId:inventory.id,label:art.metadata.title,object});xrCallbacks.current.onXrArtworks?.([...xrArtworks.values()]);
              failed.delete(art.revisionId);minimumBlocked.delete(art.revisionId);residentMinimumWait.delete(art.revisionId);retryAfter.delete(art.revisionId);
              shadowPass.invalidate();
              render();
              stage(inventory.id,'display-attached-render-requested',undefined,key);
              update();
            })
            .catch((error) => {
              const current=settleAssetGeneration(pending,art.revisionId,key);
              // A late non-abort failure belongs to its old request, not its successor.
              if(!current){if(error?.name==='AbortError')tasks.delete(key);if(!disposed)update();return;}
              if (!disposed) {
                if(error?.name === 'AbortError'){stage(inventory.id,'cancelled-settled',undefined,key);tasks.delete(key);update();return;}
                if(deferredByMaterialLoad(error?.message,floorSettled,surfaceSettled)){
                  // The material decode hold will be released after its serial phase.
                  // Retry under the settled limits before reporting a real failure.
                  materialBudgetDeferred.set(art.revisionId,{full:task.full,prepareOnly:task.prepareOnly,detailPromotion:task.detailPromotion,manual:task.manual});retryAfter.set(art.revisionId,Infinity);
                  failed.delete(art.revisionId);minimumBlocked.delete(art.revisionId);update();return;
                }
                retryAfter.set(art.revisionId,error?.message==='ASSET_TRANSITION_PEAK'?performance.now()+(art.revisionId===demandContext().owner?500:5000):Infinity);
                if(error?.message==='ASSET_TRANSITION_PEAK'){if(!active.has(art.revisionId))minimumBlocked.add(art.revisionId);if(art.revisionId===demandContext().owner)reclaimForCurrent();}
                // A visible missing minimum must not wait for detail attention:
                // its placeholder may be too small/off-center to win that slot.
                const visibleMissingMinimum=!active.has(art.revisionId)&&observedVisible.get(art.revisionId)&&observedEligible.get(art.revisionId);
                if(['ASSET_TRANSITION_PEAK','MODEL_RESIDENT_BUDGET'].includes(error?.message)&&(art.revisionId===demandContext().owner||visibleMissingMinimum))reduceSurfaceForCurrent(art.revisionId);
                if(error?.message==='MODEL_RESIDENT_BUDGET'&&art.artworkType==='sculpture'&&!task.detailPromotion&&!(task.manual&&task.full)&&!active.has(art.revisionId)){
                  // Retain the authored coarse model choice until the effective
                  // resident budget increases. A repeat at the same limit cannot fit.
                  try{
                    const fallback=selectAssetVariant(art,Infinity,viewerBudget,true);
                    if(fallback.id!==inventory.id&&lodVariantsFor(art).some(variant=>variant.detail==='coarse'&&variant.assetId.toLowerCase()===fallback.id.toLowerCase())){
                      modelFallbackLimits.set(art.revisionId,assetBudgetBytes);
                      retryAfter.delete(art.revisionId);
                      request(art,false,task.prepareOnly,false,manual);
                      return;
                    }
                  }catch{/* Keep the existing visible failure when no authored coarse model is supported. */}
                }
                if(task.prepareOnly||active.has(art.revisionId)){update();return;}
                if (error?.name !== "AbortError" && !full && !authoredImagePair(art)) {
                  try {
                    const fallback = selectAssetVariant(art, 0, viewerBudget, preferModelCoarse(art.revisionId,manual));
                    if (fallback.id !== inventory.id) {
                      request(art, true,false,false,manual);
                      return;
                    }
                  } catch {
                    /* No qualified asset fits this device budget. */
                  }
                }
                failed.add(art.revisionId);
                update();
              }
            }).finally(()=>{detailTransfer?.finish();stages.settled(inventory.id,key);});
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
          evictOffroomArtwork(candidate.id);
          xrCallbacks.current.onXrArtworks?.([...xrArtworks.values()]);
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
            const wait=residentMinimumWait.get(artId);
            if(wait===undefined||residentMinimumFits(peak.total(),wait.bytes,assetBudgetBytes)){
              retryAfter.delete(artId);residentMinimumWait.delete(artId);failed.delete(artId);minimumBlocked.delete(artId);
            }
            shadowPass.invalidate();render();update();
          }).catch(()=>{/* Old complete material stays valid; no retry loop. */}).finally(()=>{materialReductionPending=false;});
        };
        demand.current = (kind) => {
          if(kind==='cancel')residentRecoveryCancelled=true;
          else residentRecoveryCancelled=false;
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
            materialRetryEpoch++;for(const id of materialBudgetDeferred.keys())if(retryAfter.get(id)===Infinity)retryAfter.delete(id);materialBudgetDeferred.clear();
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
                ? arts.filter((a) => failed.has(a.revisionId)||residentMinimumWait.has(a.revisionId))
                : arts.filter((a) => requested.has(a.revisionId));
          for (const art of selected) {
            if (kind === "retry") visibleWaitStarted.delete(art.revisionId);
            const residentWait=residentMinimumWait.get(art.revisionId);
            if(residentWait!==undefined){
              let selectedId:string|undefined;
              try{selectedId=selectAssetVariant(art,kind==='full'||kind==='next'&&!automatic&&manualFull?0:Infinity,viewerBudget).id;}catch{/* Let normal admission report an unsupported target. */}
              if(sameResidentMinimumAsset(residentWait.assetId,selectedId)&&!retryWaitingMinimum(art.revisionId,residentWait.bytes,true)){reduceSurfaceForCurrent(art.revisionId);continue;}
              residentMinimumWait.delete(art.revisionId);minimumBlocked.delete(art.revisionId);
            }
            retryAfter.delete(art.revisionId);
            request(art, kind === "full" || (kind === "next" && !automatic && manualFull),false,false,true);
          }
        };
        const automaticDemand=()=>{
          if(disposed||gpuLost||xrActive.current||publicDisplayStopped||!demandContext().observeWall||(!automatic&&!immersive))return;
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
              if(!automatic)break;
              // Partial footprints protect the minimum; detail keeps its center-clear requirement.
              if(!unobstructed)continue;
              const isFocused=focusedPlacement.current===p.id;focused=focused||isFocused;
              const {occupancy,projectedPixels:pixels}=screen;
              gazeDistance=Math.min(gazeDistance,screen.gazeDistance);
              maxOccupancy=Math.max(maxOccupancy,occupancy);
              screenDemand=screenDemand||detailDemand({kind:art.artworkType,visible:true,distance:Math.max(.001,d),occupancy,projectedPixels:pixels,coarseTextureSize:low?.textureSize,gazeDistance:screen.gazeDistance,focused:isFocused});
            }
            let want=false;
            if(automatic){
              let transition=transitions.get(art.revisionId);
              if(!transition){transition=new DetailTransition();transitions.set(art.revisionId,transition);}
              want=transition.update(screenDemand,now);
            }
            return {art,visible,distance,focused,want,demand:screenDemand,occupancy:maxOccupancy,gazeDistance,eligible,minimumEligible};
          });
          for(const observation of observations){
            observedVisible.set(observation.art.revisionId,observation.visible);
            if(!automatic)continue;
            observedEligible.set(observation.art.revisionId,observation.minimumEligible);
            if(!observation.visible&&!observation.minimumEligible)minimumBlocked.delete(observation.art.revisionId);
          }
          if(!automatic)return;
          // Attention and detail grace run together rather than adding two
          // consecutive dwell delays before the first detailed request.
          const candidates=observations.map(v=>({id:v.art.revisionId,demand:v.demand||(v.art.revisionId===attention.current()&&v.want),occupancy:v.occupancy,focused:v.focused,gazeDistance:v.gazeDistance,distance:v.distance,eligible:v.eligible}));
          currentArtwork=attention.update(candidates,now);
          if(currentArtwork){lastAttended.set(currentArtwork,now);reclaiming.delete(currentArtwork);}
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
          const minimumOutstanding=minimumDetailPending(sorted.map(v=>({visible:v.visible,eligible:v.minimumEligible,active:active.has(v.art.revisionId),pending:pending.has(v.art.revisionId),budgetBlocked:minimumBlocked.has(v.art.revisionId)||materialBudgetDeferred.has(v.art.revisionId)})));
          for(const {art,visible,minimumEligible,distance,focused,want} of sorted){
            if(!mapPins.has(art.revisionId)&&!viewingPins.has(art.revisionId)&&art.revisionId!==viewingCurrentArt&&art.revisionId!==detailPinnedArtwork&&!visible&&!minimumEligible&&!focused&&distance>12){
              const since=awaySince.get(art.revisionId)??now;awaySince.set(art.revisionId,since);
              if(now-since>=5000){
                const key=pending.get(art.revisionId);if(key){scheduler.cancel(key);pending.delete(art.revisionId);}
                desired.delete(art.revisionId);
                if(objects.has(art.revisionId)){
                  evictOffroomArtwork(art.revisionId);
                  xrCallbacks.current.onXrArtworks?.([...xrArtworks.values()]);
                  shadowPass.invalidate();render();
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
          const authored=selected&&authoredArtworkViewpoint(viewingPlanFor(document).stops,selected.id);
          if(authored&&authored.toLowerCase()!==destination.id.toLowerCase())return false;
          const placement=selected??prioritizePlacements(document,destination.roomId,destination.position).find(p=>p.roomId.toLowerCase()===destination.roomId.toLowerCase());
          const art=placement&&arts.find(a=>a.revisionId.toLowerCase()===placement.artworkRevisionId.toLowerCase());
          if(selected&&!art)return false;
          const position=camera.position.clone(),quaternion=camera.quaternion.clone();
          let releaseMinimum:(()=>void)|undefined;
          try{
            try{await checkPublicAvailability(signal);}catch(error){if(!signal.aborted&&!disposed)stopPublicDisplay();throw error;}
            signal.throwIfAborted();
            if(art)releaseMinimum=await retainMapMinimum({id:art.revisionId,signal,pins:mapPins,waiters:mapWaiters,ready:()=>objects.has(art.revisionId)&&active.has(art.revisionId),failed:()=>!pending.has(art.revisionId)&&(failed.has(art.revisionId)||minimumBlocked.has(art.revisionId)),request:()=>request(art,false)});
            signal.throwIfAborted();
            if(selected&&art){
              const qualified=await walkingActions.current?.prepareViewpoint?.(destination.id);
              signal.throwIfAborted();
              const group=placements.get(selected.id.toLowerCase());
              if(!qualified||!group)return false;
              try{assertArtworkViewpoint(three,group,art.artworkType,qualified);}catch{return false;}
            }
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
            const releasePin=()=>{if(released)return;released=true;signal.removeEventListener('abort',releasePin);const count=(viewingPins.get(art.revisionId)??1)-1;if(count>0)viewingPins.set(art.revisionId,count);else{viewingPins.delete(art.revisionId);const key=pending.get(art.revisionId);if(key)scheduler.setPriorityOverride(key);}};
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
              assertArtworkViewpoint(three,group,art.artworkType,destination);
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
          const mountEpoch=++detailMountEpoch;
          const signal=AbortSignal.any([abort.signal,input.signal]);
          const assertMount=()=>assertDetailMountCurrent(signal,mountEpoch,detailMountEpoch,!disposed&&!gpuLost&&!publicDisplayStopped&&!xrActive.current&&!sharedDetail&&suspendedRef.current);
          assertMount();
          const placement=document.placements.find(p=>p.id.toLowerCase()===input.placementId.toLowerCase());
          const art=arts.find(a=>a.revisionId.toLowerCase()===placement?.artworkRevisionId.toLowerCase());
          if(!art)throw Error('DETAIL_ARTWORK_UNAVAILABLE');
          const detailOwner=publicSource.detailPublication,detailAccess=detailOwner?.local?.detailAccess;
          const galleryBuffer=()=>({width:renderer.domElement.width,height:renderer.domElement.height,pixelRatio:renderer.getPixelRatio(),devicePixelRatio:globalThis.devicePixelRatio});
          const coverReady=()=>{try{return publicSource.coverOriginalEligible?.()===true;}catch{return false;}};
          const selectedProfile=input.flatImage?qualifiedDetailImageProfile(publicSource.revisionSha256,art.revisionId):undefined;
          const selectedBinding=selectedProfile&&detailOwner&&detailAccess?staticDetailAttestation(detailAccess,detailOwner,selectedProfile.candidateId):undefined;
          let imageProfile=selectedProfile&&coverReady()&&selectedProfile.revisionSha256===publicSource.revisionSha256&&selectedProfile.artworkRevisionId===art.revisionId&&matchesMeasuredWheatImage(selectedProfile,selectedBinding,galleryBuffer())?Object.freeze({...selectedProfile,detailViewport:Object.freeze({...selectedProfile.detailViewport}),runtime:Object.freeze({...selectedProfile.runtime})}):undefined;
          // A reopened qualified original waits for the previous owned work and
          // reservation to retire; an uncertain drain never admits a successor.
          if(imageProfile&&detailOwner&&detailAccess&&isVerifiedStaticDetailAccess(detailOwner,detailAccess))await originalDetailSlot.whenAvailable(signal);
          await canvasRestorePromise;assertMount();cancelDetail?.();
          try{await checkPublicAvailability(signal);}catch(error){if(mountEpoch===detailMountEpoch&&!signal.aborted&&!disposed){stopPublicDisplay();input.unavailable('rights');}throw error;}
          assertMount();
          if(imageProfile&&!matchesMeasuredWheatImage(imageProfile,detailOwner&&detailAccess?staticDetailAttestation(detailAccess,detailOwner,imageProfile.candidateId):undefined,galleryBuffer()))imageProfile=undefined;
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
          assertMount();
          let object=objects.get(art.revisionId);
          if(!object||disposed||gpuLost||sharedDetail||xrActive.current)throw Error('DETAIL_NOT_READY');
          const tiers=new Map(lodVariantsFor(art).map(variant=>[variant.assetId.toLowerCase(),variant.detail]));
          const returnEpoch=++canvasReturnEpoch;
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
          const wallObject=object;
          let preparedOwned=false;
          if((input.flatImage||art.artworkType==='sculpture'&&!input.anchors.length)&&tiers.get(String(object.userData.viewerAssetId).toLowerCase())==='coarse'){
            let higher:ReturnType<typeof selectAssetVariant>|undefined;
            try{higher=(input.flatImage?selectedImageDetail(art,viewerBudget)?.inventory:undefined)??selectAssetVariant(art,0,viewerBudget);}catch{/* Keep the qualified wall asset. */}
            const ready=higher&&tiers.get(higher.id.toLowerCase())==='full'?prepared.get(higher.id):undefined;
            // Availability was verified before mount. Both objects already count
            // toward the resident budget. The wall retains its own coarse object.
            if(higher&&ready?.artId===art.revisionId){prepared.delete(higher.id);object=ready.object;preparedOwned=true;}
          }
          detailPinned=object;detailPinnedArtwork=art.revisionId;detailRetired=preparedOwned;diagnosticDetailPlacement=input.placementId;
          sharedDetailUnavailable=input.unavailable;
          let promoteImage:(()=>void)|undefined,retryPromotion:(()=>void)|undefined;
          let alive=true,checking=false,timer:ReturnType<typeof setInterval>|undefined;
          let attemptGeneration=0,activeTransfer:DetailTransfer|undefined;
          beginDetailTransfer=(tier,totalBytes)=>{
            const generation=++attemptGeneration;
            const emit=(value:Parameters<NonNullable<typeof input.qualityProgress>>[0])=>{
              try{input.qualityProgress?.(value,generation);}catch{/* UI observers do not own the transfer. */}
            };
            let loadedBytes=0;
            const transfer:DetailTransfer={
              loaded(bytes){if(alive&&activeTransfer===transfer&&bytes>loadedBytes){loadedBytes=Math.min(bytes,totalBytes);emit({tier,loadedBytes,totalBytes});}},
              finish(){if(activeTransfer===transfer){activeTransfer=undefined;emit(null);}},
            };
            activeTransfer=transfer;emit({tier,loadedBytes,totalBytes});return transfer;
          };
          let originalAttempt:ReturnType<typeof startDetailImageAttempt>|undefined,originalDrawGeneration=0,originalAttached=false,originalDisplayed=false,originalBlocked=false,originalSettled=false,originalDrawSuppressed=false;
          let redrawSettledBaseline=()=>{};
          const previousCanvasVisibility=renderer.domElement.style.visibility;
          let guardOriginalDraw=()=>true,resumeLegacy=()=>{},restoreHold:{key:string;bytes:number}|undefined;
          const retireOriginal=()=>{if(originalAttempt)void originalAttempt.close().then(()=>{originalSettled=true;if(originalDrawSuppressed){originalDrawSuppressed=false;redrawSettledBaseline();}},()=>{if(alive&&!signal.aborted&&!disposed)input.unavailable('recovery');});};
          const visible=()=>{if(globalThis.document.visibilityState==='visible'){void check();resumeLegacy();}else if(originalAttempt&&!originalSettled)retireOriginal();};
          const restore=()=>{
            if(!alive)return;alive=false;activeTransfer?.finish();beginDetailTransfer=undefined;guardOriginalDetail=()=>{};const originalDrain=originalAttempt?.close();clearInterval(timer);globalThis.document.removeEventListener('visibilitychange',visible);
            diagnosticOriginal=null;
            diagnosticDrawn=null;
            diagnosticOriginalLimits=null;
            retryOriginalDetail=undefined;
            if(settleDetail===promoteImage)settleDetail=undefined;
            if(retryFlatDetail===retryPromotion)retryFlatDetail=undefined;
            if(materialBudgetDeferred.get(art.revisionId)?.detailPromotion){materialBudgetDeferred.delete(art.revisionId);if(retryAfter.get(art.revisionId)===Infinity)retryAfter.delete(art.revisionId);}
            const pendingDetail=pending.get(art.revisionId);
            if(pendingDetail&&tasks.get(pendingDetail)?.detailPromotion){pending.delete(art.revisionId);scheduler.cancel(pendingDetail);}
            desired.set(art.revisionId,active.get(art.revisionId)!);
            detailBudgetWait=undefined;
            const spare=detailImageCandidate;detailImageCandidate=undefined;if(spare)destroy(spare);
            peak.release(detailKey);
            sharedDetail=undefined;sharedDetailUnavailable=undefined;const retired=detailRetired;detailPinned=undefined;detailPinnedArtwork=undefined;detailRetired=false;diagnosticDetailPlacement=null;if(retired&&object)destroy(object);
            // Only encoded bytes can remain above the ordinary scene budget
            // after a selected-only allocation is returned. Retain warm bytes
            // when they fit; never discard a displayed object to trim the cache.
            if(input.flatImage)for(const asset of arts.flatMap(work=>work.assets)){if(resident()<=assetBudgetBytes)break;byteCache.delete(asset.id);}
            if(originalDrain&&deferredCanvasRestore){
              // Keep the returned canvas hidden and its drawing buffer unchanged
              // until original-owned work, texture deletion and fence settle.
              deferredCanvasRestore=true;renderer.domElement.style.visibility='hidden';if(!disposed&&!gpuLost&&!publicDisplayStopped)setDetailRestoreStatus('restoring');
              canvasRestorePromise=originalDrain.then(async()=>{
                if(disposed||gpuLost||publicDisplayStopped||sharedDetail)throw Error('DETAIL_RESTORE_UNAVAILABLE');
                try{
                  const context=renderer.getContext();
                  if(!imageProfile||typeof WebGL2RenderingContext==='undefined'||!(context instanceof WebGL2RenderingContext))throw Error('DETAIL_FENCE_UNAVAILABLE');
                  const hold=restoreHold;if(!hold)throw Error('DETAIL_RESTORE_BUDGET');
                  const restoreFits=()=>!!host.current&&host.current.clientWidth>0&&host.current.clientHeight>0&&host.current.clientWidth<=imageProfile.maxRestoreWidth&&host.current.clientHeight<=imageProfile.maxRestoreHeight&&globalThis.devicePixelRatio===imageProfile.devicePixelRatio;
                  let drawnWidth=0,drawnHeight=0;
                  await restoreDetailCanvas({peak,key:hold.key,heldBytes:hold.bytes,requiredBytes:imageProfile.restoreReservationBytes,limit:imageProfile.transitionCapBytes,draw:()=>{if(!restoreFits()||!host.current)return false;drawnWidth=host.current.clientWidth;drawnHeight=host.current.clientHeight;resize(true);update();return render(true);},complete:()=>completeDetailCommands(context),current:()=>Number.isSafeInteger(peak.total())&&peak.total()<=imageProfile.transitionCapBytes&&restoreFits()&&host.current?.clientWidth===drawnWidth&&host.current?.clientHeight===drawnHeight&&returnEpoch===canvasReturnEpoch&&!disposed&&!gpuLost&&!publicDisplayStopped&&!sharedDetail&&!context.isContextLost()&&renderer.domElement.style.visibility==='hidden',reveal:()=>{deferredCanvasRestore=false;renderer.domElement.style.visibility=previousCanvasVisibility;}});restoreHold=undefined;
                  if(!disposed&&!gpuLost&&!publicDisplayStopped){setDetailRestoreStatus(null);try{requestAnimationFrame(()=>{focusRestoredDetailCanvas(renderer.domElement,()=>returnEpoch===canvasReturnEpoch&&!disposed&&!gpuLost&&!publicDisplayStopped&&!sharedDetail&&!deferredCanvasRestore&&!suspendedRef.current&&!xrActive.current&&!!host.current?.contains(renderer.domElement));});}catch{/* Focus recovery must not undo a completed canvas restoration. */}}
                }catch(error){deferredCanvasRestore=true;renderer.domElement.style.visibility='hidden';throw error;}
              });
              void canvasRestorePromise.catch(()=>{if(!disposed&&!gpuLost&&!publicDisplayStopped)setDetailRestoreStatus('failed');});
            }else if(!disposed&&!gpuLost){resize();update();}
            // A restored opener keeps focus; never focus a temporarily hidden canvas.
            if(!deferredCanvasRestore&&!disposed&&!gpuLost&&!suspendedRef.current&&renderer.domElement.isConnected&&globalThis.document.activeElement===globalThis.document.body)renderer.domElement.focus({preventScroll:true});
          };
          const check=async()=>{
            if(!alive||checking)return;checking=true;
            try{
              try{await checkPublicAvailability(signal);}catch{if(alive&&!signal.aborted&&!disposed)stopPublicDisplay();return;}
              if(originalAttempt&&originalDisplayed)try{await originalAttempt.recheck();}catch{retireOriginal();}
            }finally{checking=false;}
          };
          try{
            const admittedGallery=galleryBuffer();
            let lastDrawnTier:'approved-full'|'lightweight'|undefined;
            const reportDrawnTier=(drawn:InstanceType<typeof three.Object3D>)=>{
              const assetId:unknown=drawn.userData.viewerAssetId;
              if(typeof assetId!=='string')return;
              const detail=tiers.get(assetId.toLowerCase());
              if(detail!=='full'&&detail!=='coarse')return;
              const tier=detail==='full'?'approved-full':'lightweight';
              if(diagnosticsEnabled()&&diagnosticDrawn?.assetId!==assetId)diagnosticDrawn={assetId,tier};
              if(tier===lastDrawnTier)return;
              lastDrawnTier=tier;
              try{input.renderedTier?.(tier,++originalDrawGeneration);}catch{/* A UI observer cannot interrupt a committed draw. */}
            };
            let mounted=false,preparedRejected=false,canvasReturned=false;
            const mount=(initial:InstanceType<typeof three.Object3D>)=>borrowedDetailPreview({
              three,renderer,object:initial,
              request:{...input,signal,beforeRender:()=>guardOriginalDraw(),keepHiddenOnDispose:()=>!!originalAttempt&&!originalSettled||originalBlocked,deferRestore:()=>{if(!originalAttempt||originalSettled)return false;deferredCanvasRestore=true;return true;}},
              environment:()=>({map:scene.environment,intensity:scene.environmentIntensity}),
              onRelease:()=>{canvasReturned=true;if(mounted)restore();},onObjectDraw:reportDrawnTier,
            });
            let scope:ReturnType<typeof borrowedDetailPreview>;
            try{scope=mount(object);}catch(error){
              if(!preparedOwned||(!canvasReturned&&!(error instanceof BorrowedDetailInitialObjectError))||signal.aborted||disposed||gpuLost||publicDisplayStopped||renderer.getContext().isContextLost())throw error;
              const rejected=object;object=wallObject;detailPinned=wallObject;detailRetired=false;
              destroy(rejected);preparedRejected=true;scope=mount(wallObject);
            }
            mounted=true;
            if(!alive){scope.dispose();throw Error('DETAIL_CANCELLED');}
            redrawSettledBaseline=()=>{if(!alive||signal.aborted||disposed||gpuLost||publicDisplayStopped||sharedDetail!==scope)return;try{scope.render();}catch{renderer.domElement.style.visibility='hidden';input.unavailable('recovery');}};
            sharedDetail=scope;timer=setInterval(()=>void check(),10000);globalThis.document.addEventListener('visibilitychange',visible);
            let approvedStarted=preparedRejected;
            const startApproved=()=>{
              if(approvedStarted||!alive||signal.aborted||disposed||gpuLost||publicDisplayStopped||sharedDetail!==scope)return;
              approvedStarted=true;
              let target:ReturnType<typeof selectAssetVariant>;
              try{target=(input.flatImage?selectedImageDetail(art,viewerBudget)?.inventory:undefined)??selectAssetVariant(art,0,viewerBudget);}catch{return;}
              if(tiers.get(target.id.toLowerCase())!=='full'||target.id===object?.userData.viewerAssetId)return;
              promoteImage=()=>{
                const next=detailImageCandidate;if(!alive||signal.aborted||!next||next===object)return;
                try{if(input.flatImage)scope.replaceImage(next);else scope.replaceModel(next);}
                catch{detailImageCandidate=undefined;destroy(next);if(retryFlatDetail===retryPromotion)retryFlatDetail=undefined;if(renderer.domElement.style.visibility==='hidden')input.unavailable('recovery');return;}
                const previous=object,retired=detailRetired;detailImageCandidate=undefined;object=next;detailPinned=next;detailRetired=true;
                if(retired&&previous)destroy(previous);
              };
              settleDetail=promoteImage;
              retryPromotion=createFlatDetailRetry({
                valid:()=>alive&&!signal.aborted&&!disposed&&!gpuLost&&!publicDisplayStopped&&sharedDetail===scope,
                pending:()=>pending.has(art.revisionId),retryAfter:()=>retryAfter.get(art.revisionId)??0,now:()=>performance.now(),
                ready:()=>(detailImageCandidate??detailPinned)?.userData.viewerAssetId===target.id,
                request:()=>request(art,true,false,true),
              });
              retryFlatDetail=retryPromotion;retryPromotion();
            };
            if(input.flatImage){
              // A registered model is required before any original byte read.
              // Unqualified publications retain the existing detail path.
              const owner=detailOwner,access=detailAccess,profile=imageProfile;
              const context=renderer.getContext();
              const viewport=()=>({width:input.host.clientWidth,height:input.host.clientHeight,canvasWidth:renderer.domElement.width,canvasHeight:renderer.domElement.height,pixelRatio:renderer.getPixelRatio(),devicePixelRatio:globalThis.devicePixelRatio});
              if(profile&&sameDetailImageViewport(profile.detailViewport,viewport())&&owner&&access&&matchesMeasuredWheatImage(profile,staticDetailAttestation(access,owner,profile.candidateId),admittedGallery)&&typeof WebGL2RenderingContext!=='undefined'&&context instanceof WebGL2RenderingContext){
                const admittedViewport=viewport();let legacyPending=false;
                const scopeCurrent=()=>renderer.getContext()===context&&alive&&!signal.aborted&&!disposed&&!gpuLost&&!publicDisplayStopped&&sharedDetail===scope&&isVerifiedStaticDetailAccess(owner,access);
                const stillCurrent=()=>sameDetailImageViewport(admittedViewport,viewport())&&scopeCurrent()&&coverReady()&&matchesMeasuredWheatImage(profile,staticDetailAttestation(access,owner,profile.candidateId),admittedGallery)&&globalThis.document.visibilityState==='visible';
                const activateLegacy=()=>{if(!scopeCurrent())return;if(globalThis.document.visibilityState!=='visible'){legacyPending=true;return;}legacyPending=false;void checkPublicAvailability(signal).then(()=>{if(scopeCurrent()&&globalThis.document.visibilityState==='visible')startApproved();else if(scopeCurrent())legacyPending=true;}).catch(()=>{if(scopeCurrent())stopPublicDisplay();});};
                resumeLegacy=()=>{if(legacyPending)activateLegacy();};
                const hints=(globalThis.navigator as Navigator&{userAgentData?:{platform:string;getHighEntropyValues(hints:string[]):Promise<{fullVersionList?:Array<{brand:string;version:string}>}>}}).userAgentData;
                void matchesDetailRuntime(profile.runtime,context,hints,signal).then(matches=>{
                  if(!stillCurrent()){activateLegacy();return;}if(!matches){activateLegacy();return;}
                  const generation=++originalDetailGeneration,attemptId=`viewer-detail-${generation}-${crypto.randomUUID()}`;
                  const current=()=>generation===originalDetailGeneration&&stillCurrent();
                  const retryDeadline=performance.now()+15000;
                  const attemptOriginal=()=>{try{
                    // The measured original has its own tighter scene ceiling.
                    // Reclaim only expendable encoded and unshown prepared assets.
                    const sceneLimit=Math.min(profile.maxSceneBytes,profile.transitionCapBytes-profile.reservationBytes);
                    const deficit=()=>peak.total()-sceneLimit;
                    if(current()&&deficit()>0){
                      for(const asset of arts.flatMap(work=>work.assets)){if(deficit()<=0)break;byteCache.delete(asset.id);}
                      evictPrepared(deficit);
                    }
                    originalAttempt=startDetailImageAttempt({profile,access,slot:originalDetailSlot,peak,limit:profile.transitionCapBytes,attemptId,generation,isCurrent:()=>current(),signal,three,
                      handoffReservation:(key,bytes)=>{if(!deferredCanvasRestore){originalSettled=true;return false;}if(restoreHold)throw Error('DETAIL_RESTORE_BUDGET');restoreHold={key,bytes};return true;},
                      isTrusted:()=>coverReady()&&matchesMeasuredWheatImage(profile,staticDetailAttestation(access,owner,profile.candidateId),admittedGallery),
                      draw:next=>{
                        if(!current())throw Error('DETAIL_STALE');
                        originalAttached=true;
                        try{scope.replaceImage(next);}catch(error){
                          if(error instanceof Error&&['DETAIL_DRAW_UNCONFIRMED','DETAIL_DRAW_ROLLED_BACK'].includes(error.message))originalAttached=false;
                          throw error;
                        }
                      },
                      hide:()=>{const wasAttached=originalAttached;originalAttached=false;const hadDisplay=originalDisplayed;originalDisplayed=false;diagnosticOriginal=null;diagnosticOriginalLimits=null;if(!wasAttached&&alive&&!signal.aborted&&!gpuLost&&sameDetailImageViewport(admittedViewport,viewport()))return;renderer.domElement.style.visibility='hidden';try{if(alive&&!signal.aborted&&!gpuLost)input.unavailable('restoring');scope.dispose();}catch(error){originalBlocked=true;renderer.domElement.style.visibility='hidden';throw error;}finally{if(hadDisplay)try{input.renderedTier?.(null,++originalDrawGeneration);}catch{/* A UI observer cannot prevent safe detachment. */}}},
                      completeCommands:()=>completeDetailCommands(context),progress:bytes=>transfer?.loaded(bytes),
                    });
                    if(diagnosticsEnabled())diagnosticOriginalLimits={transition:profile.transitionCapBytes,scene:profile.maxSceneBytes};
                    guardOriginalDetail=()=>{if(!originalSettled&&!current()){guardOriginalDetail=()=>{};retireOriginal();}};guardOriginalDraw=()=>{if(originalBlocked)return false;if(originalSettled)return true;if(current())return true;originalDrawSuppressed=true;guardOriginalDetail();return false;};
                    const transfer=beginDetailTransfer?.('acquired-original',profile.bytes),attempt=originalAttempt;
                    const fallback=()=>{retireOriginal();void attempt.close().then(()=>{redrawSettledBaseline();activateLegacy();},()=>{});};
                    void attempt.show().then(shown=>{
                      if(shown&&current()){
                        originalDisplayed=true;lastDrawnTier=undefined;if(diagnosticsEnabled())diagnosticOriginal={artworkRevisionId:art.revisionId,sha256:profile.sha256};
                        transfer?.loaded(profile.bytes);
                        try{input.renderedTier?.('acquired-original',++originalDrawGeneration);}catch{/* A UI observer cannot undo the committed draw. */}
                      }else fallback();
                    }).catch(fallback).finally(()=>transfer?.finish());
                  }catch(error){let validRefusal=error instanceof DetailImageBudgetRefusal&&error.attemptId===attemptId&&error.generation===generation&&current();if(validRefusal)try{originalDetailSlot.assertAvailable(attemptId,generation);}catch{validRefusal=false;}if(validRefusal){
                    startApproved();if(promoteImage)settleDetail=promoteImage;if(retryPromotion)retryFlatDetail=retryPromotion;
                    retryOriginalDetail=createDetailBudgetRetry({valid:current,now:()=>performance.now(),deadline:retryDeadline,
                      ready:()=>{const work=scheduler.stats();return detailBudgetRetryReady({floorSettled,surfaceSettled,deferred:materialBudgetDeferred.size,active:work.active,queued:work.queued,pending:pending.has(art.revisionId),candidate:!!detailImageCandidate,used:peak.total(),sceneCap:profile.maxSceneBytes,reservation:profile.reservationBytes,transitionCap:profile.transitionCapBytes});},
                      retry:()=>{retryOriginalDetail=undefined;if(settleDetail===promoteImage)settleDetail=undefined;if(retryFlatDetail===retryPromotion)retryFlatDetail=undefined;attemptOriginal();}});
                  }}};
                  attemptOriginal();
                }).catch(()=>{activateLegacy();});
              }else startApproved();
            }else if(art.artworkType==='sculpture'){
              if(!input.anchors.length&&lastDrawnTier==='lightweight')startApproved();
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
        const statsTimer = setInterval(()=>{const live=residentDemandActive({cancelled:residentRecoveryCancelled,disposed,gpuLost,publicDisplayStopped,observeWall:demandContext().observeWall,automatic,immersive});if(live)for(const [id,wait] of residentMinimumWait){const needed=!!(observedVisible.get(id)||observedEligible.get(id)||mapPins.has(id)||viewingPins.has(id));if(retryWaitingMinimum(id,wait.bytes,needed)){residentMinimumWait.delete(id);retryAfter.delete(id);minimumBlocked.delete(id);}else if(needed)minimumBlocked.add(id);}automaticDemand();retryFlatDetail?.();retryOriginalDetail?.();update();preparePublicThumbnail();sculptureOrbitRuntime.current?.refresh();for(const check of [...mapWaiters])check();}, 200);
        const originalRelease = release;
        release = () => {
          unregisterDiagnostic();
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
          for(const value of minimumObjects.values())destroy(value.object);minimumObjects.clear();minimumBlocked.clear();residentMinimumWait.clear();
          byteCache.clear();
          renderer.domElement.dataset.disposed = "true";
        };
        for (const art of arts.slice(0, viewerBudget.entranceAssets))
          request(art);
        update();
        if(hasWorkspaceFurnishings){
          await Promise.allSettled(catalogSettled);if(disposed||gpuLost)return;
          if(!benchAuthority)throw Error('WORKSPACE_FURNISHING_SOURCE_UNAVAILABLE');
          const changed=()=>{if(disposed||gpuLost||ownerFurnishingFrame)return;ownerFurnishingFrame=requestAnimationFrame(()=>{ownerFurnishingFrame=0;if(!disposed&&!gpuLost){if(ownerFurnishings)renderer.domElement.dataset.workspaceFurnishings=JSON.stringify(ownerFurnishings.stats());shadowPass.invalidate();render();}});};
          const extension=document.extensions![WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings,workspaceCache=new PublicWorkspaceCache(byteCache);
          const publicCheck=async(signal:AbortSignal)=>{
            signal.throwIfAborted();
            if(publicSource.check){await publicSource.check();signal.throwIfAborted();return;}
            const response=await fetch(`/api/v1/publications/${publicSource.publicationId}?footsteps=1`,{credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.any([signal,abort.signal,AbortSignal.timeout(10000)])});
            if(!response.ok)throw Error('PUBLICATION_UNAVAILABLE');const current=await response.json();signal.throwIfAborted();if(current.publication?.id!==publicSource.publicationId||current.publication?.status!=='published'||current.publication?.revisionSha256!==publicSource.revisionSha256)throw Error('PUBLICATION_UNAVAILABLE');
          };
          ownerFurnishings=createOwnerFurnishingScene({three,renderer,scene,rooms,candidate:document,tenantId:publicSource.publicationId,signal:abort.signal,unavailable:()=>disposed||gpuLost,budget:viewerBudget,transitionBytes:transitionBudgetBytes,resident:()=>byteCache.stats().bytes,changed,ledger:peak,modelSource:descriptor=>publicWorkspaceModelSource(publicSource.publicationId,publicSource.revisionSha256,publicSource.assets,extension,descriptor,publicSource.fetcher??fetch,benchAuthority.check,workspaceCache),publicAuthority:{check:publicCheck,valid:()=>publicWorkspaceFurnishingRights(extension)},disposeSource:()=>workspaceCache.dispose()});
          const result=await ownerFurnishings.start();if(!disposed){renderer.domElement.dataset.workspaceFurnishings=JSON.stringify(result);if(result.failed)setPublicMessage('일부 비품을 불러오지 못했어요.');changed();}
        }
        return;
      }
      // The local/native path uses the same bounded readout as public loading,
      // without adopting the public scheduler or its revision-based counters.
      const localStages=createPreparationStages(document.artworks),residentArtwork=new Set<InstanceType<typeof three.Object3D>>();let localResidentBytes=0;
      for (const placement of document.placements) {
        const artwork = document.artworks.find(
          (a) =>
            a.revisionId.toLowerCase() ===
            placement.artworkRevisionId.toLowerCase(),
        );
        const group = placements.get(placement.id.toLowerCase());
        if (!artwork || !group) continue;
        const inventory=artwork.assets.find(a=>a.id===artwork.primaryAssetId);
        const localStage=(value:string,error?:unknown)=>{
          if(disposed||!inventory)return;
          localStages.record(inventory.id,value,error);
          renderer.domElement.dataset.viewerState=JSON.stringify({preparationStages:localStages.snapshot()});
        };
        try {
          let source = sources.get(artwork.revisionId);
          if (!source) {
            localStage('queued');localStage('fetch-verify');
            source = loadArtwork(artwork,undefined,abort.signal,undefined,localStage);
            sources.set(artwork.revisionId, source);
          }
          const object = await source;
          if (disposed) {
            for (const r of decodedResources.get(object) ?? []) r.dispose();
            return;
          }
          if(!residentArtwork.has(object)){const bytes=object.userData.viewer?.decodedBytes;if(!Number.isSafeInteger(bytes)||bytes<0)throw Error('WORKSPACE_SCENE_BUDGET');localResidentBytes+=bytes;residentArtwork.add(object);}
          owned.push(...(decodedResources.get(object) ?? []));
          decodedResources.delete(object);
          const bounds = group.children[0];
          if (bounds) group.remove(bounds);
          group.add(object.clone(true));
          rendered++;
          shadowPass.invalidate();
          render();
          localStage('display-attached-render-requested');
        } catch (error) {
          unavailable++;
          localStage(abort.signal.aborted?'cancelled-settled':'failed',abort.signal.aborted?undefined:error);
        }
        if (!disposed) {
          setAssetReport({loaded:rendered,failed:unavailable});
          if (publicSource) setPublicMessage(unavailable ? "일부 작품을 불러오지 못했어요. 다시 시도하거나 작품 목록을 이용해 주세요." : "");
          setMessage(
            `공간 ${document.rooms.length} · 표면 ${document.surfaces.length} · 실제 개구부 ${document.openings.length} · 승인된 작품 derivative ${rendered}개 · bytes 사용 불가 ${unavailable}개 (점선은 실제 치수 metadata bounds).`,
          );
        }
      }
      if(hasWorkspaceFurnishings&&session&&ownerWorkspaceFurnishings&&!disposed&&!gpuLost){
        await Promise.allSettled(catalogSettled);if(disposed||gpuLost||ownerWorkspaceFurnishings.signal.aborted||Date.now()>=ownerWorkspaceFurnishings.expiresAt)return;
        const changed=()=>{if(disposed||gpuLost||ownerFurnishingFrame)return;ownerFurnishingFrame=requestAnimationFrame(()=>{ownerFurnishingFrame=0;if(!disposed&&!gpuLost){if(ownerFurnishings)renderer.domElement.dataset.workspaceFurnishings=JSON.stringify(ownerFurnishings.stats());shadowPass.invalidate();render();}});};
        ownerFurnishings=createOwnerFurnishingScene({three,renderer,scene,rooms,candidate:document,tenantId:session.tenantId,signal:AbortSignal.any([abort.signal,ownerWorkspaceFurnishings.signal]),unavailable:()=>disposed||gpuLost||ownerWorkspaceFurnishings.signal.aborted||Date.now()>=ownerWorkspaceFurnishings.expiresAt,budget:ownerWorkspaceFurnishings.budget,transitionBytes:transitionBudgetBytes,resident:()=>localResidentBytes+byteCache.stats().bytes,changed});
        const result=await ownerFurnishings.start();if(!disposed){renderer.domElement.dataset.workspaceFurnishings=JSON.stringify(result);if(result.failed)setMessage('일부 작업 공간 비품을 표시하지 못했어요. 등록 상태와 표시 권한을 확인하세요.');changed();}
      }
    };
    void build().catch((error) => {
      if (!disposed) {
        clearQualityFrame();
        setReady(false);
        setBuildFailed(true);
        const issue = error instanceof Error && error.message === "PREVIEW_COMPLEXITY"
          ? "이 전시의 공간이 표시 한도를 넘었어요."
          : "3D 화면을 표시하지 못했어요. ‘3D 다시 시작’으로 재시도할 수 있어요.";
        setPublicMessage(issue);
        setSceneIssue(issue);
      }
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
      const next=qualityIntent.current;
      if(immersive&&publicSource&&viewerBudget&&next.scope===qualityScope&&next.budget&&next.budget!==viewerBudget&&!xrActive.current&&!seatedBenchRef.current&&viewingStyleRef.current==='free'&&!sharedDetail)preserveQualityFrame();
      disposed = true;
      benchAction.current=null;
      resizeAction.current = null;
      abort.abort();
      release();
    };
  }, [referenceTone,
    sceneDocument,
    appearance,
    session,
    publicSource,
    privateCatalogue,
    ownerWorkspaceFurnishings,
    viewerBudget,
    resourceBudget,
    restart,
    transparentSpace,
    editingEnabled,
    immersive,
    fillHost,
    snapshotEnabled,
    initialSnapshot,
    qualityScope,
    clearQualityFrame,
  ]);
  const ControlsFrame = immersive || compactControls ? "details" : "div";
  const visibleBenchId=ready&&viewingStyle==='free'&&!xrRunning&&!suspendNavigation?(seatedBenchId??(immersive?nearbyBenchId:null)):null;
  const noticeState = !noticePageVisible || suspendNavigation || xrRunning ? undefined : sceneIssue ? "scene" : detailRestoreMessage ? "detail-restore" : ready ? artworkNotice : undefined;
  const noticeMessage = noticeState === "scene" ? sceneIssue
    : noticeState === "detail-restore" ? detailRestoreMessage
    : noticeState === "unavailable" ? "작품을 불러오지 못했어요."
    : noticeState === "loading" ? "작품 불러오는 중…" : "";
  return (
    <figure data-input-mode={inputMode} data-reduced-motion={walkSettings.reducedMotion} className={`geometry-preview${immersive ? " geometry-immersive" : ""}`} aria-hidden={suspendNavigation || undefined} inert={suspendNavigation || undefined}>
      {immersive&&viewingStyle==='ordered'&&sculptureOrbitState&&sculptureOrbitRuntime.current&&<SculptureOrbitControls state={sculptureOrbitState} actions={sculptureOrbitRuntime.current.actions}/>}
      {editing&&spaceTransparency===undefined&&<label><input type="checkbox" checked={transparentSpace} onChange={e=>setTransparentSpace(e.target.checked)}/>편집할 때 공간을 투명하게 보기 · 저장된 재질은 바뀌지 않아요</label>}
      {installationIssueCount>0&&<p role="status">받침대·프레임 {installationIssueCount}개를 표시하지 못했어요. 작품과 텍스트는 계속 볼 수 있어요.</p>}
      {materialIssueCount>0&&<p role="status">마감 텍스처 {materialIssueCount}종의 표시를 완료하지 못했어요. 저장된 재질 설정은 유지됩니다.</p>}
      {immersive && ready && viewingStyle==='free' && !seatedBenchId && !xrRunning && !suspendNavigation &&
        walkPaused && !panelResumeAvailable && (
          <button className="viewer-navigation-resume" onClick={()=>walkingActions.current?.start()}>
            {walkingMode ? "걷기 일시 정지 · 이동·시점 조작 재개" : "정지 관람 · 걷기 시작"}
          </button>
        )}
      <div className="geometry-stage watermark-display-stage">
        <div className="geometry-render-host" ref={host} />
        <WatermarkOverlay candidate={document}/>
        {visibleBenchId&&<button ref={benchActionButton} className="bench-return" data-bench-action={visibleBenchId}
          data-bench-seated={!!seatedBenchId} aria-keyshortcuts="F"
          onClick={()=>benchAction.current?.(visibleBenchId,!!seatedBenchId)}>
          {seatedBenchId?'일어서기':'앉기'}
        </button>}
        {viewerBudget && walkingMode && viewingStyle==='free' && (
          <WalkingTouch
            available={ready && !xrRunning && !suspendNavigation}
            paused={walkPaused}
            resumable={panelResumeAvailable}
            actions={walkingActions.current}
          />
        )}
      </div>
      {immersive && publicSource ? (
        <div className="viewer-artwork-notice" data-state={noticeState}>
          <p role="status">{noticeMessage}</p>
          {noticeState==='detail-restore'&&detailRestoreStatus==='failed'&&<button onClick={()=>setRestart(n=>n+1)}>3D 다시 시작</button>}
        </div>
      ) : (
        <figcaption hidden={publicSource && !detailRestoreMessage && !publicMessage} role="status" data-testid={publicSource ? undefined : "geometry-render-state"}>{publicSource ? (detailRestoreMessage||publicMessage) : message}</figcaption>
      )}
      {((content:ReactNode)=>immersive&&controlsHost?createPortal(content,controlsHost):content)(<ControlsFrame className="geometry-controls">
      {(immersive || compactControls) && <summary>공간 조작</summary>}
      {immersive && <><label>조작 방식<select aria-label="조작 방식" value={inputMode} onChange={event=>{walkingActions.current?.pause("settings");onInputModeChange?.(event.target.value as ViewerInputMode);}}><option value="auto">기기에 맞게 · 드래그 또는 터치</option><option value="pointer">마우스·키보드</option><option value="trackpad">트랙패드·키보드</option><option value="touch">터치·조이스틱</option></select></label><p>기기에 맞게 시작하며, 직접 바꾼 방식은 이번 관람에 유지돼요. 설정을 닫고 새 이동·시점 조작으로 이어가세요.</p></>}
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
          {seatedBenchId ? <p>앉아서 감상 중입니다. 화면의 돌아가기 버튼으로 종료할 수 있어요.</p> : <details><summary>벤치에서 감상</summary><p>직접 선택하면 앉은 시점에서 멈춰 감상합니다. 일어서면 이전 위치로 돌아갑니다.</p>{benchesFor(document).map(bench=><button key={bench.id} disabled={!ready||xrRunning||walkLoading||suspendNavigation} onClick={()=>walkingActions.current?.sit?.(bench.id)}>{bench.name} · 앉아서 감상</button>)}</details>}
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
      {publicSource && <details className="viewer-options"><summary>표시 상태 자세히</summary><p data-testid="geometry-render-state">{message}</p><p>{shadowMessage}</p></details>}
      </ControlsFrame>)}
    </figure>
  );
}
