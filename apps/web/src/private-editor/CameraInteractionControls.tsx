// SPDX-License-Identifier: AGPL-3.0-or-later
import './CameraInteractionControls.css';

export type CameraInteractionMode='object'|'camera-rotate'|'camera-pan';
const choices:[CameraInteractionMode,string][]=[
 ['object','대상 편집'],
 ['camera-rotate','보기 회전'],
 ['camera-pan','보기 이동'],
];

/** The input owner supplies the mode; this control never changes the scene. */
export function CameraInteractionControls({mode,disabled,onModeChange}:{mode:CameraInteractionMode;disabled:boolean;onModeChange:(mode:CameraInteractionMode)=>void}){
 return <div className="private-camera-interaction" role="group" aria-label="대상 편집과 보기 조작">
  {choices.map(([value,label])=><button key={value} type="button" aria-pressed={mode===value} disabled={disabled} onClick={()=>onModeChange(value)}>{label}</button>)}
 </div>;
}
