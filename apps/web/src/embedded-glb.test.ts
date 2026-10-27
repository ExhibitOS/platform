import {describe,it,expect,vi} from 'vitest';
import {LoadingManager,Texture} from 'three';
import {embeddedPNGManager} from './embedded-glb.js';
function fixture(document: unknown,bin?: Uint8Array) {
 const text=new TextEncoder().encode(JSON.stringify(document)),n=Math.ceil(text.length/4)*4,b=bin??new Uint8Array(0),result=new ArrayBuffer(20+n+(bin?8+b.length:0)),view=new DataView(result),bytes=new Uint8Array(result);
 view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,result.byteLength,true);view.setUint32(12,n,true);view.setUint32(16,0x4e4f534a,true);bytes.fill(32,20,20+n);bytes.set(text,20);
 if(bin){view.setUint32(20+n,b.length,true);view.setUint32(24+n,0x004e4942,true);bytes.set(b,28+n);}return result;
}
describe('model-local embedded PNG resource boundary',()=>{
 it('preserves original JSON-only and untextured model bytes while refusing every URL',()=>{const input=fixture({asset:{version:'2.0'}}),m=new LoadingManager();const scoped=embeddedPNGManager(m,input);expect(scoped.bytes).toBe(input);scoped.assertLoaded();scoped.dispose();expect(()=>scoped.assertLoaded()).toThrow();for(const url of ['https://example.invalid/a','blob:opaque','data:image/png;base64,AA','file:///secret','relative.png'])expect(()=>m.resolveURL(url)).toThrow('EXTERNAL_RESOURCE_REJECTED');});
 it('rejects external resources and extensions even when nested in extras',()=>{for(const doc of [{asset:{version:'2.0'},buffers:[{uri:'https://example.invalid'}]},{asset:{version:'2.0'},extras:{nested:{uri:'file:///secret'}}},{asset:{version:'2.0'},extensions:{bad:{}}},{asset:{version:'2.0'},extensionsRequired:['bad']}])expect(()=>embeddedPNGManager(new LoadingManager(),fixture(doc))).toThrow('EXTERNAL_RESOURCE_REJECTED');});
 it('rejects malformed image declarations, dimensions and aggregate views without starting an image decoder',()=>{const bin=new Uint8Array(36),v=new DataView(bin.buffer);bin.set([137,80,78,71,13,10,26,10]);v.setUint32(8,13);bin.set(new TextEncoder().encode('IHDR'),12);v.setUint32(16,2048);v.setUint32(20,2048);const doc={asset:{version:'2.0'},buffers:[{byteLength:36}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36}],images:[{bufferView:0,mimeType:'image/png'}]};expect(()=>embeddedPNGManager(new LoadingManager(),fixture(doc,bin))).toThrow('EXTERNAL_RESOURCE_REJECTED');v.setUint32(16,2);v.setUint32(20,2);for(const image of [{bufferView:99,mimeType:'image/png'},{bufferView:0,mimeType:'image/jpeg'},{bufferView:0,mimeType:'image/png',uri:'blob:fake'}])expect(()=>embeddedPNGManager(new LoadingManager(),fixture({...doc,images:[image]},bin))).toThrow('EXTERNAL_RESOURCE_REJECTED');});
});

function imageFixture(){const b=new Uint8Array(36),v=new DataView(b.buffer);b.set([137,80,78,71,13,10,26,10]);v.setUint32(8,13);b.set(new TextEncoder().encode('IHDR'),12);v.setUint32(16,2);v.setUint32(20,2);return fixture({asset:{version:'2.0'},buffers:[{byteLength:36}],bufferViews:[{buffer:0,byteLength:36}],images:[{bufferView:0,mimeType:'image/png'}]},b);}
it('scoped decoder ownership closes successful and late bitmaps, and rejects cached completion after disposal',async()=>{
 const close=vi.fn(),bitmap={close,width:2,height:2} as unknown as ImageBitmap,decode=vi.fn(async(blob: Blob,options?: ImageBitmapOptions)=>{void blob;void options;return bitmap;});vi.stubGlobal('createImageBitmap',decode);
 try{const m=new LoadingManager(),scope=embeddedPNGManager(m,imageFixture()),loader=m.getHandler('exhibitos-embedded-png-0')!;await new Promise((resolve,reject)=>loader.load('exhibitos-embedded-png-0',resolve,undefined,reject));scope.assertLoaded();expect(decode.mock.calls[0]?.[1]).toEqual({imageOrientation:'none',premultiplyAlpha:'none',colorSpaceConversion:'none'});scope.dispose();scope.dispose();expect(close).toHaveBeenCalledTimes(1);
 const lateManager=new LoadingManager(),late=embeddedPNGManager(lateManager,imageFixture());const ended=new Promise((resolve,reject)=>lateManager.getHandler('exhibitos-embedded-png-0')!.load('exhibitos-embedded-png-0',()=>reject(Error('LATE_SUCCESS')),undefined,resolve));late.dispose();await ended;expect(close).toHaveBeenCalledTimes(2);expect(()=>late.assertLoaded()).toThrow();
 }finally{vi.unstubAllGlobals();}
});

