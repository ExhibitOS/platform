// SPDX-License-Identifier: AGPL-3.0-or-later
import {createRoot} from 'react-dom/client';
import {useEffect,useMemo,useState} from 'react';
import {GeometryPreview} from './GeometryPreview';
import {StudioFloorPlan} from './StudioFloorPlan';
import {freezeCanonical,materialFor} from '@exhibitos/studio-contract';
import type {Session} from './cms-client';
import {selectedItem,type EditorBridge} from './geometry/direct-edit';
import {checkedFrame,geometryProposal,nativeGeometryAction,nativePlanProposal,nativePlanPreviewCurrent,NATIVE_VIEWPORT_PRESENTATIONS,type NativePlanPreview,type NativeViewportFrame,type NativeGeometryAction} from './native-viewport-protocol';
import {nativeInstallationAction,type NativeInstallationAction} from './native-installation-action';
import './native-viewport.css';
declare global {interface Window {exhibitosViewport?:{accept:(v:unknown)=>Promise<{accepted:true;presentations:typeof NATIVE_VIEWPORT_PRESENTATIONS}>;action:(v:NativeGeometryAction|NativeInstallationAction)=>unknown};webkit?:{messageHandlers?:{exhibitosViewport?:{postMessage:(v:unknown)=>void}}}}}
let current:NativeViewportFrame|undefined;
let currentSession:Session|undefined;
let receive:((frame:NativeViewportFrame,session:Session)=>void)|undefined;
function post(frame:NativeViewportFrame,type:string,body:unknown){window.webkit?.messageHandlers?.exhibitosViewport?.postMessage({version:1,epoch:frame.epoch,sequence:frame.sequence,type,body});}
window.exhibitosViewport={
 accept:async value=>{
  const frame=checkedFrame(value,current);
  const response=await fetch('/api/v1/auth/session',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('VIEWPORT_SESSION_REQUIRED');
  const session=await response.json() as Session;
  if(session.tenantId!==frame.tenantId||session.userId!==frame.principalId||!['admin','artist','curator'].includes(session.role))throw Error('VIEWPORT_SCOPE_CHANGED');
  // An earlier asynchronous accept may finish after a newer one.
  if(current&&frame.sequence<=current.sequence)throw Error('VIEWPORT_FRAME_STALE');
  if(current&&freezeCanonical(current.draft)===freezeCanonical(frame.draft))frame.draft=current.draft;
  if(currentSession&&currentSession.tenantId===session.tenantId&&currentSession.userId===session.userId&&currentSession.csrfToken===session.csrfToken&&currentSession.expiresAt===session.expiresAt)receive?.(frame,currentSession);
  else {currentSession=session;receive?.(frame,session);}
  current=frame;return {accepted:true,presentations:NATIVE_VIEWPORT_PRESENTATIONS};
 },
 action:action=>{if(!current)throw Error('VIEWPORT_NOT_READY');return action?.type==='installation-command'?nativeInstallationAction(current,action):nativeGeometryAction(current,action);},
};
function Viewport(){
 const [state,setState]=useState<{frame:NativeViewportFrame;session:Session}>();
 const [planPreview,setPlanPreview]=useState<NativePlanPreview|null>(null);
 const document=state?.frame.draft.candidate;
 // GeometryPreview owns an expensive renderer effect keyed by this function.
 // Camera/selection frames must not recreate the scene or overwrite the camera.
 const appearance=useMemo(()=>(id:string)=>{const m=document?materialFor(document,id):{color:'#ffffff',roughness:1,metalness:0};const hex=m.color.slice(1);return {baseColor:[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)/255) as [number,number,number],roughness:m.roughness,metalness:m.metalness};},[document]);
 useEffect(()=>{receive=(frame,session)=>setState({frame,session});if(current&&currentSession)setState({frame:current,session:currentSession});return()=>{receive=undefined;current=undefined;currentSession=undefined;};},[]);
 useEffect(()=>{if(planPreview&&state&&!nativePlanPreviewCurrent(planPreview,state.frame))setPlanPreview(null);},[state,planPreview]);
 if(!state)return <p role="status">네이티브 전시를 기다리고 있습니다.</p>;
 const {frame,session}=state;
 const plan=frame.presentation==='plan';
 const editing:EditorBridge={document:frame.draft.candidate,selection:frame.selection,mode:frame.mode,view:frame.view,disabled:frame.disabled||plan,preview:null,
  select:selection=>{if(!frame.disabled)post(frame,'selection',selection);},previewChange:()=>{},
  commit:command=>{try{post(frame,'candidate',geometryProposal(frame,command));}catch{post(frame,'error',{code:'VIEWPORT_COMMAND_REJECTED'});}},
  error:()=>post(frame,'error',{code:'VIEWPORT_EDIT_REJECTED'}),};
 const shownPreview=planPreview&&nativePlanPreviewCurrent(planPreview,frame)?planPreview:null;
 const planEditor:EditorBridge={...editing,view:frame.view+':'+(plan?'plan':'3d'),disabled:frame.disabled||!plan,preview:shownPreview?.command??null,
  select:selection=>{if(current===frame&&!frame.disabled&&plan)post(frame,'selection',selection);},
  previewChange:command=>{
   if(!command){setPlanPreview(null);return;}
   try{if(current!==frame)throw Error('VIEWPORT_FRAME_STALE');const candidate=nativePlanProposal(frame,command);setPlanPreview({frame,command,candidate});}
   catch{setPlanPreview(null);post(frame,'error',{code:'VIEWPORT_COMMAND_REJECTED'});}
  },
  commit:command=>{
   setPlanPreview(null);
   try{if(current!==frame)throw Error('VIEWPORT_FRAME_STALE');const candidate=nativePlanProposal(frame,command);
    if(frame.selection&&JSON.stringify(selectedItem(frame.draft.candidate,frame.selection))!==JSON.stringify(selectedItem(candidate,frame.selection)))post(frame,'candidate',candidate);
   }catch{post(frame,'error',{code:'VIEWPORT_COMMAND_REJECTED'});}
  },
 };
 return <><div className="native-viewport-surface" hidden={plan} inert={plan}>
  <GeometryPreview document={frame.draft.candidate} selection={frame.selection} editing={editing} session={session} cameraRequest={{kind:frame.view,sequence:frame.cameraSequence}} spaceTransparency={frame.transparent}
   appearance={appearance} onRenderState={report=>post(frame,'status',report)}/>
 </div><div className="native-viewport-surface native-viewport-plan" hidden={!plan} inert={!plan}>
  <StudioFloorPlan document={shownPreview?.candidate??frame.draft.candidate} editor={planEditor}/>
 </div></>;
}
const root=document.getElementById('root');if(!root)throw Error('VIEWPORT_ROOT_REQUIRED');createRoot(root).render(<Viewport/>);
