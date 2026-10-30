// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {Exhibition} from '@exhibitos/spec';
import {resolveInstallations,installationFor,resolveInstallation} from '@exhibitos/studio-contract';
import type {InstallationMaterial,InstallationPrimitive,ResolvedInstallation} from '@exhibitos/studio-contract';
/** Room-local sibling of replaceable/scaled artwork groups. Per-placement component/material
 * batches preserve authored triangles while bounding decorations to at most3 draw calls.
 */
export function installDecor(three:typeof Three,document:Exhibition,rooms:ReadonlyMap<string,Three.Group>){
 const resolved=resolveInstallations(document),groups=new Map<string,Three.Group>(),geometries=new Set<Three.BufferGeometry>(),materials=new Map<string,Three.MeshStandardMaterial>();
 type Batch={key:string;mesh:Three.Mesh<Three.BufferGeometry>};
 const frames=new Map<string,Batch[]>(),pedestals=new Map<string,Three.Object3D[]>();let disposed=false;
 const key=(m:InstallationMaterial)=>JSON.stringify([m.color.toLowerCase(),m.roughness,m.metalness]);
 const material=(m:InstallationMaterial)=>{const k=key(m);let result=materials.get(k);if(result)return result;result=new three.MeshStandardMaterial({color:new three.Color(m.color),roughness:m.roughness,metalness:m.metalness,side:three.DoubleSide,flatShading:true});materials.set(k,result);return result;};
 function merge(primitives:InstallationPrimitive[]){
  const batches=new Map<string,{material:InstallationMaterial;positions:number[];indices:number[]}>();
  for(const p of primitives){const k=key(p.material),batch=batches.get(k)??{material:p.material,positions:[],indices:[]},offset=batch.positions.length/3;batch.positions.push(...p.vertices.flat());batch.indices.push(...p.indices.map(i=>i+offset));batches.set(k,batch);}return batches;
 }
 function addBatches(group:Three.Group,primitives:InstallationPrimitive[],placementId:string){
  const result:Batch[]=[];
  for(const [k,batch]of merge(primitives)){
   const geometry=new three.BufferGeometry();geometries.add(geometry);geometry.setAttribute('position',new three.Float32BufferAttribute(batch.positions,3));geometry.setIndex(batch.indices);geometry.computeVertexNormals();
   const mesh=new three.Mesh(geometry,material(batch.material));mesh.userData.placementId=placementId;mesh.userData.editorSelection={kind:'placement',id:placementId};group.add(mesh);result.push({key:k,mesh});
  }return result;
 }
 const pedestalCount=(candidate:Exhibition,record:ResolvedInstallation)=>{const b=installationFor(candidate,record.placementId);return b?.pedestal&&b.pedestal.kind!=='none'&&!record.issues.some(i=>i.component==='pedestal')?1:0;};
 try{for(const record of resolved){
  const parent=rooms.get(record.roomId.toLowerCase());if(!parent)throw Error('INSTALLATION_REFERENCE');
  const group=new three.Group();group.userData.placementId=record.placementId;group.userData.editorSelection={kind:'placement',id:record.placementId};parent.add(group);groups.set(record.placementId.toLowerCase(),group);
  const count=pedestalCount(document,record);pedestals.set(record.placementId.toLowerCase(),addBatches(group,record.primitives.slice(0,count),record.placementId).map(batch=>batch.mesh));frames.set(record.placementId.toLowerCase(),addBatches(group,record.primitives.slice(count),record.placementId));
 }}catch(error){for(const group of groups.values())group.removeFromParent();for(const geometry of geometries)geometry.dispose();for(const m of materials.values())m.dispose();throw error;}
 const issues=resolved.flatMap(r=>r.issues.map(issue=>({placementId:r.placementId,...issue})));
 /** Update only the selected frame's existing buffers; pedestal remains independent.
  * Cancel restores the source candidate. Room transforms follow the common parent.
  * Config edits rebuild the owning scene and never grow this preview resource pool.
  */
 function preview(candidate:Exhibition,placementId:string){
  const id=placementId.toLowerCase(),batches=frames.get(id),record=resolved.find(r=>r.placementId.toLowerCase()===id);if(disposed||!batches||!record||record.issues.some(i=>i.component==='frame'))return issues.length;
  const next=resolveInstallation(candidate,placementId);if(!next)return issues.length;
  const retained=issues.filter(i=>i.placementId.toLowerCase()!==id||i.component!=='frame');issues.splice(0,issues.length,...retained,...next.issues.filter(i=>i.component==='frame').map(i=>({placementId:record.placementId,...i})));
  if(next.issues.some(i=>i.component==='frame')){for(const b of batches)b.mesh.visible=false;return issues.length;}
  const values=merge(next.primitives.slice(pedestalCount(candidate,next)));
  if(values.size!==batches.length)throw Error('INSTALLATION_PREVIEW_TOPOLOGY');
  const updates=batches.map(batch=>{const next=values.get(batch.key),attribute=batch.mesh.geometry.getAttribute('position'),index=batch.mesh.geometry.getIndex();if(!next||!attribute||attribute.count*3!==next.positions.length||!index||index.count!==next.indices.length||next.indices.some((v,i)=>v!==index.getX(i)))throw Error('INSTALLATION_PREVIEW_TOPOLOGY');return {mesh:batch.mesh,attribute,positions:new Float32Array(next.positions)};});
  // Complete validation/allocation precedes mutation, preventing partial previews.
  for(const {mesh,attribute,positions}of updates){(attribute.array as Float32Array).set(positions);attribute.needsUpdate=true;mesh.visible=true;mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();}return issues.length;
 }
 return {groups,pedestals,preview,issues,primitiveCount:resolved.reduce((n,r)=>n+r.primitives.length,0),dispose(){if(disposed)return;disposed=true;for(const g of groups.values())g.removeFromParent();for(const g of geometries)g.dispose();for(const m of materials.values())m.dispose();groups.clear();frames.clear();pedestals.clear();geometries.clear();materials.clear();}};
}
