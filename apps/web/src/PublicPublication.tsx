import {plaqueContent} from './plaque-content';
import { ViewerMark } from "./branding/ViewerMark";
import { ExhibitOSWordmark } from "./branding/ExhibitOSWordmark";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { entranceFor, entryPresentationFor, plaquesFor, benchesFor, materialFor, presentationFor, formatArtworkDimensions, viewingPlanFor, artworkThumbnailFor } from "@exhibitos/studio-contract";
import { useMediaPreference } from "./publication-accessibility";
import { ViewerBoundary } from "./ViewerBoundary";
const Viewer = lazy(() => import("./Viewer").then(module => ({ default: module.Viewer })));
import { GuidedRoutes, type GuideRequest } from "./GuidedRoutes";
import type { AudioApi, VoicePlayback } from "./viewer/audio";
import { ArtworkDetail } from "./ArtworkDetail";
import type { SurfaceAppearance, DetailEntryActions } from "./GeometryPreview";
import type {SharedDetailPreview} from './viewer/borrowed-detail-preview';
import type { PublicPublication as PublicResponse } from "./publication-client";
import { validateDraft } from "./drafts/validator";
import { newDraft } from "./drafts/example";
import { EntranceCover, coverAspectRatio } from './EntranceCover';
import { EntranceReadingShell } from './EntranceReadingShell';
import {useEntranceEntry,EntranceEntryOverlay} from './entrance-entry';
import { EntryTicket } from './EntryTicket';
import {entranceRuntime,entranceContent} from './entrance-runtime';
import "./publication-novice.css";
import "./publication-immersive.css";
import {ViewingStyles} from './viewer/ViewingStyles';
import {createViewingSession,type ViewingRenderer,type ViewingState,type ViewingStyle,type ViewingActions,type ViewingItem} from './viewer/viewing-session';
import {createPublicThumbnailCache} from './viewer/public-thumbnail';
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emptyThumbnails:Readonly<Record<string,string>>=Object.freeze({});
export function PublicPublication({ id, initial, connectionStatus }: { id: string; initial?: PublicResponse; connectionStatus?:ReactNode }) {
  const [value, setValue] = useState<PublicResponse | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(Boolean(initial));
  const generation = useRef(0);
  const entry=useEntranceEntry(),{mode,modeRef,stageReady,entryAttempt,entryTiming,entryButton,entryTicketRect,onStageState}=entry;
  const [viewerUnavailable, setViewerUnavailable] = useState(false);
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
      const response=await fetch(`/api/v1/publications/${value.publication.id}`,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(10000)});
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
  const [controlsHost,setControlsHost]=useState<HTMLDivElement|null>(null);
  useLayoutEffect(()=>{
    if(mode!=='3d')return;
    const previous=[document.documentElement,document.body].map(element=>({element,overflow:element.style.overflow,overscrollBehavior:element.style.overscrollBehavior}));
    for(const {element}of previous){element.style.overflow='hidden';element.style.overscrollBehavior='none';}
    return()=>{for(const {element,overflow,overscrollBehavior}of previous){element.style.overflow=overflow;element.style.overscrollBehavior=overscrollBehavior;}};
  },[mode]);
  const entryStatus=useRef<HTMLParagraphElement>(null),menuRef=useRef(menuOpen);menuRef.current=menuOpen;
  useEffect(()=>{if(stageReady&&modeRef.current==="3d"&&!menuRef.current)document.querySelector<HTMLCanvasElement>('canvas[aria-label="전시 공간 3D 미리보기"]')?.focus({preventScroll:true});},[stageReady]);
  const [guideRequest,setGuideRequest]=useState<GuideRequest>();
  const [voicePlayback,setVoicePlayback]=useState<VoicePlayback|null>(null);
  const voiceSubscription=useRef<(()=>void)|null>(null);
  useEffect(()=>()=>{voiceSubscription.current?.();},[]);
  const [guidedIndex, setGuidedIndex] = useState<number | null>(null);
  const [reducedMotion, setReducedMotion] = useMediaPreference("(prefers-reduced-motion: reduce)");
  const [highContrast, setHighContrast] = useMediaPreference("(prefers-contrast: more)");
  const viewingHeading = useRef<HTMLHeadingElement>(null);
  const [viewingFocusRequest,setViewingFocusRequest]=useState(0);
  useEffect(()=>{if(viewingFocusRequest)viewingHeading.current?.focus();},[viewingFocusRequest]);
  const guideHeading = useRef<HTMLHeadingElement>(null);
  const modeChanged = useRef(false);
  useEffect(() => {
    if (!modeChanged.current) return;
    modeChanged.current = false;
    if (mode === "text") document.getElementById("publication-artworks")?.focus();
    else if (mode === "cover") entryButton.current?.focus();
  }, [mode]);
  useEffect(() => { if (guidedIndex !== null) guideHeading.current?.focus(); }, [guidedIndex]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(()=>{if(viewerUnavailable&&mode==="3d")document.querySelector<HTMLButtonElement>('[aria-label="3D 관람 오류"] button')?.focus({preventScroll:true});},[viewerUnavailable,mode]);
  const [proximityDetail, setProximityDetail] = useState(false);
  const [coverViewingStyle,setCoverViewingStyle]=useState<ViewingStyle>('free');
  const preferredViewingStyle=useRef<ViewingStyle>('free');
  const cancelMapTravel=useRef<(()=>void)|null>(null);
  const registerMapCancel=useCallback((cancel:(()=>void)|null)=>{cancelMapTravel.current=cancel;},[]);
  const viewingSession=useRef<ReturnType<typeof createViewingSession>|null>(null);
  const [viewingState,setViewingState]=useState<ViewingState>({style:'free',status:'idle',message:''});
  const [viewingReady,setViewingReady]=useState(false);
  useEffect(()=>{
    preferredViewingStyle.current='free';setCoverViewingStyle('free');setViewingState({style:'free',status:'idle',message:''});
    return()=>{viewingSession.current?.dispose();viewingSession.current=null;};
  },[value?.publication.id,value?.publication.revisionSha256]);
  const registerViewing=useCallback((renderer:ViewingRenderer|null)=>{
    viewingSession.current?.dispose();viewingSession.current=null;setViewingReady(!!renderer);
    if(!renderer||!value)return;
    const current=createViewingSession({stops:viewingPlanFor(value.exhibition).stops,prepare:(stop,signal)=>renderer.prepare(stop,signal),free:()=>renderer.free(),changed:state=>{if(viewingSession.current===current)setViewingState(state);}});
    viewingSession.current=current;setViewingState(current.state());
    if(preferredViewingStyle.current==='ordered'){cancelMapTravel.current?.();current.actions.setStyle('ordered');}
  },[value]);
  const chooseViewingStyle=(style:ViewingStyle)=>{preferredViewingStyle.current=style;setCoverViewingStyle(style);};
  const viewingActions:ViewingActions={setStyle(style){cancelMapTravel.current?.();chooseViewingStyle(style);viewingSession.current?.actions.setStyle(style);},step:direction=>{cancelMapTravel.current?.();viewingSession.current?.actions.step(direction);},select:placementId=>{cancelMapTravel.current?.();viewingSession.current?.actions.select(placementId);},cancel:()=>viewingSession.current?.actions.cancel()};
  const [guideDismissal,setGuideDismissal]=useState<{publicationId:string;revision:string;dismissed:boolean}|null>(null);
  const [overview, setOverview] = useState<"opening" | "credits" | {roomId:string} | null>(null);
  const detailEntry = useRef<DetailEntryActions | null>(null);
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
  const showTextArtworks=useCallback(()=>{entry.cancel('text');stopVoice();setSelectedId(null);setOverview(null);setMenuOpen(false);modeChanged.current=true;},[stopVoice,entry.cancel]);
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
        if (generation.current === current) setValue(initial);
        return;
      }
      const response = await fetch(`/api/v1/publications/${id}`, {
        credentials: "omit",
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw Error("PUBLICATION_UNAVAILABLE");
      const result = (await response.json()) as PublicResponse;
      const envelope = newDraft();
      envelope.exhibitionId = result.exhibition.id;
      envelope.candidate = result.exhibition;
      if (
        result.publication.id !== id ||
        result.publication.status !== "published" ||
        !/^[a-f0-9]{64}$/.test(result.publication.revisionSha256) ||
        !validateDraft(envelope).valid ||
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
      if (generation.current === current) setValue({publication:result.publication, exhibition:result.exhibition, assets:result.assets});
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
    if(plaque.source.kind==='artwork'){const source=plaque.source;setSelectedId(value.exhibition.placements.find(p=>p.id.toLowerCase()===source.placementId.toLowerCase())!.id);}
    else setOverview(plaque.source.kind==='exhibition'?"opening":{roomId:plaque.roomId});
  };
  const viewingPlan=value?viewingPlanFor(value.exhibition):{version:1 as const,stops:[]};
  const viewingPlacements=value?(viewingPlan.stops.length?viewingPlan.stops.map(stop=>value.exhibition.placements.find(p=>p.id.toLowerCase()===stop.placementId.toLowerCase())!).filter(Boolean):value.exhibition.placements):[];
  const viewingItems:ViewingItem[]=value?viewingPlacements.map(p=>({placementId:p.id,title:value.exhibition.artworks.find(a=>a.revisionId.toLowerCase()===p.artworkRevisionId.toLowerCase())?.metadata.title??'작품',roomName:value.exhibition.rooms.find(r=>r.id.toLowerCase()===p.roomId.toLowerCase())?.name??'전시 공간',thumbnail:thumbnails[p.artworkRevisionId.toLowerCase()]})):[];
  const plaqueLinks=value?plaquesFor(value.exhibition).filter(p=>p.visible):[];
  const entryPresentation=entryPresentationFor(value?.exhibition??{}),runtime=value?entranceRuntime(value.exhibition,reducedMotion,window.matchMedia('(max-width:700px)').matches):null,coverContent=value?entranceContent(value.exhibition,entranceLocale,window.matchMedia('(max-width:700px)').matches):null;
  return (
    <main className={`cms-shell publication-shell publication-mode-${mode}${highContrast ? " publication-high-contrast" : ""}`} data-reduced-motion={reducedMotion} data-entry-ready={stageReady} data-entry-generation={entryAttempt} data-entry-timing={entryTiming?JSON.stringify(entryTiming):undefined}>
      <nav className="publication-skip-links" aria-label="바로 가기">
        <a href="#publication-viewing" onClick={event => {event.preventDefault();setMenuOpen(true);setViewingFocusRequest(n=>n+1);}}>관람 설정으로 건너뛰기</a>
        <a href="#publication-artworks" onClick={showTextArtworks}>작품 목록으로 건너뛰기</a>
      </nav>
      {(loading||error)&&<EntranceReadingShell motion={!reducedMotion} exhibition={initial?.exhibition} title={initial?.exhibition.title??"전시"} artist={initial&&entranceFor(initial.exhibition).artist} introduction={initial&&entranceFor(initial.exhibition).introduction} hasImage={Boolean(!error&&initial&&entranceFor(initial.exhibition).imageAssetId)} folded={!reducedMotion&&entryPresentation.coverUnfold} ratio={initial?coverAspectRatio(initial):4/3} status={<p className={loading?'publication-entry-status-quiet':undefined} role={loading?'status':'alert'} data-testid="public-state">{loading?"전시 정보를 확인하고 있어요.":error}</p>}/>}
      {error && <button disabled={loading} onClick={() => void load()}>다시 시도</button>}
      {value && (
        <article>
          <div className="publication-cover-surface" style={entryTicketRect?{'--entry-ticket-left':`${entryTicketRect.left}px`,'--entry-ticket-top':`${entryTicketRect.top}px`,'--entry-ticket-width':`${entryTicketRect.width}px`,'--entry-ticket-height':`${entryTicketRect.height}px`} as CSSProperties:undefined} data-entering={mode==="3d"} aria-hidden={mode==="3d"} inert={mode==="3d"} hidden={mode==="3d"&&viewerUnavailable}>
          <EntranceCover key={value.publication.revisionSha256} publication={value} locale={entranceLocale} showImage={mode!=="text"&&!stageReady} interactive={mode==="cover"} motion={!reducedMotion}
            ticket={<EntryTicket title={coverContent!.title} variant={runtime!.variant} showDate={runtime!.design.ticket.showDate} showTime={runtime!.design.ticket.showTime} active={mode==="3d"} animate={runtime!.effects.response==='tear'} unavailable={viewerUnavailable} buttonRef={entryButton} onEnter={enter}/>}>

            <div className="publication-entry-actions">
              {mode==='cover'&&<ViewingStyles variant="cover" state={{style:coverViewingStyle,status:'idle',message:''}} items={viewingItems} available={viewingPlan.stops.length>0} actions={{...viewingActions,setStyle:chooseViewingStyle}}/>}
              {mode==="cover"&&<a href="#publication-artworks" onClick={showTextArtworks}>텍스트로 관람</a>}
            </div>
          </EntranceCover></div>
          {mode==="3d"&&!viewerUnavailable&&<EntranceEntryOverlay key={entryAttempt} entry={entry} transition={runtime!.effects.transition} speed={runtime!.effects.speed} statusRef={entryStatus} onCancel={cancelEntry} onText={showTextArtworks}/>}
          {mode === "text" && viewerUnavailable && <p>3D를 다시 요청하려면 페이지를 새로 열어야 해요. 글·목록 관람은 새로고침 없이 계속할 수 있어요.</p>}
          <details data-visitor-panel="" className="publication-menu" open={menuOpen} onToggle={event => setMenuOpen(event.currentTarget.open)}>
          <summary>{mode === "3d" ? "메뉴" : "전시 정보"}</summary>
          <div className="publication-menu-panel">
          {connectionStatus}
          {mode==='3d'&&<ViewingStyles state={viewingState} items={viewingItems} actions={viewingActions} available={viewingReady&&viewingPlan.stops.length>0}/>}
          {mode === "3d" && <button onClick={showTextArtworks}>텍스트로 관람</button>}
          <div ref={setControlsHost} inert={mode==="3d"&&!stageReady&&!viewerUnavailable} aria-hidden={mode==="3d"&&!stageReady&&!viewerUnavailable} />
          <GuidedRoutes key={value.publication.revisionSha256} exhibition={value.exhibition} onArtwork={id=>{detailEntry.current?.prepare();detailEntry.current?.commit(false);setSelectedId(id);}} onView={mode === "3d" && stageReady && !viewerUnavailable && !selectedId && !overview ? (routeId,index)=>{stopVoice();setMenuOpen(false);setGuideRequest({routeId,index,sequence:performance.now()});} : undefined} />
          <button onPointerDown={prepareDetailEntry} onClick={event => { detailEntry.current?.commit(event.detail > 0); setOverview("opening"); }}>전시 소개</button>
          <button onPointerDown={prepareDetailEntry} onClick={event => { detailEntry.current?.commit(event.detail > 0); setOverview("credits"); }}>전시 크레딧</button>
          {plaqueLinks.length>0&&<section aria-label="공간 명판"><h2>공간 안내</h2><ul>{plaqueLinks.map(plaque=><li key={plaque.id}><button onPointerDown={prepareDetailEntry} onClick={event=>{detailEntry.current?.commit(event.detail>0);requestPlaque(plaque.id);}}>{plaqueContent(value.exhibition,plaque).title} 안내 읽기</button></li>)}</ul></section>}
          <section aria-label="관람 방식과 접근성 설정">
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
          {mode === "text" && <button onClick={() => {setMenuOpen(false);modeChanged.current=true;entry.cancel();}}>전시 표지로</button>}
          <details className="publication-record">
            <summary>전시 공개 정보</summary>
            <p>공개일 {value.publication.publishedAt}</p>
            <p>전시 버전 <code>{value.publication.revisionSha256}</code></p>
            <button disabled={loading} onClick={() => void load()}>전시 파일 다시 확인</button>
          </details>
          </div></details>
          {mode === "3d" && <div className="publication-live-stage" data-stage-ready={stageReady} aria-hidden={!stageReady&&!viewerUnavailable} inert={!stageReady&&!viewerUnavailable}><ViewerBoundary key={entryAttempt} focusFallback={selectedId === null && overview === null} onUnavailable={() => setViewerUnavailable(true)} onReturn={showTextArtworks}>
            <Suspense fallback={null}>
            <Viewer onMapCancelReady={registerMapCancel} mapEnabled={viewingState.style==='free'&&viewingState.pendingStyle!=='ordered'} onMapAction={()=>viewingSession.current?.actions.cancel()} publication={value} artworkThumbnails={thumbnails} thumbnailCache={thumbnailCache} appearance={appearance} onArtworkSelect={id=>{viewingSession.current?.context(id);setSelectedId(id);}} onViewingRendererReady={registerViewing} onPlaqueSelect={requestPlaque}
              immersive controlsHost={controlsHost} onNavigationActive={()=>setMenuOpen(false)} onStageState={onStageState} focusedPlacementId={selectedId} suspendNavigation={selectedId !== null || overview !== null} proximityDetail={proximityDetail} onAudioReady={registerAudio} onDetailEntryReady={registerDetailEntry}
              guideDismissed={guideDismissal?.publicationId===value.publication.id&&guideDismissal.revision===value.publication.revisionSha256&&guideDismissal.dismissed}
              onGuideDismissedChange={dismissed=>setGuideDismissal({publicationId:value.publication.id,revision:value.publication.revisionSha256,dismissed})}
              reducedMotion={reducedMotion} onReducedMotionChange={setReducedMotion} guideRequest={guideRequest} />
            </Suspense>
          </ViewerBoundary></div>}
          {selectedId && <ArtworkDetail key={selectedId} publication={value} placementId={selectedId}
            onClose={() => {setSelectedId(null);if(mode === "3d" && stageReady && !viewerUnavailable)detailEntry.current?.resumeViewing?.();}} onVoicePlay={playVoice} onVoiceStop={stopVoice} renderPreview={mode === "3d" && !viewerUnavailable} voicePlayback={voicePlayback} sharedPreview={mode==='3d'?sharedDetailPreview:undefined} />}
          {overview && <ExhibitionOverview publication={value} mode={overview} textMode={mode === "text"} onClose={() => {setOverview(null);setMenuOpen(false);if(mode === "3d" && stageReady && !viewerUnavailable)detailEntry.current?.resumeViewing?.();}} />}
          <div hidden={mode !== "text"} className="publication-text-content">
          <section aria-label="작품 목록형 대체 보기">
            <h2 id="publication-artworks" tabIndex={-1}>작품 목록</h2>
            <p>아래 순서는 공개된 작품 목록의 순서입니다. 작가가 지정한 공간 이동 경로가 아닙니다.</p>
            {guidedIndex === null ? <button disabled={!value.exhibition.placements.length} onClick={() => setGuidedIndex(0)}>목록 순서로 안내 시작</button> : <div className="publication-guide" aria-label="목록 순서 안내">
              <h3 ref={guideHeading} tabIndex={-1}>목록 안내 · 작품 {guidedIndex + 1} / {value.exhibition.placements.length}</h3>
              <button disabled={guidedIndex === 0} onClick={() => setGuidedIndex(index => Math.max(0, (index ?? 0) - 1))}>이전 작품</button>
              <button disabled={guidedIndex === value.exhibition.placements.length - 1} onClick={() => setGuidedIndex(index => Math.min(value.exhibition.placements.length - 1, (index ?? 0) + 1))}>다음 작품</button>
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
                      {formatArtworkDimensions(a?.dimensions)}
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
            <summary>전시 공개 정보</summary>
            <p>공개일 {value.publication.publishedAt}</p>
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
        <a href="/THIRD_PARTY_NOTICES.txt">제3자 고지</a>
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
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const room=typeof mode==='object'?publication.exhibition.rooms.find(r=>r.id.toLowerCase()===mode.roomId.toLowerCase()):undefined;
  return <dialog className="artwork-detail" ref={dialog} aria-labelledby="exhibition-overview-title" onCancel={e => { e.preventDefault(); onClose(); }}>
    <header><h2 id="exhibition-overview-title">{room?"공간 안내":mode === "opening" ? "전시 소개" : "전시 크레딧"}</h2><button autoFocus onClick={onClose}>전시로 돌아가기</button></header>
    <h3>{room?room.name:publication.exhibition.title}</h3>
    {room?<p>작품 목록에서 이 공간의 작품 설명과 권리 정보를 읽을 수 있어요.</p>:mode === "opening" ? <>{entranceFor(publication.exhibition).introduction && <p className="detail-text">{entranceFor(publication.exhibition).introduction}</p>}{textMode && <p>현재 텍스트로 관람하고 있어요. 작품 목록에서 설명과 대본을 읽을 수 있어요. 공간을 보려면 소개를 닫고 입장하기를 선택하세요.</p>}<h3>관람 방법</h3><p>걷기를 선택한 뒤 방향키 또는 W/A/S/D로 이동합니다. 마우스 시점 잡기를 선택한 뒤 마우스로 둘러보고, Esc로 정지합니다. 상세 보기와 전시 소개를 열면 보행을 잠시 정지하고 기존 시점을 유지합니다.</p>
      <p>목록의 작품 상세 보기로 설명·실제 치수·권리·이력을 확인할 수 있습니다. 소리 없이도 모든 설명을 읽을 수 있습니다. 자동 상세 보기는 기본적으로 꺼져 있습니다.</p></> : <>
      <p className="detail-text">{presentationFor(publication.exhibition).credits || "별도 전시 크레딧이 등록되지 않았습니다."}</p>
      <ul>{publication.exhibition.artworks.map(a => <li key={a.revisionId}>{a.metadata.title} · {a.metadata.artist} · {a.rights.creditLine}</li>)}</ul>
      <p>공개 revision {publication.publication.revisionSha256}</p></>}
  </dialog>;
}
