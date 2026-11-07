// SPDX-License-Identifier: AGPL-3.0-or-later
import type {ViewingActions,ViewingItem,ViewingState,ViewingStyle} from './viewing-session';
import './viewing-styles.css';
import {OrderedArtworkList} from './OrderedArtworkList';

/** Presentation only: the existing viewing session owns admission and camera state. */
export function ViewingStyles({state,items,actions,available,variant='menu'}:{
 state:ViewingState & {pendingStyle?:ViewingStyle};items:readonly ViewingItem[];actions:ViewingActions;available:boolean;variant?:'cover'|'menu';
}){
 const current=items.findIndex(item=>item.placementId.toLowerCase()===state.currentPlacementId?.toLowerCase());
 const pending=state.status==='preparing',choice=state.pendingStyle??state.style;
 return <section className="viewer-viewing-styles" aria-label="관람 방식">
  <h2 tabIndex={-1}>관람 방식</h2>
  <div className="viewer-viewing-styles-options" role="group" aria-label="관람 방식 선택">
   <button type="button" aria-pressed={choice==='free'} onClick={()=>actions.setStyle('free')}>자유롭게 관람</button>
   <button type="button" aria-pressed={choice==='ordered'} disabled={!available} onClick={()=>actions.setStyle('ordered')}>순서대로 관람</button>
  </div>
  {!available&&<p>순서대로 관람할 수 있는 위치가 아직 준비되지 않았어요.</p>}
  {state.message&&<p role={state.status==='blocked'?'alert':'status'}>{state.message}</p>}
  {variant==='menu'&&choice==='ordered'&&<>
   <OrderedArtworkList state={state} items={items} onSelect={actions.select}/>
   <div className="viewer-viewing-styles-navigation">
    <button type="button" disabled={pending||current<=0} onClick={()=>actions.step(-1)}>이전 작품</button>
    <button type="button" disabled={pending||current<0||current>=items.length-1} onClick={()=>actions.step(1)}>다음 작품</button>
    {pending&&<button type="button" onClick={actions.cancel}>이동 취소</button>}
   </div>
  </>}
 </section>;
}
