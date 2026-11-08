// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {parseStaticJson} from '../apps/web/src/static-json.mjs';

const emptyDigest=createHash('sha256').update('[]').digest('hex');
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const unavailable=()=>{throw Error('NATIVE_DETAIL_CONTROL');};

/** Owner-only control. Until a qualified source adapter exists, nonempty detail
 * is refused, never silently omitted. The caller owns the overall deadline. */
export function nativeDetailControl(startup,signal,fetcher=fetch){
 const {origin,tenantId,publicationId,jobId,revisionSha256,runtimeGeneration}=startup;
 const base=`${origin}/api/v1/tenants/${tenantId}/studio/publications/${publicationId}/native-detail-export`;
 const headers={origin,cookie:`exhibitos_local_session=${startup.sessionToken}`,'x-csrf-token':startup.csrfToken,'content-type':'application/json'};
 const body={version:1,jobId,revisionSha256};
 async function request(suffix,payload){
  signal.throwIfAborted();const response=await fetcher(base+suffix,{method:payload?'POST':'GET',headers,...(payload?{body:JSON.stringify(payload)}:{}),signal,redirect:'error',cache:'no-store'});
  if(!response.body)unavailable();const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>1048576)unavailable();chunks.push(part.value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  let value;try{value=parseStaticJson(Buffer.concat(chunks),1048576);}catch{unavailable();}
  signal.throwIfAborted();if(!response.ok){if(response.status===409&&exact(value,['code','message','fieldErrors','requestId'])&&value.code==='NATIVE_DETAIL_BUSY'&&value.message===value.code&&Array.isArray(value.fieldErrors)&&value.fieldErrors.length===0&&typeof value.requestId==='string')return {busy:true};unavailable();}return {value};
 }
 async function retry(suffix,payload){for(;;){const result=await request(suffix,payload);if(!result.busy)return result.value;await delay(25,undefined,{signal});}}
 return {
  async prepare(){const v=await retry('/prepare',body);if(!exact(v,['version','publicationId','revisionSha256','detailAssets'])||v.version!==1||v.publicationId!==publicationId||v.revisionSha256!==revisionSha256||!Array.isArray(v.detailAssets)||v.detailAssets.length!==0)unavailable();},
  async finalCheck(){const v=await retry('/final-check',{...body,detailCount:0,detailSetSha256:emptyDigest});if(!exact(v,['version','publicationId','revisionSha256','valid'])||v.version!==1||v.publicationId!==publicationId||v.revisionSha256!==revisionSha256||v.valid!==true)unavailable();},
  async close(){const result=await request('/close',body),v=result.value;if(result.busy||!exact(v,['version','jobId','state'])||v.version!==1||v.jobId!==jobId||v.state!=='closing')unavailable();},
  async settled(){for(;;){const result=await request(`/operations/${jobId}`),v=result.value;if(result.busy||!exact(v,['version','jobId','publicationId','revisionSha256','runtimeGeneration','state'])||v.version!==1||v.jobId!==jobId||v.publicationId!==publicationId||v.revisionSha256!==revisionSha256||v.runtimeGeneration!==runtimeGeneration)unavailable();if(v.state==='settled-success')return;if(v.state!=='pending')unavailable();await delay(25,undefined,{signal});}},
 };
}
