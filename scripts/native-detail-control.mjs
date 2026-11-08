// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {parseStaticJson} from '../apps/web/src/static-json.mjs';

const emptyDigest=createHash('sha256').update('[]').digest('hex');
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const unavailable=()=>{throw Error('NATIVE_DETAIL_CONTROL');};
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/,sha=/^[a-f0-9]{64}$/,secret=/^[A-Za-z0-9_-]{43}$/;

/** Owner-only control. Until a qualified source adapter exists, nonempty detail
 * is refused, never silently omitted. The caller owns the overall deadline. */
export function nativeDetailControl(startup,signal,fetcher=fetch){
 let parsed;try{parsed=new URL(startup.origin);}catch{unavailable();}
 if(!exact(startup,['version','jobId','runtimeGeneration','workspaceId','tenantId','principalId','publicationId','revisionSha256','origin','sessionToken','csrfToken'])||startup.version!==1||!['jobId','runtimeGeneration','workspaceId','tenantId','principalId','publicationId'].every(k=>typeof startup[k]==='string'&&uuid.test(startup[k]))||typeof startup.revisionSha256!=='string'||!sha.test(startup.revisionSha256)||typeof startup.sessionToken!=='string'||!secret.test(startup.sessionToken)||typeof startup.csrfToken!=='string'||!secret.test(startup.csrfToken)||parsed.origin!==startup.origin||parsed.protocol!=='http:'||parsed.hostname!=='127.0.0.1'||!parsed.port)unavailable();
 const {origin,tenantId,publicationId,jobId,revisionSha256,runtimeGeneration}=startup;
 const base=`${origin}/api/v1/tenants/${tenantId}/studio/publications/${publicationId}/native-detail-export`;
 const headers={origin,cookie:`exhibitos_local_session=${startup.sessionToken}`,'x-csrf-token':startup.csrfToken,'content-type':'application/json'};
 const body={version:1,jobId,revisionSha256};
 async function readBody(response,limit,requestSignal){
  if(!response.body)unavailable();let buffer;try{buffer=Buffer.allocUnsafe(limit);}catch(error){await response.body.cancel();throw error;}const reader=response.body.getReader();let size=0,count=0,cancelled;
  const cancel=()=>{cancelled??=reader.cancel();cancelled.catch(()=>{});};requestSignal.addEventListener('abort',cancel,{once:true});if(requestSignal.aborted)cancel();
  try{requestSignal.throwIfAborted();for(;;){const part=await reader.read();requestSignal.throwIfAborted();if(part.done)break;if(!part.value.byteLength||++count>65536||size+part.value.byteLength>limit)unavailable();buffer.set(part.value,size);size+=part.value.byteLength;}}
  catch(error){cancel();await cancelled;throw error;}finally{requestSignal.removeEventListener('abort',cancel);try{if(cancelled)await cancelled;}finally{reader.releaseLock();}}
  return buffer.subarray(0,size);
 }
 async function json(response,requestSignal){
  if(!response.body)unavailable();if(response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'){await response.body.cancel();unavailable();}const data=await readBody(response,1048576,requestSignal);let value;try{value=parseStaticJson(data,1048576);}catch{unavailable();}requestSignal.throwIfAborted();return value;
 }
 const busy=(response,value)=>response.status===409&&exact(value,['code','message','fieldErrors','requestId'])&&value.code==='NATIVE_DETAIL_BUSY'&&value.message===value.code&&Array.isArray(value.fieldErrors)&&value.fieldErrors.length===0&&typeof value.requestId==='string';
 async function send(suffix,payload,requestSignal){requestSignal.throwIfAborted();return fetcher(base+suffix,{method:payload?'POST':'GET',headers:suffix==='/bytes'?{...headers,'accept-encoding':'identity'}:headers,...(payload?{body:JSON.stringify(payload)}:{}),signal:requestSignal,redirect:'error',cache:'no-store'});}
 async function request(suffix,payload,requestSignal=signal){
  const response=await send(suffix,payload,requestSignal),value=await json(response,requestSignal);
  if(!response.ok){if(busy(response,value))return {busy:true};unavailable();}return {value};
 }
 async function retry(suffix,payload,phaseSignal=signal){for(;;){const result=await request(suffix,payload,phaseSignal);if(!result.busy)return result.value;await delay(25,undefined,{signal:phaseSignal});}}
 return {
  async prepare(){const v=await retry('/prepare',body);if(!exact(v,['version','publicationId','revisionSha256','detailAssets'])||v.version!==1||v.publicationId!==publicationId||v.revisionSha256!==revisionSha256||!Array.isArray(v.detailAssets)||v.detailAssets.length!==0)unavailable();},
  async readCandidate(entry){
   let e;try{e=structuredClone(entry);}catch{unavailable();}if(!exact(e,['assetId','sourceBindingSha256','sha256','bytes','mime','featureReportSha256'])||typeof e.assetId!=='string'||!uuid.test(e.assetId)||![e.sourceBindingSha256,e.sha256,e.featureReportSha256].every(x=>typeof x==='string'&&sha.test(x))||!Number.isSafeInteger(e.bytes)||e.bytes<1||e.bytes>25*1024*1024||!['image/png','image/jpeg','model/gltf-binary'].includes(e.mime))unavailable();
   for(;;){const response=await send('/bytes',{...body,assetId:e.assetId,sourceBindingSha256:e.sourceBindingSha256},signal);
    if(response.status!==200){const value=await json(response,signal);if(busy(response,value)){await delay(25,undefined,{signal});continue;}unavailable();}
    const h=response.headers,encoding=h.get('content-encoding');if(!response.body||h.get('content-type')!==e.mime||h.get('content-length')!==String(e.bytes)||h.get('x-exhibitos-sha256')!==e.sha256||h.get('x-exhibitos-publication-revision')!==revisionSha256||h.has('content-range')||encoding!==null&&encoding!=='identity'||h.get('cache-control')!=='no-store'||h.get('x-content-type-options')!=='nosniff'){await response.body?.cancel();unavailable();}
    const bytes=await readBody(response,e.bytes,signal);signal.throwIfAborted();if(bytes.length!==e.bytes||createHash('sha256').update(bytes).digest('hex')!==e.sha256)unavailable();return bytes;
   }
  },
  async finalCheck(){const finalSignal=AbortSignal.any([signal,AbortSignal.timeout(30000)]),v=await retry('/final-check',{...body,detailCount:0,detailSetSha256:emptyDigest},finalSignal);if(!exact(v,['version','publicationId','revisionSha256','valid'])||v.version!==1||v.publicationId!==publicationId||v.revisionSha256!==revisionSha256||v.valid!==true)unavailable();},
  async close(cleanupSignal){const result=await request('/close',body,cleanupSignal),v=result.value;if(result.busy||!exact(v,['version','jobId','state'])||v.version!==1||v.jobId!==jobId||v.state!=='closing')unavailable();},
  async settled(observationSignal=signal){for(;;){const result=await request(`/operations/${jobId}`,undefined,observationSignal),v=result.value;if(result.busy||!exact(v,['version','jobId','publicationId','revisionSha256','runtimeGeneration','state'])||v.version!==1||v.jobId!==jobId||v.publicationId!==publicationId||v.revisionSha256!==revisionSha256||v.runtimeGeneration!==runtimeGeneration)unavailable();if(v.state==='settled-success')return;if(v.state!=='pending')unavailable();await delay(25,undefined,{signal:observationSignal});}},
 };
}
