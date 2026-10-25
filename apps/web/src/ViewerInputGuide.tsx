// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef } from "react";

export type ViewerInputMode = "auto" | "pointer" | "trackpad" | "touch";
export type ResolvedViewerInputMode = Exclude<ViewerInputMode, "auto">;

// A browser exposes a coarse pointer, not a reliable mouse/trackpad distinction.
// Fine-pointer devices start with the existing drag controls, without capture.
export function resolveViewerInputMode(mode: ViewerInputMode, coarse: boolean): ResolvedViewerInputMode {
  return mode === "auto" ? coarse ? "touch" : "trackpad" : mode;
}

export const viewerInputInstructions: Record<ResolvedViewerInputMode, string> = {
  pointer: "W/A/S/D 또는 ↑/↓로 걷고, 화면을 누른 채 드래그하거나 ←/→로 둘러보세요. 원하면 메뉴의 ‘마우스 시점 잡기’를 직접 선택하세요.",
  trackpad: "W/A/S/D 또는 ↑/↓로 걷고, 마우스나 트랙패드를 누른 채 드래그하거나 ←/→로 둘러보세요. 스크롤은 걷기 조작이 아니에요.",
  touch: "왼쪽 방향 버튼을 누르는 동안 걷고, 다른 손가락으로 오른쪽 화면을 드래그하거나 시점 버튼을 눌러 둘러보세요. 손을 떼면 멈춰요.",
};

export function ViewerInputGuide({ mode, replayed, onDismiss }: {
  mode: ResolvedViewerInputMode;
  replayed: boolean;
  onDismiss: () => void;
}) {
  const guide = useRef<HTMLElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!replayed) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    heading.current?.focus({ preventScroll: true });
  }, [replayed]);
  const dismiss = () => {
    const restore = guide.current?.contains(document.activeElement);
    onDismiss();
    if (restore) {
      const target = returnFocus.current?.isConnected ? returnFocus.current : document.querySelector<HTMLElement>('canvas[aria-label="전시 공간 3D 미리보기"]');
      target?.focus({ preventScroll: true });
    }
  };
  return <aside ref={guide} className="viewer-brief" aria-label="짧은 관람 안내" data-input-mode={mode}>
    <div className="viewer-brief-copy"><h2 ref={heading} tabIndex={-1}>가볍게 둘러보기</h2>
      <p>{viewerInputInstructions[mode]} 작품을 선택하면 설명을 볼 수 있어요.</p>
      <p>Esc·화면 이탈은 정지해요. 메뉴에서 걷기 재개·조작 방식·소리·텍스트 관람을 선택하고 이 안내를 다시 볼 수 있어요.</p>
    </div>
    <button onPointerDown={event => event.preventDefault()} onClick={dismiss}>안내 건너뛰기</button>
  </aside>;
}
