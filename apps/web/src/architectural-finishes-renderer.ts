// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {Exhibition} from '@exhibitos/spec';
import {wallFinishesFor,architecturalWallBoxes,validateArchitecturalFinishes,surfaceTextureFor,validateWorkspaceFurnishings,WORKSPACE_FURNISHING_NAMESPACE,type SurfaceTextureBinding,type WorkspaceFurnishings} from '@exhibitos/studio-contract';
import {qualifiedModularPortalTarget,workspaceFitGeometry} from '@exhibitos/spec/workspace-fit-models';
import {wallOpeningShell,pairedOpeningRevealCoverage,buriedPairedFinish,type OpeningRevealCoverage} from './wall-opening-shell';
/** One draw per wall structure, as before, with continuous metre UVs across
 * opening-split front faces and real depth on reveals. No unit-box stretch. */
export function texturedWallGeometry(three:typeof Three,boxes:ReturnType<typeof architecturalWallBoxes>,parent:Three.Object3D,binding:Pick<SurfaceTextureBinding,'repeatMeters'|'rotation'>,coverage?:readonly OpeningRevealCoverage[],roomFacingOnly=false){
 parent.updateWorldMatrix(true,false);
 const scale=[0,1,2].map(axis=>new three.Vector3().setFromMatrixColumn(parent.matrixWorld,axis).length()),matrix=new three.Matrix3().setUvTransform(0,0,1/binding.repeatMeters[0],1/binding.repeatMeters[1],binding.rotation,0,0),point=new three.Vector2();
 const {dimensions,position}=boxes[0]!;
 const geometry=boxes.length>1?wallOpeningShell(three,boxes,coverage,roomFacingOnly):
  new three.BoxGeometry(dimensions.width,dimensions.height,dimensions.depth).translate(...position);
 const p=geometry.getAttribute('position'),n=geometry.getAttribute('normal'),uvs:number[]=[];
 for(let i=0;i<p.count;i++){
  const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
  if(Math.abs(n.getX(i))>.5)point.set(z*scale[2]!,y*scale[1]!);
  else if(Math.abs(n.getY(i))>.5)point.set(x*scale[0]!,z*scale[2]!);
  else point.set(x*scale[0]!,y*scale[1]!);
  point.applyMatrix3(matrix);uvs.push(point.x,point.y);
 }
 return geometry.setAttribute('uv',new three.Float32BufferAttribute(uvs,2));
}
function coincidentPortalWalls(document:Exhibition,coverage:ReadonlyMap<string,readonly OpeningRevealCoverage[]>){
 const result=new Set<string>();
 const workspace=document.extensions?.[WORKSPACE_FURNISHING_NAMESPACE] as WorkspaceFurnishings|undefined;
 if(!workspace?.openingAttachments?.length||!validateWorkspaceFurnishings(document).valid)return result;
 for(const attachment of workspace.openingAttachments){
  const descriptor=workspace.furnishings.find(row=>row.id===attachment.furnishingId&&row.version===attachment.furnishingVersion);
  const geometry=workspaceFitGeometry(descriptor);
  if(geometry?.profile!=='modular-portal-v1')continue;
  const pair=qualifiedModularPortalTarget(geometry,document,attachment.openingId,descriptor)?.coincidentPair;
  if(!pair||coverage.get(pair.hostSurfaceId)?.length!==1||coverage.get(pair.peerSurfaceId)?.length!==1)continue;
  result.add(pair.hostSurfaceId);result.add(pair.peerSurfaceId);
 }
 return result;
}

