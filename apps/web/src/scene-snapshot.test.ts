// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,test,vi} from 'vitest';
import * as three from 'three';
import {captureScenePng,SCENE_SNAPSHOT_SCRATCH_BOUND,SCENE_SNAPSHOT_RESERVE_BYTES,SCENE_SNAPSHOT_MAX_PNG_BYTES} from './scene-snapshot';
afterEach(()=>vi.unstubAllGlobals());
function fixture(pixelRatio=1,backbuffer=false){
 const scene=new three.Scene(),model=new three.Group(),object=new three.Mesh(new three.BoxGeometry(1,1,1),new three.MeshBasicMaterial());model.add(object);scene.add(model);let alive=true;const overlay=new three.Object3D();scene.add(overlay);
 const initialTarget=new three.WebGLRenderTarget(3,4);initialTarget.viewport.set(0,1,3,3);initialTarget.scissor.set(1,0,2,4);initialTarget.scissorTest=true;
 const viewport=new three.Vector4(1,2,3,4),scissor=new three.Vector4(2,3,4,5),startingTarget=backbuffer?null:initialTarget;
 let target:three.WebGLRenderTarget|null=startingTarget,scissorTest=true,physicalScissorTest=true;
 const physicalViewport=backbuffer?viewport.clone().multiplyScalar(pixelRatio).round():initialTarget.viewport.clone(),physicalScissor=backbuffer?scissor.clone().multiplyScalar(pixelRatio).round():initialTarget.scissor.clone();
 const originalPhysicalViewport=physicalViewport.clone(),originalPhysicalScissor=physicalScissor.clone();let drawn:Uint8ClampedArray|undefined,projectedCentre:[number,number]|undefined;
 const canvas={width:0,height:0,getContext:()=>({putImageData:(data:{data:Uint8ClampedArray})=>{drawn=data.data;}}),toBlob:(done:(blob:Blob)=>void)=>done(new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'}))};
 vi.stubGlobal('document',{createElement:()=>canvas});vi.stubGlobal('ImageData',class {constructor(public data:Uint8ClampedArray,public width:number,public height:number){}});
 // Mirror Three's separate logical screen rectangles and physical target
 // rectangles. setViewport ALWAYS applies DPR, even with a target bound.
 const renderer={xr:{isPresenting:false},autoClear:false,getPixelRatio:()=>pixelRatio,getContext:()=>({isContextLost:()=>false}),getRenderTarget:()=>target,getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,getViewport:(v:three.Vector4)=>v.copy(viewport),getCurrentViewport:(v:three.Vector4)=>v.copy(physicalViewport),getScissor:(v:three.Vector4)=>v.copy(scissor),getScissorTest:()=>scissorTest,
  setRenderTarget:vi.fn((next:three.WebGLRenderTarget|null)=>{target=next;physicalViewport.copy(next?next.viewport:viewport.clone().multiplyScalar(pixelRatio).floor());physicalScissor.copy(next?next.scissor:scissor.clone().multiplyScalar(pixelRatio).floor());physicalScissorTest=next?next.scissorTest:scissorTest;}),
  setViewport:vi.fn((v:three.Vector4|number,y?:number,w?:number,h?:number)=>{if(typeof v==='number')viewport.set(v,y!,w!,h!);else viewport.copy(v);physicalViewport.copy(viewport).multiplyScalar(pixelRatio).round();}),
  setScissor:vi.fn((v:three.Vector4)=>{scissor.copy(v);physicalScissor.copy(v).multiplyScalar(pixelRatio).round();}),setScissorTest:vi.fn((value:boolean)=>{scissorTest=value;physicalScissorTest=value;}),
  render:vi.fn((_scene:three.Scene,camera:three.Camera)=>{expect(overlay.visible).toBe(false);expect(physicalViewport.toArray()).toEqual([0,0,640,360]);expect(physicalScissor.toArray()).toEqual([0,0,640,360]);expect(physicalScissorTest).toBe(false);const centre=new three.Vector3().project(camera);projectedCentre=[physicalViewport.x+(centre.x+1)*physicalViewport.z/2,360-(physicalViewport.y+(centre.y+1)*physicalViewport.w/2)];}),
  readRenderTargetPixels:vi.fn((_t:unknown,_x:number,_y:number,_w:number,_h:number,bytes:Uint8Array)=>{bytes[0]=5;bytes[(359*640)*4]=9;})};
 const input={three,renderer:renderer as unknown as three.WebGLRenderer,scene,near:.01,far:100,camera:{viewpointId:'view',roomId:'room',position:[0,0,3] as [number,number,number],target:[0,0,0] as [number,number,number],fov:50},target:object,occluders:model,placementId:'placement',artworkRevisionId:'revision',assetId:'approved-source',signal:new AbortController().signal,valid:()=>alive,withoutOverlays:(draw:()=>void)=>{const old=overlay.visible;try{overlay.visible=false;draw();}finally{overlay.visible=old;}}};
 const assertRestored=()=>{expect(target).toBe(startingTarget);expect(viewport.toArray()).toEqual([1,2,3,4]);expect(scissor.toArray()).toEqual([2,3,4,5]);expect(scissorTest).toBe(true);expect(physicalViewport.toArray()).toEqual(originalPhysicalViewport.toArray());expect(physicalScissor.toArray()).toEqual(originalPhysicalScissor.toArray());expect(physicalScissorTest).toBe(true);expect(renderer.getPixelRatio()).toBe(pixelRatio);expect(renderer.autoClear).toBe(false);expect(overlay.visible).toBe(true);expect(canvas.width).toBe(0);};return {input,renderer,canvas,scene,model,assertRestored,drawn:()=>drawn,centre:()=>projectedCentre,stale:()=>{alive=false;}};
}

test('captures admitted geometry with upright readback and restores renderer/overlays',async()=>{
 const f=fixture(),result=await captureScenePng(f.input);expect(result).toMatchObject({width:640,height:360,target:{ready:true,inFrustum:true,centerRay:'clear',assetId:'approved-source'}});expect(f.drawn()![0]).toBe(9);expect(f.drawn()![(359*640)*4]).toBe(5);f.assertRestored();expect(SCENE_SNAPSHOT_SCRATCH_BOUND).toBeLessThan(SCENE_SNAPSHOT_RESERVE_BYTES);
});
test('restores exact renderer and overlay state on render failure',async()=>{
 const f=fixture();f.renderer.render.mockImplementation(()=>{throw Error('DRAW_FAILED');});await expect(captureScenePng(f.input)).rejects.toThrow('DRAW_FAILED');f.assertRestored();
});
test('reports center occlusion without pretending it proves whole-target visibility',async()=>{
 const f=fixture(),wall=new three.Mesh(new three.BoxGeometry(2,2,.1),new three.MeshBasicMaterial());wall.position.z=1.5;f.model.add(wall);expect((await captureScenePng(f.input)).target.centerRay).toBe('blocked');f.assertRestored();
});
test('rejects stale and oversized encodes after restoring renderer state',async()=>{
 const f=fixture();f.canvas.toBlob=done=>{f.stale();done(new Blob(['png']));};await expect(captureScenePng(f.input)).rejects.toThrow('SCENE_SNAPSHOT_UNAVAILABLE');f.assertRestored();const g=fixture();g.canvas.toBlob=done=>done(new Blob([new Uint8Array(SCENE_SNAPSHOT_MAX_PNG_BYTES+1)]));await expect(captureScenePng(g.input)).rejects.toThrow('SCENE_SNAPSHOT_PNG_LIMIT');g.assertRestored();
});


test('bounds instance ray work and keeps unknown diagnostic without suppressing the image',async()=>{
 const f=fixture(),instances=new three.InstancedMesh(new three.BoxGeometry(1,1,1),new three.MeshBasicMaterial(),3000);f.model.add(instances);const result=await captureScenePng(f.input);expect(result.target.centerRay).toBe('unknown');f.assertRestored();
});
test('abort settles a stalled encoder and ignores its late callback after cleanup',async()=>{
 const f=fixture(),abort=new AbortController();let callback:((blob:Blob)=>void)|undefined;f.canvas.toBlob=done=>{callback=done;};const pending=captureScenePng({...f.input,signal:abort.signal});expect(callback).toBeDefined();abort.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});f.assertRestored();callback!(new Blob(['late png']));f.assertRestored();
});

