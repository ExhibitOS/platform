// SPDX-License-Identifier: AGPL-3.0-or-later
import {isNativeOexFileFormat,type NativeOexFileFormat} from './oex-file-format.ts';
import type {PoolClient} from 'pg';
import {ApiError,uuid,type Session} from './auth.ts';
import {publicationDiskOwner,samePublicationDiskOwner} from './publication-attempt.ts';
import {isDeepStrictEqual} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';

/** Runtime-private context issued only after the native workspace and exact
 * supplemental catalog have been checked. HTTP fields cannot select it. */
export interface NativeOexWorkspaceContext {
 readonly workspaceId:string;
 readonly tenantId:string;
 readonly principalId:string;
 matchesBlobRoot?(root:string):boolean;
 readonly archiveFormats?:readonly NativeOexFileFormat[];
 readonly workspaceMaterials?:boolean;
 /** Inactive until an exact v6 runtime catalog issues the context. */
 readonly workspaceImport?:true;
 readonly workspaceWallImport?:true;
 readonly workspaceFurnishing?:true;
 readonly workspaceFurnishingWriter?:true;
 readonly workspaceFurnishingPublication?:true;
 readonly workspaceMaterialPublication?:true;
 readonly workspaceMaterialMultimap?:true;
 readonly workspaceFurnishingStool?:true;
 readonly workspaceFurnishingRoomVisual?:true;
 readonly workspaceFurnishingArtworkFrame?:true;
 readonly workspaceFurnishingArtworkFrameModels?:true;
 readonly workspaceArtworkFramePreparation?:true;
 readonly workspaceInfoStandPreparation?:true;
 readonly workspacePortalFinish?:true;
 assertImportCatalog?(client:PoolClient):Promise<void>;
 assertOwner?(owner:import('./publication-disk-budget.ts').DiskOwner):void;
 /** DB-only check usable inside the selected operation's fenced transaction. */
 assertCatalog(client:PoolClient):Promise<void>;
 /** Checks the live database and store against the retained native owner. */
 assertDatabase(client:PoolClient):Promise<void>;
 /** Full declared restored table proof, available only on a restore-bound context. */
 assertRestoredInventory?(client:PoolClient):Promise<void>;
 /** Checks source DB identity; immutable claim fields remain historical DB
  * evidence, not an independently verified or revived live claim. */
 assertRecord(client:PoolClient,record:Readonly<{workspaceId:string;tenantId:string;principalId:string;importJobId:string;requestId:string;attemptId:string;claimSha256:string;payloadManifestSha256:string;sourceDatabaseSystemId:string;sourceDatabaseOid:string;sourceSha256:string;exhibitionId:string}>):Promise<void>;
}
const issuedWorkspaceImports=new WeakSet<NativeOexWorkspaceContext>();
export function isIssuedNativeWorkspaceImport(context:NativeOexWorkspaceContext){return issuedWorkspaceImports.has(context);}
/** Passed only from a freshly authenticated native owner admission. This is a
 * snapshot pin, not authority to change or recreate a historical import. */
