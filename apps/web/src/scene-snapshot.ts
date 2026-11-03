// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {InspectionCamera} from './scene-snapshot-camera';
export const SCENE_SNAPSHOT_WIDTH=640;
export const SCENE_SNAPSHOT_HEIGHT=360;
export const SCENE_SNAPSHOT_MAX_PNG_BYTES=512*1024;
export const SCENE_SNAPSHOT_MAX_BASE64=699052;
export const SCENE_SNAPSHOT_RESERVE_BYTES=16*1024*1024;
// Seven RGBA-sized buffers plus conservative encoded/string/bridge copies.
export const SCENE_SNAPSHOT_SCRATCH_BOUND=7*640*360*4+18*SCENE_SNAPSHOT_MAX_PNG_BYTES+4096;
export type SceneSnapshotInput={placementId:string;width:640;height:360}&({viewpointId:string}|{inspectionCamera:InspectionCamera});
interface SnapshotCameraPose {roomId:string;position:[number,number,number];target:[number,number,number];fov:number}
export type SceneSnapshotCamera=SnapshotCameraPose&({viewpointId:string}|{inspection:true;localPosition:[number,number,number];localTarget:[number,number,number]});
export interface SceneSnapshotImage {camera:SceneSnapshotCamera;width:640;height:360;target:{placementId:string;artworkRevisionId:string;assetId:string;ready:true;inFrustum:boolean;centerRay:'clear'|'blocked'|'unknown'};pngBase64:string}
export type SceneSnapshotCapture=(request:SceneSnapshotInput,signal:AbortSignal)=>Promise<SceneSnapshotImage>;
function visible(object:Three.Object3D){for(let node:Three.Object3D|null=object;node;node=node.parent)if(!node.visible)return false;return true;}
/** Only a temporary camera/target/encoding scratch is owned here. The admitted
 * scene, renderer, user camera, controls and selection remain with the host. */
