// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {boundMapViewport,zoomMapViewport,panMapViewport,readMapView,saveMapView} from './map-viewport';
import type {VisitorMap} from './visitor-map';
const map:VisitorMap={key:'publication/revision-a',bounds:{x:0,z:0,width:20,depth:10},rooms:[{id:'room',name:'room',outline:[[0,0],[20,0],[20,10],[0,10]]}],doors:[],placements:[{id:'art',roomId:'room',title:'art',artworkType:'image',point:[5,3]}]};
afterEach(()=>vi.unstubAllGlobals());
it('anchors cursor and pinch-centroid zoom in the same world coordinates at any viewport aspect',()=>{
 for(const view of [map.bounds,{x:4,z:2,width:8,depth:8}]){
  const at:[number,number]=[.35,.6],next=zoomMapViewport(map,view,1.5,at);
  expect(next.x+next.width*at[0]).toBeCloseTo(view.x+view.width*at[0]);expect(next.z+next.depth*at[1]).toBeCloseTo(view.z+view.depth*at[1]);
  expect(next.width/next.depth).toBeCloseTo(view.width/view.depth);
 }
});
it('keeps zoom bounded, cannot pan the exhibition entirely away, and rejects malformed saved bounds',()=>{
 const close=zoomMapViewport(map,map.bounds,1e9);expect(close.width).toBe(2.5);expect(zoomMapViewport(map,close,1e-9)).toEqual(map.bounds);
 const pan=panMapViewport(map,close,1e9,-1e9);expect(pan.x+pan.width/2).toBe(20);expect(pan.z+pan.depth/2).toBe(0);
 expect(boundMapViewport(map,{...close,width:NaN})).toEqual(map.bounds);
});
it('restores only this tab and exact publication revision, preserving IDs without assets or stale revision state',()=>{
 const records=new Map<string,string>();vi.stubGlobal('sessionStorage',{getItem:(key:string)=>records.get(key)??null,setItem:(key:string,value:string)=>records.set(key,value),removeItem:(key:string)=>records.delete(key)});
 const saved={key:map.key,viewport:{x:2,z:1,width:10,depth:5},selected:{kind:'placement' as const,id:'art'},roomId:'room',open:true};saveMapView(map,saved);expect(readMapView(map)).toEqual(saved);
 expect(readMapView({...map,key:'other/revision-a'})).toBeUndefined();expect(readMapView({...map,key:'publication/revision-b'})).toBeUndefined();expect(records.size).toBe(0);
});
it('discards missing IDs and handles unavailable optional session storage',()=>{
 vi.stubGlobal('sessionStorage',{getItem:()=>JSON.stringify({key:map.key,viewport:map.bounds,selected:{kind:'placement',id:'removed'},roomId:'removed',open:false}),setItem:()=>{throw Error('denied');}});
 expect(readMapView(map)?.selected).toBeUndefined();expect(readMapView(map)?.roomId).toBeUndefined();expect(()=>saveMapView(map,{key:map.key,viewport:map.bounds,open:false})).not.toThrow();
});
