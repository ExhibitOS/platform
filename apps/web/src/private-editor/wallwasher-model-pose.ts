// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import {museumWallwasherRearReliefProfile} from '../../../../packages/studio-contract/src/wallwasher-rear-relief-profile.js';
import {museumTrackSpotProfile,isMuseumTrackSpotCatalogId} from '../../../../packages/studio-contract/src/track-spot-profile.js';
import type {WallwasherFixtureAssetIdentity} from '../../../../packages/studio-contract/src/wallwasher-fixture-profile.js';
import type {resolveWallwasherFromEmitter} from '../../../../packages/studio-contract/src/wallwasher-from-emitter.js';
import {articulatedTrackSpotProfile} from '../../../../packages/studio-contract/src/track-spot-articulated-profile.js';
import {solveTrackSpotAiming} from '../../../../packages/studio-contract/src/track-spot-aiming.js';
import type {TrackSpotAimingSuccess} from '../../../../packages/studio-contract/src/track-spot-aiming-resolver.js';
import type {WasherPose} from '../../../../packages/studio-contract/src/wallwasher-mount-head.js';

/** Exact authoritative result. Poses and bounds are ROOM-local, never children
 * of the optical quaternion. */
export type ResolvedWallwasher=ReturnType<typeof resolveWallwasherFromEmitter>;
export type ResolvedFixturePose=ResolvedWallwasher|TrackSpotAimingSuccess;
function fail():never{throw Error('WALLWASHER_MODEL_PROFILE_INVALID');}
const finite=(values:readonly number[])=>values.every(Number.isFinite);
const vectorClose=(a:readonly number[],b:readonly number[],epsilon=1e-6)=>a.length===b.length&&a.every((n,i)=>Number.isFinite(n)&&Number.isFinite(b[i])&&Math.abs(n-b[i]!)<=epsilon);

/** Called only after the ordinary immutable loader's integrity/authority/budget
 * checks. Validate the entire flat model BEFORE changing any scene membership.
 * No vertex edits, copies, textures, new materials, or resource ownership. */
