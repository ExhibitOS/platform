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
