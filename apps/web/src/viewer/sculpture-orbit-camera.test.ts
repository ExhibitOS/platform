// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {PerspectiveCamera,Vector3} from 'three';
import type {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {PRESENTATION_NAMESPACE} from '@exhibitos/studio-contract';
import {newDraft} from '../drafts/example';
import {whiteCubeSurfaces} from '../geometry/model';
import {createWalkingCamera} from './navigation-camera';
import {createNavigationController} from './navigation';
afterEach(()=>vi.unstubAllGlobals());
function fixture(){const document=newDraft().candidate,room=document.rooms[0]!;document.surfaces=whiteCubeSurfaces(room);document.artworks=[];document.placements=[];document.openings=[];return {document,room};}
it('the real capsule sweep rejects crossing a thin barrier even when both endpoints are legal, without pose mutation',async()=>{
 const {document,room}=fixture();document.surfaces.push({id:crypto.randomUUID(),roomId:room.id,type:'wall',dimensions:{width:3,height:.1},transform:{position:[0,.05,0],rotation:[0,0,0,1],scale:[1,1,1]}});
 const controller=await createNavigationController(document,{position:[0,1.65,2],eyeHeight:1.65});
 try{const a=controller.qualifiedStandingEye([0,1.65,1])!,b=controller.qualifiedStandingEye([0,1.65,-1])!,before=controller.state();expect(a).toBeDefined();expect(b).toBeDefined();expect(controller.standingSegmentClear(a,b)).toBe(false);expect(controller.state()).toEqual(before);}finally{controller.dispose();}
});
it('refuses unequal supported floor heights without reseeding the controller',async()=>{
 const {document,room}=fixture();document.surfaces.push({id:crypto.randomUUID(),roomId:room.id,type:'floor',dimensions:{width:3,height:2},transform:{position:[0,.2,-2],rotation:[-Math.SQRT1_2,0,0,Math.SQRT1_2],scale:[1,1,1]}});
 const controller=await createNavigationController(document,{position:[0,1.65,2],eyeHeight:1.65});
 try{const a=controller.state().eyePosition,b=controller.qualifiedStandingEye([0,1.85,-2])!,before=controller.state();expect(b).toBeDefined();expect(b[1]-a[1]).toBeCloseTo(.2);expect(controller.standingSegmentClear(a,b)).toBe(false);expect(controller.state()).toEqual(before);}finally{controller.dispose();}
});
it('ordered orbit preserves authored target/radius/height, refuses swept walls/stale contexts and allows reduced-motion steps',async()=>{
 const {document,room}=fixture(),id=crypto.randomUUID();document.surfaces.push({id:crypto.randomUUID(),roomId:room.id,type:'wall',dimensions:{width:6,height:3},transform:{position:[1.5,1.5,0],rotation:[0,Math.SQRT1_2,0,Math.SQRT1_2],scale:[1,1,1]}});
 document.extensions={...document.extensions,[PRESENTATION_NAMESPACE]:{version:1,credits:'',viewpoints:[{id,name:'Authored sculpture view',roomId:room.id,position:[0,1.65,2],target:[0,1,0],fov:50}]}};
 const owner=Object.assign(new EventTarget(),{activeElement:null as unknown,pointerLockElement:null as unknown,hidden:false,exitPointerLock:vi.fn()});
 const canvas=Object.assign(new EventTarget(),{dataset:{},style:{touchAction:''},focus:vi.fn(),getBoundingClientRect:()=>({left:0,width:100})}) as unknown as HTMLCanvasElement;
 vi.stubGlobal('document',owner);vi.stubGlobal('window',Object.assign(new EventTarget(),{performance}));vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));vi.stubGlobal('cancelAnimationFrame',vi.fn());
 const camera=new PerspectiveCamera(50,1,.01,100);camera.position.set(0,1.65,2);camera.lookAt(0,1,0);const controls={enabled:true,target:new Vector3(),update(){}} as OrbitControls;
 const adapter=await createWalkingCamera({document,camera,initialCamera:camera.clone(),controls,canvas,settings:{speed:1.3,eyeHeight:1.65,reducedMotion:false},render(){},onMode(){},onMessage(){}});
 try{
  expect(adapter.actions.visitViewpoint!(id,true)).toBe(true);const y=camera.position.y;expect(adapter.actions.orbitViewpoint!(id,Math.PI/18)).toBe(true);expect(Math.hypot(camera.position.x,camera.position.z)).toBeCloseTo(2);expect(camera.position.y).toBeCloseTo(y);expect(controls.target.toArray()).toEqual([0,1,0]);
  const before=camera.position.toArray();expect(adapter.actions.orbitViewpoint!(id,Math.PI/2)).toBe(false);expect(camera.position.toArray()).toEqual(before);expect(adapter.actions.orbitViewpoint!('stale',0)).toBe(false);
  adapter.actions.settings({speed:1.3,eyeHeight:1.65,reducedMotion:true});expect(adapter.actions.orbitViewpoint!(id,0)).toBe(true);adapter.actions.freeViewing!();expect(adapter.actions.orbitViewpoint!(id,.1)).toBe(false);
 }finally{adapter.dispose();}
 expect(adapter.actions.orbitViewpoint!(id,0)).toBe(false);
});
