// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import {WORKSPACE_FURNISHING_NAMESPACE,validateWorkspaceFurnishings} from '@exhibitos/studio-contract';
import {projectWorkspaceFurnishings,admittedPublicationWorkspaceFurnishings,workspaceFurnishingPublicationWithinBudget} from './workspace-furnishing-publication.ts';
import {Privacy} from './privacy.ts';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
it('remaps public identity consistently without exposing private provenance',()=>{
 const descriptor={id:id(2),version:1,kind:'pedestal',name:'Synthetic',rights:{permissions:{display:true,export:true}},provenance:'Private workspace note',model:{mime:'model/gltf-binary',bytes:32,sha256:'a'.repeat(64)}},candidate={rooms:[{id:id(1),dimensions:{width:6,height:3,depth:8}}],extensions:{[WORKSPACE_FURNISHING_NAMESPACE]:{version:1,furnishings:[descriptor],placements:[{id:id(3),roomId:id(1),furnishingId:id(2),furnishingVersion:1,position:[0,0,0],yaw:0,scale:1}]}}};
 const ids=new Map([[id(1),id(11)],[id(2),id(12)],[id(3),id(13)]]),projected=projectWorkspaceFurnishings(candidate,key=>ids.get(key)!)!;
 expect(projected.bindings).toEqual([{publicId:id(12),descriptor}]);expect(projected.extension.furnishings[0]).toMatchObject({id:id(12),provenance:'Provided by the exhibition editor.'});expect(projected.extension.placements[0]).toMatchObject({id:id(13),roomId:id(11),furnishingId:id(12)});
 expect(validateWorkspaceFurnishings({rooms:[{...candidate.rooms[0],id:id(11)}],extensions:{[WORKSPACE_FURNISHING_NAMESPACE]:projected.extension}}).valid).toBe(true);
 expect(JSON.stringify(projected.extension)).not.toContain('Private workspace note');expect(JSON.stringify(projected.extension)).not.toContain(id(2));
});

it('requires each private binding to match the public descriptor and live model',async()=>{
 const original={id:id(2),version:1,kind:'pedestal',name:'Synthetic',rights:{permissions:{display:true,export:true}},provenance:'private',model:{mime:'model/gltf-binary',bytes:3,sha256:'a'.repeat(64)}},published={...original,id:id(12),provenance:'Provided by the exhibition editor.'},candidate={rooms:[{id:id(11),dimensions:{width:6,height:3,depth:8}}],extensions:{[WORKSPACE_FURNISHING_NAMESPACE]:{version:1,furnishings:[published],placements:[{id:id(13),roomId:id(11),furnishingId:id(12),furnishingVersion:1,position:[0,0,0],yaw:0,scale:1}]}}};
 const row={public_id:id(12),workspace_id:id(5),tenant_id:id(6),user_id:id(7),source_id:id(2),source_version:1,source_descriptor:original},query=vi.fn().mockResolvedValue({rows:[row]}),client={query} as never,publicationModel=vi.fn().mockResolvedValue({bytes:Buffer.from('abc'),mime:'model/gltf-binary',sha256:'a'.repeat(64)}),publicationFence=vi.fn().mockResolvedValue(undefined),service={publicationModel,publicationFence} as never;
 const checked=await admittedPublicationWorkspaceFurnishings(client,id(6),id(8),candidate,service);expect(checked).toHaveLength(1);expect(checked[0]?.bytes).toBeUndefined();
 expect((await admittedPublicationWorkspaceFurnishings(client,id(6),id(8),candidate,service,id(12)))[0]?.bytes).toEqual(Buffer.from('abc'));
 query.mockResolvedValueOnce({rows:[{...row,source_id:id(9)}]});await expect(admittedPublicationWorkspaceFurnishings(client,id(6),id(8),candidate,service)).rejects.toMatchObject({code:'PUBLICATION_UNAVAILABLE'});
 publicationModel.mockResolvedValueOnce({bytes:Buffer.from('abc'),mime:'model/gltf-binary',sha256:'b'.repeat(64)});await expect(admittedPublicationWorkspaceFurnishings(client,id(6),id(8),candidate,service)).rejects.toMatchObject({code:'PUBLICATION_UNAVAILABLE'});
 query.mockResolvedValueOnce({rows:[]});await expect(admittedPublicationWorkspaceFurnishings(client,id(6),id(8),candidate,service)).rejects.toMatchObject({code:'PUBLICATION_UNAVAILABLE'});
});

it('retains registered furnishing source bytes during privacy erasure',async()=>{
 const key=`${id(6)}/workspace-furnishing-intake/${id(5)}/${id(4)}/${'a'.repeat(64)}`,row={tenant_id:id(6),id:id(2),version:1,descriptor:{id:id(2),version:1,model:{mime:'model/gltf-binary',bytes:3,sha256:'a'.repeat(64)}},object_key:key};
 const query=vi.fn(async(sql:string)=>sql.startsWith('SELECT c.relname')?{rows:[{relname:'workspace_furnishing_versions'}]}:{rows:[{row}]});
 expect(await new Privacy({} as never).referenced({query} as never,key)).toBe(true);
});

it('applies one exact aggregate budget to preparation and public admission',()=>{
 const limit=32*1024*1024;expect(workspaceFurnishingPublicationWithinBudget([limit,limit])).toBe(true);expect(workspaceFurnishingPublicationWithinBudget([limit,limit,1])).toBe(false);expect(workspaceFurnishingPublicationWithinBudget([0])).toBe(false);
});
