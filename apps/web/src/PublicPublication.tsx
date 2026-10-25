import { ViewerMark } from "./branding/ViewerMark";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { entranceFor, entryPresentationFor, materialFor, presentationFor } from "@exhibitos/studio-contract";
import { useMediaPreference } from "./publication-accessibility";
import { ViewerBoundary } from "./ViewerBoundary";
const Viewer = lazy(() => import("./Viewer").then(module => ({ default: module.Viewer })));
import { GuidedRoutes, type GuideRequest } from "./GuidedRoutes";
import type { AudioApi, VoicePlayback } from "./viewer/audio";
import { ArtworkDetail } from "./ArtworkDetail";
import type { SurfaceAppearance, DetailEntryActions } from "./GeometryPreview";
import type { PublicPublication as PublicResponse } from "./publication-client";
import { validateDraft } from "./drafts/validator";
import { newDraft } from "./drafts/example";
import { EntranceCover, coverAspectRatio } from './EntranceCover';
import { EntranceReadingShell } from './EntranceReadingShell';
import { EntryTicket } from './EntryTicket';
import "./publication-novice.css";
import "./publication-immersive.css";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function PublicPublication({ id, initial }: { id: string; initial?: PublicResponse }) {
  const [value, setValue] = useState<PublicResponse | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const [mode, setMode] = useState<"cover" | "text" | "3d">("cover");
  const [viewerUnavailable, setViewerUnavailable] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [controlsHost,setControlsHost]=useState<HTMLDivElement|null>(null);
  const [stageReady, setStageReady] = useState(false);
  const [stageMessage,setStageMessage]=useState("공간을 준비하고 있어요.");
  const [entryAttempt,setEntryAttempt]=useState(0),[entryFailed,setEntryFailed]=useState(false),[longEntry,setLongEntry]=useState(false);
  const entryGeneration=useRef(0),entryStatus=useRef<HTMLParagraphElement>(null);
  const [entryTiming,setEntryTiming]=useState<{pressedAt:number;usableAt?:number}|null>(null);
  const modeRef=useRef(mode),menuRef=useRef(menuOpen);modeRef.current=mode;menuRef.current=menuOpen;
  const onStageState=useCallback((state:{ready:boolean;message:string;error?:boolean})=>{if(modeRef.current!=="3d"||entryAttempt!==entryGeneration.current)return;setStageMessage(state.message);if(state.error)setEntryFailed(true);if(state.ready){setEntryFailed(false);setStageReady(true);setEntryTiming(value=>value&&value.usableAt===undefined?{...value,usableAt:performance.now()}:value);}},[entryAttempt]);
  useEffect(()=>{if(mode!=="3d"||stageReady||entryFailed)return;entryStatus.current?.focus({preventScroll:true});const timer=setTimeout(()=>setLongEntry(true),8000);return()=>clearTimeout(timer);},[mode,stageReady,entryFailed,entryAttempt]);
  useEffect(()=>{if(stageReady&&modeRef.current==="3d"&&!menuRef.current)document.querySelector<HTMLCanvasElement>('canvas[aria-label="전시 공간 3D 미리보기"]')?.focus({preventScroll:true});},[stageReady]);
  const [guideRequest,setGuideRequest]=useState<GuideRequest>();
  const [voicePlayback,setVoicePlayback]=useState<VoicePlayback|null>(null);
  const voiceSubscription=useRef<(()=>void)|null>(null);
  useEffect(()=>()=>{voiceSubscription.current?.();},[]);
  const [guidedIndex, setGuidedIndex] = useState<number | null>(null);
  const [reducedMotion, setReducedMotion] = useMediaPreference("(prefers-reduced-motion: reduce)");
  const [highContrast, setHighContrast] = useMediaPreference("(prefers-contrast: more)");
  const entryButton = useRef<HTMLButtonElement>(null);
  const [entryTicketRect,setEntryTicketRect]=useState<{left:number;top:number;width:number}|null>(null);
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
  const [overview, setOverview] = useState<"opening" | "credits" | null>(null);
  const detailEntry = useRef<DetailEntryActions | null>(null);
  const registerDetailEntry = useCallback((actions: DetailEntryActions | null) => { detailEntry.current = actions; }, []);
  const prepareDetailEntry = useCallback(() => { detailEntry.current?.prepare(); }, []);
  const audio = useRef<AudioApi | null>(null);
  const registerAudio = useCallback((api: typeof audio.current) => { audio.current = api; voiceSubscription.current?.();voiceSubscription.current=api?.subscribeVoice(setVoicePlayback)??null;if(!api)setVoicePlayback(null); }, []);
  const playVoice = useCallback(async (assetId: string) => {
    if (!audio.current) throw Error("AUDIO_UNAVAILABLE");
    await audio.current.playVoice(assetId);
  }, []);
  const stopVoice = useCallback(() => { audio.current?.stopVoice(); }, []);
  const showTextArtworks=useCallback(()=>{entryGeneration.current++;modeRef.current="text";stopVoice();setSelectedId(null);setOverview(null);setMenuOpen(false);setStageReady(false);modeChanged.current=true;setMode("text");},[stopVoice]);
  const cancelEntry=()=>{entryGeneration.current++;modeRef.current="cover";setStageReady(false);setEntryFailed(false);setLongEntry(false);setMenuOpen(false);modeChanged.current=true;setMode("cover");};
  const enter=()=>{
    if(modeRef.current==="3d")return;
    if(viewerUnavailable){window.location.reload();return;}
    const ticketBox=entryButton.current?.getBoundingClientRect();setEntryTicketRect(ticketBox?{left:ticketBox.left,top:ticketBox.top,width:ticketBox.width}:null);
    const current=++entryGeneration.current;modeRef.current="3d";setEntryAttempt(current);setEntryTiming({pressedAt:performance.now()});setMenuOpen(false);setStageReady(false);setEntryFailed(false);setLongEntry(false);setStageMessage("공간을 준비하고 있어요.");setMode("3d");
  };
  async function load() {
    const current = ++generation.current;
    entryGeneration.current++;modeRef.current="cover";
    setLoading(true);
    setMode("cover");
    setStageReady(false);
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
  const entryPresentation=entryPresentationFor(value?.exhibition??{});
  return (
    <main className={`cms-shell publication-shell publication-mode-${mode}${highContrast ? " publication-high-contrast" : ""}`} data-reduced-motion={reducedMotion} data-entry-ready={stageReady} data-entry-generation={entryAttempt} data-entry-timing={entryTiming?JSON.stringify(entryTiming):undefined}>
      <nav className="publication-skip-links" aria-label="바로 가기">
        <a href="#publication-viewing" onClick={event => {event.preventDefault();setMenuOpen(true);setViewingFocusRequest(n=>n+1);}}>관람 설정으로 건너뛰기</a>
        <a href="#publication-artworks" onClick={showTextArtworks}>작품 목록으로 건너뛰기</a>
      </nav>
      {(loading||error)&&<EntranceReadingShell title={initial?.exhibition.title??"전시"} artist={initial&&entranceFor(initial.exhibition).artist} introduction={initial&&entranceFor(initial.exhibition).introduction} hasImage={Boolean(!error&&initial&&entranceFor(initial.exhibition).imageAssetId)} folded={!reducedMotion&&entryPresentation.coverUnfold} ratio={initial?coverAspectRatio(initial):4/3} status={<p className={loading?'publication-entry-status-quiet':undefined} role={loading?'status':'alert'} data-testid="public-state">{loading?"전시 정보를 확인하고 있어요.":error}</p>}/>}
      {error && <button disabled={loading} onClick={() => void load()}>다시 시도</button>}
      {value && (
        <article>
          <div className="publication-cover-surface" style={entryTicketRect?{'--entry-ticket-left':`${entryTicketRect.left}px`,'--entry-ticket-top':`${entryTicketRect.top}px`,'--entry-ticket-width':`${entryTicketRect.width}px`} as CSSProperties:undefined} data-entering={mode==="3d"} aria-hidden={mode==="3d"} inert={mode==="3d"} hidden={mode==="3d"&&(stageReady||viewerUnavailable)}>
          <EntranceCover key={value.publication.revisionSha256} publication={value} showImage={mode!=="text"&&!stageReady} interactive={mode==="cover"} motion={!reducedMotion}>
            <div className="publication-entry-actions">
              <EntryTicket title={entryPresentation.ticketTitle||value.exhibition.title} detail={entryPresentation.ticketDetail||entranceFor(value.exhibition).artist} active={mode==="3d"} animate={entryPresentation.ticketAnimation&&!reducedMotion} unavailable={viewerUnavailable} buttonRef={entryButton} onEnter={enter}/>
              {mode==="cover"&&<a href="#publication-artworks" onClick={showTextArtworks}>텍스트로 관람</a>}
            </div>
          </EntranceCover></div>
          {mode==="3d"&&!viewerUnavailable&&<div className="publication-entry-overlay" key={entryAttempt} data-ready={stageReady} data-door-effect={entryPresentation.doorEffect&&!reducedMotion} data-failed={entryFailed}>
            <div className="publication-entry-door" aria-hidden="true"><span className="publication-entry-door-left"/><span className="publication-entry-door-right"/></div>
            {!stageReady&&<div className="publication-entry-recovery">
              <p className="publication-entry-progress" role={entryFailed?"alert":"status"} ref={entryStatus} tabIndex={-1}>{entryFailed?"공간을 열지 못했어요. 입장을 취소한 뒤 다시 시도하거나 글로 관람할 수 있어요.":longEntry?"공간 준비가 계속되고 있어요. 기다리거나 글로 관람할 수 있어요.":"전시장으로 들어가고 있어요."}</p>
              <div className="publication-entry-secondary"><button onClick={cancelEntry}>입장 취소</button><button onClick={showTextArtworks}>텍스트로 관람</button></div>
              <output hidden data-testid="entry-stage-diagnostics">{stageMessage}</output>
            </div>}
          </div>}
          {mode === "text" && viewerUnavailable && <p>3D를 다시 요청하려면 페이지를 새로 열어야 해요. 글·목록 관람은 새로고침 없이 계속할 수 있어요.</p>}
          <details data-visitor-panel="" className="publication-menu" open={menuOpen} onToggle={event => setMenuOpen(event.currentTarget.open)}>
          <summary>{mode === "3d" ? "메뉴" : "전시 정보"}</summary>
          <div className="publication-menu-panel">
          <div ref={setControlsHost} inert={mode==="3d"&&!stageReady&&!viewerUnavailable} aria-hidden={mode==="3d"&&!stageReady&&!viewerUnavailable} />
          <GuidedRoutes key={value.publication.revisionSha256} exhibition={value.exhibition} onArtwork={id=>{detailEntry.current?.prepare();detailEntry.current?.commit(false);setSelectedId(id);}} onView={mode === "3d" && stageReady && !viewerUnavailable && !selectedId && !overview ? (routeId,index)=>{stopVoice();setMenuOpen(false);setGuideRequest({routeId,index,sequence:performance.now()});} : undefined} />
          <button onPointerDown={prepareDetailEntry} onClick={event => { detailEntry.current?.commit(event.detail > 0); setOverview("opening"); }}>전시 소개</button>
          <button onPointerDown={prepareDetailEntry} onClick={event => { detailEntry.current?.commit(event.detail > 0); setOverview("credits"); }}>전시 크레딧</button>
          <section aria-label="관람 방식과 접근성 설정">
            <h2 id="publication-viewing" tabIndex={-1} ref={viewingHeading}>관람 방식과 접근성 설정</h2>
            <p>글·목록 관람에서는 3D 공간·작품 이미지·음성을 불러오지 않습니다. 설명, 대본, 치수와 권리를 읽을 수 있습니다.</p>
            <label><input type="checkbox" checked={reducedMotion} onChange={e => setReducedMotion(e.target.checked)} />움직임 줄이기</label>
            <label><input type="checkbox" checked={highContrast} onChange={e => setHighContrast(e.target.checked)} />높은 대비</label>
            <p>처음에는 기기의 움직임 줄이기·대비 설정을 따릅니다. 직접 선택하면 이 관람 동안 선택한 설정을 사용합니다.</p>
            {mode === "3d" && <>
              <button onClick={showTextArtworks}>텍스트로 관람</button>
              <label><input type="checkbox" checked={proximityDetail} onChange={e => setProximityDetail(e.target.checked)} />작품에 가까워지면 상세 보기 자동 열기 (기본 꺼짐)</label>
            </>}
          </section>
          {mode === "text" && <button onClick={() => {setMenuOpen(false);modeChanged.current=true;setMode("cover");}}>전시 표지로</button>}
          <details className="publication-record">
            <summary>전시 공개 정보</summary>
            <p>공개일 {value.publication.publishedAt}</p>
            <p>전시 버전 <code>{value.publication.revisionSha256}</code></p>
            <button disabled={loading} onClick={() => void load()}>전시 파일 다시 확인</button>
          </details>
          </div></details>
          {mode === "3d" && <button className="publication-text-route" onClick={showTextArtworks}>텍스트로 관람</button>}
          {mode === "3d" && <div className="publication-live-stage" data-stage-ready={stageReady} aria-hidden={!stageReady&&!viewerUnavailable} inert={!stageReady&&!viewerUnavailable}><ViewerBoundary key={entryAttempt} focusFallback={selectedId === null && overview === null} onUnavailable={() => setViewerUnavailable(true)} onReturn={showTextArtworks}>
            <Suspense fallback={null}>
            <Viewer publication={value} appearance={appearance} onArtworkSelect={setSelectedId}
              immersive controlsHost={controlsHost} onNavigationActive={()=>setMenuOpen(false)} onStageState={onStageState} focusedPlacementId={selectedId} suspendNavigation={selectedId !== null || overview !== null} proximityDetail={proximityDetail} onAudioReady={registerAudio} onDetailEntryReady={registerDetailEntry}
              reducedMotion={reducedMotion} onReducedMotionChange={setReducedMotion} guideRequest={guideRequest} />
            </Suspense>
          </ViewerBoundary></div>}
          {selectedId && <ArtworkDetail key={selectedId} publication={value} placementId={selectedId}
            onClose={() => setSelectedId(null)} onVoicePlay={playVoice} onVoiceStop={stopVoice} renderPreview={mode === "3d" && !viewerUnavailable} voicePlayback={voicePlayback} />}
          {overview && <ExhibitionOverview publication={value} mode={overview} textMode={mode === "text"} onClose={() => setOverview(null)} />}
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
                    <h3>{a?.metadata.title}</h3>
                    <button onPointerDown={prepareDetailEntry} onClick={event => { detailEntry.current?.commit(event.detail > 0); setSelectedId(p.id); }} aria-label={`${a?.metadata.title ?? "작품"} 상세 보기`}>작품 상세 보기</button>
                    <p>
                      {a?.metadata.artist} · {a?.rights.creditLine}
                    </p>
                    <p>{description?.text ?? a?.metadata.description}</p>
                    <p>
                      {a?.dimensions.width} × {a?.dimensions.height} m
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
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
        <span className="publication-brand"><ViewerMark />ExhibitOS</span>
        <a href="/THIRD_PARTY_NOTICES.txt">제3자 고지</a>
      </footer>
    </main>
  );
}

function ExhibitionOverview({ publication, mode, textMode, onClose }: {
  publication: PublicResponse; mode: "opening" | "credits"; textMode: boolean; onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement, element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog className="artwork-detail" ref={dialog} aria-labelledby="exhibition-overview-title" onCancel={e => { e.preventDefault(); onClose(); }}>
    <header><h2 id="exhibition-overview-title">{mode === "opening" ? "전시 소개" : "전시 크레딧"}</h2><button autoFocus onClick={onClose}>전시로 돌아가기</button></header>
    <h3>{publication.exhibition.title}</h3>
    {mode === "opening" ? <>{entranceFor(publication.exhibition).introduction && <p className="detail-text">{entranceFor(publication.exhibition).introduction}</p>}{textMode && <p>현재 텍스트로 관람하고 있어요. 작품 목록에서 설명과 대본을 읽을 수 있어요. 공간을 보려면 소개를 닫고 입장하기를 선택하세요.</p>}<h3>관람 방법</h3><p>걷기를 선택한 뒤 방향키 또는 W/A/S/D로 이동합니다. 마우스 시점 잡기를 선택한 뒤 마우스로 둘러보고, Esc로 정지합니다. 상세 보기와 전시 소개를 열면 보행을 잠시 정지하고 기존 시점을 유지합니다.</p>
      <p>목록의 작품 상세 보기로 설명·실제 치수·권리·이력을 확인할 수 있습니다. 소리 없이도 모든 설명을 읽을 수 있습니다. 자동 상세 보기는 기본적으로 꺼져 있습니다.</p></> : <>
      <p className="detail-text">{presentationFor(publication.exhibition).credits || "별도 전시 크레딧이 등록되지 않았습니다."}</p>
      <ul>{publication.exhibition.artworks.map(a => <li key={a.revisionId}>{a.metadata.title} · {a.metadata.artist} · {a.rights.creditLine}</li>)}</ul>
      <p>공개 revision {publication.publication.revisionSha256}</p></>}
  </dialog>;
}
