// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {createMapContext} from './map-context';
import type {VisitorMap} from './visitor-map';
const map:VisitorMap={key:'pub/rev',rooms:[{id:'large',name:'Large',outline:[[0,0],[40,0],[40,20],[0,20]]},{id:'narrow',name:'Narrow',outline:[[40,0],[42,0],[42,20],[40,20]]}],doors:[{id:'a',roomId:'large',edge:[[40,9],[40,11]],connection:{doorId:'b',roomId:'narrow'}},{id:'b',roomId:'narrow',edge:[[40,9],[40,11]],connection:{doorId:'a',roomId:'large'}}],placements:[],bounds:{x:-1,z:-1,width:44,depth:22}};
it('fits the current room corners and both sides of the door inside a north-up circle',()=>{
 const original=structuredClone(map),context=createMapContext(map);
 for(const room of map.rooms){
  const selected=context.select(room.id==='large'?[.1,.1]:[41,10]);
  expect(selected.roomId).toBe(room.id);const b=selected.bounds;
  for(const p of [...room.outline,[39,10],[43,10]])expect(Math.hypot(p[0]!-b.x-b.width/2,p[1]!-b.z-b.depth/2)).toBeLessThan(b.width*.43);
  expect(b.width).toBe(b.depth);
 }
 expect(map).toEqual(original);
});
it('keeps a single crop at the wall, corner and centre; changes once after crossing the door margin',()=>{
 const context=createMapContext(map),first=context.select([0,0]);
 for(const p of [[.1,.1],[20,10],[39.99,10],[40.1,10]] as [number,number][])expect(context.select(p,first.roomId).bounds).toBe(first.bounds);
 const next=context.select([40.3,10],first.roomId);expect(next.roomId).toBe('narrow');expect(next.bounds).not.toBe(first.bounds);
 expect(context.select([39.95,10],next.roomId).bounds).toBe(next.bounds);
 expect(context.select([39.7,10],next.roomId).roomId).toBe('large');
});
it('keeps independent owners and preserves the last context across a short doorway gap',()=>{
 const context=createMapContext(map),first=context.select([1,1]);
 expect(context.select(undefined,first.roomId).bounds).toBe(first.bounds);
 expect(context.select([20,-.3],first.roomId).bounds).toBe(first.bounds);
 expect(context.select([100,100],first.roomId).roomId).toBeUndefined();
 expect(createMapContext({...map,key:'other'}).select(undefined).roomId).toBeUndefined();
});

it('keeps large square corners clear of the real 44px toggle in a 128px circle',()=>{
 const square={...map,rooms:[{id:'square',name:'Square',outline:[[0,0],[100,0],[100,100],[0,100]] as [number,number][]}]};
 const bounds=createMapContext(square).select([.1,.1]).bounds;
 for(const p of square.rooms[0]!.outline){
  const x=(p[0]-bounds.x)/bounds.width*128,z=(p[1]-bounds.z)/bounds.depth*128;
  expect(Math.hypot(x-64,z-64)).toBeLessThan(64);
  // Actual CSS: right:-2px, top:-2px, 44px diameter => centre(108,20).
  expect(Math.hypot(x-108,z-20)).toBeGreaterThan(22+2);
 }
});
