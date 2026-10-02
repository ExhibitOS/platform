// SPDX-License-Identifier: AGPL-3.0-or-later
import type { WalkAction } from "./viewer/navigation-input";
export interface WalkingSettings {
  speed: 0.7 | 1.3 | 1.6;
  eyeHeight: number;
  reducedMotion: boolean;
}
export interface WalkingActions {
  start: () => void;
  pause: () => void;
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
}: {
  available: boolean;
  walking: boolean;
  paused: boolean;
  settings: WalkingSettings;
  onSettings: (settings: WalkingSettings) => void;
  actions: WalkingActions | null;
  message: string;
}) {
  return (
    <section className="walking-controls" aria-label="걷기 조작">
      <p id="walking-instructions">
        걷기 시작 후 화면에 초점을 두고 W/A/S/D 또는 ↑/↓로 이동하고 ←/→로 시점을
        돌립니다. 마우스 시점은 직접 선택합니다. Esc·다른 항목 선택·화면 전환은
        일시 정지합니다. 터치는 화면 왼쪽 이동 버튼과 오른쪽 드래그를 함께
        사용합니다.
      </p>
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
        <button disabled={!available} onClick={() => actions?.capture()}>
          마우스 시점 잡기
        </button>
        <button disabled={!available} onClick={() => actions?.reset()}>
          안전한 시작 위치로
        </button>
      </div>
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
        <label>
          <input
            type="checkbox"
            checked={settings.reducedMotion}
            onChange={(event) =>
              onSettings({ ...settings, reducedMotion: event.target.checked })
            }
          />
          움직임 효과 줄이기
        </label>
      </div>
      <p role="status" aria-label="보행 상태" aria-live="polite">
        {message}
      </p>
    </section>
  );
}

export function WalkingTouch({
  available,
  paused,
  actions,
}: {
  available: boolean;
  paused: boolean;
  actions: WalkingActions | null;
}) {
  const move = (action: WalkAction, label: string) => (
    <button
      data-walk-touch={action}
      disabled={!available || paused}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        actions?.press(action, event.pointerId);
      }}
      onPointerUp={(event) => actions?.release(event.pointerId)}
      onPointerCancel={(event) => actions?.release(event.pointerId)}
      onLostPointerCapture={(event) => actions?.release(event.pointerId)}
    >
      {label}
    </button>
  );
  return (
    <div className="walking-touch" aria-label="터치 이동">
      {move("forward", "앞으로 이동")}
      {move("left", "왼쪽 이동")}
      {move("backward", "뒤로 이동")}
      {move("right", "오른쪽 이동")}
      {move("turn-left", "왼쪽 시점")}
      {move("turn-right", "오른쪽 시점")}
    </div>
  );
}
