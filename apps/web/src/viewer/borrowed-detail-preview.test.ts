// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,test,vi} from 'vitest';
import * as three from 'three';
import {AssetPeakBudget} from './loading';
import {borrowedDetailPreview,createFlatDetailRetry} from './borrowed-detail-preview';

afterEach(()=>vi.unstubAllGlobals());
function fixture(renderFails=false,beforeRender?:()=>boolean,flatImage=false,keepHiddenOnDispose?:()=>boolean,deferRestore?:()=>boolean,anchors=true){
 let shouldFail=renderFails;
 let disconnected=0,released=0,geometryDisposed=0,materialDisposed=0,textureDisposed=0,renders=0,resizes=0;
 vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){disconnected++;}});
 const attributes=new Map([['aria-label','전시 공간 3D 미리보기']]);
 const canvas={parentNode:null as unknown,nextSibling:null,width:1920,height:1080,tabIndex:0,style:{cssText:'width:1280px;height:720px',visibility:''},dataset:{} as Record<string,string>,getAttribute:(name:string)=>attributes.get(name)??null,setAttribute:(name:string,value:string)=>{attributes.set(name,value);},removeAttribute:(name:string)=>{attributes.delete(name);}};
 const parent={appendChild(value:typeof canvas){value.parentNode=this;},insertBefore(value:typeof canvas){value.parentNode=this;}};parent.appendChild(canvas);
 const target={isConnected:true,clientWidth:640,clientHeight:360,appendChild(value:typeof canvas){value.parentNode=this;}};
 let width=1280,height=720,ratio=1.5,lastScene:three.Scene|undefined;
 const renderer={domElement:canvas,getSize(value:three.Vector2){return value.set(width,height);},getPixelRatio:()=>ratio,setPixelRatio(value:number){ratio=value;},setSize(w:number,h:number){resizes++;width=w;height=h;canvas.width=Math.floor(w*ratio);canvas.height=Math.floor(h*ratio);},render(scene:three.Scene){renders++;lastScene=scene;scene.traverse(node=>{if(node instanceof three.Mesh)canvas.dataset.pixelMarker=node.geometry.uuid;});if(shouldFail)throw Error('GPU_UNAVAILABLE');}};
 const texture=new three.Texture({width:4,height:3}),geometry=new three.BoxGeometry(2,3,1),material=new three.MeshStandardMaterial({map:texture});
 geometry.addEventListener('dispose',()=>geometryDisposed++);material.addEventListener('dispose',()=>materialDisposed++);texture.addEventListener('dispose',()=>textureDisposed++);
 const object=new three.Mesh(geometry,material);object.position.set(1,2,3);object.updateMatrixWorld(true);
 const before=object.matrixWorld.toArray(),abort=new AbortController();
 const create=()=>borrowedDetailPreview({three,renderer:renderer as unknown as three.WebGLRenderer,object,request:{placementId:'placement',host:target as unknown as HTMLElement,signal:abort.signal,view:{yaw:0,pitch:0,zoom:1},beforeRender,flatImage,keepHiddenOnDispose,deferRestore,anchors:anchors?[{id:'note',position:[0,0,0],text:'annotation'}]:[],unavailable(){}},environment:()=>({map:null,intensity:.45}),onRelease(){released++;}});
 return {canvas,parent,target,object,geometry,material,before,abort,create,setRenderFails:(value:boolean)=>{shouldFail=value;},read:()=>({width,height,ratio,lastScene,disconnected,released,geometryDisposed,materialDisposed,textureDisposed,renders,resizes})};
}

test('borrows one canvas and mesh resources; abort restores dimensions and releases only annotations once',()=>{
 const f=fixture(),session=f.create();
 expect(f.canvas.parentNode).toBe(f.target);
 const scene=f.read().lastScene!,meshes:three.Mesh[]=[];scene.traverse(node=>{if(node instanceof three.Mesh)meshes.push(node);});
 expect(meshes.some(mesh=>mesh!==f.object&&mesh.geometry===f.geometry&&mesh.material===f.material)).toBe(true);
 const marker=meshes.find(mesh=>mesh.geometry!==f.geometry)!;let markerDisposed=0;marker.geometry.addEventListener('dispose',()=>markerDisposed++);
 session.update({yaw:35,pitch:-10,zoom:2});
 expect(f.object.matrixWorld.toArray()).toEqual(f.before);
 expect(f.canvas.width*f.canvas.height).toBeLessThanOrEqual(1920*1080);
 expect(JSON.parse(f.canvas.dataset.detailState!).sharedRenderer).toBe(true);
 f.abort.abort();session.dispose();
 expect(f.canvas.parentNode).toBe(f.parent);expect(f.canvas.tabIndex).toBe(0);expect(f.canvas.getAttribute('aria-label')).toBe('전시 공간 3D 미리보기');
 expect(f.canvas.style.cssText).toBe('width:1280px;height:720px');expect(f.canvas.dataset.detailState).toBeUndefined();
 expect(f.read()).toMatchObject({width:1280,height:720,ratio:1.5,released:1,disconnected:1,geometryDisposed:0,materialDisposed:0,textureDisposed:0});
 expect(markerDisposed).toBe(1);expect(f.object.matrixWorld.toArray()).toEqual(f.before);
});

