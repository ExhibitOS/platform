// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {newDraft} from './drafts/example';
import type {NativeViewportFrame} from './native-viewport-protocol';
import type {ArtworkThumbnailProgress,ThumbnailRequest} from './native-catalog-protocol';
import {catalogBinding} from './native-catalog-protocol';
import type {ThumbnailPreviewObservation} from './native-thumbnail-preview-trace';

const mock=vi.hoisted(()=>({
 artwork:vi.fn<(
  request:ThumbnailRequest,signal:AbortSignal,phase?:ArtworkThumbnailProgress,observation?:ThumbnailPreviewObservation,
 )=>Promise<{pngBase64:string;width:number;height:number}>>(),
 furnishing:vi.fn(async()=>({pngBase64:'AA==',width:256,height:256})),
}));
vi.mock('./native-artwork-thumbnail',()=>({produceArtworkThumbnail:mock.artwork,produceFurnishingThumbnail:mock.furnishing}));
vi.mock('./native-placement',()=>({NativePlacement:class {active=false;rebind(){}cancel(){}request(){throw Error('unused');}}}));
vi.mock('react-dom/client',()=>({createRoot:()=>({render:()=>{}})}));
vi.mock('./GeometryPreview',()=>({GeometryPreview:()=>null}));
vi.mock('./StudioFloorPlan',()=>({StudioFloorPlan:()=>null}));

afterEach(()=>{
 vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();vi.resetModules();vi.clearAllMocks();
});

async function fixture(){
 const browser=Object.assign(new EventTarget(),{location:new URL('http://127.0.0.1:17000/native-viewport.html')}) as unknown as Window;
 vi.stubGlobal('window',browser);vi.stubGlobal('document',{getElementById:()=>({})});
 const frame:NativeViewportFrame={
  version:1,epoch:crypto.randomUUID(),sequence:1,tenantId:crypto.randomUUID(),principalId:crypto.randomUUID(),
  draft:newDraft(),selection:null,mode:'translate',view:'isometric',cameraSequence:0,transparent:true,disabled:false,
 };
 const session={tenantId:frame.tenantId,userId:frame.principalId,role:'admin',csrfToken:'csrf',
  expiresAt:'2099-01-01T00:00:00Z',nativeRenderedArtworkThumbnailProfile:'rendered-display-preview-v1',
  workspaceFurnishingProfile:'workspace-furnishing-intake-v1'};
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json(session)));
 await import('./native-viewport');
 const api=browser.exhibitosViewport!;
 await api.accept(frame);
 const request={version:1 as const,epoch:frame.epoch,sequence:frame.sequence,tenantId:frame.tenantId,
  principalId:frame.principalId,requestId:crypto.randomUUID(),artworkId:crypto.randomUUID(),expectedRevision:2};
 return {api,request,frame};
}

it.each(['thumbnail','thumbnailOutcomeV1','thumbnailOutcomeV2'] as const)('gives %s only the artwork allowance and keeps its successful result',async method=>{
 const {api,request}=await fixture(),timeout=vi.spyOn(AbortSignal,'timeout');
 const image={pngBase64:'AA==',width:256,height:256};
 mock.artwork.mockResolvedValueOnce(image);
 expect(await api[method](request)).toMatchObject({...image,artworkId:request.artworkId,revision:2});
 expect(timeout).toHaveBeenCalledExactlyOnceWith(30_000);
 expect(mock.artwork.mock.calls[0]?.[1].aborted).toBe(true);
});

it('uses the same 30s allowance for the real trace and cancels pending preview work at its deadline',async()=>{
 const {api,request}=await fixture();
 vi.useFakeTimers();
 const timeout=vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{
  const deadline=new AbortController();
  setTimeout(()=>deadline.abort(new DOMException('deadline','TimeoutError')),ms);
  return deadline.signal;
 });
 const dispatched=new Promise<void>(resolve=>{
  mock.artwork.mockImplementationOnce(async(_request,signal,phase,observation)=>{
   phase?.('preview','headers');
   vi.stubGlobal('fetch',()=>new Promise<Response>((_done,reject)=>{
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
   }));
   const pending=observation!.fetch('/preview?expectedRevision=2',{signal});
   resolve();
   await pending;
   throw Error('Expected deadline');
  });
 });
 const reply=api.thumbnailPreviewTraceV1(request);
 await dispatched;
 expect(timeout).toHaveBeenCalledExactlyOnceWith(30_000);
 let settled=false;void reply.then(()=>{settled=true;});
 await vi.advanceTimersByTimeAsync(10_000);
 expect(settled).toBe(false);
 await vi.advanceTimersByTimeAsync(20_000);
 const result=await reply;
 expect(result.result).toEqual({thumbnailFailure:{version:2,phase:'preview',previewStep:'headers',outcome:'timeout'}});
 expect(result.trace).toMatchObject({requestId:request.requestId,terminal:{kind:'cancelled',reason:'timeout'}});
 expect(result.trace!.remainingBudgetEstimateMs).toBe(30_000-result.trace!.dispatchElapsedMs);
 expect(mock.artwork.mock.calls[0]?.[1].aborted).toBe(true);
});

it('keeps the furnishing thumbnail on the default catalogue allowance',async()=>{
 const {api,request}=await fixture(),timeout=vi.spyOn(AbortSignal,'timeout');
 await api.furnishingThumbnailV1({...catalogBinding(request),furnishingId:crypto.randomUUID(),furnishingVersion:1,
  modelSha256:'a'.repeat(64),modelBytes:28,recipeId:'furnishing-glb-card-256-v1',toolId:'exhibitos-three-0.186.1-thumbnail-v1'});
 expect(timeout).toHaveBeenCalledExactlyOnceWith(10_000);
 expect(mock.furnishing).toHaveBeenCalledOnce();
});

it('still cancels artwork work when a newer frame replaces its request scope',async()=>{
 const {api,request,frame}=await fixture();
 let started!:()=>void;
 const active=new Promise<void>(resolve=>{started=resolve;});
 mock.artwork.mockImplementationOnce((_request,signal)=>new Promise((_resolve,reject)=>{
  signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  started();
 }));
 const reply=api.thumbnailOutcomeV2(request);
 await active;
 await api.accept({...frame,sequence:2});
 expect(await reply).toEqual({thumbnailFailure:{version:2,phase:'authorization',outcome:'cancelled'}});
 expect(mock.artwork.mock.calls[0]?.[1].aborted).toBe(true);
});
