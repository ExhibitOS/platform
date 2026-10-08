// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as THREE from 'three';
/** OES is already in metres. Metadata dimensions and historical conversion notes are not a second geometry transform. */
export function centerMetricModel(three: typeof THREE, source: THREE.Object3D) {
  source.updateWorldMatrix(true,true);
  let area=false;
  const a=new three.Vector3(),b=new three.Vector3(),c=new three.Vector3();
  source.traverse(node=>{
    if(!(node instanceof three.Mesh))return;
    const p=node.geometry.getAttribute('position'),index=node.geometry.index;
    if(!p||p.itemSize!==3||p.count>500000)throw Error('MODEL_METRIC_BOUNDS');
    for(let i=0;i<p.count;i++){a.fromBufferAttribute(p,i).applyMatrix4(node.matrixWorld);if(!a.toArray().every(Number.isFinite)||a.toArray().some(x=>Math.abs(x)>10000))throw Error('MODEL_METRIC_BOUNDS');}
    const count=index?.count??p.count;if(count%3)throw Error('MODEL_METRIC_BOUNDS');
    for(let i=0;i<count;i+=3){const ids=[0,1,2].map(j=>index?index.getX(i+j):i+j);if(ids.some(n=>!Number.isInteger(n)||n<0||n>=p.count))throw Error('MODEL_METRIC_BOUNDS');a.fromBufferAttribute(p,ids[0]!).applyMatrix4(node.matrixWorld);b.fromBufferAttribute(p,ids[1]!).applyMatrix4(node.matrixWorld);c.fromBufferAttribute(p,ids[2]!).applyMatrix4(node.matrixWorld);const n=b.sub(a).cross(c.sub(a)).lengthSq();if(!Number.isFinite(n))throw Error('MODEL_METRIC_BOUNDS');if(n>0)area=true;}
  });
  const bounds=new three.Box3().setFromObject(source,true),size=bounds.getSize(new three.Vector3()),center=bounds.getCenter(new three.Vector3()),extent=Math.max(size.x,size.y,size.z);
  // A display limit, never an epsilon thickness or scale applied to the source.
  if(!area||!bounds.min.toArray().concat(bounds.max.toArray(),size.toArray(),center.toArray()).every(Number.isFinite)||size.toArray().some(n=>n<0)||extent<1e-6||extent>10000)throw Error('MODEL_METRIC_BOUNDS');
  const object=new three.Group();object.position.copy(center).negate();object.add(source);
  return {object,extent,measured:{min:bounds.min.toArray(),max:bounds.max.toArray(),size:size.toArray(),anchorTranslation:object.position.toArray(),scale:[1,1,1],policy:'centered-artwork-local-metres'}};
}
export function metricCameraFit(extent:number,aspect:number,zoom=1){
 if(!Number.isFinite(extent)||extent<1e-6||extent>10000||!Number.isFinite(aspect)||aspect<=0||!Number.isFinite(zoom)||zoom<.5||zoom>3)throw Error('MODEL_CAMERA_BOUNDS');
 const distance=extent*2.1/zoom/Math.min(1,aspect),near=Math.max(extent/100,distance-extent*4),far=distance+extent*4;
 if(![distance,near,far].every(Number.isFinite)||near<=0||far<=near)throw Error('MODEL_CAMERA_BOUNDS');
 return {distance,near,far};
}
