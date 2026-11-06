// SPDX-License-Identifier: AGPL-3.0-or-later
import type {PoolClient} from 'pg';
import type {OexWorkspaceMaterialManifest} from '@exhibitos/spec';
import {expect,it,vi} from 'vitest';
import type {Session} from './auth.ts';
import {workspaceMaterialOutputInventory} from './workspace-material-output.ts';
import {planWorkspaceMaterialImportSource} from './workspace-material-import-source.ts';
import {remapWorkspaceMaterialImport} from './workspace-material-import.ts';
import {attachWorkspaceMaterialImportVersions} from './workspace-material-import-attachment.ts';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const session={tenantId:id(1),userId:id(2),role:'artist'} as Session;
function fixture(){
 const scene={surfaces:[{id:id(7),type:'floor'}],extensions:{'org.exhibitos.studio/workspace-materials':{version:1,materials:[{id:id(8),version:1,kind:'floor',name:'Synthetic',rights:{holder:'Example',ownership:'owner',licenseId:'CC0-1.0',creditLine:'',permissions:{display:true,download:false,export:true,commercial:true}},provenance:'Synthetic',maps:{color:{mime:'image/png',bytes:100,sha256:'a'.repeat(64),width:2,height:2,colorSpace:'srgb'}}}],bindings:[{surfaceId:id(7),materialId:id(8),materialVersion:1,repeatMeters:[2,2],rotation:0}]}}};
 const resource=workspaceMaterialOutputInventory(scene)[0]!,manifest={formatVersion:'1.0.0-draft.12',archiveProfile:'bounded-file-v1',workspaceMaterialResources:[resource]} as OexWorkspaceMaterialManifest,jobId=id(3),attemptId=id(5),leaseId=id(4),stage=planWorkspaceMaterialImportSource({tenantId:session.tenantId,jobId,attemptId,scene,manifest,sourceKeys:new Map([[resource.path,`${session.tenantId}/oex-import/${jobId}/${attemptId}/${id(10)}`]])});
 const mapped=remapWorkspaceMaterialImport(scene,{[id(7)]:id(11)},()=>id(12)),target={surfaces:[{id:id(11),type:'floor'}],extensions:{'org.exhibitos.studio/workspace-materials':mapped.extension}};
 return {workspaceId:id(6),jobId,attemptId,leaseId,scene:target,idMap:mapped.idMap,stage};
}
function client(input:ReturnType<typeof fixture>,options:{lease?:boolean;transaction?:boolean;stage?:boolean}={}){let probe='';return {query:vi.fn(async(sql:string,args?:unknown[])=>{
 if(sql.includes('set_config')){probe=String(args![0]);return {rows:[],rowCount:1};}if(sql.includes('transaction_isolation'))return {rows:[{isolation:options.transaction===false?'serializable':'read committed',probe}],rowCount:1};
 if(sql.startsWith('SELECT id FROM oex_import_jobs'))return {rows:options.lease===false?[]:[{id:input.jobId}],rowCount:options.lease===false?0:1};
 if(sql.startsWith('SELECT source_material_id')){const e=input.stage[0]!;return {rows:options.stage===false?[]:[{source_material_id:e.sourceMaterialId,source_material_version:e.sourceMaterialVersion,role:e.role,source_path:e.sourcePath,sha256:e.sha256,bytes:e.bytes,object_key:e.objectKey}],rowCount:options.stage===false?0:1};}
 if(sql.startsWith('INSERT'))return {rows:[],rowCount:1};throw Error('unexpected query');
 })};}
it('writes the exact remapped descriptor and owned source provenance after checking committed stage',async()=>{
 const input=fixture(),c=client(input);await attachWorkspaceMaterialImportVersions(c as unknown as PoolClient,session,input);expect(c.query).toHaveBeenCalledTimes(6);const version=c.query.mock.calls[4]!,proof=c.query.mock.calls[5]!;expect(version[0]).toContain('workspace_material_versions');expect(version[1]![3]).toBe(id(12));expect(version[1]![6]).toEqual({color:input.stage[0]!.objectKey});expect(proof[1]).toEqual([input.workspaceId,session.tenantId,session.userId,id(12),1,id(8),1,input.jobId,input.attemptId,input.leaseId]);
});
it('rejects wrong mapping, missing stage and invalid transactions before inserting versions',async()=>{
 const a=fixture();a.idMap[id(8)]=id(13);const ca=client(a);await expect(attachWorkspaceMaterialImportVersions(ca as unknown as PoolClient,session,a)).rejects.toThrow('OEX_WORKSPACE_ATTACHMENT_INVALID');expect(ca.query).not.toHaveBeenCalled();
 const cross=fixture();cross.idMap[id(8)]=id(7);cross.scene.extensions['org.exhibitos.studio/workspace-materials']!.materials[0]!.id=id(7);cross.scene.extensions['org.exhibitos.studio/workspace-materials']!.bindings[0]!.materialId=id(7);const cx=client(cross);await expect(attachWorkspaceMaterialImportVersions(cx as unknown as PoolClient,session,cross)).rejects.toThrow('OEX_WORKSPACE_ATTACHMENT_INVALID');expect(cx.query).not.toHaveBeenCalled();
 const b=fixture(),cb=client(b,{stage:false});await expect(attachWorkspaceMaterialImportVersions(cb as unknown as PoolClient,session,b)).rejects.toThrow('OEX_INVENTORY_UNAVAILABLE');expect(cb.query).toHaveBeenCalledTimes(4);
 const d=fixture(),cd=client(d,{transaction:false});await expect(attachWorkspaceMaterialImportVersions(cd as unknown as PoolClient,session,d)).rejects.toThrow('OEX_TRANSACTION_UNSUPPORTED');expect(cd.query).toHaveBeenCalledTimes(2);
 const e=fixture(),ce=client(e,{lease:false});await expect(attachWorkspaceMaterialImportVersions(ce as unknown as PoolClient,session,e)).rejects.toThrow('OEX_INVENTORY_UNAVAILABLE');expect(ce.query).toHaveBeenCalledTimes(3);
});
