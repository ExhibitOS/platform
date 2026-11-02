// SPDX-License-Identifier: AGPL-3.0-or-later
import {useEffect,useId,useMemo,useRef,useState,type FocusEvent,type FormEvent,type MouseEvent,type PointerEvent} from 'react';
import {selectVisitorMap,visitorMapPreview,type MapIntent,type MapPoint,type MapSelection,type MapTarget,type VisitorMap as MapModel,visitorMapPose} from './visitor-map';
import './visitor-map.css';
import {authoredArtworkViewpoint} from './artwork-viewpoint';
import {layoutMapMarkers,mapFanRadius,mapRoomViewport,reconcileMapMarkerPreview,type DisplayMarker} from './map-display-layout';

export interface VisitorMapProps {
 map:MapModel;
 artworkStops?:readonly {placementId:string;viewpointId:string}[];
 worldPose?:ReturnType<typeof visitorMapPose>&{horizontalFovDegrees?:number};
 previews?:Readonly<Record<string,{description?:string;thumbnail?:string}>>;
 destinations:readonly {id:string;roomId:string;name:string}[];
 available:boolean;
 travel:{status:'idle'|'preparing'|'blocked';message:string;pendingViewpointId?:string};
 onDetails(placementId:string):void;
 onGo(target:MapTarget,viewpointId:string):Promise<boolean>;
 onCancel():void;
 onPreviewChange?(placementId:string|undefined):void;
}
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const sameTarget=(a:MapTarget|undefined,b:MapTarget|undefined)=>a===undefined?b===undefined:b!==undefined&&a.kind===b.kind&&same(a.id,b.id);
const middle=(points:MapPoint[]):MapPoint=>[points.reduce((n,p)=>n+p[0],0)/points.length,points.reduce((n,p)=>n+p[1],0)/points.length];

