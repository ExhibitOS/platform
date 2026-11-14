// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,it,expect} from 'vitest';
import {PerspectiveCamera,Vector3} from 'three';
import {nativeSelectedFindBounds} from './native-selected-find-bounds';

function fixture(){
 const camera=new PerspectiveCamera(45,1,.02,2000);camera.position.set(6,2,-4);
 const orbit={minDistance:1,maxDistance:200,target:new Vector3(6,1,-4)};
 return {camera,orbit,scope:nativeSelectedFindBounds(camera,orbit)};
}
describe('Native selected Find orbit limits',()=>{
 it('lets a small selected object frame and zoom below the exhibition minimum without moving the view',()=>{
  const {camera,orbit,scope}=fixture(),position=camera.position.clone(),target=orbit.target.clone(),rotation=camera.quaternion.clone();
  const distance=scope.focus('selected',[.22,.273,.132],1)!;
  expect(distance).toBeCloseTo(.5733);expect(orbit.minDistance).toBeLessThan(distance);expect(orbit.minDistance).toBeGreaterThan(Math.hypot(.22,.273,.132)/2);
  expect(camera.near).toBeLessThan(orbit.minDistance-Math.hypot(.22,.273,.132)/2);expect(camera.far).toBeGreaterThan(orbit.maxDistance+Math.hypot(.22,.273,.132)/2);
  expect(camera.position).toEqual(position);expect(orbit.target).toEqual(target);expect(camera.quaternion.toArray()).toEqual(rotation.toArray());
 });
 it('fits a portrait viewport and keeps finite bounded zoom-out clipping',()=>{
  const {camera,orbit,scope}=fixture();expect(scope.focus('selected',[1,2,0],.5)).toBeCloseTo(8.4);
  expect(orbit.maxDistance).toBeCloseTo(33.6);expect(camera.far).toBeGreaterThan(orbit.maxDistance);expect(camera.far).toBeLessThan(2000);
 });
 it('rejects invalid, degenerate or unbounded framing without changing active limits',()=>{
  const {camera,orbit,scope}=fixture();scope.focus('a',[.2,.3,.1],1);const before={...orbit,near:camera.near,far:camera.far};
  for(const [size,aspect] of [[[0,0,0],1],[[NaN,1,1],1],[[-1,1,1],1],[[10001,1,1],1],[[1,1,1],0],[[1,1,1],Infinity],[[1,1,1],.000001]] as const)expect(scope.focus('b',size,aspect)).toBeUndefined();
  expect({...orbit,near:camera.near,far:camera.far}).toEqual(before);expect(scope.snapshot()?.id).toBe('a');
 });
 it('keeps bounds for the same live selection, resets on change, and preserves current pose on reset',()=>{
  const {camera,orbit,scope}=fixture();scope.focus('a',[.2,.3,.1],1);scope.sync('a',true);expect(orbit.minDistance).toBeLessThan(1);
  camera.position.set(6,1.2,-4.1);const position=camera.position.clone();scope.sync('b',true);
  expect(orbit.minDistance).toBe(1);expect(orbit.maxDistance).toBe(200);expect(camera.near).toBe(.02);expect(camera.far).toBe(2000);expect(camera.position).toEqual(position);expect(scope.snapshot()).toBeUndefined();
 });
 it('retires selected limits on unavailable/cancelled ownership, selection exit and ordinary view exit',()=>{
  const {scope,orbit}=fixture();for(const exit of [()=>scope.sync('a',false),()=>scope.sync(undefined,true),()=>scope.reset()]){scope.focus('a',[.2,.3,.1],1);exit();expect(orbit.minDistance).toBe(1);expect(scope.snapshot()).toBeUndefined();}
 });
 it('preserves the same selected orbit limits across the existing same-scope resource restart',()=>{
  const first=fixture();first.scope.focus('a',[.2,.3,.1],.7);const saved=first.scope.snapshot();first.scope.reset();
  const next=fixture();expect(next.scope.restore(saved,'a')).toBe(true);expect(next.scope.snapshot()).toEqual(saved);next.scope.sync('a',true);expect(next.orbit.minDistance).toBe(saved!.minDistance);
  next.scope.reset();expect(next.orbit.minDistance).toBe(1);
 });
 it('does not restore another selection or malformed saved limits',()=>{
  const {scope,orbit}=fixture();expect(scope.restore({id:'a',minDistance:.1,maxDistance:1,near:.01,far:2},'b')).toBe(false);
  expect(scope.restore({id:'a',minDistance:.1,maxDistance:1000,near:.01,far:2000},'a')).toBe(false);expect(orbit.minDistance).toBe(1);
 });
});
