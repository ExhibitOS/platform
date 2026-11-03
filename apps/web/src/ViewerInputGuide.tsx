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

export function ViewerInputGuide({mode,replayed,onDismiss,requestSequence=0,viewingStyle='free'}:{mode:ResolvedViewerInputMode;replayed:boolean;onDismiss:()=>void;requestSequence?:number;viewingStyle?:'free'|'ordered'}){
 const panel=useRef<HTMLDetailsElement>(null),summary=useRef<HTMLElement>(null),previous=useRef<HTMLElement|null>(null),id=useId();
 const [open,setOpen]=useState(false),[input,setInput]=useState<'keys'|'touch'>(mode==='touch'?'touch':'keys');
 useEffect(()=>{if(!requestSequence&&!replayed)return;previous.current=document.activeElement instanceof HTMLElement?document.activeElement:null;if(panel.current)panel.current.open=true;},[requestSequence,replayed]);
 const close=()=>{if(panel.current)panel.current.open=false;const target=previous.current;((target?.isConnected&&!target.closest('details:not([open])'))?target:summary.current)?.focus({preventScroll:true});};
 const keys=input==='keys',free=viewingStyle==='free';
 return <details ref={panel} className="viewer-input-help" name="exhibitos-visitor-panel" data-visitor-panel open={open} onToggle={event=>{if(event.target!==event.currentTarget)return;setOpen(event.currentTarget.open);if(!event.currentTarget.open)onDismiss();}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}}} onPointerDown={event=>event.stopPropagation()} onPointerUp={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()}>
  <summary ref={summary} aria-label="조작 도움말" title="조작 도움말" aria-expanded={open} aria-controls={id}><ViewerIcon name={open?'close':'help'}/></summary>
  <div className="viewer-input-help-body" id={id}><h2>조작 도움말</h2>
   <div className="viewer-help-input" role="group" aria-label="도움말 입력 방식"><button type="button" aria-pressed={keys} onClick={()=>setInput('keys')}>키보드·마우스</button><button type="button" aria-pressed={!keys} onClick={()=>setInput('touch')}>터치</button></div>
   <ul className="viewer-help-rows">
    <li><span className="viewer-help-visual" aria-hidden="true">{free&&keys?<><kbd>W A S D</kbd><kbd>↑ ↓</kbd></>:<ViewerIcon name={free?'location':'fit'}/>}</span><span><strong>{free?'이동':'작품 이동'}</strong>{free?(keys?'이동을 시작한 뒤 W/A/S/D 또는 위·아래 방향키로 걸어요.':'이동을 시작한 뒤 아래 조이스틱을 밀어 걸어요. 손을 떼면 멈춰요.'):'메뉴의 순서대로 관람에서 이전·다음 작품을 고르세요.'}</span></li>
    <li><span className="viewer-help-visual" aria-hidden="true">{keys&&free?<kbd>← →</kbd>:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m5 8-3 4 3 4m14-8 3 4-3 4M3 12h18"/></svg>}</span><span><strong>{free?'둘러보기':'관람 전환'}</strong>{free?(keys?'화면을 누른 채 드래그하거나 왼쪽·오른쪽 방향키로 둘러봐요.':'다른 손가락으로 3D 화면을 드래그해 둘러봐요.'):'직접 이동하려면 메뉴에서 자유롭게 관람으로 바꾸세요.'}</span></li>
    <li><span className="viewer-help-visual" aria-hidden="true"><ViewerIcon name="plus"/></span><span><strong>작품 설명</strong>작품이나 목록에서 골라 설명을 확인해요. {free&&'지도에서도 고를 수 있어요.'}</span></li>
    <li><span className="viewer-help-visual" aria-hidden="true">{keys?<kbd>Esc</kbd>:<ViewerIcon name="paused"/>}</span><span><strong>멈추기</strong>{keys?'Esc나 화면 이탈로 멈춰요.':'화면을 벗어나면 이동과 소리가 멈춰요.'} {free?'멈춘 뒤에는 메뉴의 시점 조정에서 이동을 시작하거나 재개하세요.':'소리는 별도 소리 패널에서 선택해요.'}</span></li>
   </ul>
   {free&&keys&&<p className="viewer-help-note">마우스 시점 잡기는 관람 설정에서 직접 선택할 수 있어요. 스크롤은 걷기 조작이 아니에요.</p>}
  </div>
 </details>;
}
