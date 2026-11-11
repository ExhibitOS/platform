// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {ModularPortalFit,ModularPortalRole,RectangularPortalFit,qualifiedModularPortalTarget} from '@exhibitos/spec/workspace-fit-models';

type Target=NonNullable<ReturnType<typeof qualifiedModularPortalTarget>>;
const near=(a:number,b:number)=>Math.abs(a-b)<=1e-5;

/** The binary worker admits only the closed, untextured 45 mm continuous
 * U-section. Move its inner and outer corners together; never scale the trim
 * width, grow a sill, or edit the registered original. The loader owns this
 * geometry copy. Axis-aligned face normals remain unchanged. */
export function fitRectangularPortal(three:typeof Three,object:Three.Object3D,source:RectangularPortalFit,target:Target){
 const meshes:Three.Mesh[]=[];
 object.traverse(child=>{if(child instanceof three.Mesh)meshes.push(child);});
 if(meshes.length!==1)throw Error('WORKSPACE_PLACEMENT_INVALID');
 const mesh=meshes[0]!,geometry=mesh.geometry,positions=geometry.getAttribute('position');
 if(!positions||!mesh.position.equals(new three.Vector3())||!mesh.quaternion.equals(new three.Quaternion())||!mesh.scale.equals(new three.Vector3(1,1,1)))throw Error('WORKSPACE_PLACEMENT_INVALID');
 const half=source.openingWidth/2,delta=(target.width-source.openingWidth)/2;
 const depth=(target.maxZ-target.minZ)/(source.maxZ-source.minZ);
 for(let i=0;i<positions.count;i++){
  const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i);
  if(![x,y,z].every(Number.isFinite)||Math.abs(x)<half-1e-5)throw Error('WORKSPACE_PLACEMENT_INVALID');
  positions.setXYZ(i,x+Math.sign(x)*delta,y>=source.openingHeight-1e-5?y+target.height-source.openingHeight:y*target.height/source.openingHeight,target.minZ+(z-source.minZ)*depth);
 }
 positions.needsUpdate=true;
 geometry.computeBoundingBox();geometry.computeBoundingSphere();
}

function axis(fromMin:number,fromMax:number,toMin:number,toMax:number){
 // Preserve the end bevels. The centre of each rail takes up the change.
 const cap=.01,innerMin=fromMin+cap,innerMax=fromMax-cap;
 const stretch=(toMax-toMin-2*cap)/(fromMax-fromMin-2*cap);
 return (value:number):[number,number]=>{
  if(near(fromMax-fromMin,toMax-toMin)||value<=innerMin)return [value+toMin-fromMin,1];
  if(value>=innerMax)return [value+toMax-fromMax,1];
  return [toMin+cap+(value-innerMin)*stretch,stretch];
 };
}

/** Adapt only nine independently measured rails. The loader owns their
 * geometry; neither the registered GLB nor its material is rewritten. */
export function fitModularPortal(three:typeof Three,object:Three.Object3D,source:ModularPortalFit,target:Target){
 const pending=new Map(Object.entries(source.parts) as [ModularPortalRole,ModularPortalFit['parts'][ModularPortalRole]][]);
 if(object.children.length!==pending.size)throw Error('WORKSPACE_PLACEMENT_INVALID');
 object.updateMatrixWorld(true);
 const deltaX=(target.width-source.openingWidth)/2,deltaY=target.height-source.openingHeight;
 for(const child of object.children){
  if(!(child instanceof three.Mesh)||child.children.length||!child.quaternion.equals(new three.Quaternion())||!child.scale.equals(new three.Vector3(1,1,1)))throw Error('WORKSPACE_PLACEMENT_INVALID');
  const geometry=child.geometry,positions=geometry.getAttribute('position'),normals=geometry.getAttribute('normal');
  const box=new three.Box3().setFromObject(child,true),entry=[...pending].find(([,part])=>box.min.toArray().every((n,i)=>near(n,part.min[i]!))&&box.max.toArray().every((n,i)=>near(n,part.max[i]!)));
  if(!entry||!positions||!normals||positions.count!==normals.count)throw Error('WORKSPACE_PLACEMENT_INVALID');
  const [role,part]=entry;pending.delete(role);
  if(near(deltaX,0)&&near(deltaY,0)&&near(target.minZ,source.minZ)&&near(target.maxZ,source.maxZ))continue;
  const [face,section]=role.split('-'),{min,max}=part,translation=child.position;
  const x=axis(min[0],max[0],min[0]+(section==='right'?deltaX:-deltaX),max[0]+(section==='left'?-deltaX:deltaX));
  const y=axis(min[1],max[1],min[1]+(section==='head'?deltaY:0),max[1]+deltaY);
  const shift=face==='front'?target.maxZ-source.maxZ:target.minZ-source.minZ;
  const z=axis(min[2],max[2],face==='reveal'?target.minZ:min[2]+shift,face==='reveal'?target.maxZ:max[2]+shift);
  const normal=new three.Vector3();
  for(let index=0;index<positions.count;index++){
   const [px,sx]=x(positions.getX(index)+translation.x),[py,sy]=y(positions.getY(index)+translation.y),[pz,sz]=z(positions.getZ(index)+translation.z);
   positions.setXYZ(index,px-translation.x,py-translation.y,pz-translation.z);
   normal.set(normals.getX(index)/sx,normals.getY(index)/sy,normals.getZ(index)/sz).normalize();
   normals.setXYZ(index,normal.x,normal.y,normal.z);
  }
  positions.needsUpdate=true;normals.needsUpdate=true;
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
 }
}


// Each architectural shell uses the base material owned by its surface.
// Keep that material so asynchronous wall textures still update it.
const wallBias=new WeakMap<Three.Material,{owners:number;restore:()=>void}>();
export function biasPairedPortalWalls(three:typeof Three,room:Three.Object3D,wallIds:ReadonlySet<string>){
 let root=room;
 while(root.parent)root=root.parent;
 const materials=new Set<Three.Material>();
 root.traverse(object=>{
  const finish=object.userData.architecturalFinish as {kind?:string;surfaceId?:string}|undefined;
  if(object instanceof three.Mesh&&finish?.kind==='structure'&&finish.surfaceId&&wallIds.has(finish.surfaceId.toLowerCase())&&!Array.isArray(object.material))materials.add(object.material);
 });
 for(const material of materials){
  const state=wallBias.get(material);
  if(state){state.owners++;continue;}
  const {polygonOffset,polygonOffsetFactor,polygonOffsetUnits}=material;
  wallBias.set(material,{owners:1,restore:()=>Object.assign(material,{polygonOffset,polygonOffsetFactor,polygonOffsetUnits})});
  material.polygonOffset=true;material.polygonOffsetFactor=3;material.polygonOffsetUnits=6;
 }
 return ()=>{
  for(const material of materials){
   const state=wallBias.get(material);
   if(state&&--state.owners===0){state.restore();wallBias.delete(material);}
  }
  materials.clear();
 };
}