/** Base surface materials are borrowed. Box geometry and two finish materials belong to this scene. */
export function installArchitecturalFinishes(three:typeof Three,document:Exhibition,surfaces:ReadonlyMap<string,Three.Group>,baseMaterials:ReadonlyMap<string,Three.MeshStandardMaterial>,workspaceBindings?:ReadonlyMap<string,Pick<SurfaceTextureBinding,'repeatMeters'|'rotation'>>){
 if(!validateArchitecturalFinishes(document).valid)throw Error('ARCHITECTURAL_FINISH_INVALID');
 const walls=wallFinishesFor(document),coverage=pairedOpeningRevealCoverage(three,document,surfaces,walls),geometry=walls.length?new three.BoxGeometry(1,1,1):undefined,materials=new Map<string,Three.MeshStandardMaterial>(),meshes:Three.Mesh[]=[],ownedGeometries:Three.BufferGeometry[]=[];
 const roomFacingWalls=coincidentPortalWalls(document,coverage);
 const records:{surfaceId:string;depth:number;preset:string;boxes:number;triangles:number;openingWidths:number[]}[]=[];let disposed=false;
 const dispose=()=>{if(disposed)return;disposed=true;for(const m of meshes){m.removeFromParent();if(m instanceof three.InstancedMesh)m.dispose();}geometry?.dispose();for(const g of ownedGeometries)g.dispose();for(const m of materials.values())m.dispose();materials.clear();};
 try{for(const wall of walls){const surface=document.surfaces.find(s=>s.id.toLowerCase()===wall.surfaceId.toLowerCase())!,parent=surfaces.get(wall.surfaceId.toLowerCase()),base=baseMaterials.get(wall.surfaceId.toLowerCase());if(!parent||!base)throw Error('ARCHITECTURAL_FINISH_REFERENCE');
  const boxes=architecturalWallBoxes(surface,document.openings,wall,true,document),pose=new three.Object3D();
  const roomFacingOnly=roomFacingWalls.has(surface.id.toLowerCase());
  const openingWidths=document.openings.filter(o=>o.surfaceId.toLowerCase()===surface.id.toLowerCase()).map(o=>o.dimensions.width);
  let triangles=0;
  for(const kind of ['structure','finish'] as const){const items=boxes.filter(b=>b.kind===kind&&(!roomFacingOnly||kind==='structure'||b.position[2]>0)&&!buriedPairedFinish(b,coverage.get(surface.id.toLowerCase())));if(!items.length)continue;let material=base;
   if(kind==='finish'){const style=wall.preset==='dark-edge'?'dark-edge':'painted-edge';let own=materials.get(style);if(!own){own=new three.MeshStandardMaterial(style==='dark-edge'?{color:'#293b36',roughness:.4,metalness:.7}:{color:'#dedbd2',roughness:.8,metalness:0});materials.set(style,own);}material=own;}
   const binding=kind==='structure'?(workspaceBindings?.get(surface.id.toLowerCase())??surfaceTextureFor(document,surface.id)):undefined;let mesh:Three.Mesh;
   if(binding||kind==='structure'&&items.length>1){
    const reveal=coverage.get(surface.id.toLowerCase()),own=binding?texturedWallGeometry(three,items,parent,binding,reveal,roomFacingOnly):wallOpeningShell(three,items,reveal,roomFacingOnly);
    ownedGeometries.push(own);own.computeBoundingBox();own.computeBoundingSphere();
    mesh=new three.Mesh(own,material);triangles+=own.index!.count/3;
   }
   else{const instanced=new three.InstancedMesh(geometry!,material,items.length);items.forEach((b,i)=>{pose.position.fromArray(b.position);pose.scale.set(b.dimensions.width,b.dimensions.height,b.dimensions.depth);pose.updateMatrix();instanced.setMatrixAt(i,pose.matrix);});instanced.instanceMatrix.needsUpdate=true;instanced.computeBoundingBox();instanced.computeBoundingSphere();mesh=instanced;triangles+=items.length*12;}
   meshes.push(mesh);mesh.userData.editorSelection={kind:'surface',id:surface.id};mesh.userData.architecturalFinish={surfaceId:surface.id,kind};parent.add(mesh);
  }
  records.push({surfaceId:surface.id,depth:wall.depth,preset:wall.preset,boxes:boxes.length,triangles,openingWidths});
 }}catch(error){dispose();throw error;}
 return {records,meshes,dispose};
}
