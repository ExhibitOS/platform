// SPDX-License-Identifier: AGPL-3.0-or-later
/** Keep the same synchronous scene authority fence on each XR render frame. */
export function guardedXrFrame(fence:()=>void,flush:()=>void,after:()=>void,callback:(time:number,frame?:XRFrame)=>void){
 return (time:number,frame?:XRFrame)=>{fence();flush();try{callback(time,frame);}finally{after();}};
}
