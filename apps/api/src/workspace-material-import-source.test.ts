// SPDX-License-Identifier: AGPL-3.0-or-later
import {deflateSync} from 'node:zlib';
import {sha256} from '@exhibitos/storage';
import type {OexWorkspaceMaterialManifest} from '@exhibitos/spec';
import {expect,it} from 'vitest';
import {pngCrc} from './png-pixels.ts';
import {workspaceMaterialOutputInventory} from './workspace-material-output.ts';
import {planWorkspaceMaterialImportSource,validateWorkspaceMaterialImportSourceBytes} from './workspace-material-import-source.ts';

const tenant='11111111-1111-4111-8111-111111111111',job='22222222-2222-4222-8222-222222222222',attempt='33333333-3333-4333-8333-333333333333',object='44444444-4444-4444-8444-444444444444',material='55555555-5555-4555-8555-555555555555',surface='66666666-6666-4666-8666-666666666666';
const chunk=(type:string,body:Buffer)=>{const t=Buffer.from(type),out=Buffer.alloc(body.length+12);out.writeUInt32BE(body.length);t.copy(out,4);body.copy(out,8);out.writeUInt32BE(pngCrc(Buffer.concat([t,body])),body.length+8);return out;};
function fixture(){
 const header=Buffer.alloc(13);header.writeUInt32BE(2,0);header.writeUInt32BE(2,4);header[8]=8;header[9]=2;
 const bytes=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(14))),chunk('IEND',Buffer.alloc(0))]);
 const scene={surfaces:[{id:surface,type:'floor'}],extensions:{'org.exhibitos.studio/workspace-materials':{version:1,materials:[{id:material,version:1,kind:'floor',name:'Synthetic',rights:{holder:'Example',ownership:'owner',licenseId:'CC0-1.0',creditLine:'',permissions:{display:true,download:false,export:true,commercial:true}},provenance:'Synthetic',maps:{color:{mime:'image/png',bytes:bytes.length,sha256:sha256(bytes),width:2,height:2,colorSpace:'srgb'}}}],bindings:[{surfaceId:surface,materialId:material,materialVersion:1,repeatMeters:[2,2],rotation:0}]}}};
 const resources=workspaceMaterialOutputInventory(scene),manifest={formatVersion:'1.0.0-draft.12',archiveProfile:'bounded-file-v1',workspaceMaterialResources:structuredClone(resources)} as OexWorkspaceMaterialManifest;
 return {tenantId:tenant,jobId:job,attemptId:attempt,scene,manifest,sourceKeys:new Map([[resources[0]!.path,`${tenant}/oex-import/${job}/${attempt}/${object}`]]),bytes};
}
it('binds the complete scene resource to the exact attempt key and validates its PNG bytes',async()=>{
 const {bytes,...input}=fixture(),plan=planWorkspaceMaterialImportSource(input);expect(plan).toHaveLength(1);expect(plan[0]).toMatchObject({sourceMaterialId:material,sourceMaterialVersion:1,role:'color',objectKey:input.sourceKeys.values().next().value,bytes:bytes.length,sha256:sha256(bytes)});await expect(validateWorkspaceMaterialImportSourceBytes(plan[0]!,bytes)).resolves.toBeUndefined();
 const corrupt=Buffer.from(bytes);corrupt[corrupt.length-1]=corrupt[corrupt.length-1]!^1;await expect(validateWorkspaceMaterialImportSourceBytes(plan[0]!,corrupt)).rejects.toMatchObject({code:'UPLOAD_INTEGRITY'});
 const wrongDimensions={...plan[0]!,descriptor:{...plan[0]!.descriptor,width:3}};await expect(validateWorkspaceMaterialImportSourceBytes(wrongDimensions,bytes)).rejects.toMatchObject({code:'MATERIAL_MAP_DIMENSIONS'});
});
it('rejects mismatched descriptors, missing and duplicate resources and foreign attempt keys',()=>{
 const changed=fixture();changed.manifest.workspaceMaterialResources[0]!.sha256='b'.repeat(64);expect(()=>planWorkspaceMaterialImportSource(changed)).toThrow('OEX_WORKSPACE_SOURCE_INVALID');
 const missing=fixture();missing.manifest.workspaceMaterialResources=[];expect(()=>planWorkspaceMaterialImportSource(missing)).toThrow('OEX_WORKSPACE_SOURCE_INVALID');
 const duplicate=fixture();duplicate.manifest.workspaceMaterialResources.push(structuredClone(duplicate.manifest.workspaceMaterialResources[0]!));expect(()=>planWorkspaceMaterialImportSource(duplicate)).toThrow('OEX_WORKSPACE_SOURCE_INVALID');
 const foreign=fixture();foreign.sourceKeys.set(foreign.manifest.workspaceMaterialResources[0]!.path,`${tenant}/oex-import/${job}/${object}/${object}`);expect(()=>planWorkspaceMaterialImportSource(foreign)).toThrow('OEX_WORKSPACE_SOURCE_INVALID');
 const aliases=fixture();aliases.sourceKeys.set('assets/other',aliases.sourceKeys.values().next().value!);expect(()=>planWorkspaceMaterialImportSource(aliases)).toThrow('OEX_WORKSPACE_SOURCE_INVALID');
 const unbounded=fixture();delete unbounded.manifest.archiveProfile;expect(()=>planWorkspaceMaterialImportSource(unbounded)).toThrow('OEX_WORKSPACE_SOURCE_INVALID');
});
it('rejects wall and mixed source inventories before planning import keys',()=>{
 for(const mixed of [false,true]){
  const input=fixture(),ext=input.scene.extensions['org.exhibitos.studio/workspace-materials'];
  if(mixed){const wall='77777777-7777-4777-8777-777777777777',wallSurface='88888888-8888-4888-8888-888888888888';input.scene.surfaces.push({id:wallSurface,type:'wall'});ext.materials.push({...structuredClone(ext.materials[0]!),id:wall,kind:'wall'});ext.bindings.push({surfaceId:wallSurface,materialId:wall,materialVersion:1,repeatMeters:[1,1],rotation:0});}
  else{input.scene.surfaces[0]!.type='wall';ext.materials[0]!.kind='wall';}
  input.manifest.workspaceMaterialResources=workspaceMaterialOutputInventory(input.scene);
  expect(()=>planWorkspaceMaterialImportSource(input)).toThrow('WORKSPACE_MATERIAL_IMPORT_UNSUPPORTED');
 }
});
it('uses the canonical source ID when a valid scene uses uppercase UUIDs',()=>{
 const input=fixture(),ext=input.scene.extensions['org.exhibitos.studio/workspace-materials'],id='ABCDEFAB-ABCD-4ABC-8ABC-ABCDEFABCDEF';ext.materials[0]!.id=id;ext.bindings[0]!.materialId=id;
 const [resource]=workspaceMaterialOutputInventory(input.scene);input.manifest.workspaceMaterialResources=[resource!];input.sourceKeys=new Map([[resource!.path,`${tenant}/oex-import/${job}/${attempt}/${object}`]]);
 expect(planWorkspaceMaterialImportSource(input)[0]!.sourceMaterialId).toBe(id.toLowerCase());
});
