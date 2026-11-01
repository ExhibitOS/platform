// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,expect,it} from 'vitest';
import {checkedCameraInteraction,NativeCameraInteractionGate} from './native-camera-interaction';
import type {NativeViewportFrame} from './native-viewport-protocol';

const epoch='2d2d07d1-4f42-499f-9cbc-c4c5ea701dcc',requestId='8f5474ed-21bc-4f23-bc8b-98fa217d0ba5';
const frame={epoch,sequence:4,disabled:false,presentation:'3d'} as NativeViewportFrame;
describe('transient native camera interaction',()=>{
 it('accepts only the exact current frame and supported modes',()=>{
  for(const mode of ['object','camera-rotate','camera-pan'] as const){const request={epoch,sequence:4,requestId,mode};expect(checkedCameraInteraction(request,frame,false)).toEqual(request);}
 });
 it('rejects stale, malformed, extra-field and unsupported requests',()=>{
  for(const change of [{sequence:3},{epoch:'00000000-0000-4000-8000-000000000000'},{requestId:'bad'},{mode:'zoom'},{extra:true}])expect(()=>checkedCameraInteraction({epoch,sequence:4,requestId,mode:'object',...change},frame,false)).toThrow();
 });
 it('fails closed when the host is disabled, on a plan, unavailable, or absent',()=>{
  const request={epoch,sequence:4,requestId,mode:'camera-pan'};
  for(const [f,busy] of [[{...frame,disabled:true},false],[{...frame,presentation:'plan'},false],[frame,true],[undefined,false]] as const)expect(()=>checkedCameraInteraction(request,f,busy)).toThrow();
 });
});

describe('authenticated camera requests',()=>{
 it('applies once after authentication and rejects replay without editing the frame',async()=>{
  const original=structuredClone(frame),applied:string[]=[];
  const gate=new NativeCameraInteractionGate({frame:()=>frame,unavailable:()=>false,authenticate:async()=>{},apply:r=>{applied.push(r.mode);return true;}});
  const request={epoch,sequence:4,requestId,mode:'camera-pan'};
  await expect(gate.request(request)).resolves.toEqual({...request,accepted:true});
  await expect(gate.request(request)).rejects.toThrow('CAMERA_INTERACTION_REPLAY');
  expect(applied).toEqual(['camera-pan']);expect(frame).toEqual(original);
 });
 it('fences concurrent and late requests across a newer accepted frame',async()=>{
  let current=frame,finish!:()=>void,applications=0;
  const gate=new NativeCameraInteractionGate({frame:()=>current,unavailable:()=>false,authenticate:()=>new Promise<void>(resolve=>{finish=resolve;}),apply:()=>{applications++;return true;}});
  const request={epoch,sequence:4,requestId,mode:'camera-rotate'},pending=gate.request(request);
  await expect(gate.request({...request,requestId:'38101c28-74a8-49d8-98a7-0fdfcc12d504'})).rejects.toThrow('CAMERA_INTERACTION_BUSY');
  current={...frame,sequence:5};gate.invalidate();finish();await expect(pending).rejects.toBeDefined();expect(applications).toBe(0);
 });
 it('never acknowledges an unavailable or not-yet-current renderer',async()=>{
  let unavailable=false,applied=0;
  const gate=new NativeCameraInteractionGate({frame:()=>frame,unavailable:()=>unavailable,authenticate:async()=>{},apply:()=>{applied++;return false;}});
  const request={epoch,sequence:4,requestId,mode:'camera-pan'};
  await expect(gate.request(request)).rejects.toThrow('CAMERA_INTERACTION_BUSY');expect(applied).toBe(1);
  unavailable=true;await expect(gate.request({...request,requestId:'38101c28-74a8-49d8-98a7-0fdfcc12d504'})).rejects.toThrow('CAMERA_INTERACTION_UNAVAILABLE');expect(applied).toBe(1);
 });
 it('does not apply an old request after a hidden-then-visible interruption',async()=>{
  let finish!:()=>void,applications=0;
  const gate=new NativeCameraInteractionGate({frame:()=>frame,unavailable:()=>false,authenticate:()=>new Promise<void>(resolve=>{finish=resolve;}),apply:()=>{applications++;return true;}});
  const pending=gate.request({epoch,sequence:4,requestId,mode:'camera-pan'});gate.invalidate();finish();
  await expect(pending).rejects.toBeDefined();expect(applications).toBe(0);
 });
});
