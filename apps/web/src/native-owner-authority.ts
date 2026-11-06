// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Session} from './cms-client';
import {DEVICE_BUDGETS} from './viewer/loading';
export interface NativeOwnerAuthority {controller:AbortController;signal:AbortSignal;expiresAt:number;budget:typeof DEVICE_BUDGETS.desktop;invalidate:()=>void}
/** Only call accept after the native frame and same-origin session were accepted. */
export class NativeOwnerAuthorityGate {
 private value:NativeOwnerAuthority|undefined;private fingerprint='';
 constructor(private readonly invalidateViewport:()=>void){}
 accept(session:Session){
  const fingerprint=JSON.stringify([session.tenantId,session.userId,session.role,session.csrfToken,session.expiresAt]),expires=Date.parse(session.expiresAt);
  if(this.fingerprint!==fingerprint){this.invalidate();this.fingerprint=fingerprint;}
  if((!this.value||this.value.signal.aborted)&&Number.isFinite(expires)&&expires>Date.now()){
   const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(Math.min(2147483647,expires-Date.now()))]);
   this.value={controller,signal,expiresAt:expires,budget:DEVICE_BUDGETS.desktop,invalidate:this.invalidateViewport};
  }
  return this.value?.signal.aborted?undefined:this.value;
 }
 invalidate(){this.value?.controller.abort();this.value=undefined;this.fingerprint='';}
}
