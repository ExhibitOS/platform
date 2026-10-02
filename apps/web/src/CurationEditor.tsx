// SPDX-License-Identifier: AGPL-3.0-or-later
import { useRef, useState } from 'react';
import type { Exhibition, JsonValue } from '@exhibitos/spec';
import { CURATION_NAMESPACE, curationFor, EXPERIENCE_NAMESPACE, experienceFor, type ViewerCuration, type TranscriptCue } from '@exhibitos/studio-contract';
import { newDraft } from './drafts/example';
import { validateDraft } from './drafts/validator';

export function CurationEditor({candidate, disabled, onChange}: {candidate:Exhibition;disabled:boolean;onChange(value:Exhibition):void}) {
  const latest=useRef(candidate);latest.current=candidate;
  const [notice,setNotice]=useState('');
  const [zoneId,setZoneId]=useState(''),[referenceDistance,setReferenceDistance]=useState(1),[maxDistance,setMaxDistance]=useState(10),[rolloff,setRolloff]=useState(1),[occlusion,setOcclusion]=useState(true),[closedGain,setClosedGain]=useState(.2);
  const [voiceKey,setVoiceKey]=useState(''),[duration,setDuration]=useState(1),[cueStart,setCueStart]=useState(0),[cueEnd,setCueEnd]=useState(1),[cueText,setCueText]=useState(''),[cueIndex,setCueIndex]=useState(-1),[cueKind,setCueKind]=useState<"original"|"translated"|null>(null),[translationLocale,setTranslationLocale]=useState('en');
  const [annotationId,setAnnotationId]=useState(''),[annotationText,setAnnotationText]=useState(''),[anchor,setAnchor]=useState<[number,number,number]>([0,0,0]),[annotationLocale,setAnnotationLocale]=useState('en'),[annotationTranslation,setAnnotationTranslation]=useState('');
  const [routeId,setRouteId]=useState(''),[routeName,setRouteName]=useState(''),[roomId,setRoomId]=useState(''),[point,setPoint]=useState<[number,number,number]>([0,1.6,0]),[stopTitle,setStopTitle]=useState(''),[stopDescription,setStopDescription]=useState(''),[stopPlacement,setStopPlacement]=useState(''),[stopOpening,setStopOpening]=useState(''),[stopIndex,setStopIndex]=useState(-1);
  const curation=curationFor(candidate),experience=experienceFor(candidate);
  const voice=experience.voices.find(v=>`${v.placementId}:${v.locale}`===voiceKey);
  const transcript=curation.transcripts.find(t=>t.placementId===voice?.placementId&&t.locale===voice.locale);
  const route=candidate.navigation.find(r=>r.id===routeId),guide=curation.routes.find(r=>r.routeId===routeId);
  function apply(edit:(doc:Exhibition,x:ViewerCuration)=>void) {
    if(disabled)return;
    const doc=structuredClone(latest.current),x=curationFor(doc);
    try {edit(doc,x);doc.extensions={...doc.extensions,[CURATION_NAMESPACE]:x as unknown as {[key:string]:JsonValue}};
      const draft=newDraft();draft.exhibitionId=doc.id;draft.candidate=doc;
      if(!validateDraft(draft).valid)throw Error('invalid');
      onChange(doc);setNotice('편집을 적용했습니다. 로컬 및 서버에 저장한 뒤 공개하세요.');
    } catch {setNotice('시간·참조·위치·입력 한도를 확인하세요. 이전 문서는 유지됩니다.');}
  }
  function selectVoice(key:string){setVoiceKey(key);setCueIndex(-1);setCueText('');const v=experience.voices.find(v=>`${v.placementId}:${v.locale}`===key),t=curation.transcripts.find(t=>t.placementId===v?.placementId&&t.locale===v.locale);setDuration(t?.durationSeconds??1);}
  function editCue(translated:boolean,remove=false){
    if(!voice)return;
    const selectedIndex=cueKind===(translated?"translated":"original")?cueIndex:-1;
    apply((_doc,x)=>{
      let t=x.transcripts.find(t=>t.placementId===voice.placementId&&t.locale===voice.locale);
      if(!t){if(translated)throw Error('original required');t={placementId:voice.placementId,locale:voice.locale,durationSeconds:duration,cues:[],translations:[]};x.transcripts.push(t);}
      t.durationSeconds=duration;
      let cues=t.cues;
      if(translated){let tr=t.translations.find(a=>a.locale===translationLocale);if(!tr){tr={locale:translationLocale,cues:[]};t.translations.push(tr);}cues=tr.cues;}
      if(remove){if(selectedIndex<0)throw Error('select cue');cues.splice(selectedIndex,1);}else {const cue:TranscriptCue={start:cueStart,end:cueEnd,text:cueText};if(selectedIndex>=0)cues.splice(selectedIndex,1,cue);else cues.push(cue);}
      cues.sort((a,b)=>a.start-b.start);
      if(translated)t.translations=t.translations.filter(tr=>tr.cues.length);
      if(!t.cues.length)x.transcripts=x.transcripts.filter(a=>a!==t);
    });setCueIndex(-1);
  }
  function selectAnnotation(id:string){setAnnotationId(id);setAnnotationText(candidate.annotations.find(a=>a.id===id)?.text??'');setAnchor(experience.annotations.find(a=>a.annotationId===id)?.position??[0,0,0]);setAnnotationTranslation(curation.annotationTranslations.find(a=>a.annotationId===id&&a.locale===annotationLocale)?.text??'');}
  function selectRoute(id:string){setRouteId(id);setStopIndex(-1);setRouteName(candidate.navigation.find(r=>r.id===id)?.name??'');setStopTitle('');setStopDescription('');}
  function saveStop(){apply((doc,x)=>{
    let r=doc.navigation.find(r=>r.id===routeId);
    if(!r){r={id:crypto.randomUUID(),name:routeName,accessible:true,waypoints:[]};doc.navigation.push(r);}
    r.name=routeName;
    let g=x.routes.find(g=>g.routeId===r.id);if(!g){g={routeId:r.id,stops:r.waypoints.map((_,i)=>({waypointIndex:i,title:`정류점 ${i+1}`,description:'기존 경유점의 설명을 편집하세요.'}))};x.routes.push(g);}
    const i=stopIndex>=0?stopIndex:r.waypoints.length;
    r.waypoints.splice(i,stopIndex>=0?1:0,{roomId,position:[...point],...(stopOpening?{viaOpeningId:stopOpening}:{})});
    g.stops.splice(i,stopIndex>=0?1:0,{waypointIndex:i,title:stopTitle,description:stopDescription,...(stopPlacement?{placementId:stopPlacement}:{})});
    g.stops.forEach((s,i)=>s.waypointIndex=i);
    if(!doc.accessibility.routeIds.includes(r.id))doc.accessibility.routeIds.push(r.id);
    setRouteId(r.id);
  });setStopIndex(-1);}
  function changeStop(index:number,delta:number|null){apply((doc,x)=>{const r=doc.navigation.find(r=>r.id===routeId),g=x.routes.find(g=>g.routeId===routeId);if(!r||!g)throw Error('missing');
    if(delta===null){r.waypoints.splice(index,1);g.stops.splice(index,1);}else{const target=index+delta;if(target<0||target>=g.stops.length)throw Error('bounds');[r.waypoints[index],r.waypoints[target]]=[r.waypoints[target]!,r.waypoints[index]!];[g.stops[index],g.stops[target]]=[g.stops[target]!,g.stops[index]!];}
    g.stops.forEach((s,i)=>s.waypointIndex=i);
    if(!r.waypoints.length){doc.navigation=doc.navigation.filter(a=>a!==r);doc.accessibility.routeIds=doc.accessibility.routeIds.filter(id=>id!==r.id);x.routes=x.routes.filter(a=>a!==g);setRouteId('');}
  });setStopIndex(-1);}
  return <section className="cms-card" aria-label="공간 오디오와 안내 동선 편집"><h3>공간 오디오·시간 대본·안내 동선</h3><p>원문은 유지하고 번역을 별도로 저장합니다. 추천 동선은 강제로 이동시키지 않으며 글 안내로도 읽을 수 있습니다.</p><p role="status">{notice}</p>
    <fieldset disabled={disabled}><legend>공간 오디오 거리와 차폐</legend>
      <label>편집할 오디오 구역<select aria-label="편집할 오디오 구역" value={zoneId} onChange={e=>{setZoneId(e.target.value);const z=curation.audioZones.find(z=>z.zoneId===e.target.value);setReferenceDistance(z?.referenceDistance??1);setMaxDistance(z?.maxDistance??10);setRolloff(z?.rolloff??1);setOcclusion(z?.occlusion.enabled??true);setClosedGain(z?.occlusion.closedGain??.2);}}><option value="">구역 선택</option>{candidate.audioZones.map(z=><option key={z.id} value={z.id}>{z.transcript.slice(0,60)}</option>)}</select></label>
      <label>기준 거리 (m)<input aria-label="기준 거리 (m)" type="number" value={referenceDistance} min="1" max="1000" onChange={e=>setReferenceDistance(Number(e.target.value))}/></label><label>최대 청취 거리 (m)<input aria-label="최대 청취 거리 (m)" type="number" value={maxDistance} min="1" max="1000" onChange={e=>setMaxDistance(Number(e.target.value))}/></label><label>거리 감쇠 계수<input aria-label="거리 감쇠 계수" type="number" value={rolloff} min="0" max="4" step=".1" onChange={e=>setRolloff(Number(e.target.value))}/></label>
      <label><input type="checkbox" checked={occlusion} onChange={e=>setOcclusion(e.target.checked)}/>벽 차폐 감쇠 사용</label><label>차폐된 소리 비율<input aria-label="차폐된 소리 비율" type="number" value={closedGain} min="0" max="1" step=".05" onChange={e=>setClosedGain(Number(e.target.value))}/></label>
      <button disabled={!zoneId} onClick={()=>apply((_d,x)=>{x.audioZones=x.audioZones.filter(z=>z.zoneId!==zoneId);x.audioZones.push({zoneId,referenceDistance,maxDistance,rolloff,occlusion:{enabled:occlusion,closedGain}});})}>오디오 거리·차폐 적용</button><button disabled={!zoneId} onClick={()=>apply((_d,x)=>{x.audioZones=x.audioZones.filter(z=>z.zoneId!==zoneId);})}>거리·차폐 기본값으로</button>
    </fieldset>
    <fieldset disabled={disabled}><legend>시간 대본 원문과 번역</legend><label>시간 대본 음성<select aria-label="시간 대본 음성" value={voiceKey} onChange={e=>selectVoice(e.target.value)}><option value="">음성 선택</option>{experience.voices.map(v=><option key={`${v.placementId}:${v.locale}`} value={`${v.placementId}:${v.locale}`}>{v.locale} · {v.transcript.slice(0,60)}</option>)}</select></label>
      {voice&&<p lang={voice.locale}>보존된 전체 원문: {voice.transcript}</p>}<label>음성 전체 길이 (초)<input aria-label="음성 전체 길이 (초)" type="number" min=".001" max="60" step=".001" value={duration} onChange={e=>setDuration(Number(e.target.value))}/></label><p>승인된 WAV의 정확한 길이를 입력하세요. 서버가 실제 파일 길이와 대조합니다.</p>
      <label>대본 시작 (초)<input aria-label="대본 시작 (초)" type="number" min="0" max="60" step=".1" value={cueStart} onChange={e=>setCueStart(Number(e.target.value))}/></label><label>대본 끝 (초)<input aria-label="대본 끝 (초)" type="number" min="0" max="60" step=".1" value={cueEnd} onChange={e=>setCueEnd(Number(e.target.value))}/></label><label>시간 대본 글<textarea aria-label="시간 대본 글" value={cueText} onChange={e=>setCueText(e.target.value)} maxLength={16384}/></label>
      <button disabled={!voice||!cueText.trim()} onClick={()=>editCue(false)}>원문 시간 대본 추가·갱신</button><button disabled={!voice||cueIndex<0||cueKind!=="original"} onClick={()=>editCue(false,true)}>선택 원문 시간 대본 삭제</button>
      <ol>{transcript?.cues.map((c,i)=><li key={i}>{c.start}–{c.end}초 · {c.text}<button onClick={()=>{setCueKind("original");setCueIndex(i);setCueStart(c.start);setCueEnd(c.end);setCueText(c.text);}}>원문 시간 대본 선택 {i+1}</button></li>)}</ol>
      <label>시간 대본 번역 언어<input aria-label="시간 대본 번역 언어" value={translationLocale} onChange={e=>{setTranslationLocale(e.target.value);setCueIndex(-1);}} maxLength={48}/></label><button disabled={!transcript||!cueText.trim()} onClick={()=>editCue(true)}>번역 시간 대본 추가·갱신</button><button disabled={!transcript||cueIndex<0||cueKind!=="translated"} onClick={()=>editCue(true,true)}>선택 번역 시간 대본 삭제</button>
      <ol>{transcript?.translations.find(t=>t.locale===translationLocale)?.cues.map((c,i)=><li key={i} lang={translationLocale}>{c.start}–{c.end}초 · {c.text}<button onClick={()=>{setCueKind("translated");setCueIndex(i);setCueStart(c.start);setCueEnd(c.end);setCueText(c.text);}}>번역 시간 대본 선택 {i+1}</button></li>)}</ol>
    </fieldset>
    <fieldset disabled={disabled}><legend>위치 주석 편집과 번역</legend><label>편집할 위치 주석<select aria-label="편집할 위치 주석" value={annotationId} onChange={e=>selectAnnotation(e.target.value)}><option value="">주석 선택</option>{candidate.annotations.map(a=><option key={a.id} value={a.id}>{a.text.slice(0,60)}</option>)}</select></label><label>위치 주석 원문<textarea aria-label="위치 주석 원문" value={annotationText} onChange={e=>setAnnotationText(e.target.value)} maxLength={16384}/></label>
      {anchor.map((n,i)=><label key={i}>주석 좌표 {'XYZ'[i]}<input type="number" step=".01" value={n} onChange={e=>setAnchor(anchor.map((v,j)=>i===j?Number(e.target.value):v) as typeof anchor)}/></label>)}
      <button disabled={!annotationId||!annotationText.trim()} onClick={()=>apply((doc)=>{const a=doc.annotations.find(a=>a.id===annotationId);if(!a)throw Error('missing');a.text=annotationText;const exp=experienceFor(doc);exp.annotations=exp.annotations.filter(a=>a.annotationId!==annotationId);exp.annotations.push({annotationId,position:anchor});doc.extensions={...doc.extensions,[EXPERIENCE_NAMESPACE]:exp as unknown as {[key:string]:JsonValue}};})}>위치 주석 원문·좌표 적용</button>
      <label>주석 번역 언어<input aria-label="주석 번역 언어" value={annotationLocale} onChange={e=>{setAnnotationLocale(e.target.value);setAnnotationTranslation(curation.annotationTranslations.find(a=>a.annotationId===annotationId&&a.locale===e.target.value)?.text??'');}} maxLength={48}/></label><label>주석 번역문<textarea aria-label="주석 번역문" value={annotationTranslation} onChange={e=>setAnnotationTranslation(e.target.value)} maxLength={16384}/></label><button disabled={!annotationId||!annotationTranslation.trim()} onClick={()=>apply((_d,x)=>{x.annotationTranslations=x.annotationTranslations.filter(a=>a.annotationId!==annotationId||a.locale!==annotationLocale);x.annotationTranslations.push({annotationId,locale:annotationLocale,text:annotationTranslation});})}>주석 번역 적용</button>
      <button disabled={!annotationId} onClick={()=>apply((_d,x)=>{x.annotationTranslations=x.annotationTranslations.filter(a=>a.annotationId!==annotationId||a.locale!==annotationLocale);})}>선택 언어 주석 번역 삭제</button>
      <button disabled={!annotationId} onClick={()=>apply((doc,x)=>{doc.annotations=doc.annotations.filter(a=>a.id!==annotationId);const exp=experienceFor(doc);exp.annotations=exp.annotations.filter(a=>a.annotationId!==annotationId);doc.extensions={...doc.extensions,[EXPERIENCE_NAMESPACE]:exp as unknown as {[key:string]:JsonValue}};x.annotationTranslations=x.annotationTranslations.filter(a=>a.annotationId!==annotationId);})}>위치 주석 삭제</button>
    </fieldset>
    <fieldset disabled={disabled}><legend>추천 동선과 정지 안내</legend><label>편집할 안내 동선<select aria-label="편집할 안내 동선" value={routeId} onChange={e=>selectRoute(e.target.value)}><option value="">새 동선</option>{candidate.navigation.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label><label>안내 동선 이름<input aria-label="안내 동선 이름" value={routeName} onChange={e=>setRouteName(e.target.value)} maxLength={512}/></label>
      <label>안내 정류점 공간<select aria-label="안내 정류점 공간" value={roomId} onChange={e=>setRoomId(e.target.value)}><option value="">방 선택</option>{candidate.rooms.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>{point.map((n,i)=><label key={i}>정류점 좌표 {'XYZ'[i]}<input type="number" step=".1" value={n} onChange={e=>setPoint(point.map((v,j)=>i===j?Number(e.target.value):v) as typeof point)}/></label>)}
      <label>정류점 연결 문<select aria-label="정류점 연결 문" value={stopOpening} onChange={e=>setStopOpening(e.target.value)}><option value="">같은 방·연결 문 없음</option>{candidate.openings.filter(o=>o.type==='door'&&o.connectsToOpeningId).map(o=><option key={o.id} value={o.id}>{candidate.rooms.find(r=>r.id===candidate.surfaces.find(s=>s.id===o.surfaceId)?.roomId)?.name} · {o.id}</option>)}</select></label>
      <label>정류점 제목<input aria-label="정류점 제목" value={stopTitle} onChange={e=>setStopTitle(e.target.value)} maxLength={512}/></label><label>정류점 글 설명<textarea aria-label="정류점 글 설명" value={stopDescription} onChange={e=>setStopDescription(e.target.value)} maxLength={16384}/></label><label>정류점 관련 작품<select aria-label="정류점 관련 작품" value={stopPlacement} onChange={e=>setStopPlacement(e.target.value)}><option value="">작품 없음</option>{candidate.placements.map(p=><option key={p.id} value={p.id}>{candidate.artworks.find(a=>a.revisionId===p.artworkRevisionId)?.metadata.title??p.id}</option>)}</select></label>
      <button disabled={!roomId||!routeName.trim()||!stopTitle.trim()||!stopDescription.trim()} onClick={saveStop}>안내 정류점 추가·갱신</button>
      <ol>{route?.waypoints.map((w,i)=>{const s=guide?.stops[i];return <li key={i}>{s?.title??`정류점 ${i+1}`} · {s?.description??'글 설명 미등록'}<button onClick={()=>{setStopIndex(i);setRoomId(w.roomId);setPoint(w.position);setStopTitle(s?.title??'');setStopDescription(s?.description??'');setStopPlacement(s?.placementId??'');setStopOpening(w.viaOpeningId??'');}}>안내 정류점 선택 {i+1}</button><button disabled={!guide||i===0} onClick={()=>changeStop(i,-1)}>정류점 위로 {i+1}</button><button disabled={!guide||i===route.waypoints.length-1} onClick={()=>changeStop(i,1)}>정류점 아래로 {i+1}</button><button disabled={!guide} onClick={()=>changeStop(i,null)}>정류점 삭제 {i+1}</button></li>;})}</ol>
      <button disabled={!routeId} onClick={()=>apply((doc,x)=>{doc.navigation=doc.navigation.filter(r=>r.id!==routeId);doc.accessibility.routeIds=doc.accessibility.routeIds.filter(id=>id!==routeId);x.routes=x.routes.filter(r=>r.routeId!==routeId);})}>안내 동선 삭제</button><p>글 설명이 동일한 정지 안내를 제공합니다. 좌표를 입력했다고 실제 보행의 접근성이나 안전이 인증되지는 않습니다.</p>
    </fieldset>
  </section>;
}