test('failed first draw restores canvas and ownership instead of disposing the admitted artwork',()=>{
 const f=fixture(true);expect(()=>f.create()).toThrow('GPU_UNAVAILABLE');
 expect(f.canvas.parentNode).toBe(f.parent);expect(f.canvas.dataset.detailState).toBeUndefined();
 expect(f.read()).toMatchObject({width:1280,height:720,ratio:1.5,released:1,disconnected:1,geometryDisposed:0,materialDisposed:0,textureDisposed:0});
});

test('deferred flat detail retries once when budget frees, without duplicate or closed/aborted retries',()=>{
 function deferred(){
  let resident=8,time=0,after=0,pending=false,ready=false,alive=true,owner=true,attempts=0,deferredCount=0;
  const abort=new AbortController(),budget=new AssetPeakBudget(10,()=>resident);
  const tick=createFlatDetailRetry({valid:()=>alive&&!abort.signal.aborted&&owner,pending:()=>pending,retryAfter:()=>after,now:()=>time,ready:()=>ready,request:()=>{
   attempts++;try{budget.reserve('full',4);pending=true;}catch{deferredCount++;after=time+400;}
  }});
  return {tick,abort,free:()=>{resident=2;},time:(v:number)=>{time=v;},close:()=>{alive=false;},replace:()=>{owner=false;},complete:()=>{budget.release('full');resident+=4;pending=false;ready=true;},read:()=>({attempts,deferredCount,pending,ready})};
 }
 const f=deferred();f.tick();expect(f.read()).toEqual({attempts:1,deferredCount:1,pending:false,ready:false});
 f.free();f.time(200);f.tick();expect(f.read().attempts).toBe(1); // Existing retry grace still owns admission.
 f.time(400);f.tick();expect(f.read()).toEqual({attempts:2,deferredCount:1,pending:true,ready:false});
 for(let i=0;i<5;i++)f.tick();expect(f.read().attempts).toBe(2);
 f.complete();f.tick();expect(f.read()).toMatchObject({attempts:2,pending:false,ready:true});
 for(const stop of ['close','abort','replace'] as const){const ended=deferred();ended.tick();if(stop==='close')ended.close();else if(stop==='abort')ended.abort.abort();else ended.replace();ended.free();ended.time(500);ended.tick();expect(ended.read().attempts,stop).toBe(1);}
});

test('suppresses every direct borrowed draw after the owner guard becomes invalid',()=>{
 let allowed=true;const f=fixture(false,()=>allowed),session=f.create(),before=f.read().renders;allowed=false;session.update({yaw:20,pitch:0,zoom:1});session.render();expect(f.read().renders).toBe(before);session.dispose();expect(f.read().released).toBe(1);
});

test('a failed baseline redraw can block later direct renders instead of redrawing the rolled-back image',()=>{
 let blocked=false;const f=fixture(false,()=>!blocked,true),session=f.create();session.replaceImage(f.object);f.setRenderFails(true);try{session.replaceImage(f.object);}catch{blocked=true;}f.setRenderFails(false);const count=f.read().renders;session.update({yaw:0,pitch:0,zoom:1});session.render();expect(f.read().renders).toBe(count);session.dispose();expect(f.read().released).toBe(1);
});

test('keeps the painted image and interaction when a candidate draw is suppressed',()=>{
 let allowed=true;const f=fixture(false,()=>allowed,true),scope=f.create();
 scope.update({yaw:0,pitch:0,zoom:1.25,panX:12,panY:7});
 const committed=f.canvas.dataset.detailState;
 allowed=false;expect(()=>scope.replaceImage(f.object)).toThrow('DETAIL_DRAW_UNCONFIRMED');
 expect(f.canvas.dataset.detailState).toBe(committed);
 allowed=true;expect(scope.render()).toBe(true);expect(f.canvas.dataset.detailState).toBe(committed);
 scope.dispose();
});

test('retains hidden canvas presentation during blocked scope return without freeing gallery resources',()=>{
 const f=fixture(false,undefined,true,()=>true),scope=f.create();scope.dispose();expect(f.canvas.parentNode).toBe(f.parent);expect(f.canvas.style.visibility).toBe('hidden');expect(f.read()).toMatchObject({released:1,geometryDisposed:0,materialDisposed:0,textureDisposed:0});
});

