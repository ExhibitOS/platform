// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';

type ProvenBox = Readonly<{corners: readonly Three.Vector3[]; unchanged(): boolean}>;

function closedBox(three: typeof Three, geometry: Three.BufferGeometry): ProvenBox | undefined {
  const position = geometry.getAttribute('position'), index = geometry.index;
  const wholeDraw = () => geometry.groups.length === 0 && geometry.drawRange.start === 0 &&
    (geometry.drawRange.count === 36 || geometry.drawRange.count === Infinity) &&
    Object.values(geometry.morphAttributes).every(attributes => !attributes.length);
  if (!(position instanceof three.BufferAttribute) || !(position.array instanceof Float32Array) ||
    position.normalized || position.gpuType!==three.FloatType || position.itemSize !== 3 || position.count < 8 || position.count > 24 ||
    position.array.length !== position.count*3 || !index || !(index.array instanceof Uint16Array) ||
    index.itemSize !== 1 || index.normalized || index.count !== 36 || index.array.length !== 36 || !wholeDraw()) return;

  const coordinates = Array.from({length:3},(_,axis) =>
    Array.from(new Set(position.array.filter((_,i)=>i%3===axis))).sort((a,b)=>a-b));
  if(coordinates.some(values=>values.length!==2||values.some(n=>!Number.isFinite(n))))return;
  const names = Array.from({length:position.count},(_,i) =>
    coordinates.reduce((bits,values,axis)=>bits|(Number(position.array[3*i+axis]===values[1])<<axis),0));
  if(new Set(names).size!==8)return;
  const triangles: number[][] = Array.from({length:6},()=>[]);
  const used=new Set<number>();
  const bit=(corner:number,axis:number)=>(corner>>axis)&1;
  for(let i=0;i<36;i+=3){
    const indices=[index.array[i]!,index.array[i+1]!,index.array[i+2]!];
    if(indices.some(vertex=>vertex>=names.length))return;
    indices.forEach(vertex=>used.add(vertex));
    const [a,b,c]=indices.map(vertex=>names[vertex]!) as [number,number,number];
    const constant=(~((a^b)|(a^c)))&7;
    if(constant!==1&&constant!==2&&constant!==4)return;
    const axis=Math.log2(constant),u=(axis+1)%3,v=(axis+2)%3;
    const area=(bit(b,u)-bit(a,u))*(bit(c,v)-bit(a,v))-(bit(b,v)-bit(a,v))*(bit(c,u)-bit(a,u));
    if(area!==(bit(a,axis)?1:-1))return;
    triangles[axis*2+bit(a,axis)]!.push((1<<a)|(1<<b)|(1<<c));
  }
  if(used.size!==names.length)return;
  for(const [face,pair] of triangles.entries()){
    if(pair.length!==2)return;
    const shared=pair[0]!&pair[1]!;
    const corners=Array.from({length:8},(_,i)=>i).filter(i=>(shared&(1<<i))!==0);
    // Opposite corners are the only shared edge that covers the complete face.
    if(corners.length!==2||(corners[0]!^corners[1]!)!==(7^(1<<Math.floor(face/2))))return;
  }
  const positionBuffer=position.array,indexBuffer=index.array;
  const positions=positionBuffer.slice(),indices=indexBuffer.slice();
  const positionCount=position.count,positionVersion=position.version,indexVersion=index.version;
  return {
    corners:Array.from({length:8},(_,i)=>new three.Vector3(
      coordinates[0]![bit(i,0)],coordinates[1]![bit(i,1)],coordinates[2]![bit(i,2)])),
    unchanged:()=>geometry.getAttribute('position')===position&&geometry.index===index&&wholeDraw()&&
      position.array===positionBuffer&&position.count===positionCount&&position.version===positionVersion&&
      position.array.length===positions.length&&position.itemSize===3&&!position.normalized&&position.gpuType===three.FloatType&&
      index.array===indexBuffer&&index.count===36&&index.version===indexVersion&&
      index.array.length===indices.length&&index.itemSize===1&&!index.normalized&&
      positions.every((n,i)=>Object.is(n,position.array[i]))&&indices.every((n,i)=>n===index.array[i]),
  };
}

export type ClosedBoxSpotDepth = Readonly<{
  has(mesh: Three.Mesh): boolean;
  current(mesh: Three.Mesh, room: Three.Object3D, spot: Three.SpotLight, lightId:string): boolean;
}>;

