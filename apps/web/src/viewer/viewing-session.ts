// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ViewingStop } from '@exhibitos/studio-contract';
export type ViewingStyle = 'free' | 'ordered';
export interface ViewingState {
 style: ViewingStyle;
 currentPlacementId?: string;
 pendingPlacementId?: string;
 status: 'idle' | 'preparing' | 'blocked';
 message: string;
}
export interface ViewingActions {
 setStyle(style: ViewingStyle): void;
 step(direction: -1 | 1): void;
 select(placementId: string): void;
 cancel(): void;
}
export interface ViewingItem { placementId: string; title: string; roomName: string; thumbnail?: string }
export interface ViewingRenderer {
 prepare(stop:ViewingStop,signal:AbortSignal):Promise<PreparedViewingStop>;
 free():boolean;
}
export interface PreparedViewingStop { commit(style: ViewingStyle): boolean; release(): void }
/** One visitor intent at a time. Asset loading/camera safety stay in the existing
 * renderer; this small adapter owns no decoder, scene, pose or authored draft.
 */
export function createViewingSession(options: {
 stops: readonly ViewingStop[];
 prepare(stop: ViewingStop, signal: AbortSignal): Promise<PreparedViewingStop>;
 free(): boolean;
 changed(state: ViewingState): void;
}) {
 let state:ViewingState={style:'free',status:'idle',message:''};
 let generation=0,active:AbortController|undefined,disposed=false;
 const publish=(next:ViewingState)=>{state=next;if(!disposed)options.changed({...state});};
 const stop=(id:string)=>options.stops.find(s=>s.placementId.toLowerCase()===id.toLowerCase());
 const cancel=()=>{generation++;active?.abort();active=undefined;};
 const visit=async(target:ViewingStop,style:ViewingStyle)=>{
  cancel();const token=generation,controller=new AbortController();active=controller;
  publish({...state,status:'preparing',pendingPlacementId:target.placementId,message:'다음 관람 위치를 준비하고 있어요. 현재 화면은 그대로 유지해요.'});
  let prepared:PreparedViewingStop|undefined;
  try{
   prepared=await options.prepare(target,controller.signal);
   if(disposed||token!==generation||controller.signal.aborted)return;
   if(!prepared.commit(style))throw Error('VIEWING_DESTINATION_UNAVAILABLE');
   active=undefined;
   publish({style,currentPlacementId:target.placementId,status:'idle',message:''});
  }catch{
   if(!disposed&&token===generation&&!controller.signal.aborted){active=undefined;publish({...state,pendingPlacementId:undefined,status:'blocked',message:'이 작품의 관람 위치를 준비하지 못했어요. 현재 화면을 유지해요. 다른 작품을 선택하거나 자유롭게 관람할 수 있어요.'});}
  }finally{prepared?.release();}
 };
 const actions:ViewingActions={
  setStyle(style){
   if(disposed)return;
   if(style==='free'){
    cancel();
    if(!options.free()){publish({...state,pendingPlacementId:undefined,status:'blocked',message:'지금은 조작을 바꿀 수 없어요. 열린 안내나 준비 상태를 확인해 주세요.'});return;}
    publish({...state,style:'free',pendingPlacementId:undefined,status:'idle',message:''});return;
   }
   const target=(state.currentPlacementId&&stop(state.currentPlacementId))||options.stops[0];
   if(!target){publish({...state,status:'blocked',message:'등록된 순서 관람 위치가 없어요. 자유롭게 관람과 작품 목록을 이용할 수 있어요.'});return;}
   void visit(target,'ordered');
  },
  step(direction){
   if(disposed||state.style!=='ordered')return;
   const id=state.pendingPlacementId??state.currentPlacementId;
   const i=options.stops.findIndex(s=>s.placementId.toLowerCase()===id?.toLowerCase());
   const target=options.stops[i+direction];if(i>=0&&target)void visit(target,'ordered');
  },
  select(id){if(disposed)return;const target=stop(id);if(target)void visit(target,state.style);},
  cancel(){if(disposed)return;cancel();publish({...state,pendingPlacementId:undefined,status:'idle',message:''});},
 };
 return {actions,state:()=>({...state}),context(placementId:string){if(!disposed&&state.style==='free'&&!active&&stop(placementId))publish({...state,currentPlacementId:stop(placementId)!.placementId});},dispose(){cancel();disposed=true;}};
}
