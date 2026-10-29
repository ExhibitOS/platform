// SPDX-License-Identifier: AGPL-3.0-or-later
import type {MapTarget,VisitorMap} from './visitor-map';
export interface MapDestination {id:string;roomId:string;name:string}
export interface MapTravelState {status:'idle'|'preparing'|'blocked';message:string;pendingViewpointId?:string}
export interface MapVisit {roomId:string;viewpointId:string;placementId?:string}
export interface MapTravelBridge {visit(request:MapVisit,signal:AbortSignal):Promise<boolean>}
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
/** One explicit map request. Shared loading and the existing camera owner make
 * the final readiness/clearance decision; this adapter never stores a pose.
 */
export function createMapTravel(map:VisitorMap,destinations:readonly MapDestination[],bridge:()=>MapTravelBridge|null,changed:(state:MapTravelState)=>void) {
 let generation=0,active:AbortController|undefined,disposed=false;
 const publish=(state:MapTravelState)=>{if(!disposed)changed(state);};
 const abort=()=>{generation++;active?.abort();active=undefined;};
 return {
  async go(target:MapTarget,viewpointId:string):Promise<boolean> {
   if(disposed)return false;
   abort();
   const row=target.kind==='room'?map.rooms.find(r=>same(r.id,target.id)):map.placements.find(p=>same(p.id,target.id));
   const roomId=row&&(target.kind==='room'?row.id:('roomId'in row?row.roomId:undefined));
   const destination=destinations.find(v=>same(v.id,viewpointId)&&!!roomId&&same(v.roomId,roomId));
   const renderer=bridge();
   if(!row||!roomId||!destination||!renderer){publish({status:'blocked',message:'이 위치로 이동할 수 없어요. 현재 위치와 작품 목록을 유지해요.'});return false;}
   const controller=new AbortController(),token=generation;active=controller;
   publish({status:'preparing',pendingViewpointId:destination.id,message:'관람 위치를 준비하고 있어요. 현재 화면은 그대로 유지해요.'});
   try {
    const moved=await renderer.visit({roomId,viewpointId:destination.id,...(target.kind==='placement'?{placementId:row.id}:{})},controller.signal);
    if(disposed||token!==generation||controller.signal.aborted)return false;
    publish(moved?{status:'idle',message:'선택한 관람 위치입니다. 걷기는 직접 재개하세요.'}:{status:'blocked',message:'이 관람 위치를 준비하지 못했어요. 현재 위치를 유지해요. 다른 위치나 작품 목록을 이용할 수 있어요.'});
    return moved;
   }catch{
    if(!disposed&&token===generation&&!controller.signal.aborted)publish({status:'blocked',message:'이 관람 위치를 준비하지 못했어요. 현재 위치를 유지해요.'});
    return false;
   }finally{if(active===controller)active=undefined;}
  },
  cancel(){if(disposed)return;const pending=!!active;abort();publish({status:'idle',message:pending?'이동 준비를 취소했어요. 현재 위치를 유지해요.':''});},
  dispose(){abort();disposed=true;},
 };
}