function basisFixture(){
 const png=new Uint8Array(36),pv=new DataView(png.buffer);png.set([137,80,78,71,13,10,26,10]);pv.setUint32(8,13);png.set(new TextEncoder().encode('IHDR'),12);pv.setUint32(16,8);pv.setUint32(20,8);
 const ktx=new Uint8Array(224),v=new DataView(ktx.buffer);ktx.set([171,75,84,88,32,50,48,187,13,10,26,10]);for(const [at,n] of [[16,1],[20,8],[24,8],[36,1],[40,1],[48,104],[52,44]])v.setUint32(at!,n!,true);v.setBigUint64(80,160n,true);v.setBigUint64(88,64n,true);v.setBigUint64(96,64n,true);ktx.set(Uint8Array.from('2c0000000000000002002800a601020003030000100000000000000000007f000000000000000000ffffffff'.match(/../g)!,x=>parseInt(x,16)),104);
 const bin=new Uint8Array(260);bin.set(png);bin.set(ktx,36);return fixture({asset:{version:'2.0'},extensionsUsed:['KHR_texture_basisu'],buffers:[{byteLength:260}],bufferViews:[{buffer:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:224}],images:[{bufferView:0,mimeType:'image/png'},{bufferView:1,mimeType:'image/ktx2'}],textures:[{source:0,extensions:{KHR_texture_basisu:{source:1}}}]},bin);
}
it('compressed decoder receives only owned bytes, refuses incomplete/failing textures and disposes late results; unsupported GPU chooses PNG',async()=>{
 const m=new LoadingManager(),parse=vi.fn((_bytes:ArrayBuffer,onLoad:(t:Texture)=>void)=>onLoad(new Texture())),scope=embeddedPNGManager(m,basisFixture(),{parse});expect(()=>scope.assertLoaded()).toThrow();await new Promise((resolve,reject)=>scope.ktx2Loader!.load('exhibitos-embedded-ktx2-1',resolve,undefined,reject));scope.assertLoaded();expect(parse.mock.calls[0]![0].byteLength).toBe(224);scope.dispose();expect(()=>scope.assertLoaded()).toThrow();
 let deliver:((t:Texture)=>void)|undefined;const late=embeddedPNGManager(new LoadingManager(),basisFixture(),{parse:(_b,cb)=>{deliver=cb;}}),failed=vi.fn();late.ktx2Loader!.load('exhibitos-embedded-ktx2-1',()=>{throw Error('LATE_SUCCESS');},undefined,failed);late.dispose();const texture=new Texture(),closed=vi.spyOn(texture,'dispose');deliver!(texture);expect(closed).toHaveBeenCalledOnce();expect(failed).toHaveBeenCalledOnce();
 const close=vi.fn();vi.stubGlobal('createImageBitmap',async()=>({width:8,height:8,close}));try{const fallbackManager=new LoadingManager(),fallback=embeddedPNGManager(fallbackManager,basisFixture());expect(fallback.ktx2Loader).toBeUndefined();await new Promise((resolve,reject)=>fallbackManager.getHandler('exhibitos-embedded-png-0')!.load('exhibitos-embedded-png-0',resolve,undefined,reject));fallback.assertLoaded();fallback.dispose();expect(close).toHaveBeenCalledOnce();}finally{vi.unstubAllGlobals();}
});

function ordinaryThreeRoleFixture(width=2048,colourType=2,alias=false){
 const bin=new Uint8Array(108);for(let i=0;i<3;i++){const at=i*36,v=new DataView(bin.buffer,at,36);bin.set([137,80,78,71,13,10,26,10],at);v.setUint32(8,13);bin.set(new TextEncoder().encode('IHDR'),at+12);v.setUint32(16,width);v.setUint32(20,width);bin[at+24]=8;bin[at+25]=colourType;}
 return fixture({asset:{version:'2.0'},buffers:[{byteLength:108}],bufferViews:[0,1,2].map(i=>({buffer:0,byteOffset:i*36,byteLength:36})),images:[0,1,2].map(bufferView=>({bufferView,mimeType:'image/png'})),textures:[0,1,2].map(source=>({source})),materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}},normalTexture:{index:alias?0:1},occlusionTexture:{index:2}}],meshes:[{primitives:[{material:0}]}]},bin);
}
it('permits bounded RGB three-role full resources with omitted native glTF samplers; other models retain legacy aggregate limits',()=>{
 const input=ordinaryThreeRoleFixture(),scope=embeddedPNGManager(new LoadingManager(),input);expect(scope.bytes.byteLength).toBeGreaterThan(108);scope.dispose();
 for(const input of [ordinaryThreeRoleFixture(2049),ordinaryThreeRoleFixture(2048,6),ordinaryThreeRoleFixture(2048,2,true)])expect(()=>embeddedPNGManager(new LoadingManager(),input)).toThrow('EXTERNAL_RESOURCE_REJECTED');
});
