// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {PerspectiveCamera,Vector3} from 'three';
import type {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {PRESENTATION_NAMESPACE} from '@exhibitos/studio-contract';
import {newDraft} from '../drafts/example';
import {applyGeometryCommand,createGeometryState} from '../geometry/model';
import {createWalkingCamera} from './navigation-camera';
import type {NavigationState} from './navigation';
afterEach(()=>vi.unstubAllGlobals());
it('the ready map boundary uses real floor/capsule clearance, preserves a refused camera and commits only a paused authored view',async()=>{
 const draft=newDraft().candidate,roomId=draft.rooms[0]!.id,document=applyGeometryCommand(createGeometryState(draft),{type:'white-cube',roomId}).present;
 document.artworks=[];document.placements=[];
 const safe=crypto.randomUUID(),unsafe=crypto.randomUUID();
 document.extensions={...document.extensions,[PRESENTATION_NAMESPACE]:{version:1,credits:'',viewpoints:[{id:safe,name:'Authored standing view',roomId,position:[1,1.65,1],target:[1,1,0],fov:50},{id:unsafe,name:'Inside wall',roomId,position:[0,1.65,-3.99],target:[0,1,0],fov:50}]}};
 const owner=Object.assign(new EventTarget(),{activeElement:null as unknown,pointerLockElement:null as unknown,hidden:false,exitPointerLock:vi.fn()});
 const canvas=Object.assign(new EventTarget(),{dataset:{} as Record<string,string>,style:{touchAction:''},focus:vi.fn(()=>{owner.activeElement=canvas;}),getBoundingClientRect:()=>({left:0,width:100})}) as unknown as HTMLCanvasElement;
 // Rapier's browser clock reads window.performance when the DOM fixture exists.
 vi.stubGlobal('document',owner);vi.stubGlobal('window',Object.assign(new EventTarget(),{performance}));vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));vi.stubGlobal('cancelAnimationFrame',vi.fn());
 const camera=new PerspectiveCamera(63,1,.01,100);camera.position.set(0,1.65,3);camera.lookAt(0,1,0);
 const controls={enabled:true,target:new Vector3(0,1,0),update(){}} as OrbitControls,states:NavigationState[]=[],mode=vi.fn();
 const adapter=await createWalkingCamera({document,camera,initialCamera:camera.clone(),controls,canvas,settings:{speed:1.3,eyeHeight:1.65,reducedMotion:true},render(){},onMode:mode,onMessage(){},onState:state=>states.push(state)});
 try{
  const position=camera.position.clone(),rotation=camera.quaternion.clone(),fov=camera.fov;
  expect(adapter.actions.visitViewpoint!(unsafe)).toBe(false);expect(camera.position.toArray()).toEqual(position.toArray());expect(camera.quaternion.toArray()).toEqual(rotation.toArray());expect(camera.fov).toBe(fov);
  adapter.actions.start();adapter.actions.press('forward',7);
  expect(adapter.actions.visitViewpoint!(safe)).toBe(true);expect(camera.position.x).toBeCloseTo(1);expect(camera.position.z).toBeCloseTo(1);expect(camera.fov).toBe(50);expect(mode.mock.lastCall).toEqual([false,true]);expect(states.at(-1)).toMatchObject({paused:true,velocity:[0,0,0]});
 }finally{adapter.dispose();}
 const stopped=camera.position.toArray();expect(adapter.actions.visitViewpoint!(safe)).toBe(false);expect(camera.position.toArray()).toEqual(stopped);
});
