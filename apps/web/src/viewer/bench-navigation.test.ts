// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,test,vi} from 'vitest';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
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
test.each([false,true])('explicit seat and nearest clear stand keep current gaze and held movement stopped (running=%s)',async(running)=>{
  const d=benchFixture(),camera=new PerspectiveCamera(63,1,.01,100);camera.position.set(0,1.65,3);camera.lookAt(0,1.2,0);
  const doc=Object.assign(new EventTarget(),{activeElement:null as unknown,pointerLockElement:null as unknown,hidden:false,exitPointerLock:vi.fn()});
  const canvas=Object.assign(new EventTarget(),{dataset:{} as Record<string,string>,style:{touchAction:''},focus:vi.fn(()=>{doc.activeElement=canvas;}),getBoundingClientRect:()=>({left:0,width:100})}) as unknown as HTMLCanvasElement;
  vi.stubGlobal('document',doc);vi.stubGlobal('window',new EventTarget());vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));vi.stubGlobal('cancelAnimationFrame',vi.fn());
  const controls={enabled:true,target:new Vector3(0,1.2,0),update(){}} as OrbitControls;
  const modes:(string|undefined)[]=[],states:import('./navigation').NavigationState[]=[],seats:(string|null)[]=[],clock=new StrideClock();
  const adapter=await createWalkingCamera({document:d,camera,initialCamera:camera.clone(),controls,canvas,settings:{speed:1.3,eyeHeight:1.65,reducedMotion:true},render(){},onMode(_walking,_paused,reason){modes.push(reason);},wasWalkingBeforeSeat:()=>running,onMessage(){},onState:s=>{states.push(s);expect(clock.advance(s,!s.paused)).toBe(false);},onSeat:id=>seats.push(id)});
  try{
    if(running){adapter.actions.start();adapter.actions.press('forward',9);}
    const position=camera.position.clone(),fov=camera.fov;
    const bench=(d.extensions![N] as unknown as {benches:{id:string}[]}).benches[0]!;
    adapter.actions.sit!(bench.id);expect(seats).toEqual([bench.id]);expect(camera.position.toArray()).toEqual([0,1.15,-.08]);expect(controls.enabled).toBe(false);expect(states.at(-1)).toMatchObject({paused:true,grounded:false,velocity:[0,0,0]});
    adapter.actions.start();expect(camera.position.toArray()).toEqual([0,1.15,-.08]);
    const seatedRotation=camera.quaternion.clone();
    adapter.actions.stand!();expect(camera.position.x).toBeCloseTo(0);expect(camera.position.z).toBeCloseTo(-.61);expect(camera.position.y).toBeCloseTo(1.661,4);expect(camera.position.distanceTo(position)).toBeGreaterThan(1);expect(camera.quaternion.angleTo(seatedRotation)).toBeLessThan(1e-7);expect(camera.fov).toBe(fov);expect(states.at(-1)).toMatchObject({paused:true,velocity:[0,0,0]});expect(seats).toEqual([bench.id,null]);expect(doc.activeElement).toBe(canvas);expect(modes.at(-1)).toBe(running?"bench-return":undefined);
  }finally{adapter.dispose();}
});

test('nearby action requires the exact visible bench and clears eligibility outside the supported pose', async () => {
  const document = benchFixture(), benchId = (document.extensions![N] as unknown as {benches: {id: string}[]}).benches[0]!.id;
  const camera = new PerspectiveCamera(63, 1, .01, 100);
  camera.position.set(0, 1.65, 1.4);
  const doc = Object.assign(new EventTarget(), {activeElement: null, pointerLockElement: null, hidden: false});
  const canvas = Object.assign(new EventTarget(), {dataset: {}, style: {touchAction: ''}, focus: vi.fn()}) as unknown as HTMLCanvasElement;
  const controls = {enabled: true, target: new Vector3(), update(){}} as OrbitControls;
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const onNearbyBench = vi.fn();
  const adapter = await createWalkingCamera({
    document, camera, initialCamera: camera.clone(), controls, canvas,
    settings: {speed: 1.3, eyeHeight: 1.65, reducedMotion: true},
    render(){}, onMode(){}, onMessage(){}, onNearbyBench,
  });
  try {
    expect(onNearbyBench.mock.calls, canvas.dataset.navigationState).toEqual([[benchId]]);
    expect(adapter.actions.sitNearby?.(crypto.randomUUID())).toBe(false);
    camera.position.z = 3;
    expect(adapter.actions.sitNearby?.(benchId)).toBe(false);
    expect(onNearbyBench.mock.lastCall).toEqual([null]);
    adapter.actions.reset();
    expect(onNearbyBench.mock.lastCall).toEqual([benchId]);
    const prior = camera.position.toArray();
    expect(adapter.actions.sitNearby?.(benchId)).toBe(true);
    expect(onNearbyBench.mock.lastCall).toEqual([null]);
    expect(adapter.actions.sitNearby?.(benchId)).toBe(false);
    adapter.actions.stand?.();
    expect(camera.position.toArray()).not.toEqual(prior);
    expect(camera.position.z).toBeCloseTo(-.61);
    expect(onNearbyBench.mock.lastCall).toEqual([benchId]);
  } finally {
    adapter.dispose();
  }
  expect(onNearbyBench.mock.lastCall).toEqual([null]);
});


