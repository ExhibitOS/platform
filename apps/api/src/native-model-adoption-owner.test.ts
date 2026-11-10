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
  receiptSha256:'a'.repeat(64),rightsSha256:'b'.repeat(64),rightsPolicySha256:'e'.repeat(64),sourceCreditLine:'Example institution',original:{sha256:'c'.repeat(64),bytes:64},
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
 const dispose={version:1,kind:'adoption-dispose-target',operationId,runtimeGeneration,grantSha256:frame.grantSha256,exhibitionId:grant.target.exhibitionId};
 expect(read(dispose)).toEqual({kind:dispose.kind,operationId,grantSha256:dispose.grantSha256,exhibitionId:dispose.exhibitionId});
 for(const bad of [{...dispose,exhibitionId:'invalid'},{...dispose,grantSha256:'bad'},{...dispose,grant},
  {version:1,kind:dispose.kind,operationId,runtimeGeneration,exhibitionId:dispose.exhibitionId,grantSha256:dispose.grantSha256}])expect(()=>read(bad)).toThrow();
 const controller=new AbortController();
 const send=vi.fn<(bytes:Uint8Array)=>Promise<void>>(async()=>{controller.abort();});
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

it('refuses source staging on a carried target before authorization or broker access',async()=>{
 const controller=new AbortController();
 const operationId=randomUUID(),runtimeGeneration=randomUUID();
 const stage={version:1,kind:'adoption-stage-source',operationId,runtimeGeneration,sourceArtworkId:randomUUID(),sourceArtworkRevision:1,target:{},expiresAt:Date.now()+10000};
 const authenticate=vi.fn();
 let response:unknown;
 await runNativeModelAdoptionOwner({
  runtimeGeneration,targetOnly:true,signal:controller.signal,owner:{} as never,
  channel:{send:async bytes=>{response=JSON.parse(Buffer.from(bytes).toString());controller.abort();},
   close:async()=>{},isOpen:()=>true,receive:async()=>Buffer.from(JSON.stringify(stage))},
  auth:{requestForNativeWorkspaceMutation:authenticate} as never,
  studio:{} as never,cms:{} as never,imports:{} as never,blobs:{} as never,broker:{} as never,assertLive:async()=>{},
 });
 expect(authenticate).not.toHaveBeenCalled();
 expect(response).toMatchObject({kind:'adoption-refused',operationId});
});

it.each(['cancelled','committed'] as const)('returns %s disposition and durable status through the authenticated carried-target entry',async(outcome)=>{
 const operationId=randomUUID(),runtimeGeneration=randomUUID(),exhibitionId=randomUUID(),grantSha256='a'.repeat(64);
 const owner={workspaceId:randomUUID(),tenantId:randomUUID(),principalId:randomUUID(),sessionToken:'session',csrfToken:'csrf'};
 const session={tenantId:owner.tenantId,userId:owner.principalId,expiresAt:new Date(Date.now()+60000).toISOString()};
 const committed={revision:8,etag:'committed-etag'};
 let row:unknown=outcome==='committed'?{payload_sha256:modelReceiptDigest(['native-model-adoption-v1',grantSha256]),exhibition_id:exhibitionId,response:committed}:undefined;
 const query=vi.fn(async(sql:string,values:unknown[])=>{
  if(sql.includes('FROM studio_requests'))return {rowCount:row?1:0,rows:row?[row]:[]};
  if(sql.startsWith('INSERT INTO studio_requests'))row={payload_sha256:values[3],exhibition_id:values[4],response:values[5]};
  return {rowCount:0,rows:[]};
 });
 const frames=[
  {version:1,kind:'adoption-dispose-target',operationId,runtimeGeneration,grantSha256,exhibitionId},
  {version:1,kind:'adoption-status-target',operationId,runtimeGeneration,grantSha256},
 ];
 const controller=new AbortController(),responses:unknown[]=[];
 const authenticate=vi.fn(async(token:string,tenantId:string,csrf:string,work:(c:unknown,s:unknown)=>Promise<unknown>)=>{
  expect([token,tenantId,csrf]).toEqual([owner.sessionToken,owner.tenantId,owner.csrfToken]);
  return work({query},session);
 });
 const coarseOwner=vi.fn(),access=vi.fn(async()=>({studio_owner_user_id:owner.principalId}));
 await runNativeModelAdoptionOwner({runtimeGeneration,owner,targetOnly:true,signal:controller.signal,
  channel:{receive:async()=>Buffer.from(JSON.stringify(frames.shift())),send:async bytes=>{responses.push(JSON.parse(Buffer.from(bytes).toString()));if(responses.length===2)controller.abort();},close:async()=>{},isOpen:()=>true},
  auth:{requestForNativeWorkspaceMutation:authenticate} as never,studio:{access} as never,
  imports:{coarseOwner} as never,cms:{} as never,blobs:{} as never,broker:{} as never,assertLive:async()=>{},
 });
 const fields={grantSha256,outcome,revision:outcome==='committed'?8:null,etag:outcome==='committed'?'committed-etag':null};
 expect(responses).toEqual([
  {version:1,kind:'adoption-target-disposition',operationId,runtimeGeneration,grantSha256,exhibitionId,outcome,revision:fields.revision,etag:fields.etag},
  {version:1,kind:'adoption-target-status',operationId,runtimeGeneration,...fields},
 ]);
 expect(authenticate).toHaveBeenCalledTimes(2);
 expect(coarseOwner).toHaveBeenCalledWith(expect.anything(),owner.tenantId,owner.principalId,owner.workspaceId);
 expect(access).toHaveBeenCalledTimes(outcome==='committed'?0:1);
});
