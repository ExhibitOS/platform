import { useCallback, useEffect, useRef, useState } from "react";
import { materialFor, presentationFor } from "@exhibitos/studio-contract";
import { Viewer } from "./Viewer";
import type { SurfaceAppearance } from "./GeometryPreview";
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
  async function load() {
    const current = ++generation.current;
    setLoading(true);
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
            !["image/png", "model/gltf-binary"].includes(asset.mime),
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
          <Viewer publication={value} appearance={appearance} />
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
