// SPDX-License-Identifier: AGPL-3.0-or-later
import type {RealtimeState} from './realtime';
export function RealtimeControls({state,offline,join,leave,retry}:{state:RealtimeState|null;offline:boolean;join:()=>void;leave:()=>void;retry:()=>void}) {
 const busy=state?.status==='connecting'||state?.status==='reconnecting',joined=state?.status==='joined';
 return <section aria-label="함께 관람"><h3>함께 관람</h3><p>직접 시작하면 방문객 위치를 같은 전시의 다른 관람객과 공유합니다. 소리·대화·녹음은 공유하지 않습니다. 다른 방문객은 내 이동을 바꾸지 않습니다.</p>
 <button disabled={offline||busy||joined} onClick={join}>함께 관람 시작</button><button disabled={offline||state?.status==='solo'} onClick={leave}>함께 관람 나가기</button><button disabled={offline||busy||joined} onClick={retry}>다시 연결 시도</button>
 <p role="status">{offline?'오프라인 전시는 혼자 관람합니다. 실시간 연결을 만들지 않습니다.':state?.message??'혼자 관람합니다.'}</p>
 <output data-testid="realtime-state" data-realtime-state={JSON.stringify(state)}>연결 {state?.status??'solo'} · 방문객 {state?.visitors.filter(v=>v.connected).length??0}명</output>
 <ul aria-label="현재 함께 관람 중인 방문객">{state?.visitors.map(v=><li key={v.visitorId}>{v.displayName}{v.visitorId===state.selfId?' (나)':''} · {v.connected?'연결됨':'재연결 대기'}</li>)}</ul>
 </section>;
}
