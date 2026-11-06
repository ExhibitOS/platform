// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import type {Session} from './auth.ts';
import {bindNativeLocalExportWorkspace,bindNativeOexWorkspace,consumeNativeSelectedDraftGrant,hasNativeBoundedProvenance,issueNativeSelectedDraftGrant,recordNativeSelectedProvenance,type NativeOexWorkspaceContext} from './native-oex-provenance.ts';
vi.mock('./publication-attempt.ts',()=>({publicationDiskOwner:vi.fn(async()=>({databaseSystemId:'42',databaseOid:'16384',storeRoot:'/synthetic',storeDevice:'1',storeInode:'2'}))}));
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const session={id:id(1),tenantId:id(2),userId:id(3),role:'admin',csrfToken:'',expiresAt:'2099-01-01T00:00:00Z'} as Session;
function fixture(){
 const row={workspace_id:id(4),principal_id:id(3),import_job_id:id(8),request_id:id(9),source_sha256:'a'.repeat(64),archive_profile:'bounded-file-v1',source_database_system_id:'42',source_database_oid:'16384',attempt_id:id(5),claim_sha256:'b'.repeat(64),payload_manifest_sha256:'c'.repeat(64),user_id:id(3),payload_sha256:'a'.repeat(64),job_profile:'bounded-file-v1',oex_format:'1.0.0-draft.9',state:'complete',result_exhibition:id(6),workspace_tenant:id(2),workspace_principal:id(3)};
 const query=vi.fn(async(sql:string,params:unknown[])=>{void sql;void params;return {rowCount:1,rows:[row]};});const assertDatabase=vi.fn(async()=>{}),assertRecord=vi.fn(async()=>{});
 const context:NativeOexWorkspaceContext={workspaceId:id(4),tenantId:id(2),principalId:id(3),assertCatalog:async()=>{},assertDatabase,assertRecord};return{row,c:{query} as unknown as PoolClient,query,context,assertDatabase,assertRecord};
}
it('requires authorized workspace and source database verification before enabling the bounded profile',async()=>{
 const f=fixture();expect(await hasNativeBoundedProvenance(f.c,session,id(6),f.context)).toBe(true);expect(f.assertDatabase).toHaveBeenCalledTimes(2);expect(f.assertRecord).toHaveBeenCalledOnce();
 expect(f.assertRecord).toHaveBeenCalledWith(f.c,expect.objectContaining({workspaceId:id(4),tenantId:id(2),principalId:id(3),importJobId:id(8),requestId:id(9),attemptId:id(5),claimSha256:'b'.repeat(64),exhibitionId:id(6)}));
 f.assertRecord.mockRejectedValueOnce(Error('source identity changed'));await expect(hasNativeBoundedProvenance(f.c,session,id(6),f.context)).rejects.toThrow('source identity changed');
});
it('normalizes a valid uppercase exhibition UUID before database and provenance checks',async()=>{
 const f=fixture(),lower='abcdefab-cdef-4abc-8def-abcdefabcdef';f.row.result_exhibition=lower;
 expect(await hasNativeBoundedProvenance(f.c,session,lower.toUpperCase(),f.context)).toBe(true);
 expect(f.query.mock.calls[0]?.[1]).toEqual([session.tenantId,lower]);expect(f.assertRecord).toHaveBeenCalledWith(f.c,expect.objectContaining({exhibitionId:lower}));
});
it('retains the ordinary limit without a context or binding and rejects mismatched scope',async()=>{
 const f=fixture();expect(await hasNativeBoundedProvenance(f.c,session,id(6))).toBe(false);expect(f.query).not.toHaveBeenCalled();
 await expect(hasNativeBoundedProvenance(f.c,{...session,tenantId:id(7)},id(6),f.context)).rejects.toMatchObject({code:'FORBIDDEN'});expect(f.query).not.toHaveBeenCalled();
 f.query.mockResolvedValueOnce({rowCount:0,rows:[]});expect(await hasNativeBoundedProvenance(f.c,session,id(6),f.context)).toBe(false);
 f.row.result_exhibition=id(7);await expect(hasNativeBoundedProvenance(f.c,session,id(6),f.context)).rejects.toMatchObject({code:'NATIVE_OEX_PROVENANCE_INVALID'});
});
it('binds default native export to the existing workspace and UID without supplemental migration',async()=>{
 let valid=true;const query=vi.fn(async(sql:string)=>{if(sql.includes('schema_migrations'))throw Error('unexpected migration query');return valid?{rows:[{}],rowCount:1}:{rows:[],rowCount:0};});const c={query} as unknown as PoolClient;
 const args={workspaceId:id(4),tenantId:id(2),principalId:id(3),ownerUid:process.getuid!(),blobRoot:'/synthetic'},context=await bindNativeLocalExportWorkspace(c,args);await context.assertDatabase(c);expect(context).toMatchObject({workspaceId:id(4),tenantId:id(2),principalId:id(3)});valid=false;await expect(context.assertDatabase(c)).rejects.toMatchObject({code:'FORBIDDEN'});
});
it('requires the exact applied 026 and 027 hashes at bind and during later fenced checks',async()=>{
 const rows=[{name:'026_oex_file_profile.sql',sha256:'9e2a204ef9f24132f25ca2247415604c65f3f301c04e70a6a2a2facbc9122112'},{name:'027_oex_exhibition_provenance.sql',sha256:'09bd82b3195e2f54545f6af45173bbab569effac95553a50f573745dab96f2c7'}];
 let catalog=structuredClone(rows);const c={query:async(sql:string)=>sql.includes('schema_migrations')?{rows:catalog,rowCount:catalog.length}:{rows:[{}],rowCount:1}} as unknown as PoolClient;
 const args={workspaceId:id(4),tenantId:id(2),principalId:id(3),ownerUid:process.getuid!(),blobRoot:'/synthetic'},context=await bindNativeOexWorkspace(c,args);await context.assertCatalog(c);await context.assertDatabase(c);
 catalog=[rows[0]!];await expect(context.assertCatalog(c)).rejects.toMatchObject({code:'NATIVE_OEX_PROVENANCE_INVALID'});await expect(bindNativeOexWorkspace(c,args)).rejects.toMatchObject({code:'NATIVE_OEX_PROVENANCE_INVALID'});
 catalog=structuredClone(rows);catalog[1]!.sha256='0'.repeat(64);await expect(context.assertDatabase(c)).rejects.toMatchObject({code:'NATIVE_OEX_PROVENANCE_INVALID'});
});

