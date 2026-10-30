// SPDX-License-Identifier: AGPL-3.0-or-later
import {useCallback,useEffect,useMemo,useRef,useState,type ComponentProps} from 'react';
import {Vector3,Quaternion} from 'three';
import type {Artwork} from '@exhibitos/spec';
import {materialFor,lodVariantsFor,assertRoomEnvelopeContents,RoomEnvelopeError,artifactBounds,artifactCorners} from '@exhibitos/studio-contract';
import {GeometryPreview} from './GeometryPreview';
import {StudioFloorPlan} from './StudioFloorPlan';
import {DraftStore,type LocalDraft} from './drafts/store';
import {applyGeometryCommand,createGeometryState,undoGeometry,redoGeometry,type GeometryState,type GeometryCommand} from './geometry/model';
import {localPose,commandForPose,worldMatrix,alignedWall,wallOffset,type EditorSelection,type EditorBridge,type EditMode} from './geometry/direct-edit';
import {newPlacement,alignPlacement} from './placement/model';
import {deviceBudget} from './viewer/loading';
import {checkPrivateCandidate,starterDraft,starterRoom,type PrivateSeed} from './private-editor/model';
import {RoomControls} from './private-editor/RoomControls';
import {SurfaceMaterialControls} from './private-editor/SurfaceMaterialControls';
import {CatalogBenchControls} from './private-editor/CatalogBenchControls';
import {ExhibitionAudio,type AudioState} from './viewer/audio';
import {AudioControls} from './viewer/AudioControls';
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

