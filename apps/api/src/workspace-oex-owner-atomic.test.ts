// SPDX-License-Identifier: AGPL-3.0-or-later
// Scope/order tests use synthetic owner and DB. Actual commit and drain require
// a selected native runtime and an isolated PostgreSQL integration run.
import {expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
import {FileBlobStore} from '@exhibitos/storage';
import {FileOperationLifecycle,type FileOperationHooks} from './file-operation-lifecycle.ts';
import {PublicationAttempts} from './publication-attempt.ts';
import {PublicationDiskBudget} from './publication-disk-budget.ts';
import {Oex} from './oex.ts';
import {WorkspaceMaterialIntakes} from './workspace-material-intakes.ts';
import {runBoundedOexOwnerOperation} from './oex-bounded-owner-operation.ts';
import * as ownerClaim from './oex-owner-claim.ts';
import * as leaseModule from './oex-bounded-lease.ts';
import * as prepareModule from './oex-bounded-owner-prepare.ts';
import * as materialModule from './workspace-material-import-attachment.ts';
import * as proofModule from './workspace-oex-terminal-storage.ts';
vi.mock('./publication-attempt.ts',async(importOriginal)=>{const actual=await importOriginal<typeof import('./publication-attempt.ts')>();return {...actual,pinPublicationFileStore:vi.fn((b)=>b),publicationDiskOwner:vi.fn(async()=>({storeRoot:'/synthetic'}))};});
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
it.each(['ok','stage-error','catalog-error','wrong-format'] as const)('calls the workspace attachment and terminal proof inside the owner transaction; failure stops the sequence (%s)',async(scenario)=>{
 const calls:string[]=[],s={id:id(1),tenantId:id(2),userId:id(3),role:'artist' as const,csrfToken:'',expiresAt:'2099-01-01T00:00:00Z'},selection={jobId:id(4),requestId:id(5),bytes:10,sha256:'a'.repeat(64)},workspaceId=id(6),blobs=new FileBlobStore('/synthetic'),pool={options:{connectionTimeoutMillis:1000}} as Pool;
 const rows=[{name:'033_workspace_material_import_provenance.sql',sha256:'f69d3dc12d7b89f1a342daef1d7bca08787667efacdfca3d214d3101b051d1dd'},{name:'034_workspace_material_terminal_proof.sql',sha256:'ebf2300ef875b635617d82369f4c7cad4cbe6d8fa43677bdbd2e5e21dd74da21'}];
 const context={workspaceId,tenantId:s.tenantId,principalId:s.userId,workspaceMaterials:true,assertCatalog:vi.fn(async()=>{}),assertImportCatalog:vi.fn(async(c:PoolClient)=>{const result=await c.query('SELECT name,sha256 FROM schema_migrations ORDER BY name');if(JSON.stringify(result.rows)!==JSON.stringify(rows))throw Error('OEX_WORKSPACE_CATALOG');}),assertDatabase:vi.fn(async()=>{}),assertRecord:vi.fn(async()=>{})},service=new WorkspaceMaterialIntakes(blobs,context,()=>({valid:true,errors:[]}));
 const prepared={exhibition:{extensions:{},surfaces:[]},idMap:{},workspaceMaterialStage:[{}]},bound={handle:{digest:'b'.repeat(64)}};
 vi.spyOn(ownerClaim,'bindOexOwnerClaim').mockResolvedValue(bound as never);vi.spyOn(leaseModule,'claimBoundedOexLease').mockResolvedValue({jobId:selection.jobId,requestId:selection.requestId,userId:s.userId,leaseId:id(7),archiveBytes:10,archiveSha256:selection.sha256} as never);vi.spyOn(prepareModule,'prepareBoundedOexFromOwner').mockResolvedValue(prepared as never);
 vi.spyOn(materialModule,'attachWorkspaceMaterialImportVersions').mockImplementation(async()=>{calls.push('versions');if(scenario==='stage-error')throw Error('stage unavailable');});vi.spyOn(proofModule,'storeWorkspaceOexTerminalProof').mockImplementation(async()=>{calls.push('proof');return {} as never;});
 const query=vi.fn(async(sql:string)=>({rows:sql.includes('schema_migrations')?(scenario==='catalog-error'?rows.slice(0,1):rows):[],rowCount:1})),client={query} as unknown as PoolClient;
 const lifecycle=Object.create(FileOperationLifecycle.prototype) as FileOperationLifecycle;vi.spyOn(lifecycle,'ownsPool').mockReturnValue(false);vi.spyOn(lifecycle,'runOperation').mockImplementation(async(identity,hooks,signal)=>{const h=hooks as FileOperationHooks<unknown,unknown>;await h.claimPersistent(identity,signal);await h.claim(client,identity);const value=await h.prepare(identity,signal);await h.confirmDrained(identity);return await h.finalize(client,identity,value) as never;});
 const oex=Object.assign(Object.create(Oex.prototype),{pool,blobs}) as Oex;vi.spyOn(oex,'attachPrepared').mockImplementation(async()=>{calls.push('studio-and-job');return {exhibitionId:id(8)} as never;});const journal=Object.create(PublicationAttempts.prototype) as PublicationAttempts,provider=Object.create(PublicationDiskBudget.prototype) as PublicationDiskBudget;
 const request={operation:'oex-import',purpose:'import',tenantId:s.tenantId,resourceId:workspaceId,attemptId:id(9),generation:id(10),runtimeGeneration:id(11),userId:s.userId,requestId:selection.requestId,sourceDigest:selection.sha256,owner:{storeRoot:blobs.root},plan:[{root:`/native-oex-stage-${id(11)}`,bytes:10}]} as Parameters<typeof runBoundedOexOwnerOperation>[0]['request'];
 const promise=runBoundedOexOwnerOperation({lifecycle,pool,blobs,oex,journal,provider,session:s,workspaceId,selection:{...selection,...(scenario==='wrong-format'?{}:{archiveFormat:'1.0.0-draft.12' as never})},request,rawOpen:new Uint8Array(),secret:new Uint8Array(32),workerDigest:'c'.repeat(64),channel:{send:async()=>{},receive:async()=>new Uint8Array(),close:async()=>{}},verifyOwner:async()=>{},afterCommit:async()=>{},prepareSettlement:async()=>{},settlementOutcome:()=>({exhibitionId:id(8),etag:'',requestId:id(12)}),signal:new AbortController().signal,nativeOexWorkspace:context,selectedWorkspaceMaterial:service,variant:'v3',verifyNodeDrain:async()=>{}});
 try{if(scenario==='stage-error'){await expect(promise).rejects.toThrow('stage unavailable');expect(calls).toEqual(['versions']);}else if(scenario==='catalog-error'){await expect(promise).rejects.toThrow('OEX_WORKSPACE_CATALOG');expect(calls).toEqual([]);}else if(scenario==='wrong-format'){await expect(promise).rejects.toThrow('OEX_OWNER_OPERATION');expect(calls).toEqual([]);}else{await promise;expect(calls).toEqual(['versions','studio-and-job','proof']);}expect(context.assertImportCatalog).toHaveBeenCalledTimes(scenario==='wrong-format'?0:1);}finally{vi.restoreAllMocks();}
});
