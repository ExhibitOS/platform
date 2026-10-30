// SPDX-License-Identifier: AGPL-3.0-or-later
import {useEffect,useState,useMemo} from 'react';
import type {Exhibition} from '@exhibitos/spec';
import {lightAttachmentsFor,lightAttachmentPose,setLightDetails,setLightAttachment,lightDetailsFor,RoomEnvelopeError} from '@exhibitos/studio-contract';
import {newLight} from '../placement/model';
import {newDoor,applyGeometryCommand,createGeometryState,type GeometryCommand} from '../geometry/model';
import type {EditorSelection} from '../geometry/direct-edit';

export function RoomControls({document,roomId,disabled,execute,select,inspectCeiling,error,selectedSurfaceId,selectedOpeningId}:{document:Exhibition;roomId:string;disabled:boolean;execute:(command:GeometryCommand)=>void;select:(selection:EditorSelection)=>void;inspectCeiling:()=>void;error:(message:string)=>void;selectedSurfaceId?:string;selectedOpeningId?:string}){
 const room=document.rooms.find(r=>r.id===roomId)!,walls=useMemo(()=>document.surfaces.filter(s=>s.roomId===roomId&&s.type==='wall'),[document,roomId]),ceilings=document.surfaces.filter(s=>s.roomId===roomId&&s.type==='ceiling');
 const [wallId,setWallId]=useState(walls[1]?.id??walls[0]?.id??''),[lightId,setLightId]=useState('');
 const lights=useMemo(()=>document.lights.filter(l=>l.roomId===roomId&&['point','spot','area'].includes(l.type)),[document,roomId]),bindings=lightAttachmentsFor(document);
 useEffect(()=>{if(!walls.some(s=>s.id===wallId))setWallId(walls[1]?.id??walls[0]?.id??'');if(!lights.some(l=>l.id===lightId))setLightId(lights[0]?.id??'');},[walls,lights,wallId,lightId]);
 useEffect(()=>{if(selectedSurfaceId&&walls.some(s=>s.id===selectedSurfaceId))setWallId(selectedSurfaceId);},[selectedSurfaceId,walls]);
 const selectedOpening=document.openings.find(o=>o.id===selectedOpeningId),selectedLight=lights.find(l=>l.id===lightId),bound=bindings.find(b=>b.lightId===lightId),doors=document.openings.filter(o=>walls.some(s=>s.id===o.surfaceId));
 function addCeilingLight(){
  if(ceilings.length!==1)return;
  try{const light=newLight(roomId),binding={lightId:light.id,surfaceId:ceilings[0]!.id,anchor:[0,0] as [number,number],gap:.03};light.transform=lightAttachmentPose(ceilings[0]!,binding);
   let candidate=applyGeometryCommand(createGeometryState(document),{type:'add-light',light}).present;const {id,...value}=light;
   candidate=setLightDetails(candidate,id,value,{fixture:'disc',aim:{kind:'rotation'},range:12});candidate=setLightAttachment(candidate,id,binding);
   execute({type:'replace-architecture',candidate});setLightId(id);
  }catch(problem){error(problem instanceof RoomEnvelopeError?problem.message:'천장등의 위치와 부착 간격을 확인해 주세요. 이전 편집은 유지됩니다.');}
 }
 return <div className="private-room-controls">
  <h3>전시실 크기</h3><output aria-live="polite">가로 {room.dimensions.width.toFixed(1)} · 깊이 {room.dimensions.depth.toFixed(1)} · 높이 {room.dimensions.height.toFixed(1)} m</output>
  <div className="private-nudge">{([['가로 좁히기','width',-.5],['가로 넓히기','width',.5],['깊이 줄이기','depth',-.5],['깊이 늘리기','depth',.5],['천장 낮추기','height',-.5],['천장 높이기','height',.5]] as const).map(([label,axis,delta])=><button key={label} disabled={disabled} onClick={()=>execute({type:'resize-room-envelope',roomId,dimensions:{...room.dimensions,[axis]:room.dimensions[axis]+delta}})}>{label}</button>)}</div>
  <div className="private-selection-actions"><button disabled={disabled||ceilings.length!==1} onClick={inspectCeiling}>천장 보기</button>{ceilings.length===0&&<button disabled={disabled} onClick={()=>execute({type:'complete-room-ceiling',roomId})}>천장 추가</button>}</div>
  <details><summary>공간 프리셋</summary><button disabled={disabled} onClick={()=>execute({type:'resize-room-envelope',roomId,dimensions:{width:8,height:3.2,depth:6}})}>작은 전시실</button><button disabled={disabled} onClick={()=>execute({type:'resize-room-envelope',roomId,dimensions:{width:8,height:4.2,depth:6}})}>높은 전시실</button><p>작품과 바닥의 물체는 유지해요. 범위를 벗어나면 변경하지 않고 조절할 대상을 알려드려요.</p></details>
  <h3>천장 조명</h3><button disabled={disabled||ceilings.length!==1} onClick={addCeilingLight}>천장등 추가</button>
  {lights.length>0&&<><label>조명 선택<select aria-label="조명 선택" value={lightId} disabled={disabled} onChange={e=>setLightId(e.target.value)}>{lights.map((l,i)=><option key={l.id} value={l.id}>조명 {i+1} · {lightDetailsFor(document).find(b=>b.lightId===l.id)?.fixture==='disc'?'원형 등':l.type==='spot'?'스포트라이트':l.type==='area'?'면 조명':'점 조명'}</option>)}</select></label><p>{bound?`선택한 ${document.surfaces.find(s=>s.id===bound.surfaceId)?.type==='ceiling'?'천장':'벽'}에 부착되어 함께 움직여요.`:'자유 배치 조명이에요.'}</p><div className="private-selection-actions"><button disabled={disabled||!selectedLight||ceilings.length!==1} onClick={()=>execute({type:'set-light-attachment',lightId,attachment:{surfaceId:ceilings[0]!.id,anchor:[0,0],gap:.2}})}>천장에 부착</button><button disabled={disabled||!bound} onClick={()=>execute({type:'set-light-attachment',lightId,attachment:null})}>부착 해제</button><button disabled={disabled||!selectedLight} onClick={()=>execute({type:'remove-light',id:lightId})}>조명 삭제</button></div></>}
  {selectedOpening&&<section aria-label="선택한 개구부 크기"><h3>{selectedOpening.type==='door'?'문':'창문'} 크기</h3><output>너비 {selectedOpening.dimensions.width.toFixed(1)} · 높이 {selectedOpening.dimensions.height.toFixed(1)} m</output><div className="private-nudge">{([['너비 줄이기','width',-.1],['너비 늘리기','width',.1],['높이 줄이기','height',-.1],['높이 늘리기','height',.1]] as const).map(([label,axis,delta])=><button key={label} disabled={disabled} onClick={()=>{const {id,...opening}=selectedOpening;execute({type:'set-opening',id,opening:{...opening,dimensions:{...opening.dimensions,[axis]:opening.dimensions[axis]+delta},offset:[opening.offset[0],opening.offset[1]+(axis==='height'?delta/2:0)]}});}}>{label}</button>)}</div>{selectedOpening.connectsToOpeningId&&<button disabled={disabled} onClick={()=>execute({type:'disconnect-door',id:selectedOpening.id})}>문 연결 해제</button>}</section>}
  <details><summary>출입구</summary><label>문을 만들 벽<select aria-label="문을 만들 벽" disabled={disabled} value={wallId} onChange={e=>{setWallId(e.target.value);select({kind:'surface',id:e.target.value});}}>{walls.map((wall,i)=><option key={wall.id} value={wall.id}>벽 {i+1}</option>)}</select></label><button disabled={disabled||!wallId} onClick={()=>{const wall=walls.find(s=>s.id===wallId);if(!wall)return;execute({type:'add-opening',opening:newDoor(wall.id,{width:1.2,height:2.2},[0,1.1-wall.transform.position[1]])});}}>문 만들기</button>{doors.map((door,i)=><div key={door.id} className="private-selection-actions"><button disabled={disabled} onClick={()=>select({kind:'opening',id:door.id})}>{door.type==='door'?'문':'창문'} {i+1} 선택</button><button disabled={disabled} onClick={()=>execute({type:'remove-opening',id:door.id})}>{door.type==='door'?'문':'창문'} {i+1} 삭제</button></div>)}</details>
 </div>;
}
