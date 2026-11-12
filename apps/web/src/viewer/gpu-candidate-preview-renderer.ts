// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import {loadGpuModel} from './gpu-model-loader';
import {centerMetricModel,metricCameraFit} from './metric-model';
import {applyReferenceOutput} from './render-quality';
import {retireArtworkResources} from './artwork-ownership';
import {completeDetailCommands} from './detail-command-completion';
import {AssetPeakBudget,AssetReleaseUnconfirmedError,DEVICE_BUDGETS,modelDecodeReserve} from './loading';

export type GpuCandidatePreviewInvalidation='context-lost'|'hidden'|'render-failed';
export interface GpuCandidatePreviewMount {
  targetFormat:'astc-4x4'|'bc7';drawGeneration:number;valid():boolean;retire():Promise<void>;
}
/** Private review only. The caller owns source/receipt/rights verification and
 * admission beside its editor. This owner never selects an original fallback. */
export async function mountGpuCandidatePreview(input:{host:HTMLElement;bytes:ArrayBuffer;signal:AbortSignal;maxTriangles:number;onInvalidated(reason:GpuCandidatePreviewInvalidation):void}):Promise<GpuCandidatePreviewMount>{
  const {host,signal}=input,doc=host.ownerDocument,win=doc.defaultView;
  signal.throwIfAborted();
  if(!win||!Number.isSafeInteger(input.maxTriangles)||input.maxTriangles<1||input.bytes.byteLength<1||input.bytes.byteLength>33554432)throw Error('GPU_PREVIEW_INPUT');
  const [three,{OrbitControls}]=await Promise.all([import('three'),import('three/addons/controls/OrbitControls.js')]);
  signal.throwIfAborted();
  const renderer=new three.WebGLRenderer({antialias:false,alpha:false,preserveDrawingBuffer:false});
  const canvas=renderer.domElement,controller=new AbortController(),localSignal=AbortSignal.any([signal,controller.signal]);
  let loaded:Awaited<ReturnType<typeof loadGpuModel>>|undefined,pending:Promise<Awaited<ReturnType<typeof loadGpuModel>>>|undefined;
  let controls:InstanceType<typeof OrbitControls>|undefined,observer:ResizeObserver|undefined;
  let onControlsChange:(()=>void)|undefined;
  let frame=0,ready=false,retiring=false,invalidated=false,gpuCommandsAttempted=false,drawGeneration=0;
  let retirement:Promise<void>|undefined;
  let peak:AssetPeakBudget|undefined,framebufferResident=0;
  const hooks:{node:Three.Mesh;previous:Three.Mesh['onAfterRender']}[]=[];
  const visible=()=>{
    if(doc.hidden||!host.isConnected||!canvas.isConnected||host.closest('[hidden],[inert],details:not([open])'))return false;
    const canvasStyle=win.getComputedStyle(canvas);if(canvasStyle.display==='none'||canvasStyle.visibility==='hidden'||canvasStyle.visibility==='collapse'||Number(canvasStyle.opacity)===0)return false;
    for(let node:HTMLElement|null=host;node;node=node.parentElement){const style=win.getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||Number(style.opacity)===0)return false;}
    const r=canvas.getBoundingClientRect(),h=host.getBoundingClientRect();
    return r.width>0&&r.height>0&&h.width>0&&h.height>0&&r.right>0&&r.bottom>0&&r.left<win.innerWidth&&r.top<win.innerHeight;
  };
  const valid=()=>ready&&!retiring&&!localSignal.aborted&&visible()&&!renderer.getContext().isContextLost();
  const retire=():Promise<void>=>{
    if(retirement)return retirement;
    retiring=true;ready=false;
    retirement=Promise.resolve().then(async()=>{
      let cause:unknown,failed=false;const attempt=async(fn:()=>unknown|Promise<unknown>)=>{try{await fn();}catch(error){if(!failed)cause=error;failed=true;}};
      await attempt(()=>win.cancelAnimationFrame(frame));
      await attempt(()=>observer?.disconnect());
      await attempt(()=>doc.removeEventListener('visibilitychange',visibility));
      await attempt(()=>canvas.removeEventListener('webglcontextlost',lost));
      await attempt(()=>localSignal.removeEventListener('abort',aborted));
      await attempt(()=>{if(controls&&onControlsChange)controls.removeEventListener('change',onControlsChange);});
      await attempt(()=>controls?.dispose());
      if(pending)try{loaded=await pending;}catch(error){if(error instanceof AssetReleaseUnconfirmedError){if(!failed)cause=error;failed=true;}}
      for(const hook of hooks)await attempt(()=>{hook.node.onAfterRender=hook.previous;});
      if(loaded)await attempt(()=>retireArtworkResources(loaded!.resources,loaded!.backing));
      if(gpuCommandsAttempted)await attempt(()=>{
        const gl=renderer.getContext();
        if(!('fenceSync' in gl)||typeof gl.fenceSync!=='function')throw Error('GPU_PREVIEW_FENCE_UNAVAILABLE');
        return completeDetailCommands(gl as WebGL2RenderingContext);
      });
      await attempt(()=>renderer.dispose());
      await attempt(()=>renderer.forceContextLoss());
      await attempt(()=>canvas.remove());
      if(failed)throw new AssetReleaseUnconfirmedError({cause});
      framebufferResident=0;peak?.release('candidate');
    });
    controller.abort(Error('GPU_PREVIEW_RETIRED'));
    // Event-driven retirement has no awaiter, but its rejected receipt remains
    // retained for the caller's barrier and can never turn into success.
    void retirement.catch(()=>{});return retirement;
  };
  const invalidate=(reason:GpuCandidatePreviewInvalidation)=>{
    if(retiring||invalidated)return;invalidated=true;ready=false;
    try{input.onInvalidated(reason);}catch{/* Observer errors cannot prevent cleanup. */}finally{void retire();}
  };
  const visibility=()=>{if(!visible())invalidate('hidden');};
  const lost=(event:Event)=>{event.preventDefault();invalidate('context-lost');};
  const aborted=()=>{void retire();};
  try{
    canvas.style.display='block';canvas.style.width='100%';canvas.style.height='100%';canvas.tabIndex=0;
    host.appendChild(canvas);renderer.setPixelRatio(1);applyReferenceOutput(three,renderer);
    if(!visible())throw Error('GPU_PREVIEW_HIDDEN');
    const rect=host.getBoundingClientRect(),budget=DEVICE_BUDGETS.desktop!;
    const resolutionScale=Math.min(1,budget.maxTextureSize/rect.width,budget.maxTextureSize/rect.height);
    const width=Math.max(1,Math.floor(rect.width*resolutionScale)),height=Math.max(1,Math.floor(rect.height*resolutionScale));
    // Non-MSAA RGBA/depth buffers plus conservative driver copies stay inside
    // the existing local steady allowance, never an extra resource grant.
    const framebufferBytes=width*height*16;
    framebufferResident=framebufferBytes;
    peak=new AssetPeakBudget(budget.maxCacheBytes,()=>framebufferResident);
    // Admit encoded copies, header-derived geometry and every image binding
    // before starting a decoder. Retain this conservative charge through the
    // renderer's positively acknowledged retirement; steady fit is insufficient.
    peak.reserve('candidate',modelDecodeReserve(input.bytes.byteLength,budget,input.bytes,512,'complete'));
    gpuCommandsAttempted=true;renderer.setSize(width,height,false);
    canvas.addEventListener('webglcontextlost',lost);doc.addEventListener('visibilitychange',visibility);
    pending=loadGpuModel(three,renderer,input.bytes,localSignal,{...budget,maxCacheBytes:budget.maxCacheBytes-framebufferBytes},Math.min(input.maxTriangles,budget.maxTriangles));
    localSignal.addEventListener('abort',aborted,{once:true});
    loaded=await pending;localSignal.throwIfAborted();
    if(!visible())throw Error('GPU_PREVIEW_HIDDEN');
    const centered=centerMetricModel(three,loaded.object),scene=new three.Scene();scene.background=new three.Color('#f8fbfc');scene.add(centered.object);
    scene.add(new three.HemisphereLight(0xffffff,0x48503d,2));const light=new three.DirectionalLight(0xffffff,3);light.position.set(3,4,5);scene.add(light);
    const fit=metricCameraFit(centered.extent,width/height),camera=new three.PerspectiveCamera(40,width/height,fit.near,fit.far);
    camera.position.set(1,.45,1.3).normalize().multiplyScalar(fit.distance);camera.lookAt(0,0,0);
    let drawn=false;
    loaded.object.traverse(node=>{
      if(!(node instanceof three.Mesh))return;
      const previous=node.onAfterRender;hooks.push({node,previous});
      node.onAfterRender=function(...args){
        previous.apply(this,args);
        const material=args[4] as Three.MeshStandardMaterial;
        if(args[0]===renderer&&args[1]===scene&&args[2]===camera&&renderer.getRenderTarget()===null&&material.visible&&material.opacity>0&&material.map instanceof three.CompressedTexture)drawn=true;
      };
    });
    const draw=()=>{
      if(retiring||localSignal.aborted)return false;
      if(!visible()){invalidate('hidden');return false;}
      if(renderer.getContext().isContextLost()){invalidate('context-lost');return false;}
      try{
        if(renderer.getRenderTarget()!==null)throw Error('GPU_PREVIEW_RENDER_TARGET');
        drawn=false;gpuCommandsAttempted=true;renderer.render(scene,camera);
        if(renderer.getContext().isContextLost()||renderer.getRenderTarget()!==null)throw Error('GPU_PREVIEW_DRAW_UNCONFIRMED');
        if(drawn)drawGeneration++;return drawn;
      }catch(error){invalidate('render-failed');throw error;}
    };
    controls=new OrbitControls(camera,canvas);controls.enableDamping=false;controls.target.set(0,0,0);controls.update();
    const redraw=()=>{try{draw();}catch{/* invalidation already owns retirement */}};
    onControlsChange=redraw;controls.addEventListener('change',redraw);
    observer=new ResizeObserver(()=>{
      if(retiring)return;
      try{
        if(!visible()){invalidate('hidden');return;}
        const r=host.getBoundingClientRect(),scale=Math.min(1,width/r.width,height/r.height),w=Math.max(1,Math.floor(r.width*scale)),h=Math.max(1,Math.floor(r.height*scale));
        renderer.setSize(w,h,false);camera.aspect=w/h;const next=metricCameraFit(centered.extent,camera.aspect);camera.near=next.near;camera.far=next.far;camera.position.normalize().multiplyScalar(next.distance);camera.updateProjectionMatrix();redraw();
      }catch{invalidate('render-failed');}
    });observer.observe(host);
    await new Promise<void>((resolve,reject)=>{
      const cancel=()=>{win.cancelAnimationFrame(frame);reject(localSignal.reason);};
      localSignal.addEventListener('abort',cancel,{once:true});
      frame=win.requestAnimationFrame(()=>{localSignal.removeEventListener('abort',cancel);resolve();});
      if(localSignal.aborted)cancel();
    });
    localSignal.throwIfAborted();if(!draw())throw Error('GPU_PREVIEW_NO_CANDIDATE_DRAW');
    ready=true;
    const monitor=()=>{if(retiring)return;if(!visible())invalidate('hidden');else if(renderer.getContext().isContextLost())invalidate('context-lost');else frame=win.requestAnimationFrame(monitor);};
    frame=win.requestAnimationFrame(monitor);
    return {targetFormat:loaded.targetFormat,drawGeneration,valid,retire};
  }catch(error){
    try{await retire();}catch(cause){throw new AssetReleaseUnconfirmedError({cause});}
    throw error;
  }
}
