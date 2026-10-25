// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {PerspectiveCamera,Vector3} from 'three';
import type {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {PRESENTATION_NAMESPACE} from '@exhibitos/studio-contract';
import {newDraft} from '../drafts/example';
import {applyGeometryCommand,createGeometryState} from '../geometry/model';
import {syntheticArtwork,newPlacement} from '../placement/model';
import {createNavigationController} from './navigation';
import {createWalkingCamera} from './navigation-camera';

afterEach(()=>vi.unstubAllGlobals());
function room(){let s=createGeometryState(newDraft().candidate);s=applyGeometryCommand(s,{type:'white-cube',roomId:s.present.rooms[0]!.id});return s.present;}
function canvasFixture(){
 const doc=Object.assign(new EventTarget(),{activeElement:null as unknown,pointerLockElement:null,hidden:false,exitPointerLock:vi.fn()});
 const canvas=Object.assign(new EventTarget(),{dataset:{} as Record<string,string>,style:{touchAction:''},focus:()=>{doc.activeElement=canvas;}});
 let frame:FrameRequestCallback|undefined;
 vi.stubGlobal('document',doc);vi.stubGlobal('window',Object.assign(new EventTarget(),{performance}));
 vi.stubGlobal('requestAnimationFrame',vi.fn((next:FrameRequestCallback)=>{frame=next;return 1;}));vi.stubGlobal('cancelAnimationFrame',vi.fn());
 return {canvas:canvas as unknown as HTMLCanvasElement,tick:()=>{if(!frame)throw Error('NO_FRAME');frame(performance.now()+30);}};
}
const settings={speed:1.3 as const,eyeHeight:1.6,reducedMotion:true};

it('enters a valid no-camera implicit floor from an unsafe overview using world floor transforms without editing the document',async()=>{
 const document=newDraft().candidate,room=document.rooms[0]!;
 room.transform.position=[10,2,-7];room.transform.rotation=[0,Math.SQRT1_2,0,Math.SQRT1_2];
 const before=structuredClone(document),camera=new PerspectiveCamera(48);camera.position.set(40,30,40);camera.lookAt(10,2,-7);
 const {canvas,tick}=canvasFixture(),controls={enabled:true,target:new Vector3(),update:vi.fn()};
 const runtime=await createWalkingCamera({document,camera,controls:controls as unknown as OrbitControls,canvas,settings,render:vi.fn(),onMode:vi.fn(),onMessage:vi.fn()});
 try{
  runtime.actions.start();tick();
  const state=JSON.parse(canvas.dataset.navigationState!);
  expect(state.grounded).toBe(true);expect(state.velocity).toEqual([0,0,0]);
  expect(camera.position.x).toBeCloseTo(10,5);expect(camera.position.z).toBeCloseTo(-7,5);expect(camera.position.y).toBeGreaterThan(3.6);expect(camera.position.y).toBeLessThan(3.7);
  expect(camera.rotation.x).toBe(0);expect(camera.rotation.y).toBe(0);
  const effectiveStart=camera.position.clone();
  runtime.actions.stationary();camera.position.set(40,30,40);camera.rotation.set(.6,1.5,0);
  runtime.actions.reset();expect(camera.position.toArray()).toEqual(effectiveStart.toArray());expect(camera.rotation.x).toBe(0);expect(camera.rotation.y).toBe(0);expect(document).toEqual(before);
 }finally{runtime.dispose();}
});

it.each(['authored','explicit viewpoint'] as const)('preserves an existing %s camera rather than selecting the default',async kind=>{
 const document=room(),camera=new PerspectiveCamera(48);camera.position.set(1,1.6,2);camera.rotation.set(-.15,.7,0,'YXZ');
 if(kind==='authored')document.extensions={...document.extensions,[PRESENTATION_NAMESPACE]:{version:1,viewpoints:[],credits:'',startCamera:{roomId:document.rooms[0]!.id,position:[1,1.6,2],target:camera.position.clone().add(new Vector3(0,0,-1).applyQuaternion(camera.quaternion)).toArray(),fov:48}}};
 const before=structuredClone(document),{canvas,tick}=canvasFixture(),controls={enabled:true,target:new Vector3(),update:vi.fn()};
 const initialCamera=kind==='explicit viewpoint'?camera.clone():undefined;
 const runtime=await createWalkingCamera({document,camera,initialCamera,controls:controls as unknown as OrbitControls,canvas,settings,render:vi.fn(),onMode:vi.fn(),onMessage:vi.fn()});
 try{runtime.actions.start();tick();expect(camera.position.x).toBe(1);expect(camera.position.z).toBe(2);expect(camera.rotation.x).toBeCloseTo(-.15,8);expect(camera.rotation.y).toBeCloseTo(.7,8);camera.position.set(40,30,40);camera.rotation.set(.5,2,0);runtime.actions.reset();expect(camera.position.x).toBe(1);expect(camera.position.z).toBe(2);expect(camera.rotation.x).toBeCloseTo(-.15,8);expect(camera.rotation.y).toBeCloseTo(.7,8);expect(document).toEqual(before);}finally{runtime.dispose();}
});

it('selects a qualified nearby mesh cell when the unauthored floor center is occupied',async()=>{
 const document=room(),artwork=syntheticArtwork('sculpture');document.artworks=[artwork];document.placements=[newPlacement(artwork,document.rooms[0]!.id)];document.placements[0]!.transform.position=[0,.5,0];
 const before=structuredClone(document),controller=await createNavigationController(document,{});
 try{const state=controller.state();expect(state.grounded).toBe(true);expect(controller.isWalkable(state.eyePosition)).toBe(true);expect(Math.hypot(state.eyePosition[0],state.eyePosition[2])).toBeGreaterThan(.5);expect(state.velocity).toEqual([0,0,0]);expect(state.paused).toBe(true);controller.reset({position:[0,1.6,3]});expect(controller.reset().eyePosition).toEqual(state.eyePosition);expect(document).toEqual(before);}finally{controller.dispose();}
});

it('retains strict refusal for unsafe authored poses and scenes with no usable standing floor',async()=>{
 const authored=room();authored.extensions={...authored.extensions,[PRESENTATION_NAMESPACE]:{version:1,viewpoints:[],credits:'',startCamera:{roomId:authored.rooms[0]!.id,position:[6,1.6,0],target:[0,1.6,0],fov:48}}};
 await expect(createNavigationController(authored,{position:[6,1.6,0]})).rejects.toThrow('NAVIGATION_SPAWN_UNSAFE');
 await expect(createNavigationController(authored,{})).rejects.toThrow('NAVIGATION_SPAWN_UNSAFE');
 const low=room();low.rooms[0]!.dimensions.height=1;await expect(createNavigationController(low,{})).rejects.toThrow('NAVIGATION_SPAWN_UNSAFE');
 const noFloor=room();noFloor.surfaces.find(s=>s.type==='floor')!.transform.rotation=[0,0,0,1];await expect(createNavigationController(noFloor,{})).rejects.toThrow('NAVIGATION_SPAWN_UNSAFE');
});
