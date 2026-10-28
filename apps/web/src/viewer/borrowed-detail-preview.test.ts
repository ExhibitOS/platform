// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,test,vi} from 'vitest';
import * as three from 'three';
import {AssetPeakBudget} from './loading';
import {borrowedDetailPreview,createFlatDetailRetry} from './borrowed-detail-preview';

afterEach(()=>vi.unstubAllGlobals());
function fixture(renderFails=false){
 let disconnected=0,released=0,geometryDisposed=0,materialDisposed=0,textureDisposed=0;
 vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){disconnected++;}});
 const attributes=new Map([['aria-label','전시 공간 3D 미리보기']]);
 const canvas={parentNode:null as unknown,nextSibling:null,width:1920,height:1080,tabIndex:0,style:{cssText:'width:1280px;height:720px'},dataset:{} as Record<string,string>,getAttribute:(name:string)=>attributes.get(name)??null,setAttribute:(name:string,value:string)=>{attributes.set(name,value);},removeAttribute:(name:string)=>{attributes.delete(name);}};
 const parent={appendChild(value:typeof canvas){value.parentNode=this;},insertBefore(value:typeof canvas){value.parentNode=this;}};parent.appendChild(canvas);
 const target={isConnected:true,clientWidth:640,clientHeight:360,appendChild(value:typeof canvas){value.parentNode=this;}};
 let width=1280,height=720,ratio=1.5,lastScene:three.Scene|undefined;
 const renderer={domElement:canvas,getSize(value:three.Vector2){return value.set(width,height);},getPixelRatio:()=>ratio,setPixelRatio(value:number){ratio=value;},setSize(w:number,h:number){width=w;height=h;canvas.width=Math.floor(w*ratio);canvas.height=Math.floor(h*ratio);},render(scene:three.Scene){lastScene=scene;if(renderFails)throw Error('GPU_UNAVAILABLE');}};
 const texture=new three.Texture(),geometry=new three.BoxGeometry(2,3,1),material=new three.MeshStandardMaterial({map:texture});
 geometry.addEventListener('dispose',()=>geometryDisposed++);material.addEventListener('dispose',()=>materialDisposed++);texture.addEventListener('dispose',()=>textureDisposed++);
 const object=new three.Mesh(geometry,material);object.position.set(1,2,3);object.updateMatrixWorld(true);
 const before=object.matrixWorld.toArray(),abort=new AbortController();
 const create=()=>borrowedDetailPreview({three,renderer:renderer as unknown as three.WebGLRenderer,object,request:{placementId:'placement',host:target as unknown as HTMLElement,signal:abort.signal,view:{yaw:0,pitch:0,zoom:1},anchors:[{id:'note',position:[0,0,0],text:'annotation'}],unavailable(){}},environment:()=>({map:null,intensity:.45}),onRelease(){released++;}});
 return {canvas,parent,target,object,geometry,material,before,abort,create,read:()=>({width,height,ratio,lastScene,disconnected,released,geometryDisposed,materialDisposed,textureDisposed})};
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
