import { demoDecorationNotice } from './private-editor/demo-decoration';
import {ViewerIcon} from './viewer/ViewerIcon';
import {createWheatCoverRetirement,tracksWheatCover} from './viewer/wheat-cover-retirement';
import {plaqueContent} from './plaque-content';
import { ViewerMark } from "./branding/ViewerMark";
import { ExhibitOSWordmark } from "./branding/ExhibitOSWordmark";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, useId, useMemo, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { entranceFor, entryPresentationFor, plaquesFor, artworkPlaqueCaptionFor, creationYearFor, benchesFor, materialFor, presentationFor, formatArtworkRecordedDimensions, viewingPlanFor, artworkThumbnailFor, roomPlaqueIntroductionFor } from "@exhibitos/studio-contract";
import { useMediaPreference } from "./publication-accessibility";
import { ViewerBoundary } from "./ViewerBoundary";
import { ViewerDiagnosticExport } from "./ViewerDiagnosticExport";
const subscribeUnavailableDownload=()=>()=>{};
const unavailableDownload=()=>null;
const Viewer = lazy(() => import("./Viewer").then(module => ({ default: module.Viewer })));
import { GuidedRoutes, type GuideRequest } from "./GuidedRoutes";
import type { AudioApi, VoicePlayback } from "./viewer/audio";
import { ArtworkDetail } from "./ArtworkDetail";
import type { SurfaceAppearance, DetailEntryActions } from "./GeometryPreview";
import type {SharedDetailPreview} from './viewer/borrowed-detail-preview';
import type {PublicPublication as PublicResponse} from "./publication-client";
import {validFootstepPublication} from './viewer/footstep-publication';
import { validateDraft } from "./drafts/validator";
import { newDraft } from "./drafts/example";
import { EntranceCover, coverAspectRatio } from './EntranceCover';
import { EntranceReadingShell } from './EntranceReadingShell';
import {useEntranceEntry,EntranceEntryOverlay,entryControlsBlocked,publicEntryTransition} from './entrance-entry';
import { EntryTicket } from './EntryTicket';
import { createEntranceReadiness } from './viewer/entrance-readiness';
import {entranceRuntime,entranceContent} from './entrance-runtime';
import "./publication-novice.css";
import "./publication-immersive.css";
import {ViewingStyles} from './viewer/ViewingStyles';
import {OrderedViewingChrome,type OrderedViewingItem} from './viewer/OrderedViewingChrome';
import {OrderedArtworkList} from './viewer/OrderedArtworkList';
import {createViewingSession,type ViewingRenderer,type ViewingState,type ViewingStyle,type ViewingActions} from './viewer/viewing-session';
import {createPublicThumbnailCache} from './viewer/public-thumbnail';
import {discardPrivateView} from './viewer/private-view-storage';
import {publicationTime} from './publication-time';
import {readRuntimeHistory} from './viewer/runtime-history';
import {RuntimeHistoryDetails,historyIsOpen} from './viewer/RuntimeHistoryDetails';
import {installPanelDismissal,panelEscapeFromControl} from './viewer/panel-resume';
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emptyThumbnails:Readonly<Record<string,string>>=Object.freeze({});
function PublicationRecordTime({value,source}:{value:unknown;source:'publication'|'file'|'output'}){
 const time=publicationTime(value),name=source==='publication'?'공개 기록':source==='output'?'출력 생성':'전시 파일 기록';
 const description=source==='publication'?'전시 공개 기록의 시각이며, 웹 배포나 개장 시각과 다를 수 있어요.':source==='output'?'오프라인 출력의 생성 시각이며, 공개일을 뜻하지 않아요.':'전시 파일에 기록된 시각이며, 웹 배포나 개장 시각을 뜻하지 않아요.';
 return <><p>{name} {time.kind==='date'?'날짜':'시각'} {time.dateTime?<time dateTime={time.dateTime}>{time.text}</time>:time.text}</p><p className="cms-note">{description}</p></>;
}
export function PublicPublication({ id, initial, connectionStatus, privateEditorHref,privateEditorRestricted=false,demoDecorationSession=false,recordTimeKind }: { id: string; initial?: PublicResponse; connectionStatus?:ReactNode; privateEditorHref?:string;privateEditorRestricted?:boolean;demoDecorationSession?:boolean;recordTimeKind?:'output-generated' }) {
  const [fileHistoryOpen,setFileHistoryOpen]=useState(false),[exhibitionInfoOpen,setExhibitionInfoOpen]=useState(false);
  const [value, setValue] = useState<PublicResponse | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(Boolean(initial));
  const generation = useRef(0);
  const coverRetirement=useMemo(()=>tracksWheatCover(value?.publication.revisionSha256)?createWheatCoverRetirement(()=>document.images):undefined,[value]);
  const publicationRoot=useRef<HTMLElement>(null);
  useEffect(()=>{if(publicationRoot.current&&value?.publication.id)return installPanelDismissal(publicationRoot.current);},[value?.publication.id,value?.publication.revisionSha256]);
  const entry=useEntranceEntry(),{mode,modeRef,stageReady,entryAttempt,entryTiming,entryButton,entryTicketRect,onStageState}=entry;
  const entranceReadiness=useMemo(()=>value?.local?.kind==='static'&&!value.local.dynamic
    ?createEntranceReadiness(value.local.entranceBootstrapBytes??0):undefined,[value]);
  const download=useSyncExternalStore(entranceReadiness?.subscribe??subscribeUnavailableDownload,
    entranceReadiness?.snapshot??unavailableDownload,unavailableDownload);
  const coverPrefetch=mode==='cover'&&Boolean(entranceReadiness);
  const showLiveStage=mode==='3d'||coverPrefetch;
  const [viewerUnavailable, setViewerUnavailable] = useState(false);
  const stageInteractive=mode==='3d'&&(stageReady||viewerUnavailable);
  const [thumbnailOwner,setThumbnailOwner]=useState<{key:string;cache:ReturnType<typeof createPublicThumbnailCache>}|null>(null);
  const [thumbnailState,setThumbnailState]=useState<{key:string;items:Readonly<Record<string,string>>}|null>(null);
  const thumbnailKey=value?`${value.publication.id}/${value.publication.revisionSha256}`:'';
  const thumbnailCache=thumbnailOwner?.key===thumbnailKey?thumbnailOwner.cache:null;
  const thumbnails=thumbnailState?.key===thumbnailKey?thumbnailState.items:emptyThumbnails;
  useEffect(()=>{
    if(!value||!value.exhibition.artworks.some(a=>artworkThumbnailFor(a))){setThumbnailOwner(null);setThumbnailState(null);return;}
    const key=`${value.publication.id}/${value.publication.revisionSha256}`;
    const check=async()=>{
      if(value.local){await value.local.check();return;}
      const response=await fetch(`/api/v1/publications/${value.publication.id}?footsteps=1`,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw Error('PUBLICATION_UNAVAILABLE');
      const current=await response.json();if(current.publication?.id!==value.publication.id||current.publication?.status!=='published'||current.publication?.revisionSha256!==value.publication.revisionSha256||!Array.isArray(current.assets)||current.assets.some((a:unknown)=>!a||typeof a!=='object'||typeof (a as {assetId?:unknown}).assetId!=='string'))throw Error('PUBLICATION_UNAVAILABLE');
      return current.assets.map((a:{assetId:string})=>a.assetId);
    };
    const cache=createPublicThumbnailCache({publicationId:value.publication.id,revisionSha256:value.publication.revisionSha256,assets:value.assets,fetcher:value.local?.fetcher,check,changed:items=>setThumbnailState({key,items})});
    setThumbnailOwner({key,cache});setThumbnailState({key,items:{}});
    const visibility=()=>{if(document.hidden)cache.invalidate();else void cache.recheck();};
    document.addEventListener('visibilitychange',visibility);
    const timer=setInterval(()=>{if(!document.hidden)void cache.recheck();},10000);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visibility);cache.dispose();};
  },[value]);
  useEffect(()=>{
    if(!value||!thumbnailCache||mode==='3d')return;
    let abort=new AbortController(),running=false,closed=false;
    const visibility=()=>{if(document.hidden)abort.abort();else if(!closed&&abort.signal.aborted)abort=new AbortController();};
    document.addEventListener('visibilitychange',visibility);
    const load=async()=>{if(running||document.hidden||abort.signal.aborted)return;running=true;const signal=abort.signal;try{for(const artwork of value.exhibition.artworks){if(signal.aborted||document.hidden)break;if(thumbnailCache.canLoad(artwork))await thumbnailCache.loadOne(artwork,signal);}}finally{running=false;}};
    void load();const timer=setInterval(()=>void load(),1000);
    return()=>{closed=true;abort.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visibility);};
  },[value,thumbnailCache,mode]);
  const [entranceLocale,setEntranceLocale]=useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuPanelId=useId(),orderedListId=useId(),menuFocusReturn=useRef(false),orderedListOpener=useRef<HTMLButtonElement|null>(null),orderedPanel=useRef<HTMLDetailsElement>(null);
  const [orderedListOpen,setOrderedListOpen]=useState(false);
  const openOrderedList=(opener:HTMLButtonElement)=>{orderedListOpener.current=opener;setOrderedListOpen(true);};
  useEffect(()=>{const frame=requestAnimationFrame(()=>{const panel=orderedPanel.current;if(orderedListOpen){const target=panel?.querySelector<HTMLElement>('.viewer-viewing-styles-list [aria-current="step"]')??panel?.querySelector<HTMLElement>('h2');target?.focus();target?.scrollIntoView({block:'nearest'});}else if(orderedListOpener.current){const opener=orderedListOpener.current;orderedListOpener.current=null;if(opener.isConnected&&!document.hidden&&!publicationRoot.current?.querySelector('details[data-visitor-panel][open],dialog[open],[aria-modal="true"]')&&opener.getClientRects().length&&getComputedStyle(opener).visibility!=='hidden')opener.focus({preventScroll:true});}});return()=>cancelAnimationFrame(frame);},[orderedListOpen]);
  const [controlsHost,setControlsHost]=useState<HTMLDivElement|null>(null);
  useLayoutEffect(()=>{
    if(mode!=='3d')return;
    const previous=[document.documentElement,document.body].map(element=>({element,overflow:element.style.overflow,overscrollBehavior:element.style.overscrollBehavior}));
    for(const {element}of previous){element.style.overflow='hidden';element.style.overscrollBehavior='none';}
    return()=>{for(const {element,overflow,overscrollBehavior}of previous){element.style.overflow=overflow;element.style.overscrollBehavior=overscrollBehavior;}};
  },[mode]);
  // Reserve the actual heights of the sculpture controls and session notice.
  useEffect(()=>{
    const root=publicationRoot.current;if(mode!=='3d'||!root)return;
    let orbit:HTMLElement|null=null,status:HTMLElement|null=null,caption:HTMLElement|null=null;
    const measure=()=>{root.style.setProperty('--ordered-orbit-height',`${orbit?.getBoundingClientRect().height??0}px`);root.style.setProperty('--ordered-status-height',`${status?.getBoundingClientRect().height??0}px`);root.style.setProperty('--ordered-caption-height',`${caption?.getBoundingClientRect().height??52}px`);};
    const resize=new ResizeObserver(measure);
    const findPanels=()=>{const nextOrbit=root.querySelector<HTMLElement>('.viewer-sculpture-orbit'),nextStatus=root.querySelector<HTMLElement>('.viewer-ordered-status'),nextCaption=root.querySelector<HTMLElement>('.viewer-ordered-caption');if(nextOrbit===orbit&&nextStatus===status&&nextCaption===caption)return;if(orbit)resize.unobserve(orbit);if(status)resize.unobserve(status);if(caption)resize.unobserve(caption);orbit=nextOrbit;status=nextStatus;caption=nextCaption;if(orbit)resize.observe(orbit);if(status)resize.observe(status);if(caption)resize.observe(caption);measure();};
    const changes=new MutationObserver(findPanels);changes.observe(root,{childList:true,subtree:true});findPanels();
    return()=>{changes.disconnect();resize.disconnect();root.style.removeProperty('--ordered-orbit-height');root.style.removeProperty('--ordered-status-height');root.style.removeProperty('--ordered-caption-height');};
  },[mode,value?.publication.id,value?.publication.revisionSha256]);
  const entryInput=useRef<'keyboard'|'pointer'|'touch'>('keyboard');
  const focusEntry=useCallback(()=>entryInput.current!=='touch',[]);
  const focusEntryPrompt=useCallback(()=>entryInput.current==='keyboard',[]);
  const entryStatus=useRef<HTMLParagraphElement>(null),menuRef=useRef(menuOpen);menuRef.current=menuOpen;
  useEffect(()=>{if(stageReady&&modeRef.current==="3d"&&!menuRef.current&&focusEntry())document.querySelector<HTMLCanvasElement>('canvas[aria-label="전시 공간 3D 미리보기"]')?.focus({preventScroll:true});},[stageReady,focusEntry]);
  const [guideRequest,setGuideRequest]=useState<GuideRequest>();
  const [voicePlayback,setVoicePlayback]=useState<VoicePlayback|null>(null);
  const voiceSubscription=useRef<(()=>void)|null>(null);
  useEffect(()=>()=>{voiceSubscription.current?.();},[]);
  const [guidedIndex, setGuidedIndex] = useState<number | null>(null);
  const [reducedMotion, setReducedMotion] = useMediaPreference("(prefers-reduced-motion: reduce)");
  const [highContrast, setHighContrast] = useMediaPreference("(prefers-contrast: more)");
  const viewingHeading = useRef<HTMLHeadingElement>(null);
  const [viewingFocusRequest,setViewingFocusRequest]=useState(0);
  useEffect(()=>{if(!viewingFocusRequest)return;const heading=viewingHeading.current,panel=heading?.closest<HTMLDetailsElement>('.publication-accessibility-menu');if(panel)panel.open=true;heading?.focus();},[viewingFocusRequest]);
  const guideHeading = useRef<HTMLHeadingElement>(null);
  const modeChanged = useRef(false);
  useEffect(() => {
    if (!modeChanged.current) return;
    modeChanged.current = false;
    if (mode === "text") document.getElementById("publication-artworks")?.focus();
    else if (mode === "cover") entryButton.current?.focus();
  }, [mode]);
  useEffect(() => { if (guidedIndex !== null) guideHeading.current?.focus(); }, [guidedIndex]);
  const [selection, setSelection] = useState<{placementId:string; plaqueId?:string} | null>(null);
  const selectedId = selection?.placementId ?? null;
  const setSelectedId = useCallback((placementId:string|null,plaqueId?:string) => {
    setSelection(placementId === null ? null : {placementId,plaqueId});
  },[]);
  useEffect(()=>{if(viewerUnavailable&&mode==="3d")document.querySelector<HTMLButtonElement>('[aria-label="3D 관람 오류"] button')?.focus({preventScroll:true});},[viewerUnavailable,mode]);
  const [proximityDetail, setProximityDetail] = useState(false);
  const preferredViewingStyle=useRef<ViewingStyle>('free');
  const cancelMapTravel=useRef<(()=>void)|null>(null);
  const registerMapCancel=useCallback((cancel:(()=>void)|null)=>{cancelMapTravel.current=cancel;},[]);
  const viewingSession=useRef<ReturnType<typeof createViewingSession>|null>(null);
  const [viewingState,setViewingState]=useState<ViewingState>({style:'free',status:'idle',message:''});
  const [viewingReady,setViewingReady]=useState(false);
  useEffect(()=>{
    preferredViewingStyle.current='free';setViewingState({style:'free',status:'idle',message:''});
    return()=>{viewingSession.current?.dispose();viewingSession.current=null;};
  },[value?.publication.id,value?.publication.revisionSha256]);
  const registerViewing=useCallback((renderer:ViewingRenderer|null)=>{
    viewingSession.current?.dispose();viewingSession.current=null;setViewingReady(!!renderer);
    if(!renderer||!value)return;
    const current=createViewingSession({stops:viewingPlanFor(value.exhibition).stops,prepare:(stop,signal)=>renderer.prepare(stop,signal),free:()=>renderer.free(),changed:state=>{if(viewingSession.current===current)setViewingState(state);}});
    viewingSession.current=current;setViewingState(current.state());
    if(preferredViewingStyle.current==='ordered'){cancelMapTravel.current?.();current.actions.setStyle('ordered');}
  },[value]);
  const chooseViewingStyle=(style:ViewingStyle)=>{preferredViewingStyle.current=style;if(value)setGuideDismissal(previous=>({...((previous?.publicationId===value.publication.id&&previous.revision===value.publication.revisionSha256)?previous:{publicationId:value.publication.id,revision:value.publication.revisionSha256,dismissed:false}),choiceMade:true}));};
  const viewingActions:ViewingActions={setStyle(style){cancelMapTravel.current?.();chooseViewingStyle(style);viewingSession.current?.actions.setStyle(style);},step:direction=>{cancelMapTravel.current?.();viewingSession.current?.actions.step(direction);},select:placementId=>{cancelMapTravel.current?.();viewingSession.current?.actions.select(placementId);},cancel:()=>viewingSession.current?.actions.cancel()};
  const [guideDismissal,setGuideDismissal]=useState<{publicationId:string;revision:string;dismissed:boolean;choiceShown?:boolean;choiceMade?:boolean;hintShown?:boolean}|null>(null);
  const [overview, setOverview] = useState<"opening" | "credits" | {roomId:string} | null>(null);
  useEffect(()=>{
    if(!menuFocusReturn.current)return;
    menuFocusReturn.current=false;
    if(mode!=="3d"||!stageReady||viewerUnavailable||menuOpen||selectedId||overview)return;
    const root=publicationRoot.current;
    const frame=requestAnimationFrame(()=>{
      if(!root?.isConnected||root!==publicationRoot.current||menuRef.current||document.hidden||!root.querySelector('.publication-menu')?.contains(document.activeElement)||root.querySelector('details[data-visitor-panel][open]')||document.querySelector('dialog[open], [aria-modal="true"]'))return;
      const canvas=root.querySelector<HTMLCanvasElement>('canvas[aria-label="전시 공간 3D 미리보기"]');
      if(canvas?.isConnected&&canvas.getClientRects().length&&!canvas.closest('[hidden], [inert]')&&getComputedStyle(canvas).visibility!=="hidden")canvas.focus({preventScroll:true});
    });
    return()=>cancelAnimationFrame(frame);
  },[menuOpen,mode,stageReady,viewerUnavailable,selectedId,overview,value?.publication.id,value?.publication.revisionSha256]);
  const detailEntry = useRef<DetailEntryActions | null>(null),orderedDetailOpener=useRef<HTMLButtonElement|null>(null);
  const registerDetailEntry = useCallback((actions: DetailEntryActions | null) => { detailEntry.current = actions; }, []);
  const sharedDetailPreview=useCallback<SharedDetailPreview>(request=>{
    const mount=detailEntry.current?.mountPreview;
    return mount?mount(request):Promise.reject(Error('DETAIL_MAIN_VIEWER_UNAVAILABLE'));
  },[]);
  const prepareDetailEntry = useCallback(() => { detailEntry.current?.prepare(); }, []);
  const audio = useRef<AudioApi | null>(null);
  const registerAudio = useCallback((api: typeof audio.current) => { audio.current = api; voiceSubscription.current?.();voiceSubscription.current=api?.subscribeVoice(setVoicePlayback)??null;if(!api)setVoicePlayback(null); }, []);
  const playVoice = useCallback(async (assetId: string) => {
    if (!audio.current) throw Error("AUDIO_UNAVAILABLE");
    await audio.current.playVoice(assetId);
  }, []);
  const stopVoice = useCallback(() => { audio.current?.stopVoice(); }, []);
  const showTextArtworks=useCallback(()=>{entry.cancel('text');stopVoice();setSelectedId(null);setOverview(null);setMenuOpen(false);modeChanged.current=true;},[stopVoice,entry.cancel,setSelectedId]);
  const cancelEntry=()=>{entry.cancel();setMenuOpen(false);modeChanged.current=true;};
  const enter=()=>{
    if(modeRef.current==="3d")return;
    if(viewerUnavailable){window.location.reload();return;}
    entry.begin();setMenuOpen(false);
  };
  async function load() {
    const current = ++generation.current;
    entry.cancel();
    setLoading(true);
    setGuidedIndex(null);
    setGuideRequest(undefined);
    setSelectedId(null);
    setOverview(null);
    setValue(null);
    setError("");
    try {
      if (!uuid.test(id)) throw Error("PUBLICATION_UNAVAILABLE");
      if (initial) {
        await initial.local?.check();
        if(!validFootstepPublication(initial))throw Error('INVALID_PUBLICATION');
        if (generation.current === current) setValue(initial);
        return;
      }
      const response = await fetch(`/api/v1/publications/${id}?footsteps=1`, {
        credentials: "omit",
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw Error("PUBLICATION_UNAVAILABLE");
      const result = (await response.json()) as PublicResponse;
      const envelope = newDraft();
      envelope.schemaVersion = result.exhibition.schemaVersion;
      envelope.exhibitionId = result.exhibition.id;
      envelope.candidate = result.exhibition;
      if (
        result.publication.id !== id ||
        result.publication.status !== "published" ||
        !/^[a-f0-9]{64}$/.test(result.publication.revisionSha256) ||
        !validateDraft(envelope).valid ||
        !validFootstepPublication(result) ||
        !Array.isArray(result.assets) ||
        result.assets.some(
          (asset) =>
            !uuid.test(asset.assetId) ||
            asset.url !==
              `/api/v1/publications/${id}/assets/${asset.assetId}` ||
            !["image/png", "model/gltf-binary", "audio/wav"].includes(asset.mime),
        )
      )
        throw Error("INVALID_PUBLICATION");
      if (generation.current === current) setValue({publication:result.publication, exhibition:result.exhibition, assets:result.assets,...(result.resources?{resources:result.resources}:{})});
    } catch {
      if (generation.current === current)
        setError(
          "공개 전시를 확인할 수 없습니다. 철회·권리 변경 또는 연결 상태를 확인하고 다시 시도하세요.",
        );
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [id, initial]);
  const appearance = useCallback(
    (surfaceId: string): SurfaceAppearance => {
      const material = materialFor(value?.exhibition ?? {}, surfaceId);
      return {
        baseColor: [1, 3, 5].map(
          (i) => parseInt(material.color.slice(i, i + 2), 16) / 255,
        ) as [number, number, number],
        roughness: material.roughness,
        metalness: material.metalness,
      };
    },
    [value],
  );
  const requestPlaque=(id:string)=>{
    if(!value)return;const plaque=plaquesFor(value.exhibition).find(p=>p.id===id&&p.visible);if(!plaque)return;
    stopVoice();
    if(plaque.source.kind==='artwork'){const source=plaque.source;setSelectedId(value.exhibition.placements.find(p=>p.id.toLowerCase()===source.placementId.toLowerCase())!.id,plaque.id);}
    else setOverview(plaque.source.kind==='exhibition'?"opening":{roomId:plaque.roomId});
  };
  const viewingPlan=value?viewingPlanFor(value.exhibition):{version:1 as const,stops:[]};
  const viewingPlacements=value?(viewingPlan.stops.length?viewingPlan.stops.map(stop=>value.exhibition.placements.find(p=>p.id.toLowerCase()===stop.placementId.toLowerCase())!).filter(Boolean):value.exhibition.placements):[];
  const plaqueLinks=value?plaquesFor(value.exhibition).filter(p=>p.visible):[];
  const viewingItems:OrderedViewingItem[]=value?viewingPlacements.map(p=>{
    const art=value.exhibition.artworks.find(a=>a.revisionId.toLowerCase()===p.artworkRevisionId.toLowerCase());
    const plaque=plaqueLinks.find(q=>q.source.kind==='artwork'&&q.source.placementId.toLowerCase()===p.id.toLowerCase());
    const caption=plaque?artworkPlaqueCaptionFor(plaque,globalThis.navigator?.language||'ko'):undefined;
    const created=art?.provenance.events.find(event=>event.type==='created');
    const date=caption?.date??(art?creationYearFor(art):undefined)??created?.at.slice(0,4);
    return {placementId:p.id,title:art?.metadata.title??'작품',artist:caption?.artist??art?.metadata.artist,date:date===undefined?undefined:String(date),plaqueId:plaque?.id,roomName:value.exhibition.rooms.find(r=>r.id.toLowerCase()===p.roomId.toLowerCase())?.name??'전시 공간',thumbnail:thumbnails[p.artworkRevisionId.toLowerCase()]};
  }):[];
  const entryPresentation=entryPresentationFor(value?.exhibition??{}),runtime=value?entranceRuntime(value.exhibition,reducedMotion,window.matchMedia('(max-width:700px)').matches):null,coverContent=value?entranceContent(value.exhibition,entranceLocale,window.matchMedia('(max-width:700px)').matches):null;
  const entryTransition=publicEntryTransition(runtime);
  return (
    <main ref={publicationRoot} onPointerDownCapture={event=>{entryInput.current=event.pointerType==='touch'?'touch':'pointer';}} onKeyDownCapture={()=>{entryInput.current='keyboard';}} className={`cms-shell publication-shell publication-mode-${mode}${highContrast ? " publication-high-contrast" : ""}`} data-reduced-motion={reducedMotion} data-entry-ready={stageReady} data-entry-generation={entryAttempt} data-entry-timing={entryTiming?JSON.stringify(entryTiming):undefined}>
      <nav className="publication-skip-links" aria-label="바로 가기">
        <a href="#publication-viewing" onClick={event => {event.preventDefault();setMenuOpen(true);setViewingFocusRequest(n=>n+1);}}>관람 설정으로 건너뛰기</a>
        <a href="#publication-artworks" onClick={showTextArtworks}>작품 목록으로 건너뛰기</a>
      </nav>
      {(loading||error)&&<EntranceReadingShell motion={!reducedMotion} exhibition={initial?.exhibition} title={initial?.exhibition.title??"전시"} artist={initial&&entranceFor(initial.exhibition).artist} introduction={initial&&entranceFor(initial.exhibition).introduction} hasImage={Boolean(!error&&initial&&entranceFor(initial.exhibition).imageAssetId)} folded={!reducedMotion&&entryPresentation.coverUnfold} ratio={initial?coverAspectRatio(initial):4/3} status={<p className={loading?'publication-entry-status-quiet':undefined} role={loading?'status':'alert'} data-testid="public-state">{loading?"전시 정보를 확인하고 있어요.":error}</p>}/>}
      {error && <button disabled={loading} onClick={() => void load()}>다시 시도</button>}
      {value && (
        <article>
          <div className="publication-cover-surface" style={entryTicketRect?{'--entry-ticket-left':`${entryTicketRect.left}px`,'--entry-ticket-top':`${entryTicketRect.top}px`,'--entry-ticket-width':`${entryTicketRect.width}px`,'--entry-ticket-height':`${entryTicketRect.height}px`} as CSSProperties:undefined} data-entering={mode==="3d"} aria-hidden={mode==="3d"} inert={mode==="3d"} hidden={mode==="3d"&&(stageReady||viewerUnavailable)}>
          <EntranceCover key={value.publication.revisionSha256} publication={value} entranceReadiness={entranceReadiness} coverRetirement={coverRetirement} locale={entranceLocale} showImage={mode!=="text"&&!stageReady} interactive={mode==="cover"} motion={!reducedMotion}
            ticket={<EntryTicket title={coverContent!.title} variant={runtime!.variant} showDate={runtime!.design.ticket.showDate} showTime={runtime!.design.ticket.showTime} active={mode==="3d"} animate={runtime!.effects.response==='tear'} unavailable={viewerUnavailable} buttonRef={entryButton} onEnter={enter}/>}>
            {null}
          </EntranceCover></div>
          {mode==="3d"&&!viewerUnavailable&&!stageReady&&<EntranceEntryOverlay key={entryAttempt} entry={entry} transition={entryTransition} speed={runtime!.effects.speed} statusRef={entryStatus} focusStatus={focusEntryPrompt} onCancel={cancelEntry} onText={showTextArtworks} download={entranceReadiness?download:undefined}/>}
          {mode === "text" && viewerUnavailable && <p>3D를 다시 요청하려면 페이지를 새로 열어야 해요. 글·목록 관람은 새로고침 없이 계속할 수 있어요.</p>}
          {mode==='3d'&&stageReady&&viewingReady&&!viewerUnavailable&&<OrderedViewingChrome state={viewingState} items={viewingItems} actions={viewingActions} onList={openOrderedList} listId={orderedListId} blocked={!!selectedId||!!overview} onDetailPrepare={prepareDetailEntry} onDetail={(item,pointer,opener)=>{orderedDetailOpener.current=opener;if(!pointer)detailEntry.current?.prepare();detailEntry.current?.commit(pointer);setSelectedId(item.placementId,item.plaqueId);}}/>}
          {mode==='3d'&&<details ref={orderedPanel} name="exhibitos-visitor-panel" data-visitor-panel="" className="viewer-ordered-list-panel" open={orderedListOpen} onToggle={event=>{if(event.target===event.currentTarget)setOrderedListOpen(event.currentTarget.open);}} onKeyDown={event=>{if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();event.stopPropagation();event.currentTarget.open=false;setOrderedListOpen(false);}}} onPointerDown={event=>event.stopPropagation()} onPointerUp={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()}>
            <summary aria-hidden="true" tabIndex={-1}>관람 순서</summary><section id={orderedListId} role="dialog" aria-labelledby={`${orderedListId}-title`}>
              <header><h2 id={`${orderedListId}-title`} tabIndex={-1}>관람 순서</h2><button type="button" aria-label="목록 닫기" onClick={()=>{if(orderedPanel.current)orderedPanel.current.open=false;setOrderedListOpen(false);}}><ViewerIcon name="close"/></button></header>
              <OrderedArtworkList state={viewingState} items={viewingItems} onSelect={id=>{if(orderedPanel.current)orderedPanel.current.open=false;setOrderedListOpen(false);viewingActions.select(id);}}/>
            </section>
          </details>}
          <details name={mode==='3d'?'exhibitos-visitor-panel':undefined} data-visitor-panel="" className="publication-menu" open={menuOpen} onToggle={event => {if(event.target===event.currentTarget)setMenuOpen(event.currentTarget.open);}} onKeyDown={event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!panelEscapeFromControl(event.target)){event.preventDefault();event.stopPropagation();menuFocusReturn.current=mode==='3d'&&stageReady&&event.currentTarget.open;event.currentTarget.open=false;setMenuOpen(false);event.currentTarget.querySelector<HTMLElement>(':scope>summary')?.focus({preventScroll:true});}}} onPointerDown={event=>event.stopPropagation()} onPointerUp={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()}>
          <summary aria-label={mode==='3d'?'메뉴':mode==='cover'?(menuOpen?'전시 정보 닫기':'전시 정보 열기'):undefined} title={mode==='3d'?'메뉴':mode==='cover'?(menuOpen?'전시 정보 닫기':'전시 정보 열기'):undefined} aria-expanded={menuOpen} aria-controls={menuPanelId}>{mode==='3d'?<ViewerIcon name={menuOpen?'close':'menu'}/>:mode==='cover'?<ViewerIcon name={menuOpen?'close':'info'}/>:"전시 정보"}</summary>
          <div className="publication-menu-panel" id={menuPanelId}>
          {connectionStatus}
          {mode==='3d'&&<ViewingStyles state={viewingState} items={viewingItems} actions={viewingActions} available={viewingReady&&viewingPlan.stops.length>0}/>}
          {mode === "3d" && <button onClick={showTextArtworks}>텍스트로 관람</button>}
          {privateEditorHref && <div className="publication-private-entry">{privateEditorRestricted?<p>직접 꾸며보기는 데스크톱에서 이용할 수 있어요. 이 기기에서는 전시를 관람해 주세요.</p>:<><a className="publication-private-edit" href={privateEditorHref} onClick={()=>{if(mode!=="3d"||!stageReady||viewerUnavailable)discardPrivateView(value.publication.id,value.publication.revisionSha256,document.querySelector<HTMLMetaElement>('meta[name="exhibitos-static-index"]')?.content??'');}}>직접 꾸며보기</a><p>{demoDecorationSession?demoDecorationNotice:'이 브라우저에 개인 사본을 만들어요.'}</p></>}</div>}
          <GuidedRoutes key={value.publication.revisionSha256} exhibition={value.exhibition} onArtwork={id=>{detailEntry.current?.prepare();detailEntry.current?.commit(false);setSelectedId(id);}} onView={mode === "3d" && stageReady && !viewerUnavailable && !selectedId && !overview ? (routeId,index)=>{stopVoice();setMenuOpen(false);setGuideRequest({routeId,index,sequence:performance.now()});} : undefined} />
          <section className="publication-settings-menu" aria-label="설정"><h2>설정</h2>
          <div ref={setControlsHost} inert={entryControlsBlocked(mode,stageReady,viewerUnavailable,entry.entryFailed)} aria-hidden={entryControlsBlocked(mode,stageReady,viewerUnavailable,entry.entryFailed)} />
          <ViewerDiagnosticExport publicationId={value.publication.id} revisionSha256={value.publication.revisionSha256} />
          {mode==='3d'&&<button type="button" className="publication-panel-link" onClick={()=>{const panel=publicationRoot.current?.querySelector<HTMLDetailsElement>('.viewer-audio-menu');if(panel){panel.open=true;queueMicrotask(()=>{if(panel.open&&panel.isConnected&&publicationRoot.current?.contains(panel))panel.querySelector<HTMLElement>(':scope>summary')?.focus({preventScroll:true});});}}}>소리 설정</button>}
          <details className="publication-accessibility-menu"><summary>접근성</summary><section aria-label="관람 방식과 접근성 설정">
            {runtime!.design.translations.length>0&&<label>표지 언어<select value={entranceLocale} onChange={e=>setEntranceLocale(e.target.value)}><option value="">원문</option>{runtime!.design.translations.map(t=><option key={t.locale} value={t.locale}>{t.locale}</option>)}</select></label>}
            <h2 id="publication-viewing" tabIndex={-1} ref={viewingHeading}>관람 방식과 접근성 설정</h2>
                <p>글·목록 관람에서는 3D 공간과 음성을 불러오지 않습니다. 준비된 작은 미리보기와 함께 설명, 대본, 치수와 권리를 읽을 수 있습니다.</p>
            <label><input type="checkbox" checked={reducedMotion} onChange={e => setReducedMotion(e.target.checked)} />움직임 줄이기</label>
            <label><input type="checkbox" checked={highContrast} onChange={e => setHighContrast(e.target.checked)} />높은 대비</label>
            <p>처음에는 기기의 움직임 줄이기·대비 설정을 따릅니다. 움직임 줄이기는 입장·화면 전환의 움직임을 줄여요. 직접 선택하면 이 관람 동안 선택한 설정을 사용합니다.</p>
            {mode === "3d" && <>
              <label><input type="checkbox" checked={proximityDetail} onChange={e => setProximityDetail(e.target.checked)} />작품에 가까워지면 상세 보기 자동 열기 (기본 꺼짐)</label>
            </>}
          </section>
          </details></section>
          <details className="publication-info-menu" onToggle={event=>{if(event.target===event.currentTarget)setExhibitionInfoOpen(event.currentTarget.open);}}><summary>전시 정보</summary>
          <button onPointerDown={prepareDetailEntry} onClick={event => { detailEntry.current?.commit(event.detail > 0); setOverview("opening"); }}>전시 소개</button>
          <button onPointerDown={prepareDetailEntry} onClick={event => { detailEntry.current?.commit(event.detail > 0); setOverview("credits"); }}>전시 크레딧</button>
          {plaqueLinks.length>0&&<section className="publication-plaque-links" aria-label="공간 명판"><ul>{plaqueLinks.map((plaque,index)=>{
            const content=plaqueContent(value.exhibition,plaque),roomName=value.exhibition.rooms.find(room=>room.id.toLowerCase()===plaque.roomId.toLowerCase())?.name??content.title;
            const kind=plaque.source.kind==='artwork'?'작품 안내':plaque.source.kind==='exhibition'?'전시 안내':'공간 안내';
            const multipleInRoom=plaqueLinks.some(other=>other!==plaque&&other.roomId.toLowerCase()===plaque.roomId.toLowerCase());
            return <li key={plaque.id}><button aria-label={`${roomName} ${kind}${plaqueLinks.length>1?` ${index+1}`:''}: ${content.title}`} onPointerDown={prepareDetailEntry} onClick={event=>{detailEntry.current?.commit(event.detail>0);requestPlaque(plaque.id);}}>{roomName}{(multipleInRoom||plaque.source.kind==='artwork')&&<span className="publication-plaque-detail">{content.title===roomName?kind:content.title}</span>}</button></li>;
          })}</ul></section>}
          <details className="publication-record" onToggle={event=>setFileHistoryOpen(event.currentTarget.open)}>
            <summary>파일 기록</summary>
            <PublicationRecordTime value={value.publication.publishedAt} source={recordTimeKind==='output-generated'?'output':value.local?'file':'publication'}/>
            <p>전시 버전 <code>{value.publication.revisionSha256}</code></p>
            <RuntimeHistoryDetails key={`${value.publication.id}/${value.publication.revisionSha256}`} history={readRuntimeHistory(document)} open={historyIsOpen(menuOpen,exhibitionInfoOpen,fileHistoryOpen)} active={value.local?.kind==='static'&&value.local.verifiedIndexSha256?{indexSha256:value.local.verifiedIndexSha256,publicationId:value.publication.id,revisionSha256:value.publication.revisionSha256}:undefined}/>
            <button disabled={loading} onClick={() => void load()}>전시 파일 다시 확인</button>
          </details>
          </details>
          {mode === "text" && <button onClick={() => {setMenuOpen(false);modeChanged.current=true;entry.cancel();}}>전시 표지로</button>}

          </div></details>
          {showLiveStage && <div className="publication-live-stage" data-stage-ready={mode==='3d'&&stageReady} aria-hidden={!stageInteractive} inert={!stageInteractive} hidden={coverPrefetch&&viewerUnavailable}><ViewerBoundary key={entranceReadiness?thumbnailKey:entryAttempt} focusFallback={mode==='3d'&&selectedId === null && overview === null} onUnavailable={() => setViewerUnavailable(true)} onReturn={showTextArtworks}>
            <Suspense fallback={null}>
            <Viewer entranceMode={entranceReadiness?(mode==='cover'?'cover':'enter'):undefined} entranceReadiness={entranceReadiness} coverOriginalEligible={coverRetirement?.canAdmit} focusEntry={focusEntry} focusEntryPrompt={focusEntryPrompt} helpReady={mode==='3d'&&stageReady&&viewingReady&&!entry.entryFailed&&!viewerUnavailable} choiceRequired={!(guideDismissal?.publicationId===value.publication.id&&guideDismissal.revision===value.publication.revisionSha256&&(guideDismissal.choiceShown||guideDismissal.choiceMade||guideDismissal.dismissed))&&viewingState.style==='free'&&preferredViewingStyle.current==='free'} orderedAvailable={viewingReady&&viewingPlan.stops.length>0} choicePending={viewingState.status==='preparing'} onChoicePresented={()=>setGuideDismissal(previous=>({...((previous?.publicationId===value.publication.id&&previous.revision===value.publication.revisionSha256)?previous:{publicationId:value.publication.id,revision:value.publication.revisionSha256,dismissed:false}),choiceShown:true}))} onChooseViewingStyle={style=>{if(style===viewingState.style)chooseViewingStyle(style);else viewingActions.setStyle(style);}} hintAlreadyShown={guideDismissal?.publicationId===value.publication.id&&guideDismissal.revision===value.publication.revisionSha256&&!!guideDismissal.hintShown} onHintShown={()=>setGuideDismissal(previous=>({...((previous?.publicationId===value.publication.id&&previous.revision===value.publication.revisionSha256)?previous:{publicationId:value.publication.id,revision:value.publication.revisionSha256,dismissed:false}),hintShown:true}))} viewingStyle={viewingState.style} onMapCancelReady={registerMapCancel} mapEnabled={viewingState.style==='free'&&viewingState.pendingStyle!=='ordered'} onMapAction={()=>viewingSession.current?.actions.cancel()} publication={value} artworkThumbnails={thumbnails} thumbnailCache={thumbnailCache} appearance={appearance} onArtworkSelect={id=>{viewingSession.current?.context(id);setSelectedId(id);}} onViewingRendererReady={registerViewing} onPlaqueSelect={requestPlaque}
              immersive controlsHost={controlsHost} onNavigationActive={()=>setMenuOpen(false)} onStageState={onStageState} focusedPlacementId={selectedId} suspendNavigation={selectedId !== null || overview !== null} proximityDetail={proximityDetail} onAudioReady={registerAudio} onDetailEntryReady={registerDetailEntry}
              guideDismissed={guideDismissal?.publicationId===value.publication.id&&guideDismissal.revision===value.publication.revisionSha256&&guideDismissal.dismissed}
              onGuideDismissedChange={dismissed=>setGuideDismissal(previous=>({...((previous?.publicationId===value.publication.id&&previous.revision===value.publication.revisionSha256)?previous:{}),publicationId:value.publication.id,revision:value.publication.revisionSha256,dismissed}))}
              reducedMotion={reducedMotion} onReducedMotionChange={setReducedMotion} guideRequest={guideRequest} />
            </Suspense>
          </ViewerBoundary></div>}
          {selectedId && <ArtworkDetail key={selectedId} publication={value} placementId={selectedId} plaque={plaqueLinks.find(plaque => plaque.id === selection?.plaqueId)}
            showDiagnosticExport
            onClose={() => {setSelectedId(null);if(mode === "3d" && stageReady && !viewerUnavailable)detailEntry.current?.resumeViewing?.();const opener=orderedDetailOpener.current;orderedDetailOpener.current=null;if(opener)requestAnimationFrame(()=>{if(opener.isConnected&&opener.getClientRects().length&&!document.hidden&&!publicationRoot.current?.querySelector('details[data-visitor-panel][open],dialog[open],[aria-modal="true"]'))opener.focus({preventScroll:true});});}} onVoicePlay={playVoice} onVoiceStop={stopVoice} renderPreview={mode === "3d" && !viewerUnavailable} voicePlayback={voicePlayback} sharedPreview={mode==='3d'?sharedDetailPreview:undefined} />}
          {overview && <ExhibitionOverview publication={value} mode={overview} textMode={mode === "text"} onClose={() => {setOverview(null);if(mode!=="3d")setMenuOpen(false);if(mode === "3d" && stageReady && !viewerUnavailable)detailEntry.current?.resumeViewing?.();}} />}
          <div hidden={mode !== "text"} className="publication-text-content">
          <section aria-label="작품 목록형 대체 보기">
            <h2 id="publication-artworks" tabIndex={-1}>작품 목록</h2>
            <p>아래 순서는 공개된 작품 목록의 순서입니다. 작가가 지정한 공간 이동 경로가 아닙니다.</p>
            {guidedIndex === null ? <button disabled={!value.exhibition.placements.length} onClick={() => setGuidedIndex(0)}>목록 순서로 안내 시작</button> : <div className="publication-guide" aria-label="목록 순서 안내">
              <h3 ref={guideHeading} tabIndex={-1}>목록 안내 · 작품 {guidedIndex + 1} / {value.exhibition.placements.length}</h3>
              <button disabled={guidedIndex === 0} onClick={() => setGuidedIndex(index => Math.max(0, (index ?? 0) - 1))}><ViewerIcon name="previous"/>이전 작품</button>
              <button disabled={guidedIndex === value.exhibition.placements.length - 1} onClick={() => setGuidedIndex(index => Math.min(value.exhibition.placements.length - 1, (index ?? 0) + 1))}>다음 작품<ViewerIcon name="next"/></button>
              <button onClick={() => { setGuidedIndex(null); document.getElementById("publication-artworks")?.focus(); }}>전체 목록 보기</button>
              <p role="status">{value.exhibition.artworks.find(a => a.revisionId.toLowerCase() === value.exhibition.placements[guidedIndex]?.artworkRevisionId.toLowerCase())?.metadata.title}</p>
            </div>}
            <ul>
              {value.exhibition.placements.map((p, index) => {
                const a = value.exhibition.artworks.find(
                  (a) =>
                    a.revisionId.toLowerCase() ===
                    p.artworkRevisionId.toLowerCase(),
                );
                const description =
                  value.exhibition.accessibility.artworkDescriptions.find(
                    (d) => d.placementId.toLowerCase() === p.id.toLowerCase(),
                  );
                return (
                  <li key={p.id} hidden={guidedIndex !== null && index !== guidedIndex}>
                    {thumbnails[p.artworkRevisionId.toLowerCase()]&&<img src={thumbnails[p.artworkRevisionId.toLowerCase()]} alt="" loading="lazy" decoding="async"/>}
                    <h3>{a?.metadata.title}</h3>
                    <button onPointerDown={prepareDetailEntry} onClick={event => { detailEntry.current?.commit(event.detail > 0); setSelectedId(p.id); }} aria-label={`${a?.metadata.title ?? "작품"} 상세 보기`}>작품 상세 보기</button>
                    <p>
                      {a?.metadata.artist} · {a?.rights.creditLine}
                    </p>
                    <p>{description?.text ?? a?.metadata.description}</p>
                    <p>
                      {formatArtworkRecordedDimensions(a)}{a?.schemaVersion==='1.0.0-draft.2'?' · 등록된 크기, 모델 축 대응 미확인; 표시 크기는 임시 기준':''}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
          {plaqueLinks.length>0&&<section aria-label="공간 명판"><h2>공간 안내</h2><ul>{plaqueLinks.map(plaque=><li key={plaque.id}><button onPointerDown={prepareDetailEntry} onClick={event=>{detailEntry.current?.commit(event.detail>0);requestPlaque(plaque.id);}}>{plaqueContent(value.exhibition,plaque).title} 안내 읽기</button></li>)}</ul></section>}
          {benchesFor(value.exhibition).length>0&&<section aria-label="벤치 감상 지점"><h2>벤치 감상 지점</h2><p>공간 관람에서 벤치를 직접 선택해 앉거나 이전 위치로 돌아갈 수 있어요. 작품 설명은 이 목록에서 계속 읽을 수 있어요.</p><ul>{benchesFor(value.exhibition).map(bench=><li key={bench.id}>{bench.name} · {presentationFor(value.exhibition).viewpoints.find(v=>v.id.toLowerCase()===bench.viewpointId.toLowerCase())?.name}</li>)}</ul></section>}
          <p className="cms-note">공간 이동이 어렵다면 작품 목록에서 작품을 선택해 감상할 수 있어요. 소리 없이도 설명을 읽을 수 있어요.</p>
          <details className="publication-record">
            <summary>전시 정보</summary>
            <PublicationRecordTime value={value.publication.publishedAt} source={recordTimeKind==='output-generated'?'output':value.local?'file':'publication'}/>
            <p>{initial?.local?.kind === "static" ? "공개 시점의 전시 파일입니다. 권리 변경은 게시자가 새 배포로 반영합니다." : initial ? "서명과 유효한 오프라인 표시 기한을 확인했습니다." : "서버가 현재 공개 상태와 전시 권리를 확인했습니다."}</p>
            <p>전시 버전 <code>{value.publication.revisionSha256}</code></p>
            <button disabled={loading} onClick={() => void load()}>{initial?.local?.kind === "static" ? "전시 파일 다시 확인" : initial ? "오프라인 표시 기한 다시 확인" : "공개 상태 다시 확인"}</button>
            <p>이미 전달된 작품 파일은 복제될 수 있습니다.</p>
          </details>
          </div>
        </article>
      )}
      <footer>
        <span className="publication-brand" role="img" aria-label="ExhibitOS"><ViewerMark /><ExhibitOSWordmark /></span>
        <nav className="publication-utility-links" aria-label="관람과 고지">
          {value&&mode==='cover'&&<a href="#publication-artworks" onClick={showTextArtworks}>텍스트로 관람</a>}
          <a href="/THIRD_PARTY_NOTICES.txt">제3자 고지</a>
        </nav>
      </footer>
    </main>
  );
}

function ExhibitionOverview({ publication, mode, textMode, onClose }: {
  publication: PublicResponse; mode: "opening" | "credits" | {roomId:string}; textMode: boolean; onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement, element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) {
        const owner=previous.closest<HTMLDetailsElement>('details.publication-menu');
        const target=owner&&!owner.open?owner.querySelector<HTMLElement>(':scope>summary'):previous;
        if(target?.isConnected&&target.getClientRects().length&&!target.closest('[hidden], [inert]')&&getComputedStyle(target).visibility!=='hidden')target.focus({preventScroll:true});
      }
    };
  }, []);
  const room=typeof mode==='object'?publication.exhibition.rooms.find(r=>r.id.toLowerCase()===mode.roomId.toLowerCase()):undefined;
  const roomIntroduction=room?roomPlaqueIntroductionFor(publication.exhibition,room.id,'ko'):undefined;
  return <dialog className="artwork-detail" ref={dialog} aria-labelledby="exhibition-overview-title" onCancel={e => { e.preventDefault(); onClose(); }}>
    <header><button autoFocus className="viewer-guide-close artwork-detail-close" aria-label="전시로 돌아가기" title="전시로 돌아가기" onClick={onClose}><ViewerIcon name="close"/></button></header>
    <div className="artwork-detail-body"><div className="artwork-detail-content">
    <h2 id="exhibition-overview-title">{room?"공간 안내":mode === "opening" ? "전시 소개" : "전시 크레딧"}</h2>
    <h3>{room?room.name:publication.exhibition.title}</h3>
    {room?<>{roomIntroduction&&<p className="detail-text">{roomIntroduction}</p>}<p>작품 목록에서 이 공간의 작품 설명과 권리 정보를 읽을 수 있어요.</p></>:mode === "opening" ? <>{entranceFor(publication.exhibition).introduction && <p className="detail-text">{entranceFor(publication.exhibition).introduction}</p>}{textMode && <p>현재 텍스트로 관람하고 있어요. 작품 목록에서 설명과 대본을 읽을 수 있어요. 공간을 보려면 소개를 닫고 입장하기를 선택하세요.</p>}<h3>관람 방법</h3><p>걷기를 선택한 뒤 방향키 또는 W/A/S/D로 이동합니다. 마우스 시점 잡기를 선택한 뒤 마우스로 둘러보고, Esc로 정지합니다. 상세 보기와 전시 소개를 열면 보행을 잠시 정지하고 기존 시점을 유지합니다.</p>
      <p>목록의 작품 상세 보기로 설명·실제 치수·권리·이력을 확인할 수 있습니다. 소리 없이도 모든 설명을 읽을 수 있습니다. 자동 상세 보기는 기본적으로 꺼져 있습니다.</p></> : <>
      <p className="detail-text">{presentationFor(publication.exhibition).credits || "별도 전시 크레딧이 등록되지 않았습니다."}</p>
      <ul>{publication.exhibition.artworks.map(a => <li key={a.revisionId}>{a.metadata.title} · {a.metadata.artist} · {a.rights.creditLine}</li>)}</ul>
      <p>공개 revision {publication.publication.revisionSha256}</p></>}
    </div></div>
  </dialog>;
}
