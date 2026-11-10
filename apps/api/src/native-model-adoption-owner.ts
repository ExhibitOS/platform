// SPDX-License-Identifier: AGPL-3.0-or-later
import type {BlobStore} from '@exhibitos/storage';
import type {PoolClient} from 'pg';
import {ApiError} from './api-error.ts';
import type {Auth,Session} from './auth.ts';
import type {Cms} from './cms.ts';
import type {Imports} from './imports.ts';
import type {NativeAdoptionBroker} from './native-model-adoption-broker.ts';
import {modelReceiptDigest} from './model-preparation-intent.ts';
import {parseNativeModelAdoptionGrant,type NativeModelAdoptionGrant} from './native-model-adoption-grant.ts';
import {stageNativeModelAdoptionSource} from './native-model-adoption-source.ts';
import {commitNativeModelAdoptionTarget,lockNativeModelAdoptionTarget} from './native-model-adoption-target.ts';
import {disposeNativeModelAdoptionTarget,readNativeModelAdoptionDisposition} from './native-model-adoption-disposition.ts';
import type {Studio} from './studio.ts';

type Channel={send(frame:Uint8Array):Promise<void>;receive(waitMs:number):Promise<Buffer>;isOpen():boolean;close():Promise<void>};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hex=/^[0-9a-f]{64}$/;
const header=['version','kind','operationId','runtimeGeneration'];
const refused=()=>new ApiError(409,'NATIVE_MODEL_ADOPTION_UNAVAILABLE');
type Request={operationId:string}&(
 |{kind:'adoption-stage-source';sourceArtworkId:string;sourceArtworkRevision:number;target:NativeModelAdoptionGrant['target'];expiresAt:number}
 |{kind:'adoption-preview-target';grant:NativeModelAdoptionGrant}
 |{kind:'adoption-commit-target';grantSha256:string;grant:NativeModelAdoptionGrant}
 |{kind:'adoption-status-target';grantSha256:string}
 |{kind:'adoption-dispose-target';grantSha256:string;exhibitionId:string}
);

export function parseNativeModelAdoptionRequest(bytes:Buffer,runtimeGeneration:string):Request{
 let frame:Record<string,unknown>,raw:string;
 try{
  raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
  frame=JSON.parse(raw);
 }catch{throw refused();}
 if(!frame||typeof frame!=='object'||Array.isArray(frame)||raw!==JSON.stringify(frame)||frame.version!==1||
    frame.runtimeGeneration!==runtimeGeneration||typeof frame.operationId!=='string'||!uuid.test(frame.operationId))throw refused();
 const {kind,operationId}=frame;
 const exact=(...keys:string[])=>Object.keys(frame).join(',')===[...header,...keys].join(',');
 if(kind==='adoption-stage-source'){
  if(!exact('sourceArtworkId','sourceArtworkRevision','target','expiresAt')||
    typeof frame.sourceArtworkId!=='string'||!uuid.test(frame.sourceArtworkId)||!Number.isSafeInteger(frame.sourceArtworkRevision)||
    Number(frame.sourceArtworkRevision)<1||Number(frame.sourceArtworkRevision)>2147483647||
    !Number.isSafeInteger(frame.expiresAt))throw refused();
  return frame as unknown as Request;
 }
 if(kind==='adoption-dispose-target'){
  if(!exact('grantSha256','exhibitionId')||typeof frame.grantSha256!=='string'||!hex.test(frame.grantSha256)||typeof frame.exhibitionId!=='string'||!uuid.test(frame.exhibitionId))throw refused();
  return {kind,operationId,grantSha256:frame.grantSha256,exhibitionId:frame.exhibitionId};
 }
 if(kind==='adoption-status-target'){
  if(!exact('grantSha256')||typeof frame.grantSha256!=='string'||!hex.test(frame.grantSha256))throw refused();
  return {kind,operationId,grantSha256:frame.grantSha256};
 }
 if(kind!=='adoption-preview-target'&&kind!=='adoption-commit-target')throw refused();
 if(kind==='adoption-preview-target'?!exact('grant'):!exact('grantSha256','grant'))throw refused();
 const grant=parseNativeModelAdoptionGrant(frame.grant);
 if(grant.operationId!==operationId)throw refused();
 if(kind==='adoption-preview-target')return {kind,operationId,grant};
 if(typeof frame.grantSha256!=='string'||frame.grantSha256!==modelReceiptDigest(grant))throw refused();
 return {kind,operationId,grant,grantSha256:frame.grantSha256};
}

/** Only the admitted native runtime constructs this receiver. A commit frame
 * is issued by the Manager after its explicit target-owner confirmation. */
