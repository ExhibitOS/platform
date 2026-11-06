// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import type {WebGLRenderer} from 'three';
const state=vi.hoisted(()=>({instance:undefined as unknown,finish:undefined as undefined|(()=>void)}));
vi.mock('three/addons/loaders/KTX2Loader.js',()=>({KTX2Loader:class {
 workerConfig={supported:true};workerSourceURL='';transcoderBinary:ArrayBuffer|null=null;workerPool={setWorkerCreator:vi.fn(),dispose:vi.fn()};disposeCount=0;
 constructor(){state.instance=this;}
 setTranscoderPath(){return this;}setWorkerLimit(){return this;}detectSupport(){return this;}
 init(){return new Promise<void>(resolve=>{state.finish=()=>{this.workerSourceURL=URL.createObjectURL(new Blob(['worker']));this.transcoderBinary=new ArrayBuffer(8);this.workerPool.setWorkerCreator(()=>({}));resolve();};});}
 dispose(){this.disposeCount++;this.workerPool.dispose();if(this.workerSourceURL)URL.revokeObjectURL(this.workerSourceURL);}
}}));
import {basisLoader} from './basis-loader';
afterEach(()=>vi.unstubAllGlobals());
it('retires a URL and binary created after an aborted init without disposing the loader twice',async()=>{
 const doc=new TextEncoder().encode(JSON.stringify({extensionsUsed:['KHR_texture_basisu']})),n=Math.ceil(doc.length/4)*4,buffer=new ArrayBuffer(20+n),view=new DataView(buffer);view.setUint32(12,n,true);new Uint8Array(buffer).fill(32,20);new Uint8Array(buffer).set(doc,20);
 const create=vi.spyOn(URL,'createObjectURL'),revoke=vi.spyOn(URL,'revokeObjectURL'),controller=new AbortController();const result=basisLoader({} as WebGLRenderer,buffer,controller.signal);await vi.waitFor(()=>expect(state.finish).toBeTypeOf('function'));controller.abort();const instance=state.instance as {disposeCount:number;workerSourceURL:string;transcoderBinary:ArrayBuffer|null;workerPool:{setWorkerCreator:ReturnType<typeof vi.fn>}};expect(instance.disposeCount).toBe(1);state.finish!();await expect(result).rejects.toThrow();expect(create).toHaveBeenCalledOnce();const url=create.mock.results[0]!.value;expect(url).toMatch(/^blob:/);expect(revoke).toHaveBeenCalledExactlyOnceWith(url);create.mockRestore();revoke.mockRestore();expect(instance.disposeCount).toBe(1);expect(instance.workerSourceURL).toBe('');expect(instance.transcoderBinary).toBeNull();expect(()=>instance.workerPool.setWorkerCreator.mock.calls.at(-1)![0]()).toThrow('BASIS_LOADER_DISPOSED');
});
