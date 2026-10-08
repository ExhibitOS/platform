import {describe,it,expect,vi} from 'vitest';
import {LoadingManager} from 'three';
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
