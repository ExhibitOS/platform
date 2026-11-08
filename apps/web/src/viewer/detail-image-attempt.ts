// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {DetailAccess} from '../publication-client';
import {DetailAccessFailure} from '../detail-access-failure';
import {createDetailAttemptSlot} from './detail-attempt';
import type {AssetPeakBudget} from './loading';
import type {DetailRuntimeProfile} from './detail-runtime-profile';

/** One independently qualified image, bound to the exact static relation.
 * The producer/Viewer qualification boundary must establish this before calling;
 * image dimensions, a hash, or a hardware hint alone do not establish it. */
export interface QualifiedDetailImage {
 candidateId:string;sha256:string;bytes:number;mime:'image/png'|'image/jpeg';width:number;height:number;
 reservationBytes:number;restoreReservationBytes:number;transitionCapBytes:number;maxSceneBytes:number;maxRestoreWidth:number;maxRestoreHeight:number;devicePixelRatio:number;detailViewport:DetailImageViewport;runtime:DetailRuntimeProfile;revisionSha256:string;artworkRevisionId:string;sourceBindingSha256:string;featureReportSha256:string;inspector:string;model:string;
}
export type DetailImageSlot=ReturnType<typeof createDetailAttemptSlot<DetailImageResource>>;
interface DetailImageResource {bitmap:ImageBitmap;texture:Three.Texture;geometry:Three.PlaneGeometry;material:Three.MeshBasicMaterial;object:Three.Mesh}
export class DetailImageBudgetRefusal extends Error {
 constructor(readonly attemptId:string,readonly generation:number,readonly requestedBytes:number,readonly currentBytes:number,readonly capBytes:number,readonly sceneCapBytes:number){super('DETAIL_IMAGE_BUDGET_REFUSED');}
}
/** The current build has no empirically qualified public image profile. */
export function qualifiedDetailImageProfile(_revisionSha256?:string,_artworkRevisionId?:string):QualifiedDetailImage|undefined{void _revisionSha256;void _artworkRevisionId;return undefined;}
export function createDetailImageSlot():DetailImageSlot{return createDetailAttemptSlot<DetailImageResource>();}
export interface DetailImageViewport {width:number;height:number;canvasWidth:number;canvasHeight:number;pixelRatio:number;devicePixelRatio:number}
/** A measured profile cannot survive an unmeasured canvas or DPR change. */
export function sameDetailImageViewport(a:DetailImageViewport,b:DetailImageViewport){return Number.isSafeInteger(a.width)&&a.width>0&&Number.isSafeInteger(a.height)&&a.height>0&&Number.isSafeInteger(a.canvasWidth)&&a.canvasWidth>0&&Number.isSafeInteger(a.canvasHeight)&&a.canvasHeight>0&&Number.isFinite(a.pixelRatio)&&a.pixelRatio>0&&Number.isFinite(a.devicePixelRatio)&&a.devicePixelRatio>0&&a.width===b.width&&a.height===b.height&&a.canvasWidth===b.canvasWidth&&a.canvasHeight===b.canvasHeight&&a.pixelRatio===b.pixelRatio&&a.devicePixelRatio===b.devicePixelRatio;}


/** Reserve a session-owned image against the existing gallery peak ledger.
 * The owner keeps that reservation through display and positive drain; this
 * does not transfer the candidate into the ordinary gallery cache. */
