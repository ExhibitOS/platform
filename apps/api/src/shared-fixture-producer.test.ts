// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import type {ChildProcess} from 'node:child_process';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ApiError} from './api-error.ts';
import {validateWorkspaceFurnishingGlb} from './workspace-furnishing-glb.ts';
import {prepareLightFixtureInWorker} from './light-fixture-preparation-process.ts';
import {produceSharedFixtureCandidate,type SharedFixtureProducerInput} from './shared-fixture-producer.ts';
vi.mock('./workspace-furnishing-glb.ts',()=>({validateWorkspaceFurnishingGlb:vi.fn()}));
vi.mock('./light-fixture-preparation-process.ts',()=>({prepareLightFixtureInWorker:vi.fn()}));
// Narrow the ordinary (non-fit) overload used by this producer's mocks.
type OrdinaryValidation=(model:Parameters<typeof validateWorkspaceFurnishingGlb>[0],bytes:Buffer,hooks?:Parameters<typeof validateWorkspaceFurnishingGlb>[2])=>Promise<void>;
const validationMock=vi.mocked(validateWorkspaceFurnishingGlb as OrdinaryValidation);
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const identity=(b:Buffer)=>({bytes:b.length,sha256:hash(b)});
function fixture():SharedFixtureProducerInput{
 const source=Buffer.alloc(32,7),notice=Buffer.from('Synthetic test fixture: CC0-1.0.');
 return {source,notice,authority:{source:identity(source),notice:identity(notice),licenseId:'CC0-1.0'},producer:{sourceCommit:'a'.repeat(40),implementationSHA256:'b'.repeat(64)}};
}
beforeEach(()=>{vi.resetAllMocks();validationMock.mockResolvedValue(undefined);});
afterEach(()=>vi.restoreAllMocks());
it('binds source/notice identity independent of object key order and preserves compatible originals without preparation',async()=>{
 const f=fixture();f.authority.source={sha256:hash(f.source),bytes:f.source.length};f.authority.notice={sha256:hash(f.notice),bytes:f.notice.length};
 const before=Buffer.from(f.source),notice=Buffer.from(f.notice),result=await produceSharedFixtureCandidate(f);
 expect(prepareLightFixtureInWorker).not.toHaveBeenCalled();expect(validateWorkspaceFurnishingGlb).toHaveBeenCalledOnce();
 expect(result.bytes).toEqual(before);expect(result.source).toEqual(before);expect(result.notice).toEqual(notice);expect(result.sourceNotice).toEqual(notice);
 expect(result.receipt).toMatchObject({source:{...identity(before),mime:'model/gltf-binary'},renderable:{...identity(before),mime:'model/gltf-binary'},recipe:{version:1,id:'source-original-v1'},preparation:null,workerDrained:true,producer:f.producer});
 const {sha256,...record}=result.receipt;expect(sha256).toBe(hash(Buffer.from(JSON.stringify(record))));
 f.source.fill(0);f.notice.fill(0);expect(result.source).toEqual(before);expect(result.notice).toEqual(notice);
});
it.each(['source','notice'] as const)('rejects changed %s bytes before any validator or preparation worker',async field=>{
 const f=fixture();f[field][0]=(f[field][0]??0)^1;await expect(produceSharedFixtureCandidate(f)).rejects.toMatchObject({status:422,code:'FIXTURE_SOURCE_INTEGRITY'});expect(validateWorkspaceFurnishingGlb).not.toHaveBeenCalled();expect(prepareLightFixtureInWorker).not.toHaveBeenCalled();
});
it('only ordinary FORMAT_REJECTED enables preparation and binds the derived receipt and provenance notice',async()=>{
 const f=fixture(),bytes=Buffer.alloc(36,9),receipt={version:1 as const,policy:'omit-unused-invalid-tangent-r1' as const,source:{sha256:hash(f.source),bytes:f.source.length},derived:{sha256:hash(bytes),bytes:bytes.length},removed:[{mesh:0,primitive:0,accessor:2}],binSHA256:'c'.repeat(64)};
 validationMock.mockRejectedValueOnce(new ApiError(422,'FORMAT_REJECTED'));vi.mocked(prepareLightFixtureInWorker).mockResolvedValue({bytes,receipt,workerDrained:true});
 const current=vi.fn(async()=>{}),r=await produceSharedFixtureCandidate(f,{assertCurrent:current});
 expect(prepareLightFixtureInWorker).toHaveBeenCalledOnce();expect(current).toHaveBeenCalledTimes(3);expect(r.bytes).toEqual(bytes);expect(r.source).toEqual(f.source);expect(r.sourceNotice).toEqual(f.notice);
 expect(r.receipt).toMatchObject({source:{...identity(f.source),mime:'model/gltf-binary'},renderable:{...identity(bytes),mime:'model/gltf-binary'},preparation:receipt,recipe:{id:'unused-invalid-tangent-v1',bin:'unchanged',normalMap:'reject'},workerDrained:true});expect(r.notice.toString()).toContain(hash(f.source));expect(r.notice.toString()).toContain(hash(bytes));expect(r.notice.toString()).toContain('1 invalid unused TANGENT');
});
it.each([new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE'),new ApiError(422,'UPLOAD_INTEGRITY'),new Error('validator unavailable'),{status:422,code:'FORMAT_REJECTED'}])('never interprets unknown, timeout or non-format failure as preparation eligibility: %s',async error=>{
 validationMock.mockRejectedValueOnce(error);await expect(produceSharedFixtureCandidate(fixture())).rejects.toBe(error);expect(prepareLightFixtureInWorker).not.toHaveBeenCalled();
});
it('propagates preparation/full output validation failure without returning a candidate',async()=>{
 validationMock.mockRejectedValueOnce(new ApiError(422,'FORMAT_REJECTED'));const error=new ApiError(422,'LIGHT_FIXTURE_PREPARATION_UNSAFE');vi.mocked(prepareLightFixtureInWorker).mockRejectedValueOnce(error);await expect(produceSharedFixtureCandidate(fixture())).rejects.toBe(error);
});
it('cancels its validator child but remains pending until the validation owner observes close',async()=>{
 const controller=new AbortController(),child=Object.assign(new EventEmitter(),{kill:vi.fn(()=>true)}) as unknown as ChildProcess;
 validationMock.mockImplementationOnce(async(_model,_bytes,hooks)=>{hooks?.onSpawn?.(child);await new Promise<void>(resolve=>child.once('close',()=>resolve()));});
 let settled=false;const promise=produceSharedFixtureCandidate(fixture(),{signal:controller.signal});void promise.then(()=>{settled=true;},()=>{settled=true;});await vi.waitFor(()=>expect(child.listenerCount('close')).toBeGreaterThan(0));controller.abort();await Promise.resolve();expect(child.kill).toHaveBeenCalledWith('SIGKILL');expect(settled).toBe(false);child.emit('close',null,'SIGKILL');await expect(promise).rejects.toBe(controller.signal.reason);expect(prepareLightFixtureInWorker).not.toHaveBeenCalled();
});
it('rechecks current ownership after validation and does not publish a stale candidate',async()=>{
 const error=Error('owner changed'),current=vi.fn(async()=>{}).mockResolvedValueOnce(undefined).mockRejectedValueOnce(error);await expect(produceSharedFixtureCandidate(fixture(),{assertCurrent:current})).rejects.toBe(error);expect(prepareLightFixtureInWorker).not.toHaveBeenCalled();
});
