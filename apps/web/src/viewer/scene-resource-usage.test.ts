// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import * as three from 'three';
import {collectSceneResourceUsage} from './scene-resource-usage';

test('keeps whole mounted inventory, room contributors and actual frame work distinct',()=>{
 const scene=new three.Scene(),a=new three.Group(),b=new three.Group(),geometry=new three.BoxGeometry(),material=new three.MeshBasicMaterial();
 a.add(new three.Mesh(geometry,material));b.add(new three.Mesh(geometry,material));b.visible=false;scene.add(a,b);
 const value=collectSceneResourceUsage(three,scene,new Map([['a',a],['b',b]]),{settled:false,frame:{calls:1,triangles:12},residentBytes:4096,transitionBytes:8192,shadow:{mode:'bounded',mapSize:512,casters:2,triangles:24,updates:1,omittedCasters:0,depthTriangles:48,depthDraws:4}});
 expect(value).toMatchObject({scope:'mounted-scene',complete:false,colorDraws:2,displayTriangles:24,shadowCasterTriangles:24,shadowDepthTriangles:48,residentBytes:4096,transitionBytes:8192,currentFrame:{scope:'current-view',colorAndDirtyDepthDraws:1}});
 expect(value.sections).toEqual([{roomId:'a',colorDraws:1,displayTriangles:12},{roomId:'b',colorDraws:1,displayTriangles:12}]);
 geometry.dispose();material.dispose();
});
test('does not turn unavailable memory or shadow observations into measured zero',()=>{
 const value=collectSceneResourceUsage(three,new three.Scene(),new Map(),{settled:true,residentBytes:NaN,transitionBytes:-1});
 expect(value).toMatchObject({residentBytes:null,transitionBytes:null,shadowCasterTriangles:null,shadowDepthTriangles:null,currentFrame:{colorAndDirtyDepthDraws:null,colorAndDirtyDepthTriangles:null}});
});
