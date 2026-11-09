import {DEFAULT_REFERENCE_TONE,applyReferenceOutput,installReferenceEnvironment,environmentEstimate,type ReferenceTone} from './viewer/render-quality';
import {basisLoader} from './basis-loader.js';
import {centerMetricModel,metricCameraFit,artifactMetricModel} from './viewer/metric-model.js';
import { embeddedPNGManager } from './embedded-glb.js';
import {WatermarkOverlay} from './WatermarkOverlay';
import {ViewerIcon} from './viewer/ViewerIcon';
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Artwork } from "@exhibitos/spec";
import type { PublicPublication } from "./publication-client";
import { assetDecodeReserve, checkImageDecode, deviceBudget, fetchVerifiedAsset, geometryResidentBytes, selectAssetVariant, textureResidentBytes } from "./viewer/loading";
import type * as THREE from "three";

import {FlatImageGesture,flatImageView,imageFit,zoomImage,type ImageViewport} from './viewer/flat-image-view';
import {flatImagePreview} from './viewer/flat-image-preview';
import { DetailGesture, detailView, INITIAL_DETAIL_VIEW } from "./viewer/detail-gesture";
import type {DetailQualityProgress,SharedDetailPreview,SharedDetailSession} from './viewer/borrowed-detail-preview';
import {lodVariantsFor,type DetailTier} from '@exhibitos/studio-contract';

const qualityLevel:Record<DetailTier,number>={'lightweight':1,'approved-full':2,'acquired-original':3};

function qualityName(tier:DetailTier,flat:boolean){
  if(tier==='acquired-original')return '원본 파일';
  if(tier==='approved-full')return '승인된 고화질';
  return flat?'경량 이미지':'경량 모델';
}

