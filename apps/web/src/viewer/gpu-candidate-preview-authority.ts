// SPDX-License-Identifier: AGPL-3.0-or-later
import {GPU_MODEL_PROFILE,GPU_MODEL_RECIPE_SHA256,MAX_GPU_MODEL_TRIANGLES} from '@exhibitos/studio-contract';
import {checkedGpuCandidatePreviewRequest,type GpuCandidatePreviewBegin} from './gpu-candidate-preview-wire';

type RecordValue=Record<string,unknown>;
function fail():never{throw Error('GPU_CANDIDATE_PREVIEW_AUTHORITY_CHANGED');}
const record=(v:unknown):v is RecordValue=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const integer=(v:unknown,min:number,max=Number.MAX_SAFE_INTEGER):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const token=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v);
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const purpose='approved-display-gpu-derivative';
function canonical(v:unknown):string {
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 if(record(v))return '{'+Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}';
 return JSON.stringify(v);
}
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
async function digest(bytes:ArrayBuffer,signal:AbortSignal){
 const result=await crypto.subtle.digest('SHA-256',bytes);signal.throwIfAborted();
 return [...new Uint8Array(result)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
/** Bounded reads retain the real fetch signal and cancel a body on every early
 * exit. JSON and candidate models never use an unbounded response.json(). */
async function body(response:Response,limit:number,signal:AbortSignal,exact?:number):Promise<ArrayBuffer>{
 const reader=response.body?.getReader();if(!reader)fail();
 const chunks:Uint8Array[]=[];let length=0,complete=false;
 const cancel=()=>{void reader.cancel(signal.reason).catch(()=>{});};
 signal.addEventListener('abort',cancel,{once:true});
 try {
  for(;;){signal.throwIfAborted();const next=await reader.read();signal.throwIfAborted();if(next.done)break;length+=next.value.byteLength;if(length>limit)fail();chunks.push(next.value);}
  if(exact!==undefined&&length!==exact)fail();
  const bytes=new Uint8Array(length);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}complete=true;return bytes.buffer;
 } finally {if(!complete)await reader.cancel().catch(()=>{});signal.removeEventListener('abort',cancel);reader.releaseLock();}
}
async function rejectResponse(response:Response):Promise<never>{
 await response.body?.cancel().catch(()=>{});return fail();
}
async function get(path:string,signal:AbortSignal){
 signal.throwIfAborted();const response=await fetch(path,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal});signal.throwIfAborted();
 if(!response.ok||response.redirected)await rejectResponse(response);return response;
}
async function json(path:string,signal:AbortSignal){
 const response=await get(path,signal);signal.throwIfAborted();
 if(response.headers.get('content-type')?.split(';')[0]?.trim()!=='application/json')await rejectResponse(response);
 const bytes=await body(response,1024*1024,signal);signal.throwIfAborted();
 const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!record(value))fail();return value;
}
function sessionFingerprint(value:RecordValue,request:GpuCandidatePreviewBegin){
 if(value.tenantId!==request.tenantId||value.userId!==request.principalId||!['admin','artist','curator'].includes(String(value.role))||typeof value.csrfToken!=='string'||!value.csrfToken.trim()||typeof value.expiresAt!=='string'||!Number.isFinite(Date.parse(value.expiresAt))||Date.parse(value.expiresAt)<=Date.now())fail();
 if(value.id!==undefined&&(typeof value.id!=='string'||!value.id))fail();
 return {tenantId:value.tenantId,userId:value.userId,role:value.role,csrfToken:value.csrfToken,expiresAt:value.expiresAt,...(value.id===undefined?{}:{id:value.id})};
}
function receiptShape(value:unknown,request:GpuCandidatePreviewBegin):asserts value is RecordValue {
 const keys='version,purpose,profile,recipeSHA256,jobId,artworkId,artworkRevision,operationID,generation,source,candidate,producer,sha256';
 if(!record(value)||Object.keys(value).sort().join(',')!==keys.split(',').sort().join(',')||value.version!==1||value.purpose!==purpose||value.profile!==GPU_MODEL_PROFILE||value.recipeSHA256!==GPU_MODEL_RECIPE_SHA256||value.jobId!==request.jobId||value.artworkId!==request.artworkId||value.artworkRevision!==request.artworkRevision||!token(value.operationID)||value.generation!==request.generation||value.sha256!==request.receiptSHA256||!same(value.source,request.source)||!same(value.candidate,request.candidate))fail();
}

/** Authenticated review authority only. It grants no creation, approval,
 * placement, original fallback, public-source alias or workspace capability. */
