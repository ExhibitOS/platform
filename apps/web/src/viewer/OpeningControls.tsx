// SPDX-License-Identifier: AGPL-3.0-or-later
import {useRef,useState} from 'react';
import type {OpeningSession,OpeningState} from './opening';
import './opening-controls.css';
const statusNames={solo:'혼자 관람',connecting:'참여 확인 중',joined:'참여 중',reconnecting:'다시 연결 중',failed:'연결 정지'};
const phaseNames={waiting:'시작 대기',live:'행사 진행 중',ended:'행사 종료'};
export function OpeningControls({session,state,offline,viewpoints,audioReady}:{session:OpeningSession|null;state:OpeningState|null;offline:boolean;viewpoints:{id:string;name:string}[];audioReady:(node:HTMLDivElement|null)=>void}) {
 const [text,setText]=useState(''),[note,setNote]=useState(''),[viewpoint,setViewpoint]=useState(viewpoints[0]?.id??'');
 const sendButton=useRef<HTMLButtonElement>(null),joined=state?.status==='joined',self=state?.participants.find(p=>p.id===state.selfId),host=!!self?.host;
 return <section className="opening-controls" aria-label="오프닝과 교육 안내">
  <div className="opening-heading"><div><p className="opening-kicker">함께하는 전시</p><h3>오프닝과 교육 안내</h3></div><span className="opening-badge">{offline?'오프라인 관람':host?'호스트':'방문객'}</span></div>
  <p className="opening-intro">글·음성·안내 이동은 각각 선택합니다. 녹음하지 않으며 나가면 마이크와 음성 연결을 닫습니다. 혼자·무음 관람도 계속 사용할 수 있습니다.</p>
  <div className="opening-entry"><div className="opening-actions">
   <button disabled={offline||joined||state?.status==='connecting'} onClick={()=>session?.join()}>오프닝 참여</button>
   <button disabled={offline||joined||state?.status==='connecting'} onClick={()=>{void session?.joinHost();}}>호스트로 참여</button>
   <button disabled={offline||!state||state.status==='solo'} onClick={()=>session?.leave()}>오프닝 나가기</button>
   <button disabled={offline||joined||state?.status==='connecting'} onClick={()=>session?.retry()}>오프닝 다시 참여</button>
  </div><p role="status">{offline?'오프라인 전시는 오프닝에 연결하지 않습니다.':state?.message}</p>
  <output className="opening-summary" data-testid="opening-state" data-opening-state={JSON.stringify(state)}>{statusNames[state?.status??'solo']} · {phaseNames[state?.phase??'waiting']}</output></div>
  <div className="opening-grid">
   <section className="opening-card" aria-label="오프닝 음성 설정"><h4>음성으로 함께하기</h4><p className="opening-help">듣기와 마이크를 따로 허용합니다. 동시에 최대 6명이 음성을 사용할 수 있습니다.</p>
    <label className="opening-option"><input type="checkbox" disabled={!joined||!!self?.muted||state?.phase==='ended'} checked={state?.voiceConsent??false} onChange={e=>session?.preferences(state?.chat??false,e.target.checked,state?.follow??false)}/>음성 듣기 허용 (최대 6명)</label>
    <div className="opening-actions"><button disabled={!joined||!state?.voiceConsent||!self?.voice||self.muted} onClick={()=>{void session?.microphone(!(state?.voice.microphone||state?.voice.requesting));}}>{state?.voice.requesting?'마이크 요청 취소':state?.voice.microphone?'마이크 끄기':'마이크 켜기'}</button><button disabled={!state?.voiceConsent} onClick={()=>session?.retryListening()}>음성 듣기 재시도</button></div>
    <p className="opening-help">{state?.voice.message}</p><output className="opening-summary" data-testid="opening-voice-state" data-voice-state={JSON.stringify(state?.voice)}>음성 연결 {state?.voice.connected??0} · 마이크 {state?.voice.microphone?'켜짐':'꺼짐'}</output><div className="opening-audio" ref={audioReady} aria-label="허용한 방문객 음성 재생"/>
   </section>
   <section className="opening-card" aria-label="오프닝 안내 설정"><h4>안내 위치에서 만나기</h4><p className="opening-help">호스트의 초대를 수락하거나 따라가기를 선택하세요. 동의 없이 위치를 바꾸지 않습니다.</p>
    <label className="opening-option"><input type="checkbox" disabled={!joined} checked={state?.follow??false} onChange={e=>session?.preferences(state?.chat??false,state?.voiceConsent??false,e.target.checked)}/>안내 따라가기 허용 (저장된 안전한 시점만)</label>
    {state?.guide?<div className="opening-invitation"><p>{state.guide.kind==='meet'?'만나기 초대':'안내 초대'} · {viewpoints.find(v=>v.id===state.guide!.id)?.name??'저장된 관람 위치'}</p><button disabled={!joined} onClick={()=>session?.acceptGuide()}>안내 초대 위치로 이동</button></div>:<p className="opening-empty">초대가 오면 이곳에서 확인할 수 있습니다.</p>}
   </section>
   <section className="opening-card opening-chat" aria-label="오프닝 글 대화 설정"><h4>글로 대화하기</h4>
    <label className="opening-option"><input type="checkbox" disabled={!joined} checked={state?.chat??false} onChange={e=>session?.preferences(e.target.checked,state?.voiceConsent??false,state?.follow??false)}/>글 대화 허용</label>
    <ol className="opening-messages" aria-label="허용한 오프닝 글 대화">{state?.messages.map(m=><li key={m.id}><strong>{m.name}</strong><p>{m.text}</p></li>)}</ol>
    {!state?.messages.length&&<p className="opening-empty">{state?.chat?'아직 대화가 없습니다. 첫 인사를 남겨보세요.':'글 대화를 허용하면 메시지를 읽고 보낼 수 있습니다.'}</p>}
    <form className="opening-composer" onSubmit={e=>{e.preventDefault();session?.chat(text);setText('');sendButton.current?.focus();}}><label>오프닝 글 대화<input aria-label="오프닝 글 대화" maxLength={240} disabled={!joined||!state?.chat} value={text} onChange={e=>setText(e.target.value)}/></label><button ref={sendButton} disabled={!joined||!state?.chat||!text.trim()}>글 대화 보내기</button></form>
   </section>
  </div>
  <section className="opening-card opening-members" aria-label="오프닝 참여자 관리"><h4>함께 관람하는 사람</h4><p className="opening-help">상대를 차단하거나 호스트에게 신고할 수 있습니다. 신고 메모는 최대 240자입니다.</p>
   <label className="opening-report-label">신고 메모<input aria-label="신고 메모" maxLength={240} value={note} onChange={e=>setNote(e.target.value)}/></label>
   <ul aria-label="오프닝 참여자">{state?.participants.map(p=><li key={p.id}><div className="opening-person"><strong>{p.name}{p.id===state.selfId?' (나)':''}</strong><span>{p.host?'호스트':'방문객'} · {p.muted?'호스트 음소거':p.voice?'음성 허용':'무음'}</span></div>{p.id!==state.selfId&&<div className="opening-actions"><button disabled={!joined||state.blocked.includes(p.id)} onClick={()=>session?.block(p.id)}>방문객 차단 {p.name}</button><button disabled={!joined} onClick={()=>session?.report(p.id,'other',note)}>방문객 신고 {p.name}</button>{host&&<><button onClick={()=>session?.host('mute',p.id)}>호스트 음소거 {p.name}</button><button onClick={()=>session?.host('remove',p.id)}>호스트 퇴장 {p.name}</button></>}</div>}</li>)}</ul>
   {!state?.participants.length&&<p className="opening-empty">참여하면 방문객 목록이 표시됩니다.</p>}
  </section>
  {host&&<fieldset className="opening-card opening-host"><legend>서버가 확인한 호스트 제어</legend><div className="opening-actions"><button onClick={()=>session?.host('begin')}>오프닝 시작</button><button onClick={()=>session?.host('end')}>오프닝 종료</button><button onClick={()=>session?.host('mute_all')}>모든 음성 정지</button></div>
   <label>저장된 안내 시점<select aria-label="저장된 안내 시점" value={viewpoint} onChange={e=>setViewpoint(e.target.value)}>{viewpoints.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label><div className="opening-actions"><button disabled={!viewpoint} onClick={()=>session?.host('guide',viewpoint)}>선택 시점 안내 초대</button><button disabled={!viewpoint} onClick={()=>session?.host('meet',viewpoint)}>여기에서 만나기 초대</button></div>
   <h4>호스트에게 전달된 신고</h4><ol aria-label="호스트 신고 목록">{state?.reports.map(r=><li key={r.id}>{r.reason==='spam'?'스팸':r.reason==='abuse'?'부적절한 행동':'기타'} · {r.note}</li>)}</ol>{!state?.reports.length&&<p className="opening-empty">아직 신고가 없습니다.</p>}
  </fieldset>}
  <p className="opening-footnote">네트워크 환경에 따라 직접 음성 연결이 어려울 수 있습니다. 외부 음성 중계를 사용하지 않습니다. 연결되지 않아도 글 대화·작품 설명·대본을 이용하세요.</p>
 </section>;
}