export function applyWallwasherModelPose(three:typeof Three,model:Three.Object3D,asset:WallwasherFixtureAssetIdentity,resolved:ResolvedFixturePose){
 const articulated=asset.catalogId==='museum-track-spot-articulated'?articulatedTrackSpotProfile(asset):undefined;
 const profile=articulated?undefined:isMuseumTrackSpotCatalogId(asset.catalogId)?museumTrackSpotProfile(asset):museumWallwasherRearReliefProfile(asset);
 const sourceParts=articulated?.parts??[...profile!.fixedParts.map(part=>({...part,frame:'fixed' as const})),...profile!.headParts.map(part=>({...part,frame:'head' as const}))];
 const identity=(node:Three.Object3D)=>vectorClose(node.position.toArray(),[0,0,0],1e-9)&&vectorClose(node.quaternion.toArray(),[0,0,0,1],1e-9)&&vectorClose(node.scale.toArray(),[1,1,1],1e-9);
 if(!resolved||model.parent||!identity(model)||!model.visible||!model.matrixAutoUpdate||!model.matrixWorldAutoUpdate||model.children.length!==sourceParts.length)fail();
 const checkedPose=(p:WasherPose)=>{
  if(!p||!Array.isArray(p.position)||p.position.length!==3||!finite(p.position)||!Array.isArray(p.rotation)||p.rotation.length!==4||!finite(p.rotation)||Math.abs(Math.hypot(...p.rotation)-1)>1e-7||!Array.isArray(p.scale)||!vectorClose(p.scale,[1,1,1],1e-9))fail();
 };
 const poseClose=(a:WasherPose,b:WasherPose)=>{checkedPose(a);checkedPose(b);return vectorClose(a.position,b.position)&&(vectorClose(a.rotation,b.rotation,1e-7)||vectorClose(a.rotation,b.rotation.map(n=>-n),1e-7));};
 checkedPose(resolved.fixedPose);checkedPose(resolved.headPose);
 let yokePose:WasherPose|undefined;
 if(articulated){
  if(!('profile'in resolved)||resolved.profile!==articulated.profileId||!resolved.reachable)fail();
  // Reuse the authoritative forward solver; no second inverse/limit policy.
  const expected=solveTrackSpotAiming({mountPose:resolved.fixedPose,geometry:articulated.geometry,envelope:articulated.envelope,intent:{kind:'manual',yaw:resolved.yaw,pitch:resolved.pitch}});
  if(!expected.reachable||!poseClose(resolved.adapterPose,expected.adapterPose)||!poseClose(resolved.yokePose,expected.yokePose)||!poseClose(resolved.headPose,expected.headPose)||!Array.isArray(resolved.emitter)||!Array.isArray(resolved.direction)||!vectorClose(resolved.emitter,expected.emitter)||!vectorClose(resolved.direction,expected.direction))fail();
  yokePose=resolved.yokePose;
 }else{
  if(!('headPitch'in resolved)||!profile!.headPitchIntervals.some(([a,b])=>a===b&&a===resolved.headPitch))fail();
  const q=new three.Quaternion().fromArray(resolved.fixedPose.rotation),rx=new three.Quaternion().setFromAxisAngle(new three.Vector3(1,0,0),resolved.headPitch),pivot=new three.Vector3(...profile!.pivotP);
  const headPosition=pivot.clone().sub(pivot.clone().applyQuaternion(rx)).applyQuaternion(q).add(new three.Vector3(...resolved.fixedPose.position));
  if(!vectorClose(resolved.headPose.position,headPosition.toArray())||Math.abs(Math.abs(q.clone().multiply(rx).dot(new three.Quaternion().fromArray(resolved.headPose.rotation)))-1)>1e-7)fail();
 }
 const poses={fixed:resolved.fixedPose,yoke:yokePose,head:resolved.headPose};
 const byName=new Map<string,Three.Mesh>();
 if(!Array.isArray(resolved.parts)||resolved.parts.length!==sourceParts.length||new Set(resolved.parts.map(p=>p.name)).size!==sourceParts.length)fail();
 for(const node of model.children){
  // r186 sanitizes Object3D.name, but preserves the source nodeDef.name here.
  const name:unknown=node.userData.name,source=sourceParts.find(part=>part.name===name);
  if(typeof name!=='string'||!source||byName.has(name)||!(node instanceof three.Mesh)||node instanceof three.SkinnedMesh||node instanceof three.InstancedMesh||('isBatchedMesh'in node&&node.isBatchedMesh)||node.children.length||!node.visible||!node.matrixAutoUpdate||!node.matrixWorldAutoUpdate||!finite(node.position.toArray())||!vectorClose(node.quaternion.toArray(),[0,0,0,1],1e-9)||!vectorClose(node.scale.toArray(),[1,1,1],1e-9))fail();
  const geometry=node.geometry,position=geometry.getAttribute('position'),material=node.material;
  if(!position||position.itemSize!==3||('isInstancedBufferGeometry'in geometry&&geometry.isInstancedBufferGeometry)||Object.values(geometry.morphAttributes).some(v=>!Array.isArray(v)||v.length>0)||Array.isArray(material)||!material.visible||material.transparent||material.opacity!==1||material.alphaTest>0||material.alphaHash||material instanceof three.ShaderMaterial||('displacementMap'in material&&material.displacementMap)||node.customDepthMaterial||node.customDistanceMaterial)fail();
  const local=new three.Box3().setFromBufferAttribute(position).translate(node.position);
  if(!vectorClose(local.min.toArray(),source.bounds.min)||!vectorClose(local.max.toArray(),source.bounds.max))fail();
  const p=poses[source.frame];if(!p)fail();
  const world=local.clone().applyMatrix4(new three.Matrix4().compose(new three.Vector3(...p.position),new three.Quaternion().fromArray(p.rotation),new three.Vector3(1,1,1))),expected=resolved.parts.find(part=>part.name===name);
  if(!expected||!vectorClose(world.min.toArray(),expected.bounds.min)||!vectorClose(world.max.toArray(),expected.bounds.max))fail();
  if(articulated&&'profile'in resolved){
   const part=resolved.parts.find(part=>part.name===name);
   if(!part||part.frame!==source.frame||!poseClose(part.pose,p))fail();
  }
  byName.set(name,node);
 }
 if(byName.size!==sourceParts.length||sourceParts.some(part=>!byName.has(part.name)))fail();
 const fixed=new three.Group(),head=new three.Group(),yoke=yokePose?new three.Group():undefined;
 const groups={fixed,yoke,head};
 for(const frame of ['fixed','yoke','head'] as const){const group=groups[frame],p=poses[frame];if(group&&p){group.position.fromArray(p.position);group.quaternion.fromArray(p.rotation);group.scale.set(1,1,1);}}
 for(const part of sourceParts){const node=byName.get(part.name)!;node.userData.exhibitosLightFixture=true;groups[part.frame]!.add(node);}
 // .add intentionally retains each authored local translation. .attach would
 // compensate it against the new pose and undo the independent articulation.
 model.add(...(yoke?[fixed,yoke,head]:[fixed,head]));
 return {fixed,yoke,head};
}
