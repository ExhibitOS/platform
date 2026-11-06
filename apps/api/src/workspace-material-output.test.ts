// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import type {Session} from './auth.ts';
import type {WorkspaceMaterialIntakes} from './workspace-material-intakes.ts';
import {workspaceMaterialOutputBytes,workspaceMaterialOutputInventory} from './workspace-material-output.ts';

const id='11111111-1111-4111-8111-111111111111',surface='22222222-2222-4222-8222-222222222222';
const material=()=>({id,version:1,kind:'floor',name:'Synthetic',rights:{holder:'Example',ownership:'owner',licenseId:'CC0-1.0',creditLine:'Synthetic',permissions:{display:true,download:false,export:true,commercial:true}},provenance:'Synthetic',maps:{color:{mime:'image/png',bytes:100,sha256:'a'.repeat(64),width:10,height:10,colorSpace:'srgb'}}});
const candidate=()=>({surfaces:[{id:surface,type:'floor'}],extensions:{'org.exhibitos.studio/workspace-materials':{version:1,materials:[material()],bindings:[{surfaceId:surface,materialId:id,materialVersion:1,repeatMeters:[2,2],rotation:0}]}}});
it('selects validated floor and wall color inventory and refuses unsupported content',()=>{
 expect(workspaceMaterialOutputInventory({extensions:{}})).toEqual([]);
 const value=candidate(),[entry]=workspaceMaterialOutputInventory(value);expect(entry).toMatchObject({materialId:id,materialVersion:1,role:'color',sha256:'a'.repeat(64)});
 const wall=candidate();wall.surfaces[0]!.type='wall';wall.extensions['org.exhibitos.studio/workspace-materials'].materials[0]!.kind='wall';expect(workspaceMaterialOutputInventory(wall)).toEqual([entry]);
 const mismatch=candidate();mismatch.surfaces[0]!.type='wall';expect(()=>workspaceMaterialOutputInventory(mismatch)).toThrow('DRAFT_INVALID');
 const mixed=candidate(),wallId='33333333-3333-4333-8333-333333333333',wallSurface='44444444-4444-4444-8444-444444444444';mixed.surfaces.push({id:wallSurface,type:'wall'});mixed.extensions['org.exhibitos.studio/workspace-materials'].materials.push({...material(),id:wallId,kind:'wall'});mixed.extensions['org.exhibitos.studio/workspace-materials'].bindings.push({surfaceId:wallSurface,materialId:wallId,materialVersion:1,repeatMeters:[2,2],rotation:0});expect(workspaceMaterialOutputInventory(mixed).map(v=>v.materialId).sort()).toEqual([id,wallId]);
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
it('normalizes an expired display grant to the export receipt denial',async()=>{
 const value=candidate(),entry=workspaceMaterialOutputInventory(value)[0]!,denied=material();denied.rights.permissions.display=false;value.extensions['org.exhibitos.studio/workspace-materials'].materials=[denied];
 const service={readVersion:vi.fn().mockResolvedValue(denied)} as unknown as WorkspaceMaterialIntakes;
 await expect(workspaceMaterialOutputBytes({} as PoolClient,{} as Session,value,service,entry,'export')).rejects.toMatchObject({code:'RIGHTS_DENIED'});
 await expect(workspaceMaterialOutputBytes({} as PoolClient,{} as Session,value,service,entry,'display')).rejects.toMatchObject({code:'DISPLAY_PERMISSION_REQUIRED'});
});

it('permits wall imports only when the owned V7 catalog is active',async()=>{
 const {assertWorkspaceImportKind}=await import('./workspace-material-output.ts');
 const candidate=(...kinds:string[])=>({extensions:{'org.exhibitos.studio/workspace-materials':{materials:kinds.map(kind=>({kind}))}}});
 expect(()=>assertWorkspaceImportKind(candidate('floor'),false)).not.toThrow();
 expect(()=>assertWorkspaceImportKind(candidate('wall'),false)).toThrow();
 expect(()=>assertWorkspaceImportKind(candidate('floor','wall'),false)).toThrow();
 expect(()=>assertWorkspaceImportKind(candidate('floor','wall'),true)).not.toThrow();
});