export async function createGpuCandidatePreviewAuthority(input:GpuCandidatePreviewBegin,signal:AbortSignal):Promise<{
 read():Promise<ArrayBuffer>;check():Promise<{reviewRevision:number;maxTriangles:number}>;expiresAt:number;
}>{
 const checked=checkedGpuCandidatePreviewRequest(input);if(checked.phase!=='begin')fail();const request=checked;
 const base=`/api/v1/tenants/${request.tenantId}`,reviewPath=`${base}/cms/artworks/${request.artworkId}/gpu-preparations/${request.jobId}`;
 let baseline:ReturnType<typeof sessionFingerprint>|undefined;
 const check=async()=>{
  const first=sessionFingerprint(await json('/api/v1/auth/session',signal),request);signal.throwIfAborted();
  if(baseline&&!same(first,baseline))fail();
  const job=await json(`${base}/imports/${request.jobId}`,signal);signal.throwIfAborted();
  const review=await json(`${reviewPath}/review`,signal);signal.throwIfAborted();
  const last=sessionFingerprint(await json('/api/v1/auth/session',signal),request);signal.throwIfAborted();
  if(!same(first,last)||baseline&&!same(last,baseline))fail();
  const preparation=job.gpuPreparation,receipt=review.serverReceipt;
  receiptShape(receipt,request);
  if(job.id!==request.jobId||job.state!=='approved'||job.assetId!==request.candidate.assetId||!record(preparation)||preparation.version!==1||preparation.purpose!==purpose||preparation.profile!==GPU_MODEL_PROFILE||preparation.recipeSHA256!==GPU_MODEL_RECIPE_SHA256||preparation.generation!==request.generation||preparation.artworkRevision!==request.artworkRevision||preparation.status!=='ready'||preparation.workerDrained!==true||preparation.operationID!==receipt.operationID||!same(preparation.source,request.source)||!same(preparation.candidate,request.candidate)||!same(preparation.serverReceipt,receipt))fail();
  if(review.artworkId!==request.artworkId||review.jobId!==request.jobId||review.receiptSHA256!==request.receiptSHA256||!same(review.source,request.source)||!same(review.candidate,request.candidate)||!integer(review.revision,request.artworkRevision,request.artworkRevision+1))fail();
  if(review.revision===request.artworkRevision+1){
   const expected={version:1,profile:GPU_MODEL_PROFILE,jobId:request.jobId,sourceAssetId:request.source.assetId,candidateAssetId:request.candidate.assetId,candidateSHA256:request.candidate.sha256,receiptSHA256:request.receiptSHA256,approvedRevision:review.revision};
   if(!same(review.selection,expected))fail();
  }else if(review.selection!==null)fail();
  const {sha256:receiptHash,...unsigned}=receipt;
  if(!hash(receiptHash)||await digest(new TextEncoder().encode(canonical(unsigned)).buffer,signal)!==request.receiptSHA256)fail();signal.throwIfAborted();
  const producer=receipt.producer,geometry=record(producer)?producer.geometry:undefined;
  if(!record(geometry)||!integer(geometry.triangles,1,MAX_GPU_MODEL_TRIANGLES))fail();
  if(Date.parse(last.expiresAt as string)<=Date.now())fail();
  baseline??=first;
  return {reviewRevision:review.revision,maxTriangles:geometry.triangles};
 };
 await check();signal.throwIfAborted();
 const expiresAt=Date.parse(baseline!.expiresAt as string);
 return {expiresAt,check,async read(){
  await check();signal.throwIfAborted();
  const response=await get(`${reviewPath}/model?receiptSHA256=${request.receiptSHA256}&candidateSHA256=${request.candidate.sha256}`,signal);signal.throwIfAborted();
  if(response.headers.get('content-type')?.trim()!=='model/gltf-binary'||response.headers.get('content-length')!==String(request.candidate.bytes)||!response.headers.get('cache-control')?.split(',').some(part=>part.trim().toLowerCase()==='no-store')||response.headers.get('x-content-type-options')?.toLowerCase()!=='nosniff'||response.headers.get('x-exhibitos-sha256')!==request.candidate.sha256||response.headers.get('x-exhibitos-receipt-sha256')!==request.receiptSHA256)await rejectResponse(response);
  const bytes=await body(response,request.candidate.bytes,signal,request.candidate.bytes);signal.throwIfAborted();
  if(await digest(bytes,signal)!==request.candidate.sha256)fail();signal.throwIfAborted();
  await check();signal.throwIfAborted();return bytes;
 }};
}
