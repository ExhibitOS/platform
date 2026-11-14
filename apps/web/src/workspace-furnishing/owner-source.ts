// SPDX-License-Identifier: AGPL-3.0-or-later
import type {WorkspaceFurnishingDescriptor} from '@exhibitos/studio-contract';
import type {WorkspaceModelSource} from './model-loader';
import type {OwnerPreviewBudget} from './owner-preview-budget';
import type {WorkspaceFailureObserver} from './failure-readout';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
/** Authenticated owner preview only; neither a draft nor a caller supplies a URL.
 * The caller must repeat check while the object remains visible and revoke it
 * if owner, workspace, source bytes, or display rights are no longer current. */
export function ownerWorkspaceModelSource(scope:OwnerPreviewBudget,expected:WorkspaceFurnishingDescriptor,signal:AbortSignal,observer?:WorkspaceFailureObserver):WorkspaceModelSource{
 const {tenantId,fetcher}=scope;
 if(!uuid.test(tenantId)||!expected||!uuid.test(expected.id)||expected.version!==1)throw Error('WORKSPACE_MODEL_AUTHORITY');
 const pinned=structuredClone(expected),base=`/api/v1/tenants/${tenantId}/workspace/furnishings/${pinned.id}/versions/1`,options={credentials:'same-origin' as const,redirect:'error' as const,cache:'no-store' as const};
 return {
  check(){observer?.stage('display-check');observer?.http('display-check',null);return scope.check(canonical(pinned),signal,async sharedSignal=>{
   const requestSignal=AbortSignal.any([sharedSignal,AbortSignal.timeout(15000)]),response=await fetcher(base+'/display-check',{...options,signal:requestSignal});try{requestSignal.throwIfAborted();}catch(error){await response.body?.cancel().catch(()=>{});throw error;}
   observer?.http('display-check',response.status);
   if(!response.ok||!response.body||response.headers.get('content-type')?.split(';')[0]!=='application/json'){await response.body?.cancel().catch(()=>{});throw Error('WORKSPACE_MODEL_AUTHORITY');}
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;const cancel=()=>{void reader.cancel().catch(()=>{});};requestSignal.addEventListener('abort',cancel,{once:true});
   try{for(;;){const {done,value}=await reader.read();requestSignal.throwIfAborted();if(done)break;length+=value.length;if(length>65536)throw Error('WORKSPACE_MODEL_AUTHORITY');chunks.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{requestSignal.removeEventListener('abort',cancel);reader.releaseLock();}
   const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   observer?.stage('descriptor-match');let actual:unknown;try{actual=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('WORKSPACE_MODEL_AUTHORITY');}
   if(canonical(actual)!==canonical(pinned))throw Error('WORKSPACE_MODEL_AUTHORITY');
  });},
  open(loadSignal){return fetcher(base+'/model',{...options,signal:AbortSignal.any([signal,loadSignal])});}
 };
}
