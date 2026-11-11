// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import * as three from 'three';
import {clippedBoxPoints,selectShadowDependencies,shadowReceiverRegions} from './shadow-interest';
import {installBoundedShadows,SHADOW_RESERVE_BYTES} from './shadows';
import {AssetScheduler} from './loading';
import {hasViewDemand,viewQueuePriority,retainPreparationDemand} from './view-interest';
const box=(x:number,y:number,z:number,r=.3)=>new three.Box3(new three.Vector3(x-r,y-r,z-r),new three.Vector3(x+r,y+r,z+r));
function cameras(){
 const view=new three.PerspectiveCamera(60,1,.1,30);view.position.set(0,2,5);view.lookAt(0,0,0);view.updateMatrixWorld();
 const light=new three.OrthographicCamera(-12,12,12,-12,.1,80);light.position.set(0,20,20);light.lookAt(0,0,0);light.updateMatrixWorld();
 return {view,light,capture:new three.Box3(new three.Vector3(-10,-1,-10),new three.Vector3(10,10,10)),floor:new three.Box3(new three.Vector3(-2,-.005,-5),new three.Vector3(2,.005,2))};
}
it('offscreen metadata can supply a shadow onto the visible floor without admitting unrelated same-capture projection',()=>{
 const h=cameras(),caster=box(0,8,6),irrelevant=box(7,8,6);
 expect(clippedBoxPoints(three,caster,h.view)).toHaveLength(0);
 const regions=shadowReceiverRegions(three,[h.floor],h.capture,h.view,h.light);
 expect(regions.length).toBeGreaterThan(0);
 const report=selectShadowDependencies(three,[{id:'behind',box:caster,distance:6},{id:'unrelated',box:irrelevant,distance:7}],h.capture,regions,h.light);
 expect(report).toEqual({ids:['behind'],candidates:1,admitted:1,deferred:0});
});
it('dependency admission deduplicates artwork revisions and keeps a global two-revision bound',()=>{
 const h=cameras(),regions=shadowReceiverRegions(three,[h.floor],h.capture,h.view,h.light),caster=box(0,8,6);
 const rows=[{id:'a',distance:3},{id:'b',distance:2},{id:'c',distance:1},{id:'a',distance:4}].map(row=>({...row,box:caster}));
 expect(selectShadowDependencies(three,rows,h.capture,regions,h.light)).toEqual({ids:['c','b'],candidates:3,admitted:2,deferred:1});
});
it('the real perspective light frustum handles spot fallback rather than fabricating directional coverage',()=>{
 const h=cameras(),spot=new three.PerspectiveCamera(60,1,.1,30);spot.position.set(0,10,0);spot.up.set(0,0,-1);spot.lookAt(0,0,0);spot.updateMatrixWorld();
 const regions=shadowReceiverRegions(three,[h.floor],h.capture,h.view,spot);
 expect(selectShadowDependencies(three,[{id:'inside',box:box(0,1,0),distance:3},{id:'outside',box:box(9,8,0),distance:9}],h.capture,regions,spot).ids).toEqual(['inside']);
});
it('Compact and disabled depth passes create no artwork dependencies',()=>{
 for(const [compact,bytes]of [[true,SHADOW_RESERVE_BYTES],[false,0]] as const){
  const room=new three.Group(),light=new three.DirectionalLight(),renderer={shadowMap:{enabled:false,autoUpdate:true,type:three.BasicShadowMap}} as unknown as three.WebGLRenderer;
  const pass=installBoundedShadows(three,renderer,[{room,light}],compact,bytes,()=>{});pass.flush();
  expect(pass.dependencies([{id:'unseen',box:box(0,1,0),distance:1}],cameras().view)).toEqual({ids:[],candidates:0,admitted:0,deferred:0});pass.dispose();
 }
});
it('soft shadow demand has priority after visible/current work and before speculative preparation',()=>{
 const cold={visible:false,next:false,recent:false,connected:false,distance:4},shadow={...cold,shadow:true};
 expect(viewQueuePriority({...cold,visible:true},false,false)).toBeLessThan(viewQueuePriority(shadow,false,false));
 expect(viewQueuePriority(shadow,false,false)).toBeLessThan(viewQueuePriority({...cold,next:true},false,false,true));
 expect(hasViewDemand(shadow)).toBe(true);expect(hasViewDemand(cold)).toBe(false);
});

it('single-variant preparation becoming solely a shadow minimum keeps its in-flight transport and serial slot',async()=>{
 let finish!:()=>void;let starts=0;
 const scheduler=new AssetScheduler({concurrency:1,load:async()=>{starts++;await new Promise<void>(resolve=>{finish=resolve;});return 'single-variant';}});
 const task={prepareOnly:true},pending=scheduler.request('same-inventory');await Promise.resolve();
 if(!retainPreparationDemand(false,false,true))scheduler.cancel('same-inventory');
 task.prepareOnly=false;const promoted=scheduler.request('same-inventory');
 expect(promoted).toBe(pending);expect(task.prepareOnly).toBe(false);expect(scheduler.stats()).toMatchObject({active:1,cancelled:0});
 finish();await promoted;expect(starts).toBe(1);scheduler.dispose();
});
