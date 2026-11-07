// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {projectWorkspaceMaterials} from './workspace-material-publication.ts';
const materialId='11111111-1111-4111-8111-111111111111',surfaceId='22222222-2222-4222-8222-222222222222',publicMaterial='33333333-3333-4333-8333-333333333333',publicSurface='44444444-4444-4444-8444-444444444444';
it('remaps workspace material and surface identity while preserving map and visual binding',()=>{
 const material={id:materialId,version:1,kind:'wall',name:'Stone',rights:{holder:'Example',ownership:'owner',licenseId:'CC0-1.0',creditLine:'Example',permissions:{display:true,download:false,export:true,commercial:true}},provenance:'Private source reference',maps:{color:{mime:'image/png',bytes:100,sha256:'a'.repeat(64),width:2,height:2,colorSpace:'srgb'}}};
 const candidate={surfaces:[{id:surfaceId,type:'wall'}],extensions:{'org.exhibitos.studio/workspace-materials':{version:1,materials:[material],bindings:[{surfaceId,materialId,materialVersion:1,repeatMeters:[2,2],rotation:.25}]}}};
 const projected=projectWorkspaceMaterials(candidate,id=>id===materialId?publicMaterial:publicSurface)!;
 expect(projected.extension.materials[0]).toMatchObject({id:publicMaterial,provenance:'Provided by the exhibition editor.',maps:material.maps});
 expect(projected.extension.bindings[0]).toMatchObject({surfaceId:publicSurface,materialId:publicMaterial,repeatMeters:[2,2],rotation:.25});
 expect(JSON.stringify(projected.extension)).not.toContain(materialId);expect(JSON.stringify(projected.extension)).not.toContain(surfaceId);expect(JSON.stringify(projected.extension)).not.toContain(material.provenance);expect(projected.bindings[0]?.descriptor).toEqual(material);
});

