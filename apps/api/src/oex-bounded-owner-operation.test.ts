// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {FileBlobStore} from '@exhibitos/storage';
import {FileOperationLifecycle,type FileOperationHooks} from './file-operation-lifecycle.ts';
import {PublicationAttempts} from './publication-attempt.ts';
import {PublicationDiskBudget} from './publication-disk-budget.ts';
import {Oex} from './oex.ts';
import {runBoundedOexOwnerOperation} from './oex-bounded-owner-operation.ts';
import type {NativeOexFileFormat} from './oex-file-format.ts';

vi.mock('./publication-attempt.ts',async(importOriginal)=>{const actual=await importOriginal<typeof import('./publication-attempt.ts')>();return {...actual,pinPublicationFileStore:vi.fn(),publicationDiskOwner:vi.fn(async()=>({storeRoot:'/synthetic'}))};});
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const session={id:id(1),tenantId:id(2),userId:id(3),role:'artist' as const,csrfToken:'synthetic',expiresAt:'2099-01-01T00:00:00Z'};
const selection={jobId:id(4),requestId:id(5),bytes:12,sha256:'a'.repeat(64)};

async function attempt(selected:NativeOexFileFormat|undefined,stored:NativeOexFileFormat){
 let probe='';const row={state:'queued',archive_profile:'bounded-file-v1',oex_format:stored,request_id:selection.requestId,expected_bytes:selection.bytes,payload_sha256:selection.sha256,lease_id:null,cleanup_pending:false,cleanup_keys:[],staging_keys:[`${session.tenantId}/oex-staging/${selection.jobId}/chunk-0`]};
 const query=vi.fn(async(sql:string,args?:unknown[])=>{if(sql.includes('set_config')){probe=String(args![0]);return {rows:[]};}if(sql.includes('transaction_isolation'))return {rows:[{isolation:'read committed',probe}]};if(sql.includes('FROM auth_sessions'))return {rowCount:1,rows:[{role:'artist'}]};if(sql.startsWith('SELECT * FROM oex_import_jobs'))return {rows:[row]};if(sql.startsWith('UPDATE'))return {rowCount:1,rows:[{id:selection.jobId,lease_id:args![3]}]};throw Error('unexpected query');});
 const pool={options:{connectionTimeoutMillis:1000}} as Pool,blobs=new FileBlobStore('/synthetic');
 const lifecycle=Object.create(FileOperationLifecycle.prototype) as FileOperationLifecycle;
 vi.spyOn(lifecycle,'ownsPool').mockReturnValue(false);
 vi.spyOn(lifecycle,'runOperation').mockImplementation(async(identity,hooks)=>{await (hooks as FileOperationHooks<unknown,unknown>).claim({query} as unknown as PoolClient,identity);return undefined as never;});
 const oex=Object.assign(Object.create(Oex.prototype),{pool,blobs}) as Oex;
 const journal=Object.create(PublicationAttempts.prototype) as PublicationAttempts,provider=Object.create(PublicationDiskBudget.prototype) as PublicationDiskBudget;
 const request={operation:'oex-import',purpose:'import',resourceId:id(6),tenantId:session.tenantId,userId:session.userId,requestId:selection.requestId,sourceDigest:selection.sha256,owner:{storeRoot:blobs.root},runtimeGeneration:'generation',plan:[{root:'/native-oex-stage-generation',bytes:selection.bytes+512*1024*1024},{root:blobs.root,bytes:512*1024*1024}]} as Parameters<typeof runBoundedOexOwnerOperation>[0]['request'];
 const operation=runBoundedOexOwnerOperation({lifecycle,pool,blobs,oex,journal,provider,session,workspaceId:id(6),selection:{...selection,...(selected?{archiveFormat:selected}:{})},request,rawOpen:new Uint8Array(),secret:new Uint8Array(32),workerDigest:'b'.repeat(64),channel:{send:async()=>{},receive:async()=>new Uint8Array(),close:async()=>{}},verifyOwner:async()=>{},afterCommit:async()=>{},prepareSettlement:async()=>{},settlementOutcome:()=>({exhibitionId:id(7),etag:'',requestId:selection.requestId}),signal:new AbortController().signal});
 return {operation,query};
}
it.each([[undefined,'1.0.0-draft.9'],['1.0.0-draft.9','1.0.0-draft.9'],['1.0.0-draft.10','1.0.0-draft.10']] as const)('claims through the operation with selected %s and stored %s',async(selected,stored)=>{const f=await attempt(selected,stored);await expect(f.operation).resolves.toBeUndefined();expect(f.query.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(true);});
it.each([['1.0.0-draft.9','1.0.0-draft.10'],['1.0.0-draft.10','1.0.0-draft.9'],[undefined,'1.0.0-draft.10']] as const)('rejects through the operation when selected %s differs from stored %s',async(selected,stored)=>{const f=await attempt(selected,stored);await expect(f.operation).rejects.toThrow('OEX_JOB_INVALID');expect(f.query.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);});
