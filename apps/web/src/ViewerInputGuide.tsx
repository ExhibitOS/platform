// SPDX-License-Identifier: AGPL-3.0-or-later
import {useEffect,useId,useRef,useState} from "react";
import {ViewerIcon} from './viewer/ViewerIcon';

export type ViewerInputMode = "auto" | "pointer" | "trackpad" | "touch";
export type ResolvedViewerInputMode = Exclude<ViewerInputMode, "auto">;

// A browser exposes a coarse pointer, not a reliable mouse/trackpad distinction.
// Fine-pointer devices start with the existing drag controls, without capture.
export function resolveViewerInputMode(mode: ViewerInputMode, coarse: boolean): ResolvedViewerInputMode {
  return mode === "auto" ? coarse ? "touch" : "trackpad" : mode;
}

export const viewerInputInstructions: Record<ResolvedViewerInputMode, string> = {
  pointer: "W/A/S/D 또는 ↑/↓로 걷고, 화면을 누른 채 드래그하거나 ←/→로 둘러보세요. 원하면 메뉴의 ‘마우스 시점 잡기’를 직접 선택하세요.",
  trackpad: "W/A/S/D 또는 ↑/↓로 걷고, 마우스나 트랙패드를 누른 채 드래그하거나 ←/→로 둘러보세요. 스크롤은 걷기 조작이 아니에요.",
  touch: "아래 가운데 조이스틱을 밀어 걷고, 다른 손가락으로 3D 화면을 드래그해 둘러보세요. 조금 밀면 천천히 움직이고, 손을 떼면 멈춰요.",
};

