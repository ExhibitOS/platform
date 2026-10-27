// SPDX-License-Identifier: AGPL-3.0-or-later
import {useEffect,useMemo,useRef,useState,type CSSProperties} from 'react';
import {ENTRANCE_NAMESPACE,entranceFor,spaceStillFor} from '@exhibitos/studio-contract';
import {EntranceCover} from './EntranceCover';
import {EntryTicket} from './EntryTicket';
import {EntranceEntryOverlay,useEntranceEntry,type EntranceStage} from './entrance-entry';
import {entranceContent,entranceRuntime} from './entrance-runtime';
import {waitForCoverLayout} from './cover-ready';
import {nativeEntranceCoverSource} from './native-entrance-cover-source';
import type {NativeViewportFrame} from './native-viewport-protocol';
import type {NativeEntrancePreview,EntrancePreviewIntent,EntrancePreviewMeasurement} from './native-entrance-preview';
import type {ThemeProps} from './entrance-themes/types';
import './publication-novice.css';
import './publication-immersive.css';

export function previewExhibition(intent:EntrancePreviewIntent){
 const exhibition=structuredClone(intent.frame.draft.candidate),settings=entranceFor(exhibition);
 if(intent.request.theme!==null&&settings.design?.theme!==intent.request.theme){
  const {layout,effects,...retained}=settings.design??{};void layout;void effects;
  settings.design={...retained,version:1,theme:intent.request.theme};
  exhibition.extensions={...exhibition.extensions,[ENTRANCE_NAMESPACE]:settings as unknown as NonNullable<typeof exhibition.extensions>[string]};
 }
 return exhibition;
}
function previewDelay(signal:AbortSignal){
 return new Promise<void>((resolve,reject)=>{
  signal.throwIfAborted();const stop=()=>{clearTimeout(timer);reject(signal.reason);},timer=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve();},1500);signal.addEventListener('abort',stop,{once:true});
 });
}
/** Uses the real cover, ticket, entry lifecycle and the scene already mounted by the editor. */
export function NativeEntranceHost({intent,owner,authenticate,stage}:{intent:EntrancePreviewIntent;owner:NativeEntrancePreview;authenticate:(frame:NativeViewportFrame,signal:AbortSignal)=>Promise<void>;stage?:EntranceStage}){
 const entry=useEntranceEntry(),root=useRef<HTMLDivElement>(null),status=useRef<HTMLParagraphElement>(null);
 const exhibition=useMemo(()=>previewExhibition(intent),[intent]),publication=useMemo(()=>({exhibition}),[exhibition]);
 const [systemReduced,setSystemReduced]=useState(()=>matchMedia('(prefers-reduced-motion:reduce)').matches);
 const reduced=intent.request.reducedMotion||systemReduced,compact=intent.request.device==='mobile',runtime=entranceRuntime(exhibition,reduced,compact),content=entranceContent(exhibition,intent.request.locale??undefined,compact);
 const still=spaceStillFor(exhibition),selectedStill=!!still&&runtime.settings.imageAssetId?.toLowerCase()===still.id.toLowerCase();
 const [imageStatus,setImageStatus]=useState<ThemeProps['image']['status']>(()=>runtime.settings.imageAssetId?'loading':'absent'),[enteredScene,setEnteredScene]=useState(false);
 const source=useMemo(()=>{
  const approved=nativeEntranceCoverSource(intent.frame,signal=>authenticate(intent.frame,signal));
  return {image:async(assetId:string,signal:AbortSignal)=>{
   if(intent.request.scenario==='image-failed')throw Error('ENTRANCE_PREVIEW_IMAGE_SCENARIO');
   // E cannot substitute an artwork for the still-open qualified space-media path.
   if(runtime.design.theme==='threshold'&&(!selectedStill||assetId.toLowerCase()!==still?.id.toLowerCase()))throw Error('ENTRANCE_PREVIEW_SPACE_IMAGE_REQUIRED');
   if(intent.request.scenario==='slow')await previewDelay(signal);return approved.image(assetId,signal);
  }};
 },[intent,authenticate,runtime.design.theme,selectedStill,still?.id]);
 const observed=useRef({mode:entry.mode,ready:entry.stageReady,imageStatus,reduced});observed.current={mode:entry.mode,ready:entry.stageReady,imageStatus,reduced};
 useEffect(()=>{
  const html=root.current?.ownerDocument.documentElement;if(!html)return;
  const present=html.classList.contains('native-entrance-active');html.classList.add('native-entrance-active');return()=>{if(!present)html.classList.remove('native-entrance-active');};
 },[]);
 useEffect(()=>{
  const media=matchMedia('(prefers-reduced-motion:reduce)'),changed=()=>{setSystemReduced(media.matches);owner.invalidate();};media.addEventListener('change',changed);return()=>media.removeEventListener('change',changed);
 },[owner]);
 useEffect(()=>{if(intent.request.type==='walk')entry.begin();},[intent,entry.begin]);
 useEffect(()=>{
  if(entry.mode!=='3d')return;
  let cancelled=false;setEnteredScene(false);
  void (async()=>{if(intent.request.scenario==='slow')await previewDelay(intent.signal);intent.signal.throwIfAborted();await intent.scope.enter(intent.signal);if(!cancelled)setEnteredScene(true);})().catch(error=>{
   if(!cancelled&&!intent.signal.aborted){entry.onStageState({ready:false,error:true,message:'이 공간에서 걷기를 준비할 수 없어요.',phase:'navigation'});if(intent.request.type==='walk')owner.failed(intent,error);}
  });
  return()=>{cancelled=true;intent.scope.cancelEntry();};
 },[intent,entry.mode,entry.entryAttempt,entry.onStageState,owner]);
 useEffect(()=>{if(stage&&enteredScene&&entry.mode==='3d')entry.onStageState(stage);},[stage,enteredScene,entry.mode,entry.onStageState]);
 useEffect(()=>{if(entry.mode==='text')root.current?.querySelector<HTMLElement>('#native-preview-text')?.focus({preventScroll:true});},[entry.mode]);
 useEffect(()=>{
  if(!root.current||intent.signal.aborted)return;
  const wanted=intent.request.type==='walk'?'3d':'cover';if(entry.mode!==wanted||(wanted==='3d'&&(!entry.stageReady||imageStatus!=='absent'))||(wanted==='cover'&&!['absent','ready','failed'].includes(imageStatus)))return;
  const abort=new AbortController(),signal=AbortSignal.any([intent.signal,abort.signal]);
  void waitForCoverLayout(root.current,signal).then(()=>{
   owner.ready(intent,():EntrancePreviewMeasurement=>{
    const element=root.current,current=observed.current;if(!element?.isConnected||signal.aborted||current.mode!==wanted||(wanted==='3d'&&!current.ready)||!['absent','ready','failed'].includes(current.imageStatus))throw Error('ENTRANCE_PREVIEW_STALE');
    const box=element.getBoundingClientRect();return {mode:wanted==='3d'?'walk':'cover',renderGeneration:intent.generation,imageStatus:current.imageStatus as 'absent'|'ready'|'failed',viewport:{width:innerWidth,height:innerHeight},snapshotRect:{x:box.x,y:box.y,width:box.width,height:box.height}};
   });
  }).catch(error=>{if(!abort.signal.aborted&&!intent.signal.aborted)owner.failed(intent,error);});
  return()=>abort.abort();
 },[intent,owner,entry.mode,entry.stageReady,imageStatus]);
 const cancel=()=>{intent.scope.cancelEntry();entry.cancel();requestAnimationFrame(()=>entry.entryButton.current?.focus({preventScroll:true}));};
 const showText=()=>{intent.scope.cancelEntry();entry.cancel('text');};
 return <div ref={root} className={`native-entrance-preview publication-shell publication-mode-${entry.mode}`} data-native-entrance-generation={intent.generation} data-entry-ready={entry.stageReady} data-reduced-motion={reduced}>
  <div className="publication-cover-surface" style={entry.entryTicketRect?{'--entry-ticket-left':`${entry.entryTicketRect.left}px`,'--entry-ticket-top':`${entry.entryTicketRect.top}px`,'--entry-ticket-width':`${entry.entryTicketRect.width}px`,'--entry-ticket-height':`${entry.entryTicketRect.height}px`} as CSSProperties:undefined} data-entering={entry.mode==='3d'} hidden={entry.mode==='text'} inert={entry.mode==='3d'} aria-hidden={entry.mode==='3d'}>
   <EntranceCover publication={publication} source={source} locale={intent.request.locale??undefined} showImage={entry.mode!=='text'&&!entry.stageReady} interactive={entry.mode==='cover'} motion={!reduced} onImageState={setImageStatus}
    ticket={<EntryTicket title={runtime.settings.presentation?.ticketTitle||content.title} active={entry.mode==='3d'} animate={runtime.effects.response!=='none'} unavailable={false} variant={runtime.variant} showDate={runtime.design.ticket.showDate} showTime={runtime.design.ticket.showTime} buttonRef={entry.entryButton} onEnter={()=>entry.begin()}/>}>
    <a href="#native-preview-text" onClick={event=>{event.preventDefault();showText();}}>텍스트로 관람</a>
   </EntranceCover>
  </div>
  {entry.mode==='3d'&&<EntranceEntryOverlay key={entry.entryAttempt} entry={entry} transition={runtime.effects.transition} speed={runtime.effects.speed} statusRef={status} onCancel={cancel} onText={showText}/>}
  {entry.mode==='text'&&<section id="native-preview-text" tabIndex={-1}><h1>{content.title}</h1><p>{content.artist}</p><p>{content.introduction}</p><button onClick={cancel}>전시 표지로</button>{exhibition.artworks.map(art=><article key={art.revisionId}><h2>{art.metadata.title}</h2><p>{art.metadata.artist}</p><p>{art.metadata.description}</p><p>{art.rights.creditLine}</p></article>)}</section>}
 </div>;
}