/** Ordinary placement ownership and complete CPU-side depth draw are both required. */
export function createClosedBoxSpotDepth(three: typeof Three) {
  const owned = new WeakMap<Three.Mesh, (room: Three.Object3D, spot: Three.SpotLight, lightId:string) => boolean>();
  const originalHook = three.Material.prototype.onBeforeCompile;
  function opaque(material: Three.Material): material is Three.MeshStandardMaterial {
    return material instanceof three.MeshStandardMaterial&&Object.is(material.constructor,three.MeshStandardMaterial)&&material.visible&&material.side===three.FrontSide&&
      material.shadowSide===null&&!material.transparent&&material.depthTest&&material.depthWrite&&material.alphaTest===0&&
      !material.alphaToCoverage&&!material.wireframe&&!material.clipShadows&&!material.clippingPlanes?.length&&material.opacity===1&&material.onBeforeCompile===originalHook&&
      material.customProgramCacheKey===three.Material.prototype.customProgramCacheKey&&
      !Object.values(material).some(value=>value instanceof three.Texture);
  }
  function soleMesh(clone:Three.Object3D){
    const nodes=[clone];
    for(let i=0;i<nodes.length;i++){
      const children=nodes[i]!.children;
      if(nodes.length+children.length>4)return;
      nodes.push(...children);
    }
    const meshes=nodes.filter((node):node is Three.Mesh=>node instanceof three.Mesh);
    const mesh=meshes[0];
    if(meshes.length!==1||!mesh||mesh.constructor!==three.Mesh||
      nodes.some(node=>node!==mesh&&node.constructor!==three.Group))return;
    return {nodes,mesh};
  }
  function couldBeBox(clone:Three.Object3D){
    const mesh=soleMesh(clone)?.mesh;
    if(!mesh||Array.isArray(mesh.material)||!opaque(mesh.material)||mesh.customDepthMaterial||mesh.customDistanceMaterial)return false;
    const position=mesh.geometry.getAttribute('position');
    return !!position&&position.count>=8&&position.count<=24&&mesh.geometry.index?.count===36;
  }
  function register(group: Three.Group, clone: Three.Object3D, current: (lightId:string) => boolean) {
    const drawable=soleMesh(clone);
    if(!drawable)return;
    const {nodes,mesh}=drawable;
    const material=mesh.material, geometry=mesh.geometry;
    if(Array.isArray(material)||!opaque(material)||mesh.customDepthMaterial||mesh.customDistanceMaterial)return;
    const box=closedBox(three,geometry);
    if(!box)return;
    const paths=[group,...nodes].map(node=>({node,parent:node.parent,children:[...node.children]}));
    const originalTranslation: number[]=[];
    const translationOnly=()=>{
      mesh.updateWorldMatrix(true,false);
      const elements=mesh.matrixWorld.elements;
      return [1,0,0,0,0,1,0,0,0,0,1,0].every((n,i)=>n===elements[i])&&elements[15]===1&&
        elements.slice(12,15).every(Number.isFinite);
    };
    if(!translationOnly())return;
    originalTranslation.push(...mesh.matrixWorld.elements.slice(12,15));
    owned.set(mesh,(room,spot,lightId)=>{
      if(group.parent!==room||clone.parent!==group||group.children.length!==1||!current(lightId)||
        mesh.material!==material||mesh.geometry!==geometry||!opaque(material)||
        mesh.customDepthMaterial||mesh.customDistanceMaterial||!box.unchanged()||
        !paths.every(({node,parent,children})=>node.visible&&node.parent===parent&&
          node.children.length===children.length&&node.children.every((child,i)=>child===children[i]))||
        !translationOnly()||originalTranslation.some((n,i)=>n!==mesh.matrixWorld.elements[12+i]))return false;
      const lamp=spot.getWorldPosition(new three.Vector3());
      const points=box.corners.map(corner=>corner.clone().applyMatrix4(mesh.matrixWorld));
      const worldBox=new three.Box3().setFromPoints(points);
      const magnitude=Math.max(1,...worldBox.min.toArray().map(Math.abs),...worldBox.max.toArray().map(Math.abs));
      // Keep opposing planes separated after world-position conversion to Float32.
      if(worldBox.containsPoint(lamp)||worldBox.getSize(new three.Vector3()).toArray().some(span=>span<=magnitude*2**-18))return false;
      // The first face cannot be supplied when near/far or a cone boundary clips the box.
      return points.every(point=>point.project(spot.shadow.camera).toArray().every(n=>Number.isFinite(n)&&Math.abs(n)<1-1e-6));
    });
  }
  const current:ClosedBoxSpotDepth['current']=(mesh,room,spot,lightId)=>owned.get(mesh)?.(room,spot,lightId)===true;
  return {register,couldBeBox,has:(mesh:Three.Mesh)=>owned.has(mesh),current};
}
