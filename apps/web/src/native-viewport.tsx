import {NATIVE_ARCHITECTURAL_FINISH_CAPABILITY,checkedArchitecturalFinishRequest,nativeArchitecturalFinishCandidate,type ArchitecturalFinishRequest} from './native-architectural-finishes';
import {NATIVE_PLAQUE_INSPECTOR_CAPABILITY,checkedPlaqueInspectorRequest,nativePlaqueInspectorCandidate,type PlaqueInspectorRequest} from './native-plaque-inspector';
// SPDX-License-Identifier: AGPL-3.0-or-later
import {createRoot} from 'react-dom/client';
import {useEffect,useMemo,useState} from 'react';
import {GeometryPreview,type EntranceScenePreview} from './GeometryPreview';
import {NativeEntranceHost} from './NativeEntranceHost';
import {NativeEntrancePreview} from './native-entrance-preview';
import {NATIVE_ENTRANCE_PREVIEW_CAPABILITY,type EntrancePreviewReply} from './native-entrance-preview-protocol';
import type {EntranceStage} from './entrance-entry';
import {waitForCoverLayout} from './cover-ready';
import {StudioFloorPlan} from './StudioFloorPlan';
import {freezeCanonical,materialFor} from '@exhibitos/studio-contract';
import type {Session} from './cms-client';
import {selectedItem,type EditorBridge} from './geometry/direct-edit';
import {checkedFrame,geometryProposal,nativeGeometryAction,nativePlanProposal,nativePlanPreviewCurrent,NATIVE_VIEWPORT_PRESENTATIONS,type NativePlanPreview,type NativeViewportFrame,type NativeGeometryAction} from './native-viewport-protocol';
import {nativeInstallationAction,type NativeInstallationAction} from './native-installation-action';
import {checkedCatalogRequest,catalogBinding,SerialThumbnailQueue,NATIVE_CATALOG_CAPABILITIES,type ThumbnailRequest,type FindRequest,type CatalogBinding} from './native-catalog-protocol';
import {produceArtworkThumbnail} from './native-artwork-thumbnail';
import {NativePlacement} from './native-placement';
import {NATIVE_PLACEMENT_CAPABILITY,placementFrameCompatible,type PlacementRequest} from './native-placement-protocol';
import {installNativePlacementPreview} from './native-placement-renderer';
import type {PlacementPreviewInstaller} from './geometry/placement-preview';
import {NATIVE_LIGHT_INSPECTOR_CAPABILITY,checkedLightInspectorRequest,nativeLightInspectorCandidate,type LightInspectorRequest} from './native-light-inspector';
import {NATIVE_BENCH_INSPECTOR_CAPABILITY,checkedBenchInspectorRequest,nativeBenchInspectorCandidate,type BenchInspectorRequest} from './native-bench-inspector';
import {NATIVE_LIGHT_DETAILS_CAPABILITY,checkedLightDetailsRequest,nativeLightDetailsCandidate,type LightDetailsRequest} from './native-light-details';
import {NATIVE_SPACE_SETTINGS_CAPABILITY,checkedSpaceSettingsRequest,nativeSpaceSettingsCandidate,type SpaceSettingsRequest} from './native-space-settings';
import './native-viewport.css';
const NATIVE_CAPABILITIES=[...NATIVE_CATALOG_CAPABILITIES,NATIVE_PLACEMENT_CAPABILITY,NATIVE_LIGHT_INSPECTOR_CAPABILITY,NATIVE_BENCH_INSPECTOR_CAPABILITY,NATIVE_LIGHT_DETAILS_CAPABILITY,NATIVE_PLAQUE_INSPECTOR_CAPABILITY,NATIVE_ARCHITECTURAL_FINISH_CAPABILITY,NATIVE_SPACE_SETTINGS_CAPABILITY,NATIVE_ENTRANCE_PREVIEW_CAPABILITY] as const;
declare global {interface Window {exhibitosViewport?:{
 accept:(v:unknown)=>Promise<{accepted:true;presentations:typeof NATIVE_VIEWPORT_PRESENTATIONS;capabilities:typeof NATIVE_CAPABILITIES}>;
 entrancePreview:(v:unknown)=>Promise<EntrancePreviewReply>;
 entrancePreviewState:(v:unknown)=>Promise<EntrancePreviewReply>;
 spaceSettings:(v:SpaceSettingsRequest)=>Promise<ReturnType<typeof catalogBinding>&{candidate:NativeViewportFrame['draft']['candidate']}>;
 action:(v:NativeGeometryAction|NativeInstallationAction)=>unknown;
 lightDetails:(v:LightDetailsRequest)=>Promise<ReturnType<typeof catalogBinding>&{lightId:string;candidate:NativeViewportFrame['draft']['candidate']}>;
 architecturalFinishes:(v:ArchitecturalFinishRequest)=>Promise<ReturnType<typeof catalogBinding>&{surfaceId:string;candidate:NativeViewportFrame['draft']['candidate']}>;
 plaqueInspector:(v:PlaqueInspectorRequest)=>Promise<ReturnType<typeof catalogBinding>&{plaqueId:string;candidate:NativeViewportFrame['draft']['candidate']}>;
 benchInspector:(v:BenchInspectorRequest)=>Promise<ReturnType<typeof catalogBinding>&{benchId:string;candidate:NativeViewportFrame['draft']['candidate']}>;
 lightInspector:(v:LightInspectorRequest)=>Promise<ReturnType<typeof catalogBinding>&{lightId:string;candidate:NativeViewportFrame['draft']['candidate']}>;
 placement:(v:PlacementRequest)=>ReturnType<NativePlacement['request']>;
 thumbnail:(v:ThumbnailRequest)=>Promise<ReturnType<typeof catalogBinding>&{artworkId:string;revision:number;pngBase64:string;width:number;height:number}>;
 findSelection:(v:FindRequest)=>Promise<ReturnType<typeof catalogBinding>&{selection:FindRequest['selection'];accepted:true}>;
};webkit?:{messageHandlers?:{exhibitosViewport?:{postMessage:(v:unknown)=>void}}}}}