test.each([1,1.25,2,3])('uses physical target pixels at DPR %s and restores screen or target state',async ratio=>{
 for(const backbuffer of [false,true]){const f=fixture(ratio,backbuffer);await captureScenePng(f.input);expect(f.centre()).toEqual([320,180]);expect(f.renderer.setViewport).toHaveBeenCalledTimes(backbuffer?1:0);expect(f.renderer.setScissor).toHaveBeenCalledTimes(backbuffer?1:0);expect(f.renderer.setScissorTest).toHaveBeenCalledTimes(backbuffer?1:0);f.assertRestored();}
});

test('inspection capture returns its exact temporary pose and restores the owner on success',async()=>{
 const f=fixture(2,true),camera={inspection:true as const,roomId:'room',position:[0,0,3] as [number,number,number],target:[0,0,0] as [number,number,number],fov:50,localPosition:[0,0,3] as [number,number,number],localTarget:[0,0,0] as [number,number,number]},before=structuredClone(camera);
 const result=await captureScenePng({...f.input,camera});expect(result.camera).toEqual(camera);expect(camera).toEqual(before);expect(f.centre()).toEqual([320,180]);f.assertRestored();
});

test('failed and cancelled inspection captures restore renderer and overlays before settling',async()=>{
 const camera={inspection:true as const,roomId:'room',position:[0,0,3] as [number,number,number],target:[0,0,0] as [number,number,number],fov:50,localPosition:[0,0,3] as [number,number,number],localTarget:[0,0,0] as [number,number,number]},before=structuredClone(camera),f=fixture(2,true);
 f.renderer.render.mockImplementation(()=>{throw Error('DRAW_FAILED');});await expect(captureScenePng({...f.input,camera})).rejects.toThrow('DRAW_FAILED');f.assertRestored();
 const g=fixture(1.25,true),abort=new AbortController();let late:((blob:Blob)=>void)|undefined;g.canvas.toBlob=done=>{late=done;};
 const pending=captureScenePng({...g.input,camera,signal:abort.signal});expect(late).toBeDefined();abort.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});g.assertRestored();late!(new Blob(['late inspection png']));g.assertRestored();expect(camera).toEqual(before);
});
test('applies owner visibility before snapshot ray diagnostics',async()=>{const f=fixture(),wall=new three.Mesh(new three.BoxGeometry(2,2,.1),new three.MeshBasicMaterial());wall.position.z=1.5;f.model.add(wall);const checked=vi.fn(()=>{wall.visible=false;});const result=await captureScenePng({...f.input,beforeDiagnostics:checked});expect(checked).toHaveBeenCalledOnce();expect(result.target.centerRay).toBe('clear');f.assertRestored();});
