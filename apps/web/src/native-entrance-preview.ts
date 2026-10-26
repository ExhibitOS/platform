// SPDX-License-Identifier: AGPL-3.0-or-later
import {freezeCanonical} from '@exhibitos/studio-contract';
import type {EntranceSceneScope,EntranceScenePreview} from './GeometryPreview';
import type {NativeViewportFrame} from './native-viewport-protocol';
import {checkedEntrancePreviewRequest,entrancePreviewReply,entrancePreviewStateMatches,type EntrancePreviewRequest,type EntrancePreviewReply,type EntrancePreviewGeometry} from './native-entrance-preview-protocol';
export interface EntrancePreviewMeasurement extends EntrancePreviewGeometry {mode:'cover'|'walk'|'editor'}
export interface EntrancePreviewIntent {
 frame:NativeViewportFrame;request:EntrancePreviewRequest;generation:number;signal:AbortSignal;
 scope:EntranceSceneScope;
}
interface Pending {
 frame:NativeViewportFrame;request:EntrancePreviewRequest;generation:number;abort:AbortController;
 canonical:string;scope?:EntranceSceneScope;intent?:EntrancePreviewIntent;reply?:EntrancePreviewReply;
 measure?:()=>EntrancePreviewMeasurement;resolve?:(value:EntrancePreviewMeasurement)=>void;reject?:(error:unknown)=>void;
}
/** Owns only RPC/snapshot lifetime; the shared entry hook and existing scene own viewing. */
export class NativeEntrancePreview {
 private generation=0;private pending?:Pending;private seen=new Set<string>();
 constructor(private ports:{frame:()=>NativeViewportFrame|undefined;authenticate:(frame:NativeViewportFrame,signal:AbortSignal)=>Promise<void>;scene:()=>EntranceScenePreview|undefined;idle:()=>boolean;notify:()=>void;editorReady:(signal:AbortSignal)=>Promise<Omit<EntrancePreviewMeasurement,'renderGeneration'>>}){}
 get view(){return this.pending?.intent;}
 get active(){return this.pending!==undefined;}
 invalidate(){
  const old=this.pending;this.pending=undefined;this.generation++;
  if(old){old.abort.abort(Error('ENTRANCE_PREVIEW_STALE'));old.reject?.(Error('ENTRANCE_PREVIEW_STALE'));old.scope?.close();this.ports.notify();}
 }
 private current(p:Pending){
  p.abort.signal.throwIfAborted();
  if(this.pending!==p||this.ports.frame()!==p.frame||p.generation!==this.generation||freezeCanonical(p.frame.draft)!==p.canonical)throw Error('ENTRANCE_PREVIEW_STALE');
 }
 ready(intent:EntrancePreviewIntent,measure:()=>EntrancePreviewMeasurement){
  const p=this.pending;if(!p||p.intent!==intent||p.abort.signal.aborted)return;
  try{this.current(p);const geometry=measure();if(geometry.mode!==(p.request.type==='walk'?'walk':'cover'))throw Error('ENTRANCE_PREVIEW_STALE');p.measure=measure;p.resolve?.(geometry);}
  catch(error){p.reject?.(error);}
 }
 failed(intent:EntrancePreviewIntent,error:unknown){if(this.pending?.intent===intent)this.pending.reject?.(error);}
 async request(value:unknown){
  const frame=this.ports.frame(),request=checkedEntrancePreviewRequest(value,frame);
  if(this.seen.has(request.requestId))throw Error('ENTRANCE_PREVIEW_REPLAY');
  this.seen.add(request.requestId);if(this.seen.size>128)this.seen.delete(this.seen.values().next().value!);
  // Close always interrupts pending slow/image/navigation work before authentication or layout waits.
  this.invalidate();
  const p:Pending={frame:frame!,request,generation:this.generation,abort:new AbortController(),canonical:freezeCanonical(frame!.draft)};this.pending=p;this.ports.notify();
  const timeout=setTimeout(()=>p.abort.abort(Error('ENTRANCE_PREVIEW_TIMEOUT')),15000);
  try{
   await this.ports.authenticate(p.frame,p.abort.signal);this.current(p);
   if(request.type==='close'){
    const geometry=await this.ports.editorReady(p.abort.signal);this.current(p);
    const reply=entrancePreviewReply(request,p.frame,{...geometry,renderGeneration:p.generation});
    await this.ports.authenticate(p.frame,p.abort.signal);this.current(p);this.pending=undefined;this.ports.notify();return reply;
   }
   if(!this.ports.idle())throw Error('ENTRANCE_PREVIEW_BUSY');
   const scene=this.ports.scene();if(!scene)throw Error('ENTRANCE_PREVIEW_NOT_READY');
   p.scope=scene.begin();
   const geometry=await new Promise<EntrancePreviewMeasurement>((resolve,reject)=>{
    p.resolve=resolve;p.reject=reject;
    p.abort.signal.addEventListener('abort',()=>reject(p.abort.signal.reason),{once:true});
    p.intent={frame:p.frame,request,generation:p.generation,signal:p.abort.signal,scope:p.scope!};this.ports.notify();
   });
   this.current(p);await this.ports.authenticate(p.frame,p.abort.signal);this.current(p);
   const measured=p.measure?.();if(!measured||freezeCanonical(measured)!==freezeCanonical(geometry))throw Error('ENTRANCE_PREVIEW_STALE');
   p.reply=entrancePreviewReply(request,p.frame,measured);return structuredClone(p.reply);
  }catch(error){if(this.pending===p)this.invalidate();throw error;}
  finally{clearTimeout(timeout);p.resolve=undefined;p.reject=undefined;}
 }
 async state(value:unknown){
  const frame=this.ports.frame(),request=checkedEntrancePreviewRequest(value,frame),p=this.pending;
  if(!p?.reply||!p.measure)throw Error('ENTRANCE_PREVIEW_STALE');
  await this.ports.authenticate(frame!,AbortSignal.timeout(10000));this.current(p);
  const measured=p.measure();
  if(measured.mode!==(request.type==='walk'?'walk':'cover')||!entrancePreviewStateMatches(p.request,request,frame!,p.reply,measured))throw Error('ENTRANCE_PREVIEW_STALE');
  return structuredClone(p.reply);
 }
}