export async function captureScenePng(input:{three:typeof Three;renderer:Three.WebGLRenderer;scene:Three.Scene;near:number;far:number;camera:SceneSnapshotCamera;target:Three.Object3D;occluders:Three.Object3D;placementId:string;artworkRevisionId:string;assetId:string;signal:AbortSignal;withoutOverlays(draw:()=>void):void;valid():boolean}):Promise<SceneSnapshotImage>{
 const {three,renderer,scene,signal}=input;
 const check=()=>{signal.throwIfAborted();if(!input.valid()||renderer.getContext().isContextLost()||renderer.xr.isPresenting)throw Error('SCENE_SNAPSHOT_UNAVAILABLE');};
 check();
 const camera=new three.PerspectiveCamera(input.camera.fov,640/360,input.near,input.far);camera.position.fromArray(input.camera.position);camera.lookAt(new three.Vector3(...input.camera.target));camera.updateMatrixWorld();scene.updateMatrixWorld(true);
 const bounds=new three.Box3().setFromObject(input.target,true);if(bounds.isEmpty()||!visible(input.target))throw Error('SCENE_SNAPSHOT_TARGET_NOT_READY');
 const frustum=new three.Frustum().setFromProjectionMatrix(new three.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
 const inFrustum=frustum.intersectsBox(bounds),center=bounds.getCenter(new three.Vector3()),direction=center.clone().sub(camera.position),distance=direction.length();
 let centerRay:SceneSnapshotImage['target']['centerRay']='unknown';
 if(Number.isFinite(distance)&&distance>.01){
  const nodes=new Set<Three.Object3D>();input.target.traverse(node=>nodes.add(node));
  const ray=new three.Raycaster(camera.position,direction.normalize(),.001,distance+.01);
  // The diagnostic must not allocate an unbounded intersection roster. Large
  // scenes keep an explicit unknown result; the PNG itself still renders.
  const meshes:Three.Object3D[]=[];let triangles=0;
  input.occluders.traverse(node=>{if(node instanceof three.Mesh&&visible(node)){const count=node instanceof three.InstancedMesh?node.count:1;if(!Number.isSafeInteger(count)||count<0||node instanceof three.SkinnedMesh||node instanceof three.BatchedMesh||node.geometry instanceof three.InstancedBufferGeometry)triangles=Infinity;else triangles+=(node.geometry.index?.count??node.geometry.getAttribute('position')?.count??0)/3*count;if(meshes.length<256)meshes.push(node);else triangles=Infinity;}});
  if(triangles<=32768){const hits=ray.intersectObjects(meshes,false);const targetHit=hits.find(hit=>nodes.has(hit.object));if(targetHit)centerRay=hits.some(hit=>!nodes.has(hit.object)&&hit.distance<targetHit.distance-.001)?'blocked':'clear';}
 }
 const target=new three.WebGLRenderTarget(640,360,{depthBuffer:true,stencilBuffer:false,samples:0});target.texture.colorSpace=three.SRGBColorSpace;
 // Render-target rectangles are physical pixels. Renderer.setViewport uses
 // logical screen pixels and applies DPR again, cropping this target at DPR>1.
 target.viewport.set(0,0,640,360);target.scissor.set(0,0,640,360);target.scissorTest=false;
 let canvas:HTMLCanvasElement|undefined;
 try{
 const saved={target:renderer.getRenderTarget(),face:renderer.getActiveCubeFace(),mip:renderer.getActiveMipmapLevel(),viewport:renderer.getViewport(new three.Vector4()),scissor:renderer.getScissor(new three.Vector4()),scissorTest:renderer.getScissorTest(),autoClear:renderer.autoClear};
 const pixels=new Uint8Array(640*360*4),flipped=new Uint8ClampedArray(pixels.length);
 canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
  try{check();renderer.setRenderTarget(target);renderer.autoClear=true;input.withoutOverlays(()=>{renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,640,360,pixels);});}
  // No logical screen rectangles or DPR changed during capture. Restore screen
  // setters only AFTER rebinding (including fractional-DPR round semantics).
  // A parent target instead restores its own physical target rectangles.
  finally{renderer.setRenderTarget(saved.target,saved.face,saved.mip);if(!saved.target){renderer.setViewport(saved.viewport);renderer.setScissor(saved.scissor);renderer.setScissorTest(saved.scissorTest);}renderer.autoClear=saved.autoClear;}
  for(let row=0;row<360;row++)flipped.set(pixels.subarray(row*640*4,(row+1)*640*4),(359-row)*640*4);
  const context=canvas.getContext('2d');if(!context)throw Error('SCENE_SNAPSHOT_UNAVAILABLE');context.putImageData(new ImageData(flipped,640,360),0,0);
  const blob=await new Promise<Blob>((resolve,reject)=>{
   let settled=false;const finish=(value?:Blob,error?:unknown)=>{if(settled)return;settled=true;signal.removeEventListener('abort',aborted);if(error)reject(error);else if(value)resolve(value);else reject(Error('SCENE_SNAPSHOT_ENCODE'));};
   const aborted=()=>finish(undefined,signal.reason??Error('SCENE_SNAPSHOT_CANCELLED'));
   signal.addEventListener('abort',aborted,{once:true});if(signal.aborted){aborted();return;}
   try{canvas!.toBlob(value=>signal.aborted?aborted():finish(value??undefined),'image/png');}catch(error){finish(undefined,error);}
  });
  check();if(blob.size>SCENE_SNAPSHOT_MAX_PNG_BYTES)throw Error('SCENE_SNAPSHOT_PNG_LIMIT');
  const bytes=new Uint8Array(await blob.arrayBuffer());check();
  let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
  const pngBase64=btoa(binary);if(pngBase64.length>SCENE_SNAPSHOT_MAX_BASE64)throw Error('SCENE_SNAPSHOT_PNG_LIMIT');check();
  return {camera:input.camera,width:640,height:360,target:{placementId:input.placementId,artworkRevisionId:input.artworkRevisionId,assetId:input.assetId,ready:true,inFrustum,centerRay},pngBase64};
 }finally{target.dispose();if(canvas){canvas.width=0;canvas.height=0;}}
}
