// SPDX-License-Identifier: AGPL-3.0-or-later
import {beforeEach,afterEach,expect,test,vi} from 'vitest';
import * as three from 'three';
const mocks=vi.hoisted(()=>({manager:vi.fn(),parse:vi.fn(),gpu:vi.fn(),capture:vi.fn(),events:[] as string[]}));
vi.mock('three',async()=>({
  ...await vi.importActual<typeof import('three')>('three'),
  WebGLRenderer:class {dispose(){mocks.events.push('renderer');}forceContextLoss(){mocks.events.push('context');}},
}));
vi.mock('three/addons/loaders/GLTFLoader.js',()=>({GLTFLoader:class {parseAsync=mocks.parse;}}));
vi.mock('./embedded-glb',()=>({embeddedPNGManager:mocks.manager}));
vi.mock('./viewer/gpu-model-loader',()=>({loadGpuModel:mocks.gpu}));
vi.mock('./scene-snapshot',()=>({captureScenePng:mocks.capture,SCENE_SNAPSHOT_RESERVE_BYTES:16}));
vi.mock('./viewer/loading',async()=>({
  ...await vi.importActual<typeof import('./viewer/loading')>('./viewer/loading'),modelDecodeReserve:()=>32,
}));
import {captureRawAsset} from './raw-asset-snapshot';
const bytes=new Uint8Array([1,2,3]).buffer;
const camera={position:[1,2,3] as [number,number,number],target:[0,0,0] as [number,number,number],fov:50};
let sha256:string;
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}
function fixture(){
  const object=new three.Mesh(new three.BoxGeometry(),new three.MeshStandardMaterial({map:new three.Texture()}));
  const resources=[object.geometry,object.material,object.material.map!];
  for(const resource of resources)vi.spyOn(resource,'dispose').mockImplementation(()=>{mocks.events.push('resource');});
  const backing={bytes,dispose:vi.fn(()=>{mocks.events.push('close');}),drain:vi.fn(async()=>{mocks.events.push('drain');}),retire:vi.fn(()=>{mocks.events.push('retire');}),cleanupOK:()=>true,assertLoaded:vi.fn()};
  mocks.manager.mockReturnValue(backing);mocks.parse.mockResolvedValue({scene:object});
  mocks.gpu.mockResolvedValue({object,resources,backing,targetFormat:'bc7'});
  return {object,resources,backing};
}
beforeEach(async()=>{
  vi.resetAllMocks();mocks.events.length=0;
  sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
  vi.stubGlobal('location',{pathname:'/private/nonce'});
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(bytes)));
  mocks.capture.mockResolvedValue({pngBase64:'image',target:{inFrustum:true}});
});
afterEach(()=>vi.unstubAllGlobals());
const input=()=>({role:'candidate' as const,bytes:bytes.byteLength,sha256,camera});
test('legacy reference and candidate retain ordinary PNG path, camera and neutral lights',async()=>{
  for(const role of ['reference','candidate'] as const){
    const f=fixture();
    await expect(captureRawAsset({...input(),role},new AbortController().signal)).resolves.toMatchObject({textureBranch:'embedded-png',targetFormat:null,triangles:12,estimatedPeakBytes:48});
    expect(fetch).toHaveBeenLastCalledWith('/private/nonce/raw/'+role,expect.anything());
    const scene=mocks.capture.mock.lastCall![0];
    expect(scene.target).toBe(f.object);expect(scene.occluders).toBe(f.object);
    expect(scene.camera).toMatchObject({...camera,inspection:true});
    expect(scene.scene.background.getHex()).toBe(0xe5e5e5);
    expect(scene.scene.children[1]).toMatchObject({intensity:2,position:{x:3,y:5,z:4}});
    expect(scene.scene.children[2]).toMatchObject({intensity:1.5});
    expect(f.backing.retire).toHaveBeenCalledOnce();
  }
  expect(mocks.gpu).not.toHaveBeenCalled();
});
test('candidate GPU path uses the existing loader and reports its actual target with identical capture settings',async()=>{
  const f=fixture();
  await expect(captureRawAsset({...input(),profile:'gpu-model-v1'},new AbortController().signal)).resolves.toMatchObject({textureBranch:'gpu-model-v1',targetFormat:'bc7',triangles:12});
  expect(mocks.gpu).toHaveBeenCalledWith(expect.anything(),expect.anything(),bytes,expect.anything(),expect.anything(),expect.any(Number));
  expect(mocks.parse).not.toHaveBeenCalled();expect(mocks.manager).not.toHaveBeenCalled();
  expect(mocks.capture.mock.lastCall![0]).toMatchObject({camera:{...camera,inspection:true},target:f.object});
  expect(mocks.events.indexOf('drain')).toBeLessThan(mocks.events.indexOf('resource'));
  expect(mocks.events.slice(-3)).toEqual(['retire','renderer','context']);
});
test('rejects profile on the reference arm and unverified bytes before either loader',async()=>{
  fixture();
  await expect(captureRawAsset({...input(),role:'reference',profile:'gpu-model-v1'},new AbortController().signal)).rejects.toThrow('AGENT_INPUT_INVALID');
  expect(fetch).not.toHaveBeenCalled();
  await expect(captureRawAsset({...input(),sha256:'0'.repeat(64)},new AbortController().signal)).rejects.toThrow('AGENT_STALE');
  await expect(captureRawAsset({...input(),bytes:4},new AbortController().signal)).rejects.toThrow('AGENT_STALE');
  expect(mocks.parse).not.toHaveBeenCalled();expect(mocks.gpu).not.toHaveBeenCalled();
});
test('unsupported compressed candidate never captures the retained PNG fallback',async()=>{
  fixture();mocks.gpu.mockRejectedValueOnce(Error('GPU_MODEL_UNSUPPORTED'));
  await expect(captureRawAsset({...input(),profile:'gpu-model-v1'},new AbortController().signal)).rejects.toThrow('GPU_MODEL_UNSUPPORTED');
  expect(mocks.parse).not.toHaveBeenCalled();expect(mocks.capture).not.toHaveBeenCalled();
  expect(mocks.events).toEqual(['renderer','context']);
});
test('cancelled capture awaits children and resource retirement before returning rejection',async()=>{
  const f=fixture(),controller=new AbortController(),child=deferred();let returned=false;
  f.backing.drain.mockImplementationOnce(()=>child.promise);
  mocks.capture.mockImplementationOnce(async()=>{controller.abort();throw controller.signal.reason;});
  const pending=captureRawAsset({...input(),profile:'gpu-model-v1'},controller.signal).finally(()=>{returned=true;});void pending.catch(()=>{});
  await vi.waitFor(()=>expect(f.backing.drain).toHaveBeenCalledOnce());
  expect(returned).toBe(false);expect(mocks.events).not.toContain('renderer');
  child.resolve();await expect(pending).rejects.toMatchObject({name:'AbortError'});
  expect(mocks.events.slice(-3)).toEqual(['retire','renderer','context']);
});
test('cleanup failure rejects a captured image while still retiring renderer and context',async()=>{
  const f=fixture();vi.mocked(f.resources[0]!.dispose).mockImplementationOnce(()=>{throw Error('RELEASE');});
  await expect(captureRawAsset({...input(),profile:'gpu-model-v1'},new AbortController().signal)).rejects.toMatchObject({name:'AssetReleaseUnconfirmedError'});
  expect(f.backing.retire).toHaveBeenCalledOnce();expect(mocks.events.slice(-2)).toEqual(['renderer','context']);
});
