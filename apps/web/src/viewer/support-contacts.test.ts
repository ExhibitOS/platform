// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import * as three from 'three';
import {AssetPeakBudget,MemoryAssetCache} from './loading';
import type {Exhibition} from '@exhibitos/spec';
import {ARCHITECTURAL_FINISH_NAMESPACE,BENCH_NAMESPACE,INSTALLATION_NAMESPACE} from '@exhibitos/studio-contract';
import {reclaimSupportContactCache,SUPPORT_CONTACT_RESERVE_BYTES,supportContactFits,supportContacts} from './support-contacts';

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
    [[{x:0,y:0,width:4,height:4}]],new Map(),{hostId:'bench',model});
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
  expect(supportContactFits(scene,scene+SUPPORT_CONTACT_RESERVE_BYTES-1)).toBe(false);
  expect(supportContactFits(scene,scene+SUPPORT_CONTACT_RESERVE_BYTES)).toBe(true);
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
    new Map([['floor',floor]]),[[{x:0,y:0,width:4,height:4}]],new Map(),undefined,models);
  expect(get()).toEqual([]);
  const models=new Map([['workspace-seat',model]]),contacts=get(models);
  expect(contacts).toHaveLength(2);
  expect(contacts.map(row=>row.position[0])).toEqual([-.5,.5]);
  model.visible=false;expect(get(models)).toEqual([]);
  model.visible=true;model.position.y=.03;expect(get(models)).toEqual([]);
  geometry.dispose();material.dispose();
});

it('grounds the actual opaque plinth bottom and omits a floating or hidden base',()=>{
  const room=new three.Group(),floor=new three.Group();floor.rotation.x=-Math.PI/2;room.add(floor);
  const geometry=new three.BoxGeometry(.65,.9,.65),material=new three.MeshStandardMaterial();
  const base=new three.Mesh(geometry,material);base.position.set(.3,.45,-.2);base.rotation.y=.4;room.add(base);
  const pose={position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]};
  const document={surfaces:[{id:'floor',type:'floor',roomId:'room'}],
    artworks:[{revisionId:'art',artworkType:'sculpture',dimensions:{width:.2,height:.2,depth:.2},transform:pose}],
    placements:[{id:'placement',roomId:'room',artworkRevisionId:'art',transform:pose}],
    extensions:{[INSTALLATION_NAMESPACE]:{version:1,placements:[{placementId:'placement',pedestal:{kind:'box',position:[.3,0,-.2],yaw:.4,dimensions:{width:.65,height:.9,depth:.65}}}]}}
  } as unknown as Exhibition;
  const get=()=>supportContacts(three,document,new Map([['room',room]]),new Map([['floor',floor]]),
    [[{x:0,y:0,width:4,height:4}]],new Map([['placement',[base]]]));
  const contacts=get();expect(contacts).toHaveLength(1);
  expect(contacts[0]!.receiver).toBe(floor);expect(contacts[0]!.supports).toEqual([base]);
  expect(contacts[0]!.shape?.kind).toBe('rectangle');expect(contacts[0]!.width).toBeCloseTo(.72);
  expect(contacts[0]!.position).toEqual([expect.closeTo(.3),expect.closeTo(.002),expect.closeTo(-.2)]);
  base.position.y+=.02;expect(get()).toEqual([]);
  base.position.y-=.02;base.visible=false;expect(get()).toEqual([]);
  geometry.dispose();material.dispose();
});

