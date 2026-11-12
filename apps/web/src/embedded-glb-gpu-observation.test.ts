// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,test,vi} from 'vitest';
import {createHash,webcrypto} from 'node:crypto';
import {LoadingManager,Texture} from 'three';
import {embeddedPNGManager} from './embedded-glb';

// Structural container only, matching bounded-mipped-ktx2.test.ts. These blocks
// and PNG headers do not claim encoder, decoder, transcode, or fidelity proof.
function mippedKtx(){
 const sizes=[262144,65536,16384,4096,1024,256,64,16,16,16];
 const dfd=[44,0,0,0,0,0,0,0,2,0,40,0,166,1,2,0,3,3,0,0,16,0,0,0,0,0,0,0,0,0,127,0,0,0,0,0,0,0,0,0,255,255,255,255];
 const bytes=new Uint8Array(368+sizes.reduce((a,b)=>a+b,0)),v=new DataView(bytes.buffer);
 bytes.set([171,75,84,88,32,50,48,187,13,10,26,10]);
 for(const [at,n]of [[16,1],[20,512],[24,512],[36,1],[40,10],[48,320],[52,44]])v.setUint32(at!,n!,true);
 bytes.set(dfd,320);let offset=368;
 for(let i=9;i>=0;i--){v.setBigUint64(80+i*24,BigInt(offset),true);v.setBigUint64(88+i*24,BigInt(sizes[i]!),true);v.setBigUint64(96+i*24,BigInt(sizes[i]!),true);bytes.fill(i+1,offset,offset+sizes[i]!);offset+=sizes[i]!;}
 return bytes;
}
function png(width:number,colourType:number){
 const bytes=new Uint8Array(36),v=new DataView(bytes.buffer);
 bytes.set([137,80,78,71,13,10,26,10]);v.setUint32(8,13);bytes.set(new TextEncoder().encode('IHDR'),12);v.setUint32(16,width);v.setUint32(20,width);bytes[24]=8;bytes[25]=colourType;return bytes;
}
function fixture(change?:(doc:ReturnType<typeof JSON.parse>)=>void,widths=[512,512,512],colours=[2,2,2]){
 const parts=[...widths.map((width,i)=>png(width,colours[i]!)),mippedKtx()],bin=new Uint8Array(parts.reduce((n,b)=>n+b.length,0));
 let offset=0;const views=parts.map(part=>{const view={buffer:0,byteOffset:offset,byteLength:part.length};bin.set(part,offset);offset+=part.length;return view;});
 const doc={asset:{version:'2.0'},buffers:[{byteLength:bin.length}],bufferViews:views,images:parts.map((_part,i)=>({bufferView:i,mimeType:i===3?'image/ktx2':'image/png'})),textures:[{source:0,extensions:{KHR_texture_basisu:{source:3}}},{source:1},{source:2}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}},normalTexture:{index:1},occlusionTexture:{index:2}}],meshes:[{primitives:[{material:0}]}],extensionsUsed:['KHR_texture_basisu']};
 change?.(doc);
 const json=new TextEncoder().encode(JSON.stringify(doc)),n=Math.ceil(json.length/4)*4,bytes=new Uint8Array(28+n+bin.length),v=new DataView(bytes.buffer);
 v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,bytes.length,true);v.setUint32(12,n,true);v.setUint32(16,0x4e4f534a,true);bytes.fill(32,20,20+n);bytes.set(json,20);v.setUint32(20+n,bin.length,true);v.setUint32(24+n,0x004e4942,true);bytes.set(bin,28+n);return bytes.buffer;
}

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
type RecordValue=Record<string,unknown>;
function host(post?:(record:RecordValue)=>void){
 const records:RecordValue[]=[];
 vi.stubGlobal('webkit',{messageHandlers:{exhibitosGPUDecodeObservation:{postMessage(record:RecordValue){records.push(record);post?.(record);}}}});
 vi.stubGlobal('document',{visibilityState:'visible',hasFocus:()=>true});
 vi.stubGlobal('isSecureContext',true);vi.stubGlobal('location',{pathname:'/native-viewport.html'});
 return records;
}
function scope(){const manager=new LoadingManager();return {manager,scope:embeddedPNGManager(manager,fixture(),{parse:vi.fn()},undefined,'gpu-model-v1')};}
function load(manager:LoadingManager,index=2){const key=`exhibitos-embedded-png-${index}`;return new Promise<Texture>((resolve,reject)=>manager.getHandler(key)!.load(key,v=>resolve(v as Texture),undefined,reject));}
function bitmap(){return {width:512,height:512,close:vi.fn()} as unknown as ImageBitmap;}

test('observes the actual Blob and hashes it after the single unchanged decode call',async()=>{
 const records=host(),events:string[]=[],digest=vi.fn(async(...args:Parameters<SubtleCrypto['digest']>)=>{events.push('hash');return webcrypto.subtle.digest(...args);});
 vi.stubGlobal('crypto',{subtle:{digest}});
 let actual:Blob|undefined;
 const decode=vi.fn((blob:Blob,options:ImageBitmapOptions)=>{events.push('decode');actual=blob;expect(records.map(r=>r.phase)).toEqual(['call']);expect(digest).not.toHaveBeenCalled();expect(options).toEqual({imageOrientation:'none',premultiplyAlpha:'none',colorSpaceConversion:'none'});return Promise.resolve(bitmap());});
 vi.stubGlobal('createImageBitmap',decode);
 const f=scope();await load(f.manager);await f.scope.drain();
 await vi.waitFor(()=>expect(records.some(r=>r.phase==='hash')).toBe(true));
 expect(decode).toHaveBeenCalledOnce();expect(events).toEqual(['decode','hash']);
 expect(records.find(r=>r.phase==='call')).toEqual({version:1,phase:'call',callId:0,imageIndex:2,bytes:36,byteOffset:0,bufferBytes:36,blobBytes:36,blobType:'image/png',disposed:false,visibility:'visible',hasFocus:true,secureContext:true,nativeViewportPath:true});
 const expected=createHash('sha256').update(new Uint8Array(await actual!.arrayBuffer())).digest('hex');
 expect(records.find(r=>r.phase==='hash')).toEqual({version:1,phase:'hash',callId:0,imageIndex:2,outcome:'success',sha256:expected});
 expect(records.find(r=>r.phase==='settled')).toEqual({version:1,phase:'settled',callId:0,imageIndex:2,outcome:'success',disposed:false});
 f.scope.dispose();f.scope.retire();
});

