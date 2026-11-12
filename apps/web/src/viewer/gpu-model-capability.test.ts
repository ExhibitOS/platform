// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {RGBA_ASTC_4x4_Format,RGBA_ASTC_8x8_Format,RGBA_BPTC_Format,RGBA_ETC2_EAC_Format,RGBAFormat,type WebGLRenderer} from 'three';
import {KTX2Loader} from 'three/addons/loaders/KTX2Loader.js';
import {gpuModelCapability,gpuModelRecipeFormat} from './gpu-model-capability';

const ASTC='WEBGL_compressed_texture_astc',BC7='EXT_texture_compression_bptc';
const ETC2='WEBGL_compressed_texture_etc',ETC1='WEBGL_compressed_texture_etc1',DXT='WEBGL_compressed_texture_s3tc';
function renderer(...supported:string[]):WebGLRenderer{
  return {extensions:{has:(name:string)=>supported.includes(name),get:()=>({getSupportedProfiles:()=>['ldr']})}} as unknown as WebGLRenderer;
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

it('leaves the original representation eligible when only other compression formats exist, without starting or disposing a loader',async()=>{
  vi.stubGlobal('navigator',{platform:'MacIntel',userAgent:'synthetic'});
  const init=vi.spyOn(KTX2Loader.prototype,'init').mockImplementation(()=>{throw Error('unexpected init');});
  const dispose=vi.spyOn(KTX2Loader.prototype,'dispose').mockImplementation(()=>{throw Error('unexpected dispose');});
  const fetch=vi.fn(()=>{throw Error('unexpected fetch');}),worker=vi.fn(()=>{throw Error('unexpected worker');});
  vi.stubGlobal('fetch',fetch);vi.stubGlobal('Worker',worker);
  expect(await gpuModelCapability(renderer(ETC1,ETC2,DXT))).toEqual({astcSupported:false,bptcSupported:false});
  expect(await gpuModelCapability(renderer())).toEqual({astcSupported:false,bptcSupported:false});
  for(const call of [init,dispose,fetch,worker])expect(call).not.toHaveBeenCalled();
});
it('reports ASTC and BC7 independently from the actual pinned detector',async()=>{
  vi.stubGlobal('navigator',{platform:'MacIntel',userAgent:'synthetic'});
  expect(await gpuModelCapability(renderer(ASTC))).toEqual({astcSupported:true,bptcSupported:false});
  expect(await gpuModelCapability(renderer(BC7))).toEqual({astcSupported:false,bptcSupported:true});
});
it('preserves the pinned Linux emulation filter rather than trusting the raw ASTC extension',async()=>{
  vi.stubGlobal('navigator',{platform:'Linux x86_64',userAgent:'synthetic Linux'});
  expect(await gpuModelCapability(renderer(ASTC,BC7,ETC1,ETC2,DXT))).toEqual({astcSupported:false,bptcSupported:true});
  expect(await gpuModelCapability(renderer(ASTC))).toEqual({astcSupported:true,bptcSupported:false});
});
it('preserves the detector Android exception to the Linux emulation filter',async()=>{
  vi.stubGlobal('navigator',{platform:'Linux armv8l',userAgent:'synthetic Android'});
  expect(await gpuModelCapability(renderer(ASTC,BC7,ETC2,DXT))).toEqual({astcSupported:true,bptcSupported:true});
});
it('admits only actual ASTC4x4 or BC7 output, rejecting raw and other compressed formats',()=>{
  expect(gpuModelRecipeFormat(RGBA_ASTC_4x4_Format)).toBe(true);
  expect(gpuModelRecipeFormat(RGBA_BPTC_Format)).toBe(true);
  for(const format of [RGBAFormat,RGBA_ASTC_8x8_Format,RGBA_ETC2_EAC_Format,0,NaN,Infinity])expect(gpuModelRecipeFormat(format)).toBe(false);
});
