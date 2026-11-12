// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,test,vi} from 'vitest';
import {NativeGpuCandidatePreview} from './gpu-candidate-preview';
import {AssetReleaseUnconfirmedError} from './loading';
import type {GpuCandidatePreviewBegin,GpuCandidatePreviewCancel} from './gpu-candidate-preview-wire';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const request:GpuCandidatePreviewBegin={version:1,phase:'begin',epoch:id(1),sequence:1,requestId:id(2),workspaceId:id(3),tenantId:id(4),principalId:id(5),artworkId:id(6),artworkRevision:3,jobId:id(7),generation:'owned-job',receiptSHA256:'a'.repeat(64),source:{assetId:id(8),mime:'model/gltf-binary',sha256:'b'.repeat(64),bytes:100,approvalSHA256:'c'.repeat(64),rightsSHA256:'d'.repeat(64)},candidate:{assetId:id(9),mime:'model/gltf-binary',sha256:'e'.repeat(64),bytes:100}};
function cancel(r=request):GpuCandidatePreviewCancel{return {version:1,phase:'cancel',epoch:r.epoch,sequence:r.sequence,requestId:r.requestId,workspaceId:r.workspaceId,tenantId:r.tenantId,principalId:r.principalId};}
function deferred<T=void>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
function fixture(){
 const view={targetFormat:'bc7' as const,drawGeneration:1,valid:vi.fn(()=>true),retire:vi.fn(async()=>{})};
 const authority={read:vi.fn(async()=>new ArrayBuffer(100)),check:vi.fn(async()=>({reviewRevision:3,maxTriangles:20})),expiresAt:Date.now()+100000};
 const deps={unavailable:vi.fn(()=>false),host:vi.fn(()=>({remove:vi.fn()}) as unknown as HTMLElement),post:vi.fn(),authority:vi.fn(async()=>authority),mount:vi.fn(async()=>view)};
 const preview=new NativeGpuCandidatePreview(deps);return {preview,deps,view,authority};
}
afterEach(()=>vi.useRealTimers());
test('capability needs no editor; ready waits actual mount and final fresh authority, cancel emits false then positive retired',async()=>{
 const {preview,deps,view,authority}=fixture(),mount=deferred<typeof view>();deps.mount.mockReturnValueOnce(mount.promise);
 expect(await preview.request({version:1,phase:'capability'})).toMatchObject({capability:'gpu-candidate-preview-v1'});expect(deps.authority).not.toHaveBeenCalled();
 let ready=false;const work=preview.request(request).then(v=>{ready=true;return v;});
 await vi.waitFor(()=>expect(deps.mount).toHaveBeenCalledOnce());expect(ready).toBe(false);mount.resolve(view);
 expect(await work).toMatchObject({rendered:true,drawGeneration:1,targetFormat:'bc7',reviewRevision:3});expect(authority.check).toHaveBeenCalledTimes(2);
 const drain=deferred();view.retire.mockReturnValueOnce(drain.promise);let cancelled=false;
 const stopped=preview.request(cancel()).then(v=>{cancelled=true;return v;});
 await vi.waitFor(()=>expect(view.retire).toHaveBeenCalledOnce());expect(cancelled).toBe(false);expect(deps.post.mock.calls.map(([v])=>v.body.drained)).toEqual([false]);
 drain.resolve();expect(await stopped).toMatchObject({cancelled:true,drained:true});expect(deps.post.mock.calls.map(([v])=>v.body.drained)).toEqual([false,true]);
});
test('superseding begin cannot mount until old real retirement; exact owner and monotonic sequence are enforced',async()=>{
 const {preview,deps,view}=fixture();await preview.request(request);
 await expect(preview.request({...cancel(),workspaceId:id(99)})).rejects.toThrow('OWNER_CHANGED');expect(view.retire).not.toHaveBeenCalled();
 await expect(preview.request(request)).rejects.toThrow('REPLAY');
 const drain=deferred();view.retire.mockReturnValueOnce(drain.promise);
 const next={...request,sequence:2,requestId:id(10)};const work=preview.request(next);
 await vi.waitFor(()=>expect(view.retire).toHaveBeenCalledOnce());expect(deps.mount).toHaveBeenCalledTimes(1);
 drain.resolve();await work;expect(deps.mount).toHaveBeenCalledTimes(2);await preview.request(cancel(next));
});
test('unknown retirement blocks successors and editor admission without a positive ended acknowledgement',async()=>{
 const {preview,deps,view}=fixture();await preview.request(request);view.retire.mockRejectedValueOnce(Error('CLEANUP_UNKNOWN'));
 await expect(preview.request(cancel())).rejects.toBeInstanceOf(AssetReleaseUnconfirmedError);
 expect(deps.post.mock.calls.map(([v])=>v.body.drained)).toEqual([false]);
 await expect(preview.invalidate('editor-frame')).rejects.toBeInstanceOf(AssetReleaseUnconfirmedError);
 await expect(preview.request({...request,sequence:2,requestId:id(10)})).rejects.toBeInstanceOf(AssetReleaseUnconfirmedError);
 expect(deps.mount).toHaveBeenCalledOnce();expect(view.retire).toHaveBeenCalledOnce();
});
test('post-draw authority failure and host invalidation never return a ready witness',async()=>{
 const {preview,authority,view}=fixture();authority.check.mockRejectedValueOnce(Error('AUTH_CHANGED'));
 await expect(preview.request(request)).rejects.toThrow('AUTH_CHANGED');expect(view.retire).not.toHaveBeenCalled();
 const f=fixture();f.authority.check.mockResolvedValueOnce({reviewRevision:3,maxTriangles:20}).mockRejectedValueOnce(Error('AUTH_CHANGED'));
 await expect(f.preview.request(request)).rejects.toThrow('AUTH_CHANGED');expect(f.view.retire).toHaveBeenCalledOnce();
 expect(f.deps.post.mock.calls.map(([v])=>v.body.drained)).toEqual([false,true]);
});
test('session polling failure immediately invalidates witness and retires; editor host cannot start a preview',async()=>{
 vi.useFakeTimers();const {preview,authority,view,deps}=fixture();await preview.request(request);
 authority.check.mockRejectedValueOnce(Error('SOURCE_CHANGED'));await vi.advanceTimersByTimeAsync(1000);
 expect(view.retire).toHaveBeenCalledOnce();expect(deps.post.mock.calls[0]?.[0].body).toMatchObject({reason:'source-changed',drained:false});
 const other=fixture();other.deps.unavailable.mockReturnValue(true);await expect(other.preview.request(request)).rejects.toThrow('HOST_UNAVAILABLE');expect(other.deps.mount).not.toHaveBeenCalled();
});