let current:NativeViewportFrame|undefined;
let currentSession:Session|undefined;
let receive:((frame:NativeViewportFrame,session:Session)=>void)|undefined;
let findCurrentSelection:{frame:NativeViewportFrame;action:(id:string)=>boolean}|null=null;
const thumbnailQueue=new SerialThumbnailQueue(),catalogRequests=new Set<AbortController>(),seenCatalogRequests=new Set<string>();
async function catalogSession(frame:NativeViewportFrame,signal:AbortSignal){
 const response=await fetch('/api/v1/auth/session',{credentials:'same-origin',cache:'no-store',redirect:'error',signal});
 if(!response.ok)throw Error('VIEWPORT_SESSION_REQUIRED');const session=await response.json() as Session;
 if(current!==frame||session.tenantId!==frame.tenantId||session.userId!==frame.principalId||!['admin','artist','curator'].includes(session.role))throw Error('VIEWPORT_SCOPE_CHANGED');signal.throwIfAborted();
}
function beginCatalogRequest(request:CatalogBinding){
 if(seenCatalogRequests.has(request.requestId))throw Error('CATALOG_REQUEST_REPLAY');
 seenCatalogRequests.add(request.requestId);if(seenCatalogRequests.size>128)seenCatalogRequests.delete(seenCatalogRequests.values().next().value!);
 const abort=new AbortController();catalogRequests.add(abort);return {abort,signal:AbortSignal.any([abort.signal,AbortSignal.timeout(10000)])};
}
function post(frame:NativeViewportFrame,type:string,body:unknown){window.webkit?.messageHandlers?.exhibitosViewport?.postMessage({version:1,epoch:frame.epoch,sequence:frame.sequence,type,body});}
let viewportChanged:(()=>void)|undefined;
let placementRendererReady=false;
let lightPending=false;
let benchPending=false;
let plaquePending=false;
let architecturalPending=false;
let lightDetailsPending=false;
let spaceSettingsPending=false;
let entranceScene:EntranceScenePreview|undefined;
const entrancePreview=new NativeEntrancePreview({frame:()=>current,authenticate:catalogSession,scene:()=>entranceScene,
 idle:()=>!placement.active&&!lightPending&&!benchPending&&!plaquePending&&!architecturalPending&&!lightDetailsPending&&!spaceSettingsPending&&catalogRequests.size===0,
 notify:()=>viewportChanged?.(),editorReady:async signal=>{
  const root=document.getElementById('root');if(!root)throw Error('ENTRANCE_PREVIEW_NOT_READY');await waitForCoverLayout(root,signal);signal.throwIfAborted();
  const box=root.getBoundingClientRect();return {mode:'editor',imageStatus:'absent',viewport:{width:innerWidth,height:innerHeight},snapshotRect:{x:box.x,y:box.y,width:box.width,height:box.height}};
 },
});
const requireEntranceIdle=()=>{if(entrancePreview.active)throw Error('ENTRANCE_PREVIEW_ACTIVE');};
const placement=new NativePlacement({frame:()=>current,notify:()=>viewportChanged?.(),
 authenticate:async(frame,signal)=>{
  const response=await fetch('/api/v1/auth/session',{credentials:'same-origin',cache:'no-store',redirect:'error',signal});
  if(!response.ok)throw Error('VIEWPORT_SESSION_REQUIRED');const session=await response.json() as Session;
  if(!current||!placementFrameCompatible(frame,current)||session.tenantId!==frame.tenantId||session.userId!==frame.principalId||!['admin','artist','curator'].includes(session.role))throw Error('VIEWPORT_SCOPE_CHANGED');signal.throwIfAborted();
 },target:(frame,body)=>post(frame,'placement-target',body),cancelled:(frame,body)=>post(frame,'placement-cancel',body),
});
const placementInstaller:PlacementPreviewInstaller=context=>{
 const preview=installNativePlacementPreview(placement,context);placementRendererReady=true;
 return {sync:preview.sync,dispose:()=>{placementRendererReady=false;preview.dispose();}};
};
window.addEventListener('pagehide',()=>placement.cancel('3D 미리보기를 닫아 배치를 취소했어요.'));
window.addEventListener('pagehide',()=>entrancePreview.invalidate());
window.addEventListener('exhibitos-auth-changed',()=>entrancePreview.invalidate());
window.exhibitosViewport={
 entrancePreview:value=>entrancePreview.request(value),
 entrancePreviewState:value=>entrancePreview.state(value),
 accept:async value=>{
  const frame=checkedFrame(value,current);
  const response=await fetch('/api/v1/auth/session',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('VIEWPORT_SESSION_REQUIRED');
  const session=await response.json() as Session;
  if(session.tenantId!==frame.tenantId||session.userId!==frame.principalId||!['admin','artist','curator'].includes(session.role))throw Error('VIEWPORT_SCOPE_CHANGED');
  // An earlier asynchronous accept may finish after a newer one.
  if(current&&frame.sequence<=current.sequence)throw Error('VIEWPORT_FRAME_STALE');
  if(current&&freezeCanonical(current.draft)===freezeCanonical(frame.draft))frame.draft=current.draft;
  entrancePreview.invalidate();current=frame;placement.rebind(frame);
  if(currentSession&&currentSession.tenantId===session.tenantId&&currentSession.userId===session.userId&&currentSession.csrfToken===session.csrfToken&&currentSession.expiresAt===session.expiresAt)receive?.(frame,currentSession);
  else {currentSession=session;receive?.(frame,session);}
  for(const abort of catalogRequests)abort.abort();catalogRequests.clear();seenCatalogRequests.clear();
  return {accepted:true,presentations:NATIVE_VIEWPORT_PRESENTATIONS,capabilities:NATIVE_CAPABILITIES};
 },
 placement:value=>{requireEntranceIdle();if(value?.phase==='begin'&&architecturalPending)throw Error('ARCHITECTURAL_FINISH_INTENT_ACTIVE');if(value?.phase==='begin'&&plaquePending)throw Error('PLAQUE_INSPECTOR_INTENT_ACTIVE');if(value?.phase==='begin'&&spaceSettingsPending)throw Error('SPACE_SETTINGS_INTENT_ACTIVE');if(value?.phase==='begin'&&lightDetailsPending)throw Error('LIGHT_DETAILS_INTENT_ACTIVE');if(value?.phase==='begin'&&benchPending)throw Error('BENCH_INSPECTOR_INTENT_ACTIVE');if(value?.phase==='begin'&&lightPending)throw Error('LIGHT_INSPECTOR_INTENT_ACTIVE');if(value?.phase==='begin'&&!placementRendererReady)throw Error('PLACEMENT_RENDERER_NOT_READY');return placement.request(value);},
 spaceSettings:async value=>{
  requireEntranceIdle();
  if(spaceSettingsPending)throw Error('SPACE_SETTINGS_INTENT_ACTIVE');
  if(architecturalPending)throw Error('ARCHITECTURAL_FINISH_INTENT_ACTIVE');
  if(plaquePending)throw Error('PLAQUE_INSPECTOR_INTENT_ACTIVE');
  if(lightDetailsPending)throw Error('LIGHT_DETAILS_INTENT_ACTIVE');
  if(benchPending)throw Error('BENCH_INSPECTOR_INTENT_ACTIVE');
  if(lightPending)throw Error('LIGHT_INSPECTOR_INTENT_ACTIVE');
  if(placement.active)throw Error('PLACEMENT_INTENT_ACTIVE');
  const frame=current,request=checkedSpaceSettingsRequest(value,frame),{abort,signal}=beginCatalogRequest(request);spaceSettingsPending=true;viewportChanged?.();
  try{await catalogSession(frame!,signal);const candidate=nativeSpaceSettingsCandidate(frame!,request);await catalogSession(frame!,signal);return {...catalogBinding(request),candidate};}
  finally{spaceSettingsPending=false;viewportChanged?.();catalogRequests.delete(abort);abort.abort();}
 },
 lightDetails:async value=>{
  requireEntranceIdle();
  if(architecturalPending)throw Error('ARCHITECTURAL_FINISH_INTENT_ACTIVE');
  if(plaquePending)throw Error('PLAQUE_INSPECTOR_INTENT_ACTIVE');
  if(placement.active)throw Error('PLACEMENT_INTENT_ACTIVE');
  if(lightPending)throw Error('LIGHT_INSPECTOR_INTENT_ACTIVE');
  if(benchPending)throw Error('BENCH_INSPECTOR_INTENT_ACTIVE');
  if(spaceSettingsPending)throw Error('SPACE_SETTINGS_INTENT_ACTIVE');if(lightDetailsPending)throw Error('LIGHT_DETAILS_INTENT_ACTIVE');
  const frame=current,request=checkedLightDetailsRequest(value,frame),{abort,signal}=beginCatalogRequest(request);lightDetailsPending=true;viewportChanged?.();
  try{await catalogSession(frame!,signal);const candidate=nativeLightDetailsCandidate(frame!,request);await catalogSession(frame!,signal);return {...catalogBinding(request),lightId:request.lightId,candidate};}
  finally{lightDetailsPending=false;viewportChanged?.();catalogRequests.delete(abort);abort.abort();}
 },
 architecturalFinishes:async value=>{
  requireEntranceIdle();
  if(architecturalPending)throw Error('ARCHITECTURAL_FINISH_INTENT_ACTIVE');
  if(plaquePending)throw Error('PLAQUE_INSPECTOR_INTENT_ACTIVE');
  if(spaceSettingsPending)throw Error('SPACE_SETTINGS_INTENT_ACTIVE');if(lightDetailsPending)throw Error('LIGHT_DETAILS_INTENT_ACTIVE');
  if(benchPending)throw Error('BENCH_INSPECTOR_INTENT_ACTIVE');
  if(placement.active)throw Error('PLACEMENT_INTENT_ACTIVE');
  if(lightPending)throw Error('LIGHT_INSPECTOR_INTENT_ACTIVE');
  const frame=current,request=checkedArchitecturalFinishRequest(value,frame),{abort,signal}=beginCatalogRequest(request);architecturalPending=true;viewportChanged?.();
  try{await catalogSession(frame!,signal);const candidate=nativeArchitecturalFinishCandidate(frame!,request);await catalogSession(frame!,signal);return {...catalogBinding(request),surfaceId:request.type==='remove-wall-finish'?request.surfaceId:request.wall.surfaceId,candidate};}
  finally{architecturalPending=false;viewportChanged?.();catalogRequests.delete(abort);abort.abort();}
 },
 plaqueInspector:async value=>{
  requireEntranceIdle();
  if(architecturalPending)throw Error('ARCHITECTURAL_FINISH_INTENT_ACTIVE');
  if(plaquePending)throw Error('PLAQUE_INSPECTOR_INTENT_ACTIVE');
  if(spaceSettingsPending)throw Error('SPACE_SETTINGS_INTENT_ACTIVE');if(lightDetailsPending)throw Error('LIGHT_DETAILS_INTENT_ACTIVE');
  if(benchPending)throw Error('BENCH_INSPECTOR_INTENT_ACTIVE');
  if(placement.active)throw Error('PLACEMENT_INTENT_ACTIVE');
  if(lightPending)throw Error('LIGHT_INSPECTOR_INTENT_ACTIVE');
  const frame=current,request=checkedPlaqueInspectorRequest(value,frame),{abort,signal}=beginCatalogRequest(request);plaquePending=true;viewportChanged?.();
  try{await catalogSession(frame!,signal);const candidate=nativePlaqueInspectorCandidate(frame!,request);await catalogSession(frame!,signal);return {...catalogBinding(request),plaqueId:request.type==='remove-plaque'?request.plaqueId:request.plaque.id,candidate};}
  finally{plaquePending=false;viewportChanged?.();catalogRequests.delete(abort);abort.abort();}
 },
 benchInspector:async value=>{
  requireEntranceIdle();
  if(architecturalPending)throw Error('ARCHITECTURAL_FINISH_INTENT_ACTIVE');
  if(plaquePending)throw Error('PLAQUE_INSPECTOR_INTENT_ACTIVE');
  if(spaceSettingsPending)throw Error('SPACE_SETTINGS_INTENT_ACTIVE');if(lightDetailsPending)throw Error('LIGHT_DETAILS_INTENT_ACTIVE');
  if(placement.active)throw Error('PLACEMENT_INTENT_ACTIVE');
  if(lightPending)throw Error('LIGHT_INSPECTOR_INTENT_ACTIVE');
  if(benchPending)throw Error('BENCH_INSPECTOR_INTENT_ACTIVE');
  const frame=current,request=checkedBenchInspectorRequest(value,frame),{abort,signal}=beginCatalogRequest(request);benchPending=true;viewportChanged?.();
  try{await catalogSession(frame!,signal);const candidate=nativeBenchInspectorCandidate(frame!,request);await catalogSession(frame!,signal);return {...catalogBinding(request),benchId:request.type==='remove-bench'?request.benchId:request.bench.id,candidate};}
  finally{benchPending=false;viewportChanged?.();catalogRequests.delete(abort);abort.abort();}
 },
 lightInspector:async value=>{
  requireEntranceIdle();
  if(architecturalPending)throw Error('ARCHITECTURAL_FINISH_INTENT_ACTIVE');
  if(plaquePending)throw Error('PLAQUE_INSPECTOR_INTENT_ACTIVE');
  if(spaceSettingsPending)throw Error('SPACE_SETTINGS_INTENT_ACTIVE');if(lightDetailsPending)throw Error('LIGHT_DETAILS_INTENT_ACTIVE');
  if(benchPending)throw Error('BENCH_INSPECTOR_INTENT_ACTIVE');
  if(placement.active)throw Error('PLACEMENT_INTENT_ACTIVE');
  if(lightPending)throw Error('LIGHT_INSPECTOR_INTENT_ACTIVE');
  const frame=current,request=checkedLightInspectorRequest(value,frame),{abort,signal}=beginCatalogRequest(request);lightPending=true;viewportChanged?.();
  try{await catalogSession(frame!,signal);const candidate=nativeLightInspectorCandidate(frame!,request);await catalogSession(frame!,signal);return {...catalogBinding(request),lightId:request.lightId,candidate};}
  finally{lightPending=false;viewportChanged?.();catalogRequests.delete(abort);abort.abort();}
 },
 thumbnail:async value=>{
  requireEntranceIdle();
  const frame=current,request=checkedCatalogRequest(value,frame,'thumbnail');const {abort,signal}=beginCatalogRequest(request);
  const cancelled=new Promise<never>((_,reject)=>signal.addEventListener('abort',()=>reject(Error('CATALOG_REQUEST_CANCELLED')),{once:true}));
  try{return await Promise.race([thumbnailQueue.run(async()=>{
   await catalogSession(frame!,signal);const image=await produceArtworkThumbnail(request,signal);await catalogSession(frame!,signal);
   return {...catalogBinding(request),artworkId:request.artworkId,revision:request.expectedRevision,...image};
  }),cancelled]);}finally{catalogRequests.delete(abort);abort.abort();}
 },
 findSelection:async value=>{
  requireEntranceIdle();
  if(architecturalPending)throw Error('ARCHITECTURAL_FINISH_INTENT_ACTIVE');
  if(plaquePending)throw Error('PLAQUE_INSPECTOR_INTENT_ACTIVE');
  if(spaceSettingsPending)throw Error('SPACE_SETTINGS_INTENT_ACTIVE');if(lightDetailsPending)throw Error('LIGHT_DETAILS_INTENT_ACTIVE');
  if(benchPending)throw Error('BENCH_INSPECTOR_INTENT_ACTIVE');
  if(placement.active)throw Error('PLACEMENT_INTENT_ACTIVE');
  const frame=current,request=checkedCatalogRequest(value,frame,'find');const {abort,signal}=beginCatalogRequest(request);
  try{await catalogSession(frame!,signal);const finder=findCurrentSelection;if(!finder||finder.frame!==frame||!finder.action(request.selection.id))throw Error('VIEWPORT_SELECTION_NOT_READY');return {...catalogBinding(request),selection:request.selection,accepted:true};}
  finally{catalogRequests.delete(abort);abort.abort();}
 },
 action:action=>{requireEntranceIdle();if(architecturalPending)throw Error('ARCHITECTURAL_FINISH_INTENT_ACTIVE');if(plaquePending)throw Error('PLAQUE_INSPECTOR_INTENT_ACTIVE');if(spaceSettingsPending)throw Error('SPACE_SETTINGS_INTENT_ACTIVE');if(lightDetailsPending)throw Error('LIGHT_DETAILS_INTENT_ACTIVE');if(benchPending)throw Error('BENCH_INSPECTOR_INTENT_ACTIVE');if(!current)throw Error('VIEWPORT_NOT_READY');if(lightPending)throw Error('LIGHT_INSPECTOR_INTENT_ACTIVE');if(placement.active)throw Error('PLACEMENT_INTENT_ACTIVE');return action?.type==='installation-command'?nativeInstallationAction(current,action):nativeGeometryAction(current,action);},
};
function Viewport(){
 const [state,setState]=useState<{frame:NativeViewportFrame;session:Session}>();
 const [planPreview,setPlanPreview]=useState<NativePlanPreview|null>(null);
 const [placementVersion,setPlacementVersion]=useState(0);
 const [entranceStage,setEntranceStage]=useState<EntranceStage>();
 const document=state?.frame.draft.candidate;
 // GeometryPreview owns an expensive renderer effect keyed by this function.
 // Camera/selection frames must not recreate the scene or overwrite the camera.
 const appearance=useMemo(()=>(id:string)=>{const m=document?materialFor(document,id):{color:'#ffffff',roughness:1,metalness:0};const hex=m.color.slice(1);return {baseColor:[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)/255) as [number,number,number],roughness:m.roughness,metalness:m.metalness};},[document]);
 useEffect(()=>{viewportChanged=()=>setPlacementVersion(v=>v+1);receive=(frame,session)=>setState({frame,session});if(current&&currentSession)setState({frame:current,session:currentSession});return()=>{entrancePreview.invalidate();entranceScene=undefined;for(const abort of catalogRequests)abort.abort();catalogRequests.clear();seenCatalogRequests.clear();findCurrentSelection=null;placement.cancel('3D 미리보기를 닫아 배치를 취소했어요.');viewportChanged=undefined;receive=undefined;current=undefined;currentSession=undefined;};},[]);
 useEffect(()=>{if(planPreview&&state&&!nativePlanPreviewCurrent(planPreview,state.frame))setPlanPreview(null);},[state,planPreview]);
 if(!state)return <p role="status">네이티브 전시를 기다리고 있습니다.</p>;
 const {frame,session}=state;
 const intent=entrancePreview.view,previewing=entrancePreview.active;
 const plan=frame.presentation==='plan'&&!intent;
 const editing:EditorBridge={document:frame.draft.candidate,selection:frame.selection,mode:frame.mode,view:frame.view,disabled:previewing||frame.disabled||plan||placement.active||lightPending||architecturalPending||plaquePending||benchPending||spaceSettingsPending||lightDetailsPending,preview:null,
  select:selection=>{if(!entrancePreview.active&&!frame.disabled&&!placement.active&&!lightPending&&!architecturalPending&&!plaquePending&&!benchPending&&!spaceSettingsPending&&!lightDetailsPending)post(frame,'selection',selection);},previewChange:()=>{},
  commit:command=>{try{if(entrancePreview.active||lightPending||architecturalPending||plaquePending||benchPending||spaceSettingsPending||lightDetailsPending||placement.active)return;post(frame,'candidate',geometryProposal(frame,command));}catch{post(frame,'error',{code:'VIEWPORT_COMMAND_REJECTED'});}},
  error:()=>post(frame,'error',{code:'VIEWPORT_EDIT_REJECTED'}),};
 const shownPreview=!lightPending&&!architecturalPending&&!plaquePending&&!benchPending&&!spaceSettingsPending&&!lightDetailsPending&&planPreview&&nativePlanPreviewCurrent(planPreview,frame)?planPreview:null;
 const planEditor:EditorBridge={...editing,view:frame.view+':'+(plan?'plan':'3d'),disabled:previewing||frame.disabled||!plan||lightPending||architecturalPending||plaquePending||benchPending||spaceSettingsPending||lightDetailsPending,preview:shownPreview?.command??null,
  select:selection=>{if(!entrancePreview.active&&current===frame&&!frame.disabled&&plan&&!lightPending&&!architecturalPending&&!plaquePending&&!benchPending&&!spaceSettingsPending&&!lightDetailsPending)post(frame,'selection',selection);},
  previewChange:command=>{
   if(entrancePreview.active||lightPending||architecturalPending||plaquePending||benchPending||spaceSettingsPending||lightDetailsPending||!command){setPlanPreview(null);return;}
   try{if(current!==frame)throw Error('VIEWPORT_FRAME_STALE');const candidate=nativePlanProposal(frame,command);setPlanPreview({frame,command,candidate});}
   catch{setPlanPreview(null);post(frame,'error',{code:'VIEWPORT_COMMAND_REJECTED'});}
  },
  commit:command=>{
   setPlanPreview(null);
   if(entrancePreview.active||lightPending||architecturalPending||plaquePending||benchPending||spaceSettingsPending||lightDetailsPending)return;
   try{if(current!==frame)throw Error('VIEWPORT_FRAME_STALE');const candidate=nativePlanProposal(frame,command);
    if(frame.selection&&JSON.stringify(selectedItem(frame.draft.candidate,frame.selection))!==JSON.stringify(selectedItem(candidate,frame.selection)))post(frame,'candidate',candidate);
   }catch{post(frame,'error',{code:'VIEWPORT_COMMAND_REJECTED'});}
  },
 };
 return <><div className="native-viewport-surface" hidden={plan} inert={plan}>
  <GeometryPreview document={frame.draft.candidate} selection={frame.selection} editing={editing} session={session} onSelectionFindReady={action=>{if(action)findCurrentSelection={frame,action};else if(findCurrentSelection?.frame===frame)findCurrentSelection=null;}} cameraRequest={{kind:frame.view,sequence:frame.cameraSequence}} spaceTransparency={frame.transparent}
   placementPreview={placementInstaller} placementPreviewVersion={placementVersion} appearance={appearance} onEntranceSceneReady={scene=>{entranceScene=scene??undefined;if(!scene)entrancePreview.invalidate();}} onRenderState={report=>{post(frame,'status',report);const placed=new Set(frame.draft.candidate.placements.map(p=>p.artworkRevisionId));setEntranceStage({ready:report.ready&&report.navigationReady&&(report.loaded>0||placed.size===0),error:report.navigationFailed||(report.loaded===0&&report.failed>0&&report.failed>=placed.size),message:report.message,phase:!report.ready?'space':report.loaded===0&&placed.size>0?'artwork':'navigation'});}}/>
 </div><div className="native-viewport-surface native-viewport-plan" hidden={!plan} inert={!plan}>
  <StudioFloorPlan document={shownPreview?.candidate??frame.draft.candidate} editor={planEditor}/>
 </div>{intent&&<NativeEntranceHost key={intent.generation} intent={intent} owner={entrancePreview} authenticate={catalogSession} stage={entranceStage}/>}</>;
}
const root=document.getElementById('root');if(!root)throw Error('VIEWPORT_ROOT_REQUIRED');createRoot(root).render(<Viewport/>);