it('keeps exact028 and029 catalogs distinct without silently rebinding existing workspace checks',async()=>{
 const rows=[{name:'026_oex_file_profile.sql',sha256:'9e2a204ef9f24132f25ca2247415604c65f3f301c04e70a6a2a2facbc9122112'},{name:'027_oex_exhibition_provenance.sql',sha256:'09bd82b3195e2f54545f6af45173bbab569effac95553a50f573745dab96f2c7'},{name:'028_oex_material_catalogue.sql',sha256:'1f88a8ed07a3814954d11d58ebe9b627f399a39f918e8eb838d94a5df4f5b9af'}];
 let catalog=structuredClone(rows);const c={query:async(sql:string)=>sql.includes('schema_migrations')?{rows:catalog,rowCount:catalog.length}:{rows:[{}],rowCount:1}} as unknown as PoolClient;
 const args={workspaceId:id(4),tenantId:id(2),principalId:id(3),ownerUid:process.getuid!(),blobRoot:'/synthetic'},old=await bindNativeOexWorkspace(c,args);
 expect(old.archiveFormats).toEqual(['1.0.0-draft.9','1.0.0-draft.10']);
 catalog=[...catalog,{name:'029_oex_quiet_oak_floor.sql',sha256:'d09e11450cdaa4e64f0b977cc17b1e468543314e6ce733571bc61b6b20deeb8a'}];
 await expect(old.assertCatalog(c)).rejects.toMatchObject({code:'NATIVE_OEX_PROVENANCE_INVALID'});
 const current=await bindNativeOexWorkspace(c,args);expect(current.archiveFormats).toEqual(old.archiveFormats);await current.assertCatalog(c);
 const floor=await bindNativeOexWorkspace(c,args);catalog=[...catalog,{name:'030_oex_concrete_surface.sql',sha256:'8c42cecb6a90c61eab4c72c4af81af42801db6bac60a567b61e69e7a31e22848'}];
 await expect(floor.assertCatalog(c)).rejects.toMatchObject({code:'NATIVE_OEX_PROVENANCE_INVALID'});const concrete=await bindNativeOexWorkspace(c,args);await concrete.assertCatalog(c);
 const exact=structuredClone(catalog);
 for(const change of [(v:typeof rows)=>{v[3]!.sha256='0'.repeat(64);},(v:typeof rows)=>{v.splice(2,1);},(v:typeof rows)=>{v.reverse();}]){catalog=structuredClone(exact);change(catalog);await expect(bindNativeOexWorkspace(c,args)).rejects.toMatchObject({code:'NATIVE_OEX_PROVENANCE_INVALID'});}
 catalog=structuredClone(rows);await expect(current.assertCatalog(c)).rejects.toMatchObject({code:'NATIVE_OEX_PROVENANCE_INVALID'});await old.assertCatalog(c);
});

