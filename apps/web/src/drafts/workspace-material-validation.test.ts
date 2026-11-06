// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {validateWorkspaceMaterialBindings} from '@exhibitos/spec/workspace-material';
import {workspaceFloorMaterials} from './workspace-material-validation.mjs';
const surface='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const sample=()=>({surfaces:[{id:surface,type:'floor'}],extensions:{'org.exhibitos.studio/workspace-materials':{version:1,materials:[{id,version:1,kind:'floor',name:'Synthetic',rights:{holder:'Example',ownership:'owner',licenseId:'CC0-1.0',creditLine:'',permissions:{display:true,download:false,export:true,commercial:true}},provenance:'Synthetic',maps:{color:{mime:'image/png',bytes:100,sha256:'a'.repeat(64),width:2,height:2,colorSpace:'srgb'}}}],bindings:[{surfaceId:surface,materialId:id,materialVersion:1,repeatMeters:[2,2],rotation:0}]}}});
it('accepts a Spec-valid floor color binding and rejects inconsistent or unsupported input',()=>{
 const value=sample(),extension=value.extensions['org.exhibitos.studio/workspace-materials'];expect(validateWorkspaceMaterialBindings(extension,value.surfaces).valid).toBe(true);expect(workspaceFloorMaterials(value)[0]?.binding.repeatMeters).toEqual([2,2]);
 const wrong=sample();wrong.surfaces[0]!.type='wall';expect(()=>workspaceFloorMaterials(wrong)).toThrow('WORKSPACE_MATERIAL_INVALID');
 const duplicate=sample();duplicate.extensions['org.exhibitos.studio/workspace-materials'].bindings.push(structuredClone(duplicate.extensions['org.exhibitos.studio/workspace-materials'].bindings[0]!));expect(()=>workspaceFloorMaterials(duplicate)).toThrow('WORKSPACE_MATERIAL_INVALID');
 const extra=sample();Object.assign(extra.extensions['org.exhibitos.studio/workspace-materials'].materials[0]!.maps,{roughness:{...extra.extensions['org.exhibitos.studio/workspace-materials'].materials[0]!.maps.color,colorSpace:'linear'}});expect(()=>workspaceFloorMaterials(extra)).toThrow('WORKSPACE_MATERIAL_UNSUPPORTED');
 const invalid=sample();invalid.extensions['org.exhibitos.studio/workspace-materials'].materials[0]!.maps.color.sha256='invalid';expect(()=>workspaceFloorMaterials(invalid)).toThrow('WORKSPACE_MATERIAL_INVALID');
 expect(workspaceFloorMaterials({extensions:{}})).toEqual([]);
});
