// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import * as three from 'three';
import {loadGpuModel} from './gpu-model-loader';
import {completeDetailCommands} from './detail-command-completion';
import {AssetPeakBudget,AssetReleaseUnconfirmedError,DEVICE_BUDGETS,modelDecodeReserve} from './loading';
import {mountGpuCandidatePreview} from './gpu-candidate-preview-renderer';

const state=vi.hoisted(()=>({canvas:undefined as unknown,renderer:undefined as unknown,ledger:undefined as unknown,draw:true,lost:false,failDispose:false,events:[] as string[],resize:undefined as undefined|(()=>void)}));
vi.mock('./gpu-model-loader',()=>({loadGpuModel:vi.fn()}));
vi.mock('./detail-command-completion',()=>({completeDetailCommands:vi.fn(async()=>{state.events.push('fence');})}));
vi.mock('./loading',async importOriginal=>{
  const actual=await importOriginal<typeof import('./loading')>();
  return {...actual,AssetPeakBudget:class extends actual.AssetPeakBudget {
    constructor(...args:ConstructorParameters<typeof actual.AssetPeakBudget>){super(...args);state.ledger=this;}
  }};
});
vi.mock('three',async importOriginal=>{
  const actual=await importOriginal<typeof import('three')>();
  return {...actual,WebGLRenderer:class {
    domElement=state.canvas;constructor(){state.renderer=this;}
    setPixelRatio=vi.fn();setSize=vi.fn();getRenderTarget(){return null;}
    getContext(){return {isContextLost:()=>state.lost,fenceSync(){}};}
    render(scene:three.Scene,camera:three.Camera){state.events.push('draw');if(state.draw)scene.traverse(node=>{if(node instanceof actual.Mesh){const material=Array.isArray(node.material)?node.material[0]!:node.material;node.onAfterRender(this as unknown as three.WebGLRenderer,scene,camera,node.geometry,material,null as never);}});}
    dispose(){state.events.push('renderer');if(state.failDispose)throw undefined;}forceContextLoss(){state.events.push('lose');}
  }};
});
vi.mock('three/addons/controls/OrbitControls.js',()=>({OrbitControls:class {
  target={set(){}};update(){}addEventListener(){}removeEventListener(){}dispose(){state.events.push('controls');}
}}));

