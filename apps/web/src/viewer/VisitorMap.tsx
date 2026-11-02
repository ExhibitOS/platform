// SPDX-License-Identifier: AGPL-3.0-or-later
import {useEffect,useId,useMemo,useRef,useState,type FocusEvent,type FormEvent,type MouseEvent,type PointerEvent} from 'react';
import {selectVisitorMap,visitorMapPreview,type MapIntent,type MapPoint,type MapSelection,type MapTarget,type VisitorMap as MapModel,visitorMapPose} from './visitor-map';
import './visitor-map.css';
import {authoredArtworkViewpoint} from './artwork-viewpoint';
import {useMediaPreference} from '../publication-accessibility';
import type {MapPoseSource} from './map-pose';
import {boundMapViewport,zoomMapViewport,panMapViewport,readMapView,saveMapView,type MapViewport} from './map-viewport';
import {layoutMapMarkers,mapFanRadius,mapRoomViewport,reconcileMapMarkerPreview,type DisplayMarker} from './map-display-layout';

export interface VisitorMapProps {
 map:MapModel;
 artworkStops?:readonly {placementId:string;viewpointId:string}[];
 worldPose?:ReturnType<typeof visitorMapPose>&{horizontalFovDegrees?:number};
 poseSource?:MapPoseSource;
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

function Schematic({map,worldPose,poseSource,active=true,local=false,overview=false,markers,activePlacementId}:{map:MapModel;worldPose:VisitorMapProps['worldPose'];poseSource?:MapPoseSource;active?:boolean;local?:boolean;overview?:boolean;markers?:DisplayMarker[];activePlacementId?:string}){
 const svg=useRef<SVGSVGElement>(null),[pixels,setPixels]=useState(192);
 useEffect(()=>{const element=svg.current;if(!element||typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(()=>{if(element.clientWidth>0)setPixels(element.clientWidth);});observer.observe(element);return()=>observer.disconnect();},[]);
 const {x,z,width,depth}=map.bounds;
 const source=poseSource?.key===map.key?poseSource:undefined,pose=source?source.getSnapshot():worldPose;
 const positionGroup=useRef<SVGGElement>(null),positionCircle=useRef<SVGCircleElement>(null),arrowPath=useRef<SVGPathElement>(null),sectorPath=useRef<SVGPathElement>(null);
 // World X/Z stays north-up. Only the crop follows the existing camera snapshot.
 const diameter=Math.max(8,Math.min(20,Math.max(width,depth)*.55));
 const overviewSpan=Math.hypot(width,depth)*1.12;
 const center=pose?.point??[x+width/2,z+depth/2],span=overview?overviewSpan:local?diameter:width,unitPerPixel=span/pixels;
 const display:DisplayMarker[]=markers??map.placements.map(p=>({id:p.id,anchor:p.point}));
 const glyph=(value:VisitorMapProps['worldPose'])=>{
  const fov=value?.horizontalFovDegrees,length=value&&Math.hypot(...value.direction);let sector:string|undefined,arrow:string|undefined;
  if(value&&length&&Number.isFinite(length)){
   const [dx,dz]=value.direction.map(v=>v/length) as MapPoint,[px,pz]=value.point,u=unitPerPixel;
   arrow=`M ${px+dx*12*u} ${pz+dz*12*u} L ${px+dx*5*u-dz*3*u} ${pz+dz*5*u+dx*3*u} L ${px+dx*5*u+dz*3*u} ${pz+dz*5*u-dx*3*u} Z`;
   if(fov!==undefined&&Number.isFinite(fov)&&fov>0&&fov<180){const angle=Math.atan2(dz,dx),half=fov*Math.PI/360,reach=mapFanRadius(span,pixels);sector=`M ${px} ${pz} L ${px+Math.cos(angle-half)*reach} ${pz+Math.sin(angle-half)*reach} A ${reach} ${reach} 0 0 1 ${px+Math.cos(angle+half)*reach} ${pz+Math.sin(angle+half)*reach} Z`;}
  }
  return {sector,arrow};
 };
 const {sector,arrow}=glyph(pose);
 useEffect(()=>{
  if(!active)return;
  const update=()=>{
   const host=svg.current;if(!host||document.hidden||host.closest('[inert],[hidden]'))return;
   const value=source?source.getSnapshot():worldPose,drawing=glyph(value);
   if(positionGroup.current)positionGroup.current.style.display=value?'':'none';
   if(value){positionCircle.current?.setAttribute('cx',String(value.point[0]));positionCircle.current?.setAttribute('cy',String(value.point[1]));}
   if(arrowPath.current){arrowPath.current.setAttribute('d',drawing.arrow??'');arrowPath.current.style.display=drawing.arrow?'':'none';}
   if(sectorPath.current){sectorPath.current.setAttribute('d',drawing.sector??'');sectorPath.current.style.display=drawing.sector?'':'none';if(drawing.sector)sectorPath.current.setAttribute('class','visitor-map-fov');else sectorPath.current.removeAttribute('class');}
   if(local){const [px,pz]=value?.point??[x+width/2,z+depth/2];host.setAttribute('viewBox',`${px-diameter/2} ${pz-diameter/2} ${diameter} ${diameter}`);}
  };
  update();const unsubscribe=source?.subscribe(update);document.addEventListener('visibilitychange',update);
  return()=>{unsubscribe?.();document.removeEventListener('visibilitychange',update);};
 },[source,worldPose,active,local,x,z,width,depth,diameter,span,pixels,unitPerPixel]);
 // A diagonal-sized square keeps every plan corner inside the circular clip.
 const viewBox=overview?`${x+width/2-overviewSpan/2} ${z+depth/2-overviewSpan/2} ${overviewSpan} ${overviewSpan}`:local?`${center[0]-diameter/2} ${center[1]-diameter/2} ${diameter} ${diameter}`:`${x} ${z} ${width} ${depth}`;
 return <svg ref={svg} viewBox={viewBox} aria-hidden="true" focusable="false">
  {map.rooms.map(room=><polygon key={room.id} className="visitor-map-room" points={room.outline.map(p=>p.join(',')).join(' ')}/>)}
  {map.doors.map(door=>{
   const paired=door.connection&&map.doors.find(other=>same(other.id,door.connection!.doorId));
   const a=middle(door.edge),b=paired&&middle(paired.edge);
   return <g key={door.id}><line className="visitor-map-door" x1={door.edge[0][0]} y1={door.edge[0][1]} x2={door.edge[1][0]} y2={door.edge[1][1]}/>{paired&&b&&door.id<paired.id&&<line className="visitor-map-connection" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}/>}</g>;
  })}
  <path ref={sectorPath} className={sector?"visitor-map-fov":undefined} d={sector} style={{display:sector?undefined:'none'}}/>
  {display.map(item=><g key={item.id}>
   {markers&&item.id===activePlacementId&&item.point&&Math.hypot(item.point[0]-item.anchor[0],item.point[1]-item.anchor[1])>unitPerPixel&&<line className="visitor-map-anchor-link" data-active={item.id===activePlacementId} x1={item.anchor[0]} y1={item.anchor[1]} x2={item.point[0]} y2={item.point[1]}/>}
   <circle className="visitor-map-work-anchor" data-active={item.id===activePlacementId} cx={item.anchor[0]} cy={item.anchor[1]} r={unitPerPixel*1.2}/>
   {!markers&&(()=>{
    const placement=map.placements.find(p=>p.id===item.id),facing=placement?.artworkType==='image'?placement.facing:undefined;
    if(!facing)return null;
    const length=Math.hypot(...facing);if(!Number.isFinite(length)||length<1e-7)return null;
    const [x,z]=item.anchor,dx=-facing[1]/length*3*unitPerPixel,dz=facing[0]/length*3*unitPerPixel;
    return <line className="visitor-map-work-direction" x1={x-dx} y1={z-dz} x2={x+dx} y2={z+dz}/>;
   })()}
  </g>)}
  <g ref={positionGroup} className="visitor-map-position" style={{display:pose?undefined:'none'}}><circle ref={positionCircle} cx={pose?.point[0]??0} cy={pose?.point[1]??0} r={unitPerPixel*3.5}/><path ref={arrowPath} d={arrow} style={{display:arrow?undefined:'none'}}/></g>
 </svg>;
}

function ArtworkThumbnail({src,kind}:{src?:string;kind:string}){
 const [failed,setFailed]=useState<string>();
 return src&&failed!==src?<img src={src} alt="" loading="lazy" decoding="async" onError={()=>setFailed(src)}/>:<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">{kind==='sculpture'?<><path d="m12 3 8 5v8l-8 5-8-5V8Z M4 8l8 5 8-5 M12 13v8"/></>:<><rect x="3" y="4" width="18" height="16" rx="1"/><path d="m4 17 5-6 4 4 3-3 4 5"/></>}</svg>;
}

/** The map previews identities. Only the existing renderer owner may admit travel. */
export function VisitorMap({map,artworkStops=[],worldPose,poseSource,previews,destinations,available,travel,onDetails,onGo,onCancel,onPreviewChange}:VisitorMapProps){
 const [finePointer]=useMediaPreference('(pointer:fine)');
 const restored=useMemo(()=>readMapView(map),[map]);
 const expanded=useRef<HTMLDivElement>(null),[mapWidth,setMapWidth]=useState(320);
 const [viewState,setViewState]=useState({key:map.key,bounds:restored?.viewport??map.bounds});
 const view=viewState.key===map.key?viewState.bounds:restored?.viewport??map.bounds;
 const viewRef=useRef(view);viewRef.current=view;
 const [openState,setOpenState]=useState({key:map.key,open:restored?.open??false});
 const open=openState.key===map.key?openState.open:restored?.open??false;
 const gestureClear=useRef<(()=>void)|null>(null);
 const scopeSelect=useRef<HTMLSelectElement>(null),[scope,setScope]=useState<{key:string;roomId?:string}>({key:map.key,roomId:restored?.roomId});
 const roomId=scope?.key===map.key&&scope.roomId&&map.rooms.some(r=>same(r.id,scope.roomId!))?scope.roomId:undefined;
 const drawing=useMemo(()=>({...map,bounds:view}),[map,view]);
 const changeViewport=(next:MapViewport,roomId?:string)=>{const bounds=boundMapViewport(map,next);viewRef.current=bounds;setViewState({key:map.key,bounds});setScope({key:map.key,roomId});};
 const viewportAction=useRef(changeViewport);viewportAction.current=changeViewport;
 const targetSelect=useRef<HTMLSelectElement>(null),focusedMarker=useRef<HTMLButtonElement|null>(null);
 const pointerFocus=useRef<{button:HTMLButtonElement;touch:boolean}|null>(null);
 useEffect(()=>{const element=expanded.current;if(!element||typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(()=>{if(element.clientWidth>0)setMapWidth(element.clientWidth);});observer.observe(element);return()=>observer.disconnect();},[]);
 const retainedMarkers=useRef<{key:string;ids:Set<string>}>({key:map.key,ids:new Set()});
 const displayMarkers=useMemo(()=>layoutMapMarkers(drawing,mapWidth,mapWidth*drawing.bounds.depth/drawing.bounds.width,44,retainedMarkers.current.key===map.key?retainedMarkers.current.ids:undefined).map(marker=>{
  if(!marker.point)return marker;const x=(marker.point[0]-view.x)/view.width*mapWidth,z=(marker.point[1]-view.z)/view.depth*(mapWidth*view.depth/view.width),height=mapWidth*view.depth/view.width;
  return x>=28&&x<=mapWidth-28&&z>=28&&z<=height-28?marker:{id:marker.id,anchor:marker.anchor};
 }),[drawing,mapWidth,map.key,view]);
 useEffect(()=>{retainedMarkers.current={key:map.key,ids:new Set(displayMarkers.filter(m=>m.point).map(m=>m.id))};},[map.key,displayMarkers]);
 const displayById=new Map(displayMarkers.map(marker=>[marker.id,marker]));
 const overflow=drawing.rooms.map(room=>({room,items:drawing.placements.filter(p=>same(p.roomId,room.id)&&!displayById.get(p.id)?.point)})).filter(group=>group.items.length>0);
 const titleId=useId(),[selection,setSelection]=useState<MapSelection>({key:map.key,selected:restored?.selected}),[requestError,setRequestError]=useState<{key:string;text:string}|null>(null),requestGeneration=useRef(0),activeKey=useRef(map.key),selectionRef=useRef(selection);activeKey.current=map.key;selectionRef.current=selection;
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
 const zoomRoom=(id:string)=>{clearTemporary();gestureClear.current?.();changeViewport(mapRoomViewport(map,id||undefined).bounds,id||undefined);scopeSelect.current?.focus({preventScroll:true});};
 useEffect(()=>{setSelection(value=>value.key===map.key?value:{key:map.key,selected:restored?.selected});setScope(value=>value?.key===map.key?value:{key:map.key,roomId:restored?.roomId});},[map.key,restored]);
 useEffect(()=>{if(selection.key===map.key)saveMapView(map,{key:map.key,viewport:view,selected:selection.selected,roomId,open});},[map,view,selection.key,selection.selected,roomId,open]);
 useEffect(()=>{if(!available)gestureClear.current?.();},[available]);
 useEffect(()=>{
  const host=expanded.current;if(!host)return;
  type Point={x:number;y:number;startX:number;startY:number};
  const points=new Map<number,Point>(),captured=new Set<number>();let dragging=false,suppress=false;
  const usable=()=>!!host.closest('details[open]')&&!host.closest('[inert],[hidden]')&&!document.hidden;
  const clear=()=>{if(points.size)suppress=true;points.clear();dragging=false;delete host.dataset.dragging;for(const id of captured)if(host.hasPointerCapture(id))host.releasePointerCapture(id);captured.clear();};
  gestureClear.current=clear;
  const establish=()=>{if(dragging)return;dragging=true;suppress=true;host.focus({preventScroll:true});clearTemporary();host.dataset.dragging='true';for(const id of points.keys())try{host.setPointerCapture(id);captured.add(id);}catch{/* The global pointer listener still ends this gesture. */}};
  const down=(e:globalThis.PointerEvent)=>{if(!usable()||e.button!==0||e.ctrlKey||e.metaKey||e.altKey)return;if(!points.size)suppress=false;if(points.size>=2)return;points.set(e.pointerId,{x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY});if(e.target===host||e.target instanceof SVGElement)host.focus({preventScroll:true});if(points.size===2)establish();};
  const move=(e:globalThis.PointerEvent)=>{
   const old=points.get(e.pointerId);if(!old)return;if(!usable()){clear();return;}
   const other=[...points.entries()].find(([id])=>id!==e.pointerId)?.[1];
   points.set(e.pointerId,{...old,x:e.clientX,y:e.clientY});if(other||Math.hypot(e.clientX-old.startX,e.clientY-old.startY)>5)establish();if(!dragging)return;
   e.preventDefault();e.stopPropagation();const box=host.getBoundingClientRect(),dx=e.clientX-old.x,dy=e.clientY-old.y;let next=viewRef.current;
   if(other){const before=Math.hypot(old.x-other.x,old.y-other.y),after=Math.hypot(e.clientX-other.x,e.clientY-other.y);if(before>2&&after>2)next=zoomMapViewport(map,next,after/before,[(old.x+other.x-2*box.left)/(2*box.width),(old.y+other.y-2*box.top)/(2*box.height)]);}
   next=panMapViewport(map,next,-dx/box.width*next.width/(other?2:1),-dy/box.height*next.depth/(other?2:1));viewportAction.current(next);
  };
  const end=(e:globalThis.PointerEvent)=>{if(!points.has(e.pointerId))return;points.delete(e.pointerId);if(captured.delete(e.pointerId)&&host.hasPointerCapture(e.pointerId))host.releasePointerCapture(e.pointerId);if(e.type==='pointercancel'){suppress=true;clear();}else if(!points.size){dragging=false;delete host.dataset.dragging;}};
  const lost=(e:globalThis.PointerEvent)=>{if(points.has(e.pointerId)&&captured.has(e.pointerId))clear();};
  const click=(e:globalThis.MouseEvent)=>{if(suppress&&e.detail!==0){e.preventDefault();e.stopImmediatePropagation();}};
  const wheel=(e:WheelEvent)=>{if(!usable())return;e.preventDefault();e.stopPropagation();host.focus({preventScroll:true});const box=host.getBoundingClientRect(),pixels=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?box.height:1);clearTemporary();viewportAction.current(zoomMapViewport(map,viewRef.current,Math.exp(-Math.max(-300,Math.min(300,pixels))*.002),[(e.clientX-box.left)/box.width,(e.clientY-box.top)/box.height]));};
  const key=(e:KeyboardEvent)=>{if(e.target!==host||e.ctrlKey||e.metaKey||e.altKey||!usable())return;const v=viewRef.current,box=host.getBoundingClientRect();let next:MapViewport|undefined;
   if(e.key==='+'||e.key==='=')next=zoomMapViewport(map,v,1.5);else if(e.key==='-')next=zoomMapViewport(map,v,1/1.5);else if(e.key==='Home'||e.key==='0')next=map.bounds;else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))next=panMapViewport(map,v,(e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0)*v.width*48/box.width,(e.key==='ArrowDown'?1:e.key==='ArrowUp'?-1:0)*v.depth*48/box.height);
   if(next){e.preventDefault();e.stopPropagation();clearTemporary();viewportAction.current(next);}
  };
  const visibility=()=>{if(document.hidden)clear();};
  const focusout=(e:globalThis.FocusEvent)=>{if(!(e.relatedTarget instanceof Node&&host.contains(e.relatedTarget)))clear();};
  host.addEventListener('focusout',focusout);host.addEventListener('pointerdown',down);window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);host.addEventListener('lostpointercapture',lost);host.addEventListener('click',click,true);host.addEventListener('wheel',wheel,{passive:false});host.addEventListener('keydown',key);window.addEventListener('blur',clear);document.addEventListener('visibilitychange',visibility);
  return()=>{clear();if(gestureClear.current===clear)gestureClear.current=null;host.removeEventListener('focusout',focusout);host.removeEventListener('pointerdown',down);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end);host.removeEventListener('lostpointercapture',lost);host.removeEventListener('click',click,true);host.removeEventListener('wheel',wheel);host.removeEventListener('keydown',key);window.removeEventListener('blur',clear);document.removeEventListener('visibilitychange',visibility);};
 // The installed handlers read the current viewport/action through refs.
 },[map]);
 const connector=selection.key===map.key?(selection.focused??selection.selected):undefined;
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
 return <details className="viewer-visitor-map" open={open} data-visitor-panel onBlur={event=>{
  if(!(event.relatedTarget instanceof Node&&event.currentTarget.contains(event.relatedTarget))&&selection.focused)dispatch({type:'blur',target:selection.focused});
 }} onToggle={event=>{setOpenState({key:map.key,open:event.currentTarget.open});if(!event.currentTarget.open){clearTemporary();gestureClear.current?.();cancel();}}}>
  <summary aria-label="전시 지도"><span className="visitor-map-title">전시 지도</span><span className="visitor-map-compact"><span className="visitor-map-nearby"><Schematic map={map} worldPose={worldPose} poseSource={poseSource} active={!open&&available&&!finePointer} local/></span><span className="visitor-map-overview"><Schematic map={map} worldPose={worldPose} poseSource={poseSource} active={!open&&available&&finePointer} overview/></span></span><span className="visitor-map-toggle" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 12h12"/><path className="visitor-map-plus" d="M12 6v12"/></svg></span></summary>
  <section aria-labelledby={titleId}>
   <h2 id={titleId}>전시 지도</h2>
   <p className="visitor-map-note">작품을 골라 설명과 관람 위치를 확인하세요.</p>
   <div className="visitor-map-scope"><label>공간 확대<select ref={scopeSelect} value={roomId??''} onFocus={clearTemporary} onChange={event=>zoomRoom(event.target.value)}><option value="">전체 지도</option>{map.rooms.map(room=><option key={room.id} value={room.id}>{room.name}</option>)}</select></label></div>
   <div className="visitor-map-tools" role="group" aria-label="지도 보기"><button type="button" aria-label="지도 확대" onClick={()=>changeViewport(zoomMapViewport(map,view,1.5))}>확대</button><button type="button" aria-label="지도 축소" onClick={()=>changeViewport(zoomMapViewport(map,view,1/1.5))}>축소</button><button type="button" onClick={()=>zoomRoom('')}>전체 지도</button><button type="button" disabled={!poseSource&&!worldPose} onClick={()=>{const pose=poseSource?.key===map.key?poseSource.getSnapshot():worldPose;if(pose)changeViewport({...view,x:pose.point[0]-view.width/2,z:pose.point[1]-view.depth/2});}}>현재 위치</button></div>
   <p className="visitor-map-note" id={`${titleId}-navigation`}>드래그로 이동하고 휠이나 두 손가락으로 확대하세요. 방향키·확대·축소 키와 Home도 사용할 수 있어요.</p>
   <div ref={expanded} className="visitor-map-expanded" data-map-viewport={JSON.stringify(view)} tabIndex={0} role="group" aria-label="지도 탐색" aria-describedby={`${titleId}-navigation`} onPointerDown={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()} style={{aspectRatio:`${drawing.bounds.width}/${drawing.bounds.depth}`}}><Schematic map={drawing} worldPose={worldPose} poseSource={poseSource} active={open&&available} markers={displayMarkers} activePlacementId={connector?.kind==='placement'?connector.id:undefined}/>
    <div className="visitor-map-markers" role="group" aria-label="공간과 작품">
     {drawing.placements.map(item=>{const display=displayById.get(item.id)?.point;return display&&<button key={item.id} type="button" className="visitor-map-marker" style={position(display)} aria-label={item.title} title={item.title} {...marker({kind:'placement',id:item.id})}><span className="visitor-map-artwork"><ArtworkThumbnail src={previews?.[item.id]?.thumbnail} kind={item.artworkType}/></span></button>;})}
    </div>
   </div>
   {overflow.length>0&&<div className="visitor-map-overflow" role="group" aria-label="지도 작품 목록"><p className="visitor-map-note">공간을 확대하거나 목록에서 작품을 고르세요.</p>{overflow.map(({room,items})=><details key={`${map.key}/${roomId??''}/${room.id}`} open={!!roomId}>
    <summary><svg className="visitor-map-group-toggle" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 7 7-7 7"/></svg><span>{room.name} · 목록 {items.length}개</span><span className="visitor-map-group-thumbnails" aria-hidden="true">{items.slice(0,3).map(item=><span key={item.id} className="visitor-map-artwork"><ArtworkThumbnail src={previews?.[item.id]?.thumbnail} kind={item.artworkType}/></span>)}</span></summary>
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
