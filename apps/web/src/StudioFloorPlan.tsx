import {useEffect,useMemo,useRef,useState} from 'react';
import {Vector3} from 'three';
import type {Exhibition} from '@exhibitos/spec';
import {matrix,planarCommand,planarRoomDimensionCommand,roomDimensionCommand,selectionKey,worldMatrix,type EditorBridge,type EditorSelection,type RoomDimensionAxis} from './geometry/direct-edit';
import type {GeometryCommand} from './geometry/model';
import {ARTWORK_MARKER_RADIUS,artworkLabelLayout} from './studio-floorplan-labels';
import './studio-floorplan.css';
export function StudioFloorPlan({document,editor}:{document:Exhibition;editor:EditorBridge}){
 const svg=useRef<SVGSVGElement>(null),current=useRef(editor);current.current=editor;
 const selectionNodes=useRef(new Map<string,SVGGElement>());
 const drag=useRef<{id:number;selection:EditorSelection;start:[number,number];doc:Exhibition;mode:EditorBridge["mode"];view:string;axis?:RoomDimensionAxis;command:GeometryCommand|null}|null>(null);
 const [zoom,setZoom]=useState(1),[listOpen,setListOpen]=useState(false);
 const elements=useMemo(()=>[
  ...document.rooms.map(r=>({s:{kind:'room',id:r.id} as EditorSelection,w:r.dimensions.width,d:r.dimensions.depth,label:r.name})),
  ...document.surfaces.filter(s=>s.type==='wall').map(s=>({s:{kind:'surface',id:s.id} as EditorSelection,w:s.dimensions.width,d:.08,label:'벽'})),
  ...document.openings.map(o=>({s:{kind:'opening',id:o.id} as EditorSelection,w:o.dimensions.width,d:.12,label:o.type==='door'?'문':'창문'})),
  ...document.placements.map((p,index)=>{const art=document.artworks.find(a=>a.revisionId===p.artworkRevisionId);return {s:{kind:'placement',id:p.id} as EditorSelection,w:art?.dimensions.width??.3,d:art?.dimensions.depth??.08,label:art?.metadata.title??'작품',number:index+1};})
 ].map(item=>{const m=worldMatrix(document,item.s);if(item.s.kind==='placement'){const placed=document.placements.find(p=>p.id===item.s.id),art=document.artworks.find(a=>a.revisionId===placed?.artworkRevisionId);if(art)m.multiply(matrix(art.transform));}const corners=[[-item.w/2,-item.d/2],[item.w/2,-item.d/2],[item.w/2,item.d/2],[-item.w/2,item.d/2]].map(([x,z])=>new Vector3(x,0,z).applyMatrix4(m));if(item.s.kind==='surface'||item.s.kind==='opening'){const half=item.w/2;const a=new Vector3(-half,0,0).applyMatrix4(m),b=new Vector3(half,0,0).applyMatrix4(m);return {...item,points:`${a.x},${a.z} ${b.x},${b.z}`,center:new Vector3().setFromMatrixPosition(m),line:true};}return {...item,points:corners.map(p=>`${p.x},${p.z}`).join(' '),center:new Vector3().setFromMatrixPosition(m),line:false};}),[document]);
 const bounds=useMemo(()=>{const points=elements.flatMap(e=>e.points.split(' ').map(p=>p.split(',').map(Number))),xs=points.map(p=>p[0]!),zs=points.map(p=>p[1]!);const minX=Math.min(-1,...xs),maxX=Math.max(1,...xs),minZ=Math.min(-1,...zs),maxZ=Math.max(1,...zs),span=Math.max(maxX-minX,maxZ-minZ,2)+2;return {x:(minX+maxX)/2,z:(minZ+maxZ)/2,span};},[elements]);
 const [frame,setFrame]=useState(bounds),[pan,setPan]=useState<[number,number]>([0,0]);
 const panning=useRef<{id:number;x:number;y:number;units:number;origin:[number,number]}|null>(null);
 // Keep the plan stationary during transforms; only a new draft/topology or explicit Fit reframes it.
 useEffect(()=>{setFrame(bounds);setPan([0,0]);},[editor.document.id,editor.document.revisionId,editor.document.rooms.length]);
 const span=frame.span/zoom,left=frame.x+pan[0]-span/2,top=frame.z+pan[1]-span/2;
 const view=`${left} ${top} ${span} ${span}`;
 const artworks=useMemo(()=>elements.flatMap(item=>'number' in item&&typeof item.number==='number'?[{...item,number:item.number}]:[]),[elements]);
 const labels=useMemo(()=>artworkLabelLayout(artworks.map(({s,center})=>({id:s.id,x:center.x,z:center.z})),{left,top,span}),[artworks,left,top,span]);
 function point(e:{clientX:number;clientY:number}):[number,number]{const node=svg.current!,p=node.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const m=node.getScreenCTM();if(!m)return [0,0];const transformed=p.matrixTransform(m.inverse());return [transformed.x,transformed.y];}
 function cancel(){const moving=panning.current;panning.current=null;if(moving){setPan(moving.origin);if(svg.current?.hasPointerCapture(moving.id))svg.current.releasePointerCapture(moving.id);}const a=drag.current;drag.current=null;if(a&&svg.current?.hasPointerCapture(a.id))svg.current.releasePointerCapture(a.id);current.current.previewChange(null);}
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&(drag.current||panning.current)){e.preventDefault();cancel();}};window.addEventListener('keydown',key);window.addEventListener('blur',cancel);return()=>{window.removeEventListener('keydown',key);window.removeEventListener('blur',cancel);cancel();};},[]);
 useEffect(()=>{if(drag.current&&(drag.current.doc!==editor.document||drag.current.mode!==editor.mode||drag.current.view!==editor.view||editor.disabled||!editor.selection||selectionKey(editor.selection)!==selectionKey(drag.current.selection)))cancel();},[editor.document,editor.disabled,editor.selection,editor.mode,editor.view]);
 function start(e:React.PointerEvent<SVGGElement>,s:EditorSelection,axis?:RoomDimensionAxis,focus=e.currentTarget){if(e.button!==0)return;e.preventDefault();e.stopPropagation();focus.focus({preventScroll:true});current.current.select(s);if(current.current.disabled||(current.current.mode==='dimensions'&&!axis))return;const start=point(e);drag.current={id:e.pointerId,selection:s,start,doc:current.current.document,mode:current.current.mode,view:current.current.view,axis,command:null};svg.current?.setPointerCapture(e.pointerId);}
 function move(e:React.PointerEvent){const moving=panning.current;if(moving){setPan([moving.origin[0]-(e.clientX-moving.x)*moving.units,moving.origin[1]-(e.clientY-moving.y)*moving.units]);return;}const a=drag.current;if(!a||a.id!==e.pointerId)return;const b=current.current;if(a.doc!==b.document){cancel();return;}const p=point(e);try{const command=a.axis ? planarRoomDimensionCommand(a.doc,a.selection,a.axis,p[0]-a.start[0],p[1]-a.start[1]):planarCommand(a.doc,a.selection,p[0]-a.start[0],p[1]-a.start[1],b.mode==='rotate'?(p[0]-a.start[0])*.2:undefined);a.command=command;b.previewChange(command);}catch(error){a.command=null;b.previewChange(null);b.error(error instanceof Error?error.message:'위치를 확인해 주세요.');}}
 function finish(e:React.PointerEvent){if(panning.current){panning.current=null;if(svg.current?.hasPointerCapture(e.pointerId))svg.current.releasePointerCapture(e.pointerId);return;}const a=drag.current;if(!a||a.id!==e.pointerId)return;drag.current=null;if(svg.current?.hasPointerCapture(a.id))svg.current.releasePointerCapture(a.id);const b=current.current;b.previewChange(null);if(a.command&&!b.disabled&&a.doc===b.document&&a.mode===b.mode&&a.view===b.view&&b.selection&&selectionKey(a.selection)===selectionKey(b.selection))b.commit(a.command);}
 const selectedRoom=editor.selection?.kind==='room'?document.rooms.find(r=>r.id===editor.selection?.id):undefined;
 const handles=selectedRoom ? (['width','depth'] as const).map(axis=>{const p=new Vector3(axis==='width'?selectedRoom.dimensions.width/2:0,0,axis==='depth'?selectedRoom.dimensions.depth/2:0).applyMatrix4(matrix(selectedRoom.transform));return {axis,x:p.x,z:p.z,label:axis==='width'?'가로':'깊이'};}):[];
 return <section className="studio-floorplan" aria-label="2D 평면도" lang="ko">
  <header><h3>2D 평면도</h3><div><button onClick={()=>setZoom(v=>Math.min(4,v*1.25))} aria-label="평면도 확대">＋</button><button onClick={()=>setZoom(v=>Math.max(.5,v/1.25))} aria-label="평면도 축소">−</button><button onClick={()=>{setFrame(bounds);setPan([0,0]);setZoom(1);}}>전체 보기</button></div></header>
  <p className="cms-note">번호나 작품 목록에서 작품을 선택하세요. 작품·공간을 드래그해 옮길 수 있어요. 이동은 기존 높이를 유지해요. 빈 곳이나 가운데 버튼으로 화면 이동, Esc로 조작 취소가 가능해요.</p>
  <svg ref={svg} viewBox={view} onPointerDown={e=>{if(e.button===1||(e.button===0&&e.target===svg.current)){e.preventDefault();const rect=svg.current!.getBoundingClientRect();panning.current={id:e.pointerId,x:e.clientX,y:e.clientY,units:frame.span/zoom/Math.min(rect.width,rect.height),origin:pan};svg.current?.setPointerCapture(e.pointerId);}}} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={()=>{if(drag.current||panning.current)cancel();}} aria-label="공간과 작품 평면도">
   {elements.map(item=>{const selected=editor.selection&&selectionKey(editor.selection)===selectionKey(item.s),key=selectionKey(item.s),number='number' in item&&typeof item.number==='number'?item.number:undefined;return <g key={key} ref={node=>{if(node)selectionNodes.current.set(key,node);else selectionNodes.current.delete(key);}} role="button" tabIndex={0} aria-label={`${number===undefined?'':number+'. '}${item.label} 평면도 선택`} aria-pressed={!!selected} data-selection={key} className={`floorplan-${item.s.kind}${selected?' selected':''}`} onPointerDown={e=>start(e,item.s)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();editor.select(item.s);}}}>
    {item.line?<polyline points={item.points} vectorEffect="non-scaling-stroke"/>:<polygon points={item.points} vectorEffect="non-scaling-stroke"/>}
    {number!==undefined&&<><title>{item.label}</title><circle cx={item.center.x} cy={item.center.z} r={ARTWORK_MARKER_RADIUS}/></>}
   </g>;})}
   {artworks.map(item=>{
    const badge=labels.positions.get(item.s.id);
    if(!badge)return null;
    const key=selectionKey(item.s),selected=editor.selection&&selectionKey(editor.selection)===key;
    return <g key={key} className={selected?'selected':undefined} aria-hidden="true"
     onPointerDown={e=>start(e,item.s,undefined,selectionNodes.current.get(key))}>
     <line className="floorplan-number-leader" x1={item.center.x} y1={item.center.z} x2={badge.x} y2={badge.z} vectorEffect="non-scaling-stroke"/>
     <circle className="floorplan-number" data-artwork-number={item.number} cx={badge.x} cy={badge.z} r={labels.radius} vectorEffect="non-scaling-stroke"/>
     <text className="floorplan-number-text" x={badge.x} y={badge.z} fontSize={labels.fontSize} textAnchor="middle" dominantBaseline="central">{item.number}</text>
    </g>;
   })}
   {editor.mode==='dimensions'&&!editor.disabled&&selectedRoom&&handles.map(handle=><g key={handle.axis} role="button" tabIndex={0} aria-label={`방 ${handle.label} 크기 조절`} data-dimension-handle={handle.axis} className="floorplan-dimension-handle" onPointerDown={e=>start(e,{kind:'room',id:selectedRoom.id},handle.axis)} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();try{editor.commit(roomDimensionCommand(editor.document,{kind:'room',id:selectedRoom.id},handle.axis,['ArrowRight','ArrowUp'].includes(e.key)?.1:-.1));}catch(error){editor.error(error instanceof Error?error.message:'크기를 확인해 주세요.');}}}>
    <circle cx={handle.x} cy={handle.z} r={frame.span/zoom/12} fill="transparent" stroke="none"/>
    <circle cx={handle.x} cy={handle.z} r={frame.span/zoom/50} vectorEffect="non-scaling-stroke"/>
    <text x={handle.x} y={handle.z-frame.span/zoom/32} fontSize={frame.span/zoom/25} textAnchor="middle">{handle.label}</text>
   </g>)}
  </svg>
  {artworks.length>0&&<details className="floorplan-artwork-list" onToggle={e=>setListOpen(e.currentTarget.open)}>
   <summary>작품 번호와 이름 ({artworks.length})</summary>
   {listOpen&&<ol>{artworks.map(item=><li key={item.s.id}>
    <button type="button" aria-pressed={editor.selection?.kind==='placement'&&editor.selection.id===item.s.id} onClick={()=>editor.select(item.s)}>{item.number}. {item.label}</button>
   </li>)}</ol>}
  </details>}
 </section>;
}
