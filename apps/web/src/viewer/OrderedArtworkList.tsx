// SPDX-License-Identifier: AGPL-3.0-or-later
import type {ViewingItem,ViewingState} from './viewing-session';
/** Shared ordered items: the session remains the only owner of current and pending selection. */
export function OrderedArtworkList({state,items,onSelect}:{state:ViewingState;items:readonly ViewingItem[];onSelect:(id:string)=>void}){
 return <ol className="viewer-viewing-styles-list" aria-label="관람 순서">{items.map((item,index)=>{
  const selected=item.placementId.toLowerCase()===state.currentPlacementId?.toLowerCase();
  const waiting=item.placementId.toLowerCase()===state.pendingPlacementId?.toLowerCase();
  return <li key={item.placementId}><button type="button" aria-current={selected?'step':undefined} onClick={()=>onSelect(item.placementId)}>
   {item.thumbnail&&<img src={item.thumbnail} alt="" loading="lazy"/>}
   <span><span className="viewer-viewing-styles-title">{index+1}. {item.title}</span><span className="viewer-viewing-styles-room">{item.roomName}</span>{selected&&<span>현재 작품</span>}{waiting&&<span>이동 준비 중</span>}</span>
  </button></li>;
 })}</ol>;
}