export async function runNativeModelAdoptionOwner(input:{
 channel:Channel;runtimeGeneration:string;owner:{workspaceId:string;tenantId:string;principalId:string;sessionToken:string;csrfToken:string};
 auth:Auth;studio:Studio;cms:Cms;imports:Imports;blobs:BlobStore;
 broker:NativeAdoptionBroker;signal:AbortSignal;assertLive:()=>Promise<void>;targetOnly?:boolean;
}){
 const {channel,runtimeGeneration,owner,auth,studio,cms,imports,blobs,broker,signal}=input;
 let preview:{operationId:string;grantSha256:string;expiresAt:number}|undefined;
 const live=async()=>{
  signal.throwIfAborted();
  if(!channel.isOpen())throw refused();
  await input.assertLive();
  signal.throwIfAborted();
  if(!channel.isOpen())throw refused();
 };
 const transaction=<T>(work:(c:PoolClient,s:Session,assertLive:()=>Promise<void>)=>Promise<T>)=>
  auth.requestForNativeWorkspaceMutation(owner.sessionToken,owner.tenantId,owner.csrfToken,async(c,s)=>{
   if(s.userId!==owner.principalId||s.tenantId!==owner.tenantId)throw refused();
   const check=async()=>{await live();if(Date.now()>=Date.parse(s.expiresAt))throw refused();};
   await check();
   const result=await work(c,s,check);
   await check();
   return result;
  });
 const send=(kind:string,operationId:string,payload:Record<string,unknown>)=>channel.send(Buffer.from(JSON.stringify({
  version:1,kind,operationId,runtimeGeneration,...payload,
 })));
 try{
  while(!signal.aborted){
   const bytes=await channel.receive(0);
   let request:Request;
   try{request=parseNativeModelAdoptionRequest(bytes,runtimeGeneration);}
   finally{bytes.fill(0);}
   const {operationId,kind}=request;
   let result:{kind:string;payload:Record<string,unknown>};
   try{
    await live();
    if(kind==='adoption-stage-source'){
     if(input.targetOnly)throw refused();
     const grant=await transaction((c,s)=>stageNativeModelAdoptionSource(c,s,{artworkId:request.sourceArtworkId,artworkRevision:request.sourceArtworkRevision},
      {operationId,target:request.target,expiresAt:request.expiresAt},broker,cms,imports,blobs,signal));
     result={kind:'adoption-source-staged',payload:{grant}};
    }else if(kind==='adoption-preview-target'){
     const {grant}=request;
     if(preview&&preview.operationId!==operationId&&preview.expiresAt>Date.now())throw refused();
     await transaction((c,s)=>lockNativeModelAdoptionTarget(c,s,grant,studio,cms,imports));
     const grantSha256=modelReceiptDigest(grant);
     if(preview&&preview.operationId===operationId&&preview.grantSha256!==grantSha256)throw refused();
     preview={operationId,grantSha256,expiresAt:grant.expiresAt};
     const {artworkId,artworkRevision,exhibitionId,placementId,etag}=grant.target;
     result={kind:'adoption-target-preview',payload:{grantSha256,preview:{artworkId,artworkRevision,exhibitionId,placementId,etag,original:grant.original,display:grant.display}}};
    }else if(kind==='adoption-commit-target'){
     const {grant,grantSha256}=request;
     if(preview?.operationId!==operationId||preview.grantSha256!==grantSha256||preview.expiresAt<=Date.now())throw refused();
     const response=await transaction((c,s,assertLive)=>commitNativeModelAdoptionTarget({
      client:c,session:s,grant,confirmedGrantSha256:grantSha256,broker,blobs,cms,imports,studio,signal,assertLive,
     }));
     preview=undefined;
     result={kind:'adoption-target-committed',payload:{grantSha256,revision:response.revision,etag:response.etag}};
    }else if(kind==='adoption-dispose-target'){
     const {grantSha256,exhibitionId}=request;
     const disposition=await transaction(async(c,s)=>{
      await imports.coarseOwner(c,s.tenantId,s.userId,owner.workspaceId);
      return disposeNativeModelAdoptionTarget(c,s,request,studio);
     });
     if(preview?.operationId===operationId&&preview.grantSha256===grantSha256)preview=undefined;
     result={kind:'adoption-target-disposition',payload:{grantSha256,exhibitionId,outcome:disposition.outcome,
      revision:disposition.outcome==='committed'?disposition.response.revision:null,etag:disposition.outcome==='committed'?disposition.response.etag:null}};
    }else{
     const {grantSha256}=request;
     const disposition=await transaction(async(c,s)=>{
      await imports.coarseOwner(c,s.tenantId,s.userId,owner.workspaceId);
      return readNativeModelAdoptionDisposition(c,s,operationId,grantSha256);
     });
     result={kind:'adoption-target-status',payload:{grantSha256,outcome:disposition.outcome,revision:disposition.outcome==='committed'?disposition.response.revision:null,etag:disposition.outcome==='committed'?disposition.response.etag:null}};
    }
   }catch(error){
    await live();
    const code=error instanceof ApiError&&['FORBIDDEN','RIGHTS_DENIED','REMOTE_CONFLICT','REQUEST_CONFLICT','MODEL_ADOPTION_TARGET_CHANGED','MODEL_ADOPTION_SOURCE_CHANGED','MODEL_ADOPTION_CANCELLED'].includes(error.code)
     ?error.code:'NATIVE_MODEL_ADOPTION_UNAVAILABLE';
    result={kind:'adoption-refused',payload:{code}};
   }
   await live();
   await send(result.kind,operationId,result.payload);
  }
 }finally{
  await channel.close();
 }
}
