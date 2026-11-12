// SPDX-License-Identifier: AGPL-3.0-or-later
import {beforeEach,expect,test,vi} from 'vitest';
import * as three from 'three';
import {AssetReleaseUnconfirmedError} from './loading';
const mocks=vi.hoisted(()=>({manager:vi.fn(),prepare:vi.fn(),caps:vi.fn()}));
vi.mock('../embedded-glb',()=>({embeddedPNGManager:mocks.manager}));
vi.mock('./artwork-glb-preparation',()=>({prepareArtworkGlb:mocks.prepare}));
vi.mock('./gpu-model-capability',async()=>{
 const actual=await vi.importActual<typeof import('./gpu-model-capability')>('./gpu-model-capability');
 return {...actual,gpuModelCapability:mocks.caps};
});
import {loadGpuModel} from './gpu-model-loader';
const budget={maxTriangles:20000,maxTextureSize:512,maxCacheBytes:32*1024*1024};
const renderer={} as three.WebGLRenderer,bytes=new ArrayBuffer(28);
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}
function fixture(format:three.CompressedPixelFormat=three.RGBA_ASTC_4x4_Format){
 const events:string[]=[],mips=Array.from({length:10},(_,i)=>({width:Math.max(1,512>>i),height:Math.max(1,512>>i),data:new Uint8Array(16)}));
 const base=new three.CompressedTexture(mips,512,512,format);base.colorSpace=three.SRGBColorSpace;
 const normal=new three.Texture({width:512,height:512}),ao=new three.Texture({width:512,height:512});
 const geometry=new three.BoxGeometry(1,1,1),material=new three.MeshStandardMaterial({map:base,normalMap:normal,aoMap:ao}),object=new three.Mesh(geometry,material);
 for(const [name,value]of [['base',base],['normal',normal],['ao',ao],['geometry',geometry],['material',material]] as const)vi.spyOn(value,'dispose').mockImplementation(()=>{events.push(name);});
 const worker={dispose:vi.fn(async()=>{events.push('worker');})};
 const backing={bytes,ktx2Loader:{load:vi.fn()},dispose:vi.fn(()=>{events.push('close-callbacks');}),drain:vi.fn(async()=>{events.push('children');}),retire:vi.fn(()=>{events.push('retire-backing');}),cleanupOK:vi.fn(()=>true),assertLoaded:vi.fn(),ownsTexture:vi.fn(()=>true),releaseEncoded:vi.fn(()=>false)};
 const parse=vi.fn(async()=>({scene:object}));
 class GLTFLoader {constructor(public manager?:unknown){}setKTX2Loader=vi.fn();parseAsync=parse;}
 mocks.manager.mockImplementation(()=>{events.push('preflight');return backing;});
 mocks.caps.mockImplementation(async()=>{events.push('capabilities');return {astcSupported:true,bptcSupported:true};});
 mocks.prepare.mockImplementation(async(_r,_b,_s,potential)=>{events.push('setup');potential(true);return {GLTFLoader,basis:worker};});
 return {events,base,normal,ao,geometry,material,object,worker,backing,parse};
}
beforeEach(()=>{vi.resetAllMocks();});
test('preflights the new recipe before capability/init; returns actual ASTC with raw linear normal/AO and retired worker',async()=>{
 const f=fixture();const result=await loadGpuModel(three,renderer,bytes,new AbortController().signal,budget);
 expect(f.events).toEqual(['preflight','capabilities','setup','children','worker']);
 expect(mocks.manager.mock.calls[0]?.slice(1)).toEqual([bytes,expect.objectContaining({parse:expect.any(Function)}),undefined,'gpu-model-v1']);
 expect(mocks.prepare.mock.calls[0]?.slice(4)).toEqual([undefined,true]);
 expect(result.object).toBe(f.object);expect(result.backing).toBe(f.backing);expect(result.targetFormat).toBe('astc-4x4');
 expect(result.resources).toEqual(expect.arrayContaining([f.backing,f.geometry,f.material,f.base,f.normal,f.ao]));
 await Promise.all(result.resources.map(value=>value.dispose()));expect(f.worker.dispose).toHaveBeenCalledTimes(1);
});
test('invalid preflight and unsupported filtered capability never initialize decoder',async()=>{
 fixture();mocks.manager.mockImplementationOnce(()=>{throw Error('EXTERNAL_RESOURCE_REJECTED');});
 await expect(loadGpuModel(three,renderer,bytes,new AbortController().signal,budget)).rejects.toThrow('EXTERNAL_RESOURCE_REJECTED');expect(mocks.caps).not.toHaveBeenCalled();expect(mocks.prepare).not.toHaveBeenCalled();
 const f=fixture();mocks.caps.mockResolvedValueOnce({astcSupported:false,bptcSupported:false});
 await expect(loadGpuModel(three,renderer,bytes,new AbortController().signal,budget)).rejects.toThrow('GPU_MODEL_UNSUPPORTED');expect(mocks.prepare).not.toHaveBeenCalled();expect(f.backing.retire).toHaveBeenCalledOnce();
});
test('awaits actual children, then worker retirement before returning',async()=>{
 const f=fixture(),child=deferred(),worker=deferred();let returned=false;
 f.backing.drain.mockImplementationOnce(async()=>{await child.promise;f.events.push('children-settled');});
 f.worker.dispose.mockImplementationOnce(async()=>{f.events.push('worker-start');await worker.promise;f.events.push('worker-settled');});
 const pending=loadGpuModel(three,renderer,bytes,new AbortController().signal,budget).then(value=>{returned=true;return value;});
 await vi.waitFor(()=>expect(f.parse).toHaveBeenCalledOnce());expect(returned).toBe(false);expect(f.worker.dispose).not.toHaveBeenCalled();
 child.resolve();await vi.waitFor(()=>expect(f.worker.dispose).toHaveBeenCalledOnce());expect(returned).toBe(false);worker.resolve();await pending;expect(returned).toBe(true);
});
test('invalid actual transcode format retires all collected resources and backing after child drain',async()=>{
 const f=fixture(three.RGBA_ETC2_EAC_Format);
 await expect(loadGpuModel(three,renderer,bytes,new AbortController().signal,budget)).rejects.toThrow('GPU_MODEL_TEXTURE_FORMAT');
 for(const value of [f.geometry,f.material,f.base,f.normal,f.ao])expect(value.dispose).toHaveBeenCalledOnce();
 expect(f.events.indexOf('close-callbacks')).toBeLessThan(f.events.lastIndexOf('children'));expect(f.events.lastIndexOf('children')).toBeLessThan(f.events.indexOf('worker'));expect(f.events.at(-1)).toBe('retire-backing');
});
test('accepts actual BC7 but rejects missing mips and conservative resident overflow',async()=>{
 fixture(three.RGBA_BPTC_Format);await expect(loadGpuModel(three,renderer,bytes,new AbortController().signal,budget)).resolves.toMatchObject({targetFormat:'bc7'});
 const f=fixture();f.base.mipmaps.pop();await expect(loadGpuModel(three,renderer,bytes,new AbortController().signal,budget)).rejects.toThrow('GPU_MODEL_TEXTURE_MIPS');
 fixture();await expect(loadGpuModel(three,renderer,bytes,new AbortController().signal,{...budget,maxCacheBytes:1})).rejects.toThrow('MODEL_RESIDENT_BUDGET');
});
test('abort after parse closes callbacks and awaits child drain before stopping worker',async()=>{
 const f=fixture(),controller=new AbortController(),child=deferred();
 f.parse.mockImplementationOnce(async()=>{controller.abort();return {scene:f.object};});f.backing.drain.mockImplementationOnce(()=>child.promise);
 const pending=loadGpuModel(three,renderer,bytes,controller.signal,budget);void pending.catch(()=>{});
 await vi.waitFor(()=>expect(f.backing.dispose).toHaveBeenCalled());expect(f.worker.dispose).not.toHaveBeenCalled();child.resolve();
 await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(f.worker.dispose).toHaveBeenCalledOnce();expect(f.backing.retire).toHaveBeenCalledOnce();
});
test('unacknowledged failed setup remains release-unconfirmed despite known manager cleanup',async()=>{
 const f=fixture();mocks.prepare.mockImplementationOnce(async(_r,_b,_s,potential)=>{potential(true);throw Error('SETUP_FAILED');});
 await expect(loadGpuModel(three,renderer,bytes,new AbortController().signal,budget)).rejects.toBeInstanceOf(AssetReleaseUnconfirmedError);expect(f.backing.retire).toHaveBeenCalledOnce();
 mocks.prepare.mockImplementationOnce(async(_r,_b,_s,potential)=>{potential(true);potential(false);throw Error('SETUP_FAILED');});
 await expect(loadGpuModel(three,renderer,bytes,new AbortController().signal,budget)).rejects.toThrow('SETUP_FAILED');
});
test('failed positive cleanup or worker retirement cannot grant fallback; attempts other resources',async()=>{
 const f=fixture(three.RGBA_ETC2_EAC_Format);vi.mocked(f.geometry.dispose).mockImplementationOnce(()=>{throw undefined;});
 await expect(loadGpuModel(three,renderer,bytes,new AbortController().signal,budget)).rejects.toBeInstanceOf(AssetReleaseUnconfirmedError);expect(f.material.dispose).toHaveBeenCalledOnce();expect(f.backing.retire).toHaveBeenCalledOnce();
 const g=fixture();g.worker.dispose.mockRejectedValueOnce(Error('WORKER_RELEASE'));
 await expect(loadGpuModel(three,renderer,bytes,new AbortController().signal,budget)).rejects.toBeInstanceOf(AssetReleaseUnconfirmedError);expect(g.worker.dispose).toHaveBeenCalledOnce();expect(g.backing.retire).toHaveBeenCalledOnce();
 const h=fixture(three.RGBA_ETC2_EAC_Format);h.backing.cleanupOK.mockReturnValueOnce(false);
 await expect(loadGpuModel(three,renderer,bytes,new AbortController().signal,budget)).rejects.toBeInstanceOf(AssetReleaseUnconfirmedError);
});

test('actual format must be filtered-supported and preserve raw linear roles',async()=>{
 fixture(three.RGBA_BPTC_Format);mocks.caps.mockResolvedValueOnce({astcSupported:true,bptcSupported:false});
 await expect(loadGpuModel(three,renderer,bytes,new AbortController().signal,budget)).rejects.toThrow('GPU_MODEL_TEXTURE_FORMAT');
 const f=fixture();f.normal.colorSpace=three.SRGBColorSpace;
 await expect(loadGpuModel(three,renderer,bytes,new AbortController().signal,budget)).rejects.toThrow('GPU_MODEL_TEXTURE_ROLE');expect(f.material.dispose).toHaveBeenCalledOnce();
});
test('actual model triangle and texture ceilings still reject after collecting complete cleanup owners',async()=>{
 const f=fixture();await expect(loadGpuModel(three,renderer,bytes,new AbortController().signal,budget,1)).rejects.toThrow('MODEL_TRIANGLE_BUDGET');expect(f.geometry.dispose).toHaveBeenCalledOnce();
 fixture();await expect(loadGpuModel(three,renderer,bytes,new AbortController().signal,{...budget,maxTextureSize:256})).rejects.toThrow('GPU_MODEL_TEXTURE_BUDGET');
});
