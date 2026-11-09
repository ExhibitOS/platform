// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import {metricCameraFit} from './metric-model';
import {flatImagePreview} from './flat-image-preview';
import type {ImageViewport} from './flat-image-view';
import type {DetailView} from './detail-gesture';
import type {DetailTier} from '@exhibitos/studio-contract';

export interface SharedDetailSession {update(view:DetailView):void;dispose():void}
export interface SharedDetailRequest {
 placementId:string;host:HTMLElement;signal:AbortSignal;view:DetailView;
 anchors:readonly {id:string;position:[number,number,number];text:string}[];
 flatImage?:boolean;imageViewport?(viewport:ImageViewport):void;
 /** Return false to suppress this draw before any renderer command is issued. */
 beforeRender?():boolean;
 /** Keep the shared canvas hidden until its owner has drawn a safe gallery frame. */
 keepHiddenOnDispose?():boolean;
 /** When an owned original is draining, the canvas owner will resize later. */
 deferRestore?():boolean;
 /** The renderer owner reports only committed draws, or null when removed.
  * Draw generations are positive, strictly increasing within this session. */
 renderedTier?(tier:DetailTier|null,drawGeneration:number):void;
 unavailable(reason:'rights'|'graphics'|'restoring'|'recovery'):void;
}
export type SharedDetailPreview=(request:SharedDetailRequest)=>Promise<SharedDetailSession>;

/** A temporary view of an already admitted object. Only transforms and the tiny
 * annotation geometry belong to this scope; meshes/materials/textures remain
 * owned and charged by the exhibition loader. No renderer or environment map
 * is created, and the exhibition camera is never mutated. */
