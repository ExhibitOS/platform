import type { Session } from './cms-client';
import { RequestError } from './cms-client';
import type { Draft } from './drafts/store';
export const MAX_OEX_BYTES = 64 * 1024 * 1024;
export interface OexResult { revision:number; etag:string; draft:Draft }
export interface OexJob { id:string; state:string; errorCode:string|null; result?:OexResult|null }
export const oexPath = (session:Session) => `/api/v1/tenants/${session.tenantId}/oex/imports`;
export async function oexRequest<T>(path:string,session:Session,method='GET',body?:unknown,etag?:string):Promise<T> {
  const binary=body instanceof ArrayBuffer;
  const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(120000),headers:{...(method!=='GET'?{'x-csrf-token':session.csrfToken}:{}),...(body!==undefined?{'content-type':binary?'application/octet-stream':'application/json'}:{}),...(etag?{'if-match':etag}:{})},body:body===undefined?undefined:binary?body:JSON.stringify(body)});
  if(!response.ok){const value=await response.json().catch(()=>({code:'REQUEST_FAILED'}));throw new RequestError(response.status,typeof value.code==='string'?value.code:'REQUEST_FAILED');}
  return await response.json() as T;
}
export async function exportOex(session:Session,id:string,etag:string):Promise<Blob> {
  const response=await fetch(`/api/v1/tenants/${session.tenantId}/studio/exhibitions/${id}/oex/export`,{method:'POST',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(120000),headers:{'x-csrf-token':session.csrfToken,'if-match':etag,'content-type':'application/json'},body:'{}'});
  if(!response.ok){const value=await response.json().catch(()=>({code:'REQUEST_FAILED'}));throw new RequestError(response.status,value.code??'REQUEST_FAILED');}
  const declared=Number(response.headers.get('content-length'));
  if(declared>MAX_OEX_BYTES)throw new RequestError(413,'OEX_LIMIT');
  const blob=await response.blob();
  if(blob.size>MAX_OEX_BYTES)throw new RequestError(413,'OEX_LIMIT');
  return blob;
}
