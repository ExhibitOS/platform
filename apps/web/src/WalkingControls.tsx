// SPDX-License-Identifier: AGPL-3.0-or-later
import type { WalkAction, WalkingPauseReason } from "./viewer/navigation-input";
export interface WalkingSettings {
  speed: 0.7 | 1.3 | 1.6;
  eyeHeight: number;
  reducedMotion: boolean;
}
export interface WalkingActions {
  start: () => void;
  canResumeInput?: () => boolean;
  resumeInput?: () => boolean;
  teleport?: (viewpointId: string) => void;
  sit?: (benchId:string) => void;
  stand?: () => void;
  pause: (reason?: WalkingPauseReason) => void;
  stationary: () => void;
  capture: () => void;
  reset: () => void;
  settings: (value: WalkingSettings) => void;
  press: (action: WalkAction, id: number) => void;
  release: (id: number) => void;
}
export function WalkingControls({
  available,
  walking,
  paused,
  settings,
  onSettings,
  actions,
  message,
  allowPointerCapture = true,
}: {
  available: boolean;
  walking: boolean;
  paused: boolean;
  settings: WalkingSettings;
  onSettings: (settings: WalkingSettings) => void;
  actions: WalkingActions | null;
  message: string;
  allowPointerCapture?: boolean;
}) {
  return (
    <section className="walking-controls" aria-label="걷기 조작">
      <p>이동을 멈추고 다시 걷거나 정지 관람으로 전환할 수 있어요. 이동이 어려우면 작품 목록으로 감상할 수 있어요.</p>
      <div className="cms-actions">
        <button
          disabled={!available || (walking && !paused)}
          onClick={() => actions?.start()}
        >
          {walking ? "걷기 재개" : "걷기 시작"}
        </button>
        <button
          disabled={!available || paused}
          onClick={() => actions?.pause()}
        >
          걷기 일시 정지
        </button>
        <button disabled={!available} onClick={() => actions?.stationary()}>
          정지 관람으로 전환
        </button>
        <button disabled={!available} onClick={() => actions?.reset()}>
          안전한 시작 위치로
        </button>
      </div>
      <label><input type="checkbox" checked={settings.reducedMotion} onChange={event => onSettings({ ...settings, reducedMotion:event.target.checked })}/>움직임 효과 줄이기</label>
      <details className="viewer-options"><summary>이동 방법·설정</summary>
      <p id="walking-instructions">
        걷기 시작 후 화면에 초점을 두고 W/A/S/D 또는 ↑/↓로 이동하고 ←/→로 시점을
        돌립니다. 마우스 시점은 직접 선택합니다. Esc·다른 항목 선택·화면 전환은
        일시 정지합니다. 터치는 왼쪽 방향 버튼으로 이동하고 오른쪽 방향 버튼이나
        화면 오른쪽 드래그로 위·아래·좌우를 둘러봅니다. 버튼을 누르는 동안 움직이고
        손을 떼면 멈춥니다.
      </p>
        {allowPointerCapture && <button disabled={!available} onClick={() => actions?.capture()}>마우스 시점 잡기</button>}
      <div className="walking-settings">
        <label>
          보행 속도
          <select
            aria-label="보행 속도"
            value={settings.speed}
            onChange={(event) =>
              onSettings({
                ...settings,
                speed: Number(event.target.value) as WalkingSettings["speed"],
              })
            }
          >
            <option value={0.7}>느리게 · 0.7 m/s</option>
            <option value={1.3}>보통 · 1.3 m/s</option>
            <option value={1.6}>빠르게 · 1.6 m/s</option>
          </select>
        </label>
        <label>
          눈높이
          <input
            aria-label="눈높이"
            type="range"
            min="1.2"
            max="1.7"
            step="0.05"
            value={settings.eyeHeight}
            onChange={(event) =>
              onSettings({ ...settings, eyeHeight: Number(event.target.value) })
            }
          />
          <output>{settings.eyeHeight.toFixed(2)} m</output>
        </label>
      </div></details>
      <p role="status" aria-label="보행 상태" aria-live="polite">
        {message}
      </p>
    </section>
  );
}

export function WalkingTouch({
  available,
  paused,
  resumable = false,
  actions,
}: {
  available: boolean;
  paused: boolean;
  resumable?: boolean;
  actions: WalkingActions | null;
}) {
  const move = (action: WalkAction, label: string, direction: string, symbol: string) => (
    <button
      type="button"
      aria-label={label}
      data-walk-touch={action}
      style={{ gridArea: direction }}
      disabled={!available || (paused && !resumable)}
      onPointerDown={(event) => {
        if ((paused && event.isPrimary === false) || (event.pointerType === "mouse" && event.button !== 0)) return;
        if (paused && !actions?.resumeInput?.()) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        actions?.press(action, event.pointerId);
      }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => event.preventDefault()}
      onPointerUp={(event) => {
        event.preventDefault();
        actions?.release(event.pointerId);
      }}
      onPointerCancel={(event) => actions?.release(event.pointerId)}
      onLostPointerCapture={(event) => actions?.release(event.pointerId)}
    >
      <span aria-hidden="true">{symbol}</span>
    </button>
  );
  return (
    <div className="walking-touch" aria-label="터치 이동">
      <div className="walking-touch-group" role="group" aria-label="이동">
        <span className="walking-touch-label">이동</span>
        <div className="walking-direction-pad">
          {move("forward", "앞으로 이동", "up", "↑")}
          {move("left", "왼쪽 이동", "left", "←")}
          {move("right", "오른쪽 이동", "right", "→")}
          {move("backward", "뒤로 이동", "down", "↓")}
        </div>
      </div>
      <div className="walking-touch-group" role="group" aria-label="시점">
        <span className="walking-touch-label">시점</span>
        <div className="walking-direction-pad">
          {move("look-up", "위쪽 시점", "up", "↑")}
          {move("turn-left", "왼쪽 시점", "left", "←")}
          {move("turn-right", "오른쪽 시점", "right", "→")}
          {move("look-down", "아래쪽 시점", "down", "↓")}
        </div>
      </div>
    </div>
  );
}
