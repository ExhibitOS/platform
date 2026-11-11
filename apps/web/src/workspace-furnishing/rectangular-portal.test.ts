// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {expect,it} from 'vitest';
import * as three from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {sha256} from '@exhibitos/storage';
import {qualifiedRectangularPortalTarget,type RectangularPortalFit} from '@exhibitos/spec/workspace-fit-models';
import {validateWorkspaceFurnishingGlb} from '../../../api/src/workspace-furnishing-glb';
import {fitRectangularPortal} from './portal-pose';

const root=new URL('../../../../assets/furnishings/exhibitos-authored-20261109/',import.meta.url);

it('admits an eligible new original by its measured shape and rejects a changed rail',async()=>{
 const source=await readFile(new URL('portal-pale-mineral/model.glb',root));
 const jsonLength=source.readUInt32LE(12),doc=JSON.parse(source.toString('utf8',20,20+jsonLength));
 doc.materials[0].name='Independent eligible original';
 doc.materials[0].pbrMetallicRoughness.baseColorFactor=[.2,.3,.4,1];
 const text=Buffer.from(JSON.stringify(doc)),padding=(4-text.length%4)%4;
 const json=Buffer.concat([text,Buffer.alloc(padding,32)]),tail=source.subarray(20+jsonLength);
 const header=Buffer.from(source.subarray(0,20));header.writeUInt32LE(20+json.length+tail.length,8);header.writeUInt32LE(json.length,12);
 const original=Buffer.concat([header,json,tail]),model={mime:'model/gltf-binary' as const,bytes:original.length,sha256:sha256(original)};
 expect(model.sha256).not.toBe(sha256(source));
 expect(await validateWorkspaceFurnishingGlb(model,original,{},'rectangular-portal-v1')).toMatchObject({profile:'rectangular-portal-v1',openingWidth:2.4,openingHeight:3});
 const broken=Buffer.from(original),position=doc.accessors[doc.meshes[0].primitives[0].attributes.POSITION],view=doc.bufferViews[position.bufferView];
 const offset=28+json.length+(view.byteOffset??0)+(position.byteOffset??0);
 broken.writeFloatLE(broken.readFloatLE(offset)+.01,offset);
 await expect(validateWorkspaceFurnishingGlb({...model,sha256:sha256(broken)},broken,{},'rectangular-portal-v1')).rejects.toMatchObject({code:'FURNISHING_FIT_UNSUPPORTED'});
});

it('qualifies both unchanged originals without hash pins and preserves section, corners and clear passage at two target sizes',async()=>{
 for(const name of ['portal-pale-mineral','portal-warm-oak']){
  const original=await readFile(new URL(name+'/model.glb',root)),digest=sha256(original);
  const measured=await validateWorkspaceFurnishingGlb({mime:'model/gltf-binary',bytes:original.length,sha256:digest},original,{},'rectangular-portal-v1');
  expect(measured).toEqual({profile:'rectangular-portal-v1',openingWidth:2.4,openingHeight:3,minZ:-.082,maxZ:.06});
  const source=measured as RectangularPortalFit;
  for(const target of [{width:2.4,height:3,minZ:-.082,maxZ:.06},{width:1.2,height:2.2,minZ:-.1,maxZ:.1}]){
   const {scene}=await new GLTFLoader().parseAsync(new Uint8Array(original).buffer,'');
   const mesh=scene.children[0] as three.Mesh,material=mesh.material;
   fitRectangularPortal(three,scene,source,target);scene.updateMatrixWorld(true);
   const bounds=new three.Box3().setFromObject(scene,true);
   expect(bounds.min.x).toBeCloseTo(-target.width/2-.045,5);
   expect(bounds.min.y).toBeCloseTo(0,5);
   expect(bounds.min.z).toBeCloseTo(target.minZ,5);
   expect(bounds.max.x).toBeCloseTo(target.width/2+.045,5);
   expect(bounds.max.y).toBeCloseTo(target.height+.045,5);
   expect(bounds.max.z).toBeCloseTo(target.maxZ,5);
   const positions=mesh.geometry.getAttribute('position');
   const xs=new Set(),ys=new Set();
   for(let i=0;i<positions.count;i++){xs.add(positions.getX(i).toFixed(5));ys.add(positions.getY(i).toFixed(5));}
   expect([...xs].sort()).toEqual([-target.width/2-.045,-target.width/2,target.width/2,target.width/2+.045].map(n=>n.toFixed(5)).sort());
   expect([...ys].sort()).toEqual([0,target.height,target.height+.045].map(n=>n.toFixed(5)).sort());
   expect(mesh.material).toBe(material);expect(mesh.scale.toArray()).toEqual([1,1,1]);
   const ray=new three.Raycaster(new three.Vector3(0,target.height/2,1),new three.Vector3(0,0,-1));
   expect(ray.intersectObject(scene,true)).toHaveLength(0);
   for(const [x,y] of [[-target.width/2-.0225,target.height/2],[target.width/2+.0225,target.height/2],[0,target.height+.0225]]){
    ray.ray.origin.set(x!,y!,1);expect(ray.intersectObject(scene,true).length).toBeGreaterThan(0);
   }
   mesh.geometry.dispose();(material as three.Material).dispose();
  }
  expect(sha256(original)).toBe(digest);
 }
},15_000);

it('refuses solid-wall, neighbouring-hole and unmeasured source targets',()=>{
 const source:RectangularPortalFit={profile:'rectangular-portal-v1',openingWidth:2.4,openingHeight:3,minZ:-.082,maxZ:.06};
 const doc={openings:[{id:'door',type:'door',surfaceId:'wall',dimensions:{width:1.2,height:2.2},offset:[0,-.9]}],surfaces:[{id:'wall',dimensions:{width:4,height:4}}],extensions:{'org.exhibitos.studio/architectural-finishes':{walls:[{surfaceId:'wall',preset:'plain',depth:.12}]}}};
 expect(qualifiedRectangularPortalTarget(source,doc,'door')).toEqual({width:1.2,height:2.2,minZ:-.06,maxZ:.06});
 expect(qualifiedRectangularPortalTarget(source,doc,'solid-wall')).toBeUndefined();
 doc.openings.push({id:'window',type:'window',surfaceId:'wall',dimensions:{width:1,height:1},offset:[1.12,-.9]});
 expect(qualifiedRectangularPortalTarget(source,doc,'door')).toBeUndefined();
 expect(qualifiedRectangularPortalTarget({...source,openingWidth:NaN},doc,'door')).toBeUndefined();
});
