// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,it,expect,vi} from 'vitest';
import type {PoolClient} from 'pg';
import type {Session} from './auth.ts';
import type {WorkspaceMaterialIntakes} from './workspace-material-intakes.ts';
import {assertWorkspaceMaterialSnapshot} from './workspace-material-snapshot.ts';
const id='11111111-1111-4111-8111-111111111111',surface='22222222-2222-4222-8222-222222222222';
const material=()=>({id,version:1,kind:'floor',name:'Synthetic',rights:{holder:'Example',ownership:'owner',licenseId:'CC0-1.0',creditLine:'Synthetic',permissions:{display:true,download:true,export:true,commercial:true}},provenance:'Synthetic',maps:{color:{mime:'image/png',bytes:100,sha256:'a'.repeat(64),width:10,height:10,colorSpace:'srgb'}}});
const candidate=()=>({surfaces:[{id:surface,type:'floor'}],extensions:{'org.exhibitos.studio/workspace-materials':{version:1,materials:[material()],bindings:[{surfaceId:surface,materialId:id,materialVersion:1,repeatMeters:[2,2],rotation:0}]}}});
const c={} as PoolClient,s={} as Session;
describe('workspace material draft ownership',()=>{
 it('preserves legacy drafts and rejects a material snapshot without an enabled service',async()=>{
  await expect(assertWorkspaceMaterialSnapshot(c,s,{surfaces:[],extensions:{}})).resolves.toBeUndefined();
  await expect(assertWorkspaceMaterialSnapshot(c,s,candidate())).rejects.toMatchObject({code:'WORKSPACE_MATERIAL_UNAVAILABLE'});
 });
 it('requires a valid typed binding and the exact owner-scoped registered descriptor',async()=>{
  const readVersion=vi.fn().mockResolvedValue(material()),service={readVersion} as unknown as WorkspaceMaterialIntakes;
  await expect(assertWorkspaceMaterialSnapshot(c,s,candidate(),service)).resolves.toBeUndefined();expect(readVersion).toHaveBeenCalledWith(c,s,id,1);
  const changed=candidate();changed.extensions['org.exhibitos.studio/workspace-materials'].materials[0]!.name='forged';
  await expect(assertWorkspaceMaterialSnapshot(c,s,changed,service)).rejects.toMatchObject({code:'MATERIAL_VERSION_MISMATCH'});
  const wrong=candidate();wrong.surfaces[0]!.type='wall';await expect(assertWorkspaceMaterialSnapshot(c,s,wrong,service)).rejects.toMatchObject({code:'DRAFT_INVALID'});
  readVersion.mockRejectedValueOnce(Object.assign(new Error(),{code:'MATERIAL_NOT_FOUND'}));await expect(assertWorkspaceMaterialSnapshot(c,s,candidate(),service)).rejects.toMatchObject({code:'MATERIAL_NOT_FOUND'});
 });
 it('rechecks display rights at save time',async()=>{
  const denied=material();denied.rights.permissions.display=false;const x=candidate();x.extensions['org.exhibitos.studio/workspace-materials'].materials=[denied];
  const service={readVersion:vi.fn().mockResolvedValue(denied)} as unknown as WorkspaceMaterialIntakes;
  await expect(assertWorkspaceMaterialSnapshot(c,s,x,service)).rejects.toMatchObject({code:'DISPLAY_PERMISSION_REQUIRED'});
 });
});
