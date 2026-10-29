// SPDX-License-Identifier: AGPL-3.0-or-later
import {useCallback,useEffect,useRef,useState,type CSSProperties,type RefObject} from 'react';
import type {EntranceTransitionEffect} from '@exhibitos/studio-contract';
import {EntryProgress} from './EntryProgress';
export interface EntranceStage {ready:boolean;message:string;error?:boolean;phase?:'space'|'artwork'|'navigation'}
/** One entry lifecycle for public viewing and authenticated native previews. */
export function useEntranceEntry(){
 const [mode,setMode]=useState<'cover'|'text'|'3d'>('cover'),modeRef=useRef(mode);modeRef.current=mode;
 const [stageReady,setStageReady]=useState(false),[entryFailed,setEntryFailed]=useState(false),[longEntry,setLongEntry]=useState(false);
 const [entryPhase,setEntryPhase]=useState<'space'|'artwork'|'navigation'>('space'),[stageMessage,setStageMessage]=useState('공간을 준비하고 있어요.');
 const [entryAttempt,setEntryAttempt]=useState(0),generation=useRef(0),entryButton=useRef<HTMLButtonElement>(null);
 const [entryTiming,setEntryTiming]=useState<{pressedAt:number;usableAt?:number}|null>(null),[entryTicketRect,setEntryTicketRect]=useState<{left:number;top:number;width:number;height:number}|null>(null);
 const begin=useCallback(()=>{
  if(modeRef.current==='3d')return false;
  const box=entryButton.current?.getBoundingClientRect();setEntryTicketRect(box?{left:box.left,top:box.top,width:box.width,height:box.height}:null);
  const current=++generation.current;modeRef.current='3d';setEntryAttempt(current);setEntryTiming({pressedAt:performance.now()});setStageReady(false);setEntryFailed(false);setLongEntry(false);setStageMessage('공간을 준비하고 있어요.');setEntryPhase('space');setMode('3d');return true;
 },[]);
 const cancel=useCallback((next:'cover'|'text'='cover')=>{generation.current++;modeRef.current=next;setStageReady(false);setEntryFailed(false);setLongEntry(false);setMode(next);},[]);
 const onStageState=useCallback((state:EntranceStage)=>{if(modeRef.current!=='3d'||entryAttempt!==generation.current)return;setStageMessage(state.message);if(state.phase)setEntryPhase(state.phase);if(state.error)setEntryFailed(true);if(state.ready){setEntryFailed(false);setStageReady(true);setEntryTiming(value=>value&&value.usableAt===undefined?{...value,usableAt:performance.now()}:value);}},[entryAttempt]);
 useEffect(()=>{if(mode!=='3d'||stageReady||entryFailed)return;const timer=setTimeout(()=>setLongEntry(true),8000);return()=>clearTimeout(timer);},[mode,stageReady,entryFailed,entryAttempt]);
 useEffect(()=>()=>{generation.current++;},[]);
 return {mode,modeRef,begin,cancel,stageReady,entryFailed,longEntry,entryPhase,stageMessage,entryAttempt,entryTiming,entryButton,entryTicketRect,onStageState};
}
export function EntranceEntryOverlay({entry,transition,speed,statusRef,onCancel,onText}:{entry:ReturnType<typeof useEntranceEntry>;transition:EntranceTransitionEffect;speed:number;statusRef:RefObject<HTMLParagraphElement|null>;onCancel:()=>void;onText:()=>void}){
 useEffect(()=>{if(!entry.stageReady&&!entry.entryFailed)statusRef.current?.focus({preventScroll:true});},[entry.stageReady,entry.entryFailed,entry.entryAttempt,statusRef]);
 return <div className="publication-entry-overlay" data-ready={entry.stageReady} data-transition={transition} style={{'--entry-transition-duration':`${(transition==='doors'?220:transition==='panels'?180:140)/speed}ms`} as CSSProperties} data-door-effect={transition!=='none'} data-failed={entry.entryFailed}>
  <div className="publication-entry-door" aria-hidden="true"><span className="publication-entry-door-left"/><span className="publication-entry-door-right"/></div>
  {!entry.stageReady&&<div className="publication-entry-recovery">
   <p className="publication-entry-progress" role={entry.entryFailed?'alert':'status'} ref={statusRef} tabIndex={-1}>{entry.entryFailed?'공간을 열지 못했어요. 입장을 취소한 뒤 다시 시도하거나 글로 관람할 수 있어요.':entry.longEntry?'공간 준비가 계속되고 있어요. 기다리거나 글로 관람할 수 있어요.':'전시장으로 들어가고 있어요.'}</p>
   <EntryProgress active={!entry.entryFailed} phase={entry.entryPhase}/>
   <div className="publication-entry-secondary"><button onClick={onCancel}>입장 취소</button><button onClick={onText}>텍스트로 관람</button></div>
   <output hidden data-testid="entry-stage-diagnostics">{entry.stageMessage}</output>
  </div>}
 </div>;
}
