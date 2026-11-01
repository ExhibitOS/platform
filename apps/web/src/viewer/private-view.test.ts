// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import type {Exhibition} from '@exhibitos/spec';
import {Vector3} from 'three';
import {boundedOrbitTarget,safePrivateView,savePrivateView,takePrivateView} from './private-view';
import {discardPrivateView} from './private-view-storage';

const id='11111111-1111-4111-8111-111111111111',pub='22222222-2222-4222-8222-222222222222',hash='a'.repeat(64),index='b'.repeat(64);
const doc={rooms:[{id,dimensions:{width:4,height:3,depth:4},transform:{position:[10,0,0],rotation:[0,0,0,1],scale:[1,1,1]}}]} as unknown as Exhibition;
const view={roomId:id,position:[10,1.6,0],target:[10,1.6,-1],fov:48};
afterEach(()=>vi.unstubAllGlobals());
it('bounds orbit target distance without changing the eye or viewing direction',()=>{
 const eye=new Vector3(-1.6,1.66,-9),target=eye.clone().add(new Vector3(0,-.05,1).normalize()),direction=target.clone().sub(eye).normalize();
 const adjusted=boundedOrbitTarget(eye,target,1.1,220);
 expect(adjusted.distanceTo(eye)).toBeCloseTo(1.1,12);
 expect(adjusted.clone().sub(eye).normalize().distanceTo(direction)).toBeLessThan(1e-12);
 expect(eye.toArray()).toEqual([-1.6,1.66,-9]);
 expect(boundedOrbitTarget(eye,target,.5,220).distanceTo(target)).toBeLessThan(1e-12);
 const distant=eye.clone().addScaledVector(direction,300);
 expect(boundedOrbitTarget(eye,distant,1.1,220).distanceTo(eye)).toBeCloseTo(220,10);
});
it('checks world position against transformed room and finite camera bounds',()=>{
 expect(safePrivateView(doc,view)).toEqual(view);
 expect(safePrivateView(doc,{...view,position:[0,1.6,0]})).toBeUndefined();
 expect(safePrivateView(doc,{...view,roomId:'missing'})).toBeUndefined();
 expect(safePrivateView(doc,{...view,target:view.position})).toBeUndefined();
 expect(safePrivateView(doc,{...view,fov:NaN})).toBeUndefined();
});
it('consumes only the matching publication, revision and index in this tab',()=>{
 const data=new Map<string,string>();vi.stubGlobal('sessionStorage',{setItem:(k:string,v:string)=>data.set(k,v),getItem:(k:string)=>data.get(k)??null,removeItem:(k:string)=>data.delete(k)});
 savePrivateView(pub,hash,index,view as never);
 expect(takePrivateView(pub,'c'.repeat(64),index,doc)).toBeUndefined();
 expect(takePrivateView(pub,hash,index,doc)).toEqual(view);
 expect(takePrivateView(pub,hash,index,doc)).toBeUndefined();
});

it('discards only the matching abandoned handoff without changing another source',()=>{
 const data=new Map<string,string>();vi.stubGlobal('sessionStorage',{setItem:(k:string,v:string)=>data.set(k,v),getItem:(k:string)=>data.get(k)??null,removeItem:(k:string)=>data.delete(k)});
 savePrivateView(pub,hash,index,view as never);savePrivateView(pub,hash,'c'.repeat(64),view as never);
 discardPrivateView(pub,hash,index);expect(takePrivateView(pub,hash,index,doc)).toBeUndefined();expect(takePrivateView(pub,hash,'c'.repeat(64),doc)).toEqual(view);
});
