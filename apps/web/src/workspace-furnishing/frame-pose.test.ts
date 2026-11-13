// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import * as three from 'three';
import {artworkFrameMatrix} from './frame-pose';
const identity={position:[0,0,0] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number],scale:[1,1,1] as [number,number,number]};
it('maps the source image reference to the artwork plane with front normal and rigid scale',()=>{
 const m=artworkFrameMatrix(three,identity,identity),plane=new three.Vector3(0,0,-.012).applyMatrix4(m),front=new three.Vector3(0,0,-1).transformDirection(m),anchor=new three.Vector3(0,0,0).applyMatrix4(m);
 expect(plane.length()).toBeLessThan(1e-10);expect(front.z).toBeCloseTo(1);expect(anchor.z).toBeCloseTo(-.012);expect(m.determinant()).toBeCloseTo(1);
 const moved={...identity,position:[2,1,3] as [number,number,number]},translated=new three.Vector3(0,0,-.012).applyMatrix4(artworkFrameMatrix(three,moved,identity));expect(translated.toArray()).toEqual([2,1,3]);
});
it('aligns the walnut image plane without scaling its geometry',()=>{
 const m=artworkFrameMatrix(three,identity,identity,-.034);
 expect(new three.Vector3(0,0,-.034).applyMatrix4(m).length()).toBeLessThan(1e-10);
 expect(new three.Vector3(0,0,0).applyMatrix4(m).z).toBeCloseTo(-.034);
 expect(m.determinant()).toBeCloseTo(1);
});
it.each([1.000709099666411,.9906979398504822])('keeps metric frame sections and the transformed image center at placement scale %s',scaleX=>{
 const rotation=new three.Quaternion().setFromAxisAngle(new three.Vector3(0,1,0),Math.PI/2);
 const placement={position:[-3.917,1.5,2.5] as [number,number,number],rotation:rotation.toArray() as [number,number,number,number],scale:[scaleX,1,1] as [number,number,number]};
 const art={...identity,position:[.01,-.02,.003] as [number,number,number]};
 const full=artworkFrameMatrix(three,placement,art),rigid=artworkFrameMatrix(three,placement,art,-.012,true);
 const imageCenter=new three.Vector3(...art.position).applyMatrix4(new three.Matrix4().compose(new three.Vector3(...placement.position),rotation,new three.Vector3(...placement.scale)));
 expect(new three.Vector3(0,0,-.012).applyMatrix4(rigid).distanceTo(imageCenter)).toBeLessThan(1e-10);
 expect(new three.Vector3().setFromMatrixPosition(rigid).distanceTo(new three.Vector3().setFromMatrixPosition(full))).toBeLessThan(1e-12);
 expect(rigid.determinant()).toBeCloseTo(1,12);
 for(const axis of [new three.Vector3(1,0,0),new three.Vector3(0,1,0),new three.Vector3(0,0,1)]){
  expect(axis.clone().applyMatrix4(rigid).distanceTo(new three.Vector3().applyMatrix4(rigid))).toBeCloseTo(1,12);
 }
 expect(full.determinant()).toBeCloseTo(scaleX,12);
 expect(placement.scale).toEqual([scaleX,1,1]);expect(art.scale).toEqual([1,1,1]);
});