it('requires exact private binding and rechecks the current owner before serving a public map',async()=>{
 const {admittedPublicationWorkspaceMaterials}=await import('./workspace-material-publication.ts');
 const {vi}=await import('vitest');const descriptor={id:materialId,version:1,kind:'wall',name:'Stone',rights:{holder:'Example',ownership:'owner',licenseId:'CC0-1.0',creditLine:'Example',permissions:{display:true,download:false,export:true,commercial:true}},provenance:'private',maps:{color:{mime:'image/png',bytes:3,sha256:'a'.repeat(64),width:2,height:2,colorSpace:'srgb'}}};
 const candidate={surfaces:[{id:publicSurface,type:'wall'}],extensions:{'org.exhibitos.studio/workspace-materials':{version:1,materials:[{...descriptor,id:publicMaterial,provenance:'Provided by the exhibition editor.'}],bindings:[{surfaceId:publicSurface,materialId:publicMaterial,materialVersion:1,repeatMeters:[2,2],rotation:0}]}}};
 const row={public_id:publicMaterial,workspace_id:'w',tenant_id:'t',user_id:'u',source_id:materialId,source_version:1,source_descriptor:descriptor},c={query:vi.fn(async()=>({rows:[row]}))},service={publicationMap:vi.fn(async()=>({bytes:Buffer.from('abc'),mime:'image/png',sha256:'a'.repeat(64)})),publicationFence:vi.fn(async()=>{})};
 const result=await admittedPublicationWorkspaceMaterials(c as never,'t','p',candidate,service as never,publicMaterial);expect(result[0]?.bytes).toEqual(Buffer.from('abc'));expect(service.publicationFence).toHaveBeenCalledOnce();
 row.source_id='other';await expect(admittedPublicationWorkspaceMaterials(c as never,'t','p',candidate,service as never,publicMaterial)).rejects.toMatchObject({code:'PUBLICATION_UNAVAILABLE'});expect(service.publicationMap).toHaveBeenCalledOnce();
});
it('does not expose the batch endpoint without the 040 capability',async()=>{
 const {Publications}=await import('./publication.ts'),{vi}=await import('vitest'),pool={connect:vi.fn()};
 const publications=new Publications(pool as never,undefined,undefined,undefined,undefined,{supportsMultimap:()=>false} as never);
 await expect(publications.materialMapBatch('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).rejects.toMatchObject({code:'PUBLICATION_UNAVAILABLE'});expect(pool.connect).not.toHaveBeenCalled();
});
it('admits every exact map under the same owner and retains only the requested public resource',async()=>{
 const {admittedPublicationWorkspaceMaterials}=await import('./workspace-material-publication.ts'),{vi}=await import('vitest');
 const rights={holder:'Example',ownership:'owner',licenseId:'CC0-1.0',creditLine:'',permissions:{display:true,download:false,export:true,commercial:true}};
 const color={mime:'image/png',bytes:3,sha256:'a'.repeat(64),width:2,height:2,colorSpace:'srgb'},normal={...color,sha256:'b'.repeat(64),colorSpace:'linear',normalY:'up'},roughness={...color,sha256:'c'.repeat(64),colorSpace:'linear'},descriptor={id:materialId,version:1,kind:'wall',name:'Stone',rights,provenance:'private',maps:{color,normal,roughness}};
 const candidate={surfaces:[{id:publicSurface,type:'wall'}],extensions:{'org.exhibitos.studio/workspace-materials':{version:1,materials:[{...descriptor,id:publicMaterial,provenance:'Provided by the exhibition editor.'}],bindings:[{surfaceId:publicSurface,materialId:publicMaterial,materialVersion:1,repeatMeters:[2,2],rotation:0}]}}};
 const row={public_id:publicMaterial,workspace_id:'w',tenant_id:'t',user_id:'u',source_id:materialId,source_version:1,source_descriptor:descriptor},c={query:vi.fn(async()=>({rows:[row]}))};
 const publicationMap=vi.fn(async(_c:unknown,_b:unknown,role:'color'|'normal'|'roughness')=>({bytes:Buffer.from('abc'),mime:'image/png',sha256:descriptor.maps[role].sha256})),service={publicationMap,publicationFence:vi.fn(async()=>{}),supportsMultimap:()=>true};
 const result=await admittedPublicationWorkspaceMaterials(c as never,'t','p',candidate,service as never,undefined,normal.sha256);expect(publicationMap).toHaveBeenCalledTimes(3);expect(result[0]?.auxiliary).toEqual([{sha256:normal.sha256,mime:'image/png',bytes:Buffer.from('abc')},{sha256:roughness.sha256,mime:'image/png'}]);expect(result[0]?.bytes).toBeUndefined();
 publicationMap.mockClear();const batch=await admittedPublicationWorkspaceMaterials(c as never,'t','p',candidate,service as never,undefined,undefined,true);expect(publicationMap).toHaveBeenCalledTimes(3);expect(batch[0]?.bytes).toEqual(Buffer.from('abc'));expect(batch[0]?.auxiliary.every(map=>map.bytes?.equals(Buffer.from('abc')))).toBe(true);
 const binding=vi.fn(async(_c:unknown,_b:unknown,role:'color'|'normal'|'roughness')=>({map:descriptor.maps[role],key:role}));await admittedPublicationWorkspaceMaterials(c as never,'t','p',candidate,{...service,publicationMapBinding:binding} as never,undefined,undefined,false,undefined,true);expect(binding).toHaveBeenCalledTimes(3);expect(publicationMap).toHaveBeenCalledTimes(3);
 publicationMap.mockImplementationOnce(async()=>({bytes:Buffer.from('bad'),mime:'image/png',sha256:'0'.repeat(64)}));await expect(admittedPublicationWorkspaceMaterials(c as never,'t','p',candidate,service as never)).rejects.toMatchObject({code:'PUBLICATION_UNAVAILABLE'});
});
