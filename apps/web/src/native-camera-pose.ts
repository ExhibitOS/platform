// SPDX-License-Identifier: AGPL-3.0-or-later
export interface NativeCameraPoseFrame {frameToken:string;current():boolean}
interface Sample extends NativeCameraPoseFrame {appliedToken:string|undefined;available:boolean;position:unknown;target:unknown}
const token=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}:([1-9][0-9]{0,15})$/i;
function vector(value:unknown):[number,number,number]|undefined {
 if(!Array.isArray(value)||value.length!==3)return;
 const result=[value[0],value[1],value[2]];if(!result.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=10000))return;
 return result as [number,number,number];
}
export function clearNativeCameraPose(dataset:DOMStringMap){delete dataset.nativeCameraPose;}
/** Coalesce synchronous lifecycle invalidations after the current callback.
 * The callback must render normally: only that render may publish a fresh pose. */
export function nativeCameraPoseRefresh(clear:()=>void,render:()=>void){
 let pending=false,disposed=false;
 return {
  request(){
   if(disposed)return;
   clear();
   if(pending)return;
   pending=true;
   queueMicrotask(()=>{if(disposed||!pending)return;pending=false;render();});
  },
  dispose(){disposed=true;pending=false;clear();},
 };
}
/** Read-only actual rendered-frame sample. Missing data is unavailable, never a requested-pose fallback. */
export function publishNativeCameraPose(dataset:DOMStringMap,sample?:Sample){
 clearNativeCameraPose(dataset);
 try{
  if(!sample||sample.available!==true||sample.current()!==true||sample.frameToken!==sample.appliedToken)return;
  const match=token.exec(sample.frameToken);if(!match||match[0]!==sample.frameToken||!Number.isSafeInteger(Number(match[1])))return;
  const position=vector(sample.position),target=vector(sample.target);if(!position||!target||position.reduce((sum,n,i)=>sum+(n-target[i]!)**2,0)<=1e-12)return;
  // The owner may retire while the tuples are sampled; recheck before publishing.
  if(sample.current()!==true)return;
  dataset.nativeCameraPose=JSON.stringify({version:1,frameToken:sample.frameToken,position,target});
 }catch{/* An unavailable readout cannot affect rendering or grant action authority. */}
}
