// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {remapWorkspaceMaterialImport} from './workspace-material-import.ts';

const surface='11111111-1111-4111-8111-111111111111',mappedSurface='22222222-2222-4222-8222-222222222222',materialId='33333333-3333-4333-8333-333333333333',mappedMaterial='44444444-4444-4444-8444-444444444444';
const source=()=>({surfaces:[{id:surface,type:'floor'}],extensions:{'org.exhibitos.studio/workspace-materials':{version:1,materials:[{id:materialId,version:1,kind:'floor',name:'Synthetic',rights:{holder:'Example',ownership:'owner',licenseId:'CC0-1.0',creditLine:'',permissions:{display:true,download:false,export:true,commercial:true}},provenance:'Synthetic',maps:{color:{mime:'image/png',bytes:100,sha256:'a'.repeat(64),width:2,height:2,colorSpace:'srgb'}}}],bindings:[{surfaceId:surface,materialId,materialVersion:1,repeatMeters:[2,2],rotation:0}]}}});
it('remaps material and surface identities without altering source descriptor or appearance',()=>{
 const input=source(),before=structuredClone(input),result=remapWorkspaceMaterialImport(input,{[surface]:mappedSurface},()=>mappedMaterial);
 expect(result.idMap).toMatchObject({[surface]:mappedSurface,[materialId]:mappedMaterial});expect(result.extension?.bindings).toEqual([{surfaceId:mappedSurface,materialId:mappedMaterial,materialVersion:1,repeatMeters:[2,2],rotation:0}]);expect(result.extension?.materials[0]).toEqual({...before.extensions['org.exhibitos.studio/workspace-materials'].materials[0],id:mappedMaterial});expect(input).toEqual(before);
});
it('refuses a missing surface mapping, identity collision or unsupported maps',()=>{
 expect(()=>remapWorkspaceMaterialImport(source(),{},()=>mappedMaterial)).toThrow('OEX_WORKSPACE_ID_CONFLICT');
 expect(()=>remapWorkspaceMaterialImport(source(),{[surface]:mappedSurface,[materialId]:mappedMaterial},()=>mappedMaterial)).toThrow('OEX_WORKSPACE_ID_CONFLICT');
 expect(()=>remapWorkspaceMaterialImport(source(),{[surface]:mappedSurface},()=>mappedSurface)).toThrow('OEX_WORKSPACE_ID_CONFLICT');
 expect(()=>remapWorkspaceMaterialImport(source(),{[surface]:mappedSurface},()=>materialId)).toThrow('OEX_WORKSPACE_ID_CONFLICT');
 expect(()=>remapWorkspaceMaterialImport(source(),{[surface]:mappedSurface},()=>surface)).toThrow('OEX_WORKSPACE_ID_CONFLICT');
 const extra=source();Object.assign(extra.extensions['org.exhibitos.studio/workspace-materials'].materials[0]!.maps,{roughness:{...extra.extensions['org.exhibitos.studio/workspace-materials'].materials[0]!.maps.color,colorSpace:'linear'}});expect(()=>remapWorkspaceMaterialImport(extra,{[surface]:mappedSurface},()=>mappedMaterial)).toThrow('WORKSPACE_MATERIAL_OUTPUT_UNSUPPORTED');
});
it('assigns one destination material ID across versions and a fresh one on reimport',()=>{
 const value=source(),surface2='55555555-5555-4555-8555-555555555555',mapped2='66666666-6666-4666-8666-666666666666';value.surfaces.push({id:surface2,type:'floor'});
 const ext=value.extensions['org.exhibitos.studio/workspace-materials'];ext.materials.push({...structuredClone(ext.materials[0]!),version:2});ext.bindings.push({surfaceId:surface2,materialId,materialVersion:2,repeatMeters:[1,1],rotation:0});
 const first=remapWorkspaceMaterialImport(value,{[surface]:mappedSurface,[surface2]:mapped2},()=>mappedMaterial),second=remapWorkspaceMaterialImport(value,{[surface]:mappedSurface,[surface2]:mapped2},()=> '77777777-7777-4777-8777-777777777777');
 expect(first.extension?.materials.map(m=>m.id)).toEqual([mappedMaterial,mappedMaterial]);expect(first.extension?.bindings.map(b=>b.materialVersion)).toEqual([1,2]);expect(second.extension?.materials[0]?.id).not.toBe(first.extension?.materials[0]?.id);
});
it('preserves distinct floor and wall kinds and rejects crossed surface bindings',()=>{
 const value=source(),wall='55555555-5555-4555-8555-555555555555',wallSurface='66666666-6666-4666-8666-666666666666',mappedWall='77777777-7777-4777-8777-777777777777',mappedWallSurface='88888888-8888-4888-8888-888888888888';
 value.surfaces.push({id:wallSurface,type:'wall'});const ext=value.extensions['org.exhibitos.studio/workspace-materials'];ext.materials.push({...structuredClone(ext.materials[0]!),id:wall,kind:'wall'});ext.bindings.push({surfaceId:wallSurface,materialId:wall,materialVersion:1,repeatMeters:[3,2],rotation:0});
 const ids=[mappedMaterial,mappedWall],result=remapWorkspaceMaterialImport(value,{[surface]:mappedSurface,[wallSurface]:mappedWallSurface},()=>ids.shift()!);
 expect(result.extension?.materials.map(m=>m.kind)).toEqual(['floor','wall']);expect(result.extension?.bindings.map(b=>b.surfaceId)).toEqual([mappedSurface,mappedWallSurface]);
 ext.bindings[1]!.surfaceId=surface;expect(()=>remapWorkspaceMaterialImport(value,{[surface]:mappedSurface,[wallSurface]:mappedWallSurface},()=>mappedWall)).toThrow();
});
