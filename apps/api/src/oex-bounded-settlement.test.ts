// SPDX-License-Identifier: AGPL-3.0-or-later
// Real file deletion/fsync with a transaction model. Issued native retirement
// and committed-proof validators have their separate existing focused tests.
import {afterEach,expect,it,vi} from 'vitest';
import {readFile,mkdtemp,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Pool} from 'pg';
import {FileBlobStore} from '@exhibitos/storage';
import {PublicationAttempts,publicationDiskOwner} from './publication-attempt.ts';
import {PublicationDiskBudget} from './publication-disk-budget.ts';
import * as committed from './workspace-oex-terminal-committed.ts';
import {settleBoundedWorkspaceOexCleanup} from './oex-bounded-settlement.ts';
import type {Session} from './auth.ts';
const fixture=JSON.parse(await readFile(new URL('../test-fixtures/workspace-oex-terminal-native-v1.json',import.meta.url),'utf8'));
const roots:string[]=[];afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function setup(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'oex-settlement-')));roots.push(root);const blobs=new FileBlobStore(root),scope=structuredClone(fixture.scope);
 const keys=[0,1].map(n=>`${scope.tenantId}/oex-staging/${scope.jobId}/chunk-${n}`),asset=`${scope.tenantId}/oex-import/${scope.jobId}/${scope.attemptId}/10000000-0000-4000-8000-000000000099`;
 await blobs.put(keys[0]!,Buffer.from('upload first'));await blobs.put(keys[1]!,Buffer.from('upload second'));await blobs.put(asset,Buffer.from('committed source and artwork'));
 const row={tenant_id:scope.tenantId,id:scope.jobId,user_id:scope.principalId,request_id:scope.importRequestId,payload_sha256:scope.sourceArchiveSha256,expected_bytes:16*1024*1024+1,state:'complete',lease_id:null,lease_until:null,archive_profile:'bounded-file-v1',oex_format:'1.0.0-draft.12',result:fixture.result,cleanup_pending:true,cleanup_keys:[asset],staging_keys:keys};let before=structuredClone(row),loseCommit=false,active=true;
 const query=vi.fn(async(sql:string)=>{
  if(sql==='BEGIN')before=structuredClone(row);
  if(sql==='ROLLBACK')Object.assign(row,before);
  if(sql==='COMMIT'&&loseCommit){loseCommit=false;throw Error('lost commit response');}
  if(sql.includes('SELECT m.role FROM auth_sessions'))return {rows:active?[{role:'artist'}]:[],rowCount:active?1:0};
  if(sql.includes('pg_control_system()'))return {rows:[{system_id:'1',database_oid:'2'}],rowCount:1};
  if(sql.startsWith('SELECT * FROM oex_import_jobs'))return {rows:[structuredClone(row)],rowCount:1};
  if(sql.startsWith('UPDATE oex_import_jobs')){const changed=row.cleanup_pending;row.cleanup_pending=false;return {rows:changed?[{id:row.id}]:[],rowCount:changed?1:0};}
  return {rows:[],rowCount:0};
 });
 const client={query,release:vi.fn()},pool={connect:async()=>client} as unknown as Pool,diskOwner=await publicationDiskOwner(client as never,root);
 const journal=Object.create(PublicationAttempts.prototype) as PublicationAttempts,provider=Object.create(PublicationDiskBudget.prototype) as PublicationDiskBudget;
 const verifyCommitted=vi.spyOn(committed,'verifyWorkspaceOexCommitted').mockResolvedValue(undefined),verifyLocked=vi.spyOn(committed,'verifyWorkspaceOexCommittedOnClient').mockResolvedValue(undefined),assertRecovery=vi.fn(async()=>{}),owner={workspaceId:scope.workspaceId,tenantId:scope.tenantId,principalId:scope.principalId,assertDatabase:vi.fn(async()=>{}),assertImportCatalog:vi.fn(async()=>{}),assertRecord:vi.fn(async()=>{})};
 const retirement=vi.spyOn(journal,'verifySelectedWorkspaceOexFinalization').mockImplementation(async(_provider,input)=>{await input.assertRecovery();await input.verifyCommitted({proofBytes:Buffer.from(input.proofBytes),resultBytes:Buffer.from(input.resultBytes),proofSha256:'a'.repeat(64),resultSha256:fixture.proof.resultSha256,claimSha256:'b'.repeat(64),save:input.save});});
 const input={pool,blobs,journal,provider,session:{id:'10000000-0000-4000-8000-000000000001',tenantId:scope.tenantId,userId:scope.principalId,role:'artist'} as Session,owner,diskOwner,scope,proofBytes:Buffer.from(fixture.proofUtf8),resultBytes:Buffer.from(fixture.resultUtf8),save:{exhibitionId:fixture.result.exhibitionId,etag:fixture.saved.etag,requestId:'10000000-0000-4000-8000-000000000002'},assertRecovery};
 return {input,row,keys,asset,blobs,query,client,retirement,verifyCommitted,verifyLocked,setActive:(value:boolean)=>{active=value;},loseCommit:()=>{loseCommit=true;}};
}
it('durably removes only exact upload chunks, preserves receipt/assets and releases quota eligibility; replay revalidates',async()=>{
 const f=await setup(),before=structuredClone(f.row);expect(await settleBoundedWorkspaceOexCleanup(f.input)).toEqual({id:f.row.id,state:'complete',cleanupPending:false,stagingChunks:2});
 expect(await f.blobs.listAll()).toEqual([f.asset]);expect(await f.blobs.get(f.asset)).toEqual(Buffer.from('committed source and artwork'));
 expect(f.row).toEqual({...before,cleanup_pending:false});expect(f.query.mock.calls.filter(([sql])=>sql.startsWith('UPDATE')).map(([sql])=>sql)).toEqual(['UPDATE oex_import_jobs SET cleanup_pending=false,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND cleanup_pending RETURNING id']);
 expect(f.retirement).toHaveBeenCalledTimes(2);expect(f.verifyCommitted).toHaveBeenCalledTimes(1);expect(f.verifyLocked).toHaveBeenCalledTimes(1);expect(f.verifyLocked.mock.calls[0]![0]).toBe(f.client);
 await settleBoundedWorkspaceOexCleanup(f.input);expect(f.retirement).toHaveBeenCalledTimes(4);expect(f.row.cleanup_keys).toEqual([f.asset]);
});
it('retains pending state after a partial delete and retries absent chunks without touching committed bytes',async()=>{
 const f=await setup(),remove=f.blobs.removeDurable.bind(f.blobs);let fail=true;vi.spyOn(f.blobs,'removeDurable').mockImplementation(async key=>{if(key===f.keys[1]&&fail)throw Error('disk sync unavailable');await remove(key);});
 await expect(settleBoundedWorkspaceOexCleanup(f.input)).rejects.toThrow('disk sync unavailable');expect(f.row.cleanup_pending).toBe(true);expect(await f.blobs.listAll()).toEqual([f.asset,f.keys[1]]);fail=false;
 await settleBoundedWorkspaceOexCleanup(f.input);expect(f.row.cleanup_pending).toBe(false);expect(await f.blobs.listAll()).toEqual([f.asset]);
});
it('leaves pending evidence if authority is lost after deletion and settles with freshly valid owner proof',async()=>{
 const f=await setup();f.retirement.mockImplementationOnce(async()=>{}).mockRejectedValueOnce(Error('owner lost'));
 await expect(settleBoundedWorkspaceOexCleanup(f.input)).rejects.toThrow('owner lost');expect(f.row.cleanup_pending).toBe(true);expect(await f.blobs.listAll()).toEqual([f.asset]);
 await settleBoundedWorkspaceOexCleanup(f.input);expect(f.row.cleanup_pending).toBe(false);
});
it('replays after an uncertain database commit without repeating import or asset writes',async()=>{
 const f=await setup();f.loseCommit();await expect(settleBoundedWorkspaceOexCleanup(f.input)).rejects.toThrow('lost commit response');expect(await f.blobs.listAll()).toEqual([f.asset]);
 await settleBoundedWorkspaceOexCleanup(f.input);expect(f.row.cleanup_pending).toBe(false);expect(f.row.result).toEqual(fixture.result);
});
it.each(['owner','proof','retirement','committed','result','staging','disk'] as const)('refuses %s mismatch before deleting chunks',async kind=>{
 const f=await setup();
 if(kind==='owner')f.input.owner.principalId='10000000-0000-4000-8000-000000000099';
 if(kind==='proof')f.input.proofBytes=Buffer.from('untrusted');
 if(kind==='retirement')f.retirement.mockRejectedValue(Error('anchor still active'));
 if(kind==='committed')f.verifyCommitted.mockRejectedValue(Error('committed proof mismatch'));
 if(kind==='result')f.row.result={...fixture.result,exhibitionId:'10000000-0000-4000-8000-000000000099'};
 if(kind==='staging')f.row.staging_keys=[f.asset];
 if(kind==='disk')f.input.diskOwner.databaseOid='foreign';
 const before=await f.blobs.listAll();await expect(settleBoundedWorkspaceOexCleanup(f.input)).rejects.toThrow();expect(await f.blobs.listAll()).toEqual(before);expect(f.row.cleanup_pending).toBe(true);
});

