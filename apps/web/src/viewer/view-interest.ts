// SPDX-License-Identifier: AGPL-3.0-or-later
/** Shared soft working-set preference. Lower ranks matter more; none grants
 * authority, changes an asset's allowed tier, or creates an allocation pin. */
export type ViewInterest={visible:boolean;next:boolean;recent:boolean;connected:boolean;distance:number;shadow?:boolean};
export function viewInterestRank(view:ViewInterest|undefined,current=false,pinned=false){
  if(pinned||current)return 0;
  if(view?.visible)return 1;
  if(view?.next||view?.recent||view?.shadow)return 2;
  return view?.connected?3:4;
}
export function hasViewDemand(view:ViewInterest|undefined,current=false,pinned=false){
  return current||pinned||!!(view?.visible||view?.next||view?.recent||view?.shadow);
}
/** Visible attention keeps the existing focused-distance exception. Only
 * speculative expanded-frustum preparation has the six-metre range. */
export function viewAttentionEligible(plausible:boolean,inView:boolean,inNext:boolean,distance:number){
  return plausible&&(inView||inNext&&distance<=6);
}
export function viewQueuePriority(view:ViewInterest|undefined,current:boolean,pinned:boolean,prepareOnly=false){
  if(pinned)return -200;
  if(current)return -100;
  const rank=viewInterestRank(view);
  return (rank===1?-50:view?.shadow?0:rank===2?10:rank===3?60:100)+(prepareOnly?20:0)+Math.min(9,Math.max(0,view?.distance??90)/10);
}
/** Keep an already attached eligible full tier during its existing detail grace.
 * Pressure reclamation always overrides this preference; this never promotes. */
export function retainGalleryDetail(activeFull:boolean,want:boolean,reclaiming:boolean){return activeFull&&want&&!reclaiming;}
export type ResidentRetryWait={identity:string;bytes:number};
/** A measured refusal is reusable only for the exact inventory/policy identity.
 * This caches allocation cost, never a successful authorization decision. */
export function optionalResidentRetryReady(wait:ResidentRetryWait|undefined,identity:string,used:number,limit:number,reclaimable=0){
  return !wait||wait.identity!==identity||used+wait.bytes-Math.max(0,reclaimable)<=limit;
}

/** A compatible speculative transfer can become a shadow minimum in place. */
export function retainPreparationDemand(current:boolean,next:boolean,shadow:boolean){return current||next||shadow;}
