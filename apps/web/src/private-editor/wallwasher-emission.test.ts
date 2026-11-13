// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {expect,it,vi} from 'vitest';
import * as three from 'three';
import {MUSEUM_WALLWASHER_REAR_RELIEF_IDENTITY as asset} from '../../../../packages/studio-contract/src/wallwasher-rear-relief-profile.js';
import {installWallwasherEmission} from './wallwasher-emission';
import {loadCatalogModel} from './catalog-furnishing-loader';
import {geometryResidentBytes} from '../viewer/loading';
import {paintingWasherCandidate,lightId} from '../../../../packages/studio-contract/test-fixtures/wallwasher.js';
import {catalogOtherSources,installCatalogOtherVisuals} from './catalog-bench-renderer';

// Synthetic topology exercises rejection and ownership. The opt-in test below
// admits and loads the real content-hashed CC0 prepared GLB independently.
function fixture(){
 const model=new three.Group(),geometry=new three.BufferGeometry(),position=new Float32Array(349*3),indices=new Uint16Array(564);
 for(const [i,x,y]of [[94,-.0693,-.0113],[134,-.0693,.0113],[310,.0693,.0113],[263,.0693,-.0113]])position.set([x!,y!,-.001],i!*3);
 indices.set([94,134,310,94,310,263],552);geometry.setAttribute('position',new three.BufferAttribute(position,3));geometry.setIndex(new three.BufferAttribute(indices,1));
 const material=new three.MeshStandardMaterial({color:'#131313'}),panel:three.Mesh=new three.Mesh(geometry,material),baffle=new three.Mesh(new three.BoxGeometry(),material);
 panel.userData.name='Optical_panel';model.add(panel,baffle);return {model,geometry,panel,baffle,material};
}
function render(mesh:three.Mesh){mesh.onBeforeRender({} as three.WebGLRenderer,{} as three.Scene,{} as three.Camera,mesh.geometry,Array.isArray(mesh.material)?mesh.material[1]!:mesh.material,null as unknown as three.Group);}
function bytes(geometry:three.BufferGeometry){return {attributes:Object.fromEntries(Object.entries(geometry.attributes).map(([k,v])=>[k,Array.from(v.array)])),index:Array.from(geometry.index!.array)};}
it('isolates exactly six front indices without changing shared dark material, buffers, lights or another instance',()=>{
 const a=fixture(),b=fixture(),light=new three.SpotLight(0xffffff,7),other=new three.SpotLight(0xff0000,1),callback=vi.fn();a.panel.onBeforeRender=callback;
 const before=bytes(a.geometry),finish=a.material.toJSON(),owner=installWallwasherEmission(three,a.model,asset,light),second=installWallwasherEmission(three,b.model,asset,other);
 expect(a.geometry.groups).toEqual([{start:0,count:552,materialIndex:0},{start:552,count:6,materialIndex:1},{start:558,count:6,materialIndex:0}]);
 expect(owner).toMatchObject({extraDrawCalls:2,extraGeometryBytes:0,extraTextureBytes:0});expect(bytes(a.geometry)).toEqual(before);expect(a.material.toJSON()).toEqual(finish);expect(a.baffle.material).toBe(a.material);
 const emitter=(a.panel.material as three.MeshStandardMaterial[])[1]!,otherEmitter=(b.panel.material as three.MeshStandardMaterial[])[1]!;
 expect(emitter.emissiveIntensity).toBe(.875);expect(otherEmitter.emissiveIntensity).toBe(.5);expect(otherEmitter.emissive.toArray()).toEqual(other.color.toArray());
 light.color.setRGB(.2,.4,.8);light.intensity=3;render(a.panel);expect(callback).toHaveBeenCalledTimes(1);expect(emitter.emissive.toArray()).toEqual([.2,.4,.8]);expect(emitter.emissiveIntensity).toBe(.75);expect(otherEmitter.emissiveIntensity).toBe(.5);
 const sourceState=light.toJSON();light.visible=false;render(a.panel);expect(emitter.emissive.toArray()).toEqual(a.material.emissive.toArray());expect(emitter.emissiveIntensity).toBe(a.material.emissiveIntensity);
 light.visible=true;light.intensity=0;render(a.panel);expect(emitter.emissive.toArray()).toEqual([0,0,0]);light.intensity=3;expect(light.toJSON()).toEqual(sourceState);
 const disposed=vi.spyOn(emitter,'dispose');owner.dispose();owner.dispose();expect(disposed).toHaveBeenCalledTimes(1);expect(a.panel.material).toBe(a.material);expect(a.panel.onBeforeRender).toBe(callback);expect(a.geometry.groups).toEqual([]);expect(bytes(a.geometry)).toEqual(before);expect(b.geometry.groups).toHaveLength(3);second.dispose();
});
it.each(['identity','indices','positions','sharedGeometry','groups','doubleInstall'])('rejects %s before mutating the panel or source material',kind=>{
 const f=fixture(),light=new three.SpotLight();let identity:Parameters<typeof installWallwasherEmission>[2]=asset,installed:ReturnType<typeof installWallwasherEmission>|undefined;
 if(kind==='identity')identity={...asset,sha256:'0'.repeat(64)};if(kind==='indices')f.geometry.index!.setX(552,0);if(kind==='positions')f.geometry.getAttribute('position').setZ(94,.001);
 if(kind==='sharedGeometry')f.model.add(new three.Mesh(f.geometry,f.material));if(kind==='groups')f.geometry.addGroup(0,564,0);if(kind==='doubleInstall')installed=installWallwasherEmission(three,f.model,asset,light);
 const groups=structuredClone(f.geometry.groups),material=f.panel.material,callback=f.panel.onBeforeRender,before=bytes(f.geometry);
 expect(()=>installWallwasherEmission(three,f.model,identity,light)).toThrow();expect(f.geometry.groups).toEqual(groups);expect(f.panel.material).toBe(material);expect(f.panel.onBeforeRender).toBe(callback);expect(bytes(f.geometry)).toEqual(before);installed?.dispose();
});
it.runIf(Boolean(process.env.EXHIBITOS_WALLWASHER_GLB))('loads two actual immutable prepared GLBs with independent buffers and restores all resources',async()=>{
 const input=await readFile(process.env.EXHIBITOS_WALLWASHER_GLB!),source={url:'/fixture.glb',fetcher:async()=>new Response(input),check:async()=>{}},signal=new AbortController().signal;
 const load=()=>loadCatalogModel(three,{...asset,triangles:20000},source,signal,()=>false,20000,4*1024*1024);
 const a=await load(),b=await load(),light=new three.SpotLight(0xffffff,7),panels:three.Mesh[]=[];
 for(const visual of [a,b])visual.model.traverse(node=>{if(node instanceof three.Mesh&&node.userData.name==='Optical_panel')panels.push(node);});
 expect(panels).toHaveLength(2);expect(panels[0]!.geometry).not.toBe(panels[1]!.geometry);expect(panels[0]!.material).not.toBe(panels[1]!.material);
 const panel=panels[0]!,before=bytes(panel.geometry),resident=geometryResidentBytes(Object.values(panel.geometry.attributes)),material=panel.material,original=vi.spyOn(material as three.Material,'dispose'),geometry=vi.spyOn(panel.geometry,'dispose'),owner=installWallwasherEmission(three,a.model,asset,light),emitter=(panel.material as three.MeshStandardMaterial[])[1]!,disposed=vi.spyOn(emitter,'dispose');
 expect(bytes(panel.geometry)).toEqual(before);expect(geometryResidentBytes(Object.values(panel.geometry.attributes))).toBe(resident);expect(a.triangles).toBe(b.triangles);expect(a.resident).toBe(b.resident);expect(panels[1]!.geometry.groups).toEqual([]);
 owner.dispose();a.dispose();a.dispose();b.dispose();expect(disposed).toHaveBeenCalledTimes(1);expect(original).toHaveBeenCalledTimes(1);expect(geometry).toHaveBeenCalledTimes(1);expect(panel.material).toBe(material);expect(bytes(panel.geometry)).toEqual(before);
});
it.runIf(Boolean(process.env.EXHIBITOS_WALLWASHER_GLB))('mounts the actual catalogue emitter against its bound light and restores fallback on disposal or missing host',async()=>{
 const input=await readFile(process.env.EXHIBITOS_WALLWASHER_GLB!),{candidate}=paintingWasherCandidate(),value=candidate.extensions!['org.exhibitos.studio/furnishing-visuals'] as {assets:Array<{id:string}>},id=value.assets[0]!.id,publicationId=crypto.randomUUID(),revisionSha256='a'.repeat(64),url=`/api/v1/publications/${publicationId}/assets/${id}`;
 const source={publicationId,revisionSha256,assets:[{assetId:id,mime:'model/gltf-binary',url}],check:async()=>{},fetcher:async()=>new Response(input,{headers:{'x-exhibitos-publication-revision':revisionSha256}})},items=catalogOtherSources(candidate,source);
 expect(items).toHaveLength(1);
 for(const present of [true,false]){
  const room=new three.Group(),fallback=new three.Group(),light=new three.SpotLight(0x00ff00,7);room.add(fallback,light);
  const owner=installCatalogOtherVisuals(three,items,new Map([[candidate.rooms[0]!.id.toLowerCase(),room]]),new Map([[lightId,[fallback]]]),new Map(),new AbortController().signal,()=>false,20000,()=>{},undefined,new Map(present?[[lightId,{light}]]:[]));
  expect(await owner.start()).toEqual([{kind:'light',id:lightId,status:present?'ready':'fallback'}]);expect(fallback.visible).toBe(!present);
  if(present){let panel:three.Mesh|undefined;room.traverse(node=>{if(node instanceof three.Mesh&&node.userData.name==='Optical_panel')panel=node;});expect(panel).toBeDefined();const emitter=(panel!.material as three.MeshStandardMaterial[])[1]!;expect(emitter.emissive.toArray()).toEqual(light.color.toArray());light.intensity=0;render(panel!);expect(emitter.emissive.toArray()).toEqual([0,0,0]);}
  owner.dispose();owner.dispose();expect(fallback.visible).toBe(true);expect(room.children).toEqual([fallback,light]);
 }
});
