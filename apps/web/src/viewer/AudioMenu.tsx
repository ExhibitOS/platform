// SPDX-License-Identifier: AGPL-3.0-or-later
import {useId,useState} from 'react';
import {AudioControls} from './AudioControls';
import type {AudioState} from './audio';
import {ViewerIcon,type ViewerIconName} from './ViewerIcon';

export function audioMenuStatus(state:AudioState|null|undefined):{label:string;icon:ViewerIconName}{
 if(!state?.enabled)return {label:'소리 사용 전',icon:'silent'};
 if(state.muted)return {label:'소리 꺼짐',icon:'silent'};
 if(state.volume===0)return {label:'음량 0',icon:'silent'};
 if(state.suspended||state.context!=='running')return {label:'소리 일시 정지',icon:'paused'};
 return {label:'소리 켜짐',icon:'speaker'};
}
export function AudioMenu({immersive,...props}:{immersive:boolean}&Parameters<typeof AudioControls>[0]){
 const id=useId(),[open,setOpen]=useState(false),status=audioMenuStatus(props.state);
 return <details name={immersive?'exhibitos-visitor-panel':undefined} data-visitor-panel={immersive?'':undefined} className="viewer-audio-menu" open={open} onToggle={event=>{if(event.target===event.currentTarget)setOpen(event.currentTarget.open);}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();event.currentTarget.open=false;event.currentTarget.querySelector('summary')?.focus({preventScroll:true});}}} onPointerDown={event=>event.stopPropagation()} onPointerUp={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()}>
  <summary aria-label={`소리 설정 · ${status.label}`} title={`소리 설정 · ${status.label}`} aria-expanded={open} aria-controls={id}>{immersive?<ViewerIcon name={open?'close':status.icon}/>: '소리'}</summary>
  <div id={id} className="viewer-audio-body"><AudioControls {...props}/></div>
 </details>;
}
