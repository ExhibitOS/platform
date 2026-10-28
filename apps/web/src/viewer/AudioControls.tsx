// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Exhibition } from "@exhibitos/spec";
import type { AudioState, ExhibitionAudio } from "./audio";
export function AudioControls({ audio, state, zones }: { audio: ExhibitionAudio | null; state: AudioState | null; zones: Exhibition["audioZones"] }) {
  return <section className="viewer-audio" aria-label="전시 소리">
    <h3>소리</h3>
    <button onClick={() => { void audio?.enable(); }} disabled={!audio}>소리 켜기</button>
    <label><input type="checkbox" checked={state?.muted ?? false} onChange={e=>audio?.mute(e.target.checked)}/>소리 끄기</label>
    <label>소리 크기<input aria-label="소리 크기" type="range" min="0" max="1" step="0.05" value={state?.volume ?? 0.5} onChange={e=>audio?.volume(Number(e.target.value))}/></label>
    <p role="status" data-testid="audio-state" data-audio-state={JSON.stringify(state)}>{state?.message ?? "소리는 자동 재생하지 않습니다. 음성 설명은 글로 읽을 수 있습니다."}</p>
    <details className="viewer-options viewer-audio-settings"><summary>공간 소리 설정</summary>
    <label><input type="checkbox" checked={state?.footstepsEnabled ?? false} disabled={!audio} onChange={e=>audio?.footstepsEnabled(e.target.checked)}/>걷는 동안 발소리 (선택)</label>
    <label><input type="checkbox" checked={state?.reverbEnabled ?? false} disabled={!audio} onChange={e=>audio?.reverbEnabled(e.target.checked)}/>방 잔향 (선택)</label>
    {zones.length>0 && <label><input type="checkbox" checked={state?.zoneTransitions ?? false} onChange={e=>{void audio?.zoneTransitions(e.target.checked);}}/>구역에 들어갈 때 소리 재생 (선택)</label>}
    {zones.map(zone=><div key={zone.id}><button onClick={()=>{void audio?.playZone(zone.id);}}>공간 소리 재생 {zone.id}</button><p>{zone.transcript}</p></div>)}
    <p className="cms-note">발소리 {state?.footsteps ?? 0}회 · {state?.material ?? "concrete"}</p>
    </details>
    {zones.length>0 && <button onClick={()=>audio?.stopZone()}>공간 소리 정지</button>}
  </section>;
}
