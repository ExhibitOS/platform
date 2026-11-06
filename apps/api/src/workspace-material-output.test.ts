// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import type {Session} from './auth.ts';
import type {WorkspaceMaterialIntakes} from './workspace-material-intakes.ts';
import {workspaceMaterialOutputBytes,workspaceMaterialOutputInventory} from './workspace-material-output.ts';

const id='11111111-1111-4111-8111-111111111111',surface='22222222-2222-4222-8222-222222222222';
const material=()=>({id,version:1,kind:'floor',name:'Synthetic',rights:{holder:'Example',ownership:'owner',licenseId:'CC0-1.0',creditLine:'Synthetic',permissions:{display:true,download:false,export:true,commercial:true}},provenance:'Synthetic',maps:{color:{mime:'image/png',bytes:100,sha256:'a'.repeat(64),width:10,height:10,colorSpace:'srgb'}}});
const candidate=()=>({surfaces:[{id:surface,type:'floor'}],extensions:{'org.exhibitos.studio/workspace-materials':{version:1,materials:[material()],bindings:[{surfaceId:surface,materialId:id,materialVersion:1,repeatMeters:[2,2],rotation:0}]}}});
it('selects only validated floor color inventory and refuses unsupported content',()=>{
 expect(workspaceMaterialOutputInventory({extensions:{}})).toEqual([]);
 const value=candidate(),[entry]=workspaceMaterialOutputInventory(value);expect(entry).toMatchObject({materialId:id,materialVersion:1,role:'color',sha256:'a'.repeat(64)});
 const wall=candidate();wall.surfaces[0]!.type='wall';wall.extensions['org.exhibitos.studio/workspace-materials'].materials[0]!.kind='wall';expect(()=>workspaceMaterialOutputInventory(wall)).toThrow('WORKSPACE_MATERIAL_OUTPUT_UNSUPPORTED');
 const extra=candidate();Object.assign(extra.extensions['org.exhibitos.studio/workspace-materials'].materials[0]!.maps,{roughness:{...material().maps.color,colorSpace:'linear'}});expect(()=>workspaceMaterialOutputInventory(extra)).toThrow('WORKSPACE_MATERIAL_OUTPUT_UNSUPPORTED');
});
it('rechecks owner descriptor and chooses the purpose-specific byte authority',async()=>{
 const value=candidate(),entry=workspaceMaterialOutputInventory(value)[0]!,bytes=Buffer.from('synthetic');
 const service={readVersion:vi.fn().mockResolvedValue(material()),preview:vi.fn().mockResolvedValue({bytes}),exportMap:vi.fn().mockResolvedValue({bytes})} as unknown as WorkspaceMaterialIntakes,c={} as PoolClient,s={} as Session;
 await workspaceMaterialOutputBytes(c,s,value,service,entry,'export');expect(service.exportMap).toHaveBeenCalledOnce();expect(service.preview).not.toHaveBeenCalled();
 await workspaceMaterialOutputBytes(c,s,value,service,entry,'display');expect(service.preview).toHaveBeenCalledOnce();
 await expect(workspaceMaterialOutputBytes(c,s,value,service,{...entry,sha256:'b'.repeat(64)},'export')).rejects.toMatchObject({code:'WORKSPACE_MATERIAL_OUTPUT_UNSUPPORTED'});
 (service.readVersion as ReturnType<typeof vi.fn>).mockResolvedValue({...material(),name:'other'});await expect(workspaceMaterialOutputBytes(c,s,value,service,entry,'export')).rejects.toMatchObject({code:'MATERIAL_VERSION_MISMATCH'});
});
