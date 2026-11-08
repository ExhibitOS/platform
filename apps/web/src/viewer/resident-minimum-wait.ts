// SPDX-License-Identifier: AGPL-3.0-or-later
/** A discarded minimum may be decoded again only after its measured resident
 * requirement fits the current tracked scope. */
export function residentMinimumFits(used:number,required:number,limit:number):boolean {
 return [used,required,limit].every(n=>Number.isSafeInteger(n)&&n>=0)&&Number.isSafeInteger(used+required)&&used+required<=limit;
}
export function residentDemandActive(input:{cancelled:boolean;disposed:boolean;gpuLost:boolean;publicDisplayStopped:boolean;observeWall:boolean;automatic:boolean;immersive:boolean}):boolean {
 return !input.cancelled&&!input.disposed&&!input.gpuLost&&!input.publicDisplayStopped&&input.observeWall&&(input.automatic||input.immersive);
}
export function sameResidentMinimumAsset(waiting:string,selected:string|undefined):boolean {
 return selected!==undefined&&waiting.toLowerCase()===selected.toLowerCase();
}

/** Recheck existing off-room reclamation only for a still-needed, idle minimum. */
export function retryResidentMinimum(input:{required:number;needed:boolean;pending:boolean;used:()=>number;limit:()=>number;reclaim:(deficit:()=>number)=>void}):boolean {
 if(!input.needed||input.pending)return false;
 const deficit=()=>input.used()+input.required-input.limit();
 if(!residentMinimumFits(input.used(),input.required,input.limit()))input.reclaim(deficit);
 return residentMinimumFits(input.used(),input.required,input.limit());
}
