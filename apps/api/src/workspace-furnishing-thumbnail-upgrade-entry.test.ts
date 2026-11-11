// SPDX-License-Identifier: AGPL-3.0-or-later
// Orchestration only: real SQL helper/auth are separately tested with issued
// temp leases; these mocks prove the early process branch never starts services.
import {beforeEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({events:[] as string[],failDrain:false,failCommit:false,open:true,seen:undefined as unknown}));
vi.mock('pg',()=>({Pool:class{on(){}async end(){f.events.push('POOL_END');}}}));
vi.mock('node:http',()=>({createServer:()=>{throw Error('UNEXPECTED_HTTP_SERVER');},request:()=>{throw Error('UNEXPECTED_HTTP_REQUEST');}}));
vi.mock('../../../packages/storage/dist/index.js',()=>({transaction:async(_pool:unknown,work:(c:unknown)=>Promise<unknown>)=>{f.events.push('BEGIN');const result=await work({});f.events.push('COMMIT');if(f.failCommit)throw Error('commit outcome unknown');return result;},migrate:()=>{throw Error('UNEXPECTED_MIGRATION');},migrateInTransaction:()=>{throw Error('UNEXPECTED_MIGRATION');},FileBlobStore:class{constructor(){throw Error('UNEXPECTED_BLOB_STORE');}}}));
vi.mock('./local-workspace.ts',()=>({validateLocalWorkspace:()=>{},openLocalWorkspace:()=>{throw Error('UNEXPECTED_WORKSPACE_SESSION');}}));
vi.mock('./auth.ts',()=>({Auth:class{},bootstrap:()=>{throw Error('UNEXPECTED_BOOTSTRAP');},config:()=>{throw Error('UNEXPECTED_API_CONFIG');}}));
vi.mock('./app.ts',()=>({buildApp:()=>{throw Error('UNEXPECTED_API');}}));
vi.mock('./model-preparation-import.ts',()=>({createNativeModelPreparationExecution:()=>{throw Error('UNEXPECTED_WORKER');}}));
vi.mock('./native-oex-cleanup.ts',()=>({parseNativeOexCleanupSelection:()=>undefined,attemptNativeOexCleanup:()=>{throw Error('UNEXPECTED_CLEANUP');}}));
vi.mock('./native-model-adoption-owner.ts',()=>({runNativeModelAdoptionOwner:()=>{throw Error('UNEXPECTED_ADOPTION');}}));
vi.mock('./native-hayes-caller.ts',()=>({createNativeHayesCaller:()=>{throw Error('UNEXPECTED_HAYES');}}));
vi.mock('./native-detail-context.ts',()=>({bindNativeDetailContext:()=>{throw Error('UNEXPECTED_DETAIL');}}));
vi.mock('./native-oex-payload.ts',()=>({pinNativeOexPayloadManifest:async()=>({digest:'a'.repeat(64),hasPath:()=>false,hasRegular:()=>true,hasExact:()=>true,verify:async()=>{f.events.push('PAYLOAD_VERIFY');},close:async()=>{f.events.push('PAYLOAD_CLOSE');}})}));
vi.mock('./native-oex-provenance.ts',()=>({bindNativeLocalExportWorkspace:()=>{throw Error('UNEXPECTED_EXPORT');},bindNativeOexWorkspace:async(_c:unknown,input:unknown)=>{f.seen=input;f.events.push('PROVENANCE');}}));
vi.mock('./cms.ts',()=>({Cms:class{constructor(){throw Error('UNEXPECTED_CMS');}}}));
vi.mock('./studio.ts',()=>({Studio:class{constructor(){throw Error('UNEXPECTED_STUDIO');}}}));
vi.mock('./imports.ts',()=>({Imports:class{constructor(){throw Error('UNEXPECTED_IMPORTS');}}}));
vi.mock('./freeze.ts',()=>({loadFreezeConfig:()=>{throw Error('UNEXPECTED_SIGNING');}}));
vi.mock('./workspace-material-intakes.ts',()=>({WorkspaceMaterialIntakes:class{constructor(){throw Error('UNEXPECTED_MATERIAL');}}}));
vi.mock('./workspace-furnishing-intakes.ts',()=>({WorkspaceFurnishingIntakes:class{constructor(){throw Error('UNEXPECTED_FURNISHING');}}}));
vi.mock('../../../scripts/native-detail-capability.mjs',()=>({hasNativeDetailCapability:async()=>false,hasNativeDetailRequiredFiles:async()=>false,NATIVE_DETAIL_CAPABILITY:''}));
vi.mock('../../../scripts/native-owner-channel.mjs',()=>({closeNativeOwnerDescriptor:()=>{},unpackNativeOwnerInput:()=>{},openNativeOwnerChannel:async()=>({isOpen:()=>f.open,whenClosed:()=>new Promise(()=>{}),close:async()=>{f.events.push('OWNER_CLOSE');f.open=false;}})}));
vi.mock('../../../scripts/native-oex-normal-catalog.mjs',async importOriginal=>{const real=await importOriginal<Record<string,unknown>>();return Object.fromEntries(Object.entries(real).map(([name,value])=>[name,name.startsWith('has')?async()=>!['hasFreshImageCapability','hasLargeModelCapability','hasLargeModelRecoveryCapability','hasInfoStandPreparationCapability','hasCatalog045PreReadyCapability'].includes(name):value]));});
vi.mock('../../../scripts/native-workspace-furnishing-bootstrap.mjs',async importOriginal=>({...await importOriginal<Record<string,unknown>>(),assertWorkspaceFurnishingRuntimeAdmission:async()=>{},upgradeWorkspaceFurnishingThumbnailCatalog:async()=>{f.events.push('UPGRADE');return{state:'applied'};}}));
vi.mock('../../../scripts/native-workspace-furnishing-admission.mjs',async importOriginal=>{
 const real=await importOriginal<Record<string,unknown>>(),writer={identity:{payloadManifestSHA256:'a'.repeat(64)},assertLive:async()=>{f.events.push('LEASE');}};
 return {...real,acceptFurnishingWriterLease:async()=>{f.events.push('WRITER_ACCEPT');return writer;},acceptFurnishingOrdinaryAdmission:async()=>({writer,fields:{admissionKind:'catalog-upgrade-045-to-050',carriedRestoreProof:{restoreId:'sealed-proof'}}}),furnishingOrdinaryStopControl:()=>({wait:async()=>{f.events.push('STOP_WAIT');if(f.failDrain)throw Error('closed or unknown');},verify:async()=>{f.events.push('STOP_VERIFY');},drained:async()=>{f.events.push('DRAINED');},dispose:()=>{}})};
});
const {startLocalRuntime}=await import(new URL('../../../scripts/local-runtime.mjs',import.meta.url).href) as {startLocalRuntime:(env:Record<string,string>,workspace:unknown,owner:unknown,hayes?:unknown,probe?:unknown)=>Promise<{helperCompleted:boolean;result:Record<string,unknown>}>};
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const env={PORT:'43115',DATABASE_URL:'postgresql://unused-local-test',TENANT_ID:id(2),EXHIBITOS_AUTHORING_MODE:'personal',EXHIBITOS_RUNTIME_MODE:'native',EXHIBITOS_NATIVE_OWNER_FD:'20',EXHIBITOS_NATIVE_FURNISHING_WRITER_FD:'21'};
const workspace={format:1,workspaceId:id(1),tenantId:id(2),principalId:id(3),ownerUid:501,sessionToken:'session-secret',csrfToken:'csrf-secret'};
const owner={mode:'workspace-furnishing-045-to-050-upgrade-v1',runtimeGeneration:id(4),secret:'b'.repeat(64)};
beforeEach(()=>{f.events.length=0;f.failDrain=false;f.failCommit=false;f.open=true;f.seen=undefined;});
it('returns a bounded result only afterCOMMIT, queuedstop and complete pool/payload/owner drain, before any service or session construction',async()=>{
 const runtime=await startLocalRuntime(env,workspace,owner);expect(runtime.helperCompleted).toBe(true);expect(runtime.result).toMatchObject({mode:owner.mode,state:'applied',catalogRows:46,payloadManifestSha256:'a'.repeat(64),drained:true});
 expect(f.events.indexOf('COMMIT')).toBeLessThan(f.events.indexOf('STOP_WAIT'));expect(f.events.indexOf('PROVENANCE')).toBeLessThan(f.events.indexOf('COMMIT'));expect(f.events.indexOf('POOL_END')).toBeLessThan(f.events.indexOf('DRAINED'));expect(f.events.indexOf('PAYLOAD_CLOSE')).toBeLessThan(f.events.indexOf('DRAINED'));expect(f.events.indexOf('DRAINED')).toBeLessThan(f.events.indexOf('OWNER_CLOSE'));
 expect(f.seen).toMatchObject({restoredProvenance:{restoreId:'sealed-proof'}});expect(JSON.stringify(runtime.result)).not.toMatch(/session-secret|csrf-secret|bbbbbbbb/);
});
it.each(['drain','commit'])('never returns a success or starts services after unknown %s outcome',async kind=>{
 f.failDrain=kind==='drain';f.failCommit=kind==='commit';await expect(startLocalRuntime(env,workspace,owner)).rejects.toThrow(kind==='drain'?'LOCAL_RUNTIME_START_FAILED_THUMBNAIL_UPGRADE_DRAIN':'LOCAL_RUNTIME_START_FAILED_THUMBNAIL_UPGRADE');
 expect(f.events).not.toContain('DRAINED');if(kind==='commit')expect(f.events).not.toContain('STOP_WAIT');expect(f.events).toContain('POOL_END');expect(f.events).toContain('OWNER_CLOSE');
});
it('rejects helper worker/probe input before opening a runtime service',async()=>{
 await expect(startLocalRuntime(env,workspace,owner,undefined,{run:()=>{}})).rejects.toThrow('LOCAL_THUMBNAIL_UPGRADE_CONFIGURATION_INVALID');expect(f.events).toEqual([]);
});