function environment(){
  let serial=0;const frames=new Map<number,FrameRequestCallback>(),rect={width:320,height:240,left:0,top:0,right:320,bottom:240};
  const win={innerWidth:1024,innerHeight:768,getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),requestAnimationFrame:(fn:FrameRequestCallback)=>{frames.set(++serial,fn);return serial;},cancelAnimationFrame:(id:number)=>{frames.delete(id);}};
  const doc=Object.assign(new EventTarget(),{hidden:false,defaultView:win});
  const canvas=Object.assign(new EventTarget(),{style:{},tabIndex:-1,isConnected:false,getBoundingClientRect:()=>rect,remove(){this.isConnected=false;state.events.push('canvas');}});
  const host={ownerDocument:doc,isConnected:true,parentElement:null,closest:()=>null,getBoundingClientRect:()=>rect,appendChild(){canvas.isConnected=true;}};
  state.canvas=canvas;
  vi.stubGlobal('ResizeObserver',class {constructor(fn:()=>void){state.resize=fn;}observe(){}disconnect(){state.events.push('observer');}});
  const flush=async()=>{await vi.waitFor(()=>expect(frames.size).toBeGreaterThan(0));const [id,fn]=frames.entries().next().value!;frames.delete(id);fn(1);await Promise.resolve();};
  return {host:host as unknown as HTMLElement,doc,canvas,frames,rect,flush};
}
function asset(){
  const geometry=new three.BoxGeometry(1,1,1),texture=new three.CompressedTexture([],512,512,three.RGBA_ASTC_4x4_Format),material=new three.MeshStandardMaterial({map:texture});
  const object=new three.Mesh(geometry,material),backing={dispose:vi.fn(()=>{state.events.push('backing-close');}),drain:vi.fn(async()=>{state.events.push('drain');}),retire:vi.fn(()=>{state.events.push('backing-retire');}),cleanupOK:()=>true};
  const resource={dispose:vi.fn(()=>{state.events.push('resource');})};
  return {object,resources:[resource],resource,backing,targetFormat:'astc-4x4' as const};
}
// Real GLB header/layout for the existing decode estimator, not a decoder or
// visual fixture. PNG/KTX dimensions are accounted before the mocked decoder.
function headerBytes(extraBinBytes=0){
  const binLength=160+extraBinBytes,views=[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:28},{buffer:0,byteOffset:64,byteLength:40},{buffer:0,byteOffset:104,byteLength:28},{buffer:0,byteOffset:132,byteLength:28}];
  const doc={asset:{version:'2.0'},buffers:[{byteLength:binLength}],bufferViews:views,accessors:[{bufferView:0,count:3,type:'VEC3',componentType:5126}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],images:[{mimeType:'image/png',bufferView:1},{mimeType:'image/ktx2',bufferView:2},{mimeType:'image/png',bufferView:3},{mimeType:'image/png',bufferView:4}],textures:[{source:0,extensions:{KHR_texture_basisu:{source:1}}},{source:2},{source:3}]};
  const json=new TextEncoder().encode(JSON.stringify(doc)),length=Math.ceil(json.length/4)*4,bytes=new ArrayBuffer(28+length+binLength),v=new DataView(bytes);
  v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,bytes.byteLength,true);v.setUint32(12,length,true);v.setUint32(16,0x4e4f534a,true);new Uint8Array(bytes,20,length).fill(32);new Uint8Array(bytes,20,json.length).set(json);v.setUint32(20+length,binLength,true);v.setUint32(24+length,0x004e4942,true);
  for(const index of [1,3,4]){const at=28+length+views[index]!.byteOffset;v.setUint32(at+16,512);v.setUint32(at+20,512);}
  const ktx=28+length+64;v.setUint32(ktx+20,512,true);v.setUint32(ktx+24,512,true);v.setUint32(ktx+36,1,true);return bytes;
}
const ledger=()=>state.ledger as AssetPeakBudget;
const input=(host:HTMLElement,signal=new AbortController().signal)=>({host,signal,bytes:headerBytes(),maxTriangles:200000,onInvalidated:vi.fn()});
beforeEach(()=>{state.draw=true;state.lost=false;state.failDispose=false;state.ledger=undefined;state.events=[];vi.mocked(loadGpuModel).mockReset();vi.mocked(completeDetailCommands).mockReset().mockImplementation(async()=>{state.events.push('fence');});});
afterEach(()=>{vi.unstubAllGlobals();});

