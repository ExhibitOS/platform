// SPDX-License-Identifier: AGPL-3.0-or-later
import type {SpatialProgram,SpatialEvent} from '@exhibitos/studio-contract';
import type {ScriptState} from './scripting';
export function ScriptControls({program,state,start,stop,consent,setConsent,transcripts,event}:{program:SpatialProgram;state:ScriptState|null;start:()=>void;stop:()=>void;consent:boolean;setConsent:(value:boolean)=>void;transcripts:string[];event:(event:SpatialEvent)=>void}) {
 return <section aria-label="선택적 공간 스크립트"><h3>공간 스크립트</h3><p>현재 관람객 화면의 조명·작품 표시·설명만 바꿉니다. 움직임을 강요하지 않습니다. 정지하면 원래 표시로 복원합니다.</p>
 <label><input type="checkbox" checked={state?.enabled??false} onChange={e=>e.target.checked?start():stop()}/>공간 스크립트 켜기</label>
 <button onClick={start}>{state?.enabled?'스크립트 다시 시작':'스크립트 시작'}</button><button onClick={stop}>스크립트 정지</button><button disabled={!state?.enabled} onClick={()=>event({type:'exhibition_end'})}>전시 마침 동작 실행</button>
 <label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>스크립트 오디오 허용 (소리 켜기도 필요)</label>
 <div>{program.rules.filter(r=>r.trigger.type==='artwork_click'||r.trigger.type==='custom_event').map(r=><button key={r.id} disabled={!state?.enabled} onClick={()=>event(r.trigger)}>스크립트 동작 선택 {r.id}</button>)}</div>
 <p role="status">{state?.status}</p><p data-testid="script-visible-text">{state?.text}</p>
 <output data-testid="scripting-state" data-script-state={JSON.stringify(state)}>예약 {state?.pending??0} · 실행 {state?.lifetime??0}</output>
 <details><summary>스크립트 동작과 실행 기록</summary><ul>{program.rules.map(r=><li key={r.id}>{r.id}: {r.trigger.type} → {r.actions.map(a=>`${a.type} (이전 동작 후 ${a.delayMs}ms)`).join(', ')}</li>)}</ul><ol>{state?.trace.map(t=><li key={t.sequence}>{t.elapsedMs}ms · {t.ruleId??'시스템'} · {t.code}</li>)}</ol></details>
 <details><summary>소리 없이 읽는 원문 대본</summary>{transcripts.map((text,i)=><p key={i}>{text}</p>)}</details></section>;
}