test.each(['async','sync'] as const)('preserves original %s rejection, closed first child code and independent observation failure',async mode=>{
 const records=host(),error=Object.assign(Error('private raw URL/token'),{name:'InvalidStateError'});
 vi.stubGlobal('crypto',{subtle:{digest:vi.fn(()=>Promise.reject(Error('private hash error')))}});
 const decode=vi.fn(()=>{if(mode==='sync')throw error;return Promise.reject(error);});vi.stubGlobal('createImageBitmap',decode);
 const f=scope();await expect(load(f.manager)).rejects.toBe(error);await f.scope.drain();
 expect(()=>f.scope.assertLoaded()).toThrow('GPU_MODEL_EMBEDDED_PNG_2_INVALID_STATE_ERROR');
 await vi.waitFor(()=>expect(records.some(r=>r.phase==='hash')).toBe(true));
 expect(records.find(r=>r.phase==='settled')).toMatchObject({outcome:'decoder-error',errorName:'InvalidStateError'});
 expect(records.find(r=>r.phase==='hash')).toMatchObject({outcome:'observation-failed'});
 expect(JSON.stringify(records)).not.toContain('private');expect(decode).toHaveBeenCalledOnce();f.scope.dispose();f.scope.retire();
});

test('does not hold drain or late bitmap cleanup for an unfinished hash',async()=>{
 const records=host();let hashDone!:(value:ArrayBuffer)=>void,decoded!:(value:ImageBitmap)=>void;
 vi.stubGlobal('crypto',{subtle:{digest:()=>new Promise<ArrayBuffer>(resolve=>{hashDone=resolve;})}});
 vi.stubGlobal('createImageBitmap',()=>new Promise<ImageBitmap>(resolve=>{decoded=resolve;}));
 const f=scope(),job=load(f.manager);void job.catch(()=>{});
 await vi.waitFor(()=>expect(hashDone).toBeTypeOf('function'));f.scope.dispose();const image=bitmap();decoded(image);
 await expect(job).rejects.toThrow('EMBEDDED_IMAGE_DISPOSED');await f.scope.drain();f.scope.retire();
 expect(image.close).toHaveBeenCalledOnce();expect(records.some(r=>r.phase==='hash')).toBe(false);
 expect(records.find(r=>r.phase==='settled')).toMatchObject({outcome:'success',disposed:true});
 hashDone(new Uint8Array(32).buffer);await vi.waitFor(()=>expect(records.some(r=>r.phase==='hash')).toBe(true));
});

test('throwing/missing channel cannot alter decode and no handler causes no hash',async()=>{
 host(()=>{throw Error('channel failed');});const digest=vi.fn(async()=>new Uint8Array(32).buffer);
 vi.stubGlobal('crypto',{subtle:{digest}});vi.stubGlobal('createImageBitmap',vi.fn(async()=>bitmap()));
 const a=scope();await load(a.manager);await a.scope.drain();a.scope.dispose();a.scope.retire();
 await vi.waitFor(()=>expect(digest).toHaveBeenCalledOnce());vi.stubGlobal('webkit',undefined);digest.mockClear();
 const b=scope();await load(b.manager);await b.scope.drain();expect(digest).not.toHaveBeenCalled();b.scope.dispose();b.scope.retire();
});

test('keeps simultaneous call IDs distinct and does not observe legacy scopes',async()=>{
 const records=host();vi.stubGlobal('crypto',{subtle:{digest:async()=>new Uint8Array(32).buffer}});vi.stubGlobal('createImageBitmap',vi.fn(async()=>bitmap()));
 const f=scope();await Promise.all([load(f.manager,1),load(f.manager,2)]);await f.scope.drain();
 expect(records.filter(r=>r.phase==='call').map(r=>[r.callId,r.imageIndex])).toEqual([[0,1],[1,2]]);
 f.scope.dispose();f.scope.retire();
 const doc={asset:{version:'2.0'},buffers:[{byteLength:36}],bufferViews:[{buffer:0,byteLength:36}],images:[{bufferView:0,mimeType:'image/png'}]};
 const encoded=new TextEncoder().encode(JSON.stringify(doc)),n=Math.ceil(encoded.length/4)*4,bytes=new Uint8Array(28+n+36),v=new DataView(bytes.buffer);
 v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,bytes.length,true);v.setUint32(12,n,true);v.setUint32(16,0x4e4f534a,true);bytes.fill(32,20,20+n);bytes.set(encoded,20);v.setUint32(20+n,36,true);v.setUint32(24+n,0x004e4942,true);bytes.set(png(2,2),28+n);
 const manager=new LoadingManager(),legacy=embeddedPNGManager(manager,bytes.buffer),count=records.length;
 await load(manager,0);await legacy.drain();expect(records).toHaveLength(count);legacy.dispose();legacy.retire();
});
