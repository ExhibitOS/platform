// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import type {Session} from './auth.ts';
import type {WorkspaceFurnishingIntakes} from './workspace-furnishing-intakes.ts';
import {workspaceFurnishingOutputBytes,workspaceFurnishingOutputInventory} from './workspace-furnishing-output.ts';
const id='11111111-1111-4111-8111-111111111111',room='22222222-2222-4222-8222-222222222222',placement='33333333-3333-4333-8333-333333333333';
const furnishing=()=>({id,version:1,kind:'pedestal',name:'Synthetic',rights:{holder:'Example',ownership:'owner',licenseId:'CC0-1.0',creditLine:'Synthetic',permissions:{display:true,download:false,export:true,commercial:true}},provenance:'Synthetic',model:{mime:'model/gltf-binary',bytes:100,sha256:'a'.repeat(64)}});
const candidate=()=>({rooms:[{id:room,dimensions:{width:6,height:3,depth:8}}],extensions:{'org.exhibitos.studio/workspace-furnishings':{version:1,furnishings:[furnishing()],placements:[{id:placement,roomId:room,furnishingId:id,furnishingVersion:1,position:[1,0,0],yaw:0,scale:1}]}}});
it('derives one resource for multiple placements and rejects absent references',()=>{
 const value=candidate(),extension=value.extensions['org.exhibitos.studio/workspace-furnishings'];extension.placements.push({...extension.placements[0]!,id:'44444444-4444-4444-8444-444444444444',position:[-1,0,0]});const entries=workspaceFurnishingOutputInventory(value);expect(entries).toHaveLength(1);expect(entries[0]).toMatchObject({furnishingId:id,furnishingVersion:1,sha256:'a'.repeat(64)});extension.placements[0]!.roomId='55555555-5555-4555-8555-555555555555';expect(()=>workspaceFurnishingOutputInventory(value)).toThrow('DRAFT_INVALID');
});
it('rechecks registered ownership and passes the requested rights purpose',async()=>{
 const value=candidate(),entry=workspaceFurnishingOutputInventory(value)[0]!,service={readVersion:vi.fn().mockResolvedValue(furnishing()),model:vi.fn().mockResolvedValue({bytes:Buffer.from('synthetic')})} as unknown as WorkspaceFurnishingIntakes,c={} as PoolClient,s={} as Session;
 await workspaceFurnishingOutputBytes(c,s,value,service,entry,'export');expect(service.model).toHaveBeenCalledWith(c,s,id,1,'export');await workspaceFurnishingOutputBytes(c,s,value,service,entry,'display');expect(service.model).toHaveBeenCalledWith(c,s,id,1,'display');
 await expect(workspaceFurnishingOutputBytes(c,s,value,service,{...entry,sha256:'b'.repeat(64)},'export')).rejects.toMatchObject({code:'WORKSPACE_FURNISHING_OUTPUT_UNSUPPORTED'});vi.mocked(service.readVersion).mockResolvedValue({...furnishing(),name:'other'} as never);await expect(workspaceFurnishingOutputBytes(c,s,value,service,entry,'export')).rejects.toMatchObject({code:'FURNISHING_VERSION_MISMATCH'});
});
