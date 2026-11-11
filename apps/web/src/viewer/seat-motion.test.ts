// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,test,vi} from 'vitest';
import * as Three from 'three';
import type {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {applyBenchCommand,PRESENTATION_NAMESPACE} from '@exhibitos/studio-contract';
import {newDraft} from '../drafts/example';
import {applyGeometryCommand,createGeometryState} from '../geometry/model';
import {createWalkingCamera} from './navigation-camera';
import {createPanelResumeGate} from './panel-resume';
import {furnishingCollisionMesh,type MountedFurnishingCollision} from './furnishing-collision-mesh';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
function fixture(){
 const base=newDraft().candidate,roomId=base.rooms[0]!.id;
 const d=applyGeometryCommand(createGeometryState(base),{type:'white-cube',roomId}).present;
 d.artworks=[];d.placements=[];d.extensions={...d.extensions,[PRESENTATION_NAMESPACE]:{version:1,credits:'',viewpoints:[]}};
 const benchId=crypto.randomUUID(),viewpointId=crypto.randomUUID();
 return {benchId,document:applyBenchCommand(d,{type:'add-bench',bench:{id:benchId,name:'Seat',roomId,position:[0,0,0],yaw:0,kind:'backed',dimensions:{width:1.5,depth:.7,height:.45},material:{preset:'wood',color:'#755741',roughness:.7,metalness:0},viewpointId},viewpoint:{id:viewpointId,name:'Seat view',roomId,position:[0,1.15,-.08],target:[0,1,-3],fov:50}})};
}
async function harness(reducedMotion=false,configure?:(d:ReturnType<typeof fixture>['document'])=>void){
 const f=fixture();configure?.(f.document);
 const camera=new Three.PerspectiveCamera(63,1,.01,100);camera.position.set(0,1.65,3);camera.rotation.set(.1,Math.PI-.02,0,'YXZ');
 const doc=Object.assign(new EventTarget(),{hidden:false,activeElement:null as unknown,pointerLockElement:null,exitPointerLock:vi.fn()});
 const win=new EventTarget(),frames=new Map<number,FrameRequestCallback>();let now=0,id=0;
 const canvas=Object.assign(new EventTarget(),{dataset:{} as Record<string,string>,style:{touchAction:''},focus:vi.fn(()=>{doc.activeElement=canvas;}),setPointerCapture:vi.fn(),hasPointerCapture:()=>false,getBoundingClientRect:()=>({left:0,width:100})}) as unknown as HTMLCanvasElement;
 vi.stubGlobal('document',doc);vi.stubGlobal('window',win);
 vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.set(++id,callback);return id;});
 vi.stubGlobal('cancelAnimationFrame',(key:number)=>frames.delete(key));
 const gate=createPanelResumeGate(),messages:string[]=[],rendered:{eye:number[];quaternion:number[];state:Record<string,unknown>}[]=[];
 const controls={enabled:true,target:new Three.Vector3(0,1.2,0),update(){}} as OrbitControls;
 let sources:MountedFurnishingCollision[]=[];
 const adapter=await createWalkingCamera({document:f.document,camera,initialCamera:camera.clone(),controls,canvas,settings:{speed:1.3,eyeHeight:1.65,reducedMotion},
  render:()=>rendered.push({eye:camera.position.toArray(),quaternion:camera.quaternion.toArray(),state:JSON.parse(canvas.dataset.navigationState!)}),
  onMode:(walking,paused,reason)=>gate.mode(walking,paused,reason),onMessage:message=>messages.push(message),wasWalkingBeforeSeat:gate.wasWalkingBeforeSeat,furnishingCollisions:()=>sources});
 vi.spyOn(performance,'now').mockImplementation(()=>now);
 const advance=(time:number)=>{now=time;const pending=[...frames.values()];frames.clear();for(const callback of pending)callback(time);};
 const pointer=(type:string,x:number,y:number)=>canvas.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),{pointerType:'touch',pointerId:1,isPrimary:true,button:0,clientX:x,clientY:y}));
 return {...f,camera,canvas,doc,win,frames,controls,gate,messages,rendered,adapter,advance,pointer,time:()=>now,state:()=>JSON.parse(canvas.dataset.navigationState!),setSources:(value:MountedFurnishingCollision[])=>{sources=value;adapter.actions.refreshFurnishingCollisions?.();}};
}
test('sit interpolates actual translation and shortest quaternion to the exact authored seat',async()=>{
 const yaw=-Math.PI+.02;
 const h=await harness(false,d=>{const p=(d.extensions![PRESENTATION_NAMESPACE] as unknown as {viewpoints:{target:number[]}[]}).viewpoints[0]!;p.target=[-Math.sin(yaw)*2,1.15,-.08-Math.cos(yaw)*2];});
 try{
  h.adapter.actions.start();const from=h.camera.quaternion.clone();h.adapter.actions.sit!(h.benchId);
  h.pointer('pointerdown',10,10);h.pointer('pointermove',90,40);h.adapter.actions.move!(7,1,1);
  h.advance(175);expect(h.camera.position.z).toBeCloseTo(1.46);expect(h.camera.position.y).toBeCloseTo(1.4);
  expect(h.camera.quaternion.angleTo(from)).toBeLessThan(.12);expect(h.state()).toMatchObject({paused:true,walking:false,grounded:false,velocity:[0,0,0],seatTransition:{phase:'sit',progress:.5}});
  expect(h.state().eyePosition).toEqual(h.camera.position.toArray());expect(h.state().cameraQuaternion).toEqual(h.camera.quaternion.toArray());
  h.advance(350);expect(h.camera.position.toArray()).toEqual([0,1.15,-.08]);
  expect(h.camera.quaternion.angleTo(new Three.Quaternion().setFromEuler(new Three.Euler(0,yaw,0,'YXZ')))).toBeLessThan(1e-7);
  expect(h.state().seatTransition).toBeNull();expect(h.frames.size).toBe(0);
  const seated=h.camera.quaternion.clone();h.pointer('pointerdown',10,10);h.pointer('pointermove',50,30);h.pointer('pointerup',50,30);h.advance(366);
  expect(h.camera.quaternion.angleTo(seated)).toBeGreaterThan(.01);expect(h.camera.position.toArray()).toEqual([0,1.15,-.08]);
 }finally{h.adapter.dispose();}
});
test('two rises use the nearest clear landing and keep the current seated gaze plus fresh-input eligibility',async()=>{
 const h=await harness();try{
  for(let cycle=0;cycle<2;cycle++){
   h.adapter.actions.start();h.adapter.actions.sit!(h.benchId);h.advance(h.time()+350);
   h.pointer('pointerdown',10,10);h.pointer('pointermove',45,25);h.pointer('pointerup',45,25);h.advance(h.time()+16);
   const gaze=h.camera.quaternion.clone(),start=h.time();h.adapter.actions.stand!();
   h.advance(start+175);expect(h.state().seatTransition.phase).toBe('stand');expect(h.camera.quaternion.angleTo(gaze)).toBeLessThan(1e-7);
   h.advance(start+350);expect(h.camera.position.x).toBeCloseTo(0);expect(h.camera.position.z).toBeCloseTo(-.61);expect(h.camera.position.y).toBeCloseTo(1.661,4);
   expect(h.camera.quaternion.angleTo(gaze)).toBeLessThan(1e-7);expect(h.state()).toMatchObject({grounded:true,paused:true,velocity:[0,0,0],seatTransition:null});
   expect(h.controls.target.clone().sub(h.camera.position).normalize().distanceTo(h.camera.getWorldDirection(new Three.Vector3()))).toBeLessThan(1e-7);
   expect(h.gate.movement(true)).toBe(true);h.adapter.actions.start();const before=h.camera.position.clone();h.adapter.actions.move!(9,0,1);h.advance(h.time()+100);h.adapter.actions.release(9);
   expect(h.camera.position.distanceTo(before)).toBeGreaterThan(0);expect(h.camera.position.distanceTo(before)).toBeLessThan(.2);
  }
 }finally{h.adapter.dispose();}
});
test('reduced motion and a newly enabled reduced-motion preference settle without a pending lock',async()=>{
 const h=await harness();try{
  h.adapter.actions.start();h.adapter.actions.sit!(h.benchId);h.advance(100);
  h.adapter.actions.settings({speed:1.3,eyeHeight:1.65,reducedMotion:true});
  expect(h.camera.position.toArray()).toEqual([0,1.15,-.08]);expect(h.frames.size).toBe(0);expect(h.state().seatTransition).toBeNull();
  h.adapter.actions.stand!();expect(h.camera.position.z).toBeCloseTo(-.61);expect(h.frames.size).toBe(0);expect(h.gate.canResume()).toBe(true);
 }finally{h.adapter.dispose();}
});
test('manual/background stops settle a valid endpoint and disposal retires every pending completion',async()=>{
 const h=await harness();try{
  h.adapter.actions.start();h.adapter.actions.sit!(h.benchId);h.advance(100);h.adapter.actions.pause('user');
  expect(h.camera.position.toArray()).toEqual([0,1.15,-.08]);expect(h.frames.size).toBe(0);
  h.adapter.actions.stand!();h.advance(200);h.doc.hidden=true;h.doc.dispatchEvent(new Event('visibilitychange'));
  expect(h.state().seatTransition).toBeNull();expect(h.state().paused).toBe(true);expect(h.gate.canResume()).toBe(false);const fixed=h.camera.position.toArray();h.advance(10000);expect(h.camera.position.toArray()).toEqual(fixed);
  h.doc.hidden=false;h.adapter.actions.start();h.adapter.actions.sit!(h.benchId);const draws=h.rendered.length;h.adapter.dispose();h.advance(20000);expect(h.rendered).toHaveLength(draws);expect(h.frames.size).toBe(0);
 }finally{h.adapter.dispose();}
});
test('a newly loaded surrounding obstacle prevents an unqualified standing destination',async()=>{
 const h=await harness(true);const group=new Three.Group();try{
  h.adapter.actions.start();h.adapter.actions.sit!(h.benchId);
  for(const [x,z,w,d]of [[0,-.7,3,.05],[0,.7,3,.05],[-1.05,0,.05,1.45],[1.05,0,.05,1.45]]){const mesh=new Three.Mesh(new Three.BoxGeometry(w,3,d));mesh.position.set(x!,1.5,z!);group.add(mesh);}
  const mesh=furnishingCollisionMesh(Three,group)!;h.setSources([{id:'blocked-rising-test',mesh,active:()=>true}]);
  const before=h.camera.position.toArray();h.adapter.actions.stand!();expect(h.camera.position.toArray()).toEqual(before);expect(h.state()).toMatchObject({walking:false,paused:true,seatTransition:null});expect(h.messages.at(-1)).toContain('유지');
 }finally{h.adapter.dispose();group.traverse(node=>{if(node instanceof Three.Mesh){node.geometry.dispose();(node.material as Three.Material).dispose();}});}
});
test('sitting never interpolates the camera through an intervening wall, even with reduced motion',async()=>{
 const h=await harness(true,d=>{const wall=d.surfaces.find(s=>s.type==='wall')!;d.surfaces.push({...structuredClone(wall),id:crypto.randomUUID(),transform:{position:[0,1.5,1],rotation:[0,0,0,1],scale:[1,1,1]},dimensions:{width:2,height:3}});});
 try{h.adapter.actions.start();const before=h.camera.position.toArray();h.adapter.actions.sit!(h.benchId);expect(h.camera.position.toArray()).toEqual(before);expect(h.state().walking).toBe(true);expect(h.state().seatTransition).toBeNull();expect(h.messages.at(-1)).toContain('안전');}
 finally{h.adapter.dispose();}
});
