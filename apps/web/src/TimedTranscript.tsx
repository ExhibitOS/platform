// SPDX-License-Identifier: AGPL-3.0-or-later
import type { TimedTranscript as Transcript } from '@exhibitos/studio-contract';
import type { VoicePlayback } from './viewer/audio';
export function TimedTranscript({transcript,assetId,playback}:{transcript:Transcript;assetId:string;playback:VoicePlayback|null}) {
  const active=playback?.assetId===assetId&&playback.status==='playing'?playback.positionSeconds:null;
  const current=transcript.cues.find(c=>active!==null&&active>=c.start&&active<c.end);
  return <section aria-label={`시간 대본 ${transcript.locale}`}>
    <h4>시간 대본 ({transcript.locale})</h4><p>소리 없이 모든 구간을 읽을 수 있습니다. 재생 중에는 실제 음성 시간에 맞는 구간을 표시합니다.</p>
    <p role="status" lang={current ? transcript.locale : "ko"} data-testid="current-transcript-cue">{current?.text??'현재 재생 구간 없음'}</p>
    <ol lang={transcript.locale}>{transcript.cues.map((c,i)=><li key={i} aria-current={current===c?'true':undefined}>{c.start}–{c.end}초 · {c.text}</li>)}</ol>
    {transcript.translations.map(t=><section key={t.locale} aria-label={`시간 대본 번역 ${t.locale}`}><h5>별도 번역 ({t.locale})</h5><ol lang={t.locale}>{t.cues.map((c,i)=><li key={i} aria-current={active!==null&&active>=c.start&&active<c.end?'true':undefined}>{c.start}–{c.end}초 · {c.text}</li>)}</ol></section>)}
  </section>;
}
