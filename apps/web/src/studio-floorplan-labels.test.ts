// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {ARTWORK_MARKER_RADIUS,artworkLabelLayout} from './studio-floorplan-labels';

const frame={left:-10,top:-10,span:20};
function expectSeparated(layout:ReturnType<typeof artworkLabelLayout>){
 const placed=[...layout.positions.values()];
 placed.forEach((point,i)=>{
  for(const previous of placed.slice(0,i))expect(Math.hypot(previous.x-point.x,previous.z-point.z)).toBeGreaterThanOrEqual(layout.radius*2);
 });
}
it('keeps distinct edge artwork near its actual anchor without clamping labels into one column',()=>{
 const anchors=[{id:'a',x:7.2,z:0},{id:'b',x:8.8,z:0},{id:'c',x:9.9,z:0}];
 const layout=artworkLabelLayout(anchors,frame);
 expect(layout.positions.size).toBe(3);
 expectSeparated(layout);
 expect(layout.positions.get('a')?.x).toBe(7.2);
 for(const anchor of anchors){
  const label=layout.positions.get(anchor.id)!;
  expect(Math.hypot(label.x-anchor.x,label.z-anchor.z)).toBeLessThanOrEqual(frame.span*.18);
  expect(label.x+layout.radius).toBeLessThanOrEqual(frame.left+frame.span);
 }
});
it('spreads coincident badges locally and omits only the excess in a deterministic order',()=>{
 const anchors=Array.from({length:40},(_,i)=>({id:String(i),x:0,z:0}));
 const layout=artworkLabelLayout(anchors,frame);
 expect(layout.positions.size).toBeGreaterThan(10);
 expect(layout.positions.size).toBeLessThan(anchors.length);
 expectSeparated(layout);
 expect(artworkLabelLayout(anchors,frame)).toEqual(layout);
 expect(anchors.every(({x,z})=>x===0&&z===0)).toBe(true);
});
it('repositions only visible anchor labels in the zoomed and panned frame',()=>{
 const anchors=[{id:'inside',x:2,z:2},{id:'outside',x:9,z:8}];
 const view={left:0,top:0,span:6},layout=artworkLabelLayout(anchors,view);
 expect([...layout.positions.keys()]).toEqual(['inside']);
 expect(layout.radius).toBeLessThan(artworkLabelLayout(anchors,frame).radius);
});

it('keeps zoomed badges clear of the full fixed-size artwork marker',()=>{
 const anchors=[{id:'one',x:2,z:2},{id:'two',x:2,z:1.6}],view={left:0,top:0,span:5};
 const layout=artworkLabelLayout(anchors,view);
 expect(layout.positions.size).toBe(2);
 for(const point of layout.positions.values())for(const anchor of anchors){
  expect(Math.hypot(point.x-anchor.x,point.z-anchor.z)).toBeGreaterThanOrEqual(layout.radius+ARTWORK_MARKER_RADIUS);
 }
});
