import { useCallback, useEffect, useRef, useState } from "react";
import { materialFor, presentationFor } from "@exhibitos/studio-contract";
import { Viewer } from "./Viewer";
import { ArtworkDetail } from "./ArtworkDetail";
import type { SurfaceAppearance, DetailEntryActions } from "./GeometryPreview";
import type { PublicPublication as PublicResponse } from "./publication-client";
import { validateDraft } from "./drafts/validator";
import { newDraft } from "./drafts/example";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function PublicPublication({ id }: { id: string }) {
  const [value, setValue] = useState<PublicResponse | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [proximityDetail, setProximityDetail] = useState(false);
  const [overview, setOverview] = useState<"opening" | "credits" | null>(null);
  const detailEntry = useRef<DetailEntryActions | null>(null);
  const registerDetailEntry = useCallback((actions: DetailEntryActions | null) => { detailEntry.current = actions; }, []);
  const prepareDetailEntry = useCallback(() => { detailEntry.current?.prepare(); }, []);
  const audio = useRef<{ playVoice(id: string): Promise<void>; stopVoice(): void } | null>(null);
  const registerAudio = useCallback((api: typeof audio.current) => { audio.current = api; }, []);
  const playVoice = useCallback(async (assetId: string) => {
    if (!audio.current) throw Error("AUDIO_UNAVAILABLE");
    await audio.current.playVoice(assetId);
  }, []);
  const stopVoice = useCallback(() => { audio.current?.stopVoice(); }, []);
  async function load() {
    const current = ++generation.current;
    setLoading(true);
    setSelectedId(null);
    setOverview(null);
    setValue(null);
    setError("");
    try {
      if (!uuid.test(id)) throw Error("PUBLICATION_UNAVAILABLE");
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
      if (generation.current === current) setValue(result);
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
  }, [id]);
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
  return (
    <main className="cms-shell publication-shell">
      <header>
        <a className="brand" href="/">
          ExhibitOS<span>OPEN EXHIBITION</span>
        </a>
        <span>공개 revision preview</span>
      </header>
      <p role="status" data-testid="public-state">
        {loading
          ? "공개 revision을 확인합니다."
          : error || "서버가 현재 공개 상태와 전시 권리를 확인했습니다."}
      </p>
      <button disabled={loading} onClick={() => void load()}>
        공개 상태 다시 확인
      </button>
      {value && (
        <article>
          <p className="eyebrow">IMMUTABLE PUBLICATION</p>
          <h1>{value.exhibition.title}</h1>
          <p>공개일 {value.publication.publishedAt}</p>
          {presentationFor(value.exhibition).credits && (
            <p>{presentationFor(value.exhibition).credits}</p>
          )}
          <p className="cms-note">
            Revision SHA-256 <code>{value.publication.revisionSha256}</code>
          </p>
          <button onPointerDown={prepareDetailEntry} onClick={event => { detailEntry.current?.commit(event.detail > 0); setOverview("opening"); }}>전시 시작 안내</button>
          <button onPointerDown={prepareDetailEntry} onClick={event => { detailEntry.current?.commit(event.detail > 0); setOverview("credits"); }}>전시 크레딧</button>
          <label><input type="checkbox" checked={proximityDetail} onChange={e => setProximityDetail(e.target.checked)} />작품에 가까워지면 상세 보기 자동 열기 (기본 꺼짐)</label>
          <Viewer publication={value} appearance={appearance} onArtworkSelect={setSelectedId}
            suspendNavigation={selectedId !== null || overview !== null} proximityDetail={proximityDetail} onAudioReady={registerAudio} onDetailEntryReady={registerDetailEntry} />
          {selectedId && <ArtworkDetail key={selectedId} publication={value} placementId={selectedId}
            onClose={() => setSelectedId(null)} onVoicePlay={playVoice} onVoiceStop={stopVoice} />}
          {overview && <ExhibitionOverview publication={value} mode={overview} onClose={() => setOverview(null)} />}
          <section aria-label="작품 목록형 대체 보기">
            <h2>작품 목록</h2>
            <ul>
              {value.exhibition.placements.map((p) => {
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
                  <li key={p.id}>
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
          <p className="cms-note">
            공개 승인 snapshot의 공간과 전시용 derivative를 점진적으로
            불러옵니다. 걷기 시작을 선택하면 지원되는 공간에서 보행할 수 있습니다.
            이동이 어려우면 정지 관람과 작품 목록을 이용하세요. 이미 전달된
            작품 bytes는 복제될 수 있습니다.
          </p>
        </article>
      )}
      <footer>
        <a href="/THIRD_PARTY_NOTICES.txt">제3자 고지</a>
      </footer>
    </main>
  );
}

function ExhibitionOverview({ publication, mode, onClose }: {
  publication: PublicResponse; mode: "opening" | "credits"; onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement, element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog className="artwork-detail" ref={dialog} aria-labelledby="exhibition-overview-title" onCancel={e => { e.preventDefault(); onClose(); }}>
    <header><h2 id="exhibition-overview-title">{mode === "opening" ? "전시 시작 안내" : "전시 크레딧"}</h2><button autoFocus onClick={onClose}>전시로 돌아가기</button></header>
    <h3>{publication.exhibition.title}</h3>
    {mode === "opening" ? <><p>걷기 시작 후 방향키 또는 W/A/S/D로 이동합니다. 마우스 시점 잡기를 선택한 뒤 마우스로 둘러보고, Esc로 정지합니다. 상세 보기와 전시 안내를 열면 보행을 잠시 정지하고 기존 시점을 유지합니다.</p>
      <p>목록의 작품 상세 보기로 설명·실제 치수·권리·이력을 확인할 수 있습니다. 소리 없이도 모든 설명을 읽을 수 있습니다. 자동 상세 보기는 기본적으로 꺼져 있습니다.</p></> : <>
      <p className="detail-text">{presentationFor(publication.exhibition).credits || "별도 전시 크레딧이 등록되지 않았습니다."}</p>
      <ul>{publication.exhibition.artworks.map(a => <li key={a.revisionId}>{a.metadata.title} · {a.metadata.artist} · {a.rights.creditLine}</li>)}</ul>
      <p>공개 revision {publication.publication.revisionSha256}</p></>}
  </dialog>;
}
