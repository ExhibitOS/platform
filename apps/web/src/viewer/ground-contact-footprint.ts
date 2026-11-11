// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as THREE from 'three';

type Point={x:number;z:number};
export type RectangularGroundContact={position:[number,number,number];rotation:[number,number,number,number];width:number;depth:number};
const cross=(a:Point,b:Point,c:Point)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
const area=(points:readonly Point[])=>points.length<3?0:Math.abs(points.slice(1,-1).reduce((sum,p,i)=>sum+cross(points[0]!,p,points[i+2]!),0))/2;
/** Proof from actual floor triangles, never the object's bounding box. The scan
 * and pairwise overlap proof are bounded; unsupported geometry keeps fallback. */
export function rectangularGroundContact(three:typeof THREE,objects:readonly THREE.Object3D[],room:THREE.Group,floorY:number):RectangularGroundContact|undefined{
  if(!Number.isFinite(floorY)||!objects.length)return;
  room.updateWorldMatrix(true,true);
  if(!room.matrixWorld.elements.every(Number.isFinite)||Math.abs(room.matrixWorld.determinant())<1e-12)return;
  const inverse=room.matrixWorld.clone().invert(),triangles:Point[][]=[],seen=new Set<THREE.Object3D>();
  let scanned=0,invalid=false;
  for(const object of objects){
    let attached=false;
    for(let ancestor:THREE.Object3D|null=object;ancestor;ancestor=ancestor.parent){if(!ancestor.visible)invalid=true;if(ancestor===room)attached=true;}
    if(!attached)return;
    object.traverse(node=>{
      if(invalid||seen.has(node))return;seen.add(node);
      if(!node.visible){invalid=true;return;}
      if(!(node instanceof three.Mesh))return;
      const geometry=node.geometry,materials=Array.isArray(node.material)?node.material:[node.material];
      if(Array.isArray(node.material)||node instanceof three.SkinnedMesh||node instanceof three.InstancedMesh||('isBatchedMesh'in node&&node.isBatchedMesh)||
        ('isInstancedBufferGeometry'in geometry&&geometry.isInstancedBufferGeometry)||Object.values(geometry.morphAttributes).some(v=>!Array.isArray(v)||v.length>0)||
        materials.some(m=>!m.visible||!m.depthTest||m.transparent||m.opacity<1||m.alphaTest>0||m.alphaHash||!!m.clippingPlanes?.length||('wireframe'in m&&m.wireframe)||('alphaMap'in m&&m.alphaMap)||('displacementMap'in m&&m.displacementMap)||m instanceof three.ShaderMaterial||m.onBeforeCompile!==three.Material.prototype.onBeforeCompile)) {invalid=true;return;}
      const positions=geometry.getAttribute('position'),index=geometry.index,count=index?.count??positions?.count??0;
      if(!positions||positions.itemSize!==3||count%3||geometry.drawRange.start!==0||geometry.drawRange.count<count){invalid=true;return;}
      const matrix=new three.Matrix4().multiplyMatrices(inverse,node.matrixWorld);
      if(!matrix.elements.every(Number.isFinite)||Math.abs(matrix.determinant())<1e-12){invalid=true;return;}
      for(let i=0;i<count;i+=3){
        if(++scanned>4096){invalid=true;return;}
        const vertices=[0,1,2].map(offset=>{
          const at=index?.getX(i+offset)??i+offset;
          if(!Number.isSafeInteger(at)||at<0||at>=positions.count){invalid=true;return new three.Vector3(NaN,NaN,NaN);}
          return new three.Vector3().fromBufferAttribute(positions,at).applyMatrix4(matrix);
        });
        if(vertices.some(v=>!v.toArray().every(Number.isFinite)||v.y<floorY-.004)){invalid=true;return;}
        if(!vertices.every(v=>Math.abs(v.y-floorY)<=.004))continue;
        const [a,b,c]=vertices as [THREE.Vector3,THREE.Vector3,THREE.Vector3],normal=b.clone().sub(a).cross(c.clone().sub(a));
        if(normal.lengthSq()<1e-20)continue;
        if(Math.hypot(normal.x,normal.z)>Math.abs(normal.y)*1e-5){invalid=true;return;}
        const triangle=vertices.map(v=>({x:v.x,z:v.z}));if(cross(triangle[0]!,triangle[1]!,triangle[2]!)<0)triangle.reverse();
        triangles.push(triangle);if(triangles.length>128){invalid=true;return;}
      }
    });
  }
  if(invalid||!triangles.length)return;
  const points=triangles.flat().sort((a,b)=>a.x-b.x||a.z-b.z),unique=points.filter((p,i)=>!i||Math.hypot(p.x-points[i-1]!.x,p.z-points[i-1]!.z)>1e-8);
  const half=(input:Point[])=>{const result:Point[]=[];for(const p of input){while(result.length>1&&cross(result[result.length-2]!,result[result.length-1]!,p)<=1e-10)result.pop();result.push(p);}return result;};
  const lower=half(unique),upper=half([...unique].reverse());lower.pop();upper.pop();const hull=[...lower,...upper];
  if(hull.length!==4)return;
  const edges=hull.map((p,i)=>({x:hull[(i+1)%4]!.x-p.x,z:hull[(i+1)%4]!.z-p.z})),lengths=edges.map(e=>Math.hypot(e.x,e.z));
  if(lengths.some(length=>!Number.isFinite(length)||length<1e-5))return;
  for(let i=0;i<4;i++){const a=edges[i]!,b=edges[(i+1)%4]!;if(Math.abs(a.x*b.x+a.z*b.z)>lengths[i]!*lengths[(i+1)%4]!*1e-6)return;}
  const rectangleArea=area(hull),tolerance=Math.max(1e-12,rectangleArea*1e-6);
  if(!Number.isFinite(rectangleArea)||rectangleArea<=0)return;
  if(Math.abs(triangles.reduce((sum,t)=>sum+area(t),0)-rectangleArea)>tolerance)return;
  // Equal summed area alone could hide overlapping triangles plus a hole.
  for(let i=0;i<triangles.length;i++)for(let j=0;j<i;j++){
    let polygon=triangles[i]!.slice();const clip=triangles[j]!;
    for(let k=0;k<3&&polygon.length;k++){
      const a=clip[k]!,b=clip[(k+1)%3]!,output:Point[]=[];
      for(let n=0;n<polygon.length;n++){
        const p=polygon[n]!,q=polygon[(n+1)%polygon.length]!,dp=cross(a,b,p),dq=cross(a,b,q);
        if(dp>=0)output.push(p);
        if((dp>=0)!==(dq>=0)){const t=dp/(dp-dq);output.push({x:p.x+(q.x-p.x)*t,z:p.z+(q.z-p.z)*t});}
      }polygon=output;
    }
    if(polygon.length>2&&area(polygon)>tolerance)return;
  }
  const x=edges[0]!,width=lengths[0]!,depth=lengths[1]!,yaw=Math.atan2(-x.z,x.x),q=new three.Quaternion().setFromAxisAngle(new three.Vector3(0,1,0),yaw);
  return {position:[hull.reduce((sum,p)=>sum+p.x,0)/4,floorY,hull.reduce((sum,p)=>sum+p.z,0)/4],rotation:[q.x,q.y,q.z,q.w],width,depth};
}