export function borrowedDetailPreview(input:{
 three:typeof Three;renderer:Three.WebGLRenderer;object:Three.Object3D;
 request:SharedDetailRequest;environment:()=>{map:Three.Texture|null;intensity:number};
 onRelease():void;
 onFlatImageDraw?(object:Three.Object3D):void;
}):SharedDetailSession&{render():boolean;replaceImage(object:Three.Object3D):void;replaceModel(object:Three.Object3D):void}{
 const {three,renderer,request}=input,canvas=renderer.domElement;
 request.signal.throwIfAborted();
 const parent=canvas.parentNode,next=canvas.nextSibling;
 if(!parent||!request.host.isConnected)throw Error('DETAIL_HOST_UNAVAILABLE');
 const saved={size:renderer.getSize(new three.Vector2()),ratio:renderer.getPixelRatio(),style:canvas.style.cssText,label:canvas.getAttribute('aria-label'),tabIndex:canvas.tabIndex};
 const pixelLimit=canvas.width*canvas.height;
 const scene=new three.Scene();scene.background=new three.Color('#181a20');
 const flat=request.flatImage?flatImagePreview(three,input.object):undefined;
 let imageObject=input.object;
 let clone=input.object.clone(true);clone.updateMatrixWorld(true);
 let box=new three.Box3().setFromObject(clone,true),centre=box.getCenter(new three.Vector3());const size=box.getSize(new three.Vector3());
 let extent=Math.max(size.x,size.y,size.z);
 if(box.isEmpty()||!Number.isFinite(extent)||extent<=0)throw Error('DETAIL_BOUNDS_UNAVAILABLE');
 const pivot=new three.Group(),contents=new three.Group();
 pivot.position.copy(centre);contents.position.copy(centre).negate();contents.add(clone);pivot.add(contents);scene.add(pivot);
 const markerGeometry=request.anchors.length?new three.SphereGeometry(extent*.015,12,8):undefined;
 const markerMaterial=markerGeometry?new three.MeshBasicMaterial({color:0xffd067,depthTest:false}):undefined;
 for(const anchor of request.anchors){const marker=new three.Mesh(markerGeometry!,markerMaterial!);marker.position.fromArray(anchor.position);marker.renderOrder=1;clone.add(marker);}
 scene.add(new three.HemisphereLight(0xffffff,0x333344,.6));
 const light=new three.DirectionalLight(0xffffff,2);light.position.set(3,4,5);scene.add(light);
 const camera=new three.PerspectiveCamera(45,1,.01,100);
 let view=request.view,disposed=false,unsafeModelDraw=false;
 const render=()=>{
  if(disposed||unsafeModelDraw||request.beforeRender?.()===false)return false;
  const width=Math.max(1,request.host.clientWidth),height=Math.max(1,request.host.clientHeight);
  const ratio=Math.min(saved.ratio,Math.sqrt(pixelLimit/(width*height)));
  if(renderer.getPixelRatio()!==ratio)renderer.setPixelRatio(ratio);
  const current=renderer.getSize(new three.Vector2());
  if(current.x!==width||current.y!==height||canvas.width!==Math.floor(width*ratio)||canvas.height!==Math.floor(height*ratio))renderer.setSize(width,height,false);
  if(flat){const state=flat.render(renderer,width,height,view);request.imageViewport?.(state.viewport);canvas.dataset.detailState=JSON.stringify({sharedRenderer:true,borrowed:true,flatImage:true,...state});input.onFlatImageDraw?.(imageObject);return true;}
  camera.aspect=width/height;
  const fit=metricCameraFit(extent,camera.aspect,view.zoom);camera.near=fit.near;camera.far=fit.far;camera.updateProjectionMatrix();
  camera.position.copy(centre).add(new three.Vector3(0,0,fit.distance));camera.lookAt(centre);
  pivot.rotation.set(view.pitch*Math.PI/180,view.yaw*Math.PI/180,0,'YXZ');
  const environment=input.environment();scene.environment=environment.map;scene.environmentIntensity=environment.intensity;
  renderer.render(scene,camera);
  canvas.dataset.detailState=JSON.stringify({sharedRenderer:true,borrowed:true,rotationX:pivot.rotation.x,rotationY:pivot.rotation.y,zoom:view.zoom,cameraPosition:camera.position.toArray(),clipping:[camera.near,camera.far],artifactBounds:{min:box.min.toArray(),max:box.max.toArray()},anchors:request.anchors.map(a=>a.position)});return true;
 };
 const observer=new ResizeObserver(render);
 const dispose=()=>{
  if(disposed)return;disposed=true;observer.disconnect();request.signal.removeEventListener('abort',dispose);
  flat?.dispose();scene.clear();markerGeometry?.dispose();markerMaterial?.dispose();
  delete canvas.dataset.detailState;let keepHidden:boolean;try{keepHidden=request.keepHiddenOnDispose?.()===true||unsafeModelDraw;}catch{keepHidden=true;}canvas.style.cssText=saved.style;if(keepHidden)canvas.style.visibility='hidden';canvas.tabIndex=saved.tabIndex;
  if(saved.label===null)canvas.removeAttribute('aria-label');else canvas.setAttribute('aria-label',saved.label);
  if(next?.parentNode===parent)parent.insertBefore(canvas,next);else parent.appendChild(canvas);
  let deferred:boolean;try{deferred=request.deferRestore?.()===true||unsafeModelDraw;}catch{deferred=true;}if(!deferred){renderer.setPixelRatio(saved.ratio);renderer.setSize(saved.size.x,saved.size.y);}
  input.onRelease();
 };
 try{
  canvas.style.width='100%';canvas.style.height='100%';canvas.style.pointerEvents='none';canvas.tabIndex=-1;
  canvas.setAttribute('aria-label',flat?'작품 정면 이미지':'작품 상세 3D 미리보기');request.host.appendChild(canvas);
  request.signal.addEventListener('abort',dispose,{once:true});observer.observe(request.host);render();
 }catch(error){dispose();throw error;}
 return {render,replaceImage(object:Three.Object3D){
  if(!flat)return;
  const previous=imageObject,rollback=flat.replace(object);
  imageObject=object;
  try{render();}catch(error){imageObject=previous;rollback();throw error;}
 },
  /** The caller owns both objects and may swap only after independently proving
   * their identity, budget and coordinates. Existing anchors are not silently
   * projected onto a different model. A false draw is not a committed swap. */
  replaceModel(object:Three.Object3D){
   if(disposed||unsafeModelDraw||flat||request.anchors.length)throw Error('DETAIL_MODEL_SWAP_UNAVAILABLE');
   const next=object.clone(true);next.updateMatrixWorld(true);const nextBox=new three.Box3().setFromObject(next,true),nextSize=nextBox.getSize(new three.Vector3()),nextCentre=nextBox.getCenter(new three.Vector3()),nextExtent=Math.max(nextSize.x,nextSize.y,nextSize.z);
   if(nextBox.isEmpty()||!Number.isFinite(nextExtent)||nextExtent<=0)throw Error('DETAIL_BOUNDS_UNAVAILABLE');
   const previous={clone,box,centre,extent};contents.remove(clone);contents.add(next);clone=next;box=nextBox;centre=nextCentre;extent=nextExtent;pivot.position.copy(centre);contents.position.copy(centre).negate();
   const rollback=()=>{contents.remove(next);contents.add(previous.clone);({clone,box,centre,extent}=previous);pivot.position.copy(centre);contents.position.copy(centre).negate();};
   let drawn:boolean;try{drawn=render();}catch(error){rollback();unsafeModelDraw=true;canvas.style.visibility='hidden';throw error;}
   if(!drawn){rollback();throw Error('DETAIL_DRAW_UNCONFIRMED');}
  },update(nextView){view=nextView;render();},dispose};
}

/** Callback for the existing viewer statistics tick; owns no timer or admission. */
export function createFlatDetailRetry(input:{valid():boolean;pending():boolean;retryAfter():number;now():number;ready():boolean;request():void}){
 return ()=>{
  if(!input.valid()||input.pending()||input.retryAfter()>input.now())return;
  try{if(input.ready())return;}catch{return;}
  input.request();
 };
}
