// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {ApiError} from './api-error.ts';
import type {readApprovedModelCustody} from './artwork-replacement.ts';
import {COMPACT_MODEL_RECIPE} from './oam-original-preparation.ts';
import {modelReceiptDigest} from './model-preparation-intent.ts';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256=/^[0-9a-f]{64}$/;
const STUDIO_ETAG=/^"studio-r[1-9][0-9]{0,9}-[0-9a-f]{64}"$/;
const MAX_GRANT_AGE=15*60*1000;

type Custody=Awaited<ReturnType<typeof readApprovedModelCustody>>;
type Source=Custody['source'];
interface Target {
 workspaceId:string;tenantId:string;principalId:string;
 artworkId:string;artworkRevision:number;exhibitionId:string;placementId:string;etag:string;
}
interface BlobIdentity {sha256:string;bytes:number}
export interface NativeModelAdoptionGrant {
 version:1;operationId:string;issuedAt:number;expiresAt:number;
 source:Source;target:Target;receiptSha256:string;rightsSha256:string;rightsPolicySha256:string;
 original:BlobIdentity;display:BlobIdentity;
}

function exact(value:unknown,keys:readonly string[]):value is Record<string,unknown>{
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length
  &&keys.every(key=>Object.hasOwn(value,key));
}
const uuid=(value:unknown):value is string=>typeof value==='string'&&UUID.test(value);
const digest=(value:unknown):value is string=>typeof value==='string'&&SHA256.test(value);
const revision=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>0&&Number(value)<=2147483647;
function owner(value:Record<string,unknown>){
 return [value.workspaceId,value.tenantId,value.principalId,value.artworkId].every(uuid)&&revision(value.artworkRevision);
}
function blob(value:unknown):value is BlobIdentity{
 return exact(value,['sha256','bytes'])&&digest(value.sha256)&&Number.isSafeInteger(value.bytes)
  &&Number(value.bytes)>=28&&Number(value.bytes)<=COMPACT_MODEL_RECIPE.limits.sourceBytes;
}

/** Validate only after the caller has authenticated the private native channel.
 * A valid frame is not evidence of custody when submitted by an HTTP caller. */
export function parseNativeModelAdoptionGrant(input:unknown,now=Date.now()):NativeModelAdoptionGrant{
 const fail=()=>new ApiError(409,'MODEL_ADOPTION_GRANT_INVALID');
 if(!exact(input,['version','operationId','issuedAt','expiresAt','source','target','receiptSha256','rightsSha256','rightsPolicySha256','original','display'])||
    input.version!==1||!uuid(input.operationId)||!digest(input.receiptSha256)||!digest(input.rightsSha256)||!digest(input.rightsPolicySha256)||
    !Number.isSafeInteger(input.issuedAt)||!Number.isSafeInteger(input.expiresAt)||!Number.isSafeInteger(now))throw fail();
 const issued=Number(input.issuedAt),expires=Number(input.expiresAt);
 if(issued<0||issued>now||expires<=now||expires-issued>MAX_GRANT_AGE)throw fail();
 const {source,target,original,display}=input;
 if(!exact(source,['workspaceId','tenantId','principalId','artworkId','artworkRevision','artworkRevisionId'])||
    !owner(source)||!uuid(source.artworkRevisionId)||
    !exact(target,['workspaceId','tenantId','principalId','artworkId','artworkRevision','exhibitionId','placementId','etag'])||
    !owner(target)||!uuid(target.exhibitionId)||!uuid(target.placementId)||typeof target.etag!=='string'||!STUDIO_ETAG.test(target.etag)||
    source.workspaceId===target.workspaceId||!blob(original)||!blob(display)||
    (display.sha256===original.sha256?display.bytes!==original.bytes:display.bytes>COMPACT_MODEL_RECIPE.limits.outputBytes))throw fail();
 return structuredClone(input) as unknown as NativeModelAdoptionGrant;
}

/** Attribution belongs to each artwork record. Every other rights field
 * must match the policy of the source whose full rights digest was verified. */
export function nativeModelAdoptionRightsPolicyDigest(rights:SourceRights){
 return modelReceiptDigest(Object.fromEntries(Object.entries(rights).filter(([key])=>key!=='creditLine')));
}
type SourceRights=Custody['rights'];

export function createNativeModelAdoptionGrant(custody:Custody,input:{operationId:string;target:Target;expiresAt:number},now=Date.now()){
 const {receipt,source,rights}=custody;
 const rightsSha256=modelReceiptDigest(rights);
 if(receipt.rightsSHA256!==rightsSha256||receipt.artworkId!==source.artworkId||receipt.artworkRevision!==source.artworkRevision)
  throw new ApiError(409,'MODEL_ADOPTION_SOURCE_CHANGED');
 return parseNativeModelAdoptionGrant({
  version:1,operationId:input.operationId,issuedAt:now,expiresAt:input.expiresAt,source,target:input.target,
  receiptSha256:receipt.sha256,rightsSha256,rightsPolicySha256:nativeModelAdoptionRightsPolicyDigest(rights),
  original:{sha256:receipt.original.sha256,bytes:receipt.original.bytes},
  display:{sha256:receipt.display.sha256,bytes:receipt.display.bytes},
 },now);
}

/** Verify the stream actually read from the retained private stage. The native
 * caller must also await a clean broker close before using the returned bytes. */
export async function readNativeModelAdoptionBlob(grant:NativeModelAdoptionGrant,role:'original'|'display',stream:AsyncIterable<Uint8Array>,signal:AbortSignal){
 signal.throwIfAborted();
 const expected=grant[role];
 if(!blob(expected))throw new ApiError(409,'MODEL_ADOPTION_GRANT_INVALID');
 const bytes=Buffer.alloc(expected.bytes),hash=createHash('sha256');
 let offset=0;
 try{
  for await(const part of stream){
   signal.throwIfAborted();
   if(!(part instanceof Uint8Array)||part.byteLength>bytes.length-offset)throw new ApiError(409,'MODEL_ADOPTION_STAGE_INTEGRITY');
   bytes.set(part,offset);offset+=part.byteLength;
   hash.update(bytes.subarray(offset-part.byteLength,offset));
  }
  signal.throwIfAborted();
  if(offset!==bytes.length||hash.digest('hex')!==expected.sha256)throw new ApiError(409,'MODEL_ADOPTION_STAGE_INTEGRITY');
  return bytes;
 }catch(error){
  bytes.fill(0);
  throw error;
 }
}
