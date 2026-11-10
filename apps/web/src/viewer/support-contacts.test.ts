// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import * as three from 'three';
import type {Exhibition} from '@exhibitos/spec';
import {BENCH_NAMESPACE} from '@exhibitos/studio-contract';
import {supportContactFits,supportContacts} from './support-contacts';

it('uses only visible geometry in the verified catalog legs',()=>{
  const room=new three.Group(),floor=new three.Group(),model=new three.Group();
  floor.rotation.x=-Math.PI/2;
  room.add(floor,model);
  const node=new three.Group();node.name='Leg';model.add(node);
  const geometry=new three.BoxGeometry(.06,.4,.06),material=new three.MeshBasicMaterial();
  const visible=new three.Mesh(geometry,material),hidden=new three.Mesh(geometry,material);
  visible.position.set(.4,.2,.1);hidden.position.set(1,-.5,1);hidden.visible=false;
  node.add(visible,hidden);
  const document={
    surfaces:[{id:'floor',type:'floor',roomId:'room'}],placements:[],artworks:[],
    extensions:{[BENCH_NAMESPACE]:{version:1,benches:[{id:'bench',roomId:'room',position:[0,0,0],yaw:0}]}}
  } as unknown as Exhibition;
  const get=()=>supportContacts(three,document,new Map([['room',room]]),new Map([['floor',floor]]),
    [[{x:0,y:0,width:4,height:4}]],new Map(),[],{hostId:'bench',model});
  expect(get()).toHaveLength(1);
  expect(get()[0]!.position[0]).toBeCloseTo(.4);
  node.visible=false;
  expect(get()).toEqual([]);
  node.visible=true;model.visible=false;
  expect(get()).toEqual([]);
  model.visible=true;visible.visible=false;
  expect(get()).toEqual([]);
  geometry.dispose();material.dispose();
});

it('leaves the existing scene allocation alone when the optional pass cannot fit',()=>{
  const scene=400_000;
  expect(supportContactFits(scene,scene)).toBe(false);
  expect(supportContactFits(scene,scene+12*1024-1)).toBe(false);
  expect(supportContactFits(scene,scene+12*1024)).toBe(true);
});

it('uses actual mounted workspace feet, merges overlapping submeshes and never shadows a hidden functional host',()=>{
  const room=new three.Group(),floor=new three.Group(),model=new three.Group();
  floor.rotation.x=-Math.PI/2;room.add(floor,model);
  const geometry=new three.BoxGeometry(.1,.02,.15),material=new three.MeshBasicMaterial();
  for(const x of [-.5,.5]){
    const foot=new three.Mesh(geometry,material);foot.position.set(x,.01,.2);model.add(foot);
  }
  const duplicate=new three.Mesh(geometry,material);duplicate.position.set(.5,.01,.2);model.add(duplicate);
  const hidden=new three.Mesh(geometry,material);hidden.position.set(1,-.5,1);hidden.visible=false;model.add(hidden);
  const document={surfaces:[{id:'floor',type:'floor',roomId:'room'}],placements:[],artworks:[],extensions:{
    [BENCH_NAMESPACE]:{version:1,benches:[{id:'bench',roomId:'room',position:[0,0,0],yaw:0,
      workspaceVisual:{placementId:'workspace-seat',modelSha256:'a'.repeat(64)}}]},
  }} as unknown as Exhibition;
  const get=(models?:ReadonlyMap<string,three.Object3D>)=>supportContacts(three,document,new Map([['room',room]]),
    new Map([['floor',floor]]),[[{x:0,y:0,width:4,height:4}]],new Map(),[],undefined,models);
  expect(get()).toEqual([]);
  const models=new Map([['workspace-seat',model]]),contacts=get(models);
  expect(contacts).toHaveLength(2);
  expect(contacts.map(row=>row.position[0])).toEqual([-.5,.5]);
  model.visible=false;expect(get(models)).toEqual([]);
  model.visible=true;model.position.y=.03;expect(get(models)).toEqual([]);
  geometry.dispose();material.dispose();
});
