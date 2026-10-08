// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect,useRef,useState } from 'react';
import type { Exhibition } from '@exhibitos/spec';
import { curationFor } from '@exhibitos/studio-contract';
export interface GuideRequest {routeId:string;index:number;sequence:number}
export function GuidedRoutes({exhibition,onView,onArtwork}:{exhibition:Exhibition;onView?: (routeId:string,index:number)=>void;onArtwork:(id:string)=>void}) {
  const guides=curationFor(exhibition).routes;
  const [routeId,setRouteId]=useState(''),[index,setIndex]=useState(0);
  const heading=useRef<HTMLHeadingElement>(null),openers=useRef(new Map<string,HTMLButtonElement>()),openerId=useRef(''),moveFocus=useRef(false);
  const guide=guides.find(g=>g.routeId===routeId),route=exhibition.navigation.find(r=>r.id===routeId),stop=guide?.stops[index];
  useEffect(()=>{if(moveFocus.current){moveFocus.current=false;heading.current?.focus();}},[routeId,index]);
  if(!guides.length)return null;
  const select=(id:string,i=0)=>{moveFocus.current=true;setRouteId(id);setIndex(i);};
  return <section aria-label="작가 추천 안내 동선"><h2>작가 추천 안내 동선</h2><p>동선은 직접 선택해 따라갑니다. 이동이나 소리를 강제로 시작하지 않습니다. 아래 글 안내가 정지·무음 관람에서도 같은 내용을 제공합니다.</p>
    {!guide?<>{guides.map(g=><button ref={el=>{if(el)openers.current.set(g.routeId,el);else openers.current.delete(g.routeId);}} key={g.routeId} onClick={()=>{openerId.current=g.routeId;select(g.routeId);}}>안내 시작 {exhibition.navigation.find(r=>r.id===g.routeId)?.name}</button>)}</>:<>
      <div role="group" aria-label="선택한 안내 정류점"><h3 tabIndex={-1} ref={heading}>{route?.name} · 정류점 {index+1} / {guide.stops.length}</h3><p role="status">{stop?.title}</p><p className="detail-text">{stop?.description}</p></div>
      <button disabled={index===0} onClick={()=>select(routeId,index-1)}>안내 이전 정류점</button><button disabled={index===guide.stops.length-1} onClick={()=>select(routeId,index+1)}>안내 다음 정류점</button>
      <button onClick={()=>{setRouteId('');setIndex(0);requestAnimationFrame(()=>openers.current.get(openerId.current)?.focus());}}>안내 종료</button>
      {onView&&<button onClick={()=>onView(routeId,index)}>선택 정류점의 3D 정지 시점 보기</button>}
      {stop?.placementId&&<button onClick={()=>onArtwork(stop.placementId!)}>안내 작품 상세 보기</button>}
      <details><summary>전체 정류점 글 안내</summary><ol>{guide.stops.map((s,i)=><li key={i}><h4>{s.title}</h4><p>{s.description}</p><button onClick={()=>select(routeId,i)}>정류점 글 선택 {i+1}</button></li>)}</ol></details>
    </>}
  </section>;
}
