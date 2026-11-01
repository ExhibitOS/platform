// SPDX-License-Identifier: AGPL-3.0-or-later
import type {Object3D} from 'three';

/** The existing standing-eye check runs before this artwork-specific check.
 * Both ordered viewing and map artwork visits must use the same qualification. */
export function assertArtworkViewpoint(three:typeof import('three'),group:Object3D,kind:string,destination:{position:readonly [number,number,number];target:readonly [number,number,number]}){
 group.updateMatrixWorld(true);
 const box=new three.Box3().setFromObject(group,true);
 if(box.isEmpty()||box.distanceToPoint(new three.Vector3(...destination.target))>.05)throw Error('VIEWING_TARGET_OUTSIDE_ARTWORK');
 if(kind!=='image')return;
 let plane:InstanceType<typeof three.Mesh>|undefined;
 group.traverse(node=>{if(!plane&&node instanceof three.Mesh&&(Array.isArray(node.material)?node.material:[node.material]).some(m=>(m as InstanceType<typeof three.MeshBasicMaterial>).map))plane=node;});
 if(!plane)throw Error('VIEWING_IMAGE_FRONT');
 const determinant=plane.matrixWorld.determinant();if(!Number.isFinite(determinant)||determinant===0)throw Error('VIEWING_IMAGE_FRONT');
 const normal=new three.Vector3(0,0,1).applyNormalMatrix(new three.Matrix3().getNormalMatrix(plane.matrixWorld));
 if(!normal.toArray().every(Number.isFinite)||normal.lengthSq()===0)throw Error('VIEWING_IMAGE_FRONT');
 const eye=new three.Vector3(...destination.position),centre=box.getCenter(new three.Vector3());
 if(normal.dot(eye.sub(centre).normalize())<Math.cos(Math.PI/6))throw Error('VIEWING_IMAGE_FRONT');
}

/** Preserve legacy room choices when no stop was authored for this artwork. */
export function authoredArtworkViewpoint(stops:readonly {placementId:string;viewpointId:string}[],placementId:string):string|undefined{
 return stops.find(stop=>stop.placementId.toLowerCase()===placementId.toLowerCase())?.viewpointId;
}
