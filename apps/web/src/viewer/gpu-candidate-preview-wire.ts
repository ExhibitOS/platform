// SPDX-License-Identifier: AGPL-3.0-or-later
export const GPU_CANDIDATE_PREVIEW_CAPABILITY='gpu-candidate-preview-v1' as const;
export const GPU_CANDIDATE_PREVIEW_PROFILE='embedded-model-basecolor-uastc-512-mips-v1' as const;
export interface GpuCandidatePreviewOwner {
  version:1;epoch:string;sequence:number;requestId:string;workspaceId:string;tenantId:string;principalId:string;
}
export interface GpuCandidatePreviewAsset {assetId:string;mime:'model/gltf-binary';sha256:string;bytes:number}
export interface GpuCandidatePreviewSource extends GpuCandidatePreviewAsset {approvalSHA256:string;rightsSHA256:string}
export interface GpuCandidatePreviewBegin extends GpuCandidatePreviewOwner {
  phase:'begin';artworkId:string;artworkRevision:number;jobId:string;generation:string;receiptSHA256:string;
  source:GpuCandidatePreviewSource;candidate:GpuCandidatePreviewAsset;
}
export interface GpuCandidatePreviewCancel extends GpuCandidatePreviewOwner {phase:'cancel'}
export interface GpuCandidatePreviewCapability {version:1;phase:'capability'}
export type GpuCandidatePreviewRequest=GpuCandidatePreviewCapability|GpuCandidatePreviewBegin|GpuCandidatePreviewCancel;
export type GpuCandidatePreviewTargetFormat='astc-4x4'|'bc7';
export interface GpuCandidatePreviewDraw {reviewRevision:number;drawGeneration:number;targetFormat:GpuCandidatePreviewTargetFormat}
export type GpuCandidatePreviewCapabilityReply={version:1;capability:typeof GPU_CANDIDATE_PREVIEW_CAPABILITY;profile:typeof GPU_CANDIDATE_PREVIEW_PROFILE};
export type GpuCandidatePreviewBeginReply=Omit<GpuCandidatePreviewBegin,'phase'>&GpuCandidatePreviewDraw&{capability:typeof GPU_CANDIDATE_PREVIEW_CAPABILITY;rendered:true};
export type GpuCandidatePreviewCancelReply=Omit<GpuCandidatePreviewCancel,'phase'>&{cancelled:true;drained:true};
export type GpuCandidatePreviewEndReason='cancelled'|'superseded'|'hidden'|'context-lost'|'authority-changed'|'source-changed'|'render-failed'|'editor-frame'|'disposed';
export interface GpuCandidatePreviewEnded {
  version:1;epoch:string;sequence:number;type:'gpu-candidate-preview-ended';
  body:{requestId:string;workspaceId:string;tenantId:string;principalId:string;artworkId:string;artworkRevision:number;jobId:string;generation:string;receiptSHA256:string;candidateSHA256:string;reason:GpuCandidatePreviewEndReason;drained:boolean};
}
const fail=():never=>{throw Error('GPU_CANDIDATE_PREVIEW_WIRE_INVALID');};
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const sha=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const integer=(v:unknown,min:number,max=Number.MAX_SAFE_INTEGER)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
function closed(v:unknown,keys:string):asserts v is Record<string,unknown>{
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==keys.split(',').sort().join(','))fail();
}
const ownerKeys='version,epoch,sequence,requestId,workspaceId,tenantId,principalId';
function asset(v:unknown,source:boolean){
  closed(v,'assetId,mime,sha256,bytes'+(source?',approvalSHA256,rightsSHA256':''));
  if(!uuid(v.assetId)||v.mime!=='model/gltf-binary'||!sha(v.sha256)||!integer(v.bytes,1,33554432)||source&&(!sha(v.approvalSHA256)||!sha(v.rightsSHA256)))fail();
}
/** Closed data only: no URL, authority grant, control, or budget can cross this wire. */
export function checkedGpuCandidatePreviewRequest(value:unknown):GpuCandidatePreviewRequest{
  if(!value||typeof value!=='object'||Array.isArray(value))fail();
  const v=value as Record<string,unknown>;
  if(v.phase==='capability'){
    closed(v,'version,phase');if(v.version!==1)fail();
  }else{
    if(v.phase!=='begin'&&v.phase!=='cancel')fail();
    closed(v,ownerKeys+',phase'+(v.phase==='begin'?',artworkId,artworkRevision,jobId,generation,receiptSHA256,source,candidate':''));
    if(v.version!==1||!integer(v.sequence,1)||!['epoch','requestId','workspaceId','tenantId','principalId'].every(k=>uuid(v[k])))fail();
    if(v.phase==='begin'){
      if(!uuid(v.artworkId)||!uuid(v.jobId)||!integer(v.artworkRevision,0)||!sha(v.receiptSHA256)||typeof v.generation!=='string'||! /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v.generation))fail();
      asset(v.source,true);asset(v.candidate,false);
      if((v.source as GpuCandidatePreviewSource).assetId.toLowerCase()===(v.candidate as GpuCandidatePreviewAsset).assetId.toLowerCase())fail();
    }
  }
  return structuredClone(value) as GpuCandidatePreviewRequest;
}
/** Cancellation belongs to precisely one accepted request, including its sequence. */
export function gpuCandidatePreviewOwnerMatches(begin:GpuCandidatePreviewBegin,cancel:GpuCandidatePreviewCancel):boolean{
  return begin.version===cancel.version&&begin.epoch===cancel.epoch&&begin.sequence===cancel.sequence&&begin.requestId===cancel.requestId&&begin.workspaceId===cancel.workspaceId&&begin.tenantId===cancel.tenantId&&begin.principalId===cancel.principalId;
}
export function gpuCandidatePreviewCapabilityReply():GpuCandidatePreviewCapabilityReply{
  return {version:1,capability:GPU_CANDIDATE_PREVIEW_CAPABILITY,profile:GPU_CANDIDATE_PREVIEW_PROFILE};
}
export function gpuCandidatePreviewBeginReply(request:GpuCandidatePreviewBegin,draw:GpuCandidatePreviewDraw):GpuCandidatePreviewBeginReply{
  const checked=checkedGpuCandidatePreviewRequest(request);if(checked.phase!=='begin')return fail();
  closed(draw,'reviewRevision,drawGeneration,targetFormat');
  if(!integer(draw.reviewRevision,0)||!integer(draw.drawGeneration,1)||!['astc-4x4','bc7'].includes(draw.targetFormat))fail();
  const {phase:_phase,...binding}=checked;void _phase;
  return {...binding,capability:GPU_CANDIDATE_PREVIEW_CAPABILITY,reviewRevision:draw.reviewRevision,rendered:true,drawGeneration:draw.drawGeneration,targetFormat:draw.targetFormat};
}
export function gpuCandidatePreviewCancelReply(request:GpuCandidatePreviewCancel):GpuCandidatePreviewCancelReply{
  const checked=checkedGpuCandidatePreviewRequest(request);if(checked.phase!=='cancel')return fail();
  const {phase:_phase,...binding}=checked;void _phase;
  return {...binding,cancelled:true,drained:true};
}
export function gpuCandidatePreviewEnded(request:GpuCandidatePreviewBegin,reason:GpuCandidatePreviewEndReason,drained:boolean):GpuCandidatePreviewEnded{
  const r=checkedGpuCandidatePreviewRequest(request);if(r.phase!=='begin')return fail();
  if(!['cancelled','superseded','hidden','context-lost','authority-changed','source-changed','render-failed','editor-frame','disposed'].includes(reason)||typeof drained!=='boolean')fail();
  return {version:1,epoch:r.epoch,sequence:r.sequence,type:'gpu-candidate-preview-ended',body:{requestId:r.requestId,workspaceId:r.workspaceId,tenantId:r.tenantId,principalId:r.principalId,artworkId:r.artworkId,artworkRevision:r.artworkRevision,jobId:r.jobId,generation:r.generation,receiptSHA256:r.receiptSHA256,candidateSHA256:r.candidate.sha256,reason,drained}};
}
