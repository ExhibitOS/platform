// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {modelReceiptDigest} from './model-preparation-intent.ts';
import type {NativeModelAdoptionGrant} from './native-model-adoption-grant.ts';
import {parseNativeModelAdoptionRequest,runNativeModelAdoptionOwner} from './native-model-adoption-owner.ts';

it('requires an exact generation, operation and grant digest on the private adoption wire',async()=>{
 const operationId=randomUUID(),runtimeGeneration=randomUUID(),now=Date.now();
 const owner=()=>({workspaceId:randomUUID(),tenantId:randomUUID(),principalId:randomUUID(),artworkId:randomUUID(),artworkRevision:1});
 const grant:NativeModelAdoptionGrant={version:1,operationId,issuedAt:now,expiresAt:now+10000,
  source:{...owner(),artworkRevisionId:randomUUID()},
  target:{...owner(),exhibitionId:randomUUID(),placementId:randomUUID(),etag:`"studio-r1-${'a'.repeat(64)}"`},
  receiptSha256:'a'.repeat(64),rightsSha256:'b'.repeat(64),rightsPolicySha256:'e'.repeat(64),original:{sha256:'c'.repeat(64),bytes:64},
  display:{sha256:'d'.repeat(64),bytes:32},
 };
 const frame={version:1,kind:'adoption-commit-target',operationId,runtimeGeneration,grantSha256:modelReceiptDigest(grant),grant};
 const read=(value:unknown)=>parseNativeModelAdoptionRequest(Buffer.from(JSON.stringify(value)),runtimeGeneration);
 expect(read(frame)).toEqual({kind:frame.kind,operationId,grantSha256:frame.grantSha256,grant});
 for(const bad of [{...frame,operationId:randomUUID()},{...frame,runtimeGeneration:randomUUID()},
  {...frame,grantSha256:'0'.repeat(64)},{...frame,approval:true},
  {...frame,grant:{...grant,expiresAt:now}},{...frame,grant:{...grant,source:{...grant.source,sessionToken:'leak'}}}]){
  expect(()=>read(bad)).toThrow();
 }
 const duplicate=JSON.stringify(frame).replace('"version":1','"version":1,"version":1');
 expect(()=>parseNativeModelAdoptionRequest(Buffer.from(duplicate),runtimeGeneration)).toThrow('NATIVE_MODEL_ADOPTION_UNAVAILABLE');
 const status={version:1,kind:'adoption-status-target',operationId,runtimeGeneration,grantSha256:frame.grantSha256};
 expect(read(status)).toEqual({kind:status.kind,operationId,grantSha256:frame.grantSha256});
 const controller=new AbortController();
 const send=vi.fn(async(_bytes:Uint8Array)=>{controller.abort();});
 const close=vi.fn(async()=>{});
 const authenticate=vi.fn();
 await runNativeModelAdoptionOwner({
  runtimeGeneration,signal:controller.signal,owner:grant.target as never,
  channel:{send,close,isOpen:()=>true,receive:async()=>Buffer.from(JSON.stringify(frame))},
  auth:{requestForNativeWorkspaceMutation:authenticate} as never,
  studio:{} as never,cms:{} as never,imports:{} as never,blobs:{} as never,broker:{} as never,
  assertLive:async()=>{},
 });
 expect(authenticate).not.toHaveBeenCalled();
 expect(JSON.parse(Buffer.from(send.mock.calls[0]![0]).toString())).toEqual({
  version:1,kind:'adoption-refused',operationId,runtimeGeneration,code:'NATIVE_MODEL_ADOPTION_UNAVAILABLE',
 });
 expect(close).toHaveBeenCalledOnce();

});