export function startDetailImageAttempt(input:{
 profile:QualifiedDetailImage;access:DetailAccess;slot:DetailImageSlot;peak:AssetPeakBudget;limit:number;
 attemptId:string;generation:number;isCurrent:(generation:number)=>boolean;signal:AbortSignal;three:typeof Three;
 /** Must check the exact loader-owned publication and capability identities. */
 isTrusted:()=>boolean;
 /** Transfer the still-charged hold synchronously to the canvas-restoration owner. */
 handoffReservation?:(key:string,bytes:number)=>boolean;
 /** The scope owns the borrowed view; neither callback may free gallery assets. */
 draw:(object:Three.Object3D)=>void;hide:()=>void;
 /** Configuration-specific command-completion check, not physical reclamation. */
 completeCommands:()=>Promise<void>;
}){
 // Only call with the actual verified static loader capability, never an
 // arbitrary adapter: its typed failure covers that call's owned read only.
 const {access,slot,peak,attemptId,generation}=input;const profile=Object.freeze({...input.profile,detailViewport:Object.freeze({...input.profile.detailViewport}),runtime:Object.freeze({...input.profile.runtime})});
 const trusted=()=>{try{return input.isTrusted()===true;}catch{return false;}};
 if(!(input.signal instanceof AbortSignal)||!trusted()||input.signal.aborted||access.revisionSha256!==profile.revisionSha256||!Number.isSafeInteger(profile.bytes)||profile.bytes<1||profile.bytes>33554432||!/^([a-f0-9]{64})$/.test(profile.sha256)||(profile.mime!=='image/jpeg'&&profile.mime!=='image/png')||!Number.isSafeInteger(profile.reservationBytes)||profile.reservationBytes<1||!Number.isSafeInteger(profile.restoreReservationBytes)||profile.restoreReservationBytes<1||profile.restoreReservationBytes>profile.reservationBytes||!Number.isSafeInteger(profile.maxRestoreWidth)||profile.maxRestoreWidth<1||!Number.isSafeInteger(profile.maxRestoreHeight)||profile.maxRestoreHeight<1||!Number.isFinite(profile.devicePixelRatio)||profile.devicePixelRatio<=0||!sameDetailImageViewport(profile.detailViewport,profile.detailViewport)||profile.detailViewport.devicePixelRatio!==profile.devicePixelRatio||!Number.isSafeInteger(profile.transitionCapBytes)||profile.transitionCapBytes<1||!Number.isSafeInteger(profile.maxSceneBytes)||profile.maxSceneBytes<1||!Number.isSafeInteger(profile.maxSceneBytes+profile.reservationBytes)||profile.maxSceneBytes+profile.reservationBytes>profile.transitionCapBytes||!Number.isSafeInteger(profile.maxSceneBytes+profile.restoreReservationBytes)||profile.maxSceneBytes+profile.restoreReservationBytes>profile.transitionCapBytes||!Number.isSafeInteger(profile.width)||profile.width<1||profile.width>8192||!Number.isSafeInteger(profile.height)||profile.height<1||profile.height>8192||profile.reservationBytes<profile.width*profile.height*4||!input.isCurrent(generation))throw Error('DETAIL_IMAGE_ADMISSION_INVALID');
 // reserve is synchronous with slot start; if the slot refuses, immediately
 // return this not-yet-used hold. No byte reader or decoder exists at this point.
 slot.assertAvailable(attemptId,generation);const current=peak.total(),requested=profile.reservationBytes,cap=Math.min(input.limit,profile.transitionCapBytes);if(!Number.isSafeInteger(current)||current<0||!Number.isSafeInteger(cap)||cap<1||!Number.isSafeInteger(current+requested))throw Error('DETAIL_IMAGE_ADMISSION_INVALID');if(current>profile.maxSceneBytes||current+requested>cap){slot.assertAvailable(attemptId,generation);if(input.signal.aborted||!input.isCurrent(generation))throw Error('DETAIL_IMAGE_ADMISSION_INVALID');throw new DetailImageBudgetRefusal(attemptId,generation,requested,current,cap,profile.maxSceneBytes);}const key=`detail-image:${crypto.randomUUID()}`;peak.reserve(key,requested,cap);
 const uncertainRead=(error:unknown)=>!(trusted()&&error instanceof DetailAccessFailure&&error.retirement==='confirmed');
 let cleanupFailed=false,hideFailed=false,drawEntered=false,revalidationStarted=false,resource:DetailImageResource|undefined,revalidation:Promise<void>|undefined,pendingRecheck:Promise<void>|undefined;const ownerAbort=new AbortController();
 const disposeParts=(parts:{texture?:Three.Texture;material?:Three.MeshBasicMaterial;geometry?:Three.PlaneGeometry;bitmap?:ImageBitmap})=>{
  let failed=false;for(const dispose of [()=>parts.texture?.dispose(),()=>parts.material?.dispose(),()=>parts.geometry?.dispose(),()=>parts.bitmap?.close()])try{dispose();}catch{failed=true;}
  if(failed){cleanupFailed=true;throw Error('DETAIL_IMAGE_CLEANUP_UNCERTAIN');}
 };
 const releasePartial=()=>{if(!resource)return;const owned=resource;resource=undefined;disposeParts(owned);};
 let attempt:ReturnType<DetailImageSlot['start']>;
 try{attempt=slot.start({attemptId,generation,isCurrent:input.isCurrent,
  async run(attemptSignal){
   const signal=AbortSignal.any([attemptSignal,ownerAbort.signal]);
   let bitmap:ImageBitmap|undefined,texture:Three.Texture|undefined,geometry:Three.PlaneGeometry|undefined,material:Three.MeshBasicMaterial|undefined;
   try{
    let candidates:Awaited<ReturnType<DetailAccess['candidatesFor']>>;try{candidates=await access.candidatesFor(profile.artworkRevisionId,signal);}catch(error){if(uncertainRead(error))cleanupFailed=true;throw error;}signal.throwIfAborted();if(!trusted())throw Error('DETAIL_IMAGE_AUTHORITY');const candidate=candidates.find(value=>value.candidateId===profile.candidateId),media=candidate?.featureReport.media;if(!candidate||candidate.tier!=='acquired-original'||candidate.sha256!==profile.sha256||candidate.bytes!==profile.bytes||candidate.mime!==profile.mime||candidate.sourceBindingSha256!==profile.sourceBindingSha256||candidate.featureReportSha256!==profile.featureReportSha256||candidate.featureReport.inspector!==profile.inspector||candidate.featureReport.cost.model!==profile.model||!Number.isSafeInteger(candidate.featureReport.cost.peakAdditionalBytes)||candidate.featureReport.cost.peakAdditionalBytes>profile.reservationBytes||media?.kind!=='image'||media.width!==profile.width||media.height!==profile.height)throw Error('DETAIL_IMAGE_BINDING');let bytes:Uint8Array;try{await access.recheck(profile.candidateId,signal);bytes=await access.fetch(profile.candidateId,signal);}catch(error){if(uncertainRead(error))cleanupFailed=true;throw error;}signal.throwIfAborted();if(!trusted())throw Error('DETAIL_IMAGE_AUTHORITY');
    if(bytes.byteLength!==profile.bytes)throw Error('DETAIL_IMAGE_INTEGRITY');
    const snapshot=new Uint8Array(bytes);const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',snapshot))].map(v=>v.toString(16).padStart(2,'0')).join('');
    if(hash!==profile.sha256)throw Error('DETAIL_IMAGE_INTEGRITY');signal.throwIfAborted();
    const decoded=await createImageBitmap(new Blob([snapshot],{type:profile.mime}),{imageOrientation:'flipY',colorSpaceConversion:'default'});bitmap=decoded;
    signal.throwIfAborted();if(decoded.width!==profile.width||decoded.height!==profile.height)throw Error('DETAIL_IMAGE_INTEGRITY');
    texture=new input.three.Texture(decoded);texture.colorSpace=input.three.SRGBColorSpace;texture.generateMipmaps=true;texture.minFilter=input.three.LinearMipmapLinearFilter;texture.needsUpdate=true;
    geometry=new input.three.PlaneGeometry(1,1);material=new input.three.MeshBasicMaterial({map:texture});
    const value:DetailImageResource={bitmap:decoded,texture,geometry,material,object:new input.three.Mesh(geometry,material)};resource=value;bitmap=undefined;texture=undefined;geometry=undefined;material=undefined;
    return {ownership:'owned' as const,value};
   }catch(error){disposeParts({bitmap,texture,geometry,material});throw error;}
  },
  async disposeOwned(){releasePartial();await input.completeCommands();if(cleanupFailed)throw Error('DETAIL_IMAGE_CLEANUP_UNCERTAIN');},
  async releaseBorrow(){throw Error('DETAIL_IMAGE_OWNERSHIP');},
  async drainChildren(){if(revalidation)try{await revalidation;}catch(error){if(revalidationStarted&&uncertainRead(error))cleanupFailed=true;}if(hideFailed&&drawEntered||cleanupFailed&&!resource)throw Error('DETAIL_IMAGE_CLEANUP_UNCERTAIN');},
  async releaseReservation(){if(input.handoffReservation?.(key,profile.reservationBytes)===true)return;peak.release(key);},
 });}catch(error){peak.release(key);throw error;}
 let closing=false;const close=()=>{if(!closing){closing=true;try{input.hide();}catch{hideFailed=true;cleanupFailed=true;}ownerAbort.abort();}input.signal.removeEventListener('abort',onAbort);return attempt.drain();};const onAbort=()=>{void close().catch(()=>{});};input.signal.addEventListener('abort',onAbort,{once:true});if(input.signal.aborted)onAbort();
 const checkSource=()=>{
  if(pendingRecheck)return pendingRecheck;
  // The deadline hides immediately even if a broken reader ignores abort;
  // drain still awaits actual settlement and retains the reservation meanwhile.
  const deadline=setTimeout(()=>{void close().catch(()=>{});},5000);
  const task=Promise.resolve().then(()=>{ownerAbort.signal.throwIfAborted();revalidationStarted=true;return access.recheck(profile.candidateId,ownerAbort.signal);});
  revalidation=task;pendingRecheck=task;void task.then(()=>{clearTimeout(deadline);if(pendingRecheck===task)pendingRecheck=undefined;},()=>{clearTimeout(deadline);if(pendingRecheck===task)pendingRecheck=undefined;});return task;
 };
 let shown=false,showing=false;
 return {async recheck(){try{if(closing||!shown||!attempt.canPublish()||!trusted())throw Error('DETAIL_IMAGE_AUTHORITY');await checkSource();if(!attempt.canPublish()||!trusted()||closing)throw Error('DETAIL_IMAGE_AUTHORITY');}catch(error){void close().catch(()=>{});throw error;}},async show(){if(shown||showing){if(!input.isCurrent(generation)||input.signal.aborted)void close().catch(()=>{});return false;}showing=true;try{let staged:DetailImageResource|undefined;const prepared=await attempt.tryCommit(value=>{staged=value;return true;});if(!prepared||!staged||closing){if(!input.isCurrent(generation)||input.signal.aborted)void close().catch(()=>{});return false;}
   await checkSource();
   if(!trusted())throw Error('DETAIL_IMAGE_AUTHORITY');if(!attempt.canPublish()||input.signal.aborted||closing){void close().catch(()=>{});return false;}
   drawEntered=true;input.draw(staged.object);if(!attempt.canPublish()||input.signal.aborted||closing){void close().catch(()=>{});return false;}shown=true;return true;
  }catch(error){void close().catch(()=>{});throw error;}finally{showing=false;}
  },close};
}
