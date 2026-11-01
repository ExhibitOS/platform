// SPDX-License-Identifier: AGPL-3.0-or-later
import type {NativeViewportFrame} from './native-viewport-protocol';
import type {CameraInteractionMode} from './geometry/camera-mode';

/** An optional, transient camera control. It is not part of a draft or frame. */
export const NATIVE_CAMERA_INTERACTION_CAPABILITY='cameraInteractionV1';
export type CameraInteractionRequest={epoch:string;sequence:number;requestId:string;mode:CameraInteractionMode};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** The caller must authenticate, fence asynchronous use and reject replay. */
export function checkedCameraInteraction(value:unknown,frame:NativeViewportFrame|undefined,unavailable:boolean):CameraInteractionRequest {
 if(!value||typeof value!=='object'||Array.isArray(value)||!frame)throw Error('CAMERA_INTERACTION_INVALID');
 const v=value as CameraInteractionRequest;
 if(Object.keys(v).sort().join(',')!=='epoch,mode,requestId,sequence'||typeof v.epoch!=='string'||!uuid.test(v.epoch)||typeof v.requestId!=='string'||!uuid.test(v.requestId)||!Number.isSafeInteger(v.sequence)||!['object','camera-rotate','camera-pan'].includes(v.mode))throw Error('CAMERA_INTERACTION_INVALID');
 if(v.epoch!==frame.epoch||v.sequence!==frame.sequence)throw Error('CAMERA_INTERACTION_STALE');
 if(frame.disabled||frame.presentation==='plan'||unavailable)throw Error('CAMERA_INTERACTION_UNAVAILABLE');
 return {epoch:v.epoch,sequence:v.sequence,requestId:v.requestId,mode:v.mode};
}

/** A bounded authenticated gate; ACK confirms mapping, not focus or movement. */
export class NativeCameraInteractionGate {
 private pending:AbortController|undefined;
 private readonly seen=new Set<string>();
 constructor(private readonly input:{frame:()=>NativeViewportFrame|undefined;unavailable:()=>boolean;authenticate:(frame:NativeViewportFrame,signal:AbortSignal)=>Promise<void>;apply:(request:CameraInteractionRequest)=>boolean}){}
 async request(value:unknown):Promise<CameraInteractionRequest&{accepted:true}>{
  const frame=this.input.frame(),request=checkedCameraInteraction(value,frame,this.input.unavailable());
  if(this.pending)throw Error('CAMERA_INTERACTION_BUSY');
  if(this.seen.has(request.requestId))throw Error('CAMERA_INTERACTION_REPLAY');
  if(this.seen.size>=128)throw Error('CAMERA_INTERACTION_LIMIT');
  this.seen.add(request.requestId);
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]);this.pending=controller;
  try{
   await this.input.authenticate(frame!,signal);signal.throwIfAborted();
   if(this.input.frame()!==frame)throw Error('CAMERA_INTERACTION_STALE');
   checkedCameraInteraction(request,this.input.frame(),this.input.unavailable());
   if(!this.input.apply(request))throw Error('CAMERA_INTERACTION_BUSY');
   return {...request,accepted:true};
  }finally{if(this.pending===controller)this.pending=undefined;controller.abort();}
 }
 invalidate(){this.pending?.abort();}
 advance(){this.invalidate();this.seen.clear();}
 dispose(){this.invalidate();this.seen.clear();}
}
