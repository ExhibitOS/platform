// SPDX-License-Identifier: AGPL-3.0-or-later
import {AssetReleaseUnconfirmedError} from './loading';
import {createGpuCandidatePreviewAuthority} from './gpu-candidate-preview-authority';
import {mountGpuCandidatePreview} from './gpu-candidate-preview-renderer';
import {checkedGpuCandidatePreviewRequest,gpuCandidatePreviewOwnerMatches,gpuCandidatePreviewCapabilityReply,gpuCandidatePreviewBeginReply,gpuCandidatePreviewCancelReply,gpuCandidatePreviewEnded,type GpuCandidatePreviewBegin,type GpuCandidatePreviewEndReason,type GpuCandidatePreviewEnded,type GpuCandidatePreviewBeginReply} from './gpu-candidate-preview-wire';

type Mounted=Awaited<ReturnType<typeof mountGpuCandidatePreview>>;
type Entry={request:GpuCandidatePreviewBegin;abort:AbortController;work:Promise<GpuCandidatePreviewBeginReply>;mounted?:Mounted;host?:HTMLElement;reason?:GpuCandidatePreviewEndReason;retirement?:Promise<void>;expiry?:ReturnType<typeof setTimeout>;poll?:ReturnType<typeof setTimeout>};
type Dependencies={
 unavailable():boolean;host():HTMLElement;post(event:GpuCandidatePreviewEnded):void;
 authority?:typeof createGpuCandidatePreviewAuthority;mount?:typeof mountGpuCandidatePreview;
};
/** One operation-owned private canvas, independent of saved scenes/placements.
 * A failed retirement remains a barrier to every later preview/editor frame. */
export class NativeGpuCandidatePreview {
 private current?:Entry;
 private barrier:Promise<void>=Promise.resolve();
 private binding?:Pick<GpuCandidatePreviewBegin,'epoch'|'workspaceId'|'tenantId'|'principalId'>;
 private sequence=0;
 constructor(private readonly deps:Dependencies){}
 private emit(entry:Entry,drained:boolean){try{this.deps.post(gpuCandidatePreviewEnded(entry.request,entry.reason!,drained));}catch{/* A broken host channel must not interrupt real retirement. */}}
 private end(entry:Entry,reason:GpuCandidatePreviewEndReason):Promise<void>{
  if(entry.retirement)return entry.retirement;
  entry.reason=reason;entry.abort.abort(Error('GPU_CANDIDATE_PREVIEW_ENDED'));
  clearTimeout(entry.expiry);clearTimeout(entry.poll);this.emit(entry,false);
  entry.retirement=(async()=>{
   let failure:unknown,failed=false;
   // Mount failure must already have retired its partial owner. An unknown
   // acknowledgement cannot be cleared by disposing an empty later handle.
   try{await entry.work;}catch(error){if(error instanceof AssetReleaseUnconfirmedError){failed=true;failure=error;}}
   try{await entry.mounted?.retire();}catch(error){failed=true;failure??=error;}
   try{entry.host?.remove();}catch(error){failed=true;failure??=error;}
   if(failed)throw new AssetReleaseUnconfirmedError({cause:failure});
   this.emit(entry,true);
  })();
  this.barrier=Promise.all([this.barrier,entry.retirement]).then(()=>{});
  void this.barrier.catch(()=>{});void entry.retirement.catch(()=>{});
  return entry.retirement;
 }
 /** Used before editor admission and on auth/visibility/host teardown. */
 async invalidate(reason:GpuCandidatePreviewEndReason){
  if(this.current)await this.end(this.current,reason);
  await this.barrier;
 }
 async request(value:unknown){
  const request=checkedGpuCandidatePreviewRequest(value);
  if(request.phase==='capability')return gpuCandidatePreviewCapabilityReply();
  if(request.phase==='cancel'){
   const entry=this.current;
   if(!entry||!gpuCandidatePreviewOwnerMatches(entry.request,request))throw Error('GPU_CANDIDATE_PREVIEW_OWNER_CHANGED');
   await this.end(entry,'cancelled');return gpuCandidatePreviewCancelReply(request);
  }
  if(this.deps.unavailable())throw Error('GPU_CANDIDATE_PREVIEW_HOST_UNAVAILABLE');
  if(this.binding&&(['epoch','workspaceId','tenantId','principalId'] as const).some(key=>request[key]!==this.binding![key]))throw Error('GPU_CANDIDATE_PREVIEW_OWNER_CHANGED');
  if(request.sequence<=this.sequence)throw Error('GPU_CANDIDATE_PREVIEW_REPLAY');
  this.binding??={epoch:request.epoch,workspaceId:request.workspaceId,tenantId:request.tenantId,principalId:request.principalId};
  this.sequence=request.sequence;
  if(this.current)void this.end(this.current,'superseded').catch(()=>{});
  const before=this.barrier;
  const entry={request,abort:new AbortController()} as Entry;
  this.current=entry;
  const assertCurrent=()=>{entry.abort.signal.throwIfAborted();if(this.current!==entry||entry.reason||this.deps.unavailable())throw Error('GPU_CANDIDATE_PREVIEW_HOST_UNAVAILABLE');};
  entry.work=(async()=>{
   await before;assertCurrent();
   const authority=await (this.deps.authority??createGpuCandidatePreviewAuthority)(request,entry.abort.signal);assertCurrent();
   const expire=()=>{void this.end(entry,'authority-changed').catch(()=>{});};
   const remaining=authority.expiresAt-Date.now();if(remaining<=0)throw Error('GPU_CANDIDATE_PREVIEW_AUTHORITY_CHANGED');
   entry.expiry=setTimeout(expire,Math.min(remaining,2147483647));
   const bytes=await authority.read();assertCurrent();
   const checked=await authority.check();assertCurrent();
   const host=this.deps.host();entry.host=host;
   entry.mounted=await (this.deps.mount??mountGpuCandidatePreview)({host,bytes,signal:entry.abort.signal,maxTriangles:checked.maxTriangles,onInvalidated:reason=>{void this.end(entry,reason).catch(()=>{});}});
   assertCurrent();
   const final=await authority.check();assertCurrent();
   if(final.maxTriangles!==checked.maxTriangles||!entry.mounted.valid())throw Error('GPU_CANDIDATE_PREVIEW_DRAW_UNAVAILABLE');
   const poll=async()=>{
    try{assertCurrent();await authority.check();assertCurrent();if(!entry.mounted!.valid())throw Error('GPU_CANDIDATE_PREVIEW_DRAW_UNAVAILABLE');entry.poll=setTimeout(()=>{void poll();},1000);}
    catch{if(!entry.reason)void this.end(entry,'source-changed').catch(()=>{});}
   };
   entry.poll=setTimeout(()=>{void poll();},1000);
   return gpuCandidatePreviewBeginReply(request,{reviewRevision:final.reviewRevision,drawGeneration:entry.mounted.drawGeneration,targetFormat:entry.mounted.targetFormat});
  })();
  try{return await entry.work;}
  catch(error){await this.end(entry,entry.reason??'render-failed');throw error;}
 }
}