function Schematic({map,worldPose,local=false,overview=false,markers,activePlacementId}:{map:MapModel;worldPose:VisitorMapProps['worldPose'];local?:boolean;overview?:boolean;markers?:DisplayMarker[];activePlacementId?:string}){
 const svg=useRef<SVGSVGElement>(null),[pixels,setPixels]=useState(192);
 useEffect(()=>{const element=svg.current;if(!element||typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(()=>{if(element.clientWidth>0)setPixels(element.clientWidth);});observer.observe(element);return()=>observer.disconnect();},[]);
 const {x,z,width,depth}=map.bounds;
 // World X/Z stays north-up. Only the crop follows the existing camera snapshot.
 const diameter=Math.max(8,Math.min(20,Math.max(width,depth)*.55));
 const overviewSpan=Math.hypot(width,depth)*1.12;
 const center=worldPose?.point??[x+width/2,z+depth/2],span=overview?overviewSpan:local?diameter:width,unitPerPixel=span/pixels,radius=unitPerPixel*2;
 const compactMarkers=useMemo(()=>layoutMapMarkers(map,width/span*pixels,depth/span*pixels,6),[map,width,depth,span,pixels]);
 const display=markers??compactMarkers;
 const fov=worldPose?.horizontalFovDegrees,directionLength=worldPose&&Math.hypot(...worldPose.direction);
 // The sector indicates the actual camera angle, not a ray-traced visibility range.
 const sector=worldPose&&fov!==undefined&&Number.isFinite(fov)&&fov>0&&fov<180&&directionLength&&Number.isFinite(directionLength)?(()=>{
  const angle=Math.atan2(worldPose.direction[1],worldPose.direction[0]),half=fov*Math.PI/360,reach=mapFanRadius(span,pixels),[px,pz]=worldPose.point;
  return `M ${px} ${pz} L ${px+Math.cos(angle-half)*reach} ${pz+Math.sin(angle-half)*reach} A ${reach} ${reach} 0 0 1 ${px+Math.cos(angle+half)*reach} ${pz+Math.sin(angle+half)*reach} Z`;
 })():undefined;
 // A diagonal-sized square keeps every plan corner inside the circular clip.
 const viewBox=overview?`${x+width/2-overviewSpan/2} ${z+depth/2-overviewSpan/2} ${overviewSpan} ${overviewSpan}`:local?`${center[0]-diameter/2} ${center[1]-diameter/2} ${diameter} ${diameter}`:`${x} ${z} ${width} ${depth}`;
 return <svg ref={svg} viewBox={viewBox} aria-hidden="true" focusable="false">
  {map.rooms.map(room=><polygon key={room.id} className="visitor-map-room" points={room.outline.map(p=>p.join(',')).join(' ')}/>)}
  {map.doors.map(door=>{
   const paired=door.connection&&map.doors.find(other=>same(other.id,door.connection!.doorId));
   const a=middle(door.edge),b=paired&&middle(paired.edge);
   return <g key={door.id}><line className="visitor-map-door" x1={door.edge[0][0]} y1={door.edge[0][1]} x2={door.edge[1][0]} y2={door.edge[1][1]}/>{paired&&b&&door.id<paired.id&&<line className="visitor-map-connection" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}/>}</g>;
  })}
  {sector&&<path className="visitor-map-fov" d={sector}/>}
  {display.map(item=><g key={item.id}>
   {item.point&&Math.hypot(item.point[0]-item.anchor[0],item.point[1]-item.anchor[1])>unitPerPixel&&<line className="visitor-map-anchor-link" data-active={item.id===activePlacementId} x1={item.anchor[0]} y1={item.anchor[1]} x2={item.point[0]} y2={item.point[1]}/>}
   <circle className="visitor-map-work-anchor" data-active={item.id===activePlacementId} cx={item.anchor[0]} cy={item.anchor[1]} r={unitPerPixel*1.2}/>
   {!markers&&item.point&&<circle className="visitor-map-work" cx={item.point[0]} cy={item.point[1]} r={radius}/>}
  </g>)}
  {worldPose&&<g className="visitor-map-position"><circle cx={worldPose.point[0]} cy={worldPose.point[1]} r={unitPerPixel*3.5}/>{directionLength&&Number.isFinite(directionLength)?(()=>{
   const [dx,dz]=worldPose.direction.map(v=>v/directionLength) as MapPoint,[px,pz]=worldPose.point,u=unitPerPixel;
   return <path d={`M ${px+dx*12*u} ${pz+dz*12*u} L ${px+dx*5*u-dz*3*u} ${pz+dz*5*u+dx*3*u} L ${px+dx*5*u+dz*3*u} ${pz+dz*5*u-dx*3*u} Z`}/>;
  })():null}</g>}
 </svg>;
}

function ArtworkThumbnail({src,kind}:{src?:string;kind:string}){
 const [failed,setFailed]=useState<string>();
 return src&&failed!==src?<img src={src} alt="" loading="lazy" decoding="async" onError={()=>setFailed(src)}/>:<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">{kind==='sculpture'?<><path d="m12 3 8 5v8l-8 5-8-5V8Z M4 8l8 5 8-5 M12 13v8"/></>:<><rect x="3" y="4" width="18" height="16" rx="1"/><path d="m4 17 5-6 4 4 3-3 4 5"/></>}</svg>;
}