it('refuses a session revoked after preliminary proof verification before the first unlink',async()=>{
 const f=await setup(),before=await f.blobs.listAll();f.verifyCommitted.mockImplementationOnce(async()=>{f.setActive(false);});
 const remove=vi.spyOn(f.blobs,'removeDurable');await expect(settleBoundedWorkspaceOexCleanup(f.input)).rejects.toThrow('OEX_TERMINAL_COMMITTED_INVALID');
 expect(remove).not.toHaveBeenCalled();expect(await f.blobs.listAll()).toEqual(before);expect(f.row.cleanup_pending).toBe(true);
});
it('rechecks expiry under the same locked client before each subsequent unlink',async()=>{
 const f=await setup(),remove=f.blobs.removeDurable.bind(f.blobs);vi.spyOn(f.blobs,'removeDurable').mockImplementation(async key=>{await remove(key);f.setActive(false);});
 await expect(settleBoundedWorkspaceOexCleanup(f.input)).rejects.toThrow('OEX_TERMINAL_COMMITTED_INVALID');expect(await f.blobs.listAll()).toEqual([f.asset,f.keys[1]]);expect(f.row.cleanup_pending).toBe(true);
 const queries=f.query.mock.calls.map(([sql])=>sql);expect(queries.some(sql=>sql.includes('FOR SHARE OF a,u,m,t'))).toBe(true);expect(f.verifyLocked).not.toHaveBeenCalled();
});