it('acknowledges a real candidate mesh submission only after RAF and keeps authored material and metric scale',async()=>{
  const env=environment(),a=asset();vi.mocked(loadGpuModel).mockResolvedValue(a as unknown as Awaited<ReturnType<typeof loadGpuModel>>);
  const pending=mountGpuCandidatePreview(input(env.host));await env.flush();const preview=await pending;
  expect(preview).toMatchObject({targetFormat:'astc-4x4',drawGeneration:1});expect(preview.valid()).toBe(true);
  expect(a.object.material.opacity).toBe(1);expect(a.object.material.transparent).toBe(false);expect(a.object.scale.toArray()).toEqual([1,1,1]);
  const call=vi.mocked(loadGpuModel).mock.calls[0]!;expect(call[4].maxCacheBytes).toBe(96*1024*1024-320*240*16);expect(call[5]).toBe(100000);
  const first=preview.retire();expect(preview.retire()).toBe(first);await first;expect(preview.valid()).toBe(false);
  expect(ledger().total()).toBe(0);
  expect(state.events.indexOf('drain')).toBeLessThan(state.events.indexOf('resource'));expect(state.events.indexOf('resource')).toBeLessThan(state.events.indexOf('fence'));expect(state.events.indexOf('fence')).toBeLessThan(state.events.indexOf('renderer'));expect(state.events.at(-1)).toBe('canvas');
});
it('does not ACK when renderer returns without drawing candidate geometry',async()=>{
  const env=environment(),a=asset();state.draw=false;vi.mocked(loadGpuModel).mockResolvedValue(a as unknown as Awaited<ReturnType<typeof loadGpuModel>>);
  const pending=mountGpuCandidatePreview(input(env.host));const result=expect(pending).rejects.toThrow('GPU_PREVIEW_NO_CANDIDATE_DRAW');await env.flush();await result;
  expect(a.resource.dispose).toHaveBeenCalledOnce();expect(state.events).toContain('renderer');
});
it('cancels during decode but waits for its owned result before rejecting and retiring the renderer',async()=>{
  const env=environment(),a=asset(),controller=new AbortController();let finish!:(value:Awaited<ReturnType<typeof loadGpuModel>>)=>void;
  vi.mocked(loadGpuModel).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=mountGpuCandidatePreview(input(env.host,controller.signal));let settled=false;void pending.catch(()=>{settled=true;});
  await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));controller.abort();await Promise.resolve();expect(settled).toBe(false);expect(state.events).not.toContain('renderer');
  expect(ledger().reservationBytes('candidate')).toBeGreaterThan(0);
  finish(a as unknown as Awaited<ReturnType<typeof loadGpuModel>>);await expect(pending).rejects.toThrow();expect(a.resource.dispose).toHaveBeenCalledOnce();expect(state.events).toContain('fence');
  expect(ledger().total()).toBe(0);
});
it('invalidates an acknowledged preview on hidden document without relying on window focus',async()=>{
  const env=environment(),a=asset(),options=input(env.host);vi.mocked(loadGpuModel).mockResolvedValue(a as unknown as Awaited<ReturnType<typeof loadGpuModel>>);
  const pending=mountGpuCandidatePreview(options);await env.flush();const preview=await pending;
  env.doc.hidden=true;env.doc.dispatchEvent(new Event('visibilitychange'));expect(preview.valid()).toBe(false);expect(options.onInvalidated).toHaveBeenCalledExactlyOnceWith('hidden');await preview.retire();
});
it('reports post-ready context loss and retains a rejected cleanup receipt while attempting every teardown',async()=>{
  const env=environment(),a=asset(),options=input(env.host);vi.mocked(loadGpuModel).mockResolvedValue(a as unknown as Awaited<ReturnType<typeof loadGpuModel>>);
  const pending=mountGpuCandidatePreview(options);await env.flush();const preview=await pending;
  vi.mocked(completeDetailCommands).mockRejectedValue(Error('context lost'));state.lost=true;env.canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true}));
  expect(options.onInvalidated).toHaveBeenCalledExactlyOnceWith('context-lost');const receipt=preview.retire();await expect(receipt).rejects.toBeInstanceOf(AssetReleaseUnconfirmedError);expect(preview.retire()).toBe(receipt);expect(state.events).toContain('renderer');expect(state.events).toContain('lose');expect(state.events).toContain('canvas');
});
it('retains resource cleanup rejection even when renderer teardown succeeds',async()=>{
  const env=environment(),a=asset();a.resource.dispose.mockImplementation(()=>{throw Error('uncertain resource');});vi.mocked(loadGpuModel).mockResolvedValue(a as unknown as Awaited<ReturnType<typeof loadGpuModel>>);
  const pending=mountGpuCandidatePreview(input(env.host));await env.flush();const preview=await pending;await expect(preview.retire()).rejects.toBeInstanceOf(AssetReleaseUnconfirmedError);expect(state.events).toContain('fence');expect(state.events).toContain('renderer');expect(state.events.at(-1)).toBe('canvas');
});
it('refuses hidden or offscreen hosts before decoding and cleans the partial canvas',async()=>{
  const env=environment();env.rect.left=2000;env.rect.right=2320;
  await expect(mountGpuCandidatePreview(input(env.host))).rejects.toThrow('GPU_PREVIEW_HIDDEN');expect(loadGpuModel).not.toHaveBeenCalled();expect(env.canvas.isConnected).toBe(false);
});
it.each(['renderer','resource'])('retains falsy %s cleanup failure and still attempts remaining teardown',async kind=>{
  const env=environment(),a=asset();if(kind==='renderer')state.failDispose=true;else a.resource.dispose.mockImplementation(()=>{throw 0;});
  vi.mocked(loadGpuModel).mockResolvedValue(a as unknown as Awaited<ReturnType<typeof loadGpuModel>>);
  const pending=mountGpuCandidatePreview(input(env.host));await env.flush();const preview=await pending;
  const receipt=preview.retire();await expect(receipt).rejects.toBeInstanceOf(AssetReleaseUnconfirmedError);expect(preview.retire()).toBe(receipt);
  expect(ledger().reservationBytes('candidate')).toBeGreaterThan(0);
  expect(state.events).toContain('renderer');expect(state.events).toContain('lose');expect(state.events).toContain('canvas');
});
it('holds retirement until embedded children drain before the command fence and canvas disposal',async()=>{
  const env=environment(),a=asset();let finish!:()=>void;
  a.backing.drain.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
  vi.mocked(loadGpuModel).mockResolvedValue(a as unknown as Awaited<ReturnType<typeof loadGpuModel>>);
  const pending=mountGpuCandidatePreview(input(env.host));await env.flush();const preview=await pending;
  const receipt=preview.retire();await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));expect(state.events).not.toContain('fence');expect(state.events).not.toContain('renderer');
  expect(ledger().reservationBytes('candidate')).toBeGreaterThan(0);
  finish();await receipt;expect(state.events).toContain('fence');expect(state.events).toContain('renderer');
  expect(ledger().total()).toBe(0);
});
it('rejects an encoded/header decode peak near the cap before invoking the shared decoder',async()=>{
  const env=environment(),options={...input(env.host),bytes:headerBytes(19*1024*1024)};
  expect(options.bytes.byteLength).toBeLessThan(33554432);
  expect(modelDecodeReserve(options.bytes.byteLength,DEVICE_BUDGETS.desktop!,options.bytes,512,'complete')+320*240*16).toBeGreaterThan(96*1024*1024);
  await expect(mountGpuCandidatePreview(options)).rejects.toThrow('ASSET_TRANSITION_PEAK');expect(loadGpuModel).not.toHaveBeenCalled();expect(env.canvas.isConnected).toBe(false);
});
it('rejects a malformed actual GLB accounting header before invoking the shared decoder',async()=>{
  const env=environment(),options=input(env.host);new DataView(options.bytes).setUint32(0,0,true);
  await expect(mountGpuCandidatePreview(options)).rejects.toThrow('DECODE_BUDGET_EXCEEDED');expect(loadGpuModel).not.toHaveBeenCalled();
});
it('retains the conservative decode charge until submitted commands positively complete',async()=>{
  const env=environment(),a=asset();vi.mocked(loadGpuModel).mockResolvedValue(a as unknown as Awaited<ReturnType<typeof loadGpuModel>>);
  const pending=mountGpuCandidatePreview(input(env.host));await env.flush();const preview=await pending;
  let finish!:()=>void;vi.mocked(completeDetailCommands).mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
  const receipt=preview.retire();await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
  expect(ledger().reservationBytes('candidate')).toBeGreaterThan(0);expect(state.events).not.toContain('renderer');
  finish();await receipt;expect(ledger().total()).toBe(0);
});
