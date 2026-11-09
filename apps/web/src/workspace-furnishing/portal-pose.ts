// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import type {ModularPortalFit,ModularPortalRole,qualifiedModularPortalTarget} from '@exhibitos/spec/workspace-fit-models';

type Target=NonNullable<ReturnType<typeof qualifiedModularPortalTarget>>;
const near=(a:number,b:number)=>Math.abs(a-b)<=1e-5;

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
 * geometry. Paired reveals get placement-owned depth bias so the lining wins
 * at coplanar structural faces without moving the passage or trim. */
export function fitModularPortal(three:typeof Three,object:Three.Object3D,source:ModularPortalFit,target:Target,paired=false){
 const revealMaterials=new Map<Three.Material,Three.Material>();
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
  const [face,section]=role.split('-');
  if(paired&&face==='reveal'){
   const original=child.material;
   if(Array.isArray(original))throw Error('WORKSPACE_PLACEMENT_INVALID');
   let material=revealMaterials.get(original);
   if(!material){
    const biased:Three.Material=original.clone();
    biased.polygonOffset=true;
    biased.polygonOffsetFactor=-3;
    biased.polygonOffsetUnits=-6;
    revealMaterials.set(original,biased);
    material=biased;
   }
   child.material=material;
  }
  if(near(deltaX,0)&&near(deltaY,0)&&near(target.minZ,source.minZ)&&near(target.maxZ,source.maxZ))continue;
  const {min,max}=part,translation=child.position;
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
