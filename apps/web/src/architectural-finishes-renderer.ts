// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {Exhibition} from '@exhibitos/spec';
import {wallFinishesFor,architecturalWallBoxes,validateArchitecturalFinishes} from '@exhibitos/studio-contract';
/** Base surface materials are borrowed. Box geometry and two finish materials belong to this scene. */
export function installArchitecturalFinishes(three:typeof Three,document:Exhibition,surfaces:ReadonlyMap<string,Three.Group>,baseMaterials:ReadonlyMap<string,Three.MeshStandardMaterial>){
 if(!validateArchitecturalFinishes(document).valid)throw Error('ARCHITECTURAL_FINISH_INVALID');
 const walls=wallFinishesFor(document),geometry=walls.length?new three.BoxGeometry(1,1,1):undefined,materials=new Map<string,Three.MeshStandardMaterial>(),meshes:Three.InstancedMesh[]=[];
 const records:{surfaceId:string;depth:number;preset:string;boxes:number;triangles:number;openingWidths:number[]}[]=[];let disposed=false;
 const dispose=()=>{if(disposed)return;disposed=true;for(const m of meshes){m.removeFromParent();m.dispose();}geometry?.dispose();for(const m of materials.values())m.dispose();materials.clear();};
 try{for(const wall of walls){const surface=document.surfaces.find(s=>s.id.toLowerCase()===wall.surfaceId.toLowerCase())!,parent=surfaces.get(wall.surfaceId.toLowerCase()),base=baseMaterials.get(wall.surfaceId.toLowerCase());if(!parent||!base)throw Error('ARCHITECTURAL_FINISH_REFERENCE');
  const boxes=architecturalWallBoxes(surface,document.openings,wall),pose=new three.Object3D();
  for(const kind of ['structure','finish'] as const){const items=boxes.filter(b=>b.kind===kind);if(!items.length)continue;let material=base;
   if(kind==='finish'){let own=materials.get(wall.preset);if(!own){own=new three.MeshStandardMaterial(wall.preset==='dark-edge'?{color:'#293b36',roughness:.4,metalness:.7}:{color:'#dedbd2',roughness:.8,metalness:0});materials.set(wall.preset,own);}material=own;}
   const mesh=new three.InstancedMesh(geometry!,material,items.length);meshes.push(mesh);items.forEach((b,i)=>{pose.position.fromArray(b.position);pose.scale.set(b.dimensions.width,b.dimensions.height,b.dimensions.depth);pose.updateMatrix();mesh.setMatrixAt(i,pose.matrix);});mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();mesh.userData.editorSelection={kind:'surface',id:surface.id};mesh.userData.architecturalFinish={surfaceId:surface.id,kind};parent.add(mesh);
  }
  records.push({surfaceId:surface.id,depth:wall.depth,preset:wall.preset,boxes:boxes.length,triangles:boxes.length*12,openingWidths:document.openings.filter(o=>o.surfaceId.toLowerCase()===surface.id.toLowerCase()).map(o=>o.dimensions.width)});
 }}catch(error){dispose();throw error;}
 return {records,meshes,dispose};
}
