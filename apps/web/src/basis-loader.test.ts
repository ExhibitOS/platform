// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import type {WebGLRenderer} from 'three';
const state=vi.hoisted(()=>({instance:undefined as unknown,finish:undefined as undefined|(()=>void),fail:undefined as undefined|(()=>void),failDispose:false}));
vi.mock('three/addons/loaders/KTX2Loader.js',()=>({KTX2Loader:class {
 workerConfig={supported:true};workerSourceURL='';transcoderBinary:ArrayBuffer|null=null;workerPool={setWorkerCreator:vi.fn(),dispose:vi.fn()};disposeCount=0;
 constructor(){state.instance=this;}
 setTranscoderPath(){return this;}setWorkerLimit(){return this;}detectSupport(){return this;}
 init(){const allocate=()=>{this.workerSourceURL=URL.createObjectURL(new Blob(['worker']));this.transcoderBinary=new ArrayBuffer(8);this.workerPool.setWorkerCreator(()=>({}));};return new Promise<void>((resolve,reject)=>{state.finish=()=>{allocate();resolve();};state.fail=()=>{allocate();reject(Error('TRANSCODER_UNAVAILABLE'));};});}
 dispose(){this.disposeCount++;if(state.failDispose)throw undefined;this.workerPool.dispose();if(this.workerSourceURL)URL.revokeObjectURL(this.workerSourceURL);}
}}));
import {basisLoader} from './basis-loader';
afterEach(()=>{vi.unstubAllGlobals();state.finish=undefined;state.fail=undefined;state.failDispose=false;});
it('retires a URL and binary created after an aborted init without disposing the loader twice',async()=>{
 const doc=new TextEncoder().encode(JSON.stringify({extensionsUsed:['KHR_texture_basisu']})),n=Math.ceil(doc.length/4)*4,buffer=new ArrayBuffer(20+n),view=new DataView(buffer);view.setUint32(12,n,true);new Uint8Array(buffer).fill(32,20);new Uint8Array(buffer).set(doc,20);
 const create=vi.spyOn(URL,'createObjectURL'),revoke=vi.spyOn(URL,'revokeObjectURL'),controller=new AbortController();const result=basisLoader({} as WebGLRenderer,buffer,controller.signal);await vi.waitFor(()=>expect(state.finish).toBeTypeOf('function'));controller.abort();const instance=state.instance as {disposeCount:number;workerSourceURL:string;transcoderBinary:ArrayBuffer|null;workerPool:{setWorkerCreator:ReturnType<typeof vi.fn>}};expect(instance.disposeCount).toBe(1);state.finish!();await expect(result).rejects.toThrow();expect(create).toHaveBeenCalledOnce();const url=create.mock.results[0]!.value;expect(url).toMatch(/^blob:/);expect(revoke).toHaveBeenCalledExactlyOnceWith(url);create.mockRestore();revoke.mockRestore();expect(instance.disposeCount).toBe(1);expect(instance.workerSourceURL).toBe('');expect(instance.transcoderBinary).toBeNull();expect(()=>instance.workerPool.setWorkerCreator.mock.calls.at(-1)![0]()).toThrow('BASIS_LOADER_DISPOSED');
});

function basisFixture(){const doc=new TextEncoder().encode(JSON.stringify({extensionsUsed:['KHR_texture_basisu']})),n=Math.ceil(doc.length/4)*4,buffer=new ArrayBuffer(20+n);new DataView(buffer).setUint32(12,n,true);new Uint8Array(buffer).fill(32,20);new Uint8Array(buffer).set(doc,20);return buffer;}
it('acknowledges failed GPU setup only after owned binary, URL and worker pool retire',async()=>{
 const retired=vi.fn(()=>{const loader=state.instance as {workerSourceURL:string;transcoderBinary:ArrayBuffer|null;workerPool:{dispose:ReturnType<typeof vi.fn>}};expect(loader.workerSourceURL).toBe('');expect(loader.transcoderBinary).toBeNull();expect(loader.workerPool.dispose).toHaveBeenCalledOnce();});
 const result=basisLoader({} as WebGLRenderer,basisFixture(),undefined,retired);const rejected=expect(result).rejects.toThrow('TRANSCODER_UNAVAILABLE');
 await vi.waitFor(()=>expect(state.fail).toBeTypeOf('function'));state.fail!();await rejected;expect(retired).toHaveBeenCalledOnce();
});
it('never acknowledges setup retirement if the loader cleanup throws a falsy exception',async()=>{
 state.failDispose=true;const retired=vi.fn(),result=basisLoader({} as WebGLRenderer,basisFixture(),undefined,retired),rejected=expect(result).rejects.toBeUndefined();
 try{await vi.waitFor(()=>expect(state.fail).toBeTypeOf('function'));state.fail!();await rejected;expect(retired).not.toHaveBeenCalled();}
 finally{const loader=state.instance as {workerSourceURL:string};if(loader.workerSourceURL)URL.revokeObjectURL(loader.workerSourceURL);}
});
