// SPDX-License-Identifier: AGPL-3.0-or-later
import {useCallback,useEffect,useMemo,useRef,useState,type ComponentProps} from 'react';
import {Vector3,Quaternion} from 'three';
import type {Artwork} from '@exhibitos/spec';
import {alignedDoorPair,materialFor,lodVariantsFor,assertRoomEnvelopeContentsAgainstBaseline,RoomEnvelopeError,artifactBounds,artifactCorners} from '@exhibitos/studio-contract';
import {GeometryPreview} from './GeometryPreview';
import {StudioFloorPlan} from './StudioFloorPlan';
import {DraftStore,type LocalDraft} from './drafts/store';
import {applyGeometryCommand,createGeometryState,undoGeometry,redoGeometry,type GeometryState,type GeometryCommand} from './geometry/model';
import {localPose,commandForPose,worldMatrix,alignedWall,wallOffset,type EditorSelection,type EditorBridge,type EditMode} from './geometry/direct-edit';
import {newPlacement,alignPlacement} from './placement/model';
import {deviceBudget} from './viewer/loading';
import {checkPrivateCandidate,starterDraft,starterRoom,resetPrivateDraft,type PrivateSeed} from './private-editor/model';
import {RoomControls} from './private-editor/RoomControls';
import {CameraInteractionControls} from './private-editor/CameraInteractionControls';
import type {CameraInteractionMode} from './geometry/camera-mode';
import {SurfaceMaterialControls} from './private-editor/SurfaceMaterialControls';
import {CatalogBenchControls} from './private-editor/CatalogBenchControls';
import {ToolPanel,type PrivateTool} from './private-editor/ToolPanel';
import {ExhibitionAudio,type AudioState} from './viewer/audio';
import {AudioControls} from './viewer/AudioControls';
import {onlyPrivateLightValuesChanged} from './private-editor/light-value-change';
import {assertPreparedRoom} from './private-editor/attached-room';
import {safePrivateView,type PrivateView} from './viewer/private-view';
import {readActiveCopy,rememberActiveCopy} from './private-editor/active-copy';
import './private-editor.css';

function Thumbnail({art,seed}:{art:Artwork;seed:PrivateSeed}){
 const [url,setUrl]=useState<string>();
 useEffect(()=>{
  const abort=new AbortController();let owned:string|undefined;
  const id=lodVariantsFor(art).find(v=>v.detail==='coarse')?.assetId??art.primaryAssetId,asset=seed.source.assets.find(a=>a.assetId===id);
  if(asset&&art.artworkType==='image')void seed.source.local!.check().then(()=>seed.source.local!.fetcher(asset.url,{signal:abort.signal})).then(r=>r.blob()).then(blob=>{if(abort.signal.aborted)return;owned=URL.createObjectURL(blob);setUrl(owned);}).catch(()=>{});
  return()=>{abort.abort();if(owned)URL.revokeObjectURL(owned);};
 },[art,seed]);
 return url?<img src={url} alt="" draggable={false}/>:<span className="private-thumbnail-empty">{art.artworkType==='image'?'회화':'조각'}</span>;
}

/** Prepare one coherent local transition. A failed list refresh must not pair
 * a newly saved record with the previous copy's still-visible geometry. */
export async function preparePrivateReset(seed:PrivateSeed,store:Pick<DraftStore,'resetPrivate'|'list'>,current:LocalDraft,candidate:LocalDraft['draft']['candidate'],knownCopies:LocalDraft[]){
 await seed.source.local!.check();checkPrivateCandidate(seed,candidate);
 const draft={...current.draft,candidate},reset=resetPrivateDraft(seed,draft);
 const record=await store.resetPrivate(draft,reset,current.version),geometry=createGeometryState(record.draft.candidate);
 let copies:LocalDraft[],listRefreshed=true;try{copies=await store.list();}catch{copies=knownCopies;listRefreshed=false;}
 return {record,geometry,copies:[record,...copies.filter(copy=>copy.id!==record.id)],listRefreshed};
}
export async function preparePrivateRecovery(seed:PrivateSeed,store:Pick<DraftStore,'privatePrevious'|'recoverPrivate'|'list'>,current:LocalDraft,candidate:LocalDraft['draft']['candidate'],knownCopies:LocalDraft[]){
 await seed.source.local!.check();checkPrivateCandidate(seed,candidate);
 const previous=await store.privatePrevious(current.id);if(!previous)throw Error('NO_PRIVATE_PREVIOUS');checkPrivateCandidate(seed,previous.draft.candidate);
 const record=await store.recoverPrivate({...current.draft,candidate},current.version,previous.version),geometry=createGeometryState(record.draft.candidate);
 let copies:LocalDraft[],listRefreshed=true;try{copies=await store.list();}catch{copies=knownCopies;listRefreshed=false;}
 return {record,geometry,copies:[record,...copies.filter(copy=>copy.id!==record.id)],listRefreshed};
}

