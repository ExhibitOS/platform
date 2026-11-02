// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import type {MapPoint,VisitorMap} from './visitor-map';
import {layoutMapMarkers,mapFanRadius,mapRoomViewport,reconcileMapMarkerPreview} from './map-display-layout';
import {visitorMapPreview,type MapSelection} from './visitor-map';

const room=(id:string,x:number,width=4,depth=6)=>({id,name:id,outline:[[x,0],[x+width,0],[x+width,depth],[x,depth]] as MapPoint[]});
function plan():VisitorMap{return {key:'test',bounds:{x:0,z:0,width:8,depth:6},rooms:[room('west',0),room('east',4)],doors:[],placements:[]};}
const image=(id:string,roomId:string,point:MapPoint,facing?:MapPoint)=>({id,roomId,point,facing,title:id,artworkType:'image'});

it('bounds display reach independently of the camera FOV and map size',()=>{
 for(const [span,pixels] of [[8,128],[60,192],[60,440],[.5,400]]){
  const reach=mapFanRadius(span!,pixels!);
  expect(reach).toBeLessThanOrEqual(2);expect(reach/span!*pixels!).toBeLessThanOrEqual(24+1e-8);
  expect(reach).toBeLessThanOrEqual(span!*.12);
 }
});

it('puts opposing shared-wall images inside their own rooms and retains exact anchors/IDs',()=>{
 const map=plan();map.placements=[image('a','west',[4,2],[-1,0]),image('b','east',[4,2],[1,0])];
 const original=structuredClone(map),markers=layoutMapMarkers(map,400,300);
 expect(markers[0]!.point![0]).toBeLessThan(4);expect(markers[1]!.point![0]).toBeGreaterThan(4);
 for(const m of markers){expect(m.anchor).toEqual([4,2]);expect(m.point![1]).toBeGreaterThan(.44);expect(m.point![1]).toBeLessThan(5.56);}
 expect(map).toEqual(original);expect(markers.map(m=>m.id)).toEqual(['a','b']);
});

it('separates a dense wall row without crossing the wall or room corners',()=>{
 const map=plan();map.rooms=[room('west',0,8,6)];map.placements=Array.from({length:7},(_,i)=>image('art'+i,'west',[1.8+i*.13,.01],[0,1]));
 const result=layoutMapMarkers(map,400,300).filter(m=>m.point);
 expect(result.length).toBe(7);
 for(const [i,m] of result.entries()){
  const [x,z]=m.point!;expect(x).toBeGreaterThanOrEqual(.48);expect(x).toBeLessThanOrEqual(7.52);expect(z).toBeGreaterThanOrEqual(.48);expect(z).toBeLessThanOrEqual(5.52);
  for(const n of result.slice(i+1))expect(Math.abs(x-n.point![0])>=.96-1e-8||Math.abs(z-n.point![1])>=.96-1e-8).toBe(true);
 }
});

it('does not evict a complete artwork target to reserve a room-centre control',()=>{
 const map=plan();map.rooms=[room('small',0,1.5,1.5)];map.placements=[image('one','small',[.01,.75],[1,0])];
 const result=layoutMapMarkers(map,320,240);
 expect(result[0]!.point).toBeDefined();expect(result[0]!.anchor).toEqual([.01,.75]);
});

it('zooms only the drawing scope, preserves real identities/anchors and returns the original overview',()=>{
 const map=plan();map.placements=[image('a','west',[4,2],[-1,0]),image('b','east',[4,2],[1,0])];
 const original=structuredClone(map),zoom=mapRoomViewport(map,'WEST');
 expect(zoom.key).toBe(map.key);expect(zoom.rooms).toEqual([map.rooms[0]]);expect(zoom.placements).toEqual([map.placements[0]]);
 expect(zoom.placements[0]).toBe(map.placements[0]);expect(zoom.bounds.width).toBe(zoom.bounds.depth);
 for(const [x,z] of zoom.rooms[0]!.outline){expect(x).toBeGreaterThan(zoom.bounds.x);expect(x).toBeLessThan(zoom.bounds.x+zoom.bounds.width);expect(z).toBeGreaterThan(zoom.bounds.z);expect(z).toBeLessThan(zoom.bounds.z+zoom.bounds.depth);}
 expect(mapRoomViewport(map,undefined)).toBe(map);expect(mapRoomViewport(map,'missing')).toBe(map);expect(map).toEqual(original);
});

it('keeps complete axis-aligned thumbnail targets inside a rotated room',()=>{
 const map=plan(),rotate=([x,z]:MapPoint):MapPoint=>[(x-z)/Math.sqrt(2)+4,(x+z)/Math.sqrt(2)];
 map.rooms=[{id:'r',name:'rotated',outline:room('r',0,3,3).outline.map(rotate)}];map.bounds={x:0,z:0,width:8,depth:8};map.placements=[image('one','r',rotate([0,1]),[1,1]),image('two','r',rotate([.1,1.1]),[1,1])];
 const result=layoutMapMarkers(map,480,480);expect(result.every(m=>m.point)).toBe(true);
 const polygon=map.rooms[0]!.outline;
 for(const m of result)for(const dx of [-24/60,24/60])for(const dz of [-24/60,24/60])for(let i=0;i<4;i++){
  const a=polygon[i]!,b=polygon[(i+1)%4]!,p:MapPoint=[m.point![0]+dx,m.point![1]+dz];
  expect((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])).toBeGreaterThanOrEqual(-1e-6);
 }
});

it('keeps identities selectable through the existing list when a narrow room cannot fit a target',()=>{
 const map=plan();map.rooms=[room('narrow',0,.5,6)];map.placements=[image('tight','narrow',[.01,3],[1,0])];
 expect(layoutMapMarkers(map,320,240)).toEqual([{id:'tight',anchor:[.01,3],point:undefined}]);
 expect(map.placements[0]!.roomId).toBe('narrow');
});

it('uses image facing to lay out corner collisions along the corresponding room side',()=>{
 const map=plan();map.rooms=[room('west',0,8,6)];map.placements=[image('a','west',[0,0],[0,1]),image('b','west',[0,0],[0,1])];
 const alongTop=layoutMapMarkers(map,400,300)[1]!.point!;
 map.placements=[image('a','west',[0,0],[1,0]),image('b','west',[0,0],[1,0])];
 const alongLeft=layoutMapMarkers(map,400,300)[1]!.point!;
 expect(alongTop[0]).toBeGreaterThan(alongLeft[0]);expect(alongTop[1]).toBeLessThan(alongLeft[1]);
});
it('drops vanished hover/focus after resize so another explicit fallback selection controls the preview',()=>{
 const map=plan();map.placements=[image('old','west',[0,0]),image('chosen','east',[8,0])];
 const before:MapSelection={key:map.key,hovered:{kind:'placement',id:'old'},focused:{kind:'placement',id:'old'},selected:{kind:'placement',id:'chosen'}};
 const next=reconcileMapMarkerPreview(before,new Set(['chosen']));
 expect(visitorMapPreview(map,next)).toEqual({kind:'placement',id:'chosen'});
 expect(before.focused?.id).toBe('old');expect(before.hovered?.id).toBe('old');expect(next.selected).toBe(before.selected);
 expect(reconcileMapMarkerPreview(before,new Set(['old','chosen']))).toBe(before);
});
