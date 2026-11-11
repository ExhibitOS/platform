// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,test} from 'vitest';
import * as three from 'three';
import {rectangularGroundContact} from './ground-contact-footprint';
const material=()=>new three.MeshStandardMaterial();
function box(room:three.Group){const mesh=new three.Mesh(new three.BoxGeometry(.4,.6,.2),material());mesh.position.y=.3;room.add(mesh);return mesh;}
function bottom(room:three.Group,positions:number[]){const geometry=new three.BufferGeometry();geometry.setAttribute('position',new three.Float32BufferAttribute(positions,3));const mesh=new three.Mesh(geometry,material());room.add(mesh);return mesh;}
function corners(result:NonNullable<ReturnType<typeof rectangularGroundContact>>){
  const q=new three.Quaternion().fromArray(result.rotation),center=new three.Vector3(...result.position);
  return [-1,1].flatMap(x=>[-1,1].map(z=>new three.Vector3(x*result.width/2,0,z*result.depth/2).applyQuaternion(q).add(center)));
}
test('box proof preserves actual room-local center and bottom rectangle',()=>{
  const room=new three.Group(),mesh=box(room);mesh.position.x=2;mesh.position.z=-1;
  const result=rectangularGroundContact(three,[mesh],room,0)!;
  expect(result).toBeDefined();expect(result.position).toEqual([2,0,-1]);
  expect(result.width*result.depth).toBeCloseTo(.08);expect(corners(result).every(v=>Math.abs(Math.abs(v.x-2)-.2)<1e-6&&Math.abs(Math.abs(v.z+1)-.1)<1e-6)).toBe(true);
});
test.each([1,-1])('yaw and mirrored yaw use actual matrices, including transformed room (%s)',mirror=>{
  const room=new three.Group();room.position.set(9,2,-4);room.rotation.y=.8;room.scale.set(2,1,3);
  const mesh=box(room);mesh.position.set(.7,.3,-.9);mesh.rotation.y=.37;mesh.scale.x=mirror;
  const result=rectangularGroundContact(three,[mesh],room,0)!;expect(result).toBeDefined();
  const expected=[-1,1].flatMap(x=>[-1,1].map(z=>new three.Vector3(x*.2,-.3,z*.1).applyMatrix4(mesh.matrix)));
  for(const point of corners(result))expect(Math.min(...expected.map(v=>v.distanceTo(point)))).toBeLessThan(1e-6);
});
test('round bottom is not promoted from its bounds to a rectangle',()=>{
  const room=new three.Group(),mesh=new three.Mesh(new three.CylinderGeometry(.2,.2,.6,24),material());mesh.position.y=.3;room.add(mesh);
  expect(rectangularGroundContact(three,[mesh],room,0)).toBeUndefined();
});
test('tilted, floating, below-floor and hidden feet keep fallback',()=>{
  for(const kind of ['tilted','floating','below','hidden','ancestor'] as const){
    const room=new three.Group(),mesh=box(room);
    if(kind==='tilted')mesh.rotation.x=.3;
    if(kind==='floating')mesh.position.y+=.01;
    if(kind==='below')mesh.position.y-=.01;
    if(kind==='hidden')mesh.visible=false;
    if(kind==='ancestor')room.visible=false;
    expect(rectangularGroundContact(three,[mesh],room,0),kind).toBeUndefined();
  }
});
test('two touching submeshes fill one true rectangle',()=>{
  const room=new three.Group();
  const a=bottom(room,[0,0,0,1,0,0,1,0,1]),b=bottom(room,[0,0,0,1,0,1,0,0,1]);
  const result=rectangularGroundContact(three,[a,b],room,0)!;expect(result).toBeDefined();expect(result.position).toEqual([.5,0,.5]);expect(result.width*result.depth).toBeCloseTo(1);
});
test('incomplete, separated, and overlap-with-hole footprints are rejected',()=>{
  const room=new three.Group();
  const a=bottom(room,[0,0,0,1,0,0,1,0,1]);
  expect(rectangularGroundContact(three,[a],room,0)).toBeUndefined();
  const b=bottom(room,[0,0,0,1,0,1,0,0,1]);b.position.x=2;
  expect(rectangularGroundContact(three,[a,b],room,0)).toBeUndefined();
  // Four-corner hull and summed area one, but overlapping triangles leave a hole.
  const c=bottom(room,[0,0,0,1,0,0,1,0,1,0,0,0,1,0,0,0,0,1]);
  expect(rectangularGroundContact(three,[c],room,0)).toBeUndefined();
});
test('unattached, alpha, deforming, nonfinite and excessive geometry are unsupported',()=>{
  for(const kind of ['unattached','alpha','wireframe','clipped','morph','nonfinite','excessive','instanced'] as const){
    const room=new three.Group();let mesh:three.Mesh=box(room);
    if(kind==='unattached')mesh.removeFromParent();
    if(kind==='alpha')(mesh.material as three.Material).alphaTest=.5;
    if(kind==='wireframe')(mesh.material as three.MeshStandardMaterial).wireframe=true;
    if(kind==='clipped')(mesh.material as three.Material).clippingPlanes=[new three.Plane(new three.Vector3(1,0,0))];
    if(kind==='morph')mesh.geometry.morphAttributes.position=[mesh.geometry.getAttribute('position').clone()];
    if(kind==='nonfinite')mesh.geometry.getAttribute('position').setX(0,NaN);
    if(kind==='excessive'){mesh.geometry=new three.BufferGeometry();mesh.geometry.setAttribute('position',new three.Float32BufferAttribute(new Float32Array(4097*9),3));}
    if(kind==='instanced'){mesh.removeFromParent();mesh=new three.InstancedMesh(new three.BoxGeometry(.4,.6,.2),material(),1);room.add(mesh);}
    expect(rectangularGroundContact(three,[mesh],room,0),kind).toBeUndefined();
  }
});

test('visibility and attachment revocation invalidate a previously proved foot',()=>{
  const room=new three.Group(),mesh=box(room);expect(rectangularGroundContact(three,[mesh],room,0)).toBeDefined();
  mesh.visible=false;expect(rectangularGroundContact(three,[mesh],room,0)).toBeUndefined();
  mesh.visible=true;mesh.removeFromParent();expect(rectangularGroundContact(three,[mesh],room,0)).toBeUndefined();
});
