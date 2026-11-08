// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {createHayesDetailJpegDecoder,type HayesDetailJpegDescriptor} from './detail-embedded-jpeg';
const sourceSha256='e66715a51c9cad0b904d2715d5b27fb80b97d43fe8c2a3cd10276c1b336a2cf6',imageSha256='b664100de1942a37e8e033b1fb4d21a60f9e07226e18e96e3b5910f591f5980f';
const descriptor:HayesDetailJpegDescriptor={sourceSha256,imageIndex:0,bufferView:4,byteOffset:4558464,encodedBytes:1803167,imageSha256,width:4096,height:4096,channels:3};
const hashBytes=(hash:string)=>Uint8Array.from(hash.match(/../g)!.map(v=>parseInt(v,16))).buffer;
const bytes=()=>{const value=new Uint8Array(descriptor.encodedBytes);value.set([0xff,0xd8]);value.set([0xff,0xd9],value.length-2);return value;};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return {promise,resolve};}
afterEach(()=>vi.unstubAllGlobals());
it('admits only the exact descriptor and snapshot; the decoder owns its bitmap until disposal',async()=>{
 const digest=vi.fn(async()=>hashBytes(imageSha256)),bitmap={width:4096,height:4096,close:vi.fn()} as unknown as ImageBitmap,decode=vi.fn(async()=>bitmap);vi.stubGlobal('crypto',{subtle:{digest}});vi.stubGlobal('createImageBitmap',decode);
 const owner=new AbortController(),scope=createHayesDetailJpegDecoder(owner.signal),input=bytes();
 for(const change of [{sourceSha256:'x'},{imageIndex:'0' as unknown as number},{imageIndex:-1},{imageIndex:0.5},{imageIndex:2},{bufferView:5},{byteOffset:0},{encodedBytes:1},{imageSha256:'x'},{width:1},{height:1},{channels:1}])await expect(scope.decode({...descriptor,...change},input)).rejects.toThrow('DETAIL_HAYES_DECODE_UNAVAILABLE');
 expect(digest).not.toHaveBeenCalled();expect(decode).not.toHaveBeenCalled();expect(await scope.decode(descriptor,input)).toBe(bitmap);
 expect(decode).toHaveBeenCalledWith(expect.any(Blob),{imageOrientation:'none',premultiplyAlpha:'none',colorSpaceConversion:'none'});await expect(scope.decode(descriptor,input)).rejects.toThrow('DETAIL_HAYES_DECODE_UNAVAILABLE');await expect(scope.decode({...descriptor,imageIndex:'0' as unknown as number},input)).rejects.toThrow('DETAIL_HAYES_DECODE_UNAVAILABLE');await expect(scope.drain()).rejects.toThrow('DETAIL_HAYES_NOT_DISPOSED');scope.dispose();scope.dispose();await scope.drain();expect(bitmap.close).toHaveBeenCalledOnce();
});
it('verifies a detached input snapshot before starting native decode',async()=>{
 const gate=deferred<ArrayBuffer>(),digest=vi.fn((algorithm:string,snapshot:Uint8Array)=>{void algorithm;void snapshot;return gate.promise;}),decode=vi.fn();vi.stubGlobal('crypto',{subtle:{digest}});vi.stubGlobal('createImageBitmap',decode);const owner=new AbortController(),scope=createHayesDetailJpegDecoder(owner.signal),input=bytes(),work=scope.decode(descriptor,input);input[0]=0;expect(digest.mock.calls[0]![1][0]).toBe(0xff);gate.resolve(hashBytes('a'.repeat(64)));await expect(work).rejects.toThrow('DETAIL_HAYES_IMAGE');expect(decode).not.toHaveBeenCalled();scope.dispose();await scope.drain();
});
it('keeps a native decode pending through abort and closes a late bitmap before drain',async()=>{
 const gate=deferred<ImageBitmap>(),bitmap={width:4096,height:4096,close:vi.fn()} as unknown as ImageBitmap;vi.stubGlobal('crypto',{subtle:{digest:async()=>hashBytes(imageSha256)}});const decode=vi.fn(()=>gate.promise);vi.stubGlobal('createImageBitmap',decode);const owner=new AbortController(),scope=createHayesDetailJpegDecoder(owner.signal),work=scope.decode(descriptor,bytes());await vi.waitFor(()=>expect(decode).toHaveBeenCalledOnce());owner.abort();scope.dispose();let drained=false;const drain=scope.drain().then(()=>{drained=true});await Promise.resolve();expect(drained).toBe(false);gate.resolve(bitmap);await expect(work).rejects.toThrow('DETAIL_HAYES_DECODE_UNAVAILABLE');await drain;expect(bitmap.close).toHaveBeenCalledOnce();
});
it('closes a wrong-size bitmap and keeps cleanup uncertain if close fails',async()=>{
 const bitmap={width:10,height:10,close:vi.fn(()=>{throw Error('CLOSE_FAILED')})} as unknown as ImageBitmap;vi.stubGlobal('crypto',{subtle:{digest:async()=>hashBytes(imageSha256)}});vi.stubGlobal('createImageBitmap',async()=>bitmap);const owner=new AbortController(),scope=createHayesDetailJpegDecoder(owner.signal);await expect(scope.decode(descriptor,bytes())).rejects.toThrow('DETAIL_HAYES_DECODE_UNAVAILABLE');scope.dispose();await expect(scope.drain()).rejects.toThrow('DETAIL_HAYES_CLEANUP_UNCERTAIN');expect(bitmap.close).toHaveBeenCalledOnce();
});

