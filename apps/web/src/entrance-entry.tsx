// SPDX-License-Identifier: AGPL-3.0-or-later
import {useCallback,useEffect,useRef,useState,type CSSProperties,type RefObject} from 'react';
import type {EntranceTransitionEffect} from '@exhibitos/studio-contract';
import {EntryProgress,type EntryDownloadProgress} from './EntryProgress';
import type {entranceRuntime} from './entrance-runtime';
export interface EntranceStage {ready:boolean;message:string;error?:boolean;phase?:'space'|'artwork'|'navigation'}
/** A public cover theme alone does not request a door-opening effect. */
export function publicEntryTransition(runtime?:ReturnType<typeof entranceRuntime>|null):EntranceTransitionEffect {
 if(!runtime||(!runtime.authored&&runtime.settings.presentation===undefined))return 'none';
 const inheritedDoor=runtime.authored&&runtime.design.effects.transition==='doors'&&
  runtime.settings.design?.effects?.transition===undefined;
 return inheritedDoor?'none':runtime.effects.transition;
}
/** Keep controls quiet during entry, but make the existing recovery settings reachable after an error. */
export function entryControlsBlocked(mode:'cover'|'text'|'3d',stageReady:boolean,viewerUnavailable:boolean,entryFailed:boolean){return mode==='3d'&&!stageReady&&!viewerUnavailable&&!entryFailed;}
/** One entry lifecycle for public viewing and authenticated native previews. */
export function useEntranceEntry(){
 const [mode,setMode]=useState<'cover'|'text'|'3d'>('cover'),modeRef=useRef(mode);modeRef.current=mode;
 const [stageReady,setStageReady]=useState(false),[entryFailed,setEntryFailed]=useState(false);
 const [stageMessage,setStageMessage]=useState('공간을 준비하고 있어요.');
 const [entryAttempt,setEntryAttempt]=useState(0),generation=useRef(0),entryButton=useRef<HTMLButtonElement>(null);
 const [entryTiming,setEntryTiming]=useState<{pressedAt:number;usableAt?:number}|null>(null),[entryTicketRect,setEntryTicketRect]=useState<{left:number;top:number;width:number;height:number}|null>(null);
 const begin=useCallback(()=>{
  if(modeRef.current==='3d')return false;
  const box=entryButton.current?.getBoundingClientRect();setEntryTicketRect(box?{left:box.left,top:box.top,width:box.width,height:box.height}:null);
  const current=++generation.current;modeRef.current='3d';setEntryAttempt(current);setEntryTiming({pressedAt:performance.now()});setStageReady(false);setEntryFailed(false);setStageMessage('공간을 준비하고 있어요.');setMode('3d');return true;
 },[]);
 const cancel=useCallback((next:'cover'|'text'='cover')=>{generation.current++;modeRef.current=next;setStageReady(false);setEntryFailed(false);setMode(next);},[]);
 const onStageState=useCallback((state:EntranceStage)=>{if(modeRef.current!=='3d'||entryAttempt!==generation.current)return;setStageMessage(state.message);if(state.error)setEntryFailed(true);if(state.ready){setEntryFailed(false);setStageReady(true);setEntryTiming(value=>value&&value.usableAt===undefined?{...value,usableAt:performance.now()}:value);}},[entryAttempt]);
 useEffect(()=>()=>{generation.current++;},[]);
 return {mode,modeRef,begin,cancel,stageReady,entryFailed,stageMessage,entryAttempt,entryTiming,entryButton,entryTicketRect,onStageState};
}
export function EntranceEntryOverlay({entry,transition,speed,statusRef,focusStatus,onCancel,onText,download}:{entry:ReturnType<typeof useEntranceEntry>;transition:EntranceTransitionEffect;speed:number;statusRef:RefObject<HTMLParagraphElement|null>;focusStatus?:()=>boolean;onCancel:()=>void;onText:()=>void;download?:EntryDownloadProgress|null}){
 const cancelRef=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(!entry.stageReady&&!entry.entryFailed&&focusStatus?.()!==false)(statusRef.current??cancelRef.current)?.focus({preventScroll:true});},[entry.stageReady,entry.entryFailed,entry.entryAttempt,statusRef,focusStatus]);
 return <div className="publication-entry-overlay" data-ready={entry.stageReady} data-transition={transition} style={{'--entry-transition-duration':`${(transition==='doors'?220:transition==='panels'?180:140)/speed}ms`} as CSSProperties} data-door-effect={transition!=='none'} data-failed={entry.entryFailed}>
  {transition!=='none'&&<div className="publication-entry-door" aria-hidden="true"><span className="publication-entry-door-left"/><span className="publication-entry-door-right"/></div>}
  {!entry.stageReady&&<div className="publication-entry-recovery">
   {entry.entryFailed
    ? <p className="publication-entry-progress" role="alert" ref={statusRef} tabIndex={-1}>공간을 열지 못했어요. 메뉴에서 화면·화질 설정을 바꾸거나, 입장을 취소하거나, 글로 관람할 수 있어요.</p>
    : <EntryProgress download={download} statusRef={statusRef}/>}
   <div className="publication-entry-secondary"><button ref={cancelRef} onClick={onCancel}>입장 취소</button><button onClick={onText}>텍스트로 관람</button></div>
   <output hidden data-testid="entry-stage-diagnostics">{entry.stageMessage}</output>
  </div>}
 </div>;
}