/** The map previews identities. Only the existing renderer owner may admit travel. */
export function VisitorMap({map,artworkStops=[],worldPose,previews,destinations,available,travel,onDetails,onGo,onCancel,onPreviewChange}:VisitorMapProps){
 const expanded=useRef<HTMLDivElement>(null),[mapWidth,setMapWidth]=useState(320);
 const scopeSelect=useRef<HTMLSelectElement>(null),[scope,setScope]=useState<{key:string;roomId:string}>();
 const roomId=scope?.key===map.key&&map.rooms.some(r=>same(r.id,scope.roomId))?scope.roomId:undefined;
 const drawing=useMemo(()=>mapRoomViewport(map,roomId),[map,roomId]);
 const targetSelect=useRef<HTMLSelectElement>(null),focusedMarker=useRef<HTMLButtonElement|null>(null);
 const pointerFocus=useRef<{button:HTMLButtonElement;touch:boolean}|null>(null);
 useEffect(()=>{const element=expanded.current;if(!element||typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(()=>{if(element.clientWidth>0)setMapWidth(element.clientWidth);});observer.observe(element);return()=>observer.disconnect();},[]);
 const displayMarkers=useMemo(()=>layoutMapMarkers(drawing,mapWidth,mapWidth*drawing.bounds.depth/drawing.bounds.width),[drawing,mapWidth]);
 const displayById=new Map(displayMarkers.map(marker=>[marker.id,marker]));
 const overflow=drawing.rooms.map(room=>({room,items:drawing.placements.filter(p=>same(p.roomId,room.id)&&!displayById.get(p.id)?.point)})).filter(group=>group.items.length>0);
 const titleId=useId(),[selection,setSelection]=useState<MapSelection>({key:map.key}),[requestError,setRequestError]=useState<{key:string;text:string}|null>(null),requestGeneration=useRef(0),activeKey=useRef(map.key),selectionRef=useRef(selection);activeKey.current=map.key;selectionRef.current=selection;
 useEffect(()=>{
  const previous=selectionRef.current;if(previous.key!==map.key)return;
  const next=reconcileMapMarkerPreview(previous,new Set(displayMarkers.filter(m=>m.point).map(m=>m.id)));
  const oldElement=focusedMarker.current;
  if(next!==previous){selectionRef.current=next;setSelection(next);requestGeneration.current++;setRequestError(null);}
  // Never steal focus from another control or panel chosen during the resize.
  if(oldElement&&!oldElement.isConnected&&document.activeElement===document.body){focusedMarker.current=null;targetSelect.current?.focus({preventScroll:true});}
 },[map.key,displayMarkers]);
 useEffect(()=>()=>{requestGeneration.current++;},[map.key]);
 const invalidate=()=>{requestGeneration.current++;setRequestError(null);};
 const cancel=()=>{invalidate();onCancel();};
 const dispatch=(intent:{type:'hover'|'leave'|'focus'|'blur'|'select';target:MapTarget}|{type:'dismiss'})=>{
  const previous=selectionRef.current,next=selectVisitorMap(map,previous,{...intent,key:map.key} as MapIntent);
  if(intent.type==='dismiss'||!sameTarget(visitorMapPreview(map,previous),visitorMapPreview(map,next))||!sameTarget(previous.selected,next.selected))invalidate();
  if(intent.type==='select'&&travel.status==='preparing')onCancel();
  selectionRef.current=next;setSelection(next);
 };
 const clearTemporary=()=>{focusedMarker.current=null;const value=selectionRef.current;if(value.focused)dispatch({type:'blur',target:value.focused});if(value.hovered)dispatch({type:'leave',target:value.hovered});};
 const activate=(target:MapTarget,button:HTMLButtonElement)=>{pointerFocus.current=null;clearTemporary();focusedMarker.current=button;dispatch({type:'select',target});};
 const zoomRoom=(id:string)=>{clearTemporary();setScope(id?{key:map.key,roomId:id}:undefined);scopeSelect.current?.focus({preventScroll:true});};
 const preview=visitorMapPreview(map,selection),placement=preview?.kind==='placement'?map.placements.find(item=>same(item.id,preview.id)):undefined;
 useEffect(()=>{onPreviewChange?.(placement?.id);return()=>onPreviewChange?.(undefined);},[map.key,placement?.id,onPreviewChange]);
 const room=map.rooms.find(item=>same(item.id,placement?.roomId??(preview?.kind==='room'?preview.id:'')));
 const authored=placement&&authoredArtworkViewpoint(artworkStops,placement.id);
 const content=placement&&previews?.[placement.id],choices=room?destinations.filter(item=>same(item.roomId,room.id)&&(!authored||same(item.id,authored))):[];
 const busy=travel.status==='preparing';
 const position=(p:MapPoint)=>({left:`${(p[0]-drawing.bounds.x)/drawing.bounds.width*100}%`,top:`${(p[1]-drawing.bounds.z)/drawing.bounds.depth*100}%`});
 const pointerButton={
  onPointerDown:(event:PointerEvent<HTMLButtonElement>)=>{pointerFocus.current={button:event.currentTarget,touch:event.pointerType==='touch'};},
  onPointerUp:(event:PointerEvent<HTMLButtonElement>)=>{const box=event.currentTarget.getBoundingClientRect();if(pointerFocus.current?.button===event.currentTarget&&(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom))pointerFocus.current=null;},
  onPointerCancel:(event:PointerEvent<HTMLButtonElement>)=>{if(pointerFocus.current?.button===event.currentTarget)pointerFocus.current=null;},
 };
 const releaseFocus=(event:FocusEvent<HTMLButtonElement>)=>{if(focusedMarker.current===event.currentTarget)focusedMarker.current=null;if(pointerFocus.current?.button===event.currentTarget)pointerFocus.current=null;};
 const marker=(target:MapTarget)=>({
  ...pointerButton,
  'aria-pressed':selection.key===map.key&&selection.selected?.kind===target.kind&&same(selection.selected.id,target.id),
  // Touch hover ends before its compatibility click; toggling the preview then
  // can move a scrolled map under the tap. Touch selects through the click only.
  onPointerEnter:(event:PointerEvent<HTMLButtonElement>)=>{if(event.pointerType!=='touch')dispatch({type:'hover',target});},onPointerLeave:(event:PointerEvent<HTMLButtonElement>)=>{if(event.pointerType!=='touch')dispatch({type:'leave',target});},
  onFocus:(event:FocusEvent<HTMLButtonElement>)=>{const pending=pointerFocus.current,fromTouch=pending?.button===event.currentTarget&&pending.touch;if(pending?.button===event.currentTarget)pointerFocus.current=null;focusedMarker.current=target.kind==='placement'?event.currentTarget:null;if(!fromTouch)dispatch({type:'focus',target});},onClick:(event:MouseEvent<HTMLButtonElement>)=>activate(target,event.currentTarget),
  onBlur:releaseFocus,
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
  <summary aria-label="전시 지도"><span className="visitor-map-title">전시 지도</span><span className="visitor-map-compact"><span className="visitor-map-nearby"><Schematic map={map} worldPose={worldPose} local/></span><span className="visitor-map-overview"><Schematic map={map} worldPose={worldPose} overview/></span></span><span className="visitor-map-toggle" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 12h12"/><path className="visitor-map-plus" d="M12 6v12"/></svg></span></summary>
  <section aria-labelledby={titleId}>
   <h2 id={titleId}>전시 지도</h2>
   <p className="visitor-map-note">작품을 골라 설명과 관람 위치를 확인하세요.</p>
   <div className="visitor-map-scope"><label>공간 확대<select ref={scopeSelect} value={roomId??''} onFocus={clearTemporary} onChange={event=>zoomRoom(event.target.value)}><option value="">전체 지도</option>{map.rooms.map(room=><option key={room.id} value={room.id}>{room.name}</option>)}</select></label>{roomId&&<button type="button" onClick={()=>zoomRoom('')}>전체 지도</button>}</div>
   <div ref={expanded} className="visitor-map-expanded" style={{aspectRatio:`${drawing.bounds.width}/${drawing.bounds.depth}`}}><Schematic map={drawing} worldPose={worldPose} markers={displayMarkers} activePlacementId={placement?.id}/>
    <div className="visitor-map-markers" role="group" aria-label="공간과 작품">
     {drawing.placements.map(item=>{const display=displayById.get(item.id)?.point;return display&&<button key={item.id} type="button" className="visitor-map-marker" style={position(display)} aria-label={item.title} title={item.title} {...marker({kind:'placement',id:item.id})}><span className="visitor-map-artwork"><ArtworkThumbnail src={previews?.[item.id]?.thumbnail} kind={item.artworkType}/></span></button>;})}
    </div>
   </div>
   {overflow.length>0&&<div className="visitor-map-overflow" role="group" aria-label="겹친 작품 목록"><p className="visitor-map-note">겹친 작품은 공간을 확대하거나 목록에서 고르세요.</p>{overflow.map(({room,items})=><details key={`${map.key}/${roomId??''}/${room.id}`} open={!!roomId}>
    <summary><svg className="visitor-map-group-toggle" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 7 7-7 7"/></svg><span>{room.name} · 겹친 작품 {items.length}개</span><span className="visitor-map-group-thumbnails" aria-hidden="true">{items.slice(0,3).map(item=><span key={item.id} className="visitor-map-artwork"><ArtworkThumbnail src={previews?.[item.id]?.thumbnail} kind={item.artworkType}/></span>)}</span></summary>
    {!roomId&&<button type="button" className="visitor-map-room-zoom" onClick={()=>zoomRoom(room.id)}>이 공간 확대</button>}
    <ul>{items.map(item=><li key={item.id}><button type="button" className="visitor-map-list-target" aria-pressed={selection.key===map.key&&selection.selected?.kind==='placement'&&same(selection.selected.id,item.id)} {...pointerButton} onFocus={event=>{const fromPointer=pointerFocus.current?.button===event.currentTarget;if(fromPointer)pointerFocus.current=null;else clearTemporary();focusedMarker.current=event.currentTarget;}} onBlur={releaseFocus} onClick={event=>activate({kind:'placement',id:item.id},event.currentTarget)}><span className="visitor-map-artwork"><ArtworkThumbnail src={previews?.[item.id]?.thumbnail} kind={item.artworkType}/></span><span>{item.title}</span></button></li>)}</ul>
   </details>)}</div>}
   <label className="visitor-map-target-select">지도에서 고르기<select ref={targetSelect} value={selection.key===map.key&&selection.selected?`${selection.selected.kind}/${selection.selected.id}`:''} onFocus={()=>{focusedMarker.current=null;if(selection.focused)dispatch({type:'blur',target:selection.focused});}} onChange={event=>{
    const chosen=[...map.rooms.map(item=>({kind:'room' as const,id:item.id})),...map.placements.map(item=>({kind:'placement' as const,id:item.id}))].find(target=>`${target.kind}/${target.id}`===event.target.value);
    if(chosen)dispatch({type:'select',target:chosen});else dispatch({type:'dismiss'});
   }}><option value="">공간 또는 작품 선택</option><optgroup label="공간">{map.rooms.map(item=><option key={item.id} value={`room/${item.id}`}>{item.name}</option>)}</optgroup><optgroup label="작품">{map.placements.map(item=><option key={item.id} value={`placement/${item.id}`}>{item.title}</option>)}</optgroup></select></label>
   {preview&&room&&<div className="visitor-map-preview">
    <div className="visitor-map-preview-heading">{placement&&<span className="visitor-map-preview-image"><ArtworkThumbnail src={content?.thumbnail} kind={placement.artworkType}/></span>}<div><h3>{placement?.title??room.name}</h3>{placement&&<p>{room.name}</p>}</div></div>
    {placement&&<button type="button" onClick={()=>{invalidate();onDetails(placement.id);}}>작품 설명</button>}
    {choices.length>0?<form key={`${map.key}/${preview.kind}/${preview.id}`} onSubmit={go}>
     <label>관람 위치<select name="viewpoint" defaultValue="" required disabled={!available||busy}><option value="" disabled>위치 선택</option>{choices.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
     <button type="submit" disabled={!available||busy}>선택한 위치로 이동</button>
    </form>:<p>등록된 관람 위치가 없어요.</p>}
   </div>}
   {travel.message&&<p role={travel.status==='blocked'?'alert':'status'}>{travel.message}</p>}
   {requestError?.key===map.key&&<p role="alert">{requestError.text}</p>}
   {busy&&<button type="button" onClick={cancel}>이동 취소</button>}
  </section>
 </details>;
}
