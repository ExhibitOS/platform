// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Artwork} from '@exhibitos/spec';
import {freezeCanonical} from '@exhibitos/studio-contract';
import {catalogBinding} from './native-catalog-protocol';
import {checkedPlacementRequest,placementFrameCompatible,type PlacementBegin,type PlacementTarget} from './native-placement-protocol';
import type {NativeViewportFrame} from './native-viewport-protocol';
import {approvedPlacementArtwork} from './native-placement-source';
import {checkedPlacementTarget} from './placement/target-preview';
import type {Placement} from './placement/model';

export interface NativePlacementIntent {
 frame:NativeViewportFrame;request:PlacementBegin;artwork:Artwork|null;committing:boolean;
 target:{surfaceId:string;offset:[number,number];token:string;placement:Placement}|null;
}
interface Hooks {
 frame:()=>NativeViewportFrame|undefined;
 authenticate:(frame:NativeViewportFrame,signal:AbortSignal)=>Promise<void>;
 notify:()=>void;
 target:(frame:NativeViewportFrame,target:PlacementTarget)=>void;
 cancelled:(frame:NativeViewportFrame,body:{placementRequestId:string;reason:string})=>void;
 source?:typeof approvedPlacementArtwork;
}
/** One temporary intent. Only a checked Placement leaves it; host draft/history stay owned by native. */
export class NativePlacement {
 private intent:NativePlacementIntent|null=null;
 private abort:AbortController|null=null;
 private seen=new Set<string>();
 private cancelledIds=new Set<string>();
 private scope='';
 private hooks:Hooks;
 constructor(hooks:Hooks){this.hooks=hooks;}
 get active(){return this.intent!==null;}
 snapshot(){return this.intent;}
 private remember(set:Set<string>,id:string){set.add(id);if(set.size>128)set.delete(set.values().next().value!);}
 private current(intent:NativePlacementIntent){
  const frame=this.hooks.frame();
  if(this.intent!==intent||!frame||!placementFrameCompatible(intent.frame,frame))throw Error('PLACEMENT_INTENT_STALE');
  intent.frame=frame;return frame;
 }
 rebind(frame:NativeViewportFrame){
  const scope=`${frame.epoch}/${frame.tenantId}/${frame.principalId}`;
  if(this.scope&&scope!==this.scope){this.cancel('작업 계정이 바뀌어 배치를 취소했어요.');this.seen.clear();this.cancelledIds.clear();}
  this.scope=scope;
  if(!this.intent)return;
  if(!placementFrameCompatible(this.intent.frame,frame)){this.cancel('전시나 시점이 바뀌어 배치를 취소했어요.');return;}
  this.intent.frame=frame;
 }
 cancel(reason:string){
  const previous=this.intent;this.intent=null;this.abort?.abort();this.abort=null;
  if(!previous)return;
  this.remember(this.cancelledIds,previous.request.requestId);this.hooks.notify();
  this.hooks.cancelled(previous.frame,{placementRequestId:previous.request.requestId,reason:reason.slice(0,160)});
 }
 private invalid(intent:NativePlacementIntent,reason:string){
  intent.target=null;this.hooks.notify();
  this.hooks.target(intent.frame,{placementRequestId:intent.request.requestId,targetToken:null,surfaceId:null,offset:null,valid:false,reason:reason.slice(0,160)});
 }
 choose(surfaceId:string|null,offset:[number,number]|null){
  const intent=this.intent;if(!intent?.artwork||intent.committing)return;
  try{
   this.current(intent);
   if(!surfaceId||!offset){this.invalid(intent,`선택한 공간의 ${intent.request.targetKind==='wall'?'벽':'바닥'}을 직접 클릭하세요.`);return;}
   const placement=checkedPlacementTarget(intent.frame.draft.candidate,intent.artwork,intent.request,surfaceId,offset);
   const target={surfaceId,offset:[...offset] as [number,number],token:crypto.randomUUID(),placement};intent.target=target;
   this.hooks.notify();this.hooks.target(intent.frame,{placementRequestId:intent.request.requestId,targetToken:target.token,surfaceId,offset:[...offset],valid:true,reason:''});
  }catch(error){
   if(this.intent!==intent)return;
   const code=error instanceof Error?error.message:'';
   if(code==='PLACEMENT_INTENT_STALE'){this.cancel('전시가 바뀌어 배치를 취소했어요.');return;}
   this.invalid(intent,code==='PLACEMENT_OVERLAPS_OPENING'?'문이나 창문과 겹치지 않는 위치를 선택하세요.':code==='PLACEMENT_FLOOR_UNSUPPORTED'?'이 바닥에서는 숫자 편집으로 배치하세요.':'작품이 벽·바닥과 공간 안에 들어오는 위치를 선택하세요.');
  }
 }
 async request(value:unknown){
  const frame=this.hooks.frame(),request=checkedPlacementRequest(value,frame);
  this.rebind(frame!);
  if(this.seen.has(request.requestId))throw Error('PLACEMENT_REQUEST_REPLAY');
  this.remember(this.seen,request.requestId);
  if(request.phase==='begin'){
   this.cancel('새 작품의 배치를 시작했어요.');
   const intent:NativePlacementIntent={frame:frame!,request,artwork:null,target:null,committing:false};
   const abort=new AbortController(),signal=AbortSignal.any([abort.signal,AbortSignal.timeout(10000)]);
   this.intent=intent;this.abort=abort;this.hooks.notify();
   try{
    await this.hooks.authenticate(this.current(intent),signal);
    const artwork=await (this.hooks.source??approvedPlacementArtwork)(request,signal);
    await this.hooks.authenticate(this.current(intent),signal);this.current(intent);signal.throwIfAborted();
    intent.artwork=artwork;this.invalid(intent,`선택한 공간의 ${request.targetKind==='wall'?'벽':'바닥'}을 클릭해 위치를 고르세요.`);
    return {...catalogBinding(request),phase:'begin' as const,placementRequestId:request.requestId,accepted:true as const};
   }catch(error){if(this.intent===intent)this.cancel('작품 승인과 표시 권한을 다시 확인하세요.');throw error;}
  }
  const intent=this.intent;
  if(request.phase==='cancel'){
   if(intent?.request.requestId!==request.placementRequestId&&!this.cancelledIds.has(request.placementRequestId))throw Error('PLACEMENT_INTENT_STALE');
   if(intent?.request.requestId===request.placementRequestId)this.cancel('작품 배치를 취소했어요.');
   return {...catalogBinding(request),phase:'cancel' as const,placementRequestId:request.placementRequestId,accepted:true as const};
  }
  if(!intent||intent.request.requestId!==request.placementRequestId||!intent.artwork||intent.committing||intent.target?.token!==request.targetToken)throw Error('PLACEMENT_TARGET_STALE');
  this.current(intent);intent.committing=true;this.hooks.notify();
  const target=intent.target,abort=this.abort!,signal=AbortSignal.any([abort.signal,AbortSignal.timeout(10000)]);
  try{
   await this.hooks.authenticate(this.current(intent),signal);
   const artwork=await (this.hooks.source??approvedPlacementArtwork)(intent.request,signal);
   await this.hooks.authenticate(this.current(intent),signal);this.current(intent);signal.throwIfAborted();
   if(freezeCanonical(artwork)!==freezeCanonical(intent.artwork))throw Error('PLACEMENT_APPROVAL_CHANGED');
   const validatedPlacement=checkedPlacementTarget(intent.frame.draft.candidate,artwork,intent.request,target.surfaceId,target.offset);
   if(freezeCanonical(validatedPlacement)!==freezeCanonical(target.placement))throw Error('PLACEMENT_TARGET_CHANGED');
   this.intent=null;this.abort=null;abort.abort();this.hooks.notify();
   return {...catalogBinding(request),phase:'commit' as const,placementRequestId:request.placementRequestId,accepted:true as const,targetToken:target.token,validatedPlacement};
  }catch(error){if(this.intent===intent)this.cancel('작품 승인이나 배치 대상이 바뀌어 배치를 취소했어요.');throw error;}
 }
}
