// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {Exhibition} from '@exhibitos/spec';
import {benchesFor,benchBoxes,validateStudioBenches} from '@exhibitos/studio-contract';
/** Bounded, owned shared geometry/PBR pool. No network assets or editor handles. */
export function installBenches(three:typeof Three,document:Exhibition,rooms:ReadonlyMap<string,Three.Group>){
  if(!validateStudioBenches(document).valid)throw Error('BENCH_INVALID');
  const benches=benchesFor(document),groups:Three.Group[]=[],materials=new Map<string,Three.MeshStandardMaterial>();
  const instances:Three.InstancedMesh[]=[];
  const geometry=benches.length?new three.BoxGeometry(1,1,1):undefined;
  let disposed=false;
  try{for(const bench of benches){
    const parent=rooms.get(bench.roomId.toLowerCase());if(!parent)throw Error('BENCH_REFERENCE');
    const group=new three.Group();groups.push(group);group.position.fromArray(bench.position);group.rotation.y=bench.yaw;group.userData.benchId=bench.id;parent.add(group);
    const m=bench.material,key=JSON.stringify([m.color.toLowerCase(),m.roughness,m.metalness]);
    let material=materials.get(key);if(!material){material=new three.MeshStandardMaterial({color:m.color,roughness:m.roughness,metalness:m.metalness});materials.set(key,material);}
    const boxes=benchBoxes(bench),mesh=new three.InstancedMesh(geometry!,material,boxes.length),pose=new three.Object3D();
    boxes.forEach((box,i)=>{pose.position.fromArray(box.position);pose.scale.set(box.dimensions.width,box.dimensions.height,box.dimensions.depth);pose.updateMatrix();mesh.setMatrixAt(i,pose.matrix);});
    mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();mesh.userData.benchId=bench.id;instances.push(mesh);group.add(mesh);
  }}catch(error){for(const g of groups)g.removeFromParent();for(const mesh of instances)mesh.dispose();geometry?.dispose();for(const m of materials.values())m.dispose();throw error;}
  return {groups,dispose(){if(disposed)return;disposed=true;for(const g of groups)g.removeFromParent();for(const mesh of instances)mesh.dispose();geometry?.dispose();for(const m of materials.values())m.dispose();materials.clear();}};
}
