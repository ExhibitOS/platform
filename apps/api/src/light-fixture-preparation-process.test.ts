// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {spawn,type ChildProcess} from 'node:child_process';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {validateBytes} from 'gltf-validator';
import {ApiError} from './api-error.ts';
import {prepareLightFixtureSource} from './light-fixture-preparation.ts';
import {produceSharedFixtureCandidate} from './shared-fixture-producer.ts';
import {prepareLightFixtureInWorker} from './light-fixture-preparation-process.ts';
import {validateWorkspaceFurnishingGlb} from './workspace-furnishing-glb.ts';
vi.mock('node:child_process',async original=>{const actual=await original<typeof import('node:child_process')>();return {...actual,spawn:vi.fn(actual.spawn)};});
vi.mock('./workspace-furnishing-glb.ts',()=>({validateWorkspaceFurnishingGlb:vi.fn()}));
const actualProcesses=await vi.importActual<typeof import('node:child_process')>('node:child_process');
const actualValidation=await vi.importActual<typeof import('./workspace-furnishing-glb.ts')>('./workspace-furnishing-glb.ts');
// Narrow the ordinary (non-fit) overload used by this producer's mocks.
type OrdinaryValidation=(model:Parameters<typeof validateWorkspaceFurnishingGlb>[0],bytes:Buffer,hooks?:Parameters<typeof validateWorkspaceFurnishingGlb>[2])=>Promise<void>;
const validationMock=vi.mocked(validateWorkspaceFurnishingGlb as OrdinaryValidation);
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function pack(doc:unknown,bin:Buffer){
 const raw=Buffer.from(JSON.stringify(doc)),json=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(json);const b=Buffer.alloc(28+json.length+bin.length);b.write('glTF');b.writeUInt32LE(2,4);b.writeUInt32LE(b.length,8);b.writeUInt32LE(json.length,12);b.writeUInt32LE(0x4e4f534a,16);json.copy(b,20);b.writeUInt32LE(bin.length,20+json.length);b.writeUInt32LE(0x004e4942,24+json.length);bin.copy(b,28+json.length);return b;
}
function fixture(){
 const bin=Buffer.alloc(96);for(const [i,v] of [1,0,0,0,1,0,0,0,1].entries())bin.writeFloatLE(v,i*4);for(let i=0;i<3;i++){bin.writeUInt16LE(i,36+i*2);bin.writeFloatLE(1,48+i*16+12);}
 const doc={asset:{version:'2.0',generator:'Independent synthetic process fixture'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TANGENT:2},indices:3,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorFactor:[.5,.6,.7,1]}}],buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36,byteStride:12,target:34962},{buffer:0,byteOffset:48,byteLength:48,target:34962},{buffer:0,byteOffset:36,byteLength:6,target:34963}],accessors:[{bufferView:0,componentType:5126,type:'VEC3',count:3,min:[0,0,0],max:[1,1,1]},{bufferView:0,componentType:5126,type:'VEC3',count:3},{bufferView:1,componentType:5126,type:'VEC4',count:3},{bufferView:2,componentType:5123,type:'SCALAR',count:3}]};return {doc,bin,source:pack(doc,bin)};
}
const unpack=(b:Buffer)=>{const end=20+b.readUInt32LE(12);return {doc:JSON.parse(b.toString('utf8',20,end)),chunk:b.subarray(end),bin:b.subarray(end+8)};};
function child(){return Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough(),kill:vi.fn(()=>true)});}
function framed(receipt:unknown,bytes:Buffer){const r=Buffer.from(JSON.stringify(receipt)),prefix=Buffer.alloc(4);prefix.writeUInt32LE(r.length);return Buffer.concat([prefix,r,bytes]);}
async function startFake(source:Buffer,hooks:Parameters<typeof prepareLightFixtureInWorker>[1]={}){
 const worker=child();vi.mocked(spawn).mockReturnValueOnce(worker as unknown as ChildProcess);const promise=prepareLightFixtureInWorker(source,hooks);void promise.catch(()=>{});await Promise.resolve();await Promise.resolve();expect(spawn).toHaveBeenCalled();return {worker,promise};
}
function finish(worker:ReturnType<typeof child>,frame:Buffer,code:number|null=0,signal:NodeJS.Signals|null=null){worker.stdout.emit('data',frame);worker.emit('close',code,signal);}
beforeEach(()=>{vi.resetAllMocks();vi.mocked(spawn).mockImplementation(actualProcesses.spawn);validationMock.mockImplementation(async()=>undefined);});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
it('runs synthetic producer source validation, preparation and derived validation as three closed workers, preserving the entire BIN',async()=>{
 validationMock.mockImplementation(actualValidation.validateWorkspaceFurnishingGlb);const f=fixture(),before=Buffer.from(f.source),closed:ChildProcess[]=[];
 const validation=await validateBytes(prepareLightFixtureSource(f.source).bytes,{maxIssues:64});expect(validation.issues.numErrors,JSON.stringify(validation.issues)).toBe(0);
 const notice=Buffer.from('Independent synthetic fixture, CC0-1.0.'),result=await produceSharedFixtureCandidate({source:f.source,notice,authority:{source:{sha256:hash(f.source),bytes:f.source.length},notice:{sha256:hash(notice),bytes:notice.length},licenseId:'CC0-1.0'},producer:{sourceCommit:'a'.repeat(40),implementationSHA256:'b'.repeat(64)}},{onSpawn:worker=>{worker.once('close',()=>closed.push(worker));}});
 expect(closed).toHaveLength(3);expect(result.receipt.workerDrained).toBe(true);expect(result.bytes).toEqual(prepareLightFixtureSource(f.source).bytes);expect(unpack(result.bytes).chunk).toEqual(unpack(f.source).chunk);expect(f.source).toEqual(before);expect(result.receipt.preparation?.removed).toEqual([{mesh:0,primitive:0,accessor:2}]);expect(validateWorkspaceFurnishingGlb).toHaveBeenCalledTimes(2);expect(result.source).toEqual(before);expect(result.sourceNotice).toEqual(notice);expect(result.notice.toString()).toContain(hash(before));
});
it('keeps an actually ordinary-valid synthetic original unchanged without starting a preparation worker',async()=>{
 validationMock.mockImplementation(actualValidation.validateWorkspaceFurnishingGlb);const source=prepareLightFixtureSource(fixture().source).bytes,notice=Buffer.from('Synthetic unchanged original, CC0-1.0.');
 const result=await produceSharedFixtureCandidate({source,notice,authority:{source:{sha256:hash(source),bytes:source.length},notice:{sha256:hash(notice),bytes:notice.length},licenseId:'CC0-1.0'},producer:{sourceCommit:'a'.repeat(40),implementationSHA256:'b'.repeat(64)}});
 expect(result.bytes).toEqual(source);expect(result.notice).toEqual(notice);expect(result.receipt.preparation).toBeNull();expect(result.receipt.recipe).toEqual({version:1,id:'source-original-v1'});expect(spawn).toHaveBeenCalledTimes(1);
});
it('rejects a normal-mapped synthetic source without invoking output validation',async()=>{
 const f=fixture();Object.assign(f.doc.materials[0]!,{normalTexture:{index:0}});await expect(prepareLightFixtureInWorker(pack(f.doc,f.bin))).rejects.toMatchObject({status:422,code:'LIGHT_FIXTURE_PREPARATION_UNSAFE'});expect(validateWorkspaceFurnishingGlb).not.toHaveBeenCalled();
});
it('awaits actual close after cancellation, error or timeout rather than treating a kill as drainage',async()=>{
 vi.useFakeTimers();const f=fixture(),controller=new AbortController(),{worker,promise}=await startFake(f.source,{signal:controller.signal});let settled=false;void promise.then(()=>{settled=true;},()=>{settled=true;});controller.abort();worker.emit('error',Error('failed'));await vi.advanceTimersByTimeAsync(5001);expect(worker.kill).toHaveBeenCalledWith('SIGKILL');expect(settled).toBe(false);worker.emit('close',null,'SIGKILL');await expect(promise).rejects.toMatchObject({status:503,code:'FURNISHING_VALIDATION_UNAVAILABLE'});expect(validateWorkspaceFurnishingGlb).not.toHaveBeenCalled();
});
it('fails closed on timeout and unknown stderr/exit, but only exact supported unsafe exit is semantic422',async()=>{
 const f=fixture();for(const [code,text,status] of [[1,'LIGHT_FIXTURE_PREPARATION_UNSAFE\n',422],[1,'different error',503],[0,'unexpected stderr',503],[2,'',503]] as const){const {worker,promise}=await startFake(f.source);if(text)worker.stderr.emit('data',Buffer.from(text));finish(worker,Buffer.alloc(0),code);await expect(promise).rejects.toMatchObject({status});}
 vi.useFakeTimers();const {worker,promise}=await startFake(f.source);await vi.advanceTimersByTimeAsync(5001);worker.emit('close',0,null);await expect(promise).rejects.toMatchObject({status:503});
});
it.each(['source','derived','bin','duplicate-row','material','node'] as const)('rejects a forged %s frame even with self-consistent output hashes',async change=>{
 const f=fixture(),prepared=prepareLightFixtureSource(f.source),receipt=structuredClone(prepared.receipt);let bytes=Buffer.from(prepared.bytes);
 if(change==='source')receipt.source.sha256='0'.repeat(64);
 if(change==='derived')receipt.derived.sha256='0'.repeat(64);
 if(change==='bin'){const out=unpack(bytes),bin=Buffer.from(out.bin);bin[0]=1;bytes=pack(out.doc,bin);receipt.derived={sha256:hash(bytes),bytes:bytes.length};receipt.binSHA256=hash(bin);}
 if(change==='duplicate-row')receipt.removed.push({...receipt.removed[0]!});
 if(change==='material'||change==='node'){const out=unpack(bytes);if(change==='material')out.doc.materials[0].pbrMetallicRoughness.baseColorFactor=[.1,.2,.3,1];else out.doc.nodes[0].translation=[.1,0,0];bytes=pack(out.doc,out.bin);receipt.derived={sha256:hash(bytes),bytes:bytes.length};}
 const {worker,promise}=await startFake(f.source);finish(worker,framed(receipt,bytes));await expect(promise).rejects.toMatchObject({status:503,code:'FURNISHING_VALIDATION_UNAVAILABLE'});
});
it('requires full derived format validation and rechecks ownership after the worker closes',async()=>{
 const f=fixture(),prepared=prepareLightFixtureSource(f.source),error=new ApiError(422,'FORMAT_REJECTED');validationMock.mockRejectedValueOnce(error);const a=await startFake(f.source);finish(a.worker,framed(prepared.receipt,prepared.bytes));await expect(a.promise).rejects.toBe(error);
 const current=vi.fn(async()=>{}).mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('owner changed'));const b=await startFake(f.source,{assertCurrent:current});finish(b.worker,framed(prepared.receipt,prepared.bytes));await expect(b.promise).rejects.toThrow('owner changed');
});
it('does not accept a complete success frame until its preparation worker closes',async()=>{
 const f=fixture(),prepared=prepareLightFixtureSource(f.source),{worker,promise}=await startFake(f.source);worker.stdout.emit('data',framed(prepared.receipt,prepared.bytes));await Promise.resolve();expect(validateWorkspaceFurnishingGlb).not.toHaveBeenCalled();worker.emit('close',0,null);await expect(promise).resolves.toMatchObject({workerDrained:true});
});
it('cancels the separate derived validator and waits for that child close too',async()=>{
 const f=fixture(),prepared=prepareLightFixtureSource(f.source),controller=new AbortController(),validator=child();
 validationMock.mockImplementationOnce(async(_model,_bytes,hooks)=>{hooks?.onSpawn?.(validator as unknown as ChildProcess);await new Promise<void>((_resolve,reject)=>validator.once('close',()=>reject(new ApiError(503,'FURNISHING_VALIDATION_UNAVAILABLE'))));});
 const {worker,promise}=await startFake(f.source,{signal:controller.signal});let settled=false;void promise.then(()=>{settled=true;},()=>{settled=true;});finish(worker,framed(prepared.receipt,prepared.bytes));await vi.waitFor(()=>expect(validator.listenerCount('close')).toBeGreaterThan(0));controller.abort();await Promise.resolve();expect(validator.kill).toHaveBeenCalledWith('SIGKILL');expect(settled).toBe(false);validator.emit('close',null,'SIGKILL');await expect(promise).rejects.toMatchObject({status:503});
});
it('does not spawn after a pre-abort or invalid writer descriptor',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();await expect(prepareLightFixtureInWorker(f.source,{signal:controller.signal})).rejects.toBe(controller.signal.reason);await expect(prepareLightFixtureInWorker(f.source,{writerFd:2})).rejects.toMatchObject({status:503});expect(spawn).not.toHaveBeenCalled();
});
