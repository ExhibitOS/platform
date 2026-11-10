// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import {FURNISHING_WALKING_COLLISION_NAMESPACE as COLLISION,applyBenchCommand,INSTALLATION_NAMESPACE as N,WORKSPACE_FURNISHING_NAMESPACE,type BenchCommand,type WorkspaceFurnishings} from '@exhibitos/studio-contract';
import {newDraft} from '../drafts/example';
import {createGeometryState,applyGeometryCommand} from '../geometry/model';
import {syntheticArtwork,newPlacement} from '../placement/model';
import {createNavigationController} from './navigation';
import {createPresenceGeometry} from '../../../api/src/realtime-geometry';
function fixture(cylinder=false,frame=false){let s=createGeometryState(newDraft().candidate);s=applyGeometryCommand(s,{type:'white-cube',roomId:s.present.rooms[0]!.id});const d=s.present,a=syntheticArtwork(frame?'image':'sculpture');d.artworks=[a];const p=newPlacement(a,d.rooms[0]!.id);p.transform.position=frame?[0,2.25,0]:[3,.5,0];if(frame)a.dimensions={width:.1,height:.1};d.placements=[p];const material={preset:'paint',color:'#FFFFFF',roughness:.7,metalness:0};d.extensions={...d.extensions,[N]:{version:1,placements:[{placementId:p.id,...(frame?{frame:{kind:'flat',borderWidth:.5,thickness:.02,depth:0,gap:0,matWidth:0,matColor:'#FFFFFF',material}}:{pedestal:cylinder?{kind:'cylinder',position:[0,0,0],yaw:.4,dimensions:{diameter:1,height:.8},material}:{kind:'box',position:[0,0,0],yaw:0,dimensions:{width:1,depth:1,height:.8},material}})}]}};return d;}
test('independent pedestal blocks actual Rapier walking and matching server poses without artwork bytes',async()=>{
 const d=fixture(),roomId=d.rooms[0]!.id,c=await createNavigationController(d,{position:[0,1.65,3]}),server=createPresenceGeometry(d);try{
  expect(c.isWalkable([0,1.65,0])).toBe(false);expect(server.valid({roomId,position:[0,1.65,0],yaw:0})).toBe(false);
  for(let i=0;i<300;i++)c.advance(1/60,{forward:1,right:0,paused:false});expect(c.state().eyePosition[2]).toBeGreaterThan(.74);expect(c.state().blocked).toBe(true);expect(c.walkableRegions.some(r=>r.exclusions.some(s=>s.convexVertices?.length===8))).toBe(true);
 }finally{c.dispose();}
});
test('cylinder keeps free diagonal corners that a bounding box would incorrectly obstruct',async()=>{
 const d=fixture(true),roomId=d.rooms[0]!.id,c=await createNavigationController(d,{position:[0,1.65,3]}),server=createPresenceGeometry(d);try{for(const position of [[.62,1.65,.62],[0,1.65,0],[0,1.65,2]] as [number,number,number][]){expect(c.isWalkable(position)).toBe(server.valid({roomId,position,yaw:0}));}expect(c.isWalkable([.62,1.65,.62])).toBe(true);expect(c.walkableRegions.some(r=>r.exclusions.some(s=>s.convexVertices?.length===64))).toBe(true);}finally{c.dispose();}
});
test('a thin low frame blocks capsule head and swept server movement while its artwork is overhead',async()=>{
 const d=fixture(false,true),roomId=d.rooms[0]!.id;
 const defaultCamera=await createNavigationController(d,{position:[0,1.65,.4]});
 try{expect(defaultCamera.isWalkable([0,1.65,0])).toBe(true);}finally{defaultCamera.dispose();}
 d.extensions![COLLISION]={version:1,overrides:[{kind:'frame',id:d.placements[0]!.id,enabled:true}]};
 const c=await createNavigationController(d,{position:[0,1.65,.4]}),server=createPresenceGeometry(d);try{
  const before={roomId,position:[0,1.65,.4] as [number,number,number],yaw:0},after={roomId,position:[0,1.65,-.4] as [number,number,number],yaw:0};expect(server.valid(before)).toBe(true);expect(server.valid(after)).toBe(true);expect(server.move(before,after,500)).toBe(false);expect(c.isWalkable([0,1.65,0])).toBe(false);expect(c.isWalkable([1,1.65,0])).toBe(true);
  for(let i=0;i<90;i++)c.advance(1/60,{forward:1,right:0,paused:false});expect(c.state().eyePosition[2]).toBeGreaterThan(.12);
 }finally{c.dispose();}
});