it('captures the draft before awaiting live-owner verification',async()=>{
 const f=fixture(),draft={exhibitionId:id(6),title:'original'},binding={workspaceId:id(4),tenantId:id(2),principalId:id(3),jobId:id(8),attemptId:id(5),sourceSha256:'a'.repeat(64),claimSha256:'b'.repeat(64),payloadManifestSha256:'c'.repeat(64),sourceDatabaseSystemId:'42',sourceDatabaseOid:'16384',exhibitionId:id(6)};
 let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});let first=true;
 const pending=issueNativeSelectedDraftGrant(f.c,session,draft,binding,async()=>{if(first){first=false;await barrier;}});
 draft.title='changed';release();const grant=await pending;
 await expect(consumeNativeSelectedDraftGrant(grant,f.c,session,draft)).rejects.toMatchObject({code:'FORBIDDEN'});
 await consumeNativeSelectedDraftGrant(grant,f.c,session,{...draft,title:'original'});
});
it('binds a selected draft grant to one transaction, session and exact draft',async()=>{
 const f=fixture(),draft={exhibitionId:id(6),title:'original'},binding={workspaceId:id(4),tenantId:id(2),principalId:id(3),jobId:id(8),attemptId:id(5),sourceSha256:'a'.repeat(64),claimSha256:'b'.repeat(64),payloadManifestSha256:'c'.repeat(64),sourceDatabaseSystemId:'42',sourceDatabaseOid:'16384',exhibitionId:id(6)},live=vi.fn(async()=>{});
 const grant=await issueNativeSelectedDraftGrant(f.c,session,draft,binding,live);
 await expect(consumeNativeSelectedDraftGrant(grant,f.c,session,{...draft,title:'changed'})).rejects.toMatchObject({code:'FORBIDDEN'});
 await consumeNativeSelectedDraftGrant(grant,f.c,session,draft);
 await expect(consumeNativeSelectedDraftGrant(grant,f.c,session,draft)).rejects.toMatchObject({code:'FORBIDDEN'});
 await recordNativeSelectedProvenance(grant,f.c,session,id(6));expect(f.query.mock.calls.at(-1)?.[0]).toContain('INSERT INTO native_oex_exhibition_provenance');
 await expect(recordNativeSelectedProvenance(grant,f.c,session,id(6))).rejects.toMatchObject({code:'FORBIDDEN'});
});
it('rejects forged grants and cross-transaction or cross-session reuse',async()=>{
 const f=fixture(),draft={exhibitionId:id(6),title:'same'},binding={workspaceId:id(4),tenantId:id(2),principalId:id(3),jobId:id(8),attemptId:id(5),sourceSha256:'a'.repeat(64),claimSha256:'b'.repeat(64),payloadManifestSha256:'c'.repeat(64),sourceDatabaseSystemId:'42',sourceDatabaseOid:'16384',exhibitionId:id(6)};
 const grant=await issueNativeSelectedDraftGrant(f.c,session,draft,binding,async()=>{});
 await expect(consumeNativeSelectedDraftGrant({} as typeof grant,f.c,session,draft)).rejects.toMatchObject({code:'FORBIDDEN'});
 await expect(consumeNativeSelectedDraftGrant(grant,{} as PoolClient,session,draft)).rejects.toMatchObject({code:'FORBIDDEN'});
 await expect(consumeNativeSelectedDraftGrant(grant,f.c,{...session,id:id(10)},draft)).rejects.toMatchObject({code:'FORBIDDEN'});
 await consumeNativeSelectedDraftGrant(grant,f.c,session,draft);
 await expect(recordNativeSelectedProvenance(grant,f.c,session,id(10))).rejects.toMatchObject({code:'FORBIDDEN'});
 await recordNativeSelectedProvenance(grant,f.c,session,id(6));
});
it('refuses selected grant consumption when the retained owner is lost',async()=>{
 const f=fixture(),draft={exhibitionId:id(6)},binding={workspaceId:id(4),tenantId:id(2),principalId:id(3),jobId:id(8),attemptId:id(5),sourceSha256:'a'.repeat(64),claimSha256:'b'.repeat(64),payloadManifestSha256:'c'.repeat(64),sourceDatabaseSystemId:'42',sourceDatabaseOid:'16384',exhibitionId:id(6)};let live=true;
 const grant=await issueNativeSelectedDraftGrant(f.c,session,draft,binding,async()=>{if(!live)throw Error('OWNER_LOST');});live=false;
 await expect(consumeNativeSelectedDraftGrant(grant,f.c,session,draft)).rejects.toThrow('OWNER_LOST');
 await expect(recordNativeSelectedProvenance(grant,f.c,session,id(6))).rejects.toThrow('OWNER_LOST');
});