/** Once the save commits, a failed list refresh must not report it as failed. */
export async function preparePrivateSave(seed:PrivateSeed,store:Pick<DraftStore,'save'|'list'>,record:LocalDraft,candidate:LocalDraft['draft']['candidate'],knownCopies:LocalDraft[]){
 await seed.source.local!.check();checkPrivateCandidate(seed,candidate);
 const saved=await store.save({...record.draft,candidate},record.version);
 let copies:LocalDraft[],listRefreshed=true;try{copies=await store.list();}catch{copies=knownCopies;listRefreshed=false;}
 return {record:saved,copies:[saved,...copies.filter(copy=>copy.id!==saved.id)],listRefreshed};
}

export function PrivateExhibitionEditor({seed}:{seed:PrivateSeed}){
 const store=useMemo(()=>new DraftStore(seed.storeName,{privateHistory:true}),[seed]);
 const record=useRef<LocalDraft|null>(null),stateRef=useRef<GeometryState|null>(null);
 const [state,setState]=useState<GeometryState|null>(null),[selection,setSelectionState]=useState<EditorSelection|null>(null),[preview,setPreviewState]=useState<GeometryCommand|null>(null);
 const [mode,setModeState]=useState<'edit'|'walk'>('edit'),[tool,setTool]=useState<EditMode>('translate'),[view,setView]=useState<'3d'|'plan'>('3d');
 const [cameraMode,setCameraModeState]=useState<CameraInteractionMode>('object'),[cameraAvailable,setCameraAvailable]=useState(false);
 const cameraModeRef=useRef<CameraInteractionMode>('object'),cameraApply=useRef<((value:CameraInteractionMode)=>boolean)|null>(null);
 const setCameraMode=useCallback((value:CameraInteractionMode)=>{cameraModeRef.current=value;setCameraModeState(value);},[]);
 const registerCamera=useCallback((apply:((value:CameraInteractionMode)=>boolean)|null)=>{cameraApply.current=apply;setCameraAvailable(!!apply);if(!apply)setCameraMode('object');},[setCameraMode]);
 const resetCamera=useCallback(()=>setCameraMode('object'),[setCameraMode]);
 const chooseCamera=useCallback((value:CameraInteractionMode)=>{if(value==='object'&&cameraModeRef.current==='object')return true;if(!cameraApply.current?.(value))return false;setCameraMode(value);return true;},[setCameraMode]);
 const [activePanel,setActivePanel]=useState<PrivateTool>('space'),[panelOpen,setPanelOpen]=useState(false),[panelCollapsed,setPanelCollapsed]=useState(false);
 const [busy,setBusyState]=useState(false),[dirty,setDirty]=useState(false),[notice,setNotice]=useState('이 브라우저의 편집 사본을 확인하고 있어요.'),[error,setError]=useState(''),[resetOpen,setResetOpen]=useState(false),[previousAvailable,setPreviousAvailable]=useState(false);
 const selectionRef=useRef<EditorSelection|null>(null),interactionSerial=useRef(0),previewRef=useRef<GeometryCommand|null>(null),temperaturePreviewRef=useRef<GeometryCommand|null>(null),temperatureLightId=useRef<string|undefined>(undefined),modeRef=useRef<'edit'|'walk'>('edit'),busyRef=useRef(false);
 const setSelection=useCallback((value:EditorSelection|null)=>{interactionSerial.current++;selectionRef.current=value;setSelectionState(value);},[]);
 const setPreview=(value:GeometryCommand|null)=>{if(value===null||value!==temperaturePreviewRef.current){temperaturePreviewRef.current=null;temperatureLightId.current=undefined;}interactionSerial.current++;previewRef.current=value;setPreviewState(value);};
 const setMode=(value:'edit'|'walk')=>{interactionSerial.current++;modeRef.current=value;setModeState(value);};
 const setBusy=(value:boolean)=>{interactionSerial.current++;busyRef.current=value;setBusyState(value);};
 const [draftPosition,setDraftPosition]=useState(['0','0','0']),[scaleFactor,setScaleFactor]=useState('1');
 const [copies,setCopiesState]=useState<LocalDraft[]>([]),copiesRef=useRef<LocalDraft[]>([]);
 const setCopies=(value:LocalDraft[])=>{copiesRef.current=value;setCopiesState(value);};
 const walkAudio=useRef<ExhibitionAudio|null>(null),walkMovement=useRef(false),privateViewGetter=useRef<(()=>PrivateView|undefined)|null>(null);
 const registerPrivateView=useCallback((getter:(()=>PrivateView|undefined)|null)=>{privateViewGetter.current=getter;},[]);
 const [walkAudioState,setWalkAudioState]=useState<AudioState|null>(null);
 const [cameraRequest,setCameraRequest]=useState<ComponentProps<typeof GeometryPreview>['cameraRequest']>();
 const budget=useMemo(()=>deviceBudget({viewportWidth:window.innerWidth}),[]);
 const source=useMemo<NonNullable<ComponentProps<typeof GeometryPreview>['publicSource']>>(()=>({publicationId:seed.source.publication.id,revisionSha256:seed.source.publication.revisionSha256,assets:seed.source.assets,fetcher:seed.source.local!.fetcher,check:seed.source.local!.check}),[seed]);
 const appearance=useCallback((id:string)=>{const m=materialFor(stateRef.current!.present,id);return {baseColor:[0,2,4].map(i=>parseInt(m.color.slice(1+i,3+i),16)/255) as [number,number,number],roughness:m.roughness,metalness:m.metalness};},[]);
 useEffect(()=>{
  let live=true;
  void (async()=>{
   await seed.source.local!.check();const rows=await store.list();
   const selectedId=readActiveCopy(seed.storeName),saved=rows.find(row=>row.id===selectedId)??rows[0]??await store.save(starterDraft(seed));checkPrivateCandidate(seed,saved.draft.candidate);
   let previous:LocalDraft|null;try{previous=await store.privatePrevious(saved.id);if(previous)checkPrivateCandidate(seed,previous.draft.candidate);}catch{previous=null;}
   if(!live)return;setPreviousAvailable(previous!==null);rememberActiveCopy(seed.storeName,saved.id);record.current=saved;setCopies(rows.length?rows:[saved]);const next=createGeometryState(saved.draft.candidate);stateRef.current=next;setState(next);setSelection({kind:'room',id:safePrivateView(next.present,seed.initialView)?.roomId??starterRoom(next.present).id});setNotice('이 브라우저만의 편집 사본이에요. 공개 전시는 바뀌지 않아요.');
  })().catch(()=>{if(live)setError('편집 사본을 열 수 없어요. 기존 저장본은 유지됩니다. 페이지를 다시 열어 확인해 주세요.');});
  return()=>{live=false;void store.close();};
 },[seed,store]);
 useEffect(()=>{if(!state||!selection)return;try{setDraftPosition(localPose(state.present,selection).position.map(String));}catch{setSelection(null);}},[state,selection]);
 useEffect(()=>{setScaleFactor('1');},[selection?.kind,selection?.id]);
 useEffect(()=>{const prevent=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',prevent);return()=>window.removeEventListener('beforeunload',prevent);},[dirty]);
 useEffect(()=>{if(!stateRef.current)return;const runtime=new ExhibitionAudio({...seed.source,exhibition:stateRef.current.present},setWalkAudioState);walkAudio.current=runtime;walkMovement.current=false;setWalkAudioState(runtime.snapshot());const visibility=()=>runtime.visibility(document.visibilityState==='visible'),blur=()=>runtime.visibility(false),escape=(event:KeyboardEvent)=>{if(event.key==='Escape')runtime.lifecycle(false);};document.addEventListener('visibilitychange',visibility);window.addEventListener('blur',blur);window.addEventListener('focus',visibility);window.addEventListener('keydown',escape);return()=>{document.removeEventListener('visibilitychange',visibility);window.removeEventListener('blur',blur);window.removeEventListener('focus',visibility);window.removeEventListener('keydown',escape);runtime.dispose();walkAudio.current=null;walkMovement.current=false;};},[seed,Boolean(state)]);
 function update(next:GeometryState){checkPrivateCandidate(seed,next.present);stateRef.current=next;setState(next);setPreview(null);setDirty(true);setError('');}
 function normalizeCommand(command:GeometryCommand):GeometryCommand{
  if(command.type==='set-room'){const before=stateRef.current!.present.rooms.find(r=>r.id===command.id);if(before&&JSON.stringify(before.dimensions)!==JSON.stringify(command.room.dimensions))return {type:'resize-room-envelope',roomId:command.id,dimensions:command.room.dimensions};}
  return command;
 }
 function reportCommandError(problem:unknown){setError(problem instanceof RoomEnvelopeError?problem.message:'공간의 범위나 참조에 맞지 않아 변경하지 않았어요. 위치와 선택을 확인해 주세요.');}
 function commit(command:GeometryCommand){if(busy||mode!=='edit'||!stateRef.current)return false;try{const next=applyGeometryCommand(stateRef.current,normalizeCommand(command),{verifiedDoorBaseline:seed.source.exhibition});if(!onlyPrivateLightValuesChanged(stateRef.current!.present,next.present))assertRoomEnvelopeContentsAgainstBaseline(next.present,seed.source.exhibition,room.id);update(next);return true;}catch(problem){reportCommandError(problem);return false;}}
 function previewChange(command:GeometryCommand|null){if(!command){setPreview(null);return;}try{const normalized=normalizeCommand(command),next=applyGeometryCommand(stateRef.current!,normalized,{verifiedDoorBaseline:seed.source.exhibition});if(!onlyPrivateLightValuesChanged(stateRef.current!.present,next.present))assertRoomEnvelopeContentsAgainstBaseline(next.present,seed.source.exhibition,room.id);setPreview(normalized);setError('');}catch(problem){setPreview(null);throw problem;}}

 function previewTemperature(command:GeometryCommand|null,lightId?:string){temperaturePreviewRef.current=command;temperatureLightId.current=command?lightId:undefined;previewChange(command);}

 async function refreshPrevious(id:string){try{const previous=await store.privatePrevious(id);if(previous)checkPrivateCandidate(seed,previous.draft.candidate);setPreviousAvailable(previous!==null);}catch{setPreviousAvailable(false);}}
 async function save(){
  if(busyRef.current||!record.current||!stateRef.current)return false;setBusy(true);
  try{const next=await preparePrivateSave(seed,store,record.current,stateRef.current.present,copiesRef.current);record.current=next.record;setCopies(next.copies);rememberActiveCopy(seed.storeName,next.record.id);await refreshPrevious(next.record.id);setDirty(false);setError('');setNotice(next.listRefreshed?'이 브라우저에 저장했어요. 공개 전시는 바뀌지 않아요.':'이 브라우저에 저장했어요. 목록을 새로 읽지 못해 확인된 사본만 표시해요.');return true;}
  catch{setError('저장하지 못했어요. 현재 편집은 유지됩니다. 다른 탭의 변경이나 저장 공간을 확인해 주세요.');return false;}finally{setBusy(false);}
 }
 async function replaceCurrent(recover:boolean){
  if(busyRef.current||!record.current||!stateRef.current)return;setBusy(true);setPreview(null);
  try{
   const prepare=recover?preparePrivateRecovery:preparePrivateReset,next=await prepare(seed,store,record.current,stateRef.current.present,copiesRef.current);
   record.current=next.record;stateRef.current=next.geometry;setState(next.geometry);setCopies(next.copies);setSelection({kind:'room',id:next.geometry.present.rooms.find(value=>value.id===room.id)?.id??safePrivateView(next.geometry.present,seed.initialView)?.roomId??starterRoom(next.geometry.present).id});setDirty(false);setResetOpen(false);setError('');rememberActiveCopy(seed.storeName,next.record.id);await refreshPrevious(next.record.id);
   setNotice((recover?'직전 상태를 복구했어요.':'현재 사본을 공개 원본 상태로 초기화했어요.')+' 다른 사본과 공개 전시는 바뀌지 않아요.'+(next.listRefreshed?'':' 확인된 사본 목록을 유지해요.'));
  }catch{setError((recover?'복구하지 못했어요.':'초기화하지 못했어요.')+' 현재 편집과 기존 저장본은 유지됩니다.');}finally{setBusy(false);}
 }
 async function openCopy(id:string){
  if(busyRef.current||id===record.current?.id)return;if(dirty&&!(await save()))return;setBusy(true);
  try{const next=await store.get(id);if(!next)throw Error();checkPrivateCandidate(seed,next.draft.candidate);record.current=next;const geometry=createGeometryState(next.draft.candidate);stateRef.current=geometry;setState(geometry);setSelection({kind:'room',id:safePrivateView(geometry.present,seed.initialView)?.roomId??starterRoom(geometry.present).id});setPreview(null);setDirty(false);setError('');rememberActiveCopy(seed.storeName,next.id);await refreshPrevious(next.id);setNotice('선택한 저장 사본을 열었어요. 다른 사본은 보존됩니다.');}catch{setError('이 사본을 열지 못했어요. 현재 편집은 유지됩니다.');}finally{setBusy(false);}
 }
 if(!state)return <main className="private-loading"><h1>직접 꾸며보기</h1><p role={error?'alert':'status'}>{error||notice}</p><a href="/">전시 관람으로 돌아가기</a></main>;
 const doc=state.present,interactionVersion=interactionSerial.current,selectionRoomId=selection?.kind==='room'?selection.id:selection?.kind==='surface'?doc.surfaces.find(s=>s.id===selection.id)?.roomId:selection?.kind==='opening'?doc.surfaces.find(s=>s.id===doc.openings.find(o=>o.id===selection.id)?.surfaceId)?.roomId:doc.placements.find(p=>p.id===selection?.id)?.roomId,room=doc.rooms.find(r=>r.id===selectionRoomId)??starterRoom(doc),selected=selection?.kind==='placement'?doc.placements.find(p=>p.id===selection.id):undefined,selectedArt=selected&&doc.artworks.find(a=>a.revisionId===selected.artworkRevisionId);
 const currentDoor=()=>stateRef.current?.present===doc&&interactionSerial.current===interactionVersion&&!busyRef.current&&modeRef.current==='edit'&&previewRef.current===null&&selectionRef.current?.kind==='opening'&&selectionRef.current.id===selection?.id;
 function commitCheckedRoom(command:GeometryCommand,roomId:string){if(stateRef.current?.present!==doc||interactionSerial.current!==interactionVersion||busyRef.current||modeRef.current!=='edit'||previewRef.current!==null)return;try{assertPreparedRoom(doc,command,roomId);update(applyGeometryCommand(stateRef.current,command));setSelection({kind:'room',id:roomId});setNotice('문으로 연결한 방을 추가했어요. 실행 취소로 되돌릴 수 있어요.');}catch(problem){reportCommandError(problem);}}
 function commitCheckedDoor(command:GeometryCommand){if(!currentDoor()||command.type!=='connect-doors'||command.firstId!==selectionRef.current?.id)return;try{alignedDoorPair(doc,command.firstId,command.secondId);update(applyGeometryCommand(stateRef.current!,command));}catch(problem){reportCommandError(problem);}}
 const selectedWall=selection?alignedWall(doc,selection):undefined;
 const rotationAllowed=selection?.kind!=='opening'&&!selectedWall;
 function nudge(axis:0|1|2,step:number){if(!selection)return;try{const pose=localPose(doc,selection),delta=new Vector3().setComponent(axis,step);if(selectedWall)delta.applyQuaternion(new Quaternion(...selectedWall.transform.rotation));const position=new Vector3(...pose.position).add(delta).toArray() as [number,number,number];commit(commandForPose(doc,selection,{...pose,position}));}catch{setError('선택한 대상의 이동 범위를 확인해 주세요.');}}
 const editor:EditorBridge={uprightRooms:true,dropArtwork:(revision,surfaceId,point)=>{const art=doc.artworks.find(a=>a.revisionId===revision),wall=doc.surfaces.find(s=>s.id===surfaceId);if(!art||art.artworkType!=='image'||wall?.type!=='wall'){setError('회화는 벽에 놓아 주세요. 썸네일을 눌러 배치할 수도 있어요.');return;}try{const local=new Vector3(...point).applyMatrix4(worldMatrix(doc,{kind:'surface',id:surfaceId}).invert()),placement=alignPlacement(doc,newPlacement(art,wall.roomId),wall,[local.x,local.y],.05);commit({type:'add-placement',placement});setSelection({kind:'placement',id:placement.id});}catch{setError('벽의 가장자리나 문과 겹치지 않는 곳에 놓아 주세요.');}},document:doc,selection,mode:tool,view,disabled:busy||mode!=='edit'||temperaturePreviewRef.current!==null,preview,previewLightId:temperaturePreviewRef.current===preview?temperatureLightId.current:undefined,select:setSelection,previewChange,commit,error:setError};
 const previewDocument=preview?applyGeometryCommand(createGeometryState(doc),preview,{verifiedDoorBaseline:seed.source.exhibition}).present:doc;
 function scaleSelected(){
  if(!selected||preview!==null)return;const factor=scaleFactor.trim()?Number(scaleFactor):NaN;if(!Number.isFinite(factor)||factor<.1||factor>10){setError('크기 배율은 0.1부터 10까지 입력해 주세요.');return;}
  try{const scaled=structuredClone(selected);scaled.transform.scale=scaled.transform.scale.map(v=>v*factor) as [number,number,number];if(selectedArt?.artworkType==='sculpture'){const before=artifactBounds(artifactCorners(selectedArt.dimensions,[selectedArt.transform,selected.transform])).min[1],after=artifactBounds(artifactCorners(selectedArt.dimensions,[selectedArt.transform,scaled.transform])).min[1];scaled.transform.position[1]+=before-after;}const wall=alignedWall(doc,{kind:'placement',id:selected.id});const placed=wall?alignPlacement(doc,scaled,wall,wallOffset(doc,scaled,wall,scaled.transform.position),0):scaled;const {id,...placement}=placed;if(commit({type:'set-placement',id,placement}))setScaleFactor('1');}catch{setError('작품이 벽이나 방의 범위를 벗어나지 않도록 크기를 확인해 주세요.');}
 }
 function add(art:Artwork){
  const wall=doc.surfaces.find(s=>s.roomId===room.id&&s.type==='wall');if(!wall)return;
  try{const placed=newPlacement(art,room.id),placement=art.artworkType==='image'?alignPlacement(doc,placed,wall,[0,-.1],0):placed;commit({type:'add-placement',placement});setSelection({kind:'placement',id:placement.id});}catch{setError('선택한 벽에 이 작품을 배치할 수 없어요. 다른 벽을 선택해 주세요.');}
 }
 return <main className="private-editor" data-mode={mode} data-dirty={dirty}>
  <header className="private-editor-header"><div><a className="private-brand" href="/">ExhibitOS</a><h1>직접 꾸며보기</h1></div><nav aria-label="편집 사본 도구"><button disabled={busy||temperaturePreviewRef.current!==null||!state.past.length||mode==='walk'} onClick={()=>update(undoGeometry(stateRef.current!))}>실행 취소</button><button disabled={busy||temperaturePreviewRef.current!==null||!state.future.length||mode==='walk'} onClick={()=>update(redoGeometry(stateRef.current!))}>다시 실행</button><button disabled={busy||!dirty||preview!==null} onClick={()=>void save()}>이 브라우저에 저장</button><button className="private-primary" disabled={busy} onClick={()=>{if(mode==='edit'&&!chooseCamera('object'))return;setPreview(null);const currentView=safePrivateView(stateRef.current!.present,privateViewGetter.current?.());if(currentView)setSelection({kind:'room',id:currentView.roomId});if(mode==='edit'){try{checkPrivateCandidate(seed,stateRef.current!.present);walkAudio.current?.updatePrivateExhibition(stateRef.current!.present);setMode('walk');}catch{setError('관람 소리 설정을 확인할 수 없어요. 편집 내용은 유지됩니다.');}}else{walkAudio.current?.lifecycle(false,true);setMode('edit');}}}>{mode==='edit'?'걸어서 확인':'편집으로 돌아가기'}</button></nav></header>
  <div className="private-save-status" role="status">{dirty?'저장하지 않은 변경이 있어요.':notice}</div>{error&&<p className="private-error" role="alert">{error}</p>}
  <div className="private-editor-workspace">
   <section className="private-scene" aria-label={mode==='edit'?'전시실 편집 장면':'편집 사본 보행 관람'}>
    {mode==='edit'&&<div className="private-scene-tools"><div aria-label="편집 도구">{(['translate','rotate','dimensions'] as const).map((v,i)=><button key={v} aria-pressed={tool===v} disabled={busy||v==='dimensions'&&selection?.kind!=='room'||v==='rotate'&&!rotationAllowed} onClick={()=>{if(!chooseCamera('object'))return;setPreview(null);if(v==='dimensions')setView('plan');setTool(v);}}>{['이동','회전','방 크기'][i]}</button>)}</div><div aria-label="장면 보기"><button aria-pressed={view==='3d'} onClick={()=>{setPreview(null);setView('3d');}}>3D</button><button aria-pressed={view==='plan'} onClick={()=>{if(!chooseCamera('object'))return;setPreview(null);setView('plan');}}>평면도</button></div>{view==='3d'&&<CameraInteractionControls mode={cameraMode} disabled={busy||preview!==null||!cameraAvailable} onModeChange={value=>{if(!chooseCamera(value))setError('보기 조작을 바꾸기 전에 현재 조작을 마쳐 주세요.');}}/>}</div>}
    {view==='plan'&&mode==='edit'?<StudioFloorPlan document={previewDocument} editor={editor}/>:<GeometryPreview privateCatalogue onCameraInteractionReady={registerCamera} onCameraInteractionReset={resetCamera} onPrivateViewReady={registerPrivateView} initialPrivateView={safePrivateView(doc,seed.initialView)} cameraRequest={cameraRequest} fillHost compactControls={mode==='edit'} document={doc} publicSource={source} viewerBudget={budget} session={null} selection={mode==='edit'?selection:null} editing={mode==='edit'?editor:undefined} appearance={appearance} spaceTransparency={false} onNavigationState={mode==='walk'?value=>walkAudio.current?.update(value):undefined} onCameraPose={mode==='walk'?(position,yaw)=>walkAudio.current?.updatePose(position,yaw):undefined} onNavigationMode={mode==='walk'?(walking,paused)=>{walkMovement.current=walking&&!paused;walkAudio.current?.lifecycle(walkMovement.current);}:undefined}/>}
    {mode==='walk'&&<details className="viewer-audio-menu"><summary>소리</summary><AudioControls audio={walkAudio.current} state={walkAudioState} zones={doc.audioZones}/></details>}
   </section>
   <div className="private-panel-host" hidden={mode!=='edit'}>
    <ToolPanel active={activePanel} open={panelOpen} collapsed={panelCollapsed} disabled={busy||preview!==null} onSelect={value=>{interactionSerial.current++;setActivePanel(value);setPanelOpen(true);setPanelCollapsed(false);}} onClose={()=>{setPreview(null);interactionSerial.current++;setPanelOpen(false);}} onCollapse={()=>{setPreview(null);interactionSerial.current++;setPanelCollapsed(value=>!value);}}>
     <div className="private-selection-settings" hidden={!selection||(selectedArt?activePanel!=='artwork':activePanel!=='space')}>
      <h3>{selectedArt?.metadata.title??(selection?.kind==='room'?room.name:'선택한 공간 요소')}</h3>
      <p>장면의 손잡이 또는 아래 버튼으로 옮겨보세요.</p>
      {selection&&<details><summary>위치와 이동 상세</summary><div className="private-nudge" role="group" aria-label="선택 대상 이동">{([['왼쪽',0,-.1],['오른쪽',0,.1],['위로',1,.1],['아래로',1,-.1],['앞으로',2,-.1],['뒤로',2,.1]] as const).map(([label,axis,step])=><button key={label} disabled={busy||preview!==null||!!selectedWall&&axis===2} onClick={()=>nudge(axis,step)}>{label}</button>)}</div><p>한 번에 10cm 이동해요.</p><form onSubmit={e=>{e.preventDefault();try{const pose=localPose(doc,selection),position=draftPosition.map(v=>v.trim()===''?NaN:Number(v));if(!position.every(Number.isFinite))throw Error();commit(commandForPose(doc,selection,{...pose,position:position as [number,number,number]}));}catch{setError('위치는 비어 있지 않은 숫자로 입력해 주세요.');}}}><fieldset disabled={busy||preview!==null}><legend>위치</legend>{['가로','높이','깊이'].map((label,i)=><label key={label}>{label} (m)<input type="number" step="any" value={draftPosition[i]} onChange={e=>setDraftPosition(v=>v.map((n,j)=>j===i?e.target.value:n))}/></label>)}<button type="submit">위치 적용</button></fieldset></form></details>}
     </div>
     <div hidden={activePanel!=='artwork'}>
      <div className="private-art-dock" aria-label="작품 썸네일"><h3>작품 선택</h3><p>눌러 선택하거나 장면으로 끌어 놓으세요.</p><div className="private-art-list">{seed.source.exhibition.artworks.map(art=><button key={art.revisionId} disabled={busy||preview!==null} draggable={!busy&&preview===null} onDragStart={e=>{e.dataTransfer.setData('application/x-exhibitos-artwork',art.revisionId);e.dataTransfer.effectAllowed='copy';}} aria-pressed={selectedArt?.revisionId===art.revisionId} onClick={()=>{const placement=doc.placements.find(p=>p.roomId===room.id&&p.artworkRevisionId===art.revisionId);if(placement)setSelection({kind:'placement',id:placement.id});else add(art);}}><Thumbnail art={art} seed={seed}/><span>{art.metadata.title}</span></button>)}</div></div>
      {selected&&<details><summary>크기와 배치 상세</summary><div className="private-selection-actions"><label>크기 배율<input type="number" aria-label="작품 크기 배율" min="0.1" max="10" step="any" value={scaleFactor} disabled={busy||preview!==null} onChange={e=>setScaleFactor(e.target.value)}/></label><button disabled={busy||preview!==null} onClick={scaleSelected}>크기 적용</button><button disabled={busy||preview!==null} onClick={()=>add(selectedArt!)}>같은 작품 추가</button><button disabled={busy||preview!==null} onClick={()=>{commit({type:'remove-placement',id:selected.id});setSelection({kind:'room',id:room.id});}}>배치 삭제</button></div></details>}
     </div>
     <div hidden={activePanel!=='space'&&activePanel!=='lighting'}><div hidden={activePanel!=='space'}><label>전시실 선택<select aria-label="전시실 선택" value={room.id} disabled={busy||preview!==null} onChange={event=>setSelection({kind:'room',id:event.target.value})}>{doc.rooms.map(value=><option key={value.id} value={value.id}>{value.name}</option>)}</select></label></div><RoomControls verifiedDoorBaseline={seed.source.exhibition} isCurrentRoom={()=>stateRef.current?.present===doc&&interactionSerial.current===interactionVersion&&!busyRef.current&&modeRef.current==='edit'&&previewRef.current===null} executeRoom={commitCheckedRoom} temperaturePreviewing={preview!==null&&preview===temperaturePreviewRef.current} previewTemperature={previewTemperature} temperatureDisabled={busy||mode!=='edit'||preview!==null&&preview!==temperaturePreviewRef.current} temperatureActive={panelOpen&&!panelCollapsed&&activePanel==='lighting'&&mode==='edit'} section={activePanel==='lighting'?'lighting':'space'} selectedSurfaceId={selection?.kind==='surface'?selection.id:undefined} selectedOpeningId={selection?.kind==='opening'?selection.id:undefined} document={doc} roomId={room.id} disabled={busy||preview!==null||mode!=='edit'} isCurrent={currentDoor} executeDoor={commitCheckedDoor} execute={commit} select={setSelection} error={setError} inspectCeiling={()=>{setPreview(null);setSelection({kind:'room',id:room.id});setView('3d');setCameraRequest(v=>({kind:'ceiling',sequence:(v?.sequence??0)+1}));}}/></div>
     <div hidden={activePanel!=='bench'}><CatalogBenchControls document={doc} seed={seed} roomId={room.id} disabled={busy||preview!==null||mode!=='edit'} execute={commit} error={setError}/></div>
     <div hidden={activePanel!=='surface'}><SurfaceMaterialControls document={doc} seed={seed} roomId={room.id} selectedSurfaceId={selection?.kind==='surface'?selection.id:undefined} disabled={busy||preview!==null||mode!=='edit'} execute={commit} select={setSelection} error={setError}/></div>
     <section hidden={activePanel!=='copies'} aria-label="사본과 저장 안내"><label>이 브라우저의 저장 사본<select value={record.current?.id??''} disabled={busy} onChange={e=>void openCopy(e.target.value)}>{copies.map((copy,i)=><option key={copy.id} value={copy.id}>저장 사본 {copies.length-i} · {new Date(copy.updatedAt).toLocaleString('ko-KR')}</option>)}</select></label><p>이 기기의 현재 브라우저에만 저장합니다. 공개 전시나 일반 Studio 저장본은 바뀌지 않습니다. 브라우저 데이터를 지우면 사본도 사라질 수 있어요.</p><details><summary>사용 안내</summary><p>일부 편집 도구를 사용할 수 있어요. 작품 배치·크기, 공간, 조명과 표면 색을 바꾸고 걸어볼 수 있습니다. 설정을 적용한 뒤 이 브라우저에 저장하세요.</p></details><button disabled={busy||preview!==null} onClick={()=>setResetOpen(true)}>현재 사본 초기화</button><button disabled={busy||preview!==null||!previousAvailable} onClick={()=>void replaceCurrent(true)}>직전 상태 복구</button>{resetOpen&&<div><p>현재 사본을 공개 원본 상태로 되돌립니다. 저장하지 않은 편집도 직전 상태로 보관해 복구할 수 있어요.</p><button disabled={busy} onClick={()=>void replaceCurrent(false)}>초기화</button><button disabled={busy} onClick={()=>setResetOpen(false)}>취소</button></div>}</section>
    </ToolPanel>
   </div>
  </div>
 </main>;
}