test.each([false,true])('verified stool blocks walking and permits bypass with linked seat=%s',async linked=>{
 const draft=newDraft();
 const geometry=createGeometryState(draft.candidate);
 let doc=applyGeometryCommand(geometry,{type:'white-cube',roomId:geometry.present.rooms[0]!.id}).present;
 const id='10000000-0000-4000-8000-000000000020';
 const model={mime:'model/gltf-binary',bytes:415848,sha256:'6caca94361b540fb007c6fc605e519e436462eda43f2ec5f99da6a63108bfc60'};
 doc.extensions={...doc.extensions,[WORKSPACE_FURNISHING_NAMESPACE]:{version:2,
  furnishings:[{id,version:1,kind:'stool',name:'Gallery stool',rights:{},provenance:'ExhibitOS',model}],
  placements:[{id:'10000000-0000-4000-8000-000000000021',roomId:doc.rooms[0]!.id,furnishingId:id,furnishingVersion:1,position:[0,0,0],yaw:0,scale:1}]}};
 if(linked){
  const roomId=doc.rooms[0]!.id,viewpointId='10000000-0000-4000-8000-000000000022';
  const command:Extract<BenchCommand,{bench:unknown}>={type:'add-bench',bench:{
   id:'10000000-0000-4000-8000-000000000023',name:'Stool seat',roomId,position:[0,0,0],yaw:0,kind:'slab',
   dimensions:{width:.38,depth:.38,height:.45},material:{preset:'wood',color:'#755741',roughness:.7,metalness:0},viewpointId,
   workspaceVisual:{placementId:'10000000-0000-4000-8000-000000000021',modelSha256:model.sha256},
  },viewpoint:{id:viewpointId,name:'Seated view',roomId,position:[0,1.15,0],target:[0,1.4,-2],fov:50}};
  const changedWorkspace=(change:(ws:WorkspaceFurnishings)=>void)=>{
   const draft=structuredClone(doc);
   change(draft.extensions![WORKSPACE_FURNISHING_NAMESPACE] as unknown as WorkspaceFurnishings);
   return draft;
  };
  const otherHash='0'.repeat(64), alteredHash=structuredClone(command);
  alteredHash.bench.workspaceVisual!.modelSha256=otherHash;
  expect(()=>applyBenchCommand(changedWorkspace(w=>{w.furnishings[0]!.model.sha256=otherHash;}),alteredHash)).toThrow();
  expect(()=>applyBenchCommand(changedWorkspace(w=>{w.furnishings[0]!.model.bytes++;}),command)).toThrow();
  expect(()=>applyBenchCommand(changedWorkspace(w=>{w.furnishings[0]!.kind='bench';}),command)).toThrow();
  expect(()=>applyBenchCommand(changedWorkspace(w=>{w.placements[0]!.scale=1.1;}),command)).toThrow();
  const wrongSize=structuredClone(command);wrongSize.bench.dimensions.depth=.4;
  expect(()=>applyBenchCommand(doc,wrongSize)).toThrow();
  const smallBench=structuredClone(command);delete smallBench.bench.workspaceVisual;
  expect(()=>applyBenchCommand(doc,smallBench)).toThrow();
  doc=applyBenchCommand(doc,command);
  const duplicate=structuredClone(command);
  duplicate.bench.id='10000000-0000-4000-8000-000000000024';
  delete duplicate.viewpoint;
  expect(()=>applyBenchCommand(doc,duplicate)).toThrow();
 }
 let visible=false;
 const camera=await createNavigationController(doc,{position:[0,1.65,2],stoolVisible:()=>visible});
 try {
  expect(camera.isWalkable([0,1.65,0])).toBe(true);
  visible=true;
  expect(camera.isWalkable([0,1.65,0])).toBe(false);
  for(let frame=0;frame<180;frame++)camera.advance(1/60,{forward:1,right:0,paused:false});
  expect(camera.state().blocked).toBe(true);
  expect(camera.state().eyePosition[2]).toBeGreaterThan(.43);
  for(const x of [-.65,.65]){
   camera.reset({position:[x,1.65,1]});
   for(let frame=0;frame<120;frame++)camera.advance(1/60,{forward:1,right:0,paused:false});
   expect(camera.state().eyePosition[2]).toBeLessThan(-1);
  }
  visible=false;
  camera.reset({position:[0,1.65,2]});
  for(let frame=0;frame<180;frame++)camera.advance(1/60,{forward:1,right:0,paused:false});
  expect(camera.state().eyePosition[2]).toBeLessThan(-1);
 }finally{camera.dispose();}
 const idOfPlacement='10000000-0000-4000-8000-000000000021';
 const off=structuredClone(doc);
 off.extensions![COLLISION]={version:1,overrides:[{kind:'workspace',id:idOfPlacement,enabled:false}]};
 const disabled=await createNavigationController(off,{position:[0,1.65,2],stoolVisible:()=>true});
 try{
  for(let frame=0;frame<180;frame++)disabled.advance(1/60,{forward:1,right:0,paused:false});
  expect(disabled.state().eyePosition[2]).toBeLessThan(-1);
  if(linked)expect(disabled.seatedClear([0,1.15,0],[0,0,0],.45,'10000000-0000-4000-8000-000000000023')).toBe(true);
 }finally{disabled.dispose();}
 if(linked)return;
 model.sha256='0'.repeat(64);
 const unknown=await createNavigationController(doc,{position:[0,1.65,2],stoolVisible:()=>true});
 try {
  for(let frame=0;frame<180;frame++)unknown.advance(1/60,{forward:1,right:0,paused:false});
  expect(unknown.state().eyePosition[2]).toBeLessThan(-1);
 }
 finally{unknown.dispose();}
});
