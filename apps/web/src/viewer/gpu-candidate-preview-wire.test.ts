// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {checkedGpuCandidatePreviewRequest,gpuCandidatePreviewOwnerMatches,gpuCandidatePreviewCapabilityReply,gpuCandidatePreviewBeginReply,gpuCandidatePreviewCancelReply,gpuCandidatePreviewEnded,type GpuCandidatePreviewBegin,type GpuCandidatePreviewCancel} from './gpu-candidate-preview-wire';
const id=(n:number)=>`00000000-0000-4000-8000-${n.toString().padStart(12,'0')}`;
const begin=():GpuCandidatePreviewBegin=>({version:1,phase:'begin',epoch:id(1),sequence:1,requestId:id(2),workspaceId:id(3),tenantId:id(4),principalId:id(5),artworkId:id(6),artworkRevision:0,jobId:id(7),generation:'native.job-1_0',receiptSHA256:'a'.repeat(64),source:{assetId:id(8),mime:'model/gltf-binary',sha256:'b'.repeat(64),bytes:33554432,approvalSHA256:'c'.repeat(64),rightsSHA256:'d'.repeat(64)},candidate:{assetId:id(9),mime:'model/gltf-binary',sha256:'e'.repeat(64),bytes:1}});
const cancel=(r=begin()):GpuCandidatePreviewCancel=>({version:1,phase:'cancel',epoch:r.epoch,sequence:r.sequence,requestId:r.requestId,workspaceId:r.workspaceId,tenantId:r.tenantId,principalId:r.principalId});
it('accepts closed capability, begin and cancellation requests and detaches nested caller data',()=>{
  expect(checkedGpuCandidatePreviewRequest({version:1,phase:'capability'})).toEqual({version:1,phase:'capability'});
  const input=begin(),copy=checkedGpuCandidatePreviewRequest(input);expect(copy).toEqual(input);
  input.source.bytes=2;expect(copy.phase==='begin'&&copy.source.bytes).toBe(33554432);
  expect(checkedGpuCandidatePreviewRequest(cancel())).toEqual(cancel());
});
it('rejects extra authority, URL and control fields at every closed object boundary',()=>{
  for(const field of ['url','grant','budget','controls','baseETag']){
    const r=begin();expect(()=>checkedGpuCandidatePreviewRequest({...r,[field]:true})).toThrow('GPU_CANDIDATE_PREVIEW_WIRE_INVALID');
    for(const key of ['source','candidate'] as const){const x=begin();Object.assign(x[key],{[field]:true});expect(()=>checkedGpuCandidatePreviewRequest(x)).toThrow();}
    expect(()=>checkedGpuCandidatePreviewRequest({...cancel(),[field]:true})).toThrow();
  }
  for(const value of [null,[],{}, {version:1,phase:'capability',epoch:id(1)},{version:2,phase:'capability'}])expect(()=>checkedGpuCandidatePreviewRequest(value)).toThrow();
});
it('rejects malformed identity, unsafe counts, hashes, generations, MIME and colliding assets',()=>{
  const mutations:((r:GpuCandidatePreviewBegin)=>void)[]=[
    r=>{r.epoch='bad';},r=>{r.jobId='bad';},r=>{r.sequence=0;},r=>{r.sequence=Number.MAX_SAFE_INTEGER+1;},r=>{r.artworkRevision=-1;},r=>{r.artworkRevision=.5;},
    r=>{r.receiptSHA256='A'.repeat(64);},r=>{r.source.rightsSHA256='bad';},r=>{r.source.approvalSHA256='';},r=>{r.candidate.sha256='x'.repeat(64);},
    r=>{r.generation='';},r=>{r.generation='_bad';},r=>{r.generation='x'.repeat(129);},r=>{r.generation='a/b';},
    r=>{r.source.bytes=0;},r=>{r.candidate.bytes=33554433;},r=>{r.candidate.bytes=NaN;},r=>{r.candidate.bytes=1.5;},
    r=>{Object.assign(r.source,{mime:'image/png'});},r=>{r.candidate.assetId=r.source.assetId;},r=>{r.source.assetId='aaaaaaaa-0000-4000-8000-000000000001';r.candidate.assetId=r.source.assetId.toUpperCase();},
  ];
  for(const mutate of mutations){const r=begin();mutate(r);expect(()=>checkedGpuCandidatePreviewRequest(r)).toThrow('GPU_CANDIDATE_PREVIEW_WIRE_INVALID');}
});
it('rejects prototypes, hidden keys, symbols and accessors without executing getters',()=>{
  const getter=vi.fn(()=> 'begin');
  const prototyped=Object.assign(Object.create({grant:true}),begin());
  const hidden=Object.defineProperty(begin(),'grant',{value:true,enumerable:false});
  const symbolic=Object.assign(begin(),{[Symbol('grant')]:true});
  const accessor=Object.defineProperty(begin(),'phase',{get:getter,enumerable:true});
  const nested=begin();Object.defineProperty(nested.source,'assetId',{get:getter,enumerable:true});
  for(const value of [prototyped,hidden,symbolic,accessor,nested])expect(()=>checkedGpuCandidatePreviewRequest(value)).toThrow('GPU_CANDIDATE_PREVIEW_WIRE_INVALID');
  expect(getter).not.toHaveBeenCalled();
});
it('requires exact owner equality including sequence rather than admitting a newer frame',()=>{
  const r=begin(),c=cancel(r);expect(gpuCandidatePreviewOwnerMatches(r,c)).toBe(true);
  for(const key of ['epoch','requestId','workspaceId','tenantId','principalId'] as const)expect(gpuCandidatePreviewOwnerMatches(r,{...c,[key]:id(99)})).toBe(false);
  expect(gpuCandidatePreviewOwnerMatches(r,{...c,sequence:2})).toBe(false);
});
it('serializes exact detached replies without a request phase or caller extras',()=>{
  expect(gpuCandidatePreviewCapabilityReply()).toEqual({version:1,capability:'gpu-candidate-preview-v1',profile:'embedded-model-basecolor-uastc-512-mips-v1'});
  const r=begin(),{phase:_phase,...binding}=structuredClone(r);void _phase;
  const reply=gpuCandidatePreviewBeginReply(r,{reviewRevision:0,drawGeneration:1,targetFormat:'bc7'});
  expect(JSON.parse(JSON.stringify(reply))).toEqual({...binding,capability:'gpu-candidate-preview-v1',reviewRevision:0,rendered:true,drawGeneration:1,targetFormat:'bc7'});
  r.candidate.sha256='f'.repeat(64);expect(reply.candidate.sha256).toBe('e'.repeat(64));
  const c=cancel(),{phase:_cancelPhase,...owner}=c;void _cancelPhase;
  expect(gpuCandidatePreviewCancelReply(c)).toEqual({...owner,cancelled:true,drained:true});
});
it('rejects invalid draw proof and serializes bounded ended reasons without embedding assets',()=>{
  for(const draw of [{reviewRevision:-1,drawGeneration:1,targetFormat:'bc7'},{reviewRevision:0,drawGeneration:0,targetFormat:'bc7'},{reviewRevision:0,drawGeneration:1,targetFormat:'rgba'},{reviewRevision:0,drawGeneration:1,targetFormat:'bc7',rendered:true}])expect(()=>gpuCandidatePreviewBeginReply(begin(),draw as Parameters<typeof gpuCandidatePreviewBeginReply>[1])).toThrow();
  const r=begin();expect(gpuCandidatePreviewEnded(r,'context-lost',false)).toEqual({version:1,epoch:r.epoch,sequence:r.sequence,type:'gpu-candidate-preview-ended',body:{requestId:r.requestId,workspaceId:r.workspaceId,tenantId:r.tenantId,principalId:r.principalId,artworkId:r.artworkId,artworkRevision:0,jobId:r.jobId,generation:r.generation,receiptSHA256:r.receiptSHA256,candidateSHA256:r.candidate.sha256,reason:'context-lost',drained:false}});
  expect(()=>gpuCandidatePreviewEnded(r,'unknown' as 'hidden',true)).toThrow();
});
