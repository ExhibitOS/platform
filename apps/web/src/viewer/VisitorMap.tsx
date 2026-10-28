// SPDX-License-Identifier: AGPL-3.0-or-later
import {useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {selectVisitorMap,visitorMapPreview,type MapIntent,type MapPoint,type MapSelection,type MapTarget,type VisitorMap as MapModel,visitorMapPose} from './visitor-map';
import './visitor-map.css';

export interface VisitorMapProps {
 map:MapModel;
 worldPose?:ReturnType<typeof visitorMapPose>;
 previews?:Readonly<Record<string,{description?:string;thumbnail?:string}>>;
 destinations:readonly {id:string;roomId:string;name:string}[];
 available:boolean;
 travel:{status:'idle'|'preparing'|'blocked';message:string;pendingViewpointId?:string};
 onDetails(placementId:string):void;
 onGo(target:MapTarget,viewpointId:string):Promise<boolean>;
 onCancel():void;
}
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const sameTarget=(a:MapTarget|undefined,b:MapTarget|undefined)=>a===undefined?b===undefined:b!==undefined&&a.kind===b.kind&&same(a.id,b.id);
const middle=(points:MapPoint[]):MapPoint=>[points.reduce((n,p)=>n+p[0],0)/points.length,points.reduce((n,p)=>n+p[1],0)/points.length];

function Schematic({map,worldPose}:{map:MapModel;worldPose:VisitorMapProps['worldPose']}){
 const {x,z,width,depth}=map.bounds,unit=Math.max(width,depth),radius=unit*.012;
 return <svg viewBox={`${x} ${z} ${width} ${depth}`} aria-hidden="true" focusable="false">
  {map.rooms.map(room=><polygon key={room.id} className="visitor-map-room" points={room.outline.map(p=>p.join(',')).join(' ')}/>)}
  {map.doors.map(door=>{
   const paired=door.connection&&map.doors.find(other=>same(other.id,door.connection!.doorId));
   const a=middle(door.edge),b=paired&&middle(paired.edge);
   return <g key={door.id}><line className="visitor-map-door" x1={door.edge[0][0]} y1={door.edge[0][1]} x2={door.edge[1][0]} y2={door.edge[1][1]}/>{paired&&b&&door.id<paired.id&&<line className="visitor-map-connection" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}/>}</g>;
  })}
  {map.placements.map(item=><circle key={item.id} className="visitor-map-work" cx={item.point[0]} cy={item.point[1]} r={radius}/>)}
  {worldPose&&<g className="visitor-map-position"><circle cx={worldPose.point[0]} cy={worldPose.point[1]} r={radius*1.4}/><line x1={worldPose.point[0]} y1={worldPose.point[1]} x2={worldPose.point[0]+worldPose.direction[0]*unit*.055} y2={worldPose.point[1]+worldPose.direction[1]*unit*.055}/></g>}
 </svg>;
}

