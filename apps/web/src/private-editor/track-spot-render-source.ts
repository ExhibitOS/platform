// SPDX-License-Identifier: AGPL-3.0-or-later
import type * as Three from 'three';
import {museumTrackSpotProfile} from '../../../../packages/studio-contract/src/track-spot-profile.js';
import type {WallwasherFixtureAssetIdentity} from '../../../../packages/studio-contract/src/wallwasher-fixture-profile.js';
import {geometryResidentBytes} from '../viewer/loading';
import {applyWallwasherModelPose,type ResolvedWallwasher} from './wallwasher-model-pose';
import type {loadCatalogModel} from './catalog-furnishing-loader';

// Modeled JS node/matrix/metadata allowance, not a physical heap measurement.
const NODE_BYTES=4096;
type Template=Awaited<ReturnType<typeof loadCatalogModel>>;
type Plan={key:string;parent:Three.Group;nodes:Three.Mesh<Three.BufferGeometry,Three.Material>[];bytes:number};
const fail=()=>{throw Error('CATALOG_BUDGET');};

/** One scene-owned immutable museum source. Each light keeps independent fixed
 * and head poses and an independent original lens. Only equal-material opaque
 * parts WITHIN one frame are combined; all original nodes/buffers are retained.
 * No artist model, source file, material or named pose contract is modified. */