it('requires both exact workspace material ledger rows and detects later drift',async()=>{
 const rows=[{name:'026_oex_file_profile.sql',sha256:'9e2a204ef9f24132f25ca2247415604c65f3f301c04e70a6a2a2facbc9122112'},{name:'027_oex_exhibition_provenance.sql',sha256:'09bd82b3195e2f54545f6af45173bbab569effac95553a50f573745dab96f2c7'},{name:'028_oex_material_catalogue.sql',sha256:'1f88a8ed07a3814954d11d58ebe9b627f399a39f918e8eb838d94a5df4f5b9af'},{name:'029_oex_quiet_oak_floor.sql',sha256:'d09e11450cdaa4e64f0b977cc17b1e468543314e6ce733571bc61b6b20deeb8a'},{name:'030_oex_concrete_surface.sql',sha256:'8c42cecb6a90c61eab4c72c4af81af42801db6bac60a567b61e69e7a31e22848'},{name:'031_workspace_material.sql',sha256:'2425f4d24859bf1627d1be9bb3d4b0ecc7829d074437a4aebd9e52d57bf45eb5'},{name:'032_oex_workspace_material.sql',sha256:'bc0017937498f37cfc98acf2851cd70752c76be353208e466aa6a2a5b1808efc'}];
 let catalog=structuredClone(rows);const c={query:async(sql:string)=>sql.includes('schema_migrations')?{rows:catalog,rowCount:catalog.length}:{rows:[{}],rowCount:1}} as unknown as PoolClient;
 const args={workspaceId:id(4),tenantId:id(2),principalId:id(3),ownerUid:process.getuid!(),blobRoot:'/synthetic'},context=await bindNativeOexWorkspace(c,args);
 expect(context.workspaceMaterials).toBe(true);expect(context.archiveFormats).toEqual(['1.0.0-draft.9','1.0.0-draft.10']);await context.assertCatalog(c);
 catalog=catalog.slice(0,-1);await expect(context.assertCatalog(c)).rejects.toMatchObject({code:'NATIVE_OEX_PROVENANCE_INVALID'});await expect(bindNativeOexWorkspace(c,args)).rejects.toMatchObject({code:'NATIVE_OEX_PROVENANCE_INVALID'});
 catalog=structuredClone(rows);catalog[6]!.sha256='0'.repeat(64);await expect(bindNativeOexWorkspace(c,{...args,workspaceImport:true})).rejects.toMatchObject({code:'NATIVE_OEX_PROVENANCE_INVALID'});
});
it('issues the v6 import context only for the exact workspace and 033/034 ledger and detects later drift',async()=>{
 const base=[['026_oex_file_profile.sql','9e2a204ef9f24132f25ca2247415604c65f3f301c04e70a6a2a2facbc9122112'],['027_oex_exhibition_provenance.sql','09bd82b3195e2f54545f6af45173bbab569effac95553a50f573745dab96f2c7'],['028_oex_material_catalogue.sql','1f88a8ed07a3814954d11d58ebe9b627f399a39f918e8eb838d94a5df4f5b9af'],['029_oex_quiet_oak_floor.sql','d09e11450cdaa4e64f0b977cc17b1e468543314e6ce733571bc61b6b20deeb8a'],['030_oex_concrete_surface.sql','8c42cecb6a90c61eab4c72c4af81af42801db6bac60a567b61e69e7a31e22848'],['031_workspace_material.sql','2425f4d24859bf1627d1be9bb3d4b0ecc7829d074437a4aebd9e52d57bf45eb5'],['032_oex_workspace_material.sql','bc0017937498f37cfc98acf2851cd70752c76be353208e466aa6a2a5b1808efc']].map(([name,sha256])=>({name,sha256})),initial=[{name:'033_workspace_material_import_provenance.sql',sha256:'f69d3dc12d7b89f1a342daef1d7bca08787667efacdfca3d214d3101b051d1dd'},{name:'034_workspace_material_terminal_proof.sql',sha256:'ebf2300ef875b635617d82369f4c7cad4cbe6d8fa43677bdbd2e5e21dd74da21'}];let extra=structuredClone(initial);
 const c={query:async(sql:string,params:unknown[])=>sql.includes('schema_migrations')?{rows:params.length===2?extra:base,rowCount:params.length===2?extra.length:base.length}:{rows:[{}],rowCount:1}} as unknown as PoolClient,args={workspaceId:id(4),tenantId:id(2),principalId:id(3),ownerUid:process.getuid!(),blobRoot:'/synthetic',workspaceImport:true as const};
 const context=await bindNativeOexWorkspace(c,args);expect(context.workspaceImport).toBe(true);expect(context.archiveFormats).toEqual(['1.0.0-draft.9','1.0.0-draft.10']);await context.assertImportCatalog!(c);const owner={databaseSystemId:'42',databaseOid:'16384',storeRoot:'/synthetic',storeDevice:'1',storeInode:'2'};context.assertOwner!(owner);expect(()=>context.assertOwner!({...owner,storeRoot:'/other'})).toThrow();
 const f=fixture();f.row.oex_format='1.0.0-draft.12';const reader={query:async(sql:string,params:unknown[])=>sql.includes('FROM native_oex_exhibition_provenance')?f.query(sql,params):c.query(sql,params)} as unknown as PoolClient;
 expect(await hasNativeBoundedProvenance(reader,session,id(6),context)).toBe(true);await expect(hasNativeBoundedProvenance(reader,session,id(6),{...context})).rejects.toMatchObject({code:'NATIVE_OEX_PROVENANCE_INVALID'});
 const draft={exhibitionId:id(6)},binding={workspaceId:id(4),tenantId:id(2),principalId:id(3),jobId:id(8),attemptId:id(5),sourceSha256:'a'.repeat(64),claimSha256:'b'.repeat(64),payloadManifestSha256:'c'.repeat(64),sourceDatabaseSystemId:'42',sourceDatabaseOid:'16384',exhibitionId:id(6)};
 await expect(issueNativeSelectedDraftGrant(c,session,draft,binding,async()=>{},{context:{...context},owner})).rejects.toMatchObject({code:'FORBIDDEN'});const grant=await issueNativeSelectedDraftGrant(c,session,draft,binding,async()=>{},{context,owner});await consumeNativeSelectedDraftGrant(grant,c,session,draft);
 (args as {workspaceImport?:true}).workspaceImport=undefined;extra=[initial[0]!];await expect(context.assertDatabase(c)).rejects.toMatchObject({code:'NATIVE_OEX_PROVENANCE_INVALID'});await expect(bindNativeOexWorkspace(c,{...args,workspaceImport:true})).rejects.toMatchObject({code:'NATIVE_OEX_PROVENANCE_INVALID'});
});