/** The map previews identities. Only the existing renderer owner may admit travel. */
export function VisitorMap({map,worldPose,previews,destinations,available,travel,onDetails,onGo,onCancel}:VisitorMapProps){
 const titleId=useId(),[selection,setSelection]=useState<MapSelection>({key:map.key}),[requestError,setRequestError]=useState<{key:string;text:string}|null>(null),requestGeneration=useRef(0),activeKey=useRef(map.key),selectionRef=useRef(selection);activeKey.current=map.key;selectionRef.current=selection;
 useEffect(()=>()=>{requestGeneration.current++;},[map.key]);
 const invalidate=()=>{requestGeneration.current++;setRequestError(null);};
 const cancel=()=>{invalidate();onCancel();};
 const dispatch=(intent:{type:'hover'|'leave'|'focus'|'blur'|'select';target:MapTarget}|{type:'dismiss'})=>{
  const previous=selectionRef.current,next=selectVisitorMap(map,previous,{...intent,key:map.key} as MapIntent);
  if(intent.type==='dismiss'||!sameTarget(visitorMapPreview(map,previous),visitorMapPreview(map,next))||!sameTarget(previous.selected,next.selected))invalidate();
  if(intent.type==='select'&&!sameTarget(previous.selected,next.selected)&&travel.status==='preparing')onCancel();
  selectionRef.current=next;setSelection(next);
 };
 const preview=visitorMapPreview(map,selection),placement=preview?.kind==='placement'?map.placements.find(item=>same(item.id,preview.id)):undefined;
 const room=map.rooms.find(item=>same(item.id,placement?.roomId??(preview?.kind==='room'?preview.id:'')));
 const content=placement&&previews?.[placement.id],choices=room?destinations.filter(item=>same(item.roomId,room.id)):[];
 const busy=travel.status==='preparing';
 const position=(p:MapPoint)=>({left:`${(p[0]-map.bounds.x)/map.bounds.width*100}%`,top:`${(p[1]-map.bounds.z)/map.bounds.depth*100}%`});
 const marker=(target:MapTarget)=>({
  'aria-pressed':selection.key===map.key&&selection.selected?.kind===target.kind&&same(selection.selected.id,target.id),
  onPointerEnter:()=>dispatch({type:'hover',target}),onPointerLeave:()=>dispatch({type:'leave',target}),
  onFocus:()=>dispatch({type:'focus',target}),onClick:()=>dispatch({type:'select',target}),
 });
 const go=(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();
  const id=new FormData(event.currentTarget).get('viewpoint');
  if(!preview||!available||busy||typeof id!=='string'||!choices.some(item=>item.id===id))return;
  const generation=++requestGeneration.current,key=map.key;setRequestError(null);
  void onGo(preview,id).catch(()=>{if(generation===requestGeneration.current&&key===activeKey.current)setRequestError({key,text:'관람 위치를 열지 못했어요. 다시 선택해 주세요.'});});
 };
 return <details className="viewer-visitor-map" data-visitor-panel onBlur={event=>{
  if(!(event.relatedTarget instanceof Node&&event.currentTarget.contains(event.relatedTarget))&&selection.focused)dispatch({type:'blur',target:selection.focused});
 }} onToggle={event=>{if(!event.currentTarget.open){dispatch({type:'dismiss'});cancel();}}}>
  <summary><span>전시 지도</span><span className="visitor-map-compact"><Schematic map={map} worldPose={worldPose}/></span><span className="visitor-map-toggle"><span className="visitor-map-show">펼치기</span><span className="visitor-map-hide">접기</span></span></summary>
  <section aria-labelledby={titleId}>
   <h2 id={titleId}>전시 지도</h2>
   <p className="visitor-map-note">공간과 작품의 위치를 표시한 약도예요. 작품을 선택하면 설명과 관람 위치를 확인할 수 있어요.</p>
   <div className="visitor-map-expanded" style={{aspectRatio:`${map.bounds.width}/${map.bounds.depth}`}}><Schematic map={map} worldPose={worldPose}/>
    <div className="visitor-map-markers" role="group" aria-label="공간과 작품">
     {map.rooms.map(item=><button key={item.id} type="button" className="visitor-map-room-label" style={position(middle(item.outline))} {...marker({kind:'room',id:item.id})}>{item.name}</button>)}
     {map.placements.map(item=><button key={item.id} type="button" className="visitor-map-marker" style={position(item.point)} aria-label={item.title} {...marker({kind:'placement',id:item.id})}><span aria-hidden="true"/></button>)}
    </div>
   </div>
   <label className="visitor-map-target-select">지도에서 고르기<select value={selection.key===map.key&&selection.selected?`${selection.selected.kind}/${selection.selected.id}`:''} onFocus={()=>{if(selection.focused)dispatch({type:'blur',target:selection.focused});}} onChange={event=>{
    const chosen=[...map.rooms.map(item=>({kind:'room' as const,id:item.id})),...map.placements.map(item=>({kind:'placement' as const,id:item.id}))].find(target=>`${target.kind}/${target.id}`===event.target.value);
    if(chosen)dispatch({type:'select',target:chosen});else dispatch({type:'dismiss'});
   }}><option value="">공간 또는 작품 선택</option><optgroup label="공간">{map.rooms.map(item=><option key={item.id} value={`room/${item.id}`}>{item.name}</option>)}</optgroup><optgroup label="작품">{map.placements.map(item=><option key={item.id} value={`placement/${item.id}`}>{item.title}</option>)}</optgroup></select></label>
   {preview&&room&&<div className="visitor-map-preview">
    <h3>{placement?.title??room.name}</h3>
    {placement&&<p>{room.name}</p>}
    {content?.thumbnail&&<img src={content.thumbnail} alt=""/>}
    {content?.description&&<p>{content.description}</p>}
    {placement&&<button type="button" onClick={()=>{invalidate();onDetails(placement.id);}}>작품 설명</button>}
    {choices.length>0?<form key={`${map.key}/${preview.kind}/${preview.id}`} onSubmit={go}>
     <label>이 공간의 관람 위치<select name="viewpoint" defaultValue="" required disabled={!available||busy}><option value="" disabled>위치 선택</option>{choices.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
     <button type="submit" disabled={!available||busy}>선택한 위치로 이동</button>
    </form>:<p>이 공간에 등록된 관람 위치가 없어요.</p>}
   </div>}
   {travel.message&&<p role={travel.status==='blocked'?'alert':'status'}>{travel.message}</p>}
   {requestError?.key===map.key&&<p role="alert">{requestError.text}</p>}
   {busy&&<button type="button" onClick={cancel}>이동 취소</button>}
  </section>
 </details>;
}
