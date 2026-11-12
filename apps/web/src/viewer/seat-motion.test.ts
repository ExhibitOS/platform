// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,test,vi} from 'vitest';
import * as Three from 'three';
import type {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {applyBenchCommand,PRESENTATION_NAMESPACE,BENCH_NAMESPACE} from '@exhibitos/studio-contract';
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
async function harness(reducedMotion=false,configure?:(d:ReturnType<typeof fixture>['document'])=>void,hooks?:{onSeatTransition?:(active:boolean)=>void;onSeat?:(id:string|null)=>void}){
 const f=fixture();configure?.(f.document);
 const camera=new Three.PerspectiveCamera(63,1,.01,100);camera.position.set(0,1.65,3);camera.rotation.set(.1,Math.PI-.02,0,'YXZ');
 const doc=Object.assign(new EventTarget(),{hidden:false,activeElement:null as unknown,pointerLockElement:null,exitPointerLock:vi.fn()});
 const win=Object.assign(new EventTarget(),{performance}),frames=new Map<number,FrameRequestCallback>();let now=0,id=0;
 const canvas=Object.assign(new EventTarget(),{dataset:{} as Record<string,string>,style:{touchAction:''},focus:vi.fn(()=>{doc.activeElement=canvas;}),setPointerCapture:vi.fn(),hasPointerCapture:()=>false,getBoundingClientRect:()=>({left:0,width:100})}) as unknown as HTMLCanvasElement;
 vi.stubGlobal('document',doc);vi.stubGlobal('window',win);
 vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.set(++id,callback);return id;});
 vi.stubGlobal('cancelAnimationFrame',(key:number)=>frames.delete(key));
 const gate=createPanelResumeGate(),messages:string[]=[],rendered:{eye:number[];quaternion:number[];state:Record<string,unknown>}[]=[];
 const controls={enabled:true,target:new Three.Vector3(0,1.2,0),update(){}} as OrbitControls;
 let sources:MountedFurnishingCollision[]=[];
 const adapter=await createWalkingCamera({...hooks,document:f.document,camera,initialCamera:camera.clone(),controls,canvas,settings:{speed:1.3,eyeHeight:1.65,reducedMotion},
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
 try{h.adapter.actions.start();const before=h.camera.position.toArray(),walking=h.state().walking;h.adapter.actions.sit!(h.benchId);expect(h.camera.position.toArray()).toEqual(before);expect(h.state().walking).toBe(walking);expect(h.state().seatTransition).toBeNull();expect(h.messages.at(-1)).toContain('다른 관람 위치');
  expect(JSON.parse(h.canvas.dataset.benchSeatRefusal!)).toEqual({version:1,reason:'BENCH_VIEW_PATH_UNSAFE',benchId:h.benchId,origin:before,seatEye:[0,1.15,-.08]});}
 finally{h.adapter.dispose();}
});

test('a valid wide bench chooses a nearby landing from an off-center seated eye',async()=>{
 const h=await harness(true,d=>{const value=d.extensions![BENCH_NAMESPACE] as unknown as {benches:{dimensions:{width:number;depth:number}}[]};value.benches[0]!.dimensions.width=3;value.benches[0]!.dimensions.depth=1;const view=(d.extensions![PRESENTATION_NAMESPACE] as unknown as {viewpoints:{position:number[]}[]}).viewpoints[0]!;view.position=[-1.4,1.15,-.08];});
 try{h.adapter.actions.start();h.adapter.actions.sit!(h.benchId);expect(h.camera.position.toArray()).toEqual([-1.4,1.15,-.08]);const before=h.camera.position.clone();h.adapter.actions.stand!();expect(Math.hypot(h.camera.position.x-before.x,h.camera.position.z-before.z)).toBeLessThanOrEqual(2);expect(h.state().grounded).toBe(true);}
 finally{h.adapter.dispose();}
});
test('stand during a newly obstructed sit retires the failed sit without starting another transition',async()=>{
 const h=await harness(),group=new Three.Group();try{
  h.adapter.actions.start();h.adapter.actions.sit!(h.benchId);
  const wall=new Three.Mesh(new Three.BoxGeometry(2,3,.02));wall.position.set(0,1.5,1);group.add(wall);
  h.setSources([{id:'stand-during-obstructed-sit',mesh:furnishingCollisionMesh(Three,group)!,active:()=>true}]);
  expect(()=>h.adapter.actions.stand!()).not.toThrow();expect(h.camera.position.z).toBeCloseTo(3);expect(h.state().seatTransition).toBeNull();expect(h.state().paused).toBe(true);expect(h.frames.size).toBe(0);
  const pose=h.camera.position.toArray();h.advance(1000);expect(h.camera.position.toArray()).toEqual(pose);
 }finally{h.adapter.dispose();group.traverse(node=>{if(node instanceof Three.Mesh){node.geometry.dispose();(node.material as Three.Material).dispose();}});}
});
for(const phase of ['sit','stand'] as const)for(const completion of ['frame','forced'] as const)test(`new head corridor obstruction cancels ${phase} on ${completion} completion`,async()=>{
 const h=await harness(),group=new Three.Group();try{
  h.adapter.actions.start();h.adapter.actions.sit!(h.benchId);
  if(phase==='stand'){h.advance(350);h.adapter.actions.stand!();}
  // It blocks the remaining head path but neither certified start nor end.
  const wall=new Three.Mesh(new Three.BoxGeometry(2,3,.02));wall.position.set(0,1.5,phase==='sit'?1:-.35);group.add(wall);
  h.setSources([{id:'new-head-corridor',mesh:furnishingCollisionMesh(Three,group)!,active:()=>true}]);
  if(completion==='frame')h.advance(h.time()+100);else h.adapter.actions.pause('user');
  expect(h.frames.size).toBe(0);expect(h.state().seatTransition).toBeNull();expect(h.state().paused).toBe(true);
  if(phase==='sit')expect(h.camera.position.z).toBeCloseTo(3);else expect(h.camera.position.toArray()).toEqual([0,1.15,-.08]);
  const pose=h.camera.position.toArray();h.advance(2000);expect(h.camera.position.toArray()).toEqual(pose);
 }finally{h.adapter.dispose();group.traverse(node=>{if(node instanceof Three.Mesh){node.geometry.dispose();(node.material as Three.Material).dispose();}});}
});

