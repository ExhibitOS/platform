// SPDX-License-Identifier: AGPL-3.0-or-later
// Real restored-row cursor verification runs through the early helper boundary.
// Mocked PG/auth and poisoned services prove ordering without a live database.
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
const f=vi.hoisted(()=>({events:[] as string[],failDrain:false,failCommit:false,gpuCapability:false,open:true,seen:undefined as unknown,proof:undefined as unknown,realProof:false,rows:[] as string[],cursorSent:false,cursorPair:undefined as unknown,missingInventoryMethod:false,waitForever:false,rejectStop:undefined as undefined|((error:Error)=>void),holdPool:false,finishPool:undefined as undefined|(()=>void),client:undefined as unknown}));
vi.mock('pg',()=>({Pool:class{on(){}async end(){f.events.push('POOL_END');if(f.holdPool)await new Promise<void>(resolve=>{f.finishPool=resolve;});}}}));
vi.mock('node:http',()=>({createServer:()=>{throw Error('UNEXPECTED_HTTP_SERVER');},request:()=>{throw Error('UNEXPECTED_HTTP_REQUEST');}}));
vi.mock('../../../packages/storage/dist/index.js',()=>({transaction:async(_pool:unknown,work:(c:unknown)=>Promise<unknown>)=>{f.events.push('BEGIN');try{const result=await work(f.client??{});f.events.push('COMMIT');if(f.failCommit)throw Error('commit outcome unknown');return result;}catch(error){f.events.push('ROLLBACK');throw error;}},migrate:()=>{throw Error('UNEXPECTED_MIGRATION');},migrateInTransaction:()=>{throw Error('UNEXPECTED_MIGRATION');},FileBlobStore:class{constructor(){throw Error('UNEXPECTED_BLOB_STORE');}}}));
vi.mock('./local-workspace.ts',()=>({validateLocalWorkspace:()=>{},openLocalWorkspace:()=>{throw Error('UNEXPECTED_WORKSPACE_SESSION');}}));
vi.mock('./auth.ts',async importOriginal=>({...await importOriginal<typeof import('./auth.ts')>(),Auth:class{},bootstrap:()=>{throw Error('UNEXPECTED_BOOTSTRAP');},config:()=>{throw Error('UNEXPECTED_API_CONFIG');}}));
vi.mock('./app.ts',()=>({buildApp:()=>{throw Error('UNEXPECTED_API');}}));
vi.mock('./model-preparation-import.ts',()=>({createNativeModelPreparationExecution:()=>{throw Error('UNEXPECTED_WORKER');}}));
vi.mock('./native-oex-cleanup.ts',()=>({parseNativeOexCleanupSelection:()=>undefined,attemptNativeOexCleanup:()=>{throw Error('UNEXPECTED_CLEANUP');}}));
vi.mock('./native-model-adoption-owner.ts',()=>({runNativeModelAdoptionOwner:()=>{throw Error('UNEXPECTED_ADOPTION');}}));
vi.mock('./native-hayes-caller.ts',()=>({createNativeHayesCaller:()=>{throw Error('UNEXPECTED_HAYES');}}));
vi.mock('./native-detail-context.ts',()=>({bindNativeDetailContext:()=>{throw Error('UNEXPECTED_DETAIL');}}));
vi.mock('./native-oex-payload.ts',()=>({pinNativeOexPayloadManifest:async()=>({digest:'a'.repeat(64),hasPath:()=>false,hasRegular:()=>true,hasExact:()=>true,verify:async()=>{f.events.push('PAYLOAD_VERIFY');},close:async()=>{f.events.push('PAYLOAD_CLOSE');}})}));
vi.mock('./publication-attempt.ts',async importOriginal=>({...await importOriginal<typeof import('./publication-attempt.ts')>(),publicationDiskOwner:async()=>({databaseSystemId:'42',databaseOid:'16384',storeRoot:'/data/blobs',storeDevice:'1',storeInode:'2'})}));
vi.mock('./native-oex-provenance.ts',async importOriginal=>{const real=await importOriginal<typeof import('./native-oex-provenance.ts')>();return{...real,bindNativeLocalExportWorkspace:()=>{throw Error('UNEXPECTED_EXPORT');},bindNativeOexWorkspace:async(c:unknown,input:unknown)=>{f.seen=input;f.events.push('PROVENANCE');if(f.realProof)return real.bindNativeOexWorkspace(c as Parameters<typeof real.bindNativeOexWorkspace>[0],input as Parameters<typeof real.bindNativeOexWorkspace>[1]);return f.missingInventoryMethod?{}:{assertRestoredInventory:async()=>{f.events.push('INVENTORY');}};}};});
vi.mock('./cms.ts',()=>({Cms:class{constructor(){throw Error('UNEXPECTED_CMS');}}}));
vi.mock('./studio.ts',()=>({Studio:class{constructor(){throw Error('UNEXPECTED_STUDIO');}}}));
vi.mock('./imports.ts',()=>({Imports:class{constructor(){throw Error('UNEXPECTED_IMPORTS');}}}));
vi.mock('./freeze.ts',()=>({loadFreezeConfig:()=>{throw Error('UNEXPECTED_SIGNING');}}));
vi.mock('./workspace-material-intakes.ts',()=>({WorkspaceMaterialIntakes:class{constructor(){throw Error('UNEXPECTED_MATERIAL');}}}));
vi.mock('./workspace-furnishing-intakes.ts',()=>({WorkspaceFurnishingIntakes:class{constructor(){throw Error('UNEXPECTED_FURNISHING');}}}));
vi.mock('../../../scripts/native-detail-capability.mjs',()=>({hasNativeDetailCapability:async()=>false,hasNativeDetailRequiredFiles:async()=>false,NATIVE_DETAIL_CAPABILITY:''}));
vi.mock('../../../scripts/native-owner-channel.mjs',()=>({closeNativeOwnerDescriptor:()=>{},unpackNativeOwnerInput:()=>{},openNativeOwnerChannel:async()=>({isOpen:()=>f.open,whenClosed:()=>new Promise(()=>{}),close:async()=>{f.events.push('OWNER_CLOSE');f.open=false;f.rejectStop?.(Error('owner closed'));}})}));
vi.mock('../../../scripts/native-oex-normal-catalog.mjs',async importOriginal=>{
 const real=await importOriginal<Record<string,unknown>>();
 // This fixture selects the closed parent45+050 family. New optional markers
 // must remain absent unless a test explicitly introduces a mixed family.
 const selected=new Set(['hasWorkspaceFurnishingThumbnailCapability', 'hasWorkspaceWallImportCapability', 'hasWorkspaceFurnishingCapability', 'hasWorkspaceFurnishingWriterCapability', 'hasWorkspaceFurnishingPublicationCapability', 'hasWorkspaceMaterialPublicationCapability', 'hasWorkspaceFurnishingArtworkFrameCapability', 'hasWorkspaceFurnishingArtworkFrameModelsCapability', 'hasWorkspacePortalFinishCapability', 'hasWorkspaceFurnishingRoomVisualCapability', 'hasWorkspaceFurnishingStoolCapability', 'hasWorkspaceMaterialMultimapCapability', 'hasWorkspaceFramePreparationCapability', 'hasHayesReleaseCapability', 'hasModelPreparationCapability', 'hasHayesDispositionCapability', 'hasHayesOriginalCapability', 'hasWorkspaceMaterialCapability', 'hasWorkspaceImportCapability']);
 return Object.fromEntries(Object.entries(real).map(([name,value])=>[name,name.startsWith('has')?async()=>name==='hasGpuModelPreparationCapability'?f.gpuCapability:selected.has(name):value]));
});
vi.mock('../../../scripts/native-workspace-furnishing-bootstrap.mjs',async importOriginal=>({...await importOriginal<Record<string,unknown>>(),assertWorkspaceFurnishingRuntimeAdmission:async()=>{},upgradeWorkspaceFurnishingThumbnailCatalog:async()=>{f.events.push('UPGRADE');return{state:'applied'};}}));
vi.mock('../../../scripts/native-workspace-furnishing-admission.mjs',async importOriginal=>{
 const real=await importOriginal<Record<string,unknown>>(),writer={identity:{payloadManifestSHA256:'a'.repeat(64)},assertLive:async()=>{f.events.push('LEASE');}};
 return {...real,acceptFurnishingWriterLease:async()=>{f.events.push('WRITER_ACCEPT');return writer;},acceptFurnishingOrdinaryAdmission:async()=>({writer,fields:{admissionKind:'catalog-upgrade-045-to-050',carriedRestoreProof:f.realProof?f.proof:{restoreId:'sealed-proof'}}}),furnishingOrdinaryStopControl:()=>({wait:async()=>{f.events.push('STOP_WAIT');if(f.failDrain)throw Error('closed or unknown');if(f.waitForever)await new Promise<void>((_resolve,reject)=>{f.rejectStop=reject;});},verify:async()=>{f.events.push('STOP_VERIFY');},drained:async()=>{f.events.push('DRAINED');},dispose:()=>{}})};
});
const {startLocalRuntime}=await import(new URL('../../../scripts/local-runtime.mjs',import.meta.url).href) as {startLocalRuntime:(env:Record<string,string>,workspace:unknown,owner:unknown,hayes?:unknown,probe?:unknown)=>Promise<{helperCompleted:boolean;result:Record<string,unknown>}>};
afterEach(()=>{vi.useRealTimers();});
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const env={PORT:'43115',DATABASE_URL:'postgresql://unused-local-test',TENANT_ID:id(2),EXHIBITOS_AUTHORING_MODE:'personal',EXHIBITOS_RUNTIME_MODE:'native',EXHIBITOS_NATIVE_OWNER_FD:'20',EXHIBITOS_NATIVE_FURNISHING_WRITER_FD:'21'};
const workspace={format:1,workspaceId:id(1),tenantId:id(2),principalId:id(3),ownerUid:process.getuid?.()??501,sessionToken:'session-secret',csrfToken:'csrf-secret'};
const owner={mode:'workspace-furnishing-045-to-050-upgrade-v1',runtimeGeneration:id(4),secret:'b'.repeat(64)};
beforeEach(()=>{f.events.length=0;f.failDrain=false;f.failCommit=false;f.gpuCapability=false;f.open=true;f.seen=undefined;f.realProof=false;f.proof=undefined;f.rows=[];f.cursorSent=false;f.cursorPair=undefined;f.missingInventoryMethod=false;f.waitForever=false;f.rejectStop=undefined;f.holdPool=false;f.finishPool=undefined;f.client=undefined;});
it('returns a bounded result only afterCOMMIT, queuedstop and complete pool/payload/owner drain, before any service or session construction',async()=>{
 const runtime=await startLocalRuntime(env,workspace,owner);expect(runtime.helperCompleted).toBe(true);expect(runtime.result).toMatchObject({mode:owner.mode,state:'applied',catalogRows:46,payloadManifestSha256:'a'.repeat(64),drained:true});
 expect(f.events.indexOf('COMMIT')).toBeLessThan(f.events.indexOf('STOP_WAIT'));expect(f.events.indexOf('PROVENANCE')).toBeLessThan(f.events.indexOf('INVENTORY'));expect(f.events.indexOf('INVENTORY')).toBeLessThan(f.events.indexOf('COMMIT'));expect(f.events.indexOf('POOL_END')).toBeLessThan(f.events.indexOf('DRAINED'));expect(f.events.indexOf('PAYLOAD_CLOSE')).toBeLessThan(f.events.indexOf('DRAINED'));expect(f.events.indexOf('DRAINED')).toBeLessThan(f.events.indexOf('OWNER_CLOSE'));
 expect(f.seen).toMatchObject({restoredProvenance:{restoreId:'sealed-proof'}});expect(JSON.stringify(runtime.result)).not.toMatch(/session-secret|csrf-secret|bbbbbbbb/);
});
it.each(['drain','commit'])('never returns a success or starts services after unknown %s outcome',async kind=>{
 f.failDrain=kind==='drain';f.failCommit=kind==='commit';await expect(startLocalRuntime(env,workspace,owner)).rejects.toThrow(kind==='drain'?'LOCAL_RUNTIME_START_FAILED_THUMBNAIL_UPGRADE_DRAIN':'LOCAL_RUNTIME_START_FAILED_THUMBNAIL_UPGRADE');
 expect(f.events).not.toContain('DRAINED');if(kind==='commit')expect(f.events).not.toContain('STOP_WAIT');expect(f.events).toContain('POOL_END');expect(f.events).toContain('OWNER_CLOSE');
});
it('rejects simultaneous049 and050 capabilities before writer admission, DDL or services',async()=>{
 f.gpuCapability=true;
 await expect(startLocalRuntime(env,workspace,owner)).rejects.toThrow('LOCAL_RUNTIME_START_FAILED_MIGRATIONS');
 expect(f.events).not.toContain('WRITER_ACCEPT');expect(f.events).not.toContain('UPGRADE');expect(f.events).not.toContain('BEGIN');expect(f.events).not.toContain('COMMIT');expect(f.events).not.toContain('DRAINED');
 expect(f.events).toContain('POOL_END');expect(f.events).toContain('OWNER_CLOSE');
});
it('rejects helper worker/probe input before opening a runtime service',async()=>{
 await expect(startLocalRuntime(env,workspace,owner,undefined,{run:()=>{}})).rejects.toThrow('LOCAL_THUMBNAIL_UPGRADE_CONFIGURATION_INVALID');expect(f.events).toEqual([]);
});

