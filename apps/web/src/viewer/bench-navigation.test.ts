// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,test,vi} from 'vitest';
afterEach(()=>vi.unstubAllGlobals());
import {BENCH_NAMESPACE as N,PRESENTATION_NAMESPACE as P,applyBenchCommand} from '@exhibitos/studio-contract';
import {newDraft} from '../drafts/example';
import {applyGeometryCommand,createGeometryState} from '../geometry/model';
import {createNavigationController} from './navigation';
import {createPresenceGeometry} from '../../../api/src/realtime-geometry';
import {PerspectiveCamera,Vector3} from 'three';
import type {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {createWalkingCamera} from './navigation-camera';
import {StrideClock} from './audio';
export function benchFixture(){
  const base=newDraft().candidate,roomId=base.rooms[0]!.id,d=applyGeometryCommand(createGeometryState(base),{type:'white-cube',roomId}).present,id=crypto.randomUUID(),viewpointId=crypto.randomUUID();
  d.artworks=[];d.placements=[];d.extensions={...d.extensions,[P]:{version:1,credits:'',viewpoints:[]}};
  return applyBenchCommand(d,{type:'add-bench',bench:{id,name:'Bench',roomId,position:[0,0,0],yaw:0,kind:'backed',dimensions:{width:1.5,depth:.7,height:.45},material:{preset:'wood',color:'#755741',roughness:.7,metalness:0},viewpointId},viewpoint:{id:viewpointId,name:'Seat view',roomId,position:[0,1.15,-.08],target:[0,1,-3],fov:50}});
}
test('bench blocks real walking and matching server presence, while seated clearance never lowers standing guards',async()=>{
  const d=benchFixture(),c=await createNavigationController(d,{position:[0,1.65,3]}),before=c.state();
  try{
    expect(c.isWalkable([0,1.65,0])).toBe(false);expect(createPresenceGeometry(d).valid({roomId:d.rooms[0]!.id,position:[0,1.65,0],yaw:0})).toBe(false);
    expect(c.seatedClear([0,1.15,-.08],[0,0,0],.45)).toBe(true);expect(c.seatedClear([0,.7,0],[0,0,0],.45)).toBe(false);expect(c.seatedClear([0,1.15,.3],[0,0,0],.45)).toBe(false);expect(c.seatedClear([0,1.15,-.08],[0,2,0],.45)).toBe(false);
    expect(c.state()).toEqual(before);expect(()=>c.setSettings({eyeHeight:1.15})).toThrow();
  }finally{c.dispose();}
  const legacy=structuredClone(d);delete legacy.extensions![N];const free=await createNavigationController(legacy,{position:[0,1.65,3]});try{expect(free.isWalkable([0,1.65,0])).toBe(true);}finally{free.dispose();}
});
test.each([false,true])('explicit seated view and return preserve camera while keeping held movement and stride stopped (running=%s)',async(running)=>{
  const d=benchFixture(),camera=new PerspectiveCamera(63,1,.01,100);camera.position.set(0,1.65,3);camera.lookAt(0,1.2,0);
  const doc=Object.assign(new EventTarget(),{activeElement:null as unknown,pointerLockElement:null as unknown,hidden:false,exitPointerLock:vi.fn()});
  const canvas=Object.assign(new EventTarget(),{dataset:{} as Record<string,string>,style:{touchAction:''},focus:vi.fn(()=>{doc.activeElement=canvas;}),getBoundingClientRect:()=>({left:0,width:100})}) as unknown as HTMLCanvasElement;
  vi.stubGlobal('document',doc);vi.stubGlobal('window',new EventTarget());vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));vi.stubGlobal('cancelAnimationFrame',vi.fn());
  const controls={enabled:true,target:new Vector3(0,1.2,0),update(){}} as OrbitControls;
  const states:import('./navigation').NavigationState[]=[],seats:(string|null)[]=[],clock=new StrideClock();
  const adapter=await createWalkingCamera({document:d,camera,initialCamera:camera.clone(),controls,canvas,settings:{speed:1.3,eyeHeight:1.65,reducedMotion:true},render(){},onMode(){},onMessage(){},onState:s=>{states.push(s);expect(clock.advance(s,!s.paused)).toBe(false);},onSeat:id=>seats.push(id)});
  try{
    if(running){adapter.actions.start();adapter.actions.press('forward',9);}
    const position=camera.position.clone(),rotation=camera.quaternion.clone(),fov=camera.fov;
    const bench=(d.extensions![N] as unknown as {benches:{id:string}[]}).benches[0]!;
    adapter.actions.sit!(bench.id);expect(seats).toEqual([bench.id]);expect(camera.position.toArray()).toEqual([0,1.15,-.08]);expect(controls.enabled).toBe(false);expect(states.at(-1)).toMatchObject({paused:true,grounded:false,velocity:[0,0,0]});
    adapter.actions.start();expect(camera.position.toArray()).toEqual([0,1.15,-.08]);
    adapter.actions.stand!();expect(camera.position.toArray()).toEqual(position.toArray());expect(camera.quaternion.toArray()).toEqual(rotation.toArray());expect(camera.fov).toBe(fov);expect(states.at(-1)).toMatchObject({paused:true,velocity:[0,0,0]});expect(seats).toEqual([bench.id,null]);expect(doc.activeElement).toBe(canvas);
  }finally{adapter.dispose();}
});
