// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import {INSTALLATION_NAMESPACE as N} from '@exhibitos/studio-contract';
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
 const d=fixture(false,true),roomId=d.rooms[0]!.id,c=await createNavigationController(d,{position:[0,1.65,.4]}),server=createPresenceGeometry(d);try{
  const before={roomId,position:[0,1.65,.4] as [number,number,number],yaw:0},after={roomId,position:[0,1.65,-.4] as [number,number,number],yaw:0};expect(server.valid(before)).toBe(true);expect(server.valid(after)).toBe(true);expect(server.move(before,after,500)).toBe(false);expect(c.isWalkable([0,1.65,0])).toBe(false);expect(c.isWalkable([1,1.65,0])).toBe(true);
  for(let i=0;i<90;i++)c.advance(1/60,{forward:1,right:0,paused:false});expect(c.state().eyePosition[2]).toBeGreaterThan(.12);
 }finally{c.dispose();}
});
