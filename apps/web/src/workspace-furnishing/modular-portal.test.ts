// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {expect,it} from 'vitest';
import * as three from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {sha256} from '@exhibitos/storage';
import {qualifiedModularPortalTarget} from '@exhibitos/spec/workspace-fit-models';
import {applyArchitecturalFinishCommand,validateWorkspaceFurnishings,WORKSPACE_FURNISHING_NAMESPACE} from '@exhibitos/studio-contract';
import {packageWorkspaceFurnishingManifest} from '@exhibitos/spec/workspace-furnishing';
import {validateWorkspaceFurnishingGlb} from '../../../api/src/workspace-furnishing-glb';
import {fitModularPortal} from './portal-pose';

const catalogue=new URL('../../../../assets/furnishings/user-authored-20261027/',import.meta.url);
const demo=new URL('../../../../demos/reference-exhibition/source/',import.meta.url);
const model=(bytes:Buffer)=>({sha256:sha256(bytes),bytes:bytes.length,mime:'model/gltf-binary' as const});
const admit=(bytes:Buffer)=>validateWorkspaceFurnishingGlb(model(bytes),bytes,{},'modular-portal-v1');

it('measures both modular originals and fits one unchanged source to the single and corrected paired openings',async()=>{
 const [original,small,indexBytes]=await Promise.all([
  readFile(new URL('double-width-portal/model.glb',catalogue)),
  readFile(new URL('gallery-open-portal/model.glb',catalogue)),
  readFile(new URL('qualified-wheat-v4-index.json',demo)),
 ]);
 const [geometry,smallGeometry]=await Promise.all([admit(original),admit(small)]);
 if(geometry.profile!=='modular-portal-v1'||smallGeometry.profile!=='modular-portal-v1')throw Error('Wrong fit receipt');
 expect(geometry).toMatchObject({openingWidth:2.4,openingHeight:2.6,minZ:-.1,maxZ:.1});
 expect(smallGeometry).toMatchObject({openingWidth:1.1,openingHeight:2.2,minZ:-.075,maxZ:.075});
 expect(Object.keys(geometry.parts)).toHaveLength(9);
 const openingId='39979200-3233-4ecf-a8e4-b7c99850df1c';
 const index=JSON.parse(indexBytes.toString('utf8'));
 const {exhibition}=JSON.parse(await readFile(new URL(index.publication.path,demo),'utf8'));
 const opening=exhibition.openings.find((value:{id:string})=>value.id===openingId);
 expect(qualifiedModularPortalTarget(geometry,exhibition,openingId)).toBeUndefined();
 const corrected=applyArchitecturalFinishCommand(exhibition,{type:'set-wall-finish',wall:{surfaceId:opening.surfaceId,depth:.12,preset:'plain',trimWidth:.02,baseboardHeight:.04,ceilingBand:false}});
 const paired=qualifiedModularPortalTarget(geometry,corrected,openingId);
 expect(paired).toEqual({width:2.4,height:3,minZ:-.08,maxZ:.06});
 const id='70000000-0000-4000-8000-000000000001',source=model(original);
 const descriptor={id,version:1,kind:'portal-finish',name:'Modular portal',provenance:'Existing author original',rights:{holder:'ExhibitOS',ownership:'owner',licenseId:'CC0-1.0',creditLine:'ExhibitOS',permissions:{display:true,download:true,export:true,commercial:true}},model:source,fit:{version:1,sourceSha256:source.sha256,sourceBytes:source.bytes,geometry}};
 const portable={...corrected,extensions:{...corrected.extensions,[WORKSPACE_FURNISHING_NAMESPACE]:{version:7,furnishings:[descriptor],placements:[],frameAttachments:[],openingAttachments:[{openingId,furnishingId:id,furnishingVersion:1,modelSha256:source.sha256}]}}};
 expect(validateWorkspaceFurnishings(portable)).toEqual({valid:true,errors:[]});
 expect(packageWorkspaceFurnishingManifest(portable)).toMatchObject([{furnishingId:id,sha256:source.sha256,bytes:source.bytes}]);
 const changed=Buffer.from(original),oldTranslation=Buffer.from('-1.2200000286102295'),newTranslation=Buffer.from('-1.3200000286102295');
 const translationOffset=changed.indexOf(oldTranslation);
 expect(translationOffset).toBeGreaterThan(20);
 newTranslation.copy(changed,translationOffset);
 await expect(admit(changed)).rejects.toMatchObject({code:'FURNISHING_FIT_UNSUPPORTED'});
 const missingNormal=Buffer.from(original),jsonEnd=20+missingNormal.readUInt32LE(12);
 const originalJson=missingNormal.toString('utf8',20,jsonEnd);
 const changedJson=originalJson.replace(/"NORMAL":\s*\d+,/,match=>' '.repeat(match.length));
 expect(changedJson).not.toBe(originalJson);
 missingNormal.write(changedJson,20,jsonEnd-20,'utf8');
 await expect(admit(missingNormal)).rejects.toMatchObject({code:'FURNISHING_FIT_UNSUPPORTED'});


 const single={rooms:[],openings:[{id:'door',surfaceId:'wall',type:'door',dimensions:{width:2.4,height:2.6},offset:[-3,-.7]}],surfaces:[{id:'wall',dimensions:{width:12,height:4}}]};
 const legacy=qualifiedModularPortalTarget(geometry,single,'door');
 expect(legacy).toEqual({width:2.4,height:2.6,minZ:-.1,maxZ:.1});
 const unsafe=structuredClone(single);
 unsafe.openings.push({id:'neighbor',surfaceId:'wall',type:'window',dimensions:{width:1,height:1},offset:[-1.28,-.7]});
 expect(qualifiedModularPortalTarget(geometry,unsafe,'door')).toBeUndefined();
 for(const [target,expected]of [
  [legacy!,[2.48,2.64,.212]],
  [paired!,[2.48,3.04,.152]],
 ] as const){
  const {scene}=await new GLTFLoader().parseAsync(new Uint8Array(original).buffer,'');
  const materials=scene.children.map(child=>(child as three.Mesh).material);
  fitModularPortal(three,scene,geometry,target,target===paired);
  const box=new three.Box3().setFromObject(scene,true),size=box.getSize(new three.Vector3()).toArray();
  expected.forEach((value,axis)=>expect(size[axis]).toBeCloseTo(value,5));
  expect(box.min.y).toBeCloseTo(0,5);
  expect(box.min.z).toBeCloseTo(target.minZ-.006,5);
  expect(box.max.z).toBeCloseTo(target.maxZ+.006,5);
  const placed=scene.children.map(child=>(child as three.Mesh).material as three.Material);
  const biased=placed.filter((material,index)=>material!==materials[index]);
  expect(biased).toHaveLength(target===paired?3:0);
  for(const material of biased)expect(material).toMatchObject({polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-6});
  for(const material of materials)expect(material).toMatchObject({polygonOffset:false});
  scene.traverse(child=>{if(child instanceof three.Mesh)child.geometry.dispose();});
  for(const material of new Set([...materials,...placed]))(material as three.Material).dispose();
 }
 expect(sha256(original)).toBe('385a3a6d5266a5dda5b3fc6e51fd14e0b990e29de66ee27a80b634a93ef2591b');
},15_000);
