// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {Exhibition} from '@exhibitos/spec';
import {wallFinishesFor,architecturalWallBoxes,validateArchitecturalFinishes,surfaceTextureFor,type SurfaceTextureBinding} from '@exhibitos/studio-contract';
/** One draw per wall structure, as before, with continuous metre UVs across
 * opening-split front faces and real depth on reveals. No unit-box stretch. */
export function texturedWallGeometry(three:typeof Three,boxes:ReturnType<typeof architecturalWallBoxes>,parent:Three.Object3D,binding:SurfaceTextureBinding){
 parent.updateWorldMatrix(true,false);
 const scale=[0,1,2].map(axis=>new three.Vector3().setFromMatrixColumn(parent.matrixWorld,axis).length()),matrix=new three.Matrix3().setUvTransform(0,0,1/binding.repeatMeters[0],1/binding.repeatMeters[1],binding.rotation,0,0),point=new three.Vector2();
 const positions:number[]=[],normals:number[]=[],uvs:number[]=[],indices:number[]=[];
 for(const box of boxes){const geometry=new three.BoxGeometry(box.dimensions.width,box.dimensions.height,box.dimensions.depth);
  try{const p=geometry.getAttribute('position'),n=geometry.getAttribute('normal'),base=positions.length/3;
   for(let i=0;i<p.count;i++){const x=p.getX(i)+box.position[0],y=p.getY(i)+box.position[1],z=p.getZ(i)+box.position[2];positions.push(x,y,z);normals.push(n.getX(i),n.getY(i),n.getZ(i));
    if(Math.abs(n.getX(i))>.5)point.set(z*scale[2]!,y*scale[1]!);else if(Math.abs(n.getY(i))>.5)point.set(x*scale[0]!,z*scale[2]!);else point.set(x*scale[0]!,y*scale[1]!);
    point.applyMatrix3(matrix);uvs.push(point.x,point.y);
   }
   for(const index of geometry.index!.array)indices.push(base+index);
  }finally{geometry.dispose();}
 }
 return new three.BufferGeometry().setAttribute('position',new three.Float32BufferAttribute(positions,3)).setAttribute('normal',new three.Float32BufferAttribute(normals,3)).setAttribute('uv',new three.Float32BufferAttribute(uvs,2)).setIndex(indices);
}
/** Base surface materials are borrowed. Box geometry and two finish materials belong to this scene. */
export function installArchitecturalFinishes(three:typeof Three,document:Exhibition,surfaces:ReadonlyMap<string,Three.Group>,baseMaterials:ReadonlyMap<string,Three.MeshStandardMaterial>){
 if(!validateArchitecturalFinishes(document).valid)throw Error('ARCHITECTURAL_FINISH_INVALID');
 const walls=wallFinishesFor(document),geometry=walls.length?new three.BoxGeometry(1,1,1):undefined,materials=new Map<string,Three.MeshStandardMaterial>(),meshes:Three.Mesh[]=[],texturedGeometries:Three.BufferGeometry[]=[];
 const records:{surfaceId:string;depth:number;preset:string;boxes:number;triangles:number;openingWidths:number[]}[]=[];let disposed=false;
 const dispose=()=>{if(disposed)return;disposed=true;for(const m of meshes){m.removeFromParent();if(m instanceof three.InstancedMesh)m.dispose();}geometry?.dispose();for(const g of texturedGeometries)g.dispose();for(const m of materials.values())m.dispose();materials.clear();};
 try{for(const wall of walls){const surface=document.surfaces.find(s=>s.id.toLowerCase()===wall.surfaceId.toLowerCase())!,parent=surfaces.get(wall.surfaceId.toLowerCase()),base=baseMaterials.get(wall.surfaceId.toLowerCase());if(!parent||!base)throw Error('ARCHITECTURAL_FINISH_REFERENCE');
  const boxes=architecturalWallBoxes(surface,document.openings,wall),pose=new three.Object3D();
  for(const kind of ['structure','finish'] as const){const items=boxes.filter(b=>b.kind===kind);if(!items.length)continue;let material=base;
   if(kind==='finish'){let own=materials.get(wall.preset);if(!own){own=new three.MeshStandardMaterial(wall.preset==='dark-edge'?{color:'#293b36',roughness:.4,metalness:.7}:{color:'#dedbd2',roughness:.8,metalness:0});materials.set(wall.preset,own);}material=own;}
   const binding=kind==='structure'?surfaceTextureFor(document,surface.id):undefined;let mesh:Three.Mesh;
   if(binding){const own=texturedWallGeometry(three,items,parent,binding);texturedGeometries.push(own);own.computeBoundingBox();own.computeBoundingSphere();mesh=new three.Mesh(own,material);}
   else{const instanced=new three.InstancedMesh(geometry!,material,items.length);items.forEach((b,i)=>{pose.position.fromArray(b.position);pose.scale.set(b.dimensions.width,b.dimensions.height,b.dimensions.depth);pose.updateMatrix();instanced.setMatrixAt(i,pose.matrix);});instanced.instanceMatrix.needsUpdate=true;instanced.computeBoundingBox();instanced.computeBoundingSphere();mesh=instanced;}
   meshes.push(mesh);mesh.userData.editorSelection={kind:'surface',id:surface.id};mesh.userData.architecturalFinish={surfaceId:surface.id,kind};parent.add(mesh);
  }
  records.push({surfaceId:surface.id,depth:wall.depth,preset:wall.preset,boxes:boxes.length,triangles:boxes.length*12,openingWidths:document.openings.filter(o=>o.surfaceId.toLowerCase()===surface.id.toLowerCase()).map(o=>o.dimensions.width)});
 }}catch(error){dispose();throw error;}
 return {records,meshes,dispose};
}
