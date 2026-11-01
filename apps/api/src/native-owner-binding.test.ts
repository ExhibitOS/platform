// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {matchesNativeOwnerBinding,nativeOwnerBindingDigest,type NativeOwnerBinding} from './native-owner-binding.ts';
it('matches the agreed fixed-order v1 synthetic HMAC vector',()=>{
 const ids=Array.from({length:10},(_,i)=>`10000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
 const b:NativeOwnerBinding={workspaceId:ids[0]!,tenantId:ids[1]!,principalId:ids[2]!,runtimeGeneration:ids[3]!,jobId:ids[4]!,attemptId:ids[5]!,generation:ids[6]!,stageId:ids[7]!,reservationId:ids[8]!,reservationGeneration:ids[9]!,claimDigest:Buffer.from(Array.from({length:32},(_,i)=>i+32)).toString('hex'),receiptDigest:Buffer.from(Array.from({length:32},(_,i)=>i+64)).toString('hex')};
 const key=Uint8Array.from({length:32},(_,i)=>i),digest=nativeOwnerBindingDigest(key,b);
 expect(digest).toBe('9619007a47a688c544840f87c8ea25f683c3c16cafcb5990d22ff3623ade513a');expect(matchesNativeOwnerBinding(digest,digest)).toBe(true);expect(matchesNativeOwnerBinding(digest,'0'.repeat(64))).toBe(false);expect(key[1]).toBe(1);
 expect(()=>nativeOwnerBindingDigest(key,{...b,jobId:'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'})).toThrow('NATIVE_OWNER_BINDING');
 expect(()=>nativeOwnerBindingDigest(key,{...b,claimDigest:'x'.repeat(64)})).toThrow('NATIVE_OWNER_BINDING');
 expect(()=>nativeOwnerBindingDigest(new Uint8Array(31),b)).toThrow('NATIVE_OWNER_BINDING');
 const extra={...b,[Symbol('extra')]:true};expect(()=>nativeOwnerBindingDigest(key,extra)).toThrow('NATIVE_OWNER_BINDING');
 const hidden={...b,extra:true};Object.defineProperty(hidden,'jobId',{value:b.jobId,enumerable:false});expect(()=>nativeOwnerBindingDigest(key,hidden)).toThrow('NATIVE_OWNER_BINDING');
});
