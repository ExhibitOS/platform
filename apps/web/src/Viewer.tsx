import { spatialProgramFor, spatialScopeFor, experienceFor } from "@exhibitos/studio-contract";
import { ScriptSession, type ScriptScene, type ScriptState } from "./viewer/scripting";
import { ScriptEdges } from "./viewer/scripting-events";
import { ScriptControls } from "./viewer/ScriptControls";
import { useEffect, useMemo, useRef, useState } from "react";
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
      <GeometryPreview
        document={publication.exhibition}
        selection={null}
        appearance={appearance}
        session={null}
        publicSource={source}
        viewerBudget={budget}
        suspendNavigation={suspendNavigation}
        onArtworkSelect={onArtworkSelect}
        proximityDetail={proximityDetail}
        onDetailEntryReady={onDetailEntryReady}
        guideRequest={guideRequest}
        onScriptSceneReady={scriptProgram.rules.length?scene=>{if(!scene)script.current?.stop();scriptScene.current=scene;}:undefined}
        onScriptPose={scriptProgram.rules.length?(position,forward)=>{scriptPose.current={position,forward};}:undefined}
        onScriptClick={scriptProgram.rules.length?id=>script.current?.event({type:'artwork_click',placementId:id},performance.now(),Date.now()):undefined}
        reducedMotion={reducedMotion}
        onReducedMotionChange={onReducedMotionChange}
        onNavigationState={state => audio.current?.update(state)}
        onCameraPose={(position,yaw)=>audio.current?.updatePose(position,yaw)}
        onNavigationMode={(walking,paused)=>{if(paused&&movement.current)script.current?.stop();movement.current=walking && !paused;audio.current?.lifecycle(movement.current,suspendNavigation);}}
      />
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
