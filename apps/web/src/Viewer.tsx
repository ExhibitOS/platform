import { useEffect, useMemo, useRef, useState } from "react";
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
}: {
  publication: PublicPublication;
  appearance: (id: string) => SurfaceAppearance;
  suspendNavigation?: boolean;
  onArtworkSelect?: (id: string) => void;
  proximityDetail?: boolean;
  onAudioReady?: (api: AudioApi | null) => void;
  onDetailEntryReady?: (actions: DetailEntryActions | null) => void;
  reducedMotion?: boolean;
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
        reducedMotion={reducedMotion}
        onReducedMotionChange={onReducedMotionChange}
        onNavigationState={state => audio.current?.update(state)}
        onCameraPose={(position,yaw)=>audio.current?.updatePose(position,yaw)}
        onNavigationMode={(walking,paused)=>{movement.current=walking && !paused;audio.current?.lifecycle(movement.current,suspendNavigation);}}
      />
      <AudioControls audio={audio.current} state={audioState} zones={publication.exhibition.audioZones} />
      <p className="cms-note">
        입구에 가까운 작품부터 불러옵니다. 다음 묶음과 상세 품질은 직접 요청할
        수 있습니다. 기기 품질은 texture·3D geometry·화면 해상도 예산을 함께
        조정합니다. 목록 보기는 그래픽 없이 사용할 수 있습니다.
      </p>
    </section>
  );
}
