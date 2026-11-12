// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,test,vi} from 'vitest';
import {GPU_MODEL_PROFILE,GPU_MODEL_RECIPE_SHA256} from '@exhibitos/studio-contract';
import {createGpuCandidatePreviewAuthority} from './gpu-candidate-preview-authority';
import type {GpuCandidatePreviewBegin} from './gpu-candidate-preview-wire';
const id=(n:number)=>`c1000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function canonical(value:unknown):unknown{return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>[key,canonical(item)])):value;}
async function sha(value:Uint8Array){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(value).buffer))].map(n=>n.toString(16).padStart(2,'0')).join('');}
async function fixture(){
 const bytes=new Uint8Array([103,108,84,70,2,0,0,0]),candidateHash=await sha(bytes);
 const request:GpuCandidatePreviewBegin={version:1,phase:'begin',epoch:id(1),sequence:1,requestId:id(2),workspaceId:id(3),tenantId:id(4),principalId:id(5),artworkId:id(6),artworkRevision:3,jobId:id(7),generation:'fixture.generation-1',receiptSHA256:'a'.repeat(64),source:{assetId:id(8),mime:'model/gltf-binary',sha256:'b'.repeat(64),bytes:1024,approvalSHA256:'c'.repeat(64),rightsSHA256:'d'.repeat(64)},candidate:{assetId:id(9),mime:'model/gltf-binary',sha256:candidateHash,bytes:bytes.length}};
 const receipt={version:1,purpose:'approved-display-gpu-derivative',profile:GPU_MODEL_PROFILE,recipeSHA256:GPU_MODEL_RECIPE_SHA256,jobId:request.jobId,artworkId:request.artworkId,artworkRevision:3,operationID:'fixture.operation-1',generation:request.generation,source:structuredClone(request.source),candidate:structuredClone(request.candidate),producer:{version:1,geometry:{triangles:1200,vertices:3600},tool:{name:'fixture-only'}},sha256:''};
 const session={id:id(10),tenantId:request.tenantId,userId:request.principalId,role:'artist',csrfToken:'fixture-csrf',expiresAt:new Date(Date.now()+3600000).toISOString()};
 const preparation={version:1,purpose:receipt.purpose,profile:GPU_MODEL_PROFILE,recipeSHA256:GPU_MODEL_RECIPE_SHA256,operationID:receipt.operationID,generation:request.generation,artworkRevision:3,status:'ready',workerDrained:true,source:structuredClone(request.source),candidate:structuredClone(request.candidate),serverReceipt:receipt};
 const job={id:request.jobId,state:'approved',assetId:request.candidate.assetId,gpuPreparation:preparation};
 const review:{artworkId:string;revision:number;jobId:string;receiptSHA256:string;source:typeof request.source;candidate:typeof request.candidate;serverReceipt:typeof receipt;selection:unknown}={artworkId:request.artworkId,revision:3,jobId:request.jobId,receiptSHA256:'',source:structuredClone(request.source),candidate:structuredClone(request.candidate),serverReceipt:receipt,selection:null};
 const headers=new Headers({'content-type':'model/gltf-binary','content-length':String(bytes.length),'cache-control':'private, no-store','x-content-type-options':'nosniff','x-exhibitos-sha256':candidateHash,'x-exhibitos-receipt-sha256':''});
 const sign=async()=>{const {sha256:_ignored,...body}=receipt;receipt.sha256=await sha(new TextEncoder().encode(JSON.stringify(canonical(body))));request.receiptSHA256=receipt.sha256;review.receiptSHA256=receipt.sha256;headers.set('x-exhibitos-receipt-sha256',receipt.sha256);};
 await sign();
 let modelBody:BodyInit=bytes;let sessionCount=0;
 let changeSession:((value:typeof session,count:number)=>unknown)|undefined;
 const fetcher=vi.fn(async(path:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(path);expect(init).toMatchObject({method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:expect.any(AbortSignal)});
  if(url==='/api/v1/auth/session'){sessionCount++;return Response.json(changeSession?changeSession(structuredClone(session),sessionCount):session);}
  if(url.endsWith(`/imports/${request.jobId}`))return Response.json(job);
  if(url.endsWith('/review'))return Response.json(review);
  if(url.includes('/model?')){expect(url).toBe(`/api/v1/tenants/${request.tenantId}/cms/artworks/${request.artworkId}/gpu-preparations/${request.jobId}/model?receiptSHA256=${request.receiptSHA256}&candidateSHA256=${request.candidate.sha256}`);return new Response(modelBody,{headers});}
  throw Error('UNEXPECTED_ROUTE');
 });vi.stubGlobal('fetch',fetcher);
 const select=()=>{review.revision=4;review.selection={version:1,profile:GPU_MODEL_PROFILE,jobId:request.jobId,sourceAssetId:request.source.assetId,candidateAssetId:request.candidate.assetId,candidateSHA256:request.candidate.sha256,receiptSHA256:request.receiptSHA256,approvedRevision:4};};
 return {request,receipt,session,preparation,job,review,bytes,headers,fetcher,sign,select,setBody:(body:BodyInit)=>{modelBody=body;},setSession:(change:typeof changeSession)=>{changeSession=change;}};
}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
test('fresh authenticated review creates authority, reads only actual candidate, rechecks after SHA verification',async()=>{
 const f=await fixture(),authority=await createGpuCandidatePreviewAuthority(f.request,new AbortController().signal);
 expect(authority.expiresAt).toBe(Date.parse(f.session.expiresAt));expect(await authority.check()).toEqual({reviewRevision:3,maxTriangles:1200});expect(new Uint8Array(await authority.read())).toEqual(f.bytes);
 expect(f.fetcher.mock.calls.filter(([url])=>String(url).includes('/model?'))).toHaveLength(1);
 expect(f.fetcher.mock.calls.slice(-4).map(([url])=>url)).toEqual(['/api/v1/auth/session',`/api/v1/tenants/${f.request.tenantId}/imports/${f.request.jobId}`,`/api/v1/tenants/${f.request.tenantId}/cms/artworks/${f.request.artworkId}/gpu-preparations/${f.request.jobId}/review`,'/api/v1/auth/session']);
});
test('allows only matching current R+1 selection, including transition after authority creation',async()=>{
 const f=await fixture(),authority=await createGpuCandidatePreviewAuthority(f.request,new AbortController().signal);f.select();expect(await authority.check()).toEqual({reviewRevision:4,maxTriangles:1200});
 (f.review.selection as Record<string,unknown>).candidateAssetId=id(90);await expect(authority.check()).rejects.toThrow();
});
test.each(['tenantId','userId','role','csrfToken','expiresAt','id'] as const)('rejects changed session fingerprint %s',async key=>{
 const f=await fixture(),authority=await createGpuCandidatePreviewAuthority(f.request,new AbortController().signal);
 f.setSession(value=>({...value,[key]:key==='role'?'curator':key==='expiresAt'?new Date(Date.now()+7200000).toISOString():id(99)}));await expect(authority.check()).rejects.toThrow();
});
test('rejects session change within one check, expiry, empty CSRF, and viewer role without requiring producer capability',async()=>{
 for(const change of [(v:Record<string,unknown>,n:number)=>({...v,csrfToken:n%2?'one':'two'}),(v:Record<string,unknown>)=>({...v,expiresAt:new Date(0).toISOString()}),(v:Record<string,unknown>)=>({...v,csrfToken:''}),(v:Record<string,unknown>)=>({...v,role:'viewer'})]){
  const f=await fixture();f.setSession(change);await expect(createGpuCandidatePreviewAuthority(f.request,new AbortController().signal)).rejects.toThrow();
 }
});
test.each(['state','generation','source','receipt','drained','jobId'] as const)('rejects stale or altered job %s',async kind=>{
 const f=await fixture();
 if(kind==='state')f.job.state='processing';if(kind==='generation')f.preparation.generation='different';if(kind==='source')f.preparation.source.sha256='f'.repeat(64);if(kind==='receipt')f.preparation.serverReceipt={...f.receipt,operationID:'other'};if(kind==='drained')f.preparation.workerDrained=false;if(kind==='jobId')f.job.id=id(99);
 await expect(createGpuCandidatePreviewAuthority(f.request,new AbortController().signal)).rejects.toThrow();
});
test('rejects altered receipt body even when job/review agree and enforces exact receipt keys/metrics',async()=>{
 const f=await fixture();f.receipt.operationID='changed';await expect(createGpuCandidatePreviewAuthority(f.request,new AbortController().signal)).rejects.toThrow();
 const g=await fixture();Object.assign(g.receipt,{unknown:true});await g.sign();await expect(createGpuCandidatePreviewAuthority(g.request,new AbortController().signal)).rejects.toThrow();
 const h=await fixture();h.receipt.producer.geometry.triangles=200001;await h.sign();await expect(createGpuCandidatePreviewAuthority(h.request,new AbortController().signal)).rejects.toThrow();
});
test('rejects wrong current review revision, source, or selection; preserves frozen request after caller mutation',async()=>{
 const f=await fixture();f.review.revision=5;await expect(createGpuCandidatePreviewAuthority(f.request,new AbortController().signal)).rejects.toThrow();
 const g=await fixture();g.review.source.rightsSHA256='f'.repeat(64);await expect(createGpuCandidatePreviewAuthority(g.request,new AbortController().signal)).rejects.toThrow();
 const h=await fixture();h.review.selection={jobId:id(99)};await expect(createGpuCandidatePreviewAuthority(h.request,new AbortController().signal)).rejects.toThrow();
 const i=await fixture(),authority=await createGpuCandidatePreviewAuthority(i.request,new AbortController().signal);i.request.candidate.bytes=99;expect(await authority.check()).toEqual({reviewRevision:3,maxTriangles:1200});
});
test.each(['content-type','content-length','cache-control','x-content-type-options','x-exhibitos-sha256','x-exhibitos-receipt-sha256'])('rejects wrong model header %s',async header=>{
 const f=await fixture(),authority=await createGpuCandidatePreviewAuthority(f.request,new AbortController().signal);f.headers.set(header,'wrong');await expect(authority.read()).rejects.toThrow();
});
test('rejects wrong, short and oversized model bodies and authority changes after body verification',async()=>{
 for(const body of [new Uint8Array(8),new Uint8Array(7),new Uint8Array(9)]){const f=await fixture(),authority=await createGpuCandidatePreviewAuthority(f.request,new AbortController().signal);f.setBody(body);await expect(authority.read()).rejects.toThrow();}
 const f=await fixture(),authority=await createGpuCandidatePreviewAuthority(f.request,new AbortController().signal);let modelRead=false;
 f.fetcher.mockImplementation(async url=>{if(String(url).includes('/model?')){modelRead=true;return new Response(f.bytes,{headers:f.headers});}if(String(url)==='/api/v1/auth/session')return Response.json({...f.session,csrfToken:modelRead?'changed':f.session.csrfToken});if(String(url).endsWith('/review'))return Response.json(f.review);return Response.json(f.job);});await expect(authority.read()).rejects.toThrow();
});
test('bounds JSON streams and honors abort during pending model body without returning bytes',async()=>{
 const f=await fixture();f.fetcher.mockResolvedValueOnce(new Response(' '.repeat(1024*1024+1),{headers:{'content-type':'application/json'}}));await expect(createGpuCandidatePreviewAuthority(f.request,new AbortController().signal)).rejects.toThrow();
 const g=await fixture(),controller=new AbortController(),authority=await createGpuCandidatePreviewAuthority(g.request,controller.signal);const cancel=vi.fn();g.setBody(new ReadableStream({cancel}));const pending=authority.read();void pending.catch(()=>{});await vi.waitFor(()=>expect(g.fetcher.mock.calls.some(([url])=>String(url).includes('/model?'))).toBe(true));controller.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(cancel).toHaveBeenCalled();
});

test('invalid model headers cancel the unconsumed body; abort before creation performs no request',async()=>{
 const f=await fixture(),authority=await createGpuCandidatePreviewAuthority(f.request,new AbortController().signal),cancel=vi.fn();f.setBody(new ReadableStream({cancel}));f.headers.delete('x-content-type-options');await expect(authority.read()).rejects.toThrow();expect(cancel).toHaveBeenCalledOnce();
 const g=await fixture(),controller=new AbortController();controller.abort();await expect(createGpuCandidatePreviewAuthority(g.request,controller.signal)).rejects.toMatchObject({name:'AbortError'});expect(g.fetcher).not.toHaveBeenCalled();
});
test.each([0,-1,1.5,Number.MAX_SAFE_INTEGER])('does not grant invalid producer triangle authority %s',async triangles=>{
 const f=await fixture();f.receipt.producer.geometry.triangles=triangles;await f.sign();await expect(createGpuCandidatePreviewAuthority(f.request,new AbortController().signal)).rejects.toThrow();
});