test('returns a hidden canvas without resizing its buffer while an original attempt drains',()=>{
 const f=fixture(false,undefined,true,()=>true,()=>true),scope=f.create(),before=f.read();scope.dispose();expect(f.canvas.parentNode).toBe(f.parent);expect(f.canvas.style.visibility).toBe('hidden');expect(f.read().resizes).toBe(before.resizes);expect(f.read()).toMatchObject({released:1,geometryDisposed:0,materialDisposed:0,textureDisposed:0});
});

test('does not reset the drawing buffer for unchanged detail draws or interaction',()=>{
 const f=fixture(false,undefined,true),scope=f.create(),count=f.read().resizes;scope.render();scope.update({yaw:0,pitch:0,zoom:1.5});scope.replaceImage(f.object);expect(f.read().resizes).toBe(count);scope.dispose();
});


test('commits a borrowed sculpture swap only after drawing, without taking either model ownership',()=>{
 const f=fixture(false,undefined,false,undefined,undefined,false),scope=f.create();const geometry=new three.BoxGeometry(5,2,1),material=new three.MeshStandardMaterial(),next=new three.Mesh(geometry,material);next.position.set(4,1,-2);next.updateMatrixWorld(true);const before=next.matrixWorld.toArray(),dispose=vi.spyOn(geometry,'dispose');
 scope.replaceModel(next);const meshes:three.Mesh[]=[];f.read().lastScene!.traverse(node=>{if(node instanceof three.Mesh)meshes.push(node);});expect(meshes.some(node=>node.geometry===geometry)).toBe(true);expect(meshes.some(node=>node.geometry===f.geometry)).toBe(false);expect(next.matrixWorld.toArray()).toEqual(before);expect(JSON.parse(f.canvas.dataset.detailState!).artifactBounds.max[0]).toBeGreaterThan(4);scope.dispose();expect(dispose).not.toHaveBeenCalled();expect(f.read()).toMatchObject({geometryDisposed:0,materialDisposed:0,textureDisposed:0});
});

test('rejects unqualified anchors and restores the prior model on draw failure or a suppressed draw',()=>{
 const anchored=fixture(),anchoredScope=anchored.create();expect(()=>anchoredScope.replaceModel(new three.Mesh(new three.BoxGeometry(),new three.MeshBasicMaterial()))).toThrow('DETAIL_MODEL_SWAP_UNAVAILABLE');anchoredScope.dispose();
 const f=fixture(false,undefined,false,undefined,undefined,false),scope=f.create(),next=new three.Mesh(new three.BoxGeometry(4,1,1),new three.MeshStandardMaterial());f.setRenderFails(true);expect(()=>scope.replaceModel(next)).toThrow('GPU_UNAVAILABLE');expect(f.canvas.dataset.pixelMarker).toBe(f.geometry.uuid);expect(f.canvas.style.visibility).toBe('hidden');f.setRenderFails(false);expect(scope.render()).toBe(false);const meshes:three.Mesh[]=[];f.read().lastScene!.traverse(node=>{if(node instanceof three.Mesh)meshes.push(node);});expect(meshes.some(node=>node.geometry===f.geometry)).toBe(true);expect(meshes.some(node=>node.geometry===next.geometry)).toBe(false);const resizes=f.read().resizes;scope.dispose();expect(f.canvas.style.visibility).toBe('hidden');expect(f.read().resizes).toBe(resizes);
 let accepted=true;const g=fixture(false,()=>accepted,false,undefined,undefined,false),other=g.create();accepted=false;expect(()=>other.replaceModel(next)).toThrow('DETAIL_DRAW_UNCONFIRMED');accepted=true;expect(other.render()).toBe(true);const retained:three.Mesh[]=[];g.read().lastScene!.traverse(node=>{if(node instanceof three.Mesh)retained.push(node);});expect(retained.some(node=>node.geometry===g.geometry)).toBe(true);other.dispose();
});

test('rejects empty models and unavailable preview scopes before committing a sculpture swap',()=>{
 const f=fixture(false,undefined,false,undefined,undefined,false),scope=f.create();expect(()=>scope.replaceModel(new three.Group())).toThrow('DETAIL_BOUNDS_UNAVAILABLE');scope.dispose();expect(()=>scope.replaceModel(f.object)).toThrow('DETAIL_MODEL_SWAP_UNAVAILABLE');
 const flat=fixture(false,undefined,true,undefined,undefined,false),flatScope=flat.create();expect(()=>flatScope.replaceModel(flat.object)).toThrow('DETAIL_MODEL_SWAP_UNAVAILABLE');flatScope.dispose();
});