export interface DetailAnchor { id: string; position: [number, number, number]; text: string }
export function ArtworkDetailPreview({ publication, artwork, anchors, placementId, sharedPreview, referenceTone = DEFAULT_REFERENCE_TONE }: {
  referenceTone?: ReferenceTone;
  publication: PublicPublication; artwork: Artwork; anchors: DetailAnchor[];
  placementId?:string;sharedPreview?:SharedDetailPreview;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState(INITIAL_DETAIL_VIEW), [error, setError] = useState("");
  const flat=artwork.artworkType==='image';
  const [maxZoom,setMaxZoom]=useState(1);
  const tierSession=useMemo(()=>({}),[sharedPreview,placementId,publication.publication.id,publication.publication.revisionSha256,artwork.revisionId,anchors,flat]);
  const currentTierSession=useRef(tierSession);currentTierSession.current=tierSession;
  const [reportedTier,setReportedTier]=useState<{session:object;tier:DetailTier}|null>(null);
  const [reportedProgress,setReportedProgress]=useState<{session:object;value:DetailQualityProgress}|null>(null);
  const renderedTier=reportedTier?.session===tierSession?reportedTier.tier:null;
  const pending=reportedProgress?.session===tierSession?reportedProgress.value:null;
  const progress=pending&&(!renderedTier||qualityLevel[pending.tier]>qualityLevel[renderedTier])?pending:null;
  const viewport=useRef<ImageViewport>({width:1,height:1,imageWidth:1,imageHeight:1,pixelRatio:1});
  const acceptViewport=(next:ImageViewport)=>{
    const old=viewport.current;if(Object.keys(next).every(key=>next[key as keyof ImageViewport]===old[key as keyof ImageViewport]))return;
    viewport.current=next;setMaxZoom(imageFit(next).maxZoom);
    controls.current=flatImageView(controls.current,next);setView(controls.current);
  };
  const { yaw, pitch, zoom } = view;
  const controls = useRef(view);
  const sharedSession=useRef<SharedDetailSession|null>(null);
  const failShared=useRef<(()=>void)|null>(null);
  const hint = useId();
  const changeView = (next: typeof view) => { next=flat?flatImageView(next,viewport.current):detailView(next); controls.current = next;try{sharedSession.current?.update(next);}catch{failShared.current?.();} setView(next); };
  useEffect(()=>{
    if(!sharedPreview||!placementId||!host.current)return;
    const target=host.current,abort=new AbortController();
    let session:SharedDetailSession|undefined,terminal=false,lastDrawGeneration=0,attempt=0,attemptEnded=false;
    const current=()=>!terminal&&currentTierSession.current===tierSession;
    setError('');
    setReportedTier(null);
    setReportedProgress(null);
    const stop=()=>{
      if(terminal)return false;
      terminal=true;
      const owned=session;
      session=undefined;
      if(sharedSession.current===owned)sharedSession.current=null;
      abort.abort();
      try{owned?.dispose();}catch{/* The adapter owns the drain. */}
      return true;
    };
    const clear=()=>{setReportedTier(null);setReportedProgress(null);};
    const fail=()=>{
      if(!current()||!stop())return;
      clear();
      setError('현재 준비된 작품 표시를 사용할 수 없어요. 전시로 돌아가 작품이 준비된 뒤 다시 열거나 아래 설명을 읽어 주세요.');
    };
    failShared.current=fail;
    const unavailable=(reason:'rights'|'graphics'|'restoring'|'recovery')=>{
      if(!current()||!stop())return;
      clear();
      setError(reason==='graphics'?'3D 연결이 끊겨 상세 표시를 중단했어요. 전시로 돌아가 3D를 다시 시작하거나 아래 설명을 읽어 주세요.':reason==='restoring'?'작품 화면을 정리하고 있어요. 아래 설명을 읽거나 전시로 돌아갈 수 있어요.':reason==='recovery'?'작품 화면을 안전하게 정리하지 못했어요. 작품 목록을 이용하거나 3D를 다시 시작해 주세요.':'공개 상태를 확인할 수 없어 상세 표시를 중단했습니다. 설명은 아래에서 읽을 수 있어요.');
    };
    const renderedTier=(tier:DetailTier|null,drawGeneration:number)=>{
      if(!current()||!Number.isSafeInteger(drawGeneration)||drawGeneration<=lastDrawGeneration)return;
      if(tier!==null&&!Object.hasOwn(qualityLevel,tier))return;
      lastDrawGeneration=drawGeneration;
      setReportedTier(tier===null?null:{session:tierSession,tier});
    };
    const qualityProgress=(value:DetailQualityProgress|null,generation:number)=>{
      if(!current()||!Number.isSafeInteger(generation)||generation<1||generation<attempt||generation===attempt&&attemptEnded)return;
      if(value&&(!Object.hasOwn(qualityLevel,value.tier)||!Number.isSafeInteger(value.loadedBytes)||value.loadedBytes<0||
        value.totalBytes!==null&&(!Number.isSafeInteger(value.totalBytes)||value.totalBytes<1||value.loadedBytes>value.totalBytes)))return;
      attempt=generation;
      attemptEnded=value===null;
      setReportedProgress(value===null?null:{session:tierSession,value});
    };
    void Promise.resolve().then(()=>{
      abort.signal.throwIfAborted();
      return sharedPreview({
        placementId,host:target,signal:abort.signal,view:controls.current,anchors,unavailable,flatImage:flat,
        imageViewport:flat?next=>{if(current())acceptViewport(next);}:undefined,renderedTier,qualityProgress,
      });
    }).then(value=>{
      if(!current()){value.dispose();return;}
      session=value;
      sharedSession.current=value;
      value.update(controls.current);
    }).catch(fail);
    return()=>{if(failShared.current===fail)failShared.current=null;stop();};
  },[sharedPreview,placementId,anchors,flat,tierSession]);
  useEffect(() => {
    const target = host.current;
    if (!target) return;
    const gesture = new DetailGesture(),imageGesture=new FlatImageGesture();
    let tap:{time:number;x:number;y:number}|undefined,start:{x:number;y:number}|undefined,moved=false,multiple=false;
    const point=(event:{clientX:number;clientY:number})=>{const box=target.getBoundingClientRect();return {x:event.clientX-box.left-box.width/2,y:event.clientY-box.top-box.height/2};};
    const captured = new Set<number>();
    const clear = () => {
      gesture.clear();imageGesture.clear();tap=undefined;start=undefined; delete target.dataset.dragging;
      for (const id of captured) if (target.hasPointerCapture(id)) target.releasePointerCapture(id);
      captured.clear();
    };
    const visibility = () => { if (document.visibilityState === "hidden") clear(); };
    const down = (event: PointerEvent) => {
      if (captured.size >= 2 || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) return;
      target.focus({ preventScroll: true });
      try { target.setPointerCapture(event.pointerId); } catch { return; }
      captured.add(event.pointerId);
      if(captured.size===1){start={x:event.clientX,y:event.clientY};moved=false;multiple=false;}else{multiple=true;tap=undefined;}
      if(flat)imageGesture.begin(event.pointerId,point(event));else gesture.begin(event.pointerId,{x:event.clientX,y:event.clientY});
      target.dataset.dragging = "true"; event.preventDefault();
    };
    const move = (event: PointerEvent) => {
      if (!captured.has(event.pointerId)) return;
      if(start&&Math.hypot(event.clientX-start.x,event.clientY-start.y)>8){moved=true;tap=undefined;}
      changeView(flat?imageGesture.move(event.pointerId,point(event),controls.current,viewport.current):gesture.move(event.pointerId,{x:event.clientX,y:event.clientY},controls.current));
      event.preventDefault();
    };
    const end = (event: PointerEvent) => {
      const owned=captured.has(event.pointerId);if(owned&&event.type!=='pointerup')tap=undefined;
      gesture.end(event.pointerId);imageGesture.end(event.pointerId);captured.delete(event.pointerId);
      if(flat&&owned&&event.type==='pointerup'&&!moved&&!multiple){
        const now=performance.now(),p=point(event);
        if(tap&&now-tap.time<350&&Math.hypot(event.clientX-tap.x,event.clientY-tap.y)<32){
          changeView(controls.current.zoom>1?{...INITIAL_DETAIL_VIEW}:zoomImage(controls.current,Math.min(2,imageFit(viewport.current).maxZoom),p.x,p.y,viewport.current));tap=undefined;
        }else tap={time:now,x:event.clientX,y:event.clientY};
      }
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
      if (!captured.size) delete target.dataset.dragging;
    };
    const wheel = (event: WheelEvent) => {
      if (document.activeElement !== target || (!flat&&(event.ctrlKey || event.metaKey))) return;
      event.preventDefault();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? target.clientHeight : 1);
      const zoom=controls.current.zoom*Math.exp(-Math.max(-300,Math.min(300,pixels))*.002),p=point(event);
      changeView(flat?zoomImage(controls.current,zoom,p.x,p.y,viewport.current):detailView({...controls.current,zoom}));
    };
    const key = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const next = { ...controls.current };
      if(flat){
        switch(event.key){case 'ArrowLeft':next.panX=(next.panX??0)+32;break;case 'ArrowRight':next.panX=(next.panX??0)-32;break;case 'ArrowUp':next.panY=(next.panY??0)+32;break;case 'ArrowDown':next.panY=(next.panY??0)-32;break;case '+':case '=':next.zoom*=1.25;break;case '-':next.zoom/=1.25;break;case 'Home':Object.assign(next,INITIAL_DETAIL_VIEW,{panX:0,panY:0});break;default:return;}
        event.preventDefault();event.stopPropagation();changeView(next);return;
      }
      if(event.shiftKey&&event.key.startsWith('Arrow')){
        switch(event.key){
          case 'ArrowLeft':next.panX=(next.panX??0)-24;break;
          case 'ArrowRight':next.panX=(next.panX??0)+24;break;
          case 'ArrowUp':next.panY=(next.panY??0)-24;break;
          case 'ArrowDown':next.panY=(next.panY??0)+24;break;
          default:return;
        }
        event.preventDefault();
        event.stopPropagation();
        changeView(next);
        return;
      }
      switch (event.key) {
        case "ArrowLeft": next.yaw -= 5; break;
        case "ArrowRight": next.yaw += 5; break;
        case "ArrowUp": next.pitch -= 5; break;
        case "ArrowDown": next.pitch += 5; break;
        case "+": case "=": next.zoom += .1; break;
        case "-": next.zoom -= .1; break;
        case "Home": Object.assign(next, INITIAL_DETAIL_VIEW); break;
        default: return;
      }
      event.preventDefault(); event.stopPropagation(); changeView(detailView(next));
    };
    target.addEventListener("pointerdown", down); target.addEventListener("pointermove", move);
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) target.addEventListener(type, end);
    target.addEventListener("wheel", wheel, { passive: false }); target.addEventListener("keydown", key);
    target.addEventListener("blur", clear); window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clear(); target.removeEventListener("pointerdown", down); target.removeEventListener("pointermove", move);
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"] as const) target.removeEventListener(type, end);
      target.removeEventListener("wheel", wheel); target.removeEventListener("keydown", key);
      target.removeEventListener("blur", clear); window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [flat]);
  useEffect(() => {
    if(sharedPreview||!host.current)return;
    const target=host.current,abort=new AbortController();
    const current=()=>!abort.signal.aborted&&currentTierSession.current===tierSession;
    type Resource={dispose():void};
    type Candidate={
      model:THREE.Group;centre:THREE.Vector3;extent:number;resident:number;tier:DetailTier;resources:Set<Resource>;
      measured:ReturnType<typeof centerMetricModel>['measured']|undefined;
      artifact:ReturnType<typeof artifactMetricModel>['measured'];
      markers:THREE.Object3D[];
      image?:ReturnType<typeof flatImagePreview>;
    };
    const sceneResources=new Set<Resource>();
    let active:Candidate|undefined,renderer:THREE.WebGLRenderer|undefined,observer:ResizeObserver|undefined,frame=0;
    setError('');
    setReportedTier(null);
    setReportedProgress(null);

    function release(resources:Set<Resource>){
      for(const resource of resources)try{resource.dispose();}catch{/* Keep releasing other owned resources. */}
      resources.clear();
    }
    function stop(){
      abort.abort();
      cancelAnimationFrame(frame);
      observer?.disconnect();
      renderer?.domElement.remove();
    }
    function fail(message:string){
      if(!current())return;
      stop();
      setReportedTier(null);
      setReportedProgress(null);
      setError(message);
    }

    async function start(){
      const three=await import('three');
      abort.signal.throwIfAborted();
      const budget=deviceBudget({viewportWidth:window.innerWidth,deviceMemory:(navigator as Navigator&{deviceMemory?:number}).deviceMemory});
      const environmentReserve=environmentEstimate(budget.maxTextureSize<=512?64:128).generationPeakBytes;
      const steady=budget.maxCacheBytes-environmentReserve;
      const transition=(budget.maxTransitionBytes??budget.maxCacheBytes)-environmentReserve;
      const webgl=new three.WebGLRenderer({antialias:true});
      renderer=webgl;
      sceneResources.add(webgl);
      applyReferenceOutput(three,webgl,referenceTone);
      const scene=new three.Scene();
      scene.background=new three.Color('#181a20');
      const hemisphere=new three.HemisphereLight(0xffffff,0x333344,3);
      const light=new three.DirectionalLight(0xffffff,3);
      light.position.set(3,4,5);
      scene.add(hemisphere,light);
      const camera=new three.PerspectiveCamera(45,1,.01,100);
      webgl.setPixelRatio(Math.min(devicePixelRatio,budget.maxPixelRatio));
      webgl.domElement.setAttribute('aria-label','작품 상세 3D 미리보기');
      target.append(webgl.domElement);
      const resize=()=>webgl.setSize(Math.max(1,target.clientWidth),Math.max(1,target.clientHeight));
      observer=new ResizeObserver(resize);
      observer.observe(target);
      resize();

      function collect(object:THREE.Object3D,resources:Set<Resource>){
        object.traverse(node=>{
          if(!(node instanceof three.Mesh))return;
          resources.add(node.geometry);
          for(const material of Array.isArray(node.material)?node.material:[node.material]){
            resources.add(material);
            for(const value of Object.values(material))if(value instanceof three.Texture)resources.add(value);
          }
        });
      }

      async function load(inventory:Artwork['assets'][number],promoting=false):Promise<Candidate>{
        abort.signal.throwIfAborted();
        if(webgl.getContext().isContextLost())throw Error('DETAIL_CONTEXT_LOST');
        const asset=publication.assets.find(a=>a.assetId===inventory.id);
        if(!asset)throw Error('DETAIL_UNAVAILABLE');
        const previous=active?.resident??0;
        if(promoting&&previous+inventory.bytes*(flat?4:5)>transition)throw Error('DETAIL_MEMORY_BUDGET');
        const resources=new Set<Resource>();
        let resident=0;
        const progress=(loadedBytes:number)=>{
          if(current())setReportedProgress({session:tierSession,value:{tier:'approved-full',loadedBytes,totalBytes:inventory.bytes}});
        };
        try{
          if(promoting)progress(0);
          const bytes=await fetchVerifiedAsset({publicationId:publication.publication.id,
            revisionSha256:publication.publication.revisionSha256,asset,inventory,signal:abort.signal,
            ...publication.local,progress:promoting?progress:undefined});
          abort.signal.throwIfAborted();
          if(promoting&&previous+assetDecodeReserve(artwork,inventory,budget,bytes)>transition)throw Error('DETAIL_MEMORY_BUDGET');

          let object:THREE.Object3D,measured:Candidate['measured'];
          if(inventory.mime==='image/png'){
            const sourceSize=checkImageDecode(bytes,artwork,inventory,budget);
            let bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}),{imageOrientation:'flipY'});
            resources.add({dispose:()=>bitmap.close()});
            abort.signal.throwIfAborted();
            if(sourceSize&&(bitmap.width!==sourceSize.width||bitmap.height!==sourceSize.height))throw Error('IMAGE_DECODE_BUDGET');
            if(bitmap.width>budget.maxTextureSize||bitmap.height>budget.maxTextureSize){
              const scale=budget.maxTextureSize/Math.max(bitmap.width,bitmap.height);
              const resized=await createImageBitmap(bitmap,{imageOrientation:'none',
                resizeWidth:Math.max(1,Math.round(bitmap.width*scale)),resizeHeight:Math.max(1,Math.round(bitmap.height*scale))});
              bitmap.close();
              bitmap=resized;
              abort.signal.throwIfAborted();
            }
            if(bitmap.width*bitmap.height*4*4/3>steady)throw Error('DETAIL_MEMORY_BUDGET');
            resident=textureResidentBytes(bitmap.width,bitmap.height);
            const texture=new three.Texture(bitmap);
            texture.needsUpdate=true;
            texture.colorSpace=three.SRGBColorSpace;
            resources.add(texture);
            object=new three.Mesh(new three.PlaneGeometry(artwork.dimensions.width,artwork.dimensions.height),
              new three.MeshBasicMaterial({map:texture,side:three.DoubleSide,toneMapped:false}));
            collect(object,resources);
          }else{
            const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
            abort.signal.throwIfAborted();
            const manager=new three.LoadingManager();
            const basis=await basisLoader(webgl,bytes);
            if(basis)resources.add(basis);
            abort.signal.throwIfAborted();
            const protectedBytes=embeddedPNGManager(manager,bytes,basis);
            resources.add(protectedBytes);
            const loader=new GLTFLoader(manager);
            if(protectedBytes.ktx2Loader)loader.setKTX2Loader(protectedBytes.ktx2Loader as never);
            object=(await loader.parseAsync(protectedBytes.bytes,'')).scene;
            collect(object,resources);
            protectedBytes.assertLoaded();
            let triangles=0,estimatedBytes=0;
            const seen=new Set<unknown>(),textures=new Set<THREE.Texture>();
            const attributes:Array<THREE.BufferAttribute|THREE.InterleavedBufferAttribute>=[];
            object.traverse(node=>{
              if(!(node instanceof three.Mesh))return;
              const entries=Object.values(node.geometry.attributes) as typeof attributes;
              if(node.geometry.index)entries.push(node.geometry.index);
              attributes.push(...entries);
              for(const attribute of entries){
                if(!seen.has(attribute)){seen.add(attribute);estimatedBytes+=attribute.array.byteLength;}
              }
              triangles+=(node.geometry.index?.count??node.geometry.getAttribute('position').count)/3;
              for(const material of Array.isArray(node.material)?node.material:[node.material])
                for(const value of Object.values(material))if(value instanceof three.Texture&&!textures.has(value)){
                  textures.add(value);
                  const image=value.image as {width?:number;height?:number}|undefined;
                  const width=image?.width??0,height=image?.height??0;
                  if(width>budget.maxTextureSize||height>budget.maxTextureSize)throw Error('DETAIL_TEXTURE_BUDGET');
                  estimatedBytes+=width*height*4*4/3;
                  resident+=textureResidentBytes(width,height);
                }
            });
            resident+=geometryResidentBytes(attributes);
            if(estimatedBytes>steady||triangles>budget.maxTriangles)throw Error('DETAIL_MEMORY_BUDGET');
            const centered=centerMetricModel(three,object);
            object=centered.object;
            measured=centered.measured;
          }
          abort.signal.throwIfAborted();
          if(promoting&&(resident>steady||previous+resident>transition))throw Error('DETAIL_MEMORY_BUDGET');
          const image=flat?flatImagePreview(three,object):undefined;
          if(image)resources.add(image);
          const artifact=artifactMetricModel(three,object,artwork.transform);
          object=artifact.object;
          const model=new three.Group();
          model.position.copy(artifact.center);
          const contents=new three.Group();
          contents.position.copy(artifact.center).negate();
          contents.add(object);
          model.add(contents);
          const markers=anchors.map(anchor=>{
            const marker=new three.Mesh(new three.SphereGeometry(artifact.extent*.015,12,8),
              new three.MeshBasicMaterial({color:'#ffd067',depthTest:false}));
            marker.position.fromArray(anchor.position);
            marker.renderOrder=1;
            object.add(marker);
            collect(marker,resources);
            return marker;
          });
          const variant=lodVariantsFor(artwork).find(item=>item.assetId.toLowerCase()===inventory.id.toLowerCase());
          return {model,centre:artifact.center,extent:artifact.extent,resident,resources,image,measured,
            artifact:artifact.measured,markers,tier:variant?.detail==='full'?'approved-full':'lightweight'};
        }catch(error){
          release(resources);
          throw error;
        }
      }

      function draw(candidate:Candidate){
        const view=controls.current;
        const width=Math.max(1,target.clientWidth),height=Math.max(1,target.clientHeight);
        if(candidate.image){
          const state=candidate.image.render(webgl,width,height,view);
          if(webgl.getContext().isContextLost()||webgl.info.render.calls<1)throw Error('DETAIL_DRAW_UNCONFIRMED');
          webgl.domElement.dataset.detailState=JSON.stringify({flatImage:true,...state});
          acceptViewport(state.viewport);
          return;
        }
        candidate.model.rotation.set(view.pitch*Math.PI/180,view.yaw*Math.PI/180,0,'YXZ');
        camera.aspect=width/height;
        const fit=metricCameraFit(candidate.extent,camera.aspect,view.zoom);
        camera.near=fit.near;
        camera.far=fit.far;
        camera.updateProjectionMatrix();
        const metersPerPixel=2*fit.distance*Math.tan(camera.fov*Math.PI/360)/height;
        const centre=candidate.centre.clone().add(new three.Vector3(-(view.panX??0)*metersPerPixel,(view.panY??0)*metersPerPixel,0));
        camera.position.copy(centre).add(new three.Vector3(0,0,fit.distance));
        camera.lookAt(centre);
        webgl.render(scene,camera);
        if(webgl.getContext().isContextLost()||webgl.info.render.calls<1)throw Error('DETAIL_DRAW_UNCONFIRMED');
        webgl.domElement.dataset.detailState=JSON.stringify({rotationX:candidate.model.rotation.x,rotationY:candidate.model.rotation.y,
          cameraPosition:camera.position.toArray(),clipping:[camera.near,camera.far],zoom:view.zoom,panX:view.panX??0,panY:view.panY??0,
          dimensions:artwork.dimensions,measuredGeometry:candidate.measured,artifactGeometry:candidate.artifact,
          anchors:anchors.map(a=>a.position),anchorWorld:candidate.markers.map(n=>n.getWorldPosition(new three.Vector3()).toArray())});
      }
      function commit(candidate:Candidate){
        const previous=active;
        try{
          if(!current())throw Error('DETAIL_CANCELLED');
          if(previous)scene.remove(previous.model);
          scene.add(candidate.model);
          draw(candidate);
        }catch(error){
          scene.remove(candidate.model);
          release(candidate.resources);
          if(!previous||!current())throw error;
          scene.add(previous.model);
          draw(previous);
          return;
        }
        active=candidate;
        if(previous)release(previous.resources);
        setReportedTier({session:tierSession,tier:candidate.tier});
      }

      const preferred=selectAssetVariant(artwork,0,budget);
      const initial=selectAssetVariant(artwork,0,budget,true);
      try{commit(await load(initial));}
      catch(error){
        if(initial.id===preferred.id||!current())throw error;
        commit(await load(preferred));
      }
      const render=()=>{
        if(!current()||!active)return;
        try{draw(active);frame=requestAnimationFrame(render);}
        catch{fail('3D 연결이 끊겨 상세 표시를 중단했어요. 전시로 돌아가 다시 열어 주세요.');}
      };
      frame=requestAnimationFrame(render);
      if(!flat)void installReferenceEnvironment(three,webgl,scene,environmentReserve,budget.maxTextureSize<=512,()=>!current()).then(environment=>{
        if(!environment)return;
        if(!current()){environment.dispose();return;}
        sceneResources.add(environment);
        scene.environmentIntensity=.45;
        hemisphere.intensity=.6;
        light.intensity=2;
        webgl.domElement.dataset.renderQuality=JSON.stringify({tone:referenceTone,exposure:1,environmentSize:environment.size,
          environmentReserveBytes:environmentReserve,assetBudgetBytes:steady});
      }).catch(()=>{});
      if(initial.id!==preferred.id&&active?.tier==='lightweight'){
        try{
          const candidate=await load(preferred,true).catch(()=>undefined);
          if(candidate)commit(candidate);
        }finally{
          if(current())setReportedProgress(null);
        }
      }
    }

    const check=async()=>{
      if(!current())return;
      try{
        if(publication.local){await publication.local.check();return;}
        const response=await fetch(`/api/v1/publications/${publication.publication.id}?footsteps=1`,{cache:'no-store',credentials:'omit',signal:abort.signal});
        if(!response.ok||(await response.json()).publication.revisionSha256!==publication.publication.revisionSha256)throw Error('REVOKED');
      }catch{fail('공개 상태를 확인할 수 없어 상세 표시를 중단했습니다.');}
    };
    const timer=setInterval(()=>void check(),10000);
    const visible=()=>{if(document.visibilityState==='visible')void check();};
    document.addEventListener('visibilitychange',visible);
    const work=start().catch(()=>fail('현재 권리 또는 그래픽·기기 예산 때문에 상세 미리보기를 표시할 수 없어요. 아래에서 설명을 읽을 수 있어요.'));
    const releaseAfterStop=()=>{
      if(active)release(active.resources);
      release(sceneResources);
    };
    const drain=()=>{void work.then(releaseAfterStop);};
    abort.signal.addEventListener('abort',drain,{once:true});
    if(abort.signal.aborted)drain();
    return()=>{
      stop();
      clearInterval(timer);
      document.removeEventListener('visibilitychange',visible);
    };
  },[publication,artwork,anchors,referenceTone,sharedPreview,flat,tierSession]);
  const actionSize={minWidth:44,minHeight:44};
  const helpControl=<details className="detail-help"><summary className="detail-control-icon" style={actionSize} aria-label={flat?'이미지 조작 안내':'작품 조작 안내'} title={flat?'이미지 조작 안내':'작품 조작 안내'}><ViewerIcon name="help"/></summary>
      <p>{flat?'두 번 누르거나 확대·축소 버튼을 사용하세요. 두 손가락 확대, 휠·트랙패드와 방향키도 사용할 수 있습니다. 이미지 비율은 유지되며 확대 한도는 준비된 이미지 해상도에 따릅니다. 화면 크기는 작품의 실제 크기와 다릅니다.':'두 손가락으로 확대하거나 화면을 이동할 수 있습니다. 키보드는 방향키로 회전, Shift+방향키로 이동, +/−로 확대·축소, Home으로 초기화할 수 있습니다. 작품의 미터 단위 좌표를 유지하는 디지털 미리보기이며 화면의 물리적 크기와는 다릅니다.'}</p>
    </details>;
  const qualityControl=renderedTier&&<details className="detail-help detail-quality">
    <summary className="detail-control-icon" aria-label={`현재 표시 품질: ${qualityName(renderedTier,flat)}`} title={`현재 표시 품질: ${qualityName(renderedTier,flat)}`}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
        <path d="M5 19v-4" />
        <path d="M12 19v-9" opacity={qualityLevel[renderedTier]>=2?1:.3} />
        <path d="M19 19V5" opacity={qualityLevel[renderedTier]>=3?1:.3} />
      </svg>
    </summary>
    <p>현재 표시: {qualityName(renderedTier,flat)}</p>
  </details>;
  return <section aria-label={flat?'작품 정면 이미지 확대':'작품 확대 및 회전'}>
    <div className="watermark-display-stage"><div ref={host} className="detail-preview" data-testid="detail-preview" tabIndex={error?-1:0} aria-disabled={!!error||undefined} role="group" aria-label={flat?'작품 이미지 확대 및 이동 조작':'작품 회전 및 확대 조작'} aria-describedby={error?undefined:hint} />
      <WatermarkOverlay candidate={publication.exhibition}/>
      {!error&&progress&&<progress className="detail-quality-progress" aria-label={`${qualityName(progress.tier,flat)} 불러오는 중`}
        max={progress.totalBytes??undefined} value={progress.totalBytes===null?undefined:progress.loadedBytes}/>}
    </div>
    {!error&&<p id={hint} className="detail-gesture-hint">{flat?'확대한 뒤 드래그해 살펴보세요.':'드래그해 회전하며 살펴보세요.'}</p>}
    {error && <p role="status">{error}</p>}
    {!error&&(flat?<div className="detail-image-controls" aria-label="이미지 확대">
      <button disabled={zoom<=1} onClick={()=>changeView({...controls.current,zoom:zoom/1.25})} aria-label="작품 이미지 축소" title="축소" className="detail-control-icon" style={actionSize}><ViewerIcon name="minus"/></button>
      <output aria-live="off">{Math.round(zoom*100)}%</output>
      <button disabled={zoom>=maxZoom} onClick={()=>changeView({...controls.current,zoom:zoom*1.25})} aria-label="작품 이미지 확대" title="확대" className="detail-control-icon" style={actionSize}><ViewerIcon name="plus"/></button>
      <button onClick={()=>changeView({...INITIAL_DETAIL_VIEW,panX:0,panY:0})} aria-label="작품 이미지 전체 보기" title="전체 보기" className="detail-control-icon" style={actionSize}><ViewerIcon name="fit"/></button>
      {qualityControl}
      {helpControl}
    </div>:<>
      <label>작품 회전 {Math.round(yaw)}° <input aria-label="작품 회전" type="range" min="-180" max="180" step="5" value={yaw} onChange={e => changeView({ ...controls.current, yaw: Number(e.target.value) })} /></label>
      <label>작품 상하 회전 {Math.round(pitch)}° <input aria-label="작품 상하 회전" type="range" min="-90" max="90" step="5" value={pitch} onChange={e => changeView({ ...controls.current, pitch: Number(e.target.value) })} /></label>
      <label>작품 확대 {zoom.toFixed(1)}× <input aria-label="작품 확대" type="range" min=".5" max="3" step=".1" value={zoom} onChange={e => changeView({ ...controls.current, zoom: Number(e.target.value) })} /></label>
      <div className="detail-sculpture-actions"><button onClick={() => changeView({ ...INITIAL_DETAIL_VIEW })} aria-label="상세 시점 초기화" title="상세 시점 초기화" className="detail-control-icon" style={actionSize}><ViewerIcon name="fit"/></button>{qualityControl}{helpControl}</div>
    </>)}

  </section>;
}