test.each(['mouse','touch'])('seated %s drag rotates in place and its current gaze is kept when standing',async pointerType=>{
  const d=benchFixture(),camera=new PerspectiveCamera(63,1,.01,100);
  camera.position.set(0,1.65,3);camera.lookAt(0,1.2,0);
  const doc=Object.assign(new EventTarget(),{activeElement:null as HTMLElement|null,pointerLockElement:null,hidden:false});
  const canvas=Object.assign(new EventTarget(),{
    dataset:{},style:{touchAction:''},focus:vi.fn(()=>{doc.activeElement=canvas;}),setPointerCapture:vi.fn(),hasPointerCapture:()=>false,
  }) as unknown as HTMLCanvasElement;
  let frame:FrameRequestCallback|undefined,canLook=true;
  const win=new EventTarget(),modes:(string|undefined)[]=[];
  vi.stubGlobal('document',doc);vi.stubGlobal('window',win);
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frame=callback;return 1;});
  vi.stubGlobal('cancelAnimationFrame',()=>{frame=undefined;});
  const controls={enabled:true,target:new Vector3(0,1.2,0),update(){}} as OrbitControls;
  const adapter=await createWalkingCamera({
    document:d,camera,initialCamera:camera.clone(),controls,canvas,
    settings:{speed:1.3,eyeHeight:1.65,reducedMotion:true},render(){},onMode(_walking,_paused,reason){modes.push(reason);},onMessage(){},
    canLookSeated:()=>canLook,wasWalkingBeforeSeat:()=>true,
  });
  try{
    adapter.actions.start();
    const bench=(d.extensions![N] as unknown as {benches:{id:string}[]}).benches[0]!;
    const standing={eye:camera.position.toArray(),quaternion:camera.quaternion.toArray(),target:controls.target.toArray(),fov:camera.fov};
    adapter.actions.sit!(bench.id);
    const seated={eye:camera.position.toArray(),quaternion:camera.quaternion.toArray()};
    const pointer=(type:string,x:number,y:number)=>canvas.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),{pointerType,pointerId:1,isPrimary:true,button:0,clientX:x,clientY:y}));
    pointer('pointerdown',10,20);pointer('pointermove',60,45);
    expect(frame).toBeDefined();
    canLook=false;
    pointer('pointermove',80,55);
    frame?.(performance.now());
    expect(camera.quaternion.toArray()).toEqual(seated.quaternion);
    canLook=true;
    pointer('pointerdown',10,20);pointer('pointermove',60,45);pointer('pointerup',60,45);
    frame?.(performance.now());
    expect(doc.activeElement).toBe(canvas);
    expect(camera.position.toArray()).toEqual(seated.eye);
    expect(camera.quaternion.toArray()).not.toEqual(seated.quaternion);
    expect(JSON.parse(canvas.dataset.navigationState!)).toMatchObject({walking:false,paused:true,velocity:[0,0,0]});
    const looking=camera.quaternion.clone();
    win.dispatchEvent(Object.assign(new Event('keydown',{cancelable:true}),{code:'Escape'}));
    expect(modes.at(-1)).toBe('escape');
    adapter.actions.stand!();
    expect(modes.at(-1)).toBeUndefined();
    expect(camera.position.z).toBeCloseTo(-.61);
    expect(camera.quaternion.angleTo(looking)).toBeLessThan(1e-7);
    expect(controls.target.clone().sub(camera.position).normalize().distanceTo(camera.getWorldDirection(new Vector3()))).toBeLessThan(1e-7);
    expect(camera.fov).toBe(standing.fov);
  }finally{adapter.dispose();}
});
