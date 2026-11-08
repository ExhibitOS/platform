// SPDX-License-Identifier: AGPL-3.0-or-later
/** Wait until material loading and its deferred replay have settled before
 * transferring the shared detail view away from the fallback owner. */
export function detailBudgetRetryReady(input:{floorSettled:boolean;surfaceSettled:boolean;deferred:number;active:number;queued:number;pending:boolean;candidate:boolean;used:number;sceneCap:number;reservation:number;transitionCap:number}){
 return input.floorSettled&&input.surfaceSettled&&input.deferred===0&&input.active===0&&input.queued===0&&!input.pending&&!input.candidate&&Number.isSafeInteger(input.used)&&input.used>=0&&input.used<=input.sceneCap&&input.used+input.reservation<=input.transitionCap;
}
/** A refused, still-current detail attempt may be reconsidered while the
 * existing fallback stays visible. This does not reserve or fetch anything. */
export function createDetailBudgetRetry(input:{valid():boolean;ready():boolean;now():number;deadline:number;retry():void}){
 let finished=false;
 return ()=>{
  if(finished)return;
  if(!input.valid()||input.now()>=input.deadline){finished=true;return;}
  if(!input.ready())return;
  finished=true;input.retry();
 };
}
