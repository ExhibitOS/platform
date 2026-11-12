// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test,vi} from 'vitest';
import type {WebGLRenderer} from 'three';
const basis=vi.hoisted(()=>vi.fn());
vi.mock('../basis-loader',()=>({basisLoader:basis}));
import {prepareArtworkGlb} from './artwork-glb-preparation';
const renderer={} as WebGLRenderer;
const loaderImport=async()=>await import('three/addons/loaders/GLTFLoader.js');
test('uncompressed GLB has no asynchronous Basis ownership',async()=>{
 basis.mockResolvedValueOnce(undefined);const flags:boolean[]=[];
 const result=await prepareArtworkGlb(renderer,new ArrayBuffer(0),new AbortController().signal,value=>flags.push(value),loaderImport);
 expect(result.basis).toBeUndefined();expect(flags).toEqual([true,false]);
});
test('cancellation after Basis setup acknowledges ownership only after confirmed disposal',async()=>{
 const controller=new AbortController(),flags:boolean[]=[],dispose=vi.fn();
 basis.mockImplementationOnce(async()=>{controller.abort();return {dispose};});
 await expect(prepareArtworkGlb(renderer,new ArrayBuffer(0),controller.signal,value=>flags.push(value),loaderImport)).rejects.toMatchObject({name:'AbortError'});
 expect(dispose).toHaveBeenCalledTimes(1);expect(flags).toEqual([true,false]);
});
test('failed Basis cleanup leaves asynchronous ownership uncertain',async()=>{
 const controller=new AbortController(),flags:boolean[]=[];
 basis.mockImplementationOnce(async()=>{controller.abort();return {dispose(){throw Error('cleanup');}};});
 await expect(prepareArtworkGlb(renderer,new ArrayBuffer(0),controller.signal,value=>flags.push(value),loaderImport)).rejects.toThrow('cleanup');
 expect(flags).toEqual([true]);
});

test('new GPU recipe can fall back after positively retired setup, while legacy uncertainty stays unchanged',async()=>{
 const setupError=Error('TRANSCODER_UNAVAILABLE');
 basis.mockImplementation(async(_renderer:unknown,_bytes:unknown,_signal:unknown,retired?:()=>void)=>{retired?.();throw setupError;});
 const confirmed:boolean[]=[];
 await expect(prepareArtworkGlb(renderer,new ArrayBuffer(0),new AbortController().signal,value=>confirmed.push(value),loaderImport,true)).rejects.toBe(setupError);
 expect(confirmed).toEqual([true,false]);
 const legacy:boolean[]=[];
 await expect(prepareArtworkGlb(renderer,new ArrayBuffer(0),new AbortController().signal,value=>legacy.push(value),loaderImport)).rejects.toBe(setupError);
 expect(legacy).toEqual([true]);
 basis.mockReset();
});
test('new GPU setup without a retirement acknowledgement remains uncertain',async()=>{
 basis.mockRejectedValueOnce(Error('CLEANUP_UNCONFIRMED'));const flags:boolean[]=[];
 await expect(prepareArtworkGlb(renderer,new ArrayBuffer(0),new AbortController().signal,value=>flags.push(value),loaderImport,true)).rejects.toThrow('CLEANUP_UNCONFIRMED');
 expect(flags).toEqual([true]);
});
