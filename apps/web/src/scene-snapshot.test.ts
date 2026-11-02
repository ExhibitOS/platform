// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,test,vi} from 'vitest';
import * as three from 'three';
import {captureScenePng,SCENE_SNAPSHOT_SCRATCH_BOUND,SCENE_SNAPSHOT_RESERVE_BYTES,SCENE_SNAPSHOT_MAX_PNG_BYTES} from './scene-snapshot';
afterEach(()=>vi.unstubAllGlobals());
function fixture(){
 const scene=new three.Scene(),model=new three.Group(),object=new three.Mesh(new three.BoxGeometry(1,1,1),new three.MeshBasicMaterial());model.add(object);scene.add(model);let alive=true;const overlay=new three.Object3D();scene.add(overlay);
 const initialTarget=new three.WebGLRenderTarget(3,4),viewport=new three.Vector4(1,2,3,4),scissor=new three.Vector4(2,3,4,5);let target:three.WebGLRenderTarget|null=initialTarget,test=true;let drawn:Uint8ClampedArray|undefined;
 const canvas={width:0,height:0,getContext:()=>({putImageData:(data:{data:Uint8ClampedArray})=>{drawn=data.data;}}),toBlob:(done:(blob:Blob)=>void)=>done(new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'}))};
 vi.stubGlobal('document',{createElement:()=>canvas});vi.stubGlobal('ImageData',class {constructor(public data:Uint8ClampedArray,public width:number,public height:number){}});
 const renderer={xr:{isPresenting:false},autoClear:false,getContext:()=>({isContextLost:()=>false}),getRenderTarget:()=>target,getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,getViewport:(v:three.Vector4)=>v.copy(viewport),getScissor:(v:three.Vector4)=>v.copy(scissor),getScissorTest:()=>test,setRenderTarget:vi.fn((next:three.WebGLRenderTarget|null)=>{target=next;}),setViewport:vi.fn((v:three.Vector4|number,y?:number,w?:number,h?:number)=>{if(typeof v==='number')viewport.set(v,y!,w!,h!);else viewport.copy(v);}),setScissor:vi.fn((v:three.Vector4)=>scissor.copy(v)),setScissorTest:vi.fn((value:boolean)=>{test=value;}),render:vi.fn(()=>{expect(overlay.visible).toBe(false);}),readRenderTargetPixels:vi.fn((_t:unknown,_x:number,_y:number,_w:number,_h:number,bytes:Uint8Array)=>{bytes[0]=5;bytes[(359*640)*4]=9;})};
 const input={three,renderer:renderer as unknown as three.WebGLRenderer,scene,near:.01,far:100,camera:{viewpointId:'view',roomId:'room',position:[0,0,3] as [number,number,number],target:[0,0,0] as [number,number,number],fov:50},target:object,occluders:model,placementId:'placement',artworkRevisionId:'revision',assetId:'approved-source',signal:new AbortController().signal,valid:()=>alive,withoutOverlays:(draw:()=>void)=>{const old=overlay.visible;try{overlay.visible=false;draw();}finally{overlay.visible=old;}}};
 const assertRestored=()=>{expect(target).toBe(initialTarget);expect(viewport.toArray()).toEqual([1,2,3,4]);expect(scissor.toArray()).toEqual([2,3,4,5]);expect(test).toBe(true);expect(renderer.autoClear).toBe(false);expect(overlay.visible).toBe(true);expect(canvas.width).toBe(0);};return {input,renderer,canvas,scene,model,assertRestored,drawn:()=>drawn,stale:()=>{alive=false;}};
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
