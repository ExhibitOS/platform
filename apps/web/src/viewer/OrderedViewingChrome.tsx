// SPDX-License-Identifier: AGPL-3.0-or-later
import {ViewerIcon} from './ViewerIcon';
import type {ViewingActions,ViewingItem,ViewingState} from './viewing-session';

/** A view of the committed session only; camera admission remains in the session. */
export function OrderedViewingChrome({state,items,actions,onList,listId}:{state:ViewingState;items:readonly ViewingItem[];actions:ViewingActions;onList:(opener:HTMLButtonElement)=>void;listId:string}){
 const index=items.findIndex(item=>item.placementId.toLowerCase()===state.currentPlacementId?.toLowerCase());
 if(state.style!=='ordered'||index<0)return null;
 const pending=state.status==='preparing';
 const step=(direction:-1|1)=>{if(!pending&&index+direction>=0&&index+direction<items.length)actions.step(direction);};
 return <nav className="viewer-ordered-chrome" aria-label="순서대로 관람" onPointerDown={event=>event.stopPropagation()} onPointerUp={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()}>
  <button type="button" className="viewer-ordered-previous" aria-label="이전 작품" title="이전 작품" aria-disabled={pending||index===0} onClick={()=>step(-1)}><ViewerIcon name="previous"/></button>
  <button type="button" className="viewer-ordered-next" aria-label="다음 작품" title="다음 작품" aria-disabled={pending||index===items.length-1} onClick={()=>step(1)}><ViewerIcon name="next"/></button>
  <div className="viewer-ordered-caption"><span className="viewer-ordered-title" title={items[index]!.title}>{items[index]!.title}</span><button type="button" className="viewer-ordered-list" aria-label="관람 순서 목록 열기" aria-controls={listId} title="관람 순서 목록 열기" onClick={event=>onList(event.currentTarget)}><ViewerIcon name="list"/></button></div>
  {state.message&&<div className="viewer-ordered-status"><p role={state.status==='blocked'?'alert':'status'}>{state.message}</p>{pending&&<button type="button" onClick={actions.cancel}>이동 취소</button>}</div>}
 </nav>;
}
