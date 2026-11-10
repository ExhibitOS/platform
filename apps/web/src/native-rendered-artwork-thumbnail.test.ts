// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {produceArtworkThumbnail} from './native-artwork-thumbnail';
import {artworkThumbnailSource} from './native-catalog-protocol';
const state=vi.hoisted(()=>({dispose:vi.fn(),lose:vi.fn(),draw:vi.fn()}));
vi.mock('./basis-loader.js',()=>({basisLoader:async()=>({dispose:()=>{}})}));
vi.mock('./embedded-glb.js',()=>({embeddedPNGManager:(_manager:unknown,bytes:ArrayBuffer)=>({bytes,assertLoaded:()=>{},dispose:()=>{}})}));
vi.mock('./viewer/metric-model.js',()=>({centerMetricModel:()=>({object:{},extent:{}}),metricCameraFit:()=>({near:.01,far:100,distance:2})}));
vi.mock('three/addons/loaders/GLTFLoader.js',()=>({GLTFLoader:class {async parseAsync(){return {scene:{traverse:()=>{}}};}}}));
vi.mock('three',()=>({Mesh:class {},WebGLRenderer:class {domElement={};setPixelRatio(){}setSize(){}render(){state.draw();}dispose(){state.dispose();}forceContextLoss(){state.lose();}},LoadingManager:class {},Scene:class {add(){}},Color:class {},HemisphereLight:class {},DirectionalLight:class {position={set:()=>{}};},PerspectiveCamera:class {position={set:()=>({normalize:()=>({multiplyScalar:()=>{}})})};lookAt(){}},SRGBColorSpace:'srgb'}));
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash=async(bytes:Uint8Array<ArrayBuffer>)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
function fixture(){
 const artwork={id:id(1),revision:2,approvedRevision:2,approvedAssetId:id(2),archived:false,assets:[{id:id(2),mime:'model/gltf-binary',state:'approved',sha256:'a'.repeat(64),bytes:28},{id:id(3),mime:'model/gltf-binary',state:'approved',sha256:'b'.repeat(64),bytes:40}]};
 const display=new Uint8Array(32).fill(2),png=new Uint8Array(24).fill(3);
 let mutate=()=>{};
 const canvas={getContext:()=>({drawImage:vi.fn()}),toBlob:(done:(blob:Blob)=>void)=>{mutate();done(new Blob([png],{type:'image/png'}));}};
 vi.stubGlobal('document',{createElement:()=>canvas});
 const fetcher=vi.fn(async(path:string)=>path.includes('/preview?')?new Response(display,{headers:{'content-type':'model/gltf-binary','x-exhibitos-artwork-revision':'2','x-exhibitos-display-copy':'true','x-exhibitos-watermark-mode':'none','x-exhibitos-watermarked':'false'}}):Response.json(path.endsWith('/display')?{id:artwork.id,revision:2}:structuredClone(artwork)));
 vi.stubGlobal('fetch',fetcher);
 const request={version:1 as const,epoch:id(1),sequence:1,tenantId:id(4),principalId:id(5),requestId:id(6),artworkId:artwork.id,expectedRevision:2};
 return {artwork,display,png,request,fetcher,mutate:(fn:()=>void)=>{mutate=fn;}};
}
it('binds actual preview and PNG bytes to the approved primary, retaining the existing renderer disposal',async()=>{
 const f=fixture(),reply=await produceArtworkThumbnail(f.request,new AbortController().signal);
 expect(reply).toMatchObject({sourceAssetId:id(2),sourceSha256:'a'.repeat(64),displaySha256:await hash(f.display),pngSha256:await hash(f.png),modelBytes:32,recipeId:'artwork-glb-card-256-v1',toolId:'exhibitos-three-0.186.1-thumbnail-v1',width:256,height:256});
 expect(reply.pngBase64).toBe(btoa(String.fromCharCode(...f.png)));
 expect(state.draw).toHaveBeenCalledOnce();expect(state.dispose).toHaveBeenCalledOnce();expect(state.lose).toHaveBeenCalledOnce();
 expect(f.fetcher).toHaveBeenCalledTimes(4);
});
it('rechecks approved source after asynchronous PNG encoding and refuses source replacement',async()=>{
 const f=fixture();f.mutate(()=>{f.artwork.assets[0]!.sha256='c'.repeat(64);});
 await expect(produceArtworkThumbnail(f.request,new AbortController().signal)).rejects.toThrow('THUMBNAIL_REVISION');
 expect(state.dispose).toHaveBeenCalledOnce();expect(state.lose).toHaveBeenCalledOnce();
});
it('rejects missing, duplicate, unapproved or invalid primary source metadata',()=>{
 const f=fixture();expect(artworkThumbnailSource(f.artwork,id(1),2)).toMatchObject({sourceAssetId:id(2)});
 for(const value of [{...f.artwork,approvedAssetId:id(99)},{...f.artwork,archived:true},{...f.artwork,assets:[...f.artwork.assets,f.artwork.assets[0]]},{...f.artwork,assets:[{...f.artwork.assets[0],state:'quarantined'}]},{...f.artwork,approvedRevision:1}])expect(()=>artworkThumbnailSource(value,id(1),2)).toThrow('THUMBNAIL_REVISION');
});
