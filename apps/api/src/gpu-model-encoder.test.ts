// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {chmod,copyFile,cp,lstat,mkdir,mkdtemp,readFile,readdir,realpath,rm,symlink,unlink,writeFile} from 'node:fs/promises';
import {arch,platform,tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {GPU_MODEL_PREPARATION_RECIPE} from './gpu-model-preparation-contract.ts';
import {assertGpuModelEncoderReady,encodeGpuModelBaseColor,GpuModelEncoderError,type GpuModelEncoderContext} from './gpu-model-encoder.ts';
vi.mock('node:child_process',()=>({spawn:vi.fn()}));
vi.mock('node:os',async original=>{const actual=await original<typeof import('node:os')>();return {...actual,arch:vi.fn(()=>actual.arch()),platform:vi.fn(()=>actual.platform())};});

// Existing signed recipient input is only read/copied. No test executes an encoder.
const signedPrefix=process.env.EXHIBITOS_GPU_ENCODER_TEST_PREFIX;
const available=!!signedPrefix&&platform()==='darwin'&&arch()==='arm64';
function png(){const b=Buffer.alloc(33);b.set([137,80,78,71,13,10,26,10]);b.writeUInt32BE(13,8);b.write('IHDR',12);b.writeUInt32BE(512,16);b.writeUInt32BE(512,20);b[24]=8;b[25]=2;return b;}
function fakeChild(){const e=new EventEmitter(),stdout=new PassThrough(),stderr=new PassThrough(),kill=vi.fn(()=>true);return Object.assign(e,{stdout,stderr,kill,stdio:[null,stdout,stderr]}) as unknown as ChildProcess;}
let suite:string,root:string,prefix:string,job:string,child:ChildProcess,argv:string[],options:Record<string,unknown>;
let context:GpuModelEncoderContext;
let spawned:()=>void,spawnedPromise:Promise<void>;
const close=(code:number|null=0,signal:string|null=null)=>child.emit('close',code,signal);
function autoOutput(bytes=Buffer.from('synthetic output, not a transcode fixture')){
 vi.mocked(spawn).mockImplementation((_command,args,opts)=>{
  argv=[...args as string[]];options=opts as Record<string,unknown>;child=fakeChild();
  void writeFile(argv.at(-2)!,bytes,{flag:'wx',mode:0o600}).then(()=>close());return child;
 });
}
const expectedError=(code:string,cleanupComplete=true)=>expect.objectContaining({code,workerDrained:true,cleanupComplete});

describe.skipIf(!available)('managed signed encoder adapter (mock spawn only)',()=>{
 beforeAll(async()=>{suite=await realpath(await mkdtemp(join(tmpdir(),'gpu-encoder-tests-')));await mkdir(join(suite,'pinned'),{mode:0o700});
  for(const folder of ['bin','lib'])await mkdir(join(suite,'pinned',folder),{mode:0o700});
  for(const path of ['bin/toktx','lib/libktx.4.4.2.dylib'])await copyFile(join(signedPrefix!,path),join(suite,'pinned',path));
  for(const path of ['bin/toktx','lib/libktx.4.4.2.dylib'])await chmod(join(suite,'pinned',path),0o755);
  await symlink('libktx.4.4.2.dylib',join(suite,'pinned/lib/libktx.4.dylib'));await symlink('libktx.4.dylib',join(suite,'pinned/lib/libktx.dylib'));
 });
 afterAll(async()=>{await rm(suite,{recursive:true,force:true});});
 beforeEach(async()=>{
  vi.mocked(spawn).mockReset();vi.mocked(arch).mockReturnValue('arm64');vi.mocked(platform).mockReturnValue('darwin');
  root=await mkdtemp(join(suite,'case-'));prefix=join(root,'managed');job=join(root,'job');await cp(join(suite,'pinned'),prefix,{recursive:true,verbatimSymlinks:true});await mkdir(job,{mode:0o700});
  spawnedPromise=new Promise(resolve=>{spawned=resolve;});
  vi.mocked(spawn).mockImplementation((_command,args,opts)=>{argv=[...args as string[]];options=opts as Record<string,unknown>;child=fakeChild();return child;});
  context={managedPrefix:prefix,jobDirectory:job,assertCurrent:vi.fn(async()=>{}),onSpawn:()=>spawned()};
 });
 afterEach(async()=>{vi.useRealTimers();await rm(root,{recursive:true,force:true});});
 it('checks the actual pinned signed tool/library and exact relative aliases without running them',async()=>{
  await expect(assertGpuModelEncoderReady(prefix)).resolves.toBeUndefined();expect(spawn).not.toHaveBeenCalled();
  expect((await lstat(join(prefix,'bin/toktx'))).size).toBe(993520);expect((await lstat(join(prefix,'lib/libktx.4.4.2.dylib'))).size).toBe(2454960);
 });
 it('uses only recipe argv, direct process, minimal environment, exclusive source bytes and inherited writer fd',async()=>{
  autoOutput();context.writerFd=12;const input=png(),copy=Buffer.from(input),result=await encodeGpuModelBaseColor(input,context);
  expect(spawn).toHaveBeenCalledWith(join(prefix,'bin/toktx'),[...GPU_MODEL_PREPARATION_RECIPE.encoder.options,argv.at(-2),argv.at(-1)],expect.any(Object));
  expect(options).toEqual({cwd:dirname(argv.at(-1)!),env:{LANG:'C',LC_ALL:'C',TMPDIR:dirname(argv.at(-1)!)},detached:false,shell:false,stdio:['ignore','pipe','pipe',12]});
  expect(argv.at(-1)).toMatch(/\/gpu-[a-f0-9-]+\/source\.png$/);expect(argv.at(-2)).toBe(join(dirname(argv.at(-1)!),'base-color.ktx2'));
  expect(input).toEqual(copy);expect(result).toMatchObject({workerDrained:true,ktx:Buffer.from('synthetic output, not a transcode fixture')});expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  expect(await readdir(job)).toEqual([]);expect(context.assertCurrent).toHaveBeenCalledTimes(3);
 });
 it('leaves unrelated caller-owned job files intact',async()=>{await writeFile(join(job,'retained'),'retained');autoOutput();await encodeGpuModelBaseColor(png(),context);expect(await readFile(join(job,'retained'),'utf8')).toBe('retained');});
 it.each(['tool','library','alias','absolute-alias','extra-file','mode','prefix-link'] as const)('rejects wrong managed %s before spawn',async kind=>{
  if(kind==='tool')await writeFile(join(prefix,'bin/toktx'),Buffer.alloc(993520));
  if(kind==='library')await writeFile(join(prefix,'lib/libktx.4.4.2.dylib'),Buffer.alloc(2454960));
  if(kind==='alias'||kind==='absolute-alias'){const p=join(prefix,'lib/libktx.dylib');await unlink(p);await symlink(kind==='alias'?'../../pinned/lib/libktx.4.4.2.dylib':join(prefix,'lib/libktx.4.4.2.dylib'),p);}
  if(kind==='extra-file')await writeFile(join(prefix,'lib/foreign.dylib'),'foreign');
  if(kind==='mode')await chmod(join(prefix,'bin/toktx'),0o777);
  if(kind==='prefix-link'){await symlink(prefix,join(root,'linked'));context.managedPrefix=join(root,'linked');}
  await expect(encodeGpuModelBaseColor(png(),context)).rejects.toEqual(expectedError('GPU_MODEL_ENCODER_IDENTITY_INVALID'));expect(spawn).not.toHaveBeenCalled();expect(await readdir(job)).toEqual([]);
 });
 it('rejects unsupported host architecture rather than claiming cross-platform readiness',async()=>{vi.mocked(arch).mockReturnValue('x64');await expect(assertGpuModelEncoderReady(prefix)).rejects.toEqual(expectedError('GPU_MODEL_ENCODER_IDENTITY_INVALID'));});
 it.each(['relative','public','link','overlap'] as const)('rejects invalid job directory %s',async kind=>{
  if(kind==='relative')context.jobDirectory='relative';if(kind==='public')await chmod(job,0o755);
  if(kind==='link'){await symlink(job,join(root,'linked'));context.jobDirectory=join(root,'linked');}
  if(kind==='overlap')context.jobDirectory=prefix;
  await expect(encodeGpuModelBaseColor(png(),context)).rejects.toBeInstanceOf(GpuModelEncoderError);expect(spawn).not.toHaveBeenCalled();
 });
 it('rejects invalid writer fds and bounded RGB PNG headers before spawn',async()=>{
  for(const fd of [0,9,1024,NaN,10.5])await expect(encodeGpuModelBaseColor(png(),{...context,writerFd:fd})).rejects.toEqual(expectedError('GPU_MODEL_ENCODER_WRITER_INVALID'));
  for(const input of [Buffer.alloc(1),Buffer.alloc(8*1024*1024+1),(()=>{const b=png();b[25]=6;return b;})(),(()=>{const b=png();b.writeUInt32BE(1024,16);return b;})()])await expect(encodeGpuModelBaseColor(input,context)).rejects.toEqual(expectedError('GPU_MODEL_ENCODER_INPUT_INVALID'));
  expect(spawn).not.toHaveBeenCalled();
 });
 it('rejects already-aborted jobs without dispatch',async()=>{const c=new AbortController();c.abort();await expect(encodeGpuModelBaseColor(png(),{...context,signal:c.signal})).rejects.toEqual(expectedError('GPU_MODEL_ENCODER_CANCELLED'));expect(spawn).not.toHaveBeenCalled();});
 it('awaits actual close after abort; kill does not drain or clean the invocation',async()=>{
  const controller=new AbortController(),pending=encodeGpuModelBaseColor(png(),{...context,signal:controller.signal});const observed=pending.catch(e=>e);await spawnedPromise;
  let settled=false;void observed.then(()=>{settled=true;});controller.abort();await Promise.resolve();expect(child.kill).toHaveBeenCalledWith('SIGKILL');expect(settled).toBe(false);expect(await readdir(job)).toHaveLength(1);
  close(null,'SIGKILL');expect(await observed).toEqual(expectedError('GPU_MODEL_ENCODER_CANCELLED'));expect(await readdir(job)).toEqual([]);
 });
 it('keeps process-error outcomes pending until close, discarding raw diagnostic text',async()=>{
  const pending=encodeGpuModelBaseColor(png(),context),observed=pending.catch(e=>e);await spawnedPromise;
  child.stderr!.emit('data',Buffer.from('secret raw diagnostic'));child.emit('error',Error('private path credential'));let settled=false;void observed.then(()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);
  close(1);const error=await observed;expect(error).toEqual(expectedError('GPU_MODEL_ENCODER_UNAVAILABLE'));expect(error.message).toBe('GPU_MODEL_ENCODER_UNAVAILABLE');
 });
 it.each(['stdout','stderr'] as const)('bounds %s and waits for close after overflow',async stream=>{
  const observed=encodeGpuModelBaseColor(png(),context).catch(e=>e);await spawnedPromise;child[stream]!.emit('data',Buffer.alloc(4097));expect(child.kill).toHaveBeenCalledWith('SIGKILL');close(0);expect(await observed).toEqual(expectedError('GPU_MODEL_ENCODER_FAILED'));
 });
 it('awaits actual close after the fixed 20 second deadline',async()=>{
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','setInterval','clearInterval','Date','performance']});const observed=encodeGpuModelBaseColor(png(),context).catch(e=>e);await spawnedPromise;await vi.advanceTimersByTimeAsync(20000);
  expect(child.kill).toHaveBeenCalledWith('SIGKILL');let settled=false;void observed.then(()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);close(null,'SIGKILL');expect(await observed).toEqual(expectedError('GPU_MODEL_ENCODER_DEADLINE'));
 });
 it('rechecks authority after close and before accepting any output',async()=>{
  vi.mocked(context.assertCurrent).mockResolvedValueOnce().mockResolvedValueOnce().mockRejectedValueOnce(Error('revoked secret'));
  autoOutput();await expect(encodeGpuModelBaseColor(png(),context)).rejects.toEqual(expectedError('GPU_MODEL_ENCODER_AUTHORITY_LOST'));expect(await readdir(job)).toEqual([]);
 });
 it('rechecks tool identity after close',async()=>{
  const observed=encodeGpuModelBaseColor(png(),context).catch(e=>e);await spawnedPromise;await writeFile(argv.at(-2)!,Buffer.from('output'));await writeFile(join(prefix,'bin/toktx'),Buffer.alloc(993520));close();expect(await observed).toEqual(expectedError('GPU_MODEL_ENCODER_IDENTITY_INVALID'));
 });
 it('rejects source mutation and oversized/missing output after close',async()=>{
  const observed=encodeGpuModelBaseColor(png(),context).catch(e=>e);await spawnedPromise;await writeFile(argv.at(-1)!,Buffer.alloc(33));await writeFile(argv.at(-2)!,Buffer.from('output'));close();expect(await observed).toEqual(expectedError('GPU_MODEL_ENCODER_IDENTITY_INVALID'));
  vi.mocked(context.assertCurrent).mockClear();autoOutput(Buffer.alloc(8*1024*1024+1));await expect(encodeGpuModelBaseColor(png(),context)).rejects.toEqual(expectedError('GPU_MODEL_ENCODER_OUTPUT_INVALID'));
 });
 it('rejects absent output only after actual close and completes owned cleanup',async()=>{
  const observed=encodeGpuModelBaseColor(png(),context).catch(e=>e);await spawnedPromise;close();expect(await observed).toEqual(expectedError('GPU_MODEL_ENCODER_OUTPUT_INVALID'));expect(await readdir(job)).toEqual([]);
 });
 it('kills a growing oversized output before close, then waits for actual close',async()=>{
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','setInterval','clearInterval','Date','performance']});const observed=encodeGpuModelBaseColor(png(),context).catch(e=>e);await spawnedPromise;await writeFile(argv.at(-2)!,Buffer.alloc(8*1024*1024+1));await vi.advanceTimersByTimeAsync(50);
  // The monitor performs an actual asynchronous stat; permit its filesystem completion.
  for(let i=0;i<30&&!vi.mocked(child.kill).mock.calls.length;i++)await new Promise<void>(resolve=>setImmediate(resolve));
  expect(child.kill).toHaveBeenCalledWith('SIGKILL');close();expect(await observed).toEqual(expectedError('GPU_MODEL_ENCODER_OUTPUT_INVALID'));
 });
 it('waits for close even when the owner callback throws',async()=>{
  let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});const observed=encodeGpuModelBaseColor(png(),{...context,onSpawn:()=>{started();throw Error('private');}}).catch(e=>e);await ready;expect(child.kill).toHaveBeenCalledWith('SIGKILL');close();expect(await observed).toEqual(expectedError('GPU_MODEL_ENCODER_FAILED'));
 });
 it('awaits asynchronous owner callback completion even after actual close',async()=>{
  let release!:()=>void;const callback=new Promise<void>(resolve=>{release=resolve;});
  context.onSpawn=async()=>{spawned();await callback;throw Error('private callback error');};
  const observed=encodeGpuModelBaseColor(png(),context).catch(e=>e);await spawnedPromise;close();
  let settled=false;void observed.then(()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);expect(await readdir(job)).toHaveLength(1);
  release();expect(await observed).toEqual(expectedError('GPU_MODEL_ENCODER_FAILED'));expect(await readdir(job)).toEqual([]);
 });
 it('reports incomplete cleanup and retains an unexpected foreign surface',async()=>{
  const observed=encodeGpuModelBaseColor(png(),context).catch(e=>e);await spawnedPromise;await writeFile(join(dirname(argv.at(-1)!),'foreign'),'retain');close(1);
  expect(await observed).toEqual(expectedError('GPU_MODEL_ENCODER_CLEANUP_FAILED',false));expect(await readFile(join(dirname(argv.at(-1)!),'foreign'),'utf8')).toBe('retain');
 });
 it('refuses output symlink escape and does not remove the target or conceal cleanup uncertainty',async()=>{
  const observed=encodeGpuModelBaseColor(png(),context).catch(e=>e);await spawnedPromise;await symlink(join(prefix,'bin/toktx'),argv.at(-2)!);close();expect(await observed).toEqual(expectedError('GPU_MODEL_ENCODER_CLEANUP_FAILED',false));expect((await lstat(join(prefix,'bin/toktx'))).size).toBe(993520);
 });
 it('classifies synchronous spawn failure as drained and cleans only its own files',async()=>{vi.mocked(spawn).mockImplementation(()=>{throw Error('raw');});await expect(encodeGpuModelBaseColor(png(),context)).rejects.toEqual(expectedError('GPU_MODEL_ENCODER_UNAVAILABLE'));expect(await readdir(job)).toEqual([]);});
});

