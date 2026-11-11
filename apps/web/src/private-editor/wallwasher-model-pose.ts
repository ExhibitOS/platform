// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import {museumWallwasherRearReliefProfile} from '../../../../packages/studio-contract/src/wallwasher-rear-relief-profile.js';
import type {WallwasherFixtureAssetIdentity} from '../../../../packages/studio-contract/src/wallwasher-fixture-profile.js';
import type {resolveWallwasherFromEmitter} from '../../../../packages/studio-contract/src/wallwasher-from-emitter.js';

/** Exact authoritative result. Poses and bounds are ROOM-local, never children
 * of the optical quaternion. */
export type ResolvedWallwasher=ReturnType<typeof resolveWallwasherFromEmitter>;
function fail():never{throw Error('WALLWASHER_MODEL_PROFILE_INVALID');}
const finite=(values:readonly number[])=>values.every(Number.isFinite);
const vectorClose=(a:readonly number[],b:readonly number[],epsilon=1e-6)=>a.length===b.length&&a.every((n,i)=>Number.isFinite(n)&&Number.isFinite(b[i])&&Math.abs(n-b[i]!)<=epsilon);

/** Called only after the ordinary immutable loader's integrity/authority/budget
 * checks. Validate the entire flat model BEFORE changing any scene membership.
 * No vertex edits, copies, textures, new materials, or resource ownership. */
export function applyWallwasherModelPose(three:typeof Three,model:Three.Object3D,asset:WallwasherFixtureAssetIdentity,resolved:ResolvedWallwasher){
 const profile=museumWallwasherRearReliefProfile(asset);
 const identity=(node:Three.Object3D)=>vectorClose(node.position.toArray(),[0,0,0],1e-9)&&vectorClose(node.quaternion.toArray(),[0,0,0,1],1e-9)&&vectorClose(node.scale.toArray(),[1,1,1],1e-9);
 if(!resolved||!profile.headPitchIntervals.some(([a,b])=>a===b&&a===resolved.headPitch)||model.parent||!identity(model)||!model.visible||!model.matrixAutoUpdate||!model.matrixWorldAutoUpdate||model.children.length!==13)fail();
 const checkedPose=(p:ResolvedWallwasher['fixedPose'])=>{
  if(!p||!Array.isArray(p.position)||p.position.length!==3||!finite(p.position)||!Array.isArray(p.rotation)||p.rotation.length!==4||!finite(p.rotation)||Math.abs(Math.hypot(...p.rotation)-1)>1e-7||!Array.isArray(p.scale)||!vectorClose(p.scale,[1,1,1],1e-9))fail();
 };
 checkedPose(resolved.fixedPose);checkedPose(resolved.headPose);
 const q=new three.Quaternion().fromArray(resolved.fixedPose.rotation),rx=new three.Quaternion().setFromAxisAngle(new three.Vector3(1,0,0),resolved.headPitch),pivot=new three.Vector3(...profile.pivotP);
 const headPosition=pivot.clone().sub(pivot.clone().applyQuaternion(rx)).applyQuaternion(q).add(new three.Vector3(...resolved.fixedPose.position));
 if(!vectorClose(resolved.headPose.position,headPosition.toArray())||Math.abs(Math.abs(q.clone().multiply(rx).dot(new three.Quaternion().fromArray(resolved.headPose.rotation)))-1)>1e-7)fail();
 const sourceParts=[...profile.fixedParts,...profile.headParts],byName=new Map<string,Three.Mesh>();
 if(!Array.isArray(resolved.parts)||resolved.parts.length!==13||new Set(resolved.parts.map(p=>p.name)).size!==13)fail();
 for(const node of model.children){
  // r186 sanitizes Object3D.name, but preserves the source nodeDef.name here.
  const name:unknown=node.userData.name,source=sourceParts.find(part=>part.name===name);
  if(typeof name!=='string'||!source||byName.has(name)||!(node instanceof three.Mesh)||node instanceof three.SkinnedMesh||node instanceof three.InstancedMesh||('isBatchedMesh'in node&&node.isBatchedMesh)||node.children.length||!node.visible||!node.matrixAutoUpdate||!node.matrixWorldAutoUpdate||!finite(node.position.toArray())||!vectorClose(node.quaternion.toArray(),[0,0,0,1],1e-9)||!vectorClose(node.scale.toArray(),[1,1,1],1e-9))fail();
  const geometry=node.geometry,position=geometry.getAttribute('position'),material=node.material;
  if(!position||position.itemSize!==3||('isInstancedBufferGeometry'in geometry&&geometry.isInstancedBufferGeometry)||Object.values(geometry.morphAttributes).some(v=>!Array.isArray(v)||v.length>0)||Array.isArray(material)||!material.visible||material.transparent||material.opacity!==1||material.alphaTest>0||material.alphaHash||material instanceof three.ShaderMaterial||('displacementMap'in material&&material.displacementMap)||node.customDepthMaterial||node.customDistanceMaterial)fail();
  const local=new three.Box3().setFromBufferAttribute(position).translate(node.position);
  if(!vectorClose(local.min.toArray(),source.bounds.min)||!vectorClose(local.max.toArray(),source.bounds.max))fail();
  const p=profile.fixedParts.some(part=>part.name===name)?resolved.fixedPose:resolved.headPose;
  const world=local.clone().applyMatrix4(new three.Matrix4().compose(new three.Vector3(...p.position),new three.Quaternion().fromArray(p.rotation),new three.Vector3(1,1,1))),expected=resolved.parts.find(part=>part.name===name);
  if(!expected||!vectorClose(world.min.toArray(),expected.bounds.min)||!vectorClose(world.max.toArray(),expected.bounds.max))fail();
  byName.set(name,node);
 }
 if(byName.size!==sourceParts.length||sourceParts.some(part=>!byName.has(part.name)))fail();
 const fixed=new three.Group(),head=new three.Group();
 for(const [group,p]of [[fixed,resolved.fixedPose],[head,resolved.headPose]] as const){group.position.fromArray(p.position);group.quaternion.fromArray(p.rotation);group.scale.set(1,1,1);}
 for(const [parts,group]of [[profile.fixedParts,fixed],[profile.headParts,head]] as const)for(const part of parts){const node=byName.get(part.name)!;node.userData.exhibitosLightFixture=true;group.add(node);}
 // .add intentionally retains each authored local translation. .attach would
 // compensate it against the new pose and undo the independent articulation.
 model.add(fixed,head);
 return {fixed,head};
}
