// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import {metricCameraFit} from './metric-model';
import type {DetailView} from './detail-gesture';

export interface SharedDetailSession {update(view:DetailView):void;dispose():void}
export interface SharedDetailRequest {
 placementId:string;host:HTMLElement;signal:AbortSignal;view:DetailView;
 anchors:readonly {id:string;position:[number,number,number];text:string}[];
 unavailable(reason:'rights'|'graphics'):void;
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
}):SharedDetailSession&{render():void}{
 const {three,renderer,request}=input,canvas=renderer.domElement;
 request.signal.throwIfAborted();
 const parent=canvas.parentNode,next=canvas.nextSibling;
 if(!parent||!request.host.isConnected)throw Error('DETAIL_HOST_UNAVAILABLE');
 const saved={size:renderer.getSize(new three.Vector2()),ratio:renderer.getPixelRatio(),style:canvas.style.cssText,label:canvas.getAttribute('aria-label'),tabIndex:canvas.tabIndex};
 const pixelLimit=canvas.width*canvas.height;
 const scene=new three.Scene();scene.background=new three.Color('#181a20');
 const clone=input.object.clone(true);clone.updateMatrixWorld(true);
 const box=new three.Box3().setFromObject(clone,true),size=box.getSize(new three.Vector3()),centre=box.getCenter(new three.Vector3());
 const extent=Math.max(size.x,size.y,size.z);
 if(box.isEmpty()||!Number.isFinite(extent)||extent<=0)throw Error('DETAIL_BOUNDS_UNAVAILABLE');
 const pivot=new three.Group(),contents=new three.Group();
 pivot.position.copy(centre);contents.position.copy(centre).negate();contents.add(clone);pivot.add(contents);scene.add(pivot);
 const markerGeometry=request.anchors.length?new three.SphereGeometry(extent*.015,12,8):undefined;
 const markerMaterial=markerGeometry?new three.MeshBasicMaterial({color:0xffd067,depthTest:false}):undefined;
 for(const anchor of request.anchors){const marker=new three.Mesh(markerGeometry!,markerMaterial!);marker.position.fromArray(anchor.position);marker.renderOrder=1;clone.add(marker);}
 scene.add(new three.HemisphereLight(0xffffff,0x333344,.6));
 const light=new three.DirectionalLight(0xffffff,2);light.position.set(3,4,5);scene.add(light);
 const camera=new three.PerspectiveCamera(45,1,.01,100);
 let view=request.view,disposed=false;
 const render=()=>{
  if(disposed)return;
  const width=Math.max(1,request.host.clientWidth),height=Math.max(1,request.host.clientHeight);
  renderer.setPixelRatio(Math.min(saved.ratio,Math.sqrt(pixelLimit/(width*height))));renderer.setSize(width,height,false);
  camera.aspect=width/height;
  const fit=metricCameraFit(extent,camera.aspect,view.zoom);camera.near=fit.near;camera.far=fit.far;camera.updateProjectionMatrix();
  camera.position.copy(centre).add(new three.Vector3(0,0,fit.distance));camera.lookAt(centre);
  pivot.rotation.set(view.pitch*Math.PI/180,view.yaw*Math.PI/180,0,'YXZ');
  const environment=input.environment();scene.environment=environment.map;scene.environmentIntensity=environment.intensity;
  renderer.render(scene,camera);
  canvas.dataset.detailState=JSON.stringify({sharedRenderer:true,borrowed:true,rotationX:pivot.rotation.x,rotationY:pivot.rotation.y,zoom:view.zoom,cameraPosition:camera.position.toArray(),clipping:[camera.near,camera.far],artifactBounds:{min:box.min.toArray(),max:box.max.toArray()},anchors:request.anchors.map(a=>a.position)});
 };
 const observer=new ResizeObserver(render);
 const dispose=()=>{
  if(disposed)return;disposed=true;observer.disconnect();request.signal.removeEventListener('abort',dispose);
  scene.clear();markerGeometry?.dispose();markerMaterial?.dispose();
  delete canvas.dataset.detailState;canvas.style.cssText=saved.style;canvas.tabIndex=saved.tabIndex;
  if(saved.label===null)canvas.removeAttribute('aria-label');else canvas.setAttribute('aria-label',saved.label);
  if(next?.parentNode===parent)parent.insertBefore(canvas,next);else parent.appendChild(canvas);
  renderer.setPixelRatio(saved.ratio);renderer.setSize(saved.size.x,saved.size.y);
  input.onRelease();
 };
 try{
  canvas.style.width='100%';canvas.style.height='100%';canvas.style.pointerEvents='none';canvas.tabIndex=-1;
  canvas.setAttribute('aria-label','작품 상세 3D 미리보기');request.host.appendChild(canvas);
  request.signal.addEventListener('abort',dispose,{once:true});observer.observe(request.host);render();
 }catch(error){dispose();throw error;}
 return {render,update(nextView){view=nextView;render();},dispose};
}