describe('encoder pre-dispatch bounds without managed binary fixtures',()=>{
 const unused=():GpuModelEncoderContext=>({managedPrefix:'/unused-managed-prefix',jobDirectory:'/unused-job-directory',assertCurrent:vi.fn(async()=>{})});
 beforeEach(()=>{vi.mocked(spawn).mockClear();});
 it('rejects bounded input violations without filesystem preparation or dispatch',async()=>{
  const context=unused();await expect(encodeGpuModelBaseColor(Buffer.alloc(0),context)).rejects.toEqual(expectedError('GPU_MODEL_ENCODER_INPUT_INVALID'));
  expect(context.assertCurrent).not.toHaveBeenCalled();expect(spawn).not.toHaveBeenCalled();
 });
 it('rejects an invalid writer descriptor without preparing a job',async()=>{
  const context={...unused(),writerFd:1024};await expect(encodeGpuModelBaseColor(png(),context)).rejects.toEqual(expectedError('GPU_MODEL_ENCODER_WRITER_INVALID'));expect(spawn).not.toHaveBeenCalled();
 });
 it('does not dispatch an already-aborted request',async()=>{
  const controller=new AbortController();controller.abort();await expect(encodeGpuModelBaseColor(png(),{...unused(),signal:controller.signal})).rejects.toEqual(expectedError('GPU_MODEL_ENCODER_CANCELLED'));expect(spawn).not.toHaveBeenCalled();
 });
 it('never reports another platform as ready',async()=>{
  vi.mocked(platform).mockReturnValue('linux');try{await expect(assertGpuModelEncoderReady('/unused')).rejects.toEqual(expectedError('GPU_MODEL_ENCODER_IDENTITY_INVALID'));}finally{vi.mocked(platform).mockReturnValue(process.platform);}
  expect(spawn).not.toHaveBeenCalled();
 });
});