const rawProvenance=JSON.stringify({tenant_id:id(2),workspace_id:id(1),principal_id:id(3),exhibition_id:id(6),import_job_id:id(8),attempt_id:id(5),claim_sha256:'b'.repeat(64),payload_manifest_sha256:'c'.repeat(64),source_sha256:'a'.repeat(64),source_database_system_id:'12',source_database_oid:'34',archive_profile:'bounded-file-v1'});
const tableHash=(rows:string[])=>createHash('sha256').update(rows.map(row=>row+'\n').join('')).digest('hex');
const catalog=await import(new URL('../../../scripts/native-oex-normal-catalog.mjs',import.meta.url).href) as Record<string,unknown>;
const migrationPins=new Map(Object.entries(catalog).filter(([name,value])=>name.endsWith('_MIGRATION')&&typeof value==='string').map(([name,value])=>[value,catalog[name.replace(/_MIGRATION$/,'_SHA256')]]));
function realProvenanceFixture(){
 f.realProof=true;f.proof={restoreId:id(11),backupId:id(12),authenticatedManifestSha256:'e'.repeat(64),observation:{version:1,sourceHandoffSha256:'f'.repeat(64),priorRestoreProof:{restoreId:id(13),backupId:id(14),authenticatedManifestSha256:'1'.repeat(64),sourceDatabaseSystemId:'12',sourceDatabaseOid:'34',targetDatabaseSystemId:'23',targetDatabaseOid:'45',provenanceRowCount:1,provenanceTableSha256:tableHash([rawProvenance])},archiveSourceDatabaseSystemId:'23',archiveSourceDatabaseOid:'45',targetDatabaseSystemId:'42',targetDatabaseOid:'16384',provenanceRowCount:1,provenanceTableSha256:tableHash([rawProvenance])}};
 f.rows=[rawProvenance];f.client={query:async(sql:string,params:unknown[]=[])=>{
  if(sql.includes('schema_migrations'))return{rows:params.filter(name=>migrationPins.has(name)).sort().map(name=>({name,sha256:migrationPins.get(name)}))};
  if(sql.startsWith('SELECT 1 FROM local_workspaces'))return{rowCount:1,rows:[]};
  if(sql.startsWith('DECLARE ')){f.cursorSent=false;f.cursorPair=params;return{rowCount:0,rows:[]};}
  if(sql.startsWith('FETCH ')){f.events.push('INVENTORY_FETCH');if(f.cursorSent)return{rowCount:0,rows:[]};f.cursorSent=true;return{rowCount:f.rows.length,rows:f.rows.map(raw=>({raw}))};}
  if(sql.startsWith('CLOSE '))f.events.push('INVENTORY_CLOSE');return{rowCount:0,rows:[]};
 }};
}
it.each(['valid','missing','hash','excess'])('checks ACTUAL carried canonical count/hash/source-pair inventory at helper commit boundary: %s',async kind=>{
 realProvenanceFixture();if(kind==='missing')f.rows=[];if(kind==='hash')f.rows=[rawProvenance.replace('bounded-file-v1','changed-file-v1')];if(kind==='excess')f.rows=[rawProvenance,rawProvenance];
 const promise=startLocalRuntime(env,workspace,owner);if(kind==='valid'){expect((await promise).helperCompleted).toBe(true);expect(f.events.indexOf('INVENTORY_FETCH')).toBeLessThan(f.events.indexOf('COMMIT'));}else{await expect(promise).rejects.toThrow('LOCAL_RUNTIME_START_FAILED_THUMBNAIL_UPGRADE');expect(f.events).toContain('ROLLBACK');expect(f.events).not.toContain('COMMIT');expect(f.events).not.toContain('STOP_WAIT');expect(f.events).not.toContain('DRAINED');}
 expect(f.cursorPair).toEqual(['12','34']);expect(f.events).toContain('INVENTORY_CLOSE');
});
it('fails closed beforeCOMMIT if carried proof was bound without an inventory assertion method',async()=>{
 f.missingInventoryMethod=true;await expect(startLocalRuntime(env,workspace,owner)).rejects.toThrow('LOCAL_RUNTIME_START_FAILED_THUMBNAIL_UPGRADE');expect(f.events).not.toContain('COMMIT');expect(f.events).not.toContain('DRAINED');
});
it('helper-only finite stop deadline aborts its owner and waits for actual cleanup instead of returning success',async()=>{
 vi.useFakeTimers();f.waitForever=true;f.holdPool=true;let settled=false;const pending=startLocalRuntime(env,workspace,owner).then(()=>{settled=true;},error=>{settled=true;return error;});
 await vi.waitFor(()=>expect(f.events).toContain('STOP_WAIT'));await vi.advanceTimersByTimeAsync(5000);expect(f.events).toContain('COMMIT');expect(f.events).toContain('OWNER_CLOSE');expect(f.events).toContain('POOL_END');expect(settled).toBe(false);expect(f.events).not.toContain('DRAINED');
 f.finishPool!();expect((await pending).message).toBe('LOCAL_RUNTIME_START_FAILED_THUMBNAIL_UPGRADE_DRAIN');expect(settled).toBe(true);expect(f.events).not.toContain('DRAINED');
});
