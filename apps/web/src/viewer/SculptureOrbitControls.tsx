// SPDX-License-Identifier: AGPL-3.0-or-later
import {useEffect,useId,useRef,type PointerEvent} from 'react';
import type {SculptureOrbitState,SculptureOrbitActions} from './sculpture-orbit';
import './sculpture-orbit-controls.css';

// The camera owner supplies these states/actions; the UI owns no orbit timer.
export interface SculptureOrbitControlsProps {
 state:SculptureOrbitState;
 actions:SculptureOrbitActions;
}
type Press={id:number;direction:-1|1;element:HTMLButtonElement;actions:SculptureOrbitControlsProps['actions']};
function dropCapture(press:Press){try{if(press.element.hasPointerCapture(press.id))press.element.releasePointerCapture(press.id);}catch{/* The browser may already have canceled capture. */}}

export function SculptureOrbitControls({state,actions}:SculptureOrbitControlsProps){
 const helpId=useId(),pressed=useRef<Press|null>(null),latest=useRef(actions);latest.current=actions;
 const release=(id:number,activate:boolean)=>{
  const current=pressed.current;if(!current||current.id!==id)return;
  pressed.current=null;current.actions.release(id,activate);dropCapture(current);
 };
 const stop=()=>{const current=pressed.current;pressed.current=null;if(current)dropCapture(current);(current?.actions??latest.current).stop();};
 useEffect(()=>{
  const owner=actions;
  return()=>{const current=pressed.current;pressed.current=null;if(current){dropCapture(current);current.actions.stop();}if(!current||current.actions!==owner)owner.stop();};
 },[state.placementId,actions]);
 useEffect(()=>{
  const current=pressed.current;
  if(current&&(!state.available||current.direction===-1&&!state.canLeft||current.direction===1&&!state.canRight)){
   pressed.current=null;current.actions.release(current.id,false);dropCapture(current);
  }
 },[state.available,state.canLeft,state.canRight]);
 const press=(event:PointerEvent<HTMLButtonElement>,direction:-1|1)=>{
  if(event.button!==0||!event.isPrimary||!state.available||!(direction===-1?state.canLeft:state.canRight))return;
  if(pressed.current)stop();
  const current={id:event.pointerId,direction,element:event.currentTarget,actions};pressed.current=current;
  actions.press(direction,event.pointerId);
  try{event.currentTarget.setPointerCapture(event.pointerId);}catch{release(event.pointerId,false);}
 };
 const move=(event:PointerEvent<HTMLButtonElement>)=>{
  if(pressed.current?.id!==event.pointerId)return;
  const box=event.currentTarget.getBoundingClientRect();
  if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)release(event.pointerId,false);
 };
 const button=(direction:-1|1,label:string)=><button type="button" disabled={!state.available||!(direction===-1?state.canLeft:state.canRight)}
  onPointerDown={event=>press(event,direction)} onPointerMove={move}
  onPointerUp={event=>release(event.pointerId,true)} onPointerCancel={event=>release(event.pointerId,false)}
  onLostPointerCapture={event=>release(event.pointerId,false)} onPointerLeave={event=>release(event.pointerId,false)}
  onKeyDown={event=>{if(event.repeat&&(event.key==='Enter'||event.key===' '))event.preventDefault();}}
  onClick={event=>{if(event.detail===0)actions.step(direction);}}>{label}</button>;
 return <section className="viewer-sculpture-orbit" aria-label="조각 둘러보기" aria-describedby={helpId} onBlur={event=>{
  if(!(event.relatedTarget instanceof Node&&event.currentTarget.contains(event.relatedTarget)))stop();
 }}>
  <div className="sculpture-orbit-buttons">{button(-1,'왼쪽에서 보기')}{button(1,'오른쪽에서 보기')}</div>
  <p id={helpId}>{state.reducedMotion?'한 단계씩 시점을 바꿔 감상해요.':'짧게 누르면 한 단계, 누르고 있으면 천천히 둘러봐요.'}</p>
  {state.message&&<p role="status">{state.message}</p>}
 </section>;
}