it('places frame support on the visible wall face and still excludes openings',()=>{
  const pose={position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]};
  const room=new three.Group(),wall=new three.Group();room.position.z=-7;wall.position.set(0,2,-4.99);room.add(wall);
  const geometry=new three.BoxGeometry(8,4,.02),material=new three.MeshStandardMaterial();
  wall.add(new three.Mesh(geometry,material));
  const document={surfaces:[{id:'wall',type:'wall',roomId:'room'}],
    artworks:[{revisionId:'art',artworkType:'image',dimensions:{width:.6,height:.8,depth:0},transform:pose}],
    placements:[{id:'placement',roomId:'room',artworkRevisionId:'art',transform:{...pose,position:[0,1.6,-4.94]}}],
    extensions:{
      [INSTALLATION_NAMESPACE]:{version:1,placements:[{placementId:'placement',frame:{kind:'flat',thickness:.02,gap:0,matWidth:.02,borderWidth:.03}}]},
      [ARCHITECTURAL_FINISH_NAMESPACE]:{version:1,walls:[{surfaceId:'wall',depth:.02}]},
    }} as unknown as Exhibition;
  const before=JSON.stringify(document);
  const get=(rectangles:{x:number;y:number;width:number;height:number}[])=>supportContacts(three,document,
    new Map([['room',room]]),new Map([['wall',wall]]),[rectangles],new Map());
  const contacts=get([{x:0,y:0,width:8,height:4}]);
  expect(contacts).toHaveLength(1);
  const contact=contacts[0]!,center=new three.Vector3().fromArray(contact.position);
  // The old centre-plane cue was exactly 8mm behind this visible face and
  // disappeared at the shader's strict 8mm cutoff (including Float32 error).
  expect(center.z).toBeCloseTo(-4.978,6);
  const visibleFace=room.worldToLocal(wall.localToWorld(new three.Vector3(0,center.y-wall.position.y,.01)));
  expect(Math.abs(center.z-visibleFace.z)).toBeCloseTo(.002,6);
  expect(get([{x:-2,y:0,width:2,height:4},{x:2,y:0,width:2,height:4}])).toEqual([]);
  delete document.extensions![ARCHITECTURAL_FINISH_NAMESPACE];
  expect(get([{x:0,y:0,width:8,height:4}])[0]!.position[2]).toBeCloseTo(-4.988,6);
  document.extensions![ARCHITECTURAL_FINISH_NAMESPACE]=JSON.parse(before).extensions[ARCHITECTURAL_FINISH_NAMESPACE];
  expect(JSON.stringify(document)).toBe(before);
  geometry.dispose();material.dispose();
});


it('reclaims only unpinned encoded bytes for contact headroom without changing modeled limits',()=>{
  const cache=new MemoryAssetCache<ArrayBuffer>(8*1024*1024),pinned=new ArrayBuffer(4),raw=new ArrayBuffer(4),spare=new ArrayBuffer(4);
  cache.set('pinned',pinned,2*1024*1024);cache.acquire('pinned');
  cache.set('raw',raw,2*1024*1024);cache.set('spare',spare,2*1024*1024);
  const fixed=4*1024*1024,limit=10*1024*1024,used=()=>fixed+cache.stats().bytes;
  expect(reclaimSupportContactCache({used,limit,keys:['pinned','raw','spare'],evict:key=>cache.delete(key)})).toBe(true);
  expect(cache.get('pinned')).toBe(pinned);expect(cache.get('raw')).toBeUndefined();expect(cache.get('spare')).toBe(spare);
  expect(supportContactFits(used(),limit-1024*1024)).toBe(true);
  expect(cache.maxBytes).toBe(8*1024*1024);expect(raw.byteLength).toBe(4);
  cache.release('pinned');cache.clear();
});
it('retains the budget denial when encoded bytes are pinned or insufficient and does nothing when already fitting',()=>{
  const cache=new MemoryAssetCache<string>(4*1024*1024);cache.set('pinned','retained',2*1024*1024);cache.acquire('pinned');
  const limit=3*1024*1024,used=()=>2*1024*1024+cache.stats().bytes;
  expect(reclaimSupportContactCache({used,limit,keys:['pinned'],evict:key=>cache.delete(key)})).toBe(false);
  expect(cache.get('pinned')).toBe('retained');expect(cache.stats().pinned).toBe(1);
  let evictions=0;
  expect(reclaimSupportContactCache({used:()=>1024,limit,keys:['pinned'],evict:()=>{evictions++;}})).toBe(true);
  expect(evictions).toBe(0);cache.release('pinned');cache.clear();
});

 it('keeps admitted contact bytes charged while concurrent decode holds are acquired and released',()=>{
  const resident=50_000,limit=100_000,peak=new AssetPeakBudget(limit,()=>resident);
  peak.reserve('contact',SUPPORT_CONTACT_RESERVE_BYTES,80_000);
  expect(peak.total()).toBe(resident+SUPPORT_CONTACT_RESERVE_BYTES);
  peak.reserve('decode',20_000);
  expect(()=>peak.reserve('other',10_000)).toThrow('ASSET_TRANSITION_PEAK');
  peak.release('decode');expect(peak.reservationBytes('contact')).toBe(SUPPORT_CONTACT_RESERVE_BYTES);
  peak.release('contact');expect(peak.total()).toBe(resident);
 });