export function PrivateExhibitionEditor({seed}:{seed:PrivateSeed}){
 const store=useMemo(()=>new DraftStore(seed.storeName),[seed]);
 const record=useRef<LocalDraft|null>(null),stateRef=useRef<GeometryState|null>(null);
 const [state,setState]=useState<GeometryState|null>(null),[selection,setSelection]=useState<EditorSelection|null>(null),[preview,setPreview]=useState<GeometryCommand|null>(null);
 const [mode,setMode]=useState<'edit'|'walk'>('edit'),[tool,setTool]=useState<EditMode>('translate'),[view,setView]=useState<'3d'|'plan'>('3d');
 const [busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[notice,setNotice]=useState('이 브라우저의 편집 사본을 확인하고 있어요.'),[error,setError]=useState(''),[resetOpen,setResetOpen]=useState(false);
 const [draftPosition,setDraftPosition]=useState(['0','0','0']),[scaleFactor,setScaleFactor]=useState('1');
 const [copies,setCopies]=useState<LocalDraft[]>([]);
 const walkAudio=useRef<ExhibitionAudio|null>(null),walkMovement=useRef(false);
 const [walkAudioState,setWalkAudioState]=useState<AudioState|null>(null);
 const [cameraRequest,setCameraRequest]=useState<ComponentProps<typeof GeometryPreview>['cameraRequest']>();
 const budget=useMemo(()=>deviceBudget({viewportWidth:window.innerWidth}),[]);
 const source=useMemo<NonNullable<ComponentProps<typeof GeometryPreview>['publicSource']>>(()=>({publicationId:seed.source.publication.id,revisionSha256:seed.source.publication.revisionSha256,assets:seed.source.assets,fetcher:seed.source.local!.fetcher,check:seed.source.local!.check}),[seed]);
 const appearance=useCallback((id:string)=>{const m=materialFor(stateRef.current!.present,id);return {baseColor:[0,2,4].map(i=>parseInt(m.color.slice(1+i,3+i),16)/255) as [number,number,number],roughness:m.roughness,metalness:m.metalness};},[]);
 useEffect(()=>{
  let live=true;
  void (async()=>{
   await seed.source.local!.check();const rows=await store.list();
   const saved=rows[0]??await store.save(starterDraft(seed));checkPrivateCandidate(seed,saved.draft.candidate);
   if(!live)return;record.current=saved;setCopies(rows.length?rows:[saved]);const next=createGeometryState(saved.draft.candidate);stateRef.current=next;setState(next);setSelection({kind:'room',id:starterRoom(next.present).id});setNotice('이 브라우저만의 편집 사본이에요. 공개 전시는 바뀌지 않아요.');
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
 function commit(command:GeometryCommand){if(busy||mode!=='edit'||!stateRef.current)return false;try{const next=applyGeometryCommand(stateRef.current,normalizeCommand(command));assertRoomEnvelopeContents(next.present,room.id);update(next);return true;}catch(problem){reportCommandError(problem);return false;}}
 function previewChange(command:GeometryCommand|null){if(!command){setPreview(null);return;}try{const normalized=normalizeCommand(command),next=applyGeometryCommand(stateRef.current!,normalized);assertRoomEnvelopeContents(next.present,room.id);setPreview(normalized);setError('');}catch(problem){setPreview(null);throw problem;}}

 async function save(){
  if(busy||!record.current||!stateRef.current)return false;setBusy(true);
  try{await seed.source.local!.check();checkPrivateCandidate(seed,stateRef.current.present);const next=await store.save({...record.current.draft,candidate:stateRef.current.present},record.current.version);record.current=next;setCopies(await store.list());setDirty(false);setNotice('이 브라우저에 저장했어요. 공개 전시는 바뀌지 않아요.');return true;}
  catch{setError('저장하지 못했어요. 현재 편집은 유지됩니다. 다른 탭의 변경이나 저장 공간을 확인해 주세요.');return false;}finally{setBusy(false);}
 }
 async function reset(){
  if(dirty&&!(await save()))return;setBusy(true);
  try{const next=await store.save(starterDraft(seed));record.current=next;setCopies(await store.list());const geometry=createGeometryState(next.draft.candidate);stateRef.current=geometry;setState(geometry);setSelection({kind:'room',id:starterRoom(geometry.present).id});setPreview(null);setDirty(false);setResetOpen(false);setNotice('새 편집 사본을 만들었어요. 이전 저장본도 이 브라우저에 보존했어요.');}catch{setError('새 사본을 저장하지 못했어요. 현재 편집은 유지됩니다.');}finally{setBusy(false);}
 }
 async function openCopy(id:string){
  if(busy||id===record.current?.id)return;if(dirty&&!(await save()))return;setBusy(true);
  try{const next=await store.get(id);if(!next)throw Error();checkPrivateCandidate(seed,next.draft.candidate);record.current=next;const geometry=createGeometryState(next.draft.candidate);stateRef.current=geometry;setState(geometry);setSelection({kind:'room',id:starterRoom(geometry.present).id});setPreview(null);setDirty(false);setNotice('선택한 저장 사본을 열었어요. 다른 사본은 보존됩니다.');}catch{setError('이 사본을 열지 못했어요. 현재 편집은 유지됩니다.');}finally{setBusy(false);}
 }
 if(!state)return <main className="private-loading"><h1>직접 꾸며보기</h1><p role={error?'alert':'status'}>{error||notice}</p><a href="/">전시 관람으로 돌아가기</a></main>;
 const doc=state.present,selectionRoomId=selection?.kind==='room'?selection.id:selection?.kind==='surface'?doc.surfaces.find(s=>s.id===selection.id)?.roomId:selection?.kind==='opening'?doc.surfaces.find(s=>s.id===doc.openings.find(o=>o.id===selection.id)?.surfaceId)?.roomId:doc.placements.find(p=>p.id===selection?.id)?.roomId,room=doc.rooms.find(r=>r.id===selectionRoomId)??starterRoom(doc),selected=selection?.kind==='placement'?doc.placements.find(p=>p.id===selection.id):undefined,selectedArt=selected&&doc.artworks.find(a=>a.revisionId===selected.artworkRevisionId);
 const selectedWall=selection?alignedWall(doc,selection):undefined;
 const rotationAllowed=selection?.kind!=='opening'&&!selectedWall;
 function nudge(axis:0|1|2,step:number){if(!selection)return;try{const pose=localPose(doc,selection),delta=new Vector3().setComponent(axis,step);if(selectedWall)delta.applyQuaternion(new Quaternion(...selectedWall.transform.rotation));const position=new Vector3(...pose.position).add(delta).toArray() as [number,number,number];commit(commandForPose(doc,selection,{...pose,position}));}catch{setError('선택한 대상의 이동 범위를 확인해 주세요.');}}
 const editor:EditorBridge={uprightRooms:true,dropArtwork:(revision,surfaceId,point)=>{const art=doc.artworks.find(a=>a.revisionId===revision),wall=doc.surfaces.find(s=>s.id===surfaceId);if(!art||art.artworkType!=='image'||wall?.type!=='wall'){setError('회화는 벽에 놓아 주세요. 썸네일을 눌러 배치할 수도 있어요.');return;}try{const local=new Vector3(...point).applyMatrix4(worldMatrix(doc,{kind:'surface',id:surfaceId}).invert()),placement=alignPlacement(doc,newPlacement(art,wall.roomId),wall,[local.x,local.y],.05);commit({type:'add-placement',placement});setSelection({kind:'placement',id:placement.id});}catch{setError('벽의 가장자리나 문과 겹치지 않는 곳에 놓아 주세요.');}},document:doc,selection,mode:tool,view,disabled:busy||mode!=='edit',preview,select:setSelection,previewChange,commit,error:setError};
 const previewDocument=preview?applyGeometryCommand(createGeometryState(doc),preview).present:doc;
 function scaleSelected(){
  if(!selected||preview!==null)return;const factor=scaleFactor.trim()?Number(scaleFactor):NaN;if(!Number.isFinite(factor)||factor<.1||factor>10){setError('크기 배율은 0.1부터 10까지 입력해 주세요.');return;}
  try{const scaled=structuredClone(selected);scaled.transform.scale=scaled.transform.scale.map(v=>v*factor) as [number,number,number];if(selectedArt?.artworkType==='sculpture'){const before=artifactBounds(artifactCorners(selectedArt.dimensions,[selectedArt.transform,selected.transform])).min[1],after=artifactBounds(artifactCorners(selectedArt.dimensions,[selectedArt.transform,scaled.transform])).min[1];scaled.transform.position[1]+=before-after;}const wall=alignedWall(doc,{kind:'placement',id:selected.id});const placed=wall?alignPlacement(doc,scaled,wall,wallOffset(doc,scaled,wall,scaled.transform.position),0):scaled;const {id,...placement}=placed;if(commit({type:'set-placement',id,placement}))setScaleFactor('1');}catch{setError('작품이 벽이나 방의 범위를 벗어나지 않도록 크기를 확인해 주세요.');}
 }
 function add(art:Artwork){
  const wall=doc.surfaces.find(s=>s.roomId===room.id&&s.type==='wall');if(!wall)return;
  try{const placed=newPlacement(art,room.id),placement=art.artworkType==='image'?alignPlacement(doc,placed,wall,[0,-.1],0):placed;commit({type:'add-placement',placement});setSelection({kind:'placement',id:placement.id});}catch{setError('선택한 벽에 이 작품을 배치할 수 없어요. 다른 벽을 선택해 주세요.');}
 }
 return <main className="private-editor" data-mode={mode} data-dirty={dirty}>
  <header className="private-editor-header"><div><a className="private-brand" href="/">ExhibitOS</a><h1>직접 꾸며보기</h1></div><nav aria-label="편집 사본 도구"><button disabled={busy||!state.past.length||mode==='walk'} onClick={()=>update(undoGeometry(stateRef.current!))}>실행 취소</button><button disabled={busy||!state.future.length||mode==='walk'} onClick={()=>update(redoGeometry(stateRef.current!))}>다시 실행</button><button disabled={busy||!dirty||preview!==null} onClick={()=>void save()}>이 브라우저에 저장</button><button className="private-primary" disabled={busy} onClick={()=>{setPreview(null);if(mode==='edit'){try{checkPrivateCandidate(seed,stateRef.current!.present);walkAudio.current?.updatePrivateExhibition(stateRef.current!.present);setMode('walk');}catch{setError('관람 소리 설정을 확인할 수 없어요. 편집 내용은 유지됩니다.');}}else{walkAudio.current?.lifecycle(false,true);setMode('edit');}}}>{mode==='edit'?'걸어서 확인':'편집으로 돌아가기'}</button></nav></header>
  <p className="private-scope">일부 편집 도구를 사용할 수 있어요. 작품 배치·크기, 공간, 조명과 표면 색을 바꾸고 걸어볼 수 있습니다.</p>
  <div className="private-save-status" role="status">{dirty?'저장하지 않은 변경이 있어요.':notice}</div>{error&&<p className="private-error" role="alert">{error}</p>}
  <div className="private-editor-workspace">
   {mode==='edit'&&<aside className="private-art-dock" aria-label="작품 썸네일"><h2>작품</h2><p>선택한 뒤 장면에서 옮겨보세요.</p>{seed.source.exhibition.artworks.map(art=><button key={art.revisionId} draggable onDragStart={e=>{e.dataTransfer.setData('application/x-exhibitos-artwork',art.revisionId);e.dataTransfer.effectAllowed='copy';}} aria-pressed={selectedArt?.revisionId===art.revisionId} onClick={()=>{const placement=doc.placements.find(p=>p.roomId===room.id&&p.artworkRevisionId===art.revisionId);if(placement)setSelection({kind:'placement',id:placement.id});else add(art);}}><Thumbnail art={art} seed={seed}/><span>{art.metadata.title}</span></button>)}</aside>}
   <section className="private-scene" aria-label={mode==='edit'?'전시실 편집 장면':'편집 사본 보행 관람'}>
    {mode==='edit'&&<div className="private-scene-tools"><div aria-label="편집 도구">{(['translate','rotate','dimensions'] as const).map((v,i)=><button key={v} aria-pressed={tool===v} disabled={busy||v==='dimensions'&&selection?.kind!=='room'||v==='rotate'&&!rotationAllowed} onClick={()=>{setPreview(null);if(v==='dimensions')setView('plan');setTool(v);}}>{['이동','회전','방 크기'][i]}</button>)}</div><div aria-label="장면 보기"><button aria-pressed={view==='3d'} onClick={()=>{setPreview(null);setView('3d');}}>3D</button><button aria-pressed={view==='plan'} onClick={()=>{setPreview(null);setView('plan');}}>평면도</button></div></div>}
    {view==='plan'&&mode==='edit'?<StudioFloorPlan document={previewDocument} editor={editor}/>:<GeometryPreview privateCatalogue cameraRequest={cameraRequest} fillHost compactControls={mode==='edit'} document={doc} publicSource={source} viewerBudget={budget} session={null} selection={mode==='edit'?selection:null} editing={mode==='edit'?editor:undefined} appearance={appearance} spaceTransparency={false} onNavigationState={mode==='walk'?value=>walkAudio.current?.update(value):undefined} onCameraPose={mode==='walk'?(position,yaw)=>walkAudio.current?.updatePose(position,yaw):undefined} onNavigationMode={mode==='walk'?(walking,paused)=>{walkMovement.current=walking&&!paused;walkAudio.current?.lifecycle(walkMovement.current);}:undefined}/>}
    {mode==='walk'&&<details className="viewer-audio-menu"><summary>소리</summary><AudioControls audio={walkAudio.current} state={walkAudioState} zones={doc.audioZones}/></details>}
   </section>
   {mode==='edit'&&<aside className="private-inspector" aria-label="선택 대상 설정"><h2>{selectedArt?.metadata.title??(selection?.kind==='room'?room.name:'선택한 공간 요소')}</h2><p>{selected?'장면의 손잡이 또는 아래 위치로 조절하세요.':'장면에서 작품이나 벽을 선택하세요.'}</p>{selection&&<><div className="private-nudge" role="group" aria-label="선택 대상 이동">{([['왼쪽',0,-.1],['오른쪽',0,.1],['위로',1,.1],['아래로',1,-.1],['앞으로',2,-.1],['뒤로',2,.1]] as const).map(([label,axis,step])=><button key={label} disabled={busy||!!selectedWall&&axis===2} onClick={()=>nudge(axis,step)}>{label}</button>)}</div><p>한 번 누르면 10cm 이동합니다. 장면의 손잡이를 드래그할 수도 있어요.</p><details><summary>상세 설정</summary><form onSubmit={e=>{e.preventDefault();try{const pose=localPose(doc,selection),position=draftPosition.map(v=>v.trim()===''?NaN:Number(v));if(!position.every(Number.isFinite))throw Error();commit(commandForPose(doc,selection,{...pose,position:position as [number,number,number]}));}catch{setError('위치는 비어 있지 않은 숫자로 입력해 주세요.');}}}><fieldset disabled={busy}><legend>위치</legend>{['가로','높이','깊이'].map((label,i)=><label key={label}>{label} (m)<input type="number" step="0.1" value={draftPosition[i]} onChange={e=>setDraftPosition(v=>v.map((n,j)=>j===i?e.target.value:n))}/></label>)}<button type="submit">위치 적용</button></fieldset></form></details></>}{selected&&<div className="private-selection-actions"><label>크기 배율<input type="number" aria-label="작품 크기 배율" min="0.1" max="10" step="0.1" value={scaleFactor} disabled={busy||preview!==null} onChange={e=>setScaleFactor(e.target.value)}/></label><button disabled={busy||preview!==null} onClick={scaleSelected}>크기 적용</button><button onClick={()=>add(selectedArt!)}>같은 작품 추가</button><button onClick={()=>{commit({type:'remove-placement',id:selected.id});setSelection({kind:'room',id:room.id});}}>배치 삭제</button></div>}{!selectedArt&&<RoomControls selectedSurfaceId={selection?.kind==='surface'?selection.id:undefined} selectedOpeningId={selection?.kind==='opening'?selection.id:undefined} document={doc} roomId={room.id} disabled={busy||preview!==null} execute={commit} select={setSelection} error={setError} inspectCeiling={()=>{setPreview(null);setSelection({kind:'room',id:room.id});setView('3d');setCameraRequest(v=>({kind:'ceiling',sequence:(v?.sequence??0)+1}));}}/>}{!selectedArt&&<CatalogBenchControls document={doc} seed={seed} roomId={room.id} disabled={busy||preview!==null} execute={commit} error={setError}/>}{!selectedArt&&<SurfaceMaterialControls document={doc} seed={seed} roomId={room.id} selectedSurfaceId={selection?.kind==='surface'?selection.id:undefined} disabled={busy||preview!==null} execute={commit} select={setSelection} error={setError}/>}<details><summary>사본과 저장 안내</summary><label>이 브라우저의 저장 사본<select value={record.current?.id??''} disabled={busy} onChange={e=>void openCopy(e.target.value)}>{copies.map((copy,i)=><option key={copy.id} value={copy.id}>저장 사본 {copies.length-i} · {new Date(copy.updatedAt).toLocaleString('ko-KR')}</option>)}</select></label><p>이 기기의 현재 브라우저에만 저장합니다. 공개 전시나 일반 Studio 저장본은 바뀌지 않습니다. 브라우저 데이터를 지우면 사본도 사라질 수 있어요.</p><button disabled={busy} onClick={()=>setResetOpen(true)}>새 사본으로 시작</button>{resetOpen&&<div><p>현재 편집을 저장하고 새 전시실 사본을 만듭니다. 이전 저장본은 보존합니다.</p><button disabled={busy} onClick={()=>void reset()}>새 사본 만들기</button><button onClick={()=>setResetOpen(false)}>취소</button></div>}</details></aside>}
  </div>
 </main>;
}
