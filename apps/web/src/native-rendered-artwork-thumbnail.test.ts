// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {produceArtworkThumbnail} from './native-artwork-thumbnail';
import {artworkThumbnailFailure,artworkThumbnailFailureV2,artworkThumbnailSource,type ArtworkThumbnailPhase,type ArtworkThumbnailPreviewStep} from './native-catalog-protocol';
import {ARTWORK_THUMBNAIL_PREVIEW_TRACE_HEADER,isThumbnailPreviewTracePage,observeThumbnailPreview} from './native-thumbnail-preview-trace';
const state=vi.hoisted(()=>({dispose:vi.fn(),lose:vi.fn(),draw:vi.fn(),decode:vi.fn()}));
vi.mock('./basis-loader.js',()=>({basisLoader:async()=>({dispose:()=>{}})}));
vi.mock('./embedded-glb.js',()=>({embeddedPNGManager:(_manager:unknown,bytes:ArrayBuffer)=>({bytes,assertLoaded:()=>{},dispose:()=>{}})}));
vi.mock('./viewer/metric-model.js',()=>({centerMetricModel:()=>({object:{},extent:{}}),metricCameraFit:()=>({near:.01,far:100,distance:2})}));
vi.mock('three/addons/loaders/GLTFLoader.js',()=>({GLTFLoader:class {async parseAsync(){state.decode();return {scene:{traverse:()=>{}}};}}}));
vi.mock('three',()=>({Mesh:class {},WebGLRenderer:class {domElement={};setPixelRatio(){}setSize(){}render(){state.draw();}dispose(){state.dispose();}forceContextLoss(){state.lose();}},LoadingManager:class {},Scene:class {add(){}},Color:class {},HemisphereLight:class {},DirectionalLight:class {position={set:()=>{}};},PerspectiveCamera:class {position={set:()=>({normalize:()=>({multiplyScalar:()=>{}})})};lookAt(){}},SRGBColorSpace:'srgb'}));
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.clearAllMocks();});
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash=async(bytes:Uint8Array<ArrayBuffer>)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
function deferred<T>(){
 let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;
 const promise=new Promise<T>((done,fail)=>{resolve=done;reject=fail;});
 return {promise,resolve,reject};
}
function fixture(){
 const artwork={id:id(1),revision:2,approvedRevision:2,approvedAssetId:id(2),archived:false,assets:[{id:id(2),mime:'model/gltf-binary',state:'approved',sha256:'a'.repeat(64),bytes:28},{id:id(3),mime:'model/gltf-binary',state:'approved',sha256:'b'.repeat(64),bytes:40}]};
 const display=new Uint8Array(32).fill(2),png=new Uint8Array(24).fill(3);
 let mutate=()=>{};
 const canvas={getContext:()=>({drawImage:vi.fn()}),toBlob:(done:(blob:Blob)=>void)=>{mutate();done(new Blob([png],{type:'image/png'}));}};
 vi.stubGlobal('document',{createElement:()=>canvas});
 const fetcher=vi.fn<(path:string,options?:RequestInit)=>Promise<Response>>(async path=>path.includes('/preview?')?new Response(display,{headers:{'content-type':'model/gltf-binary','x-exhibitos-artwork-revision':'2','x-exhibitos-display-copy':'true','x-exhibitos-watermark-mode':'none','x-exhibitos-watermarked':'false'}}):Response.json(path.endsWith('/display')?{id:artwork.id,revision:2}:structuredClone(artwork)));
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

it('dispatches one preview with useful budget while metadata is pending and waits before reading it',async()=>{
 const f=fixture(),deadline=new AbortController();
 let now=200;
 vi.spyOn(performance,'now').mockImplementation(()=>now);
 const traced=observeThumbnailPreview(f.request.requestId,deadline.signal,10_000,{monotonicMs:0,unixMs:1234})!;
 const metadata=deferred<Response>();
 const previewHeaders=deferred<void>();
 const fetcher=f.fetcher.getMockImplementation()!;
 const pull=vi.fn((controller:ReadableStreamDefaultController<Uint8Array>)=>{
  controller.enqueue(f.display);controller.close();
 });
 f.fetcher.mockImplementationOnce(()=>metadata.promise).mockImplementationOnce(async(path,options)=>{
  const {headers}=await fetcher(path,options);
  previewHeaders.resolve();
  return new Response(new ReadableStream({pull},{highWaterMark:0}),{headers});
 });

 const reply=produceArtworkThumbnail(f.request,deadline.signal,undefined,traced);
 expect(f.fetcher).toHaveBeenCalledTimes(2);
 expect(f.fetcher.mock.calls[1]?.[0]).toMatch(/\/preview\?expectedRevision=2$/);
 await previewHeaders.promise;
 expect(pull).not.toHaveBeenCalled();
 expect(state.decode).not.toHaveBeenCalled();
 now=3_200;
 metadata.resolve(Response.json(f.artwork));
 expect(await reply).toMatchObject({sourceAssetId:id(2),displaySha256:await hash(f.display),pngSha256:await hash(f.png)});
 expect(pull).toHaveBeenCalledOnce();
 expect(f.fetcher.mock.calls.filter(([path])=>path.includes('/preview?'))).toHaveLength(1);
 expect(traced.result()).toMatchObject({dispatchElapsedMs:200,remainingBudgetEstimateMs:9_800});
});

it('discards an unread preview when the concurrent metadata denies the revision',async()=>{
 const f=fixture(),metadata=deferred<Response>();
 const preview=deferred<Response>();
 const cancel=vi.fn();
 const fetcher=f.fetcher.getMockImplementation()!;
 f.fetcher.mockReturnValueOnce(metadata.promise).mockReturnValueOnce(preview.promise);
 const reply=produceArtworkThumbnail(f.request,new AbortController().signal);
 metadata.resolve(Response.json({...f.artwork,approvedRevision:1}));
 await expect(reply).rejects.toThrow('THUMBNAIL_REVISION');
 const {headers}=await fetcher('/preview?expectedRevision=2');
 preview.resolve(new Response(new ReadableStream({cancel}),{headers}));
 await vi.waitFor(()=>expect(cancel).toHaveBeenCalledOnce());
 expect(state.decode).not.toHaveBeenCalled();
 expect(f.fetcher).toHaveBeenCalledTimes(2);
});

it('keeps metadata failure authoritative when preview rejects first',async()=>{
 const f=fixture(),metadata=deferred<Response>();
 f.fetcher.mockImplementationOnce(()=>metadata.promise).mockRejectedValueOnce(Error('early preview failure'));
 const reply=produceArtworkThumbnail(f.request,new AbortController().signal);
 await Promise.resolve();
 metadata.resolve(Response.json({...f.artwork,archived:true}));
 await expect(reply).rejects.toThrow('THUMBNAIL_REVISION');
 expect(state.decode).not.toHaveBeenCalled();
 expect(f.fetcher).toHaveBeenCalledTimes(2);
});

it('rejects missing, duplicate, unapproved or invalid primary source metadata',()=>{
 const f=fixture();expect(artworkThumbnailSource(f.artwork,id(1),2)).toMatchObject({sourceAssetId:id(2)});
 for(const value of [{...f.artwork,approvedAssetId:id(99)},{...f.artwork,archived:true},{...f.artwork,assets:[...f.artwork.assets,f.artwork.assets[0]]},{...f.artwork,assets:[{...f.artwork.assets[0],state:'quarantined'}]},{...f.artwork,approvedRevision:1}])expect(()=>artworkThumbnailSource(value,id(1),2)).toThrow('THUMBNAIL_REVISION');
});

it.each(['decode','render','encode','verification'] as const)('keeps a %s failure distinct and drains the renderer',async stage=>{
 const f=fixture(),signal=new AbortController().signal;
 let phase:ArtworkThumbnailPhase='preview';
 const fail=()=>{throw Error('private test error');};
 if(stage==='decode')state.decode.mockImplementationOnce(fail);
 if(stage==='render')state.draw.mockImplementationOnce(fail);
 if(stage==='encode')f.mutate(fail);
 if(stage==='verification')f.mutate(()=>{f.artwork.assets[0]!.sha256='c'.repeat(64);});
 await expect(produceArtworkThumbnail(f.request,signal,(...step)=>{phase=step[0];})).rejects.toThrow();
 expect(phase).toBe(stage);
 expect(state.dispose).toHaveBeenCalledOnce();
 expect(state.lose).toHaveBeenCalledOnce();
});

it.each(['metadata','headers','body','digest'] as const)('separates a preview %s timeout before starting the renderer',async expected=>{
 const f=fixture(),deadline=new AbortController();
 const signal=AbortSignal.any([new AbortController().signal,deadline.signal]);
 const reason=new DOMException('private timeout details','TimeoutError');
 const expire=()=>{deadline.abort(reason);throw reason;};
 const fetcher=f.fetcher.getMockImplementation()!;
 const headersWait=deferred<Response>();
 if(expected==='metadata')f.fetcher.mockImplementationOnce(async()=>expire());
 if(expected==='headers'||expected==='body'){
  f.fetcher.mockImplementationOnce(fetcher).mockImplementationOnce(async path=>{
   if(expected==='headers')return headersWait.promise;
   const response=await fetcher(path);
   return new Response(new ReadableStream({pull:expire},{highWaterMark:0}),{headers:response.headers});
  });
 }
 if(expected==='digest')vi.spyOn(crypto.subtle,'digest').mockImplementationOnce(async()=>expire());

 let previewStep:ArtworkThumbnailPreviewStep|undefined;
 await expect(produceArtworkThumbnail(f.request,signal,(...step)=>{
  if(step[0]!=='preview')return;
  previewStep=step[1];
  if(expected==='headers'&&previewStep==='headers'){
   deadline.abort(reason);headersWait.reject(reason);
  }
 })).rejects.toBe(reason);
 expect(previewStep).toBe(expected);
 const v1=artworkThumbnailFailure('preview',reason,signal,deadline.signal);
 expect(v1).toEqual({thumbnailFailure:{version:1,phase:'preview',outcome:'timeout'}});
 expect(artworkThumbnailFailureV2(v1,previewStep!)).toEqual({
  thumbnailFailure:{version:2,phase:'preview',outcome:'timeout',previewStep:expected},
 });
 expect(state.decode).not.toHaveBeenCalled();
 expect(state.draw).not.toHaveBeenCalled();
});

it('adds only the approved preview GET header and preserves the artwork result',async()=>{
 const f=fixture(),deadline=new AbortController();
 const signal=AbortSignal.any([deadline.signal]);
 const original=await produceArtworkThumbnail(f.request,signal);
 const untraced=f.fetcher.mock.calls.slice();
 expect(untraced.every(([,options])=>options?.headers===undefined)).toBe(true);
 f.fetcher.mockClear();
 const clock={monotonicMs:performance.now(),unixMs:1234};
 const traced=observeThumbnailPreview(f.request.requestId,deadline.signal,10_000,clock)!;

 expect(await produceArtworkThumbnail(f.request,signal,undefined,traced)).toEqual(original);
 expect(f.fetcher.mock.calls).toEqual(untraced.map(([path,options])=>[
  path,path.endsWith('/preview?expectedRevision=2')
   ? {...options,headers:{[ARTWORK_THUMBNAIL_PREVIEW_TRACE_HEADER]:f.request.requestId}}
   : options,
 ]));
 expect(traced.result()).toEqual({
  version:1,requestId:f.request.requestId,anchorUnixMs:1234,dispatchElapsedMs:expect.any(Number),
  remainingBudgetEstimateMs:expect.any(Number),terminal:{kind:'headers',elapsedMs:expect.any(Number),status:200},
 });
 const headers=traced.result();
 deadline.abort(new DOMException('late deadline','TimeoutError'));
 traced.settleAbort();
 expect(traced.result()).toBe(headers);
 expect(state.draw).toHaveBeenCalledTimes(2);
});

it('binds a headers wait timeout to the one request without exposing the exception',async()=>{
 const f=fixture(),deadline=new AbortController(),owner=new AbortController();
 const signal=AbortSignal.any([owner.signal,deadline.signal]);
 const clock={monotonicMs:performance.now()-250,unixMs:1234};
 const traced=observeThumbnailPreview(f.request.requestId,deadline.signal,10_000,clock)!;
 const reason=new DOMException('private timeout details','TimeoutError');
 const fetcher=f.fetcher.getMockImplementation()!;
 f.fetcher.mockImplementationOnce(fetcher).mockImplementationOnce(async()=>{
  deadline.abort(reason);
  // The typed terminal is available even before the fetch rejection arrives.
  expect(traced.result()?.terminal).toEqual({kind:'cancelled',elapsedMs:expect.any(Number),reason:'timeout'});
  throw reason;
 });

 await expect(produceArtworkThumbnail(f.request,signal,undefined,traced)).rejects.toBe(reason);
 const safe=traced.result()!;
 expect(safe.dispatchElapsedMs).toBeGreaterThanOrEqual(250);
 expect(safe.remainingBudgetEstimateMs).toBe(10_000-safe.dispatchElapsedMs);
 expect(safe.terminal).toEqual({kind:'cancelled',elapsedMs:expect.any(Number),reason:'timeout'});
 expect(state.decode).not.toHaveBeenCalled();
 expect(f.fetcher).toHaveBeenCalledTimes(2);
});

it('returns the dispatched trace before a delayed observer listener and unresolved fetch finish',async()=>{
 const requestId=id(6),deadline=new AbortController();
 const callbacks:(()=>void)[]=[];
 const signal={
  get aborted(){return deadline.signal.aborted;},
  get reason(){return deadline.signal.reason;},
  addEventListener(...args:[type:string,listener:()=>void]){callbacks.push(args[1]);},
  removeEventListener(){},
 } as unknown as AbortSignal;
 const observation=observeThumbnailPreview(requestId,deadline.signal,10_000,{
  monotonicMs:performance.now()-250,unixMs:1234,
 })!;
 let rejectFetch!:(reason:unknown)=>void;
 const fetcher=vi.fn(()=>new Promise<Response>((_,reject)=>{rejectFetch=reject;}));
 vi.stubGlobal('fetch',fetcher);
 const cancelled=new Promise<never>((_,reject)=>signal.addEventListener('abort',()=>{
  observation.settleAbort();
  reject(signal.reason);
 },{once:true}));
 const body=observation.fetch('/preview?expectedRevision=2',{signal});
 const result=Promise.race([body,cancelled]).then(
  ()=>{throw Error('Expected cancellation while the preview fetch was pending');},
  error=>({
   result:artworkThumbnailFailureV2(artworkThumbnailFailure('preview',error,signal,deadline.signal),'headers'),
   trace:observation.result(),
  }),
 );
 const reason=new DOMException('test deadline','TimeoutError');
 expect(observation.result()).toBeNull();
 expect(callbacks).toHaveLength(2);
 deadline.abort(reason);
 // Deliver the outer callback now and defer the observer's listener until
 // after the wrapper has returned. The fetch remains pending in between.
 callbacks[0]!();
 const wrapped=await result;
 expect(wrapped.result).toEqual({
  thumbnailFailure:{version:2,phase:'preview',previewStep:'headers',outcome:'timeout'},
 });
 expect(wrapped.trace).toEqual({
  version:1,requestId,anchorUnixMs:1234,dispatchElapsedMs:expect.any(Number),
  remainingBudgetEstimateMs:expect.any(Number),terminal:{kind:'cancelled',elapsedMs:expect.any(Number),reason:'timeout'},
 });
 expect(wrapped.trace!.dispatchElapsedMs).toBeGreaterThanOrEqual(250);
 expect(wrapped.trace!.remainingBudgetEstimateMs).toBe(10_000-wrapped.trace!.dispatchElapsedMs);
 callbacks[1]!();
 rejectFetch(reason);
 await expect(body).rejects.toBe(reason);
 expect(observation.result()).toBe(wrapped.trace);
 expect(fetcher).toHaveBeenCalledExactlyOnceWith('/preview?expectedRevision=2',{
  signal,headers:{[ARTWORK_THUMBNAIL_PREVIEW_TRACE_HEADER]:requestId},
 });
});

it('keeps the trace inert before an eligible dispatch and on non-native origins',async()=>{
 const f=fixture(),deadline=new AbortController();
 const traced=observeThumbnailPreview(f.request.requestId,deadline.signal,10_000,{monotonicMs:0,unixMs:1234})!;
 const reason=new DOMException('private pre-dispatch cancellation','AbortError');
 deadline.abort(reason);
 await expect(produceArtworkThumbnail(f.request,deadline.signal,undefined,traced)).rejects.toBe(reason);
 traced.settleAbort();
 expect(traced.result()).toBeNull();
 expect(f.fetcher).not.toHaveBeenCalled();
 const native=new URL('http://127.0.0.1:17000/native-viewport.html');
 expect(isThumbnailPreviewTracePage(native)).toBe(true);
 for(const url of ['http://localhost:17000/native-viewport.html','https://127.0.0.1:17000/native-viewport.html',
  'http://127.0.0.1:17000/studio','http://127.0.0.1:80/native-viewport.html']){
  expect(isThumbnailPreviewTracePage(new URL(url))).toBe(false);
 }
});

it('does not arm the trace for coercible IDs or UUIDs outside the Server wire pattern',()=>{
 const requestId=id(6),deadline=new AbortController();
 const clock={monotonicMs:0,unixMs:1234};
 for(const invalid of [[requestId],{toString:()=>requestId},requestId.replace('-4000-','-0000-'),
  requestId.replace('-8000-','-7000-')]){
  expect(observeThumbnailPreview(invalid,deadline.signal,10_000,clock)).toBeUndefined();
 }
 expect(observeThumbnailPreview(requestId,deadline.signal,10_000,clock)).toBeDefined();
});