it('recognizes each of the three exact embedded image descriptors without changing ordinary GLB loading',async()=>{
 const rows=[{imageIndex:1,bufferView:5,byteOffset:6361631,encodedBytes:640186,imageSha256:'9d9e148bd723bf686000bc6ce96e4235e4c6b26996404d2ca47d8726ca3bef16',channels:1},{imageIndex:2,bufferView:6,byteOffset:7001817,encodedBytes:1379723,imageSha256:'ec036b576c4018fd139de22b833e474e8c3538fb4bab5833c83ed3a35e3ebee8',channels:3}];
 vi.stubGlobal('crypto',{subtle:{digest:async(_algorithm:string,data:Uint8Array)=>hashBytes(rows.find(row=>row.encodedBytes===data.length)!.imageSha256)}});const bitmap={width:4096,height:4096,close:vi.fn()} as unknown as ImageBitmap;vi.stubGlobal('createImageBitmap',async()=>bitmap);const scope=createHayesDetailJpegDecoder(new AbortController().signal);
 for(const row of rows){const data=new Uint8Array(row.encodedBytes);data.set([0xff,0xd8]);data.set([0xff,0xd9],data.length-2);expect(await scope.decode({...descriptor,...row},data)).toBe(bitmap);}
 scope.dispose();await scope.drain();expect(bitmap.close).toHaveBeenCalledOnce();
});
it('waits for in-flight digest after abort and never starts bitmap work',async()=>{
 const gate=deferred<ArrayBuffer>(),digest=vi.fn(()=>gate.promise),decode=vi.fn();vi.stubGlobal('crypto',{subtle:{digest}});vi.stubGlobal('createImageBitmap',decode);const owner=new AbortController(),scope=createHayesDetailJpegDecoder(owner.signal),work=scope.decode(descriptor,bytes());owner.abort();scope.dispose();let drained=false;const done=scope.drain().then(()=>{drained=true});await Promise.resolve();expect(drained).toBe(false);gate.resolve(hashBytes(imageSha256));await expect(work).rejects.toThrow('DETAIL_HAYES_DECODE_UNAVAILABLE');await done;expect(decode).not.toHaveBeenCalled();
});

it('retains an adopted bitmap after abort until the caller explicitly disposes it',async()=>{
 const bitmap={width:4096,height:4096,close:vi.fn()} as unknown as ImageBitmap;vi.stubGlobal('crypto',{subtle:{digest:async()=>hashBytes(imageSha256)}});vi.stubGlobal('createImageBitmap',async()=>bitmap);const owner=new AbortController(),scope=createHayesDetailJpegDecoder(owner.signal);expect(await scope.decode(descriptor,bytes())).toBe(bitmap);owner.abort();expect(bitmap.close).not.toHaveBeenCalled();await expect(scope.drain()).rejects.toThrow('DETAIL_HAYES_NOT_DISPOSED');await expect(scope.decode({...descriptor,imageIndex:1},bytes())).rejects.toThrow('DETAIL_HAYES_DECODE_UNAVAILABLE');scope.dispose();await scope.drain();expect(bitmap.close).toHaveBeenCalledOnce();
});
it('closes a late bitmap after abort even before explicit disposal',async()=>{
 const gate=deferred<ImageBitmap>(),bitmap={width:4096,height:4096,close:vi.fn()} as unknown as ImageBitmap;vi.stubGlobal('crypto',{subtle:{digest:async()=>hashBytes(imageSha256)}});const decode=vi.fn(()=>gate.promise);vi.stubGlobal('createImageBitmap',decode);const owner=new AbortController(),scope=createHayesDetailJpegDecoder(owner.signal),work=scope.decode(descriptor,bytes());await vi.waitFor(()=>expect(decode).toHaveBeenCalledOnce());owner.abort();gate.resolve(bitmap);await expect(work).rejects.toThrow('DETAIL_HAYES_DECODE_UNAVAILABLE');expect(bitmap.close).toHaveBeenCalledOnce();scope.dispose();await scope.drain();expect(bitmap.close).toHaveBeenCalledOnce();
});
