// SPDX-License-Identifier: AGPL-3.0-or-later
import type {PoolClient} from 'pg';
import {expect,it,vi} from 'vitest';
import type {Session} from './auth.ts';
import {claimBoundedOexLease,verifyBoundedOexLease} from './oex-bounded-lease.ts';
import {bindNativeOexWorkspace,type NativeOexWorkspaceContext} from './native-oex-provenance.ts';
vi.mock('./publication-attempt.ts',()=>({publicationDiskOwner:vi.fn(async()=>owner)}));
const owner={databaseSystemId:'42',databaseOid:'16384',storeRoot:'/synthetic',storeDevice:'1',storeInode:'2'};
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const s={id:id(1),tenantId:id(2),userId:id(3),role:'artist'} as Session,input={jobId:id(4),requestId:id(5),bytes:12,sha256:'a'.repeat(64)};
function fixture(){
 let probe='',activeCount=0;const state={expireAfterLock:false,expireAt:0},row={state:'queued',archive_profile:'bounded-file-v1',oex_format:'1.0.0-draft.9',request_id:input.requestId,expected_bytes:input.bytes,payload_sha256:input.sha256,lease_id:null,cleanup_pending:false,cleanup_keys:[],staging_keys:[`${s.tenantId}/oex-staging/${input.jobId}/chunk-0`]};
 const query=vi.fn(async(sql:string,args?:unknown[])=>{if(sql.includes('set_config')){probe=String(args![0]);return {rows:[]};}if(sql.includes('transaction_isolation'))return {rows:[{isolation:'read committed',probe}]};if(sql.includes('FROM auth_sessions')){activeCount++;return (state.expireAfterLock&&activeCount>1||state.expireAt===activeCount)?{rowCount:0,rows:[]}:{rowCount:1,rows:[{role:'artist'}]};}if(sql.startsWith('SELECT * FROM oex_import_jobs'))return {rows:[row]};if(sql.startsWith('UPDATE'))return {rowCount:1,rows:[{id:input.jobId,lease_id:args![3]}]};throw Error('unexpected');});return {row,query,state};
}
it('claims only the exact queued personal job under the existing transaction',async()=>{
 const f=fixture(),result=await claimBoundedOexLease({query:f.query} as unknown as PoolClient,s,input);expect(result.jobId).toBe(input.jobId);expect(result.archiveSha256).toBe(input.sha256);expect(result.leaseId).toMatch(/^[a-f0-9-]{36}$/);
});
it('refuses altered staging identity before assigning a lease',async()=>{
 const f=fixture();f.row.staging_keys=['other'];await expect(claimBoundedOexLease({query:f.query} as unknown as PoolClient,s,input)).rejects.toThrow('OEX_JOB_INVALID');expect(f.query.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);
});
it('refuses a session that expires while waiting for the job row',async()=>{
 const f=fixture();f.state.expireAfterLock=true;await expect(claimBoundedOexLease({query:f.query} as unknown as PoolClient,s,input)).rejects.toThrow('FORBIDDEN');expect(f.query.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);
});
it('rechecks Session and lease after acquiring the committed row lock',async()=>{
 let probe='',checks=0;const query=vi.fn(async(sql:string,args?:unknown[])=>{if(sql.includes('set_config')){probe=String(args![0]);return {rows:[]};}if(sql.includes('transaction_isolation'))return {rows:[{isolation:'read committed',probe}]};if(sql.startsWith('SELECT j.id')){checks++;return checks===1?{rowCount:1,rows:[{id:input.jobId}]}:{rowCount:0,rows:[]};}throw Error('unexpected');});
 await expect(verifyBoundedOexLease({query} as unknown as PoolClient,s,{jobId:input.jobId,requestId:input.requestId,userId:s.userId,leaseId:'10000000-0000-4000-8000-000000000006',archiveBytes:input.bytes,archiveSha256:input.sha256})).rejects.toThrow('OEX_LEASE_UNAVAILABLE');expect(checks).toBe(2);
});

it('claims the exact explicit draft10 job and denies cross-version selection before lease assignment',async()=>{
 const f=fixture();f.row.oex_format='1.0.0-draft.10';
 await expect(claimBoundedOexLease({query:f.query} as unknown as PoolClient,s,input)).rejects.toThrow('OEX_JOB_INVALID');expect(f.query.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);
 const lease=await claimBoundedOexLease({query:f.query} as unknown as PoolClient,s,{...input,archiveFormat:'1.0.0-draft.10'});expect(lease.archiveFormat).toBe('1.0.0-draft.10');
});

