// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,realpath,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Pool} from 'pg';
import {FileBlobStore} from '@exhibitos/storage';
import {Auth} from './auth.ts';
import {PublicationAttempts} from './publication-attempt.ts';
import {PublicationDiskBudget} from './publication-disk-budget.ts';
import * as settlement from './oex-bounded-settlement.ts';
import {parseNativeOexCleanupSelection,runNativeOexCleanup,attemptNativeOexCleanup} from './native-oex-cleanup.ts';
import type {NativeOexWorkspaceContext} from './native-oex-provenance.ts';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const roots:string[]=[];afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
it('accepts only the optional two-ID selector, never paths, credentials or malformed IDs',()=>{
 expect(parseNativeOexCleanupSelection(undefined)).toBeUndefined();expect(parseNativeOexCleanupSelection(JSON.stringify({jobId:id(1),importRuntimeGeneration:id(2)}))).toEqual({jobId:id(1),importRuntimeGeneration:id(2)});
 for(const value of ['',null,'[]','{}',JSON.stringify({jobId:id(1),importRuntimeGeneration:'../other'}),JSON.stringify({jobId:id(1),importRuntimeGeneration:id(2),root:'/foreign'}),JSON.stringify({jobId:123,importRuntimeGeneration:id(2)})])expect(()=>parseNativeOexCleanupSelection(value)).toThrow();
});
async function setup(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'native-oex-cleanup-')));roots.push(root);await mkdir(join(root,'blobs'),{mode:0o700});const blobs=new FileBlobStore(join(root,'blobs')),selection={jobId:id(4),importRuntimeGeneration:id(5)},attemptId=id(6);
 const journal=join(root,'native-oex-journal-'+id(5)),budget=join(root,'native-oex-budget-'+id(5));await mkdir(journal,{mode:0o700});await mkdir(budget,{mode:0o700});
 const put=(p:string,v:unknown)=>writeFile(p,JSON.stringify(v),{mode:0o600});for(const p of [join(journal,'journal-protocol.json'),join(journal,'claim-provider.json'),join(budget,'protocol.json')])await put(p,{});
 const claim={runtimeGeneration:id(5),attemptId,resourceId:id(1),tenantId:id(2),userId:id(3)};await put(join(journal,attemptId+'.claim.json'),claim);await put(join(journal,attemptId+'.settlement-terminal-v3.json'),{save:{exhibitionId:id(8),etag:'"studio-r2-'+('a'.repeat(64))+'"',requestId:id(9)}});
 const context={workspaceId:id(1),tenantId:id(2),principalId:id(3),workspaceImport:true,matchesBlobRoot:(path:string)=>path===blobs.root,assertDatabase:vi.fn(async()=>{}),assertImportCatalog:vi.fn(async()=>{}),assertRecord:vi.fn(async()=>{})} as unknown as NativeOexWorkspaceContext;
 const row={attempt_id:attemptId,import_request_id:id(7),source_archive_sha256:'a'.repeat(64),proof_bytes:Buffer.from('typed proof input'),result_bytes:Buffer.from('typed result input')};
 const query=vi.fn(async(sql:string)=>({rowCount:1,rows:sql.includes('pg_control_system()')?[{system_id:'1',database_oid:'2'}]:[row]}));
 const session={id:id(10),tenantId:id(2),userId:id(3),role:'admin'};
 const auth=vi.spyOn(Auth.prototype,'requestForNativeWorkspaceMutation').mockImplementation(async(token,tenant,csrf,work)=>{if(token!=='current-token'||csrf!=='current-csrf'||tenant!==id(2))throw Error('AUTH_REQUIRED');return work({query} as never,session as never);});
 vi.spyOn(PublicationAttempts.prototype,'claimJournalIdentity').mockResolvedValue({} as never);const provider=vi.spyOn(PublicationDiskBudget,'open').mockResolvedValue(Object.create(PublicationDiskBudget.prototype));
 const settle=vi.spyOn(settlement,'settleBoundedWorkspaceOexCleanup').mockResolvedValue({id:id(4),state:'complete',cleanupPending:false,stagingChunks:2});
 const input={pool:{} as Pool,blobs,context,selection,sessionToken:'current-token',csrfToken:'current-csrf',assertRecovery:vi.fn(async()=>{})};return {root,journal,budget,attemptId,claim,put,input,settle,query,auth,provider};
}
it('resolves one authenticated current-owner job and its exact original generation; uses the shared guarded settlement',async()=>{
 const f=await setup(),result=await runNativeOexCleanup(f.input);expect(result).toEqual({version:1,jobId:id(4),importRuntimeGeneration:id(5),state:'complete',cleanupPending:false,stagingChunks:2});
 expect(f.auth).toHaveBeenCalledOnce();expect(f.query.mock.calls[0]![0]).toContain('t.import_job_id=$4');expect(f.settle).toHaveBeenCalledOnce();
 const call=f.settle.mock.calls[0]![0];expect(call.scope.jobId).toBe(id(4));expect(call.scope.attemptId).toBe(id(6));expect(call.scope.workspaceId).toBe(id(1));expect(call.session.userId).toBe(id(3));expect(call.assertRecovery).toBe(f.input.assertRecovery);expect(f.input.assertRecovery).toHaveBeenCalledTimes(3);
});
it.each(['wrong-generation','missing-journal','wrong-owner','auth','live-owner'] as const)('refuses %s before any cleanup or missing-evidence initialization',async kind=>{
 const f=await setup();
 if(kind==='wrong-generation')await f.put(join(f.journal,f.attemptId+'.claim.json'),{...f.claim,runtimeGeneration:id(99)});
 if(kind==='missing-journal')await rm(join(f.budget,'protocol.json'));
 if(kind==='wrong-owner')await f.put(join(f.journal,f.attemptId+'.claim.json'),{...f.claim,userId:id(99)});
 if(kind==='auth')f.input.sessionToken='foreign';
 if(kind==='live-owner')f.input.assertRecovery.mockRejectedValue(Error('writer lost'));
 await expect(runNativeOexCleanup(f.input)).rejects.toThrow();expect(f.settle).not.toHaveBeenCalled();expect(f.provider).not.toHaveBeenCalled();
});

it('returns an explicit unresolved result for ordinary owned drain, but never masks owner loss',async()=>{
 const f=await setup();f.input.sessionToken='rejected';
 await expect(attemptNativeOexCleanup(f.input)).resolves.toEqual({version:1,jobId:id(4),importRuntimeGeneration:id(5),state:'unresolved',cleanupPending:null,errorCode:'NATIVE_OEX_CLEANUP_FAILED'});
 f.input.assertRecovery.mockRejectedValue(Error('owner unavailable'));
 await expect(attemptNativeOexCleanup(f.input)).rejects.toThrow('owner unavailable');expect(f.settle).not.toHaveBeenCalled();
});
