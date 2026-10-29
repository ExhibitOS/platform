// SPDX-License-Identifier: AGPL-3.0-or-later
import {useCallback,useEffect,useId,useRef,useState,type PointerEvent} from 'react';
import {createJoystickGesture,type JoystickActions} from './walking-joystick';
import './walking-joystick.css';

export function WalkingJoystick({available,paused,resumable=false,actions}:{
 available:boolean;paused:boolean;resumable?:boolean;actions:JoystickActions|null;
}){
 const helpId=useId(),[thumb,setThumb]=useState({x:0,y:0}),gesture=useRef<ReturnType<typeof createJoystickGesture>|null>(null);
 const surface=useRef<HTMLButtonElement>(null);
 if(!gesture.current)gesture.current=createJoystickGesture((x,y)=>setThumb({x,y}));
 const clear=useCallback(()=>{
  const id=gesture.current?.active();gesture.current?.clear();
  if(id!==undefined&&surface.current?.hasPointerCapture(id))surface.current.releasePointerCapture(id);
 },[]);
 useEffect(()=>{if(!available||paused)clear();},[available,paused,clear]);
 useEffect(()=>{
  const clearGesture=clear;
  const visibility=()=>{if(document.hidden)clearGesture();};
  window.addEventListener('blur',clearGesture);document.addEventListener('visibilitychange',visibility);
  return()=>{clearGesture();window.removeEventListener('blur',clearGesture);document.removeEventListener('visibilitychange',visibility);};
 },[actions,clear]);
 const own=(event:PointerEvent<HTMLButtonElement>)=>{event.preventDefault();event.stopPropagation();};
 const disabled=!available||(paused&&!resumable)||!actions;
 return <div className="viewer-walking-joystick">
  <button ref={surface} type="button" className="walking-joystick-surface" aria-label="이동 조이스틱" aria-describedby={helpId} disabled={disabled}
   onPointerDown={event=>{
    own(event);
    if(disabled||!actions||gesture.current?.active()!==undefined||(event.pointerType==='mouse'&&event.button!==0))return;
    if(paused&&(event.isPrimary===false||!actions.resumeInput?.()))return;
    try{event.currentTarget.setPointerCapture(event.pointerId);}catch{return;}
    if(!gesture.current?.begin(event.pointerId,event.clientX,event.clientY,event.currentTarget.getBoundingClientRect(),actions)&&event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
   }}
   onPointerMove={event=>{own(event);gesture.current?.move(event.pointerId,event.clientX,event.clientY);}}
   onPointerUp={event=>{own(event);gesture.current?.end(event.pointerId);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
   onPointerCancel={event=>{own(event);gesture.current?.end(event.pointerId);}}
   onLostPointerCapture={event=>gesture.current?.end(event.pointerId)}
   onBlur={clear}
   onClick={event=>{event.preventDefault();event.stopPropagation();}}
   onContextMenu={event=>{event.preventDefault();event.stopPropagation();}}
  >
   <span className="walking-joystick-track" aria-hidden="true"/>
   <span className="walking-joystick-thumb" aria-hidden="true" style={{transform:`translate(${thumb.x}px,${thumb.y}px)`}}/>
  </button>
  <span id={helpId} className="walking-joystick-help">원을 끌어 이동하고 손을 떼면 멈춰요. 다른 손가락으로 3D 화면을 끌어 둘러보세요. 키보드는 전시 화면에서 W/A/S/D 또는 방향키로 조작할 수 있어요.</span>
 </div>;
}
