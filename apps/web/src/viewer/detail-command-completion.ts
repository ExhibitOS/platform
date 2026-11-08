import type {AssetPeakBudget} from './loading';
// SPDX-License-Identifier: AGPL-3.0-or-later
/** A WebGL2 command fence establishes completion of commands submitted before
 * it, not physical driver memory reclamation. Timeout/context loss rejects and
 * leaves the owning attempt's reservation held. */
export async function completeDetailCommands(gl:WebGL2RenderingContext){
 if(gl.isContextLost())throw Error('DETAIL_CONTEXT_LOST');
 const sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);if(!sync)throw Error('DETAIL_FENCE_UNAVAILABLE');
 try{gl.flush();const deadline=performance.now()+5000;for(;;){
  if(gl.isContextLost())throw Error('DETAIL_CONTEXT_LOST');
  const status=gl.clientWaitSync(sync,0,0);if(status===gl.ALREADY_SIGNALED||status===gl.CONDITION_SATISFIED)return;
  if(status===gl.WAIT_FAILED||performance.now()>=deadline)throw Error('DETAIL_FENCE_UNCONFIRMED');
  await new Promise<void>(resolve=>setTimeout(resolve,10));
 }}finally{gl.deleteSync(sync);}
}

/** Reveal a previously hidden borrowed canvas only after an actual gallery draw
 * and command completion, provided no newer detail scope replaced the owner. */
export async function revealAfterGalleryDraw(input:{draw:()=>boolean;complete:()=>Promise<void>;current:()=>boolean;reveal:()=>void}){
 if(!input.draw())return false;await input.complete();if(!input.current())return false;input.reveal();return true;
}

/** Charge old/new gallery buffers until the restore draw and its fence settle.
 * A failed or uncertain restore keeps its charge and canvas hidden. */
export async function restoreDetailCanvas(input:{peak:AssetPeakBudget;key:string;heldBytes:number;requiredBytes:number;limit:number;draw:()=>boolean;complete:()=>Promise<void>;current:()=>boolean;reveal:()=>void}){
 if(!Number.isSafeInteger(input.heldBytes)||!Number.isSafeInteger(input.requiredBytes)||input.requiredBytes<1||input.requiredBytes>input.heldBytes||input.peak.reservationBytes(input.key)!==input.heldBytes||!Number.isSafeInteger(input.peak.total())||input.peak.total()>input.limit)throw Error('DETAIL_RESTORE_BUDGET');
 const revealed=await revealAfterGalleryDraw(input);if(!revealed)throw Error('DETAIL_RESTORE_UNAVAILABLE');
 input.peak.release(input.key);
}