export interface NativeRestoredProvenance {
 readonly sourceDatabaseSystemId:string;readonly sourceDatabaseOid:string;
 readonly targetDatabaseSystemId:string;readonly targetDatabaseOid:string;
 readonly provenanceRowCount:number;readonly provenanceTableSha256:string;
 readonly assertLive:()=>Promise<void>;
}
export interface NativeCarriedRestoredProvenance {
 readonly restoreId:string;readonly backupId:string;readonly authenticatedManifestSha256:string;
 readonly observation:Readonly<{
  version:1;sourceHandoffSha256:string;
  priorRestoreProof:Readonly<Omit<NativeRestoredProvenance,'assertLive'>&{restoreId:string;backupId:string;authenticatedManifestSha256:string}>;
  archiveSourceDatabaseSystemId:string;archiveSourceDatabaseOid:string;
  targetDatabaseSystemId:string;targetDatabaseOid:string;
  provenanceRowCount:number;provenanceTableSha256:string;
 }>;
 readonly assertLive:()=>Promise<void>;
}
function restoreRowAuthority(proof:NativeRestoredProvenance|NativeCarriedRestoredProvenance|undefined):NativeRestoredProvenance|undefined{
 if(!proof||!('observation' in proof))return proof;
 const observation=proof.observation,prior=observation?.priorRestoreProof;
 if(!prior||observation.version!==1||!/^[a-f0-9]{64}$/.test(observation.sourceHandoffSha256)||
    proof.restoreId===prior.restoreId||proof.backupId===prior.backupId||proof.authenticatedManifestSha256===prior.authenticatedManifestSha256||
    observation.archiveSourceDatabaseSystemId!==prior.targetDatabaseSystemId||observation.archiveSourceDatabaseOid!==prior.targetDatabaseOid||
    prior.sourceDatabaseSystemId===prior.targetDatabaseSystemId||prior.targetDatabaseSystemId===observation.targetDatabaseSystemId||
    !/^[1-9][0-9]{0,19}$/.test(prior.targetDatabaseSystemId)||!/^[1-9][0-9]{0,9}$/.test(prior.targetDatabaseOid)||
    prior.provenanceRowCount<1||prior.provenanceRowCount!==observation.provenanceRowCount||
    prior.provenanceTableSha256!==observation.provenanceTableSha256)throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');
 return Object.freeze({sourceDatabaseSystemId:prior.sourceDatabaseSystemId,sourceDatabaseOid:prior.sourceDatabaseOid,
  targetDatabaseSystemId:observation.targetDatabaseSystemId,targetDatabaseOid:observation.targetDatabaseOid,
  provenanceRowCount:observation.provenanceRowCount,provenanceTableSha256:observation.provenanceTableSha256,assertLive:proof.assertLive});
}
export function assertIssuedWorkspaceImport(context:NativeOexWorkspaceContext,owner:import('./publication-disk-budget.ts').DiskOwner){
 if(!issuedWorkspaceImports.has(context)||!context.assertOwner)throw new ApiError(403,'FORBIDDEN');
 context.assertOwner(owner);
}

/** Issued by native bootstrap after validating FD0 workspace, catalog and
 * local owner; not an HTTP option. The frozen DB/store snapshot is rechecked
 * on every use. Prior claims are evidence only, not revived live authority. */