function MovementKeys({pressed=new Set<string>()}:{pressed?:ReadonlySet<string>}){
 return <span className="viewer-help-keypad">{['w','a','s','d'].map(key=><kbd key={key} data-key={key} data-active={pressed.has(key)}>{key.toUpperCase()}</kbd>)}</span>;
}
function MouseDiagram(){return <svg className="viewer-help-mouse" viewBox="0 0 32 40" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="8" y="2" width="16" height="32" rx="8"/><path d="M16 2v11M8 14h16M3 15l-2 3 2 3m26-6 2 3-2 3"/></svg>;}
export interface HintPose{position:readonly number[];yaw:number;pitch:number;walking:boolean;paused:boolean}
export type ObserveHintActivity=(listener:(pose:HintPose)=>void)=>()=>void;
interface HintLifetime{startedAt?:number;first?:number;done:boolean}
function DesktopHints({onComplete,reducedMotion,observeActivity,lifetime,onShown}:{onComplete:()=>void;reducedMotion:boolean;observeActivity?:ObserveHintActivity;lifetime:HintLifetime;onShown?:()=>void}){
 const root=useRef<HTMLDivElement>(null),done=useRef(lifetime.done),complete=useRef(onComplete);complete.current=onComplete;
 const [pressed,setPressed]=useState<Set<string>>(new Set()),[fading,setFading]=useState(false),[mouseHidden,setMouseHidden]=useState(false);
 useEffect(()=>{
  const started=lifetime.startedAt??performance.now();if(lifetime.startedAt===undefined){lifetime.startedAt=started;onShown?.();}let lastMoveInput=-Infinity,lastLookInput=-Infinity,previousPose:number[]|undefined;let first=lifetime.first,endTimer:ReturnType<typeof setTimeout>,fadeTimer:ReturnType<typeof setTimeout>,pointer:{id:number;x:number;y:number}|undefined;
  const clearKeys=()=>setPressed(new Set());
  const finish=()=>{if(done.current)return;done.current=true;lifetime.done=true;clearTimeout(endTimer);clearTimeout(fadeTimer);clearKeys();complete.current();};
  const schedule=()=>{clearTimeout(endTimer);clearTimeout(fadeTimer);const deadline=Math.min(started+10000,first===undefined?Infinity:first+5000),now=performance.now();fadeTimer=setTimeout(()=>setFading(true),Math.max(0,deadline-now-1000));endTimer=setTimeout(finish,Math.max(0,deadline-now));};
  const shell=root.current?.closest('.publication-shell');
  const blocked=()=>document.hidden||!!shell?.querySelector('.publication-menu[open],.viewer-audio-menu[open],.viewer-input-help[open],.viewer-visitor-map[open],dialog[open]');
  const canvas=(target:EventTarget|null)=>target instanceof HTMLCanvasElement&&target.getAttribute('aria-label')==='전시 공간 3D 미리보기';
  const valid=()=>{if(first===undefined){first=performance.now();lifetime.first=first;schedule();}};
  const unobserve=observeActivity?.(pose=>{const next=[pose.position[0]??0,pose.position[2]??0,pose.yaw,pose.pitch];if(previousPose&&!blocked()){const now=performance.now(),moved=pose.walking&&!pose.paused&&now-lastMoveInput<600&&Math.hypot(next[0]!-previousPose[0]!,next[1]!-previousPose[1]!)>1e-4,looked=now-lastLookInput<600&&(Math.abs(next[2]!-previousPose[2]!)>1e-4||Math.abs(next[3]!-previousPose[3]!)>1e-4);if(moved||looked)valid();}previousPose=next;});
  const keyDown=(event:KeyboardEvent)=>{const key=event.key.toLowerCase();if(!event.isTrusted||event.ctrlKey||event.metaKey||event.altKey||blocked()||!canvas(event.target)||!['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(key))return;if(['arrowleft','arrowright'].includes(key))lastLookInput=performance.now();else lastMoveInput=performance.now();if(['w','a','s','d'].includes(key))setPressed(keys=>new Set([...keys,key]));};
  const keyUp=(event:KeyboardEvent)=>setPressed(keys=>{const next=new Set(keys);next.delete(event.key.toLowerCase());return next;});
  const down=(event:globalThis.PointerEvent)=>{if(event.isTrusted&&event.button===0&&canvas(event.target)&&!blocked())pointer={id:event.pointerId,x:event.clientX,y:event.clientY};};
  const move=(event:globalThis.PointerEvent)=>{if(pointer?.id===event.pointerId&&event.isTrusted&&!blocked()&&Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>3){lastLookInput=performance.now();setMouseHidden(true);}};
  const up=()=>{pointer=undefined;};
  const panel=()=>{if(blocked())finish();};
  if(reducedMotion){unobserve?.();finish();return;}
  const mini=shell?.querySelector<HTMLElement>('.viewer-visitor-map>summary');
  const size=()=>{const width=mini?.getBoundingClientRect().width;if(width&&root.current)root.current.style.setProperty('--first-hint-width',`${width*1.15}px`);};
  size();const resize=mini&&typeof ResizeObserver!=='undefined'?new ResizeObserver(size):undefined;if(mini)resize?.observe(mini);
  schedule();document.addEventListener('keydown',keyDown);document.addEventListener('keyup',keyUp);document.addEventListener('pointerdown',down);document.addEventListener('pointermove',move);document.addEventListener('pointerup',up);document.addEventListener('pointercancel',up);document.addEventListener('visibilitychange',panel);window.addEventListener('blur',finish);shell?.addEventListener('toggle',panel,true);
  return()=>{resize?.disconnect();unobserve?.();clearTimeout(endTimer);clearTimeout(fadeTimer);document.removeEventListener('keydown',keyDown);document.removeEventListener('keyup',keyUp);document.removeEventListener('pointerdown',down);document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',up);document.removeEventListener('visibilitychange',panel);window.removeEventListener('blur',finish);shell?.removeEventListener('toggle',panel,true);};
 },[reducedMotion,observeActivity]);
 return reducedMotion||lifetime.done||(lifetime.startedAt!==undefined&&performance.now()>=Math.min(lifetime.startedAt+10000,lifetime.first===undefined?Infinity:lifetime.first+5000))?null:<div ref={root} className="viewer-first-hints" data-fading={fading} aria-hidden="true"><span className="viewer-first-keys"><MovementKeys pressed={pressed}/></span>{!mouseHidden&&<span className="viewer-first-mouse"><MouseDiagram/><span>드래그해 둘러보기</span></span>}</div>;
}
function GuideRows({keys,free,brief=false}:{keys:boolean;free:boolean;brief?:boolean}){
 return <ul className="viewer-help-rows">
  <li><span className="viewer-help-visual" aria-hidden="true">{free&&keys?<><MovementKeys/><kbd>↑ ↓</kbd></>:<ViewerIcon name={free?'location':'fit'}/>}</span><span><strong>{free?'이동':'작품 이동'}</strong>{free?(keys?(brief?'이동 시작 후 W/A/S/D·↑↓로 걸어요.':'이동을 시작한 뒤 W/A/S/D 또는 위·아래 방향키로 걸어요.'):(brief?'이동 시작 후 조이스틱을 밀어요.':'이동을 시작한 뒤 아래 조이스틱을 밀어 걸어요. 손을 떼면 멈춰요.')):(brief?'메뉴에서 이전·다음 작품을 골라요.':'메뉴의 순서대로 관람에서 이전·다음 작품을 고르세요.')}</span></li>
  <li><span className="viewer-help-visual" aria-hidden="true">{keys&&free?<><MouseDiagram/><kbd>← →</kbd></>:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m5 8-3 4 3 4m14-8 3 4-3 4M3 12h18"/></svg>}</span><span><strong>{free?'둘러보기':'관람 전환'}</strong>{free?(keys?(brief?'드래그·←→로 둘러봐요.':'화면을 누른 채 드래그하거나 왼쪽·오른쪽 방향키로 둘러봐요.'):(brief?'화면을 드래그해 둘러봐요.':'다른 손가락으로 3D 화면을 드래그해 둘러봐요.')):(brief?'직접 이동은 자유롭게 관람에서 해요.':'직접 이동하려면 메뉴에서 자유롭게 관람으로 바꾸세요.')}</span></li>
  <li><span className="viewer-help-visual" aria-hidden="true"><ViewerIcon name="plus"/></span><span><strong>작품 설명</strong>{brief?'작품을 눌러 설명을 봐요.':<>작품이나 목록에서 골라 설명을 확인해요. {free&&'지도에서도 고를 수 있어요.'}</>}</span></li>
  {!brief&&<li><span className="viewer-help-visual" aria-hidden="true">{keys?<kbd>Esc</kbd>:<ViewerIcon name="paused"/>}</span><span><strong>멈추기</strong>{keys?'Esc나 화면 이탈로 멈춰요.':'화면을 벗어나면 이동과 소리가 멈춰요.'} {free?'멈춘 뒤에는 메뉴의 시점 조정에서 이동을 시작하거나 재개하세요.':'소리는 별도 소리 패널에서 선택해요.'}</span></li>}
 </ul>;
}
export function ViewerInputGuide({mode,replayed,onDismiss,requestSequence=0,viewingStyle='free',showIntro=false,ready=false,choiceRequired=false,orderedAvailable=false,onChoicePresented,onChooseStyle,reducedMotion=false,observeActivity,hintAlreadyShown=false,onHintShown}:{mode:ResolvedViewerInputMode;replayed:boolean;onDismiss:()=>void;requestSequence?:number;viewingStyle?:'free'|'ordered';showIntro?:boolean;ready?:boolean;choiceRequired?:boolean;orderedAvailable?:boolean;onChoicePresented?:()=>void;onChooseStyle?:(style:'free'|'ordered')=>void;reducedMotion?:boolean;observeActivity?:ObserveHintActivity;hintAlreadyShown?:boolean;onHintShown?:()=>void}){
 const panel=useRef<HTMLDetailsElement>(null),summary=useRef<HTMLElement>(null),heading=useRef<HTMLHeadingElement>(null),previous=useRef<HTMLElement|null>(null),explicit=useRef(false),id=useId();
 const initialHintSeen=useRef(hintAlreadyShown),hintLifetime=useRef<HintLifetime>({done:false});
 const [hintCompleted,setHintCompleted]=useState(false);
 const [open,setOpen]=useState(false),[phase,setPhase]=useState<'choice'|'help'>('help'),[panelTick,setPanelTick]=useState(0),[input,setInput]=useState<'keys'|'touch'>(mode==='touch'?'touch':'keys');
 const [autoChoiceNotice,setAutoChoiceNotice]=useState(false),autoChoiceRetired=useRef(false),cancelAutoChoice=useRef<()=>void>(()=>{});
 const keys=input==='keys',free=viewingStyle==='free';
 const cancelChoice=()=>{autoChoiceRetired.current=true;setAutoChoiceNotice(false);cancelAutoChoice.current();};
 const callbacks=useRef({onChoicePresented,onChooseStyle,choiceRequired});callbacks.current={onChoicePresented,onChooseStyle,choiceRequired};
 useEffect(()=>{const root=panel.current?.closest('.publication-shell');if(!root)return;const changed=()=>setPanelTick(t=>t+1);root.addEventListener('toggle',changed,true);document.addEventListener('visibilitychange',changed);return()=>{root.removeEventListener('toggle',changed,true);document.removeEventListener('visibilitychange',changed);};},[]);
 useEffect(()=>{if(!requestSequence&&!replayed)return;previous.current=document.activeElement instanceof HTMLElement?document.activeElement:null;explicit.current=false;setPhase('help');if(panel.current)panel.current.open=true;queueMicrotask(()=>{if(panel.current?.open)heading.current?.focus({preventScroll:true});});if(callbacks.current.choiceRequired)callbacks.current.onChoicePresented?.();},[requestSequence,replayed]);
 useEffect(()=>{
  if(!ready||!choiceRequired||document.hidden||panel.current?.open)return;
  const root=panel.current?.closest('.publication-shell');
  const other=[...(root?.querySelectorAll<HTMLDetailsElement>('details[data-visitor-panel][open]')??[])].some(p=>p!==panel.current&&!p.closest('[hidden],[inert]'));
  if(other)return;
  previous.current=document.activeElement instanceof HTMLElement?document.activeElement:null;explicit.current=false;setPhase('choice');if(panel.current)panel.current.open=true;queueMicrotask(()=>{if(panel.current?.open)heading.current?.focus({preventScroll:true});});callbacks.current.onChoicePresented?.();
 },[ready,choiceRequired,panelTick]);
 useEffect(()=>{
  if(!open||phase!=='choice'||!ready||!free||autoChoiceRetired.current)return;
  let started=false,timer:ReturnType<typeof setTimeout>|undefined;
  const stop=(retire=true)=>{if(retire)autoChoiceRetired.current=true;cancelAnimationFrame(frame);clearTimeout(timer);setAutoChoiceNotice(false);};
  cancelAutoChoice.current=stop;
  const hidden=()=>{if(document.hidden)stop();};
  const blur=()=>stop();
  const root=panel.current?.closest('.publication-shell'),reading=(event:Event)=>{if(event.isTrusted)stop();};
  const frame=requestAnimationFrame(()=>{
   if(!panel.current?.open||document.hidden||!panel.current.getClientRects().length){stop();return;}
   started=true;setAutoChoiceNotice(true);
   timer=setTimeout(()=>{if(autoChoiceRetired.current||document.hidden||!panel.current?.open||panel.current.dataset.helpPhase!=='choice'){stop();return;}choose('free');},8000);
  });
  document.addEventListener('visibilitychange',hidden);window.addEventListener('blur',blur);root?.addEventListener('wheel',reading,{capture:true,passive:true});root?.addEventListener('scroll',reading,{capture:true,passive:true});
  return()=>{stop(started);if(cancelAutoChoice.current===stop)cancelAutoChoice.current=()=>{};document.removeEventListener('visibilitychange',hidden);window.removeEventListener('blur',blur);root?.removeEventListener('wheel',reading,true);root?.removeEventListener('scroll',reading,true);};
 },[open,phase,ready,free]);
 const restore=(choice=false)=>{const target=previous.current,canvas=document.querySelector<HTMLElement>('canvas[aria-label="전시 공간 3D 미리보기"]');(choice?canvas:(target?.isConnected&&!target.closest('details:not([open]),[inert],[hidden]'))?target:summary.current)?.focus({preventScroll:true});};
 const close=()=>{if(phase==='choice'){choose('free');return;}cancelChoice();explicit.current=true;if(panel.current)panel.current.open=false;restore();};
 const dismissIntro=()=>{onDismiss();document.querySelector<HTMLElement>('canvas[aria-label="전시 공간 3D 미리보기"]')?.focus({preventScroll:true});};
 useEffect(()=>{const lifetime=hintLifetime.current;if(lifetime.startedAt!==undefined&&!lifetime.done&&(!showIntro||open||mode==='touch'||!free)){lifetime.done=true;setHintCompleted(true);}},[showIntro,open,mode,free]);
 const choose=(style:'free'|'ordered')=>{if(style==='ordered'&&!orderedAvailable)return;cancelChoice();explicit.current=false;if(panel.current)panel.current.open=false;setPhase('help');callbacks.current.onChooseStyle?.(style);restore(true);};
 return <>
  {showIntro&&phase==='help'&&!open&&mode!=='touch'&&free&&!initialHintSeen.current&&!hintCompleted&&!hintLifetime.current.done&&<DesktopHints onComplete={()=>setHintCompleted(true)} reducedMotion={reducedMotion} observeActivity={observeActivity} lifetime={hintLifetime.current} onShown={onHintShown}/>}
  {showIntro&&phase==='help'&&!open&&!hintCompleted&&!initialHintSeen.current&&(mode==='touch'||!free)&&<aside className="viewer-input-brief" aria-label="가볍게 둘러보기" onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dismissIntro();}}}>
   <header><h2>가볍게 둘러보기</h2><button type="button" className="viewer-guide-close" aria-label="안내 닫고 관람하기" onClick={dismissIntro}><ViewerIcon name="close"/></button></header>
   <GuideRows keys={mode!=='touch'} free={free} brief/>
  </aside>}
  <details ref={panel} className="viewer-input-help" data-help-phase={phase} name="exhibitos-visitor-panel" data-visitor-panel open={open} onToggle={event=>{if(event.target!==event.currentTarget)return;setOpen(event.currentTarget.open);if(!event.currentTarget.open){if(explicit.current)onDismiss();explicit.current=false;}}} onFocusCapture={event=>{if(phase==='choice'&&!heading.current?.isSameNode(event.target))cancelChoice();}} onKeyDownCapture={event=>{if(phase==='choice'&&event.isTrusted)cancelChoice();}} onPointerDownCapture={event=>{if(phase==='choice'&&event.isTrusted)cancelChoice();}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}}} onPointerDown={event=>event.stopPropagation()} onPointerUp={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()}>
   <summary ref={summary} aria-label={open?(phase==='choice'?'선택 닫고 관람하기':'조작 도움말 닫기'):'조작 도움말'} title={open?'닫기':'조작 도움말'} aria-expanded={open} aria-controls={id} onClick={event=>{if(panel.current?.open){event.preventDefault();close();}else{explicit.current=false;setPhase('help');if(choiceRequired)callbacks.current.onChoicePresented?.();}}}><ViewerIcon name={open?'close':'help'}/></summary>
   <div className="viewer-input-help-body" id={id}>{phase==='choice'?<><h2 ref={heading} tabIndex={-1}>관람 방식을 골라보세요</h2><div className="viewer-help-choice-buttons"><button type="button" onClick={()=>choose('free')}>자유롭게 관람</button>{orderedAvailable?<button type="button" onClick={()=>choose('ordered')}>순서대로 관람</button>:<p>순서 관람 위치가 아직 준비되지 않았어요. 자유롭게 둘러볼 수 있어요.</p>}</div>{autoChoiceNotice&&<p className="viewer-help-choice-notice" role="status">8초 동안 선택하지 않으면 자유롭게 관람으로 이어져요.</p>}</>:<><h2 ref={heading} tabIndex={-1}>조작 도움말</h2>
    <div className="viewer-help-input" role="group" aria-label="도움말 입력 방식"><button type="button" aria-pressed={keys} onClick={()=>setInput('keys')}>키보드·마우스</button><button type="button" aria-pressed={!keys} onClick={()=>setInput('touch')}>터치</button></div>
    <GuideRows keys={keys} free={free}/>
    {free&&keys&&<p className="viewer-help-note">마우스 시점 잡기는 관람 설정에서 직접 선택할 수 있어요. 스크롤은 걷기 조작이 아니에요.</p>}
   </>} </div>
  </details>
 </>;
}