export function createTrackSpotRenderSource(three:typeof Three,template:Template,asset:WallwasherFixtureAssetIdentity){
 const profile=museumTrackSpotProfile(asset),merged=new Map<string,Three.BufferGeometry>(),instances=new Set<()=>void>();
 let nodes=0,sharedBytes=0,disposed=false;template.model.traverse(()=>nodes++);
 const baseResident=template.resident+nodes*NODE_BYTES;
 const plansFor=(groups:readonly Three.Group[])=>groups.flatMap((parent,frame)=>{
  const buckets=new Map<Three.Material,Three.Mesh<Three.BufferGeometry,Three.Material>[]>();
  for(const child of parent.children){
   if(!(child instanceof three.Mesh)||Array.isArray(child.material))throw Error('WALLWASHER_MODEL_PROFILE_INVALID');
   if(child.userData.name==='Lens_opaque')continue;
   const bucket=buckets.get(child.material)??[];bucket.push(child);buckets.set(child.material,bucket);
  }
  return [...buckets.values()].filter(bucket=>bucket.length>1).map(bucket=>{
   const first=bucket[0]!,names=Object.keys(first.geometry.attributes).sort();let vertices=0,indices=0,bytes=0;
   for(const node of bucket){
    const geometry=node.geometry,position=geometry.getAttribute('position');
    if(!(position instanceof three.BufferAttribute)||!(position.array instanceof Float32Array)||position.normalized)throw Error('WALLWASHER_MODEL_PROFILE_INVALID');
    if(geometry.groups.length||geometry.drawRange.start!==0||geometry.drawRange.count!==Infinity||Object.keys(geometry.attributes).sort().join('/')!==names.join('/'))throw Error('WALLWASHER_MODEL_PROFILE_INVALID');
    for(const name of names){const a=geometry.getAttribute(name),b=first.geometry.getAttribute(name);
     if(!(a instanceof three.BufferAttribute)||!(b instanceof three.BufferAttribute)||a.count!==position.count||a.array.constructor!==b.array.constructor||a.itemSize!==b.itemSize||a.normalized!==b.normalized||a.gpuType!==b.gpuType)throw Error('WALLWASHER_MODEL_PROFILE_INVALID');
     bytes+=a.array.byteLength;
    }
    vertices+=position.count;indices+=geometry.index?.count??position.count;
   }
   bytes+=indices*(vertices>65535?4:2);
   return {key:frame+':'+bucket.map(node=>node.userData.name).join('/'),parent,nodes:bucket,bytes:bytes*2};
  });
 });
 const combine=(plan:Plan)=>{
  const geometry=new three.BufferGeometry(),first=plan.nodes[0]!,vertices=plan.nodes.reduce((n,node)=>n+node.geometry.getAttribute('position').count,0);
  try{
   for(const name of Object.keys(first.geometry.attributes)){
    const source=first.geometry.getAttribute(name) as Three.BufferAttribute;
    const Constructor=source.array.constructor as new(length:number)=>Three.TypedArray;
    const array=new Constructor(vertices*source.itemSize);let offset=0;
    for(const node of plan.nodes){
     const attribute=node.geometry.getAttribute(name) as Three.BufferAttribute;array.set(attribute.array,offset);
     // Pose validation admits only identity local rotation/scale. Keep normals,
     // UVs and every other attribute unchanged; bake only local translation.
     if(name==='position')for(let i=0;i<attribute.count;i++)for(let axis=0;axis<3;axis++){const index=offset+i*3+axis;array[index]=array[index]!+node.position.getComponent(axis);}
     offset+=attribute.array.length;
    }
    const attribute=new three.BufferAttribute(array,source.itemSize,source.normalized);attribute.gpuType=source.gpuType;attribute.setUsage(source.usage);geometry.setAttribute(name,attribute);
   }
   const count=plan.nodes.reduce((n,node)=>n+(node.geometry.index?.count??node.geometry.getAttribute('position').count),0);
   const indices=vertices>65535?new Uint32Array(count):new Uint16Array(count);let offset=0,base=0;
   for(const node of plan.nodes){const position=node.geometry.getAttribute('position'),index=node.geometry.index,n=index?.count??position.count;
    for(let i=0;i<n;i++){const local=index?.getX(i)??i;if(!Number.isSafeInteger(local)||local<0||local>=position.count)throw Error('WALLWASHER_MODEL_PROFILE_INVALID');indices[offset++]=base+local;}
    base+=position.count;
   }
   geometry.setIndex(new three.BufferAttribute(indices,1));
   const bytes=geometryResidentBytes([...Object.values(geometry.attributes),geometry.index!]);if(bytes!==plan.bytes)throw Error('WALLWASHER_MODEL_PROFILE_INVALID');
   return geometry;
  }catch(error){geometry.dispose();throw error;}
 };
 const instantiate=(resolved:ResolvedWallwasher,availableBytes:number)=>{
  if(disposed||availableBytes<(nodes+2)*NODE_BYTES)fail();
  const model=template.model.clone(true),pose=applyWallwasherModelPose(three,model,asset,resolved),plans=plansFor([pose.fixed,pose.head]);
  const instanceBytes=(nodes+2+plans.length+2)*NODE_BYTES; // mounting parent + own lens material
  const growth=plans.reduce((sum,plan)=>sum+(merged.has(plan.key)?0:plan.bytes),0);
  if(instanceBytes+growth>availableBytes)fail();
  const lens=pose.head.children.find(node=>node.userData.name==='Lens_opaque') as Three.Mesh<Three.BufferGeometry,Three.Material>|undefined;
  if(!lens||Array.isArray(lens.material))throw Error('WALLWASHER_MODEL_PROFILE_INVALID');
  const originalLens=lens.material,ownLens=originalLens.clone();lens.material=ownLens;
  const created=new Map<string,Three.BufferGeometry>();
  try{for(const plan of plans)if(!merged.has(plan.key))created.set(plan.key,combine(plan));}
  catch(error){for(const geometry of created.values())geometry.dispose();ownLens.dispose();throw error;}
  for(const [key,geometry]of created)merged.set(key,geometry);sharedBytes+=growth;
  const originals=plans.map(plan=>({parent:plan.parent,nodes:plan.nodes})),batches:Three.Mesh[]=[];
  for(const plan of plans){const mesh=new three.Mesh(merged.get(plan.key)!,plan.nodes[0]!.material);mesh.userData.exhibitosLightFixture=true;plan.parent.remove(...plan.nodes);plan.parent.add(mesh);batches.push(mesh);}
  let released=false;
  const dispose=()=>{if(released)return;released=true;model.removeFromParent();for(const mesh of batches)mesh.removeFromParent();for(const row of originals)row.parent.add(...row.nodes);lens.material=originalLens;ownLens.dispose();instances.delete(dispose);};
  instances.add(dispose);
  return {model,triangles:template.triangles,resident:instanceBytes,dispose};
 };
 return {baseResident,triangles:template.triangles,sharedResident:()=>sharedBytes,instantiate,dispose(){if(disposed)return;disposed=true;for(const release of [...instances])release();for(const geometry of merged.values())geometry.dispose();merged.clear();template.dispose();},profileId:profile.profileId};
}
