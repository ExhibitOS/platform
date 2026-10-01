import { useMemo, useState } from "react";
import { GeometryPreview } from "./GeometryPreview";
import type { SurfaceAppearance } from "./GeometryPreview";
import type { PublicPublication } from "./publication-client";
import { DEVICE_BUDGETS, deviceBudget } from "./viewer/loading";
export function Viewer({
  publication,
  appearance,
}: {
  publication: PublicPublication;
  appearance: (id: string) => SurfaceAppearance;
}) {
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
      />
      <p className="cms-note">
        입구에 가까운 작품부터 불러옵니다. 다음 묶음과 상세 품질은 직접 요청할
        수 있습니다. 기기 품질은 texture·3D geometry·화면 해상도 예산을 함께
        조정합니다. 목록 보기는 그래픽 없이 사용할 수 있습니다.
      </p>
    </section>
  );
}
