import { ViewerAnalytics } from './viewer/analytics';
import { request, RequestError, type Session } from './cms-client';
import {ViewerXr,type XrState} from './viewer/xr';
import {XrControls} from './viewer/XrControls';
import type {GeometryXrBridge,GeometryXrArtwork} from './GeometryPreview';
import { OpeningSession, type OpeningState } from "./viewer/opening";
import { OpeningControls } from "./viewer/OpeningControls";
import { presentationFor } from "@exhibitos/studio-contract";
import { ExhibitionPresence, advancePresenceFrame, type RealtimeState } from "./viewer/realtime";
import { RealtimeControls } from "./viewer/RealtimeControls";
import type { RealtimeScene } from "./GeometryPreview";
import { spatialProgramFor, spatialScopeFor, experienceFor } from "@exhibitos/studio-contract";
import { ScriptSession, type ScriptScene, type ScriptState } from "./viewer/scripting";
import { ScriptEdges } from "./viewer/scripting-events";
import { ScriptControls } from "./viewer/ScriptControls";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GuideRequest } from "./GuidedRoutes";
import { GeometryPreview } from "./GeometryPreview";
import type { SurfaceAppearance, DetailEntryActions } from "./GeometryPreview";
import type { PublicPublication } from "./publication-client";
import { ExhibitionAudio, type AudioApi, type AudioState } from "./viewer/audio";
import { AudioControls } from "./viewer/AudioControls";
import { DEVICE_BUDGETS, deviceBudget } from "./viewer/loading";
export function Viewer({
  publication,
  appearance,
  suspendNavigation = false,
  onArtworkSelect,
  proximityDetail = false,
  onAudioReady,
  onDetailEntryReady,
  reducedMotion,
  onReducedMotionChange,
  guideRequest,
}: {
  publication: PublicPublication;
  appearance: (id: string) => SurfaceAppearance;
  suspendNavigation?: boolean;
  onArtworkSelect?: (id: string) => void;
  proximityDetail?: boolean;
  onAudioReady?: (api: AudioApi | null) => void;
  onDetailEntryReady?: (actions: DetailEntryActions | null) => void;
  reducedMotion?: boolean;
  guideRequest?: GuideRequest;
  onReducedMotionChange?: (value: boolean) => void;
}) {
  const analytics = useRef<ViewerAnalytics | null>(null);
  const [analyticsConsent, setAnalyticsConsent] = useState(false);
  const analyticsConsentRef = useRef(false);
  useEffect(() => {
    let sessionPromise: Promise<Session | null> | undefined;
    const runtime = new ViewerAnalytics({
      publicationId: publication.publication.id,
      local: !!publication.local,
      post: async payload => {
        sessionPromise ??= request<Session>('/api/v1/auth/session', null).catch(error => {
          if (error instanceof RequestError && error.status === 401) return null;
          throw error;
        });
        const session = await sessionPromise;
        // Recheck consent after resolving credentials; withdrawal cancels queued sends.
        if (!analyticsConsentRef.current || analytics.current !== runtime) return;
        await request('/api/v1/publications/' + publication.publication.id + '/analytics', session, 'POST', payload);
      },
    });
    analytics.current = runtime;
    runtime.visible(document.visibilityState === 'visible');
    runtime.setConsent(analyticsConsentRef.current);
    const visibility = () => {
      if (document.visibilityState !== 'visible') runtime.flush();
      runtime.visible(document.visibilityState === 'visible');
    };
    const clearSession = () => { sessionPromise = undefined; };
    const storage = (event: StorageEvent) => { if (event.key === 'exhibitos-auth-change') clearSession(); };
    window.addEventListener('exhibitos-auth-changed', clearSession);
    window.addEventListener('storage', storage);
    const timer = setInterval(() => runtime.flush(), 60000);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      runtime.flush();
      runtime.setConsent(false);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('exhibitos-auth-changed', clearSession);
      window.removeEventListener('storage', storage);
      if (analytics.current === runtime) analytics.current = null;
    };
  }, [publication]);
  useEffect(() => { if (!suspendNavigation) analytics.current?.artwork(null); }, [suspendNavigation]);
  const xr=useRef<ViewerXr|null>(null),xrBridge=useRef<GeometryXrBridge|null>(null);
  const xrSelection=useRef('');
  const xrExportCheck=useRef<(()=>Promise<boolean>)|null>(null);
  const [xrState,setXrState]=useState<XrState|null>(null),[xrArtworks,setXrArtworks]=useState<GeometryXrArtwork[]>([]),[xrSelected,setXrSelected]=useState('');
  const publicationRef=useRef(publication);publicationRef.current=publication;
  const xrDisplay=useCallback(async()=>{const p=publicationRef.current;try{if(p.local){await p.local.check();return true;}const response=await fetch(`/api/v1/publications/${encodeURIComponent(p.publication.id)}`,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(10000)});if(!response.ok)return false;const value=await response.json();return value.publication?.id===p.publication.id&&value.publication?.status==='published'&&value.publication?.revisionSha256===p.publication.revisionSha256;}catch{return false;}},[]);
  const xrReady=useCallback((bridge:GeometryXrBridge|null)=>{xr.current?.dispose();xr.current=null;xrBridge.current=bridge;xrExportCheck.current=null;setXrState(null);if(!bridge)return;
    const binding={...bridge,artwork:()=>{const selected=bridge.artworks().find(a=>a.revisionId===xrSelection.current);return selected?{object:selected.object,label:selected.label}:null;},authorizeDisplay:xrDisplay,authorizeExport:async()=>{const p=publicationRef.current,a=bridge.artworks().find(a=>a.revisionId===xrSelection.current);if(p.local||!a||!await xrDisplay())return false;try{const response=await fetch(`/api/v1/publications/${encodeURIComponent(p.publication.id)}/xr-export/${encodeURIComponent(a.assetId)}`,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(10000)});if(!response.ok)return false;const value=await response.json();return Object.keys(value).sort().join(',')==='assetId,authorized,publicationId,revisionSha256'&&value.authorized===true&&value.publicationId===p.publication.id&&value.assetId===a.assetId&&value.revisionSha256===p.publication.revisionSha256&&publicationRef.current===p&&bridge.artworks().find(x=>x.revisionId===xrSelection.current)?.object===a.object;}catch{return false;}},changed:setXrState};xrExportCheck.current=binding.authorizeExport;const runtime=new ViewerXr(binding);xr.current=runtime;setXrState(runtime.snapshot());void runtime.check();},[xrDisplay]);
  const xrLoaded=useCallback((items:GeometryXrArtwork[])=>{const old=xrBridge.current?.artworks().find(a=>a.revisionId===xrSelection.current);const selected=items.find(a=>a.revisionId===xrSelection.current);if(xrSelection.current&&(!selected||!old||old.object!==selected.object)){void xr.current?.stop();xrSelection.current='';setXrSelected('');}setXrArtworks(items);},[]);
  useEffect(()=>{return()=>{xr.current?.dispose();xr.current=null;};},[publication]);
  useEffect(()=>{if(xrState?.phase!=='active'&&!xrState?.quickLookURL)return;const runtime=xr.current,checkExport=xrExportCheck.current;let checking=false;const timer=setInterval(()=>{if(checking)return;checking=true;void (async()=>{const displayed=await xrDisplay(),exported=!xrState?.quickLookURL||!!checkExport&&await checkExport();if((!displayed||!exported)&&xr.current===runtime)void runtime?.stop();})().finally(()=>{checking=false;});},3000);return()=>clearInterval(timer);},[xrState?.phase,xrState?.quickLookURL,xrDisplay]);
  const audio = useRef<ExhibitionAudio | null>(null);
  const [audioState, setAudioState] = useState<AudioState | null>(null);
  const audioReady = useRef(onAudioReady);
  audioReady.current = onAudioReady;
  const movement = useRef(false);
  useEffect(() => {
    const runtime = new ExhibitionAudio(publication, setAudioState);
    audio.current = runtime;
    setAudioState(runtime.snapshot());
    audioReady.current?.(runtime);
    const visible = () => runtime.visibility(document.visibilityState === "visible");
    const blur = () => runtime.visibility(false);
    const escape = (event: KeyboardEvent) => {if(event.key === "Escape")runtime.lifecycle(false);};
    document.addEventListener("visibilitychange",visible);
    window.addEventListener("blur",blur);
    window.addEventListener("focus",visible);
    window.addEventListener("keydown",escape);
    return () => { document.removeEventListener("visibilitychange",visible); window.removeEventListener("blur",blur); window.removeEventListener("focus",visible); window.removeEventListener("keydown",escape); runtime.dispose(); audio.current = null; audioReady.current?.(null); };
  }, [publication]);
  useEffect(() => { audio.current?.lifecycle(!suspendNavigation && movement.current,suspendNavigation); }, [suspendNavigation]);
  const scriptProgram=useMemo(()=>spatialProgramFor(publication.exhibition),[publication]);
  const script=useRef<ScriptSession|null>(null),scriptScene=useRef<ScriptScene|null>(null),scriptEdges=useRef<ScriptEdges|null>(null);
  const scriptPose=useRef<{position:[number,number,number];forward:[number,number,number]}|null>(null);
  const [scriptState,setScriptState]=useState<ScriptState|null>(null),[scriptConsent,setScriptConsent]=useState(false);
  const consent=useRef(false);consent.current=scriptConsent;
  const scriptSuspended=useRef(suspendNavigation);scriptSuspended.current=suspendNavigation;
  useEffect(()=>{if(!scriptProgram.rules.length)return;
    const runtime=new ScriptSession(scriptProgram,spatialScopeFor(publication.exhibition),{scene:()=>scriptScene.current,audioAllowed:(id)=>((!id)||publication.exhibition.audioZones.some(z=>z.assetId===id&&z.transcript.trim().length>0)||experienceFor(publication.exhibition).voices.some(v=>v.assetId===id&&v.transcript.trim().length>0))&&consent.current&&!scriptSuspended.current&&document.visibilityState==='visible'&&!!audio.current?.snapshot().enabled&&!audio.current?.snapshot().muted,
      check:async(signal)=>{if(!audio.current)throw Error('VIEWER_UNAVAILABLE');await audio.current.checkScriptAvailability(signal);},playAudio:async(id,volume,allowed)=>{if(!audio.current)throw Error('AUDIO_MISSING');await audio.current.playScriptAudio(id,volume,allowed);},stopAudio:id=>audio.current?.stopScriptAudio(id),changed:setScriptState});
    script.current=runtime;setScriptState(runtime.snapshot());
    const stop=()=>runtime.stop(),visibility=()=>{if(document.visibilityState!=='visible')stop();},escape=(e:KeyboardEvent)=>{if(e.key==='Escape')stop();};
    window.addEventListener('blur',stop);document.addEventListener('visibilitychange',visibility);window.addEventListener('keydown',escape);
    const timer=setInterval(()=>{if(scriptSuspended.current||document.visibilityState!=='visible')return;const now=performance.now(),utc=Date.now();if(runtime.snapshot().enabled&&scriptPose.current){for(const event of scriptEdges.current?.update(scriptPose.current.position,scriptPose.current.forward,now)??[])runtime.event(event,now,utc);}runtime.advance(now,utc);},100);
    return()=>{clearInterval(timer);window.removeEventListener('blur',stop);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('keydown',escape);runtime.stop();script.current=null;};
  },[publication,scriptProgram]);
  useEffect(()=>{if(suspendNavigation)script.current?.stop();},[suspendNavigation]);
  const startScript=()=>{if(suspendNavigation||document.visibilityState!=='visible'||!scriptScene.current)return;scriptEdges.current=new ScriptEdges(publication.exhibition);void script.current?.start(performance.now(),Date.now());};
  const presence=useRef<ExhibitionPresence|null>(null),presenceScene=useRef<RealtimeScene|null>(null),presencePose=useRef<{roomId:string;position:[number,number,number];yaw:number}|null>(null);
  const [presenceState,setPresenceState]=useState<RealtimeState|null>(null);
  const presenceReduced=useRef(reducedMotion??matchMedia("(prefers-reduced-motion: reduce)").matches);if(reducedMotion!==undefined)presenceReduced.current=reducedMotion;
  const presenceSuspended=useRef(suspendNavigation);presenceSuspended.current=suspendNavigation;
  useEffect(()=>{if(publication.local)return;
    const runtime=new ExhibitionPresence({publicationId:publication.publication.id,revisionSha256:publication.publication.revisionSha256,roomIds:new Set(publication.exhibition.rooms.map(r=>r.id)),origin:location.origin,check:async(signal)=>{if(!audio.current)throw Error('VIEWER_UNAVAILABLE');await audio.current.checkScriptAvailability(signal);},changed:state=>{setPresenceState(state);if(state.status!=='joined')presenceScene.current?.clear();}});
    presence.current=runtime;setPresenceState(runtime.snapshot());
    const leave=()=>{runtime.leave();presenceScene.current?.clear();},visibility=()=>{if(document.visibilityState!=='visible')leave();};
    document.addEventListener('visibilitychange',visibility);
    const timer=setInterval(()=>{if(presenceSuspended.current||document.visibilityState!=='visible')return;advancePresenceFrame(runtime,presenceScene.current,presencePose.current,presenceReduced.current);},50);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visibility);runtime.dispose();presenceScene.current?.clear();presence.current=null;};
  },[publication]);
  useEffect(()=>{if(suspendNavigation){presence.current?.leave();presenceScene.current?.clear();}},[suspendNavigation]);
  const capturePresencePose=(position:[number,number,number],yaw:number)=>{const room=publication.exhibition.rooms.find(r=>{const p=position.map((v,i)=>v-r.transform.position[i]!),[x,y,z,w]=r.transform.rotation,tx=2*(-y*p[2]!+z*p[1]!),ty=2*(-z*p[0]!+x*p[2]!),tz=2*(-x*p[1]!+y*p[0]!),a=p[0]!+w*tx-y*tz+z*ty,b=p[1]!+w*ty-z*tx+x*tz,c=p[2]!+w*tz-x*ty+y*tx;return Math.abs(a)<=r.dimensions.width/2&&Math.abs(c)<=r.dimensions.depth/2&&b>=0&&b<=r.dimensions.height;});presencePose.current=room?{roomId:room.id,position:[...position],yaw}:null;if(room)analytics.current?.room(room.id);};
  const opening=useRef<OpeningSession|null>(null),openingAudio=useRef<HTMLDivElement|null>(null);
  const [openingState,setOpeningState]=useState<OpeningState|null>(null),[openingView,setOpeningView]=useState<{viewpointId:string;sequence:number}|undefined>(undefined);
  const openingSequence=useRef(0);
  useEffect(()=>{if(publication.local)return;const runtime=new OpeningSession({publicationId:publication.publication.id,revisionSha256:publication.publication.revisionSha256,viewpointIds:new Set(presentationFor(publication.exhibition).viewpoints.map(v=>v.id)),origin:location.origin,check:async(signal)=>{if(!audio.current)throw Error('VIEWER_UNAVAILABLE');await audio.current.checkScriptAvailability(signal);},changed:setOpeningState,attachAudio:element=>openingAudio.current?.append(element),viewpoint:id=>{if(!presenceSuspended.current&&document.visibilityState==='visible')setOpeningView({viewpointId:id,sequence:++openingSequence.current});}});opening.current=runtime;setOpeningState(runtime.snapshot());const hidden=()=>{if(document.visibilityState!=='visible')runtime.leave();};document.addEventListener('visibilitychange',hidden);const timer=setInterval(()=>runtime.measureVoice(),1000);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',hidden);runtime.dispose();opening.current=null;};},[publication]);
  useEffect(()=>{if(suspendNavigation){opening.current?.leave();setOpeningView(undefined);}},[suspendNavigation]);
  const [profile, setProfile] = useState<"auto" | "compact" | "desktop">(
    "auto",
  );
  const budget = useMemo(
    () =>
      profile === "auto"
        ? deviceBudget({
            viewportWidth: innerWidth,
            deviceMemory: (navigator as Navigator & { deviceMemory?: number })
              .deviceMemory,
            pixelRatio: devicePixelRatio,
          })
        : DEVICE_BUDGETS[profile],
    [profile],
  );
  const source = useMemo(
    () => ({
      publicationId: publication.publication.id,
      revisionSha256: publication.publication.revisionSha256,
      assets: publication.assets,
      ...publication.local,
    }),
    [publication],
  );
  return (
    <section aria-label="전시 Viewer">
      {!publication.local && <fieldset>
        <legend>관람 연구 통계</legend>
        <label><input type="checkbox" checked={analyticsConsent} onChange={event => {
          analyticsConsentRef.current = event.target.checked;
          setAnalyticsConsent(event.target.checked);
          analytics.current?.setConsent(event.target.checked);
        }} />이 관람의 집계에 동의합니다</label>
        <p>방문·관람 세션·방 입장·화면에 보인 전시 및 작품 시간·완료 횟수만 집계합니다. 이동 경로나 개인 식별자는 저장하지 않습니다. 로그인한 경우 계정의 통계 동의도 필요합니다. 동의를 끄면 전송을 중단합니다.</p>
        <button disabled={!analyticsConsent} onClick={() => { analytics.current?.flush(); analytics.current?.complete(); }}>관람 완료 기록</button>
      </fieldset>}
      <p>내보내기 허락이 바뀌면 이 페이지의 AR 링크를 닫습니다. 이미 기기에 열린 파일이나 내려받은 사본은 회수할 수 없습니다.</p>
      <label>
        Viewer 품질
        <select
          aria-label="Viewer 품질"
          value={profile}
          onChange={(e) => setProfile(e.target.value as typeof profile)}
        >
          <option value="auto">기기 예산 자동 선택</option>
          <option value="compact">절약 · 낮은 해상도</option>
          <option value="desktop">균형 · 높은 해상도</option>
        </select>
      </label>
      <label>AR 작품 선택 · 로딩이 완료된 승인 작품만<select aria-label="실제 크기 AR 작품 선택" value={xrSelected} onChange={e=>{void xr.current?.stop();xrSelection.current=e.target.value;setXrSelected(e.target.value);}}><option value="">작품을 직접 선택하세요</option>{xrArtworks.map(a=><option key={a.revisionId} value={a.revisionId}>{a.label}</option>)}</select></label>
      {publication.local&&<p>오프라인 저장본의 현재 내보내기 허락을 확인할 수 없어 USDZ 내보내기는 사용할 수 없습니다.</p>}
      <XrControls runtime={xr.current} state={xrState} reducedMotion={reducedMotion??presenceReduced.current} disabled={suspendNavigation}/>
      <GeometryPreview
        onXrReady={xrReady}
        onXrArtworks={xrLoaded}
        document={publication.exhibition}
        selection={null}
        appearance={appearance}
        session={null}
        publicSource={source}
        viewerBudget={budget}
        suspendNavigation={suspendNavigation}
        onArtworkSelect={id => {
          const placement = publication.exhibition.placements.find(value => value.id === id);
          const artwork = publication.exhibition.artworks.find(value => value.revisionId === placement?.artworkRevisionId);
          analytics.current?.artwork(artwork?.id ?? null);
          onArtworkSelect?.(id);
        }}
        proximityDetail={proximityDetail}
        onDetailEntryReady={onDetailEntryReady}
        guideRequest={guideRequest}
        openingViewpoint={openingView}
        onPresencePose={publication.local?undefined:capturePresencePose}
        onPresenceSceneReady={publication.local?undefined:scene=>{presenceScene.current=scene;}}
        onScriptSceneReady={scriptProgram.rules.length?scene=>{if(!scene)script.current?.stop();scriptScene.current=scene;}:undefined}
        onScriptPose={scriptProgram.rules.length?(position,forward)=>{scriptPose.current={position,forward};}:undefined}
        onScriptClick={scriptProgram.rules.length?id=>script.current?.event({type:'artwork_click',placementId:id},performance.now(),Date.now()):undefined}
        reducedMotion={reducedMotion}
        onReducedMotionChange={value=>{presenceReduced.current=value;onReducedMotionChange?.(value);}}
        onNavigationState={state => audio.current?.update(state)}
        onCameraPose={(position,yaw)=>audio.current?.updatePose(position,yaw)}
        onNavigationMode={(walking,paused)=>{if(paused&&movement.current)script.current?.stop();movement.current=walking && !paused;audio.current?.lifecycle(movement.current,suspendNavigation);}}
      />
      <OpeningControls session={opening.current} state={openingState} offline={!!publication.local} viewpoints={presentationFor(publication.exhibition).viewpoints} audioReady={node=>{openingAudio.current=node;}}/>
      <RealtimeControls state={presenceState} offline={!!publication.local} join={()=>{if(!suspendNavigation&&document.visibilityState==='visible')presence.current?.join();}} retry={()=>{if(!suspendNavigation&&document.visibilityState==='visible')presence.current?.retry();}} leave={()=>{presence.current?.leave();presenceScene.current?.clear();}}/>
      <AudioControls audio={audio.current} state={audioState} zones={publication.exhibition.audioZones} />
      {scriptProgram.rules.length>0&&<ScriptControls program={scriptProgram} state={scriptState} start={startScript} stop={()=>script.current?.stop()} consent={scriptConsent} setConsent={value=>{consent.current=value;setScriptConsent(value);if(!value)audio.current?.stopScriptAudio();}} transcripts={[...publication.exhibition.audioZones.map(z=>z.transcript),...experienceFor(publication.exhibition).voices.map(v=>v.transcript)]} event={event=>script.current?.event(event,performance.now(),Date.now())}/>}
      <p className="cms-note">
        입구에 가까운 작품부터 불러옵니다. 다음 묶음과 상세 품질은 직접 요청할
        수 있습니다. 기기 품질은 texture·3D geometry·화면 해상도 예산을 함께
        조정합니다. 목록 보기는 그래픽 없이 사용할 수 있습니다.
      </p>
    </section>
  );
}
