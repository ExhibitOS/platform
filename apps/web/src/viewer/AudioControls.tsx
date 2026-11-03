// SPDX-License-Identifier: AGPL-3.0-or-later
import {useEffect,useRef,useState} from 'react';
import type {Exhibition} from '@exhibitos/spec';
import type {AudioState,ExhibitionAudio} from './audio';
import {ViewerIcon} from './ViewerIcon';

export const audioUseReady=(state:AudioState|null)=>!!state?.enabled&&state.context==='running';
/** An explicit gesture grants/resumes browser audio. Promise resolution alone
 * is not success: the existing runtime reports failure through its snapshot. */
export async function setAudioUse(audio:Pick<ExhibitionAudio,'enable'|'mute'|'snapshot'>,use:boolean,current:()=>boolean){
 if(!current())return;
 if(!use){audio.mute(true);return;}
 if(!audioUseReady(audio.snapshot()))await audio.enable();
 if(current()&&audioUseReady(audio.snapshot()))audio.mute(false);
}
export function AudioControls({audio,state,zones,rooms=[]}:{audio:ExhibitionAudio|null;state:AudioState|null;zones:Exhibition['audioZones'];rooms?:readonly Pick<Exhibition['rooms'][number],'id'|'name'>[]}){
 const [pending,setPending]=useState(false),[requestError,setRequestError]=useState<string>(),mounted=useRef(true),currentAudio=useRef(audio),generation=useRef(0),pendingRef=useRef(false);currentAudio.current=audio;
 useEffect(()=>{mounted.current=true;generation.current++;pendingRef.current=false;setPending(false);setRequestError(undefined);return()=>{mounted.current=false;generation.current++;};},[audio]);
 const ready=audioUseReady(state),using=ready&&!state?.muted;
 const change=()=>{
  if(!audio||pendingRef.current)return;
  const version=generation.current,current=()=>mounted.current&&currentAudio.current===audio&&generation.current===version;
  setRequestError(undefined);if(using){audio.mute(true);return;}
  pendingRef.current=true;setPending(true);
  void setAudioUse(audio,!using,current).catch(()=>{if(current())setRequestError('소리를 시작하지 못했어요. 다시 시도해 주세요.');}).finally(()=>{if(current()){pendingRef.current=false;setPending(false);}});
 };
 return <section className="viewer-audio" aria-label="전시 소리">
  <h3>소리</h3>
  <button type="button" role="switch" aria-checked={using} aria-label="소리 사용" aria-busy={pending} onClick={change} disabled={!audio||pending} className="viewer-audio-use"><span>소리 사용</span><span>{pending?'켜는 중…':using?'켬':'끔'}</span></button>
  {state?.muted&&<p className="viewer-audio-note">음소거 중이에요. 소리 사용을 켜면 해제해요.</p>}
  {using&&state?.suspended&&<p className="viewer-audio-note">소리는 사용할 수 있어요. 패널을 보거나 관람이 멈춘 동안 재생도 쉬어요.</p>}
  <label>음량 <output>{Math.round((state?.volume??.5)*100)}%</output><input aria-label="음량" type="range" min="0" max="1" step="0.05" value={state?.volume??.5} disabled={!audio} onChange={e=>audio?.volume(Number(e.target.value))}/></label>
  {state?.volume===0&&<p className="viewer-audio-note">음량이 0이에요. 음소거 설정과는 별개예요.</p>}
  <p role="status" data-testid="audio-state" data-audio-state={JSON.stringify(state)}>{pending?'브라우저에서 소리를 준비하고 있어요.':requestError??state?.message??'소리는 선택해서 켭니다. 음성 설명은 글로 읽을 수 있어요.'}</p>
  <details className="viewer-options viewer-audio-settings"><summary>발소리·공간 소리</summary>
   <label><input type="checkbox" checked={state?.footstepsEnabled??false} disabled={!audio} onChange={e=>audio?.footstepsEnabled(e.target.checked)}/>발소리 사용</label>
   <label><input type="checkbox" checked={state?.reverbEnabled??false} disabled={!audio} onChange={e=>audio?.reverbEnabled(e.target.checked)}/>방 잔향 사용</label>
   {zones.length>0&&<label><input type="checkbox" checked={state?.zoneTransitions??false} disabled={!audio} onChange={e=>{void audio?.zoneTransitions(e.target.checked);}}/>공간에 들어갈 때 소리 재생</label>}
   {zones.map((zone,index)=>{const room=rooms.find(r=>r.id.toLowerCase()===zone.roomId.toLowerCase()),name=`${room?.name??'공간'} 소리 ${index+1}`;return <div key={zone.id} className="viewer-audio-zone" role="group" aria-label={name}><div className="viewer-audio-zone-heading"><span>{name}</span><button type="button" className="viewer-secondary-icon" aria-label={`${name} 재생`} title={`${name} 재생`} disabled={!audio} onClick={()=>{void audio?.playZone(zone.id);}}><ViewerIcon name="play"/></button></div><details><summary>{name} 대본</summary><p>{zone.transcript}</p></details></div>;})}
  </details>
  {zones.length>0&&<button type="button" className="viewer-audio-stop" disabled={!audio} onClick={()=>audio?.stopZone()}><ViewerIcon name="stop"/>공간 소리 정지</button>}
 </section>;
}