export async function bindNativeOexWorkspace(c:PoolClient,input:{workspaceId:string;tenantId:string;principalId:string;ownerUid:number;blobRoot:string;restoredProvenance?:NativeRestoredProvenance|NativeCarriedRestoredProvenance;workspaceImport?:true;workspaceWallImport?:true;workspaceFurnishing?:true;workspaceFurnishingWriter?:true;workspaceFurnishingPublication?:true;workspaceMaterialPublication?:true;workspaceMaterialMultimap?:true;workspaceFurnishingStool?:true;workspaceFurnishingRoomVisual?:true;workspaceFurnishingArtworkFrame?:true;workspaceFurnishingArtworkFrameModels?:true;workspaceArtworkFramePreparation?:true;workspaceInfoStandPreparation?:true;workspacePortalFinish?:true}):Promise<NativeOexWorkspaceContext>{
 const {workspaceId,tenantId,principalId,ownerUid,blobRoot}=input;if(input.workspaceImport!==undefined&&input.workspaceImport!==true)throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');const wantsWorkspaceImport=input.workspaceImport===true,wantsWall=input.workspaceWallImport===true,wantsFurnishing=input.workspaceFurnishing===true,wantsWriter=input.workspaceFurnishingWriter===true,wantsPublication=input.workspaceFurnishingPublication===true,wantsMaterialPublication=input.workspaceMaterialPublication===true,wantsMultimap=input.workspaceMaterialMultimap===true,wantsStool=input.workspaceFurnishingStool===true,wantsRoomVisual=input.workspaceFurnishingRoomVisual===true,wantsFrame=input.workspaceFurnishingArtworkFrame===true,wantsFrameModels=input.workspaceFurnishingArtworkFrameModels===true,wantsFramePreparation=input.workspaceArtworkFramePreparation===true,wantsPortal=input.workspacePortalFinish===true,wantsInfoStand=input.workspaceInfoStandPreparation===true;if(input.workspaceInfoStandPreparation!==undefined&&(!wantsInfoStand||!wantsWriter||!wantsRoomVisual||!wantsFramePreparation))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');if(input.workspacePortalFinish!==undefined&&(!wantsPortal||!wantsFrameModels))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');if(input.workspaceArtworkFramePreparation!==undefined&&(!wantsFramePreparation||!wantsFrameModels))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');if(input.workspaceFurnishingArtworkFrameModels!==undefined&&(!wantsFrameModels||!wantsFrame))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');if(input.workspaceFurnishingArtworkFrame!==undefined&&(!wantsFrame||!wantsRoomVisual))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');if(input.workspaceFurnishingRoomVisual!==undefined&&(!wantsRoomVisual||!wantsStool))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');if(input.workspaceFurnishingStool!==undefined&&(!wantsStool||!wantsMultimap))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');if(input.workspaceMaterialMultimap!==undefined&&(!wantsMultimap||!wantsMaterialPublication))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');if(input.workspaceMaterialPublication!==undefined&&(!wantsMaterialPublication||!wantsPublication))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');if(input.workspaceFurnishingPublication!==undefined&&(!wantsPublication||!wantsWriter))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');if(input.workspaceWallImport!==undefined&&(!wantsWall||!wantsWorkspaceImport)||input.workspaceFurnishing!==undefined&&(!wantsFurnishing||!wantsWall)||input.workspaceFurnishingWriter!==undefined&&(!wantsWriter||!wantsFurnishing))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');for(const value of [workspaceId,tenantId,principalId])uuid(value);
 if(!Number.isSafeInteger(ownerUid)||ownerUid<=0||ownerUid!==process.getuid?.()||typeof blobRoot!=='string')throw new ApiError(403,'FORBIDDEN');
 const verifyWorkspace=async(client:PoolClient)=>{const rows=await client.query('SELECT 1 FROM local_workspaces WHERE id=$1 AND tenant_id=$2 AND user_id=$3 AND mac_uid=$4',[workspaceId,tenantId,principalId,ownerUid]);if(rows.rowCount!==1)throw new ApiError(403,'FORBIDDEN');};
 const legacy=[{name:'026_oex_file_profile.sql',sha256:'9e2a204ef9f24132f25ca2247415604c65f3f301c04e70a6a2a2facbc9122112'},{name:'027_oex_exhibition_provenance.sql',sha256:'09bd82b3195e2f54545f6af45173bbab569effac95553a50f573745dab96f2c7'}];
 const readCatalog=async(client:PoolClient)=>(await client.query('SELECT name,sha256 FROM schema_migrations WHERE name IN ($1,$2,$3,$4,$5,$6,$7) ORDER BY name',['026_oex_file_profile.sql','027_oex_exhibition_provenance.sql','028_oex_material_catalogue.sql','029_oex_quiet_oak_floor.sql','030_oex_concrete_surface.sql','031_workspace_material.sql','032_oex_workspace_material.sql'])).rows;
 const initial=await readCatalog(c),catalogue=[...legacy,{name:'028_oex_material_catalogue.sql',sha256:'1f88a8ed07a3814954d11d58ebe9b627f399a39f918e8eb838d94a5df4f5b9af'}],floorCatalogue=[...catalogue,{name:'029_oex_quiet_oak_floor.sql',sha256:'d09e11450cdaa4e64f0b977cc17b1e468543314e6ce733571bc61b6b20deeb8a'}];
 const concreteCatalogue=[...floorCatalogue,{name:'030_oex_concrete_surface.sql',sha256:'8c42cecb6a90c61eab4c72c4af81af42801db6bac60a567b61e69e7a31e22848'}];
 const workspaceCatalogue=[...concreteCatalogue,{name:'031_workspace_material.sql',sha256:'2425f4d24859bf1627d1be9bb3d4b0ecc7829d074437a4aebd9e52d57bf45eb5'},{name:'032_oex_workspace_material.sql',sha256:'bc0017937498f37cfc98acf2851cd70752c76be353208e466aa6a2a5b1808efc'}];
 if(!isDeepStrictEqual(initial,workspaceCatalogue)&&!isDeepStrictEqual(initial,concreteCatalogue)&&!isDeepStrictEqual(initial,legacy)&&!isDeepStrictEqual(initial,catalogue)&&!isDeepStrictEqual(initial,floorCatalogue))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');
 const archiveFormats:readonly NativeOexFileFormat[]=Object.freeze(initial.length>=3?['1.0.0-draft.9','1.0.0-draft.10']:['1.0.0-draft.9']);
 const assertCatalog=async(client:PoolClient)=>{if(!isDeepStrictEqual(await readCatalog(client),initial))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');};
 const expectedImport=[{name:'033_workspace_material_import_provenance.sql',sha256:'f69d3dc12d7b89f1a342daef1d7bca08787667efacdfca3d214d3101b051d1dd'},{name:'034_workspace_material_terminal_proof.sql',sha256:'ebf2300ef875b635617d82369f4c7cad4cbe6d8fa43677bdbd2e5e21dd74da21'}];
 const assertImportCatalog=async(client:PoolClient)=>{await assertCatalog(client);const expected=wantsWall?[...expectedImport,{name:'035_workspace_material_wall_import.sql',sha256:'c347183b3e58805c46d1dde7ae6e2defc37762af52f585846357181b9635a544'}]:expectedImport;const rows=(await client.query('SELECT name,sha256 FROM schema_migrations WHERE name IN ($1,$2,$3) ORDER BY name',[...expectedImport.map(x=>x.name),'035_workspace_material_wall_import.sql'])).rows;if(!isDeepStrictEqual(rows,expected))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');};
 if(wantsWorkspaceImport&&!isDeepStrictEqual(initial,workspaceCatalogue))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');if(wantsWorkspaceImport)await assertImportCatalog(c);
 await verifyWorkspace(c);await assertCatalog(c);const owner=await publicationDiskOwner(c,blobRoot);
 const restored=restoreRowAuthority(input.restoredProvenance);
 if(restored){
  if(!wantsWriter||typeof restored.assertLive!=='function'||restored.targetDatabaseSystemId!==owner.databaseSystemId||restored.targetDatabaseOid!==owner.databaseOid||restored.sourceDatabaseSystemId===restored.targetDatabaseSystemId||![restored.sourceDatabaseSystemId,restored.sourceDatabaseOid,restored.targetDatabaseSystemId,restored.targetDatabaseOid].every(x=>typeof x==='string'&&/^[1-9][0-9]{0,19}$/.test(x))||!Number.isSafeInteger(restored.provenanceRowCount)||restored.provenanceRowCount<0||!/^[a-f0-9]{64}$/.test(restored.provenanceTableSha256))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');
  await restored.assertLive();
 }
 const verifyRestoredInventory=async(client:PoolClient,record?:Parameters<NativeOexWorkspaceContext['assertRecord']>[1])=>{
  if(!restored||record&&(record.sourceDatabaseSystemId!==restored.sourceDatabaseSystemId||record.sourceDatabaseOid!==restored.sourceDatabaseOid))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');
  await restored.assertLive();
  // This is the same row representation, ordering and newline framing as the
  // authenticated service inventory. The full archived table must consist of
  // this source pair; current-target imports are excluded and cannot expand it.
  await client.query("SET LOCAL TimeZone='UTC'");await client.query("SET LOCAL DateStyle='ISO, YMD'");await client.query('SET LOCAL extra_float_digits=3');
  const cursor='restored_provenance_'+randomUUID().replaceAll('-',''),h=createHash('sha256');let count=0,matches=0;
  await client.query(`DECLARE "${cursor}" NO SCROLL CURSOR FOR SELECT to_jsonb(t)::text AS raw FROM public.native_oex_exhibition_provenance t WHERE source_database_system_id=$1 AND source_database_oid=$2 ORDER BY to_jsonb(t)::text COLLATE "C"`,[restored.sourceDatabaseSystemId,restored.sourceDatabaseOid]);
  try{for(;;){const batch=await client.query(`FETCH 1000 FROM "${cursor}"`);if(!batch.rowCount)break;for(const row of batch.rows){h.update(row.raw+'\n');count++;if(count>restored.provenanceRowCount)throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');const p=JSON.parse(row.raw);if(record&&p.tenant_id===record.tenantId&&p.workspace_id===record.workspaceId&&p.principal_id===record.principalId&&p.exhibition_id===record.exhibitionId&&p.import_job_id===record.importJobId&&p.attempt_id===record.attemptId&&p.claim_sha256===record.claimSha256&&p.payload_manifest_sha256===record.payloadManifestSha256&&p.source_sha256===record.sourceSha256&&p.source_database_system_id===record.sourceDatabaseSystemId&&p.source_database_oid===record.sourceDatabaseOid&&p.archive_profile==='bounded-file-v1')matches++;}}}finally{await client.query(`CLOSE "${cursor}"`);}
  if(record&&matches!==1||count!==restored.provenanceRowCount||h.digest('hex')!==restored.provenanceTableSha256)throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');
  await restored.assertLive();
 };
 const assertFurnishingCatalog=async(client:PoolClient)=>{const rows=(await client.query('SELECT name,sha256 FROM schema_migrations WHERE name=$1',['036_workspace_furnishing.sql'])).rows;if(!isDeepStrictEqual(rows,[{name:'036_workspace_furnishing.sql',sha256:'132ecc276ba18aa173ab0bd1bf8c70167eef5d20783d8de4bc09408de962a3c7'}]))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');if(wantsWriter){const writer=(await client.query('SELECT name,sha256 FROM schema_migrations WHERE name=$1',['037_workspace_furnishing_writer_generation.sql'])).rows;if(!isDeepStrictEqual(writer,[{name:'037_workspace_furnishing_writer_generation.sql',sha256:'a8e861458fcce8336a50b7c94a398555bf6860fbeb20009ea3db6aaaaf068f48'}]))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');}if(wantsPublication){const publication=(await client.query('SELECT name,sha256 FROM schema_migrations WHERE name=$1',['038_workspace_furnishing_publication.sql'])).rows;if(!isDeepStrictEqual(publication,[{name:'038_workspace_furnishing_publication.sql',sha256:'cbee8e1f2a7af5daa1aec498d014ad25934b116aa5d578966b23efef2e110a98'}]))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');}if(wantsMaterialPublication){const materialPublication=(await client.query('SELECT name,sha256 FROM schema_migrations WHERE name=$1',['039_workspace_material_publication.sql'])).rows;if(!isDeepStrictEqual(materialPublication,[{name:'039_workspace_material_publication.sql',sha256:'6e2984911b585f0ceba0c64273d3535a505272c310a2f2f550f29f2a8ff90b32'}]))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');}if(wantsMultimap){const multimap=(await client.query('SELECT name,sha256 FROM schema_migrations WHERE name=$1',['040_workspace_material_multimap.sql'])).rows;if(!isDeepStrictEqual(multimap,[{name:'040_workspace_material_multimap.sql',sha256:'db01d1910ba01a0a2e223829b92f9fbc0e4ce0240c21d3a8ae6b70963a84ef21'}]))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');}if(wantsFramePreparation){const prep=(await client.query('SELECT name,sha256 FROM schema_migrations WHERE name=$1',['041_workspace_frame_preparation.sql'])).rows;if(!isDeepStrictEqual(prep,[{name:'041_workspace_frame_preparation.sql',sha256:'c5a030186557dc4774aa0d2a677be7f432c1010e2ee1c1a34345f69ac7e2723d'}]))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');}};
 const assertInfoStandCatalog=async(client:PoolClient)=>{
  if(!wantsInfoStand)return;
  const rows=(await client.query('SELECT name,sha256 FROM schema_migrations WHERE name=$1',['048_workspace_info_stand_preparation.sql'])).rows;
  if(!isDeepStrictEqual(rows,[{name:'048_workspace_info_stand_preparation.sql',sha256:'5f41eba8cff108ee545e7454ca5ef3757087335c7650c95660ef1022d6698ca6'}]))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');
 };
 if(wantsFurnishing)await assertFurnishingCatalog(c);
 await assertInfoStandCatalog(c);
 const assertDatabase=async(client:PoolClient)=>{await verifyWorkspace(client);if(wantsWorkspaceImport)await assertImportCatalog(client);else await assertCatalog(client);if(wantsFurnishing)await assertFurnishingCatalog(client);await assertInfoStandCatalog(client);if(!isDeepStrictEqual(await publicationDiskOwner(client,blobRoot),owner))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');};
 // Canonical journal records have a null prototype; compare their exact own
 // fields while retaining the issued-context and physical-owner checks.
 const context=Object.freeze({workspaceId,tenantId,principalId,...(wantsInfoStand?{workspaceInfoStandPreparation:true as const}:{}),matchesBlobRoot:(root:string)=>root===owner.storeRoot,archiveFormats,workspaceMaterials:isDeepStrictEqual(initial,workspaceCatalogue),...(wantsFurnishing?{workspaceFurnishing:true as const}:{}),...(wantsWriter?{workspaceFurnishingWriter:true as const}:{}),...(wantsPublication?{workspaceFurnishingPublication:true as const}:{}),...(wantsMaterialPublication?{workspaceMaterialPublication:true as const}:{}),...(wantsMultimap?{workspaceMaterialMultimap:true as const}:{}),...(wantsStool?{workspaceFurnishingStool:true as const}:{}),...(wantsRoomVisual?{workspaceFurnishingRoomVisual:true as const}:{}),...(wantsFrame?{workspaceFurnishingArtworkFrame:true as const}:{}),...(wantsFrameModels?{workspaceFurnishingArtworkFrameModels:true as const}:{}),...(wantsFramePreparation?{workspaceArtworkFramePreparation:true as const}:{}),...(wantsPortal?{workspacePortalFinish:true as const}:{}),...(wantsWorkspaceImport?{workspaceImport:true as const,...(wantsWall?{workspaceWallImport:true as const}:{}),assertImportCatalog,assertOwner:(candidate:import('./publication-disk-budget.ts').DiskOwner)=>{const proto=candidate&&typeof candidate==='object'?Object.getPrototypeOf(candidate):undefined;if((proto!==null&&proto!==Object.prototype)||!isDeepStrictEqual({...candidate},owner)||!samePublicationDiskOwner(candidate,owner))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');}}:{}),assertCatalog,assertDatabase,...(restored?{assertRestoredInventory:async(client:PoolClient)=>{await assertDatabase(client);await verifyRestoredInventory(client);}}:{}),assertRecord:async(client:PoolClient,record:Parameters<NativeOexWorkspaceContext['assertRecord']>[1])=>{
  await assertDatabase(client);if(record.workspaceId!==workspaceId||record.tenantId!==tenantId||record.principalId!==principalId)throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');
  if(record.sourceDatabaseSystemId!==owner.databaseSystemId||record.sourceDatabaseOid!==owner.databaseOid)await verifyRestoredInventory(client,record);
 }} satisfies NativeOexWorkspaceContext);if(wantsWorkspaceImport)issuedWorkspaceImports.add(context);return context;
}

/** Private default-native workspace binding for local file export. It does not
 * grant bounded-import provenance, migrate a database or authorize a request. */
export interface NativeLocalExportContext {
 readonly workspaceId:string;readonly tenantId:string;readonly principalId:string;
 assertDatabase(client:PoolClient):Promise<void>;
 matchesBlobRoot?(root:string):boolean;
}
const issuedLocalExports=new WeakSet<NativeLocalExportContext>();
export function isIssuedNativeLocalExport(context:NativeLocalExportContext){return issuedLocalExports.has(context);}
export async function bindNativeLocalExportWorkspace(c:PoolClient,input:{workspaceId:string;tenantId:string;principalId:string;ownerUid:number;blobRoot:string}):Promise<NativeLocalExportContext>{
 const {workspaceId,tenantId,principalId,ownerUid,blobRoot}=input;for(const value of [workspaceId,tenantId,principalId]){uuid(value);if(value!==value.toLowerCase())throw new ApiError(403,'FORBIDDEN');}
 if(!Number.isSafeInteger(ownerUid)||ownerUid<=0||ownerUid!==process.getuid?.()||typeof blobRoot!=='string')throw new ApiError(403,'FORBIDDEN');
 const verify=async(client:PoolClient)=>{const r=await client.query('SELECT 1 FROM local_workspaces WHERE id=$1 AND tenant_id=$2 AND user_id=$3 AND mac_uid=$4',[workspaceId,tenantId,principalId,ownerUid]);if(r.rowCount!==1)throw new ApiError(403,'FORBIDDEN');};
 await verify(c);const owner=await publicationDiskOwner(c,blobRoot);
 const context=Object.freeze({workspaceId,tenantId,principalId,matchesBlobRoot:(root:string)=>root===blobRoot,assertDatabase:async(client:PoolClient)=>{await verify(client);if(!isDeepStrictEqual(await publicationDiskOwner(client,blobRoot),owner))throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');}});issuedLocalExports.add(context);return context;
}

/** Called only after the normal Studio tenant/role access check. A missing
 * record retains the ordinary limit. A malformed or mismatched record fails
 * closed; a row by itself is never authorization. */
export async function hasNativeBoundedProvenance(c:PoolClient,s:Session,exhibitionId:string,context?:NativeOexWorkspaceContext):Promise<boolean>{
 if(!context)return false;
 uuid(exhibitionId);exhibitionId=exhibitionId.toLowerCase();uuid(context.workspaceId);uuid(context.tenantId);uuid(context.principalId);
 if(s.tenantId!==context.tenantId||s.userId!==context.principalId||typeof context.assertDatabase!=='function'||typeof context.assertRecord!=='function')throw new ApiError(403,'FORBIDDEN');
 await context.assertDatabase(c);
 const result=await c.query(`SELECT p.workspace_id,p.principal_id,p.import_job_id,p.source_sha256,p.archive_profile,p.source_database_system_id,p.source_database_oid,p.attempt_id,p.claim_sha256,p.payload_manifest_sha256,
  j.user_id,j.request_id,j.payload_sha256,j.archive_profile AS job_profile,j.oex_format,j.state,j.result->>'exhibitionId' AS result_exhibition,
  w.tenant_id AS workspace_tenant,w.user_id AS workspace_principal
  FROM native_oex_exhibition_provenance p
  JOIN oex_import_jobs j ON (j.tenant_id,j.id)=(p.tenant_id,p.import_job_id)
  JOIN local_workspaces w ON w.id=p.workspace_id
  WHERE p.tenant_id=$1 AND p.exhibition_id=$2`,[s.tenantId,exhibitionId]);
 if(result.rowCount===0)return false;
 if(result.rowCount!==1)throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');
 const row=result.rows[0];
 const formatAllowed=isNativeOexFileFormat(row.oex_format)?(context.archiveFormats??['1.0.0-draft.9']).includes(row.oex_format):row.oex_format==='1.0.0-draft.12'&&issuedWorkspaceImports.has(context);
 if(row.workspace_id!==context.workspaceId||row.principal_id!==s.userId||row.workspace_tenant!==s.tenantId||row.workspace_principal!==s.userId||row.user_id!==s.userId||row.archive_profile!=='bounded-file-v1'||row.job_profile!=='bounded-file-v1'||!formatAllowed||row.state!=='complete'||row.source_sha256!==row.payload_sha256||row.result_exhibition!==exhibitionId)throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');
 await context.assertRecord(c,Object.freeze({workspaceId:context.workspaceId,tenantId:s.tenantId,principalId:s.userId,importJobId:row.import_job_id,requestId:row.request_id,attemptId:row.attempt_id,claimSha256:row.claim_sha256,payloadManifestSha256:row.payload_manifest_sha256,sourceDatabaseSystemId:row.source_database_system_id,sourceDatabaseOid:row.source_database_oid,sourceSha256:row.source_sha256,exhibitionId}));
 await context.assertDatabase(c);return true;
}


/** A one-shot selected-import ticket is bound to the actual transaction,
 * authorized Session, source job and exact draft. It is never serialized. */
declare const selectedDraftBrand:unique symbol;
export type NativeSelectedDraftGrant=Readonly<{readonly [selectedDraftBrand]:true}>;
type SelectedBinding={workspaceId:string;tenantId:string;principalId:string;jobId:string;attemptId:string;sourceSha256:string;claimSha256:string;payloadManifestSha256:string;sourceDatabaseSystemId:string;sourceDatabaseOid:string;exhibitionId:string};
type GrantState={client:PoolClient;sessionId:string;binding:Readonly<SelectedBinding>;draftHash:string;used:boolean;recorded:boolean;assertLive:()=>Promise<void>};
const grants=new WeakMap<NativeSelectedDraftGrant,GrantState>();
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
function draftDigest(draft:unknown){return createHash('sha256').update(canonical(draft)).digest('hex');}
/** The private caller MUST already hold the selected owner claim and PG
 * operation fence; assertLive revalidates that actual issued claim. */
export async function issueNativeSelectedDraftGrant(c:PoolClient,s:Session,draft:unknown,input:SelectedBinding,assertLive:()=>Promise<void>,workspace?:{context:NativeOexWorkspaceContext;owner:import('./publication-disk-budget.ts').DiskOwner}):Promise<NativeSelectedDraftGrant>{
 const binding=structuredClone(input),hex=/^[a-f0-9]{64}$/;
 for(const v of [binding.workspaceId,binding.tenantId,binding.principalId,binding.jobId,binding.attemptId,binding.exhibitionId]){uuid(v);if(v!==v.toLowerCase())throw new ApiError(403,'FORBIDDEN');}
 if(!draft||typeof draft!=='object'||(draft as {exhibitionId?:unknown}).exhibitionId!==binding.exhibitionId||binding.tenantId!==s.tenantId||binding.principalId!==s.userId||typeof assertLive!=='function'||![binding.sourceSha256,binding.claimSha256,binding.payloadManifestSha256].every(v=>hex.test(v))||![binding.sourceDatabaseSystemId,binding.sourceDatabaseOid].every(v=>/^[0-9]{1,24}$/.test(v)))throw new ApiError(403,'FORBIDDEN');
 const draftHash=draftDigest(draft);
 const verifyWorkspace=async()=>{if(workspace){assertIssuedWorkspaceImport(workspace.context,workspace.owner);if(workspace.context.workspaceId!==binding.workspaceId||workspace.context.tenantId!==s.tenantId||workspace.context.principalId!==s.userId||workspace.owner.databaseSystemId!==binding.sourceDatabaseSystemId||workspace.owner.databaseOid!==binding.sourceDatabaseOid)throw new ApiError(403,'FORBIDDEN');await workspace.context.assertDatabase(c);}};
 await assertLive();await verifyWorkspace();
 const r=await c.query("SELECT 1 FROM local_workspaces w JOIN oex_import_jobs j ON (j.tenant_id,j.user_id)=(w.tenant_id,w.user_id) WHERE w.id=$1 AND w.tenant_id=$2 AND w.user_id=$3 AND j.id=$4 AND j.state='processing' AND j.archive_profile='bounded-file-v1' AND j.oex_format = ANY($6::text[]) AND j.payload_sha256=$5 FOR UPDATE OF j",[binding.workspaceId,s.tenantId,s.userId,binding.jobId,binding.sourceSha256,workspace?['1.0.0-draft.12']:['1.0.0-draft.9','1.0.0-draft.10']]);
 if(r.rowCount!==1)throw new ApiError(409,'NATIVE_OEX_PROVENANCE_INVALID');await verifyWorkspace();await assertLive();
 const grant=Object.freeze(Object.create(null)) as NativeSelectedDraftGrant;
 grants.set(grant,{client:c,sessionId:s.id,binding:Object.freeze(binding),draftHash,used:false,recorded:false,assertLive});return grant;
}
export async function consumeNativeSelectedDraftGrant(grant:NativeSelectedDraftGrant,c:PoolClient,s:Session,draft:unknown):Promise<void>{
 const state=grants.get(grant);if(!state||state.used||state.client!==c||state.sessionId!==s.id||state.binding.tenantId!==s.tenantId||state.binding.principalId!==s.userId||draftDigest(draft)!==state.draftHash)throw new ApiError(403,'FORBIDDEN');
 state.used=true;await state.assertLive();
}
export async function recordNativeSelectedProvenance(grant:NativeSelectedDraftGrant,c:PoolClient,s:Session,exhibitionId:string):Promise<void>{
 const state=grants.get(grant);if(!state||!state.used||state.recorded||state.client!==c||state.sessionId!==s.id||state.binding.exhibitionId!==exhibitionId)throw new ApiError(403,'FORBIDDEN');
 state.recorded=true;await state.assertLive();const b=state.binding;
 await c.query('INSERT INTO native_oex_exhibition_provenance(tenant_id,workspace_id,principal_id,exhibition_id,import_job_id,attempt_id,source_database_system_id,source_database_oid,claim_sha256,payload_manifest_sha256,source_sha256,archive_profile) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,\'bounded-file-v1\')',[b.tenantId,b.workspaceId,b.principalId,b.exhibitionId,b.jobId,b.attemptId,b.sourceDatabaseSystemId,b.sourceDatabaseOid,b.claimSha256,b.payloadManifestSha256,b.sourceSha256]);await state.assertLive();
}