test('embedding focus waits for the complete seat motion, while a real blur still stops at a valid pose',async()=>{
 const events:{kind:'motion'|'seat';value:boolean}[]=[];
 const h=await harness(false,undefined,{onSeatTransition:value=>events.push({kind:'motion',value}),onSeat:id=>events.push({kind:'seat',value:!!id})});
 try{
  h.adapter.actions.start();h.adapter.actions.sit!(h.benchId);
  expect(events).toEqual([{kind:'motion',value:false},{kind:'motion',value:true},{kind:'seat',value:true}]);
  h.advance(175);expect(h.state().seatTransition).toMatchObject({phase:'sit',progress:.5});expect(events.at(-1)?.kind).toBe('seat');
  h.advance(350);expect(events.at(-1)).toEqual({kind:'motion',value:false});expect(h.camera.position.toArray()).toEqual([0,1.15,-.08]);
  // The automatic button focus happens only now, so its real canvas blur has
  // no pending sit to finish. Explicit focus loss DURING a rise still stops it.
  h.canvas.dispatchEvent(new Event('blur'));expect(h.frames.size).toBe(0);
  h.adapter.actions.stand!();h.advance(450);expect(h.state().seatTransition.phase).toBe('stand');
  h.canvas.dispatchEvent(new Event('blur'));expect(h.state().seatTransition).toBeNull();expect(h.state().paused).toBe(true);expect(h.camera.position.z).toBeCloseTo(-.61);expect(h.frames.size).toBe(0);expect(events.at(-1)).toEqual({kind:'motion',value:false});
 }finally{h.adapter.dispose();}
});

test('a bad seat reference retains the current camera and records no arbitrary request text',async()=>{
 const h=await harness(true);try{
  const before=h.camera.position.toArray(),rotation=h.camera.quaternion.clone();h.adapter.actions.sit!('https://private.invalid/token');
  expect(h.camera.position.toArray()).toEqual(before);expect(h.camera.quaternion.angleTo(rotation)).toBeLessThan(1e-7);
  expect(h.state().seatedBenchId).toBeUndefined();expect(h.state().seatTransition).toBeNull();
  expect(h.messages.at(-1)).not.toContain('다른 관람 위치');
  expect(JSON.parse(h.canvas.dataset.benchSeatRefusal!)).toEqual({version:1,reason:'BENCH_REFERENCE',benchId:null,origin:before,seatEye:null});
  expect(h.canvas.dataset.benchSeatRefusal).not.toContain('private');
 }finally{h.adapter.dispose();}
});
test('an actual seat-head obstruction records seat clearance, not a path-only suggestion',async()=>{
 const h=await harness(true),group=new Three.Group();try{
  const obstacle=new Three.Mesh(new Three.BoxGeometry(.3,.3,.3));obstacle.position.set(0,1.15,-.08);group.add(obstacle);
  h.setSources([{id:'seat-head-block',mesh:furnishingCollisionMesh(Three,group)!,active:()=>true}]);
  const before=h.camera.position.toArray();h.adapter.actions.sit!(h.benchId);
  expect(h.camera.position.toArray()).toEqual(before);expect(h.state().seatTransition).toBeNull();
  expect(JSON.parse(h.canvas.dataset.benchSeatRefusal!)).toMatchObject({reason:'BENCH_SEAT_UNSAFE',origin:before});
  expect(h.messages.at(-1)).not.toContain('다른 관람 위치');
 }finally{h.adapter.dispose();group.traverse(node=>{if(node instanceof Three.Mesh){node.geometry.dispose();(node.material as Three.Material).dispose();}});}
});
test('a subsequently clear real head path succeeds and clears a stale refusal record',async()=>{
 const h=await harness(true),group=new Three.Group();try{
  const wall=new Three.Mesh(new Three.BoxGeometry(2,3,.02));wall.position.set(0,1.5,1);group.add(wall);
  h.setSources([{id:'temporary-seat-corridor',mesh:furnishingCollisionMesh(Three,group)!,active:()=>true}]);
  h.adapter.actions.sit!(h.benchId);expect(JSON.parse(h.canvas.dataset.benchSeatRefusal!).reason).toBe('BENCH_VIEW_PATH_UNSAFE');
  h.setSources([]);h.adapter.actions.sit!(h.benchId);
  expect(h.camera.position.toArray()).toEqual([0,1.15,-.08]);expect(h.canvas.dataset.benchSeatRefusal).toBeUndefined();
  expect(h.messages.at(-1)).toContain('앉은 위치');
 }finally{h.adapter.dispose();group.traverse(node=>{if(node instanceof Three.Mesh){node.geometry.dispose();(node.material as Three.Material).dispose();}});}
});
