// SPDX-License-Identifier: AGPL-3.0-or-later
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