async function issuedFixture(){
 const f=fixture();f.row.oex_format='1.0.0-draft.12';
 const names=['026_oex_file_profile.sql','027_oex_exhibition_provenance.sql','028_oex_material_catalogue.sql','029_oex_quiet_oak_floor.sql','030_oex_concrete_surface.sql','031_workspace_material.sql','032_oex_workspace_material.sql','033_workspace_material_import_provenance.sql','034_workspace_material_terminal_proof.sql'];
 const hashes=['9e2a204ef9f24132f25ca2247415604c65f3f301c04e70a6a2a2facbc9122112','09bd82b3195e2f54545f6af45173bbab569effac95553a50f573745dab96f2c7','1f88a8ed07a3814954d11d58ebe9b627f399a39f918e8eb838d94a5df4f5b9af','d09e11450cdaa4e64f0b977cc17b1e468543314e6ce733571bc61b6b20deeb8a','8c42cecb6a90c61eab4c72c4af81af42801db6bac60a567b61e69e7a31e22848','2425f4d24859bf1627d1be9bb3d4b0ecc7829d074437a4aebd9e52d57bf45eb5','bc0017937498f37cfc98acf2851cd70752c76be353208e466aa6a2a5b1808efc','f69d3dc12d7b89f1a342daef1d7bca08787667efacdfca3d214d3101b051d1dd','ebf2300ef875b635617d82369f4c7cad4cbe6d8fa43677bdbd2e5e21dd74da21'];
 const rows=names.map((name,i)=>({name,sha256:hashes[i]})),catalogState={drift:false};
 const query=vi.fn(async(sql:string,args?:unknown[])=>{if(sql.includes('schema_migrations'))return {rows:catalogState.drift?[]:args?.length===2?rows.slice(7):rows.slice(0,7)};if(sql.includes('local_workspaces'))return {rowCount:1,rows:[{}]};return f.query(sql,args);});
 const client={query} as unknown as PoolClient,context=await bindNativeOexWorkspace(client,{workspaceId:id(7),tenantId:s.tenantId,principalId:s.userId,ownerUid:process.getuid!(),blobRoot:'/synthetic',workspaceImport:true});
 return {...f,client,context,query,catalogState};
}
it('requires the actual issued context, workspace and claim owner for draft12',async()=>{
 const f=await issuedFixture(),selected={...input,archiveFormat:'1.0.0-draft.12' as const},authority={context:f.context,workspaceId:id(7),owner};
 await expect(claimBoundedOexLease(f.client,s,selected)).rejects.toThrow('FORBIDDEN');
 const fake={...f.context,assertDatabase:async()=>{},assertImportCatalog:async()=>{}} as NativeOexWorkspaceContext;
 await expect(claimBoundedOexLease(f.client,s,selected,{...authority,context:fake})).rejects.toThrow('FORBIDDEN');
 await expect(claimBoundedOexLease(f.client,s,selected,{...authority,workspaceId:id(8)})).rejects.toThrow('FORBIDDEN');
 await expect(claimBoundedOexLease(f.client,s,selected,{...authority,owner:{...owner,storeRoot:'/other'}})).rejects.toThrow('NATIVE_OEX_PROVENANCE_INVALID');
 const lease=await claimBoundedOexLease(f.client,s,selected,authority);expect(lease.archiveFormat).toBe('1.0.0-draft.12');
 expect(f.query.mock.calls.some(([sql])=>sql.includes('FOR SHARE OF a,u,m,t'))).toBe(true);
});
it('refuses draft12 if the session expires after the final catalog check',async()=>{
 const f=await issuedFixture();f.state.expireAt=3;
 await expect(claimBoundedOexLease(f.client,s,{...input,archiveFormat:'1.0.0-draft.12'},{context:f.context,workspaceId:id(7),owner})).rejects.toThrow('FORBIDDEN');
 expect(f.query.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);
});
it('refuses draft12 when the catalog changes after issuance',async()=>{
 const f=await issuedFixture();f.catalogState.drift=true;
 await expect(claimBoundedOexLease(f.client,s,{...input,archiveFormat:'1.0.0-draft.12'},{context:f.context,workspaceId:id(7),owner})).rejects.toThrow('NATIVE_OEX_PROVENANCE_INVALID');
 expect(f.query.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);
});
it('rechecks draft12 session and lease after the final catalog check',async()=>{
 const f=await issuedFixture(),original=f.query.getMockImplementation()!;let checks=0;
 f.query.mockImplementation(async(sql:string,args?:unknown[])=>{if(sql.startsWith('SELECT j.id'))return ++checks===3?{rowCount:0,rows:[]}:{rowCount:1,rows:[{id:input.jobId}]};return original(sql,args);});
 const lease={jobId:input.jobId,requestId:input.requestId,userId:s.userId,leaseId:'10000000-0000-4000-8000-000000000006' as const,archiveBytes:input.bytes,archiveSha256:input.sha256,archiveFormat:'1.0.0-draft.12' as const};
 await expect(verifyBoundedOexLease(f.client,s,lease,{context:f.context,workspaceId:id(7),owner})).rejects.toThrow('OEX_LEASE_UNAVAILABLE');expect(checks).toBe(3);
});
