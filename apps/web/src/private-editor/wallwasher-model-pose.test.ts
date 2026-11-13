// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import * as three from 'three';
import {MUSEUM_WALLWASHER_REAR_RELIEF_PROFILE as profile,MUSEUM_WALLWASHER_REAR_RELIEF_IDENTITY as asset,MUSEUM_WALLWASHER_REAR_RELIEF_PAINTING_PITCH as paintingPitch} from '../../../../packages/studio-contract/src/wallwasher-rear-relief-profile.js';
import {resolveWallwasherMountHead} from '../../../../packages/studio-contract/src/wallwasher-mount-head.js';
import {applyWallwasherModelPose,type ResolvedWallwasher} from './wallwasher-model-pose';
import {MUSEUM_TRACK_SPOT_PROFILE as spotProfile,MUSEUM_TRACK_SPOT_IDENTITY as spotAsset,MUSEUM_TRACK_SPOT_STATIC_PITCH} from '../../../../packages/studio-contract/src/track-spot-profile.js';

// Synthetic boxes reproduce the trusted profile's bounds, not its actual meshes.
// Real pinned GLB/loader correspondence is checked separately outside the repo.
export function wallwasherModelFixture(headPitch=paintingPitch){
 const model=new three.Group(),q=Math.SQRT1_2;
 for(const [i,part]of [...profile.fixedParts,...profile.headParts].entries()){
  const min=new three.Vector3(...part.bounds.min),max=new three.Vector3(...part.bounds.max),size=max.clone().sub(min),translation=new three.Vector3(i*.001,-i*.002,i*.003);
  const geometry=new three.BoxGeometry(size.x,size.y,size.z);geometry.translate(...min.clone().add(max).multiplyScalar(.5).sub(translation).toArray());
  const node=new three.Mesh(geometry,new three.MeshStandardMaterial());node.position.copy(translation);node.userData.name=part.name;node.name=part.name.replace(/\./g,'');model.add(node);
 }
 const fixedPose={position:[1,4,2] as [number,number,number],rotation:[0,q,0,q] as [number,number,number,number],scale:[1,1,1] as [number,number,number]};
 const resolved:ResolvedWallwasher={headPitch,...resolveWallwasherMountHead({profile,mountPose:fixedPose,headPitch,ceilingSurface:{pose:{position:[0,4,0],rotation:[q,0,0,q],scale:[1,1,1]},dimensions:{width:12,height:8}}})};
 return {model,resolved};
}
function snapshot(model:three.Object3D){return {children:[...model.children],nodes:model.children.map(node=>({node,position:node.position.toArray(),rotation:node.quaternion.toArray(),scale:node.scale.toArray(),data:{...node.userData}}))};}
function unchanged(model:three.Object3D,before:ReturnType<typeof snapshot>){expect(model.children).toEqual(before.children);for(const saved of before.nodes){expect(saved.node.parent).toBe(model);expect(saved.node.position.toArray()).toEqual(saved.position);expect(saved.node.quaternion.toArray()).toEqual(saved.rotation);expect(saved.node.scale.toArray()).toEqual(saved.scale);expect(saved.node.userData).toEqual(saved.data);}}
function trackSpotFixture(){
 const model=new three.Group(),q=Math.SQRT1_2;
 for(const part of [...spotProfile.fixedParts,...spotProfile.headParts]){
  const min=new three.Vector3(...part.bounds.min),max=new three.Vector3(...part.bounds.max),size=max.clone().sub(min),translation=new three.Vector3(.003,-.002,.001);
  const geometry=new three.BoxGeometry(...size.toArray());geometry.translate(...min.clone().add(max).multiplyScalar(.5).sub(translation).toArray());
  const node=new three.Mesh(geometry,new three.MeshStandardMaterial());node.position.copy(translation);node.userData.name=part.name;model.add(node);
 }
 const fixedPose={position:[-1.402,3.965,2.5] as [number,number,number],rotation:[0,q,0,q] as [number,number,number,number],scale:[1,1,1] as [number,number,number]};
 const resolved:ResolvedWallwasher={headPitch:MUSEUM_TRACK_SPOT_STATIC_PITCH,...resolveWallwasherMountHead({profile:spotProfile,mountPose:fixedPose,headPitch:MUSEUM_TRACK_SPOT_STATIC_PITCH,ceilingSurface:{pose:{position:[0,3.965,0],rotation:[q,0,0,q],scale:[1,1,1]},dimensions:{width:8,height:10}}})};
 return {model,resolved};
}
it('keeps the track adapter horizontal while aiming only the original five head nodes at the admitted static pitch',()=>{
 const {model,resolved}=trackSpotFixture(),before=snapshot(model),nodes=[...model.children] as three.Mesh[],buffers=nodes.map(n=>n.geometry.getAttribute('position').array.slice()),materials=nodes.map(n=>n.material);
 const {fixed,head}=applyWallwasherModelPose(three,model,spotAsset,resolved);model.updateMatrixWorld(true);
 expect(fixed.children).toHaveLength(9);expect(head.children).toHaveLength(5);
 const normal=new three.Vector3(0,1,0).applyQuaternion(fixed.quaternion);expect(normal.distanceTo(new three.Vector3(0,1,0))).toBeLessThan(1e-8);
 const aperture=new three.Vector3(...spotProfile.opticalA).applyMatrix4(head.matrixWorld);expect(aperture.distanceTo(new three.Vector3(...resolved.emitter))).toBeLessThan(1e-7);
 expect(new three.Vector3(...spotProfile.pivotP).applyMatrix4(head.matrixWorld).distanceTo(new three.Vector3(...spotProfile.pivotP).applyMatrix4(fixed.matrixWorld))).toBeLessThan(1e-7);
 for(const [i,node] of nodes.entries()){
  expect(node.position.toArray()).toEqual(before.nodes[i]!.position);expect(node.geometry.getAttribute('position').array).toEqual(buffers[i]);expect(node.material).toBe(materials[i]);
  const expected=resolved.parts.find(p=>p.name===node.userData.name)!,actual=new three.Box3().setFromObject(node);
  expect(actual.min.distanceTo(new three.Vector3(...expected.bounds.min))).toBeLessThan(1e-6);expect(actual.max.distanceTo(new three.Vector3(...expected.bounds.max))).toBeLessThan(1e-6);
 }
});
it('rejects an unrelated spot source or unadmitted pitch before reparenting its nodes',()=>{
 for(const wrong of ['source','pitch','missing'] as const){const {model,resolved}=trackSpotFixture();if(wrong==='pitch')resolved.headPitch=-Math.PI/3;if(wrong==='missing')model.remove(model.children[0]!);const before=snapshot(model);
  expect(()=>applyWallwasherModelPose(three,model,wrong==='source'?{...spotAsset,sha256:'0'.repeat(64)}:spotAsset,resolved)).toThrow();unchanged(model,before);
 }
});
it.each([0,paintingPitch])('applies two independent absolute room poses once and preserves the original local transforms (%s)',headPitch=>{
 const {model,resolved}=wallwasherModelFixture(headPitch),nodes=[...model.children] as three.Mesh[],before=snapshot(model),resources=nodes.map(n=>[n.geometry,n.material]);
 const {fixed,head}=applyWallwasherModelPose(three,model,asset,resolved);
 expect(fixed.parent).toBe(model);expect(head.parent).toBe(model);expect(fixed.children).toHaveLength(7);expect(head.children).toHaveLength(6);
 const room=new three.Group();room.position.set(8,0,-3);room.rotation.y=.31;room.add(model);room.updateMatrixWorld(true);
 for(const [i,node]of nodes.entries()){
  const source=[...profile.fixedParts,...profile.headParts].find(p=>p.name===node.userData.name)!,pose=profile.fixedParts.some(p=>p.name===source.name)?resolved.fixedPose:resolved.headPose;
  const matrix=new three.Matrix4().multiplyMatrices(room.matrixWorld,new three.Matrix4().compose(new three.Vector3(...pose.position),new three.Quaternion().fromArray(pose.rotation),new three.Vector3(1,1,1)));
  const expected=new three.Box3(new three.Vector3(...source.bounds.min),new three.Vector3(...source.bounds.max)).applyMatrix4(matrix),actual=new three.Box3().setFromObject(node);
  expect(actual.min.distanceTo(expected.min)).toBeLessThan(1e-6);expect(actual.max.distanceTo(expected.max)).toBeLessThan(1e-6);
  expect(node.position.toArray()).toEqual(before.nodes[i]!.position);expect([node.geometry,node.material]).toEqual(resources[i]);expect(node.userData.exhibitosLightFixture).toBe(true);
 }
 const aperture=new three.Vector3(...profile.opticalA).applyMatrix4(head.matrixWorld),expectedEmitter=new three.Vector3(...resolved.emitter).applyMatrix4(room.matrixWorld);
 expect(aperture.distanceTo(expectedEmitter)).toBeLessThan(1e-7);
 expect(new three.Vector3(...profile.pivotP).applyMatrix4(head.matrixWorld).distanceTo(new three.Vector3(...profile.pivotP).applyMatrix4(fixed.matrixWorld))).toBeLessThan(1e-7);
 expect(model.position.toArray()).toEqual([0,0,0]);expect(model.quaternion.toArray()).toEqual([0,0,0,1]);
});
it('rejects wrong identity and incomplete, duplicate or unknown original node names before changing any node',()=>{
 for(const kind of ['identity','missing','extra','duplicate','unknown'] as const){
  const {model,resolved}=wallwasherModelFixture();let identity:Parameters<typeof applyWallwasherModelPose>[2]=asset;
  if(kind==='identity')identity={...asset,sha256:'0'.repeat(64)};
  if(kind==='missing')model.remove(model.children[0]!);
  if(kind==='extra')model.add(new three.Group());
  if(kind==='duplicate')model.children[0]!.userData.name=model.children[1]!.userData.name;
  if(kind==='unknown')model.children[0]!.userData.name='Unqualified_part';
  const before=snapshot(model);expect(()=>applyWallwasherModelPose(three,model,identity,resolved)).toThrow();unchanged(model,before);
 }
});
it('rejects altered roots, node transforms, geometry and deformation atomically',()=>{
 for(const kind of ['rootRotation','rootScale','nodeRotation','nodeScale','translation','nested','morph','nonfinite','matrix'] as const){
  const {model,resolved}=wallwasherModelFixture(),node=model.children[0] as three.Mesh;
  if(kind==='rootRotation')model.rotation.y=.1;if(kind==='rootScale')model.scale.x=2;
  if(kind==='nodeRotation')node.rotation.x=.1;if(kind==='nodeScale')node.scale.y=2;if(kind==='translation')node.position.x+=.01;
  if(kind==='nested')node.add(new three.Group());if(kind==='morph')node.geometry.morphAttributes.position=[node.geometry.getAttribute('position').clone()];
  if(kind==='nonfinite')node.geometry.getAttribute('position').setX(0,NaN);if(kind==='matrix')node.matrixAutoUpdate=false;
  const before=snapshot(model);expect(()=>applyWallwasherModelPose(three,model,asset,resolved)).toThrow();unchanged(model,before);
 }
});
it('rejects unqualified angles, incompatible head poses and unrelated resolved part bounds before reparenting',()=>{
 for(const kind of ['angle','head','bounds'] as const){const {model,resolved}=wallwasherModelFixture(),value=structuredClone(resolved);
  if(kind==='angle')value.headPitch=-.5;if(kind==='head')value.headPose.position=[0,0,0];if(kind==='bounds')value.parts[0]!.bounds.min=[0,0,0];
  const before=snapshot(model);expect(()=>applyWallwasherModelPose(three,model,asset,value)).toThrow();unchanged(model,before);
 }
});
it('refuses double application and leaves caller-owned resources intact when its root is removed',()=>{
 const {model,resolved}=wallwasherModelFixture(),nodes=[...model.children] as three.Mesh[];
 applyWallwasherModelPose(three,model,asset,resolved);const groups=[...model.children],positions=nodes.map(n=>n.position.toArray());
 expect(()=>applyWallwasherModelPose(three,model,asset,resolved)).toThrow();expect(model.children).toEqual(groups);expect(nodes.map(n=>n.position.toArray())).toEqual(positions);
 const room=new three.Group();room.add(model);model.removeFromParent();expect(room.children).toHaveLength(0);expect(nodes.every(n=>n.parent?.parent===model)).toBe(true);
});
