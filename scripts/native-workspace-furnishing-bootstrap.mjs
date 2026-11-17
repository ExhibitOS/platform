import {CURRENT_IMAGE_THUMBNAIL_MIGRATION,CURRENT_IMAGE_THUMBNAIL_SHA256,verifyCurrentImageThumbnailMigration,assertExactCurrentImageThumbnailCatalog,assertExactCombinedThumbnailCatalog} from './native-oex-normal-catalog.mjs';
import {assertExactGpuModelPreparationCatalog} from './native-oex-normal-catalog.mjs';
import {WORKSPACE_FURNISHING_THUMBNAIL_MIGRATION,WORKSPACE_FURNISHING_THUMBNAIL_SHA256,verifyWorkspaceFurnishingThumbnailMigration,assertExactWorkspaceFurnishingThumbnailCatalog} from './native-oex-normal-catalog.mjs';
import {INFO_STAND_PREPARATION_MIGRATION,INFO_STAND_PREPARATION_SHA256,verifyInfoStandPreparationMigration,assertExactInfoStandPreparationCatalog,LARGE_MODEL_MIGRATION,LARGE_MODEL_SHA256,verifyLargeModelMigration,assertExactLargeModelCatalog,FRESH_IMAGE_MIGRATION,FRESH_IMAGE_SHA256,verifyFreshImageMigration,assertExactFreshImageCatalog,MODEL_PREPARATION_MIGRATION,MODEL_PREPARATION_SHA256,verifyModelPreparationMigration,assertExactModelPreparationCatalog} from './native-oex-normal-catalog.mjs';
// SPDX-License-Identifier: AGPL-3.0-or-later
// Called only inside openLocalWorkspace's transaction, before owner/session
// writes. The caller must supply the authenticated inherited owner channel.
import {HAYES_RELEASE_MIGRATION,HAYES_RELEASE_SHA256,verifyHayesReleaseMigration,assertExactHayesReleaseCatalog} from './native-oex-normal-catalog.mjs';
import {HAYES_DISPOSITION_MIGRATION,HAYES_DISPOSITION_SHA256,verifyHayesDispositionMigration,assertExactHayesDispositionCatalog} from './native-oex-normal-catalog.mjs';
import {HAYES_ORIGINAL_MIGRATION,HAYES_ORIGINAL_SHA256,verifyHayesOriginalMigration,assertExactHayesOriginalCatalog,WORKSPACE_FRAME_PREPARATION_MIGRATION,WORKSPACE_FRAME_PREPARATION_SHA256,verifyWorkspaceFramePreparationMigration,assertExactWorkspaceFramePreparationCatalog} from './native-oex-normal-catalog.mjs';
import {WORKSPACE_MATERIAL_PUBLICATION_MIGRATION,WORKSPACE_MATERIAL_PUBLICATION_SHA256,verifyWorkspaceMaterialPublicationMigration} from './native-oex-normal-catalog.mjs';
import {WORKSPACE_MATERIAL_MULTIMAP_MIGRATION,WORKSPACE_MATERIAL_MULTIMAP_SHA256,verifyWorkspaceMaterialMultimapMigration} from './native-oex-normal-catalog.mjs';
import {confirmedHayesReleaseBindings} from '../packages/storage/dist/hayes-release-inventory.js';
import {migrateInTransaction} from '../packages/storage/dist/index.js';
import {assertIssuedFurnishingWriterLease,assertIssuedFurnishingOrdinaryAdmission} from './native-workspace-furnishing-admission.mjs';
import {verifyWorkspaceFurnishingWriterMigration,WORKSPACE_FURNISHING_WRITER_MIGRATION,WORKSPACE_FURNISHING_WRITER_SHA256,verifyWorkspaceFurnishingPublicationMigration,WORKSPACE_FURNISHING_PUBLICATION_MIGRATION,WORKSPACE_FURNISHING_PUBLICATION_SHA256} from './native-oex-normal-catalog.mjs';
import {BENCH_AFTER_TERMINAL_MIGRATION,BENCH_AFTER_TERMINAL_SHA256,checkBenchAfterTerminalLedger,verifyBenchAfterTerminalMigration} from './native-oex-normal-catalog.mjs';
import {HAYES_PREOPEN_TERMINAL_MIGRATION,HAYES_PREOPEN_TERMINAL_SHA256,HAYES_PREOPEN_TERMINAL_SELECTION,checkCombinedThumbnailParent,checkHayesPreopenTerminalLedger,verifyHayesPreopenTerminalMigration} from './native-oex-normal-catalog.mjs';
import {assertExactWorkspaceMaterialPublicationCatalog,assertExactWorkspaceMaterialMultimapCatalog,recognizeNormalOexCatalog,verifyNormalOexMigration,verifyNormalOexProvenanceMigration,verifyNormalOexMaterialMigration,verifyNormalOexFloorMigration,verifyNormalOexConcreteMigration,verifyWorkspaceMaterialMigrations,verifyWorkspaceImportMigrations,verifyWorkspaceWallImportMigration,verifyWorkspaceFurnishingMigration,NORMAL_OEX_MIGRATION,NORMAL_OEX_SHA256,NORMAL_OEX_PROVENANCE_MIGRATION,NORMAL_OEX_PROVENANCE_SHA256,NORMAL_OEX_MATERIAL_MIGRATION,NORMAL_OEX_MATERIAL_SHA256,NORMAL_OEX_FLOOR_MIGRATION,NORMAL_OEX_FLOOR_SHA256,NORMAL_OEX_CONCRETE_MIGRATION,NORMAL_OEX_CONCRETE_SHA256,WORKSPACE_MATERIAL_MIGRATION,WORKSPACE_MATERIAL_SHA256,WORKSPACE_MATERIAL_OEX_MIGRATION,WORKSPACE_MATERIAL_OEX_SHA256,WORKSPACE_IMPORT_STAGE_MIGRATION,WORKSPACE_IMPORT_STAGE_SHA256,WORKSPACE_IMPORT_PROOF_MIGRATION,WORKSPACE_IMPORT_PROOF_SHA256,WORKSPACE_WALL_IMPORT_MIGRATION,WORKSPACE_WALL_IMPORT_SHA256,WORKSPACE_FURNISHING_MIGRATION,WORKSPACE_FURNISHING_SHA256} from './native-oex-normal-catalog.mjs';

// Only the authenticated, generation-bound Manager lifecycle assertion may
// select these modes. The database's exclusive token check remains mandatory;
// this admission never reclaims an unknown predecessor's retained work.
export async function assertWorkspaceFurnishingRuntimeAdmission(mode,admission,{allowInterruptedReopen=false}={}){
 const upgrade='workspace-furnishing-039-to-040-upgrade-v1',upgrade44='workspace-furnishing-040-to-044-upgrade-v1',upgrade45='workspace-furnishing-044-to-045-upgrade-v1',upgrade50='workspace-furnishing-045-to-050-upgrade-v1',upgrade49='workspace-furnishing-045-to-049-upgrade-v1',upgrade51='workspace-furnishing-045-to-051-upgrade-v1',upgradePair='workspace-furnishing-051-to-050-051-upgrade-v1',init='workspace-furnishing-036-initialize-v1',reopen='workspace-furnishing-036-reopen-v1',selected='workspace-furnishing-038-selected-import-v7',selected39='workspace-furnishing-039-selected-import-v7',selected40='workspace-furnishing-040-selected-import-v7';
 if(mode!==init&&mode!==reopen&&mode!==upgrade&&mode!==upgrade44&&mode!==upgrade45&&mode!==upgrade50&&mode!==upgrade49&&mode!==upgrade51&&mode!==upgradePair&&mode!==selected&&mode!==selected39&&mode!==selected40)return;
 assertIssuedFurnishingOrdinaryAdmission(admission);
 if(admission.writer.identity.mode!==mode||(mode===upgrade?admission.fields.admissionKind!=='catalog-upgrade-039-to-040':mode===upgrade44?admission.fields.admissionKind!=='catalog-upgrade-040-to-044':mode===upgrade45?admission.fields.admissionKind!=='catalog-upgrade-044-to-045':mode===upgrade50?admission.fields.admissionKind!=='catalog-upgrade-045-to-050':mode===upgrade49?admission.fields.admissionKind!=='catalog-upgrade-045-to-049':mode===upgrade51?admission.fields.admissionKind!=='catalog-upgrade-045-to-051':mode===upgradePair?admission.fields.admissionKind!=='catalog-upgrade-051-to-050-051':mode===init||mode===selected||mode===selected39||mode===selected40?admission.fields.admissionKind!=='fresh-empty':!['clean-reopen','verified-restore',...(allowInterruptedReopen?['interrupted-reopen']:[])].includes(admission.fields.admissionKind)))throw Error('FURNISHING_ADMISSION_INVALID');
 await admission.writer.assertLive();
}

// Interrupted combined-thumbnail reopen preserves settled work only. Ordinary
// PNG tokens have no generation/root claim, so none may be reclaimed here.
// Keep this global predicate identical to Manager's PG-only pre-Node check.
async function assertCombinedThumbnailInterruptedIdle(c,retained){
 const lease=retained?
  '((lease_id IS NOT NULL OR lease_until IS NOT NULL) AND (tenant_id IS DISTINCT FROM $1::uuid OR NOT (id=ANY($2::uuid[]))))':
  'lease_id IS NOT NULL OR lease_until IS NOT NULL';
 const result=await c.query(`SELECT EXISTS (
 SELECT 1 FROM public.import_jobs WHERE state IN ('uploading','queued','processing')
 OR ${lease} OR cardinality(png_worker_tokens)>0
 OR model_preparation ? 'claim' OR derived ? 'claim'
) OR EXISTS (
 SELECT 1 FROM public.oex_import_jobs WHERE state IN ('uploading','queued','processing')
 OR lease_id IS NOT NULL OR lease_until IS NOT NULL OR cleanup_pending
) OR EXISTS (
 SELECT 1 FROM public.workspace_material_intakes WHERE phase IN ('uploading','validating','cancelling') OR worker_token IS NOT NULL
) OR EXISTS (
 SELECT 1 FROM public.workspace_furnishing_intakes WHERE phase IN ('uploading','validating','cancelling') OR worker_token IS NOT NULL
) OR EXISTS (
 SELECT 1 FROM public.freeze_requests WHERE state='creating' OR lease_id IS NOT NULL OR lease_until IS NOT NULL OR cleanup_pending
) OR EXISTS (
 SELECT 1 FROM public.workspace_frame_preparations WHERE state='staged'
) AS unsettled`,retained?[retained.tenantId,retained.jobIds]:[]);
 if(result.rows.length!==1||result.rows[0]?.unsettled!==false)throw Error('FURNISHING_RECOVERY_UNAVAILABLE');
}

/** The exact 054 parent stores some settled Hayes leases as evidence.
 * Admit those rows only as the same physical owner's immutable receipts. */
export async function assertBenchAfterTerminalIdle(c,{tenantId,workspaceId,principalId}){
 const parameters=[tenantId,workspaceId,principalId];
 const {rows:terminals}=await c.query(`SELECT t.job_id
  FROM public.hayes_preopen_terminal_bindings t
  JOIN public.hayes_original_attempts a ON (a.tenant_id,a.id,a.job_id)=(t.tenant_id,t.attempt_id,t.job_id)
  JOIN public.import_jobs j ON (j.tenant_id,j.id,j.hayes_attempt_id,j.lease_id)=(a.tenant_id,a.job_id,a.id,a.lease_id)
  CROSS JOIN LATERAL (SELECT convert_from(t.proof_canonical,'UTF8')::jsonb AS body) proof
  WHERE (t.tenant_id,t.workspace_id,t.principal_id)=($1::uuid,$2::uuid,$3::uuid)
   AND (j.user_id,j.artwork_id)=(a.principal_id,a.artwork_id)
   AND j.attempts=1 AND j.progress=25 AND j.lease_until<=clock_timestamp()
   AND (proof.body#>>'{claim,leaseUntil}')::timestamptz=j.lease_until
   AND proof.body#>>'{claim,systemId}'=(pg_control_system()).system_identifier::text
   AND proof.body#>>'{claim,databaseOid}'=(SELECT oid::text FROM pg_database WHERE datname=current_database())
   AND encode(sha256(t.proof_canonical),'hex')=t.proof_sha256`,parameters);
 const {rows:releaseCandidates}=await c.query(`SELECT r.job_id,r.completion_frame_sha256
  FROM public.hayes_native_releases r
  JOIN public.hayes_original_attempts a ON (a.tenant_id,a.id,a.job_id)=(r.tenant_id,r.attempt_id,r.job_id)
  JOIN public.import_jobs j ON (j.tenant_id,j.id,j.hayes_attempt_id,j.lease_id)=(a.tenant_id,a.job_id,a.id,a.lease_id)
  WHERE (a.tenant_id,a.workspace_id,a.principal_id)=($1::uuid,$2::uuid,$3::uuid)
   AND j.state='approved' AND j.progress=100 AND j.original_asset_id IS NULL AND j.lease_until IS NOT NULL`,parameters);
 const jobIds=terminals.map(row=>row.job_id);
 for(const {job_id:jobId,completion_frame_sha256:completionFrameSha256} of releaseCandidates){
  const release=await confirmedHayesReleaseBindings(c,tenantId,{workspaceId,principalId,jobId,completionFrameSha256});
  if(release.has(`import_jobs:${tenantId}:${jobId}`))jobIds.push(jobId);
 }
 await assertCombinedThumbnailInterruptedIdle(c,{tenantId,jobIds});
}

async function assertHayesPreopenTerminalLive({mode,writer,ordinaryAdmission,channel,hayesChannel,selection,isStopped}){
 assertIssuedFurnishingOrdinaryAdmission(ordinaryAdmission);
 assertIssuedFurnishingWriterLease(writer);
 if(selection!==HAYES_PREOPEN_TERMINAL_SELECTION||mode!=='workspace-furnishing-036-reopen-v1'||
    writer.identity.mode!==mode||ordinaryAdmission.writer!==writer||ordinaryAdmission.fields.admissionKind!=='clean-reopen'||
    ordinaryAdmission.fields.restoreProof||ordinaryAdmission.fields.carriedRestoreProof||
    typeof isStopped!=='function')throw Error('FURNISHING_ADMISSION_INVALID');
 await writer.assertLive();
 if(isStopped()||!channel?.isOpen()||!hayesChannel?.isOpen())throw Error('NATIVE_OWNER_UNAVAILABLE');
}

/** Requested under the existing exclusive workspace and maintenance fences.
 * The retained Hayes row may stay processing; this path only changes the catalog. */
export async function prepareHayesPreopenTerminalCatalog(c,{base,normal,options,hayesPreopenTerminalDirectory,benchAfterTerminalDirectory,...admission}){
 await assertHayesPreopenTerminalLive(admission);
 const sql=await verifyHayesPreopenTerminalMigration(hayesPreopenTerminalDirectory);
 await c.query('SELECT pg_advisory_xact_lock(82001)');
 const {rows}=await c.query('SELECT name,sha256 FROM public.schema_migrations ORDER BY name');
 if(benchAfterTerminalDirectory){
  const benchSQL=await verifyBenchAfterTerminalMigration(benchAfterTerminalDirectory);
  if(rows.length===48){
   checkHayesPreopenTerminalLedger(rows);
   if(!await recognizeNormalOexCatalog(c,base,normal,{...options,hayesPreopenTerminalDirectory}))throw Error('NATIVE_OEX_CATALOG');
   await assertBenchAfterTerminalIdle(c,admission.writer.identity);
   await assertHayesPreopenTerminalLive(admission);
   await c.query(benchSQL);
   await c.query('INSERT INTO public.schema_migrations(name,sha256) VALUES($1,$2)',[BENCH_AFTER_TERMINAL_MIGRATION,BENCH_AFTER_TERMINAL_SHA256]);
  }else checkBenchAfterTerminalLedger(rows);
 }else if(rows.length===47){
  checkCombinedThumbnailParent(rows);
  if(!await recognizeNormalOexCatalog(c,base,normal,options))throw Error('NATIVE_OEX_CATALOG');
  await assertHayesPreopenTerminalLive(admission);
  await c.query(sql);
  await c.query('INSERT INTO public.schema_migrations(name,sha256) VALUES($1,$2)',[HAYES_PREOPEN_TERMINAL_MIGRATION,HAYES_PREOPEN_TERMINAL_SHA256]);
 }
 if(!await recognizeNormalOexCatalog(c,base,normal,{...options,hayesPreopenTerminalDirectory,benchAfterTerminalDirectory}))throw Error('NATIVE_OEX_CATALOG');
 return {requireExisting:true};
}

export async function assertHayesPreopenTerminalBeforeCommit(c,admission){
 const {rows}=await c.query('SELECT name,sha256 FROM public.schema_migrations ORDER BY name');
 if(admission.benchAfterTerminalDirectory)checkBenchAfterTerminalLedger(rows);
 else checkHayesPreopenTerminalLedger(rows);
 await assertHayesPreopenTerminalLive(admission);
}

/** Recheck the ledger before the last asynchronous writer/payload fence. */
export async function assertFurnishingBeforeCommit(c,{mode,ordinaryAdmission,writer,channel,isStopped,framePreparation=false,hayesOriginal=false,hayesDisposition=false,hayesRelease=false,modelPreparation=false,largeModel=false,freshImage=false,infoStandPreparation=false,workspaceFurnishingThumbnail=false,currentImageThumbnail=false,gpuModelPreparation=false}){
 assertIssuedFurnishingOrdinaryAdmission(ordinaryAdmission);
 if(ordinaryAdmission.writer!==writer||writer.identity.mode!==mode)throw Error('FURNISHING_ADMISSION_INVALID');
 if(mode==='workspace-furnishing-039-to-040-upgrade-v1')await assertExactWorkspaceMaterialMultimapCatalog(c);
 if(mode==='workspace-furnishing-040-to-044-upgrade-v1'&&!hayesRelease)throw Error('FURNISHING_ADMISSION_INVALID');
 if(mode==='workspace-furnishing-044-to-045-upgrade-v1'&&!modelPreparation)throw Error('FURNISHING_ADMISSION_INVALID');
 if(typeof currentImageThumbnail!=='boolean'||currentImageThumbnail&&(!modelPreparation||gpuModelPreparation||infoStandPreparation||freshImage||largeModel))throw Error('FURNISHING_ADMISSION_INVALID');
 if(gpuModelPreparation&&(!modelPreparation||workspaceFurnishingThumbnail||infoStandPreparation||freshImage||largeModel))throw Error('FURNISHING_ADMISSION_INVALID');
 if(currentImageThumbnail&&workspaceFurnishingThumbnail)await assertExactCombinedThumbnailCatalog(c);else if(currentImageThumbnail)await assertExactCurrentImageThumbnailCatalog(c);else if(gpuModelPreparation)await assertExactGpuModelPreparationCatalog(c);else if(workspaceFurnishingThumbnail)await assertExactWorkspaceFurnishingThumbnailCatalog(c);else if(infoStandPreparation)await assertExactInfoStandPreparationCatalog(c);else if(freshImage)await assertExactFreshImageCatalog(c);else if(largeModel)await assertExactLargeModelCatalog(c);else if(modelPreparation)await assertExactModelPreparationCatalog(c);else if(hayesRelease)await assertExactHayesReleaseCatalog(c);else if(hayesDisposition)await assertExactHayesDispositionCatalog(c);else if(hayesOriginal)await assertExactHayesOriginalCatalog(c);else if(framePreparation)await assertExactWorkspaceFramePreparationCatalog(c);
 if(currentImageThumbnail&&workspaceFurnishingThumbnail&&ordinaryAdmission.fields.admissionKind==='interrupted-reopen')await assertCombinedThumbnailInterruptedIdle(c);
 await writer.assertLive();
 if(isStopped()||!channel?.isOpen())throw Error('NATIVE_OWNER_UNAVAILABLE');
}

export async function prepareWorkspaceFurnishingCatalog(c,{mode,base,normal,imports,wall,furnishing,writerDirectory,publicationDirectory,materialPublicationDirectory,materialMultimapDirectory,framePreparationDirectory,hayesOriginalDirectory,hayesDispositionDirectory,hayesReleaseDirectory,modelPreparationDirectory,largeModelDirectory,allowLargeModelInterrupted=false,catalog045PreReady=false,preReadyHayesCompletion,freshImageDirectory,infoStandPreparationDirectory,workspaceFurnishingThumbnailDirectory,currentImageThumbnailDirectory,gpuModelPreparationDirectory,ownerUid,writer,channel,hayesChannel,ordinaryAdmission}){
 const selected=['workspace-furnishing-038-selected-import-v7','workspace-furnishing-039-selected-import-v7','workspace-furnishing-040-selected-import-v7'];
 const upgrade=mode==='workspace-furnishing-039-to-040-upgrade-v1',upgrade44=mode==='workspace-furnishing-040-to-044-upgrade-v1',upgrade45=mode==='workspace-furnishing-044-to-045-upgrade-v1';
 if(!['workspace-furnishing-036-initialize-v1','workspace-furnishing-036-reopen-v1','workspace-furnishing-039-to-040-upgrade-v1','workspace-furnishing-040-to-044-upgrade-v1','workspace-furnishing-044-to-045-upgrade-v1',...selected].includes(mode)||!channel?.isOpen())throw Error('NATIVE_OWNER_UNAVAILABLE');
 if(gpuModelPreparationDirectory&&(!modelPreparationDirectory||mode!=='workspace-furnishing-036-reopen-v1'||workspaceFurnishingThumbnailDirectory||infoStandPreparationDirectory||freshImageDirectory||largeModelDirectory||catalog045PreReady))throw Error('FURNISHING_ADMISSION_INVALID');
 if(workspaceFurnishingThumbnailDirectory&&(!modelPreparationDirectory||infoStandPreparationDirectory||freshImageDirectory||largeModelDirectory||catalog045PreReady||upgrade||upgrade44||upgrade45||selected.includes(mode)))throw Error('FURNISHING_ADMISSION_INVALID');
 if(infoStandPreparationDirectory&&(!modelPreparationDirectory||freshImageDirectory||largeModelDirectory||upgrade||upgrade44||upgrade45||selected.includes(mode)))throw Error('FURNISHING_ADMISSION_INVALID');
 if((freshImageDirectory||largeModelDirectory)&&(!modelPreparationDirectory||freshImageDirectory&&largeModelDirectory||upgrade||upgrade44||upgrade45||selected.includes(mode)))throw Error('FURNISHING_ADMISSION_INVALID');
 if(modelPreparationDirectory&&(!hayesReleaseDirectory||upgrade44||upgrade||selected.includes(mode)))throw Error('FURNISHING_ADMISSION_INVALID');
 if(upgrade45&&(!modelPreparationDirectory||!hayesChannel?.isOpen()||!ordinaryAdmission||!writer||!Number.isSafeInteger(ownerUid)||ownerUid<0))throw Error('FURNISHING_ADMISSION_INVALID');
 if(hayesReleaseDirectory&&!hayesDispositionDirectory)throw Error('FURNISHING_ADMISSION_INVALID');
 if(hayesDispositionDirectory&&!hayesOriginalDirectory)throw Error('FURNISHING_ADMISSION_INVALID');
 if(hayesOriginalDirectory&&(!framePreparationDirectory||upgrade||selected.includes(mode)))throw Error('FURNISHING_ADMISSION_INVALID');
 if(framePreparationDirectory&&(!materialMultimapDirectory||upgrade||selected.includes(mode)))throw Error('FURNISHING_ADMISSION_INVALID');
 if(upgrade44&&(!hayesChannel?.isOpen()||!ordinaryAdmission||!writer||!writerDirectory||!publicationDirectory||!materialPublicationDirectory||!materialMultimapDirectory||!framePreparationDirectory||!hayesOriginalDirectory||!hayesDispositionDirectory||!hayesReleaseDirectory||!Number.isSafeInteger(ownerUid)||ownerUid<0))throw Error('FURNISHING_ADMISSION_INVALID');
 if(upgrade&&(!ordinaryAdmission||!writer||!writerDirectory||!publicationDirectory||!materialPublicationDirectory||!materialMultimapDirectory||!Number.isSafeInteger(ownerUid)||ownerUid<0))throw Error('FURNISHING_ADMISSION_INVALID');
 if(selected.includes(mode)&&(!publicationDirectory||!writer||!ordinaryAdmission)||mode==='workspace-furnishing-039-selected-import-v7'&&(!materialPublicationDirectory||materialMultimapDirectory)||mode==='workspace-furnishing-040-selected-import-v7'&&(!materialPublicationDirectory||!materialMultimapDirectory)||mode==='workspace-furnishing-038-selected-import-v7'&&(materialPublicationDirectory||materialMultimapDirectory))throw Error('FURNISHING_ADMISSION_INVALID');
 if(ordinaryAdmission!==undefined){assertIssuedFurnishingOrdinaryAdmission(ordinaryAdmission);if((ordinaryAdmission.fields.admissionKind==='catalog-upgrade-039-to-040')!==upgrade||(ordinaryAdmission.fields.admissionKind==='catalog-upgrade-040-to-044')!==upgrade44||(ordinaryAdmission.fields.admissionKind==='catalog-upgrade-044-to-045')!==upgrade45||ordinaryAdmission.writer!==writer||(ordinaryAdmission.fields.admissionKind==='fresh-empty')!==(['workspace-furnishing-036-initialize-v1',...selected].includes(mode)))throw Error('FURNISHING_ADMISSION_INVALID');}
 if(catalog045PreReady&&(!modelPreparationDirectory||largeModelDirectory||freshImageDirectory||infoStandPreparationDirectory||mode!=='workspace-furnishing-036-reopen-v1'||!['clean-reopen','interrupted-reopen'].includes(ordinaryAdmission?.fields.admissionKind)))throw Error('FURNISHING_ADMISSION_INVALID');
 const preservePreReady=catalog045PreReady&&ordinaryAdmission?.fields.admissionKind==='interrupted-reopen';
 const preserveCombinedThumbnail=Boolean(currentImageThumbnailDirectory&&workspaceFurnishingThumbnailDirectory)&&ordinaryAdmission?.fields.admissionKind==='interrupted-reopen'&&mode==='workspace-furnishing-036-reopen-v1';
 if(preReadyHayesCompletion&&!preservePreReady)throw Error('FURNISHING_ADMISSION_INVALID');
 if(ordinaryAdmission?.fields.admissionKind==='interrupted-reopen'&&(!preservePreReady&&!preserveCombinedThumbnail&&!freshImageDirectory&&!(largeModelDirectory&&allowLargeModelInterrupted)||mode!=='workspace-furnishing-036-reopen-v1'))throw Error('FURNISHING_ADMISSION_INVALID');
 if(writerDirectory!==undefined||writer!==undefined){assertIssuedFurnishingWriterLease(writer);if(!writerDirectory||writer.identity.mode!==mode)throw Error('FURNISHING_LEASE_INVALID');await writer.assertLive();}
 if(publicationDirectory&&!writerDirectory||materialPublicationDirectory&&!publicationDirectory||materialMultimapDirectory&&!materialPublicationDirectory)throw Error('NATIVE_OEX_CATALOG');
 if(currentImageThumbnailDirectory&&(!modelPreparationDirectory||gpuModelPreparationDirectory||infoStandPreparationDirectory||freshImageDirectory||largeModelDirectory||catalog045PreReady||upgrade||upgrade44||upgrade45||selected.includes(mode)))throw Error('FURNISHING_ADMISSION_INVALID');
 const writerOptions={...(currentImageThumbnailDirectory?{currentImageThumbnailDirectory}:{}),...(gpuModelPreparationDirectory?{gpuModelPreparationDirectory}:{}),...(workspaceFurnishingThumbnailDirectory?{workspaceFurnishingThumbnailDirectory}:{}),...(infoStandPreparationDirectory?{infoStandPreparationDirectory}:{}),...(writerDirectory?{workspaceFurnishingWriterDirectory:writerDirectory}:{}),...(publicationDirectory?{workspaceFurnishingPublicationDirectory:publicationDirectory}:{}),...(materialPublicationDirectory?{workspaceMaterialPublicationDirectory:materialPublicationDirectory}:{}),...(materialMultimapDirectory?{workspaceMaterialMultimapDirectory:materialMultimapDirectory}:{}),...(framePreparationDirectory?{workspaceFramePreparationDirectory:framePreparationDirectory}:{}),...(hayesOriginalDirectory?{hayesOriginalDirectory}:{}),...(hayesDispositionDirectory?{hayesDispositionDirectory}:{}),...(hayesReleaseDirectory?{hayesReleaseDirectory}:{}),...(modelPreparationDirectory?{modelPreparationDirectory}:{}),...(freshImageDirectory?{freshImageDirectory}:{}),...(largeModelDirectory?{largeModelDirectory}:{})};
 await c.query('SELECT pg_advisory_xact_lock(82001)');
 const occupied=(await c.query("SELECT EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND (n.nspname<>'public' OR EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace=n.oid AND c.relkind IN ('r','p','v','m','S','f')) OR EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace=n.oid) OR EXISTS(SELECT 1 FROM pg_type t WHERE t.typnamespace=n.oid AND t.typtype IN ('e','d','c')))) AS occupied")).rows[0]?.occupied;
 if(occupied!==false){
  if(ordinaryAdmission?.fields.admissionKind==='fresh-empty')throw Error('FRESH_DATABASE_OCCUPIED');
  if(occupied!==true||(await c.query("SELECT to_regclass('public.schema_migrations') AS name")).rows[0]?.name==null)throw Error('FRESH_DATABASE_OCCUPIED');
  const rows=(await c.query('SELECT name,sha256 FROM public.schema_migrations ORDER BY name')).rows;
  if(upgrade){
   // Owner/ledger checks and 040 run in openLocalWorkspace's transaction; any
   // later identity, token, channel or commit failure rolls all of this back.
   if(rows.length!==39||!await recognizeNormalOexCatalog(c,base,normal,{workspaceImportDirectory:imports,workspaceWallImportDirectory:wall,workspaceFurnishingDirectory:furnishing,...writerOptions}))throw Error('NATIVE_OEX_CATALOG');
   await assertExactWorkspaceMaterialPublicationCatalog(c);
   const identity=writer.identity,owner=await c.query("SELECT 1 FROM local_workspaces w JOIN memberships m ON m.tenant_id=w.tenant_id AND m.user_id=w.user_id JOIN users u ON u.id=m.user_id JOIN tenants t ON t.id=m.tenant_id WHERE w.id=$1 AND w.tenant_id=$2 AND w.user_id=$3 AND w.mac_uid=$4 AND m.role='admin' AND NOT u.disabled AND t.deleted_at IS NULL FOR UPDATE OF w",[identity.workspaceId,identity.tenantId,identity.principalId,ownerUid]);
   if(owner.rowCount!==1)throw Error('LOCAL_WORKSPACE_OWNER_UNAVAILABLE');
   const sql=await verifyWorkspaceMaterialMultimapMigration(materialMultimapDirectory);
   await writer.assertLive();if(!channel.isOpen())throw Error('NATIVE_OWNER_UNAVAILABLE');
   await c.query(sql);await c.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',[WORKSPACE_MATERIAL_MULTIMAP_MIGRATION,WORKSPACE_MATERIAL_MULTIMAP_SHA256]);
   await assertExactWorkspaceMaterialMultimapCatalog(c);
   if(!await recognizeNormalOexCatalog(c,base,normal,{workspaceImportDirectory:imports,workspaceWallImportDirectory:wall,workspaceFurnishingDirectory:furnishing,...writerOptions})||!channel.isOpen())throw Error('NATIVE_OEX_CATALOG');
  }else if(upgrade44){
   // One explicit owner-issued transition, in the same workspace transaction.
   // Any later writer/channel/identity failure rolls back every migration.
   if(rows.length!==40||!await recognizeNormalOexCatalog(c,base,normal,{workspaceImportDirectory:imports,workspaceWallImportDirectory:wall,workspaceFurnishingDirectory:furnishing,...writerOptions}))throw Error('NATIVE_OEX_CATALOG');
   await assertExactWorkspaceMaterialMultimapCatalog(c);
   const identity=writer.identity,owner=await c.query("SELECT 1 FROM local_workspaces w JOIN memberships m ON m.tenant_id=w.tenant_id AND m.user_id=w.user_id JOIN users u ON u.id=m.user_id JOIN tenants t ON t.id=m.tenant_id WHERE w.id=$1 AND w.tenant_id=$2 AND w.user_id=$3 AND w.mac_uid=$4 AND m.role='admin' AND NOT u.disabled AND t.deleted_at IS NULL FOR UPDATE OF w",[identity.workspaceId,identity.tenantId,identity.principalId,ownerUid]);
   if(owner.rowCount!==1)throw Error('LOCAL_WORKSPACE_OWNER_UNAVAILABLE');
   const migrations=[
    [WORKSPACE_FRAME_PREPARATION_MIGRATION,WORKSPACE_FRAME_PREPARATION_SHA256,await verifyWorkspaceFramePreparationMigration(framePreparationDirectory)],
    [HAYES_ORIGINAL_MIGRATION,HAYES_ORIGINAL_SHA256,await verifyHayesOriginalMigration(hayesOriginalDirectory)],
    [HAYES_DISPOSITION_MIGRATION,HAYES_DISPOSITION_SHA256,await verifyHayesDispositionMigration(hayesDispositionDirectory)],
    [HAYES_RELEASE_MIGRATION,HAYES_RELEASE_SHA256,await verifyHayesReleaseMigration(hayesReleaseDirectory)]
   ];
   for(const [name,hash,sql] of migrations){await writer.assertLive();if(!channel.isOpen()||!hayesChannel.isOpen())throw Error('NATIVE_OWNER_UNAVAILABLE');await c.query(sql);await c.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',[name,hash]);}
   await assertExactHayesReleaseCatalog(c);
   if(!await recognizeNormalOexCatalog(c,base,normal,{workspaceImportDirectory:imports,workspaceWallImportDirectory:wall,workspaceFurnishingDirectory:furnishing,...writerOptions})||!channel.isOpen()||!hayesChannel.isOpen())throw Error('NATIVE_OEX_CATALOG');
  }else if(upgrade45){
   // One exact current-owner 044 -> 045 supplement, never ordinary reopen.
   if(rows.length!==44||!await recognizeNormalOexCatalog(c,base,normal,{workspaceImportDirectory:imports,workspaceWallImportDirectory:wall,workspaceFurnishingDirectory:furnishing,...writerOptions}))throw Error('NATIVE_OEX_CATALOG');
   await assertExactHayesReleaseCatalog(c);
   const identity=writer.identity,owner=await c.query("SELECT 1 FROM local_workspaces w JOIN memberships m ON m.tenant_id=w.tenant_id AND m.user_id=w.user_id JOIN users u ON u.id=m.user_id JOIN tenants t ON t.id=m.tenant_id WHERE w.id=$1 AND w.tenant_id=$2 AND w.user_id=$3 AND w.mac_uid=$4 AND m.role='admin' AND NOT u.disabled AND t.deleted_at IS NULL FOR UPDATE OF w",[identity.workspaceId,identity.tenantId,identity.principalId,ownerUid]);
   if(owner.rowCount!==1)throw Error('LOCAL_WORKSPACE_OWNER_UNAVAILABLE');
   const sql=await verifyModelPreparationMigration(modelPreparationDirectory);await writer.assertLive();if(!channel.isOpen()||!hayesChannel.isOpen())throw Error('NATIVE_OWNER_UNAVAILABLE');
   await c.query(sql);await c.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',[MODEL_PREPARATION_MIGRATION,MODEL_PREPARATION_SHA256]);
   await assertExactModelPreparationCatalog(c);
   if(!await recognizeNormalOexCatalog(c,base,normal,{workspaceImportDirectory:imports,workspaceWallImportDirectory:wall,workspaceFurnishingDirectory:furnishing,...writerOptions})||!channel.isOpen()||!hayesChannel.isOpen())throw Error('NATIVE_OEX_CATALOG');
  }else if(rows.length!==(currentImageThumbnailDirectory&&workspaceFurnishingThumbnailDirectory?47:(freshImageDirectory||largeModelDirectory||infoStandPreparationDirectory||workspaceFurnishingThumbnailDirectory||currentImageThumbnailDirectory||gpuModelPreparationDirectory)?46:modelPreparationDirectory?45:hayesReleaseDirectory?44:hayesDispositionDirectory?43:hayesOriginalDirectory?42:framePreparationDirectory?41:materialMultimapDirectory?40:materialPublicationDirectory?39:publicationDirectory?38:writerDirectory?37:36)||largeModelDirectory&&rows[45]?.name!==LARGE_MODEL_MIGRATION||freshImageDirectory&&rows[45]?.name!==FRESH_IMAGE_MIGRATION||!await recognizeNormalOexCatalog(c,base,normal,{workspaceImportDirectory:imports,workspaceWallImportDirectory:wall,workspaceFurnishingDirectory:furnishing,...writerOptions})||!channel.isOpen())throw Error('NATIVE_OEX_CATALOG');
  if(gpuModelPreparationDirectory)await assertExactGpuModelPreparationCatalog(c);
  if(currentImageThumbnailDirectory&&workspaceFurnishingThumbnailDirectory)await assertExactCombinedThumbnailCatalog(c);
  else if(currentImageThumbnailDirectory)await assertExactCurrentImageThumbnailCatalog(c);
  else if(workspaceFurnishingThumbnailDirectory)await assertExactWorkspaceFurnishingThumbnailCatalog(c);
  if(preserveCombinedThumbnail)await assertCombinedThumbnailInterruptedIdle(c);
  if(preservePreReady){
   // This route preserves a stopped generation. Active or pending work is
   // outside its authority, including any cleanup that startup could resume.
   let verifiedJob=null, verifiedTenant=null;
   if(preReadyHayesCompletion){
    const {workspaceId,tenantId,principalId}=writer.identity;
    const {jobId,completionFrameSha256}=preReadyHayesCompletion;
    const release=await confirmedHayesReleaseBindings(c,tenantId,{workspaceId,principalId,jobId,completionFrameSha256});
    if(!release.has(`import_jobs:${tenantId}:${jobId}`))throw Error('FURNISHING_RECOVERY_UNAVAILABLE');
    verifiedJob=jobId;
    verifiedTenant=tenantId;
   }
   const idle=await c.query(`SELECT NOT EXISTS (
     SELECT 1 FROM public.workspace_furnishing_intakes WHERE worker_token IS NOT NULL OR phase IN ('uploading','validating','cancelling')
     UNION ALL SELECT 1 FROM public.workspace_material_intakes WHERE worker_token IS NOT NULL OR phase IN ('uploading','validating','cancelling')
     UNION ALL SELECT 1 FROM public.import_jobs WHERE state IN ('uploading','queued','processing') OR cardinality(png_worker_tokens)>0 OR model_preparation ? 'claim'
       OR ((lease_id IS NOT NULL OR lease_until IS NOT NULL) AND
         (tenant_id IS DISTINCT FROM $1::uuid OR id IS DISTINCT FROM $2::uuid))
     UNION ALL SELECT 1 FROM public.oex_import_jobs WHERE state IN ('uploading','queued','processing') OR lease_id IS NOT NULL OR lease_until IS NOT NULL OR cleanup_pending
   ) AS idle`,[verifiedTenant,verifiedJob]);
   if(idle.rows[0]?.idle!==true)throw Error('FURNISHING_RECOVERY_UNAVAILABLE');
  }
  if(writer)await writer.assertLive();
  // A committed first boot includes its owner in the same transaction. Never
  // create one when reopening or recovering an already occupied catalog.
  return {requireExisting:true};
 }
 if(!['workspace-furnishing-036-initialize-v1',...selected].includes(mode))throw Error('FRESH_DATABASE_OCCUPIED');
 const workspace=await verifyWorkspaceMaterialMigrations(normal),importPair=await verifyWorkspaceImportMigrations(imports);
 const migrations=[
  [NORMAL_OEX_MIGRATION,NORMAL_OEX_SHA256,await verifyNormalOexMigration(normal)],
  [NORMAL_OEX_PROVENANCE_MIGRATION,NORMAL_OEX_PROVENANCE_SHA256,await verifyNormalOexProvenanceMigration(normal)],
  [NORMAL_OEX_MATERIAL_MIGRATION,NORMAL_OEX_MATERIAL_SHA256,await verifyNormalOexMaterialMigration(normal)],
  [NORMAL_OEX_FLOOR_MIGRATION,NORMAL_OEX_FLOOR_SHA256,await verifyNormalOexFloorMigration(normal)],
  [NORMAL_OEX_CONCRETE_MIGRATION,NORMAL_OEX_CONCRETE_SHA256,await verifyNormalOexConcreteMigration(normal)],
  [WORKSPACE_MATERIAL_MIGRATION,WORKSPACE_MATERIAL_SHA256,workspace[0]],
  [WORKSPACE_MATERIAL_OEX_MIGRATION,WORKSPACE_MATERIAL_OEX_SHA256,workspace[1]],
  [WORKSPACE_IMPORT_STAGE_MIGRATION,WORKSPACE_IMPORT_STAGE_SHA256,importPair[0]],
  [WORKSPACE_IMPORT_PROOF_MIGRATION,WORKSPACE_IMPORT_PROOF_SHA256,importPair[1]],
  [WORKSPACE_WALL_IMPORT_MIGRATION,WORKSPACE_WALL_IMPORT_SHA256,await verifyWorkspaceWallImportMigration(wall)],
  [WORKSPACE_FURNISHING_MIGRATION,WORKSPACE_FURNISHING_SHA256,await verifyWorkspaceFurnishingMigration(furnishing)]
 ];
 if(writerDirectory)migrations.push([WORKSPACE_FURNISHING_WRITER_MIGRATION,WORKSPACE_FURNISHING_WRITER_SHA256,await verifyWorkspaceFurnishingWriterMigration(writerDirectory)]);
 if(publicationDirectory)migrations.push([WORKSPACE_FURNISHING_PUBLICATION_MIGRATION,WORKSPACE_FURNISHING_PUBLICATION_SHA256,await verifyWorkspaceFurnishingPublicationMigration(publicationDirectory)]);
 if(materialPublicationDirectory)migrations.push([WORKSPACE_MATERIAL_PUBLICATION_MIGRATION,WORKSPACE_MATERIAL_PUBLICATION_SHA256,await verifyWorkspaceMaterialPublicationMigration(materialPublicationDirectory)]);
 if(materialMultimapDirectory)migrations.push([WORKSPACE_MATERIAL_MULTIMAP_MIGRATION,WORKSPACE_MATERIAL_MULTIMAP_SHA256,await verifyWorkspaceMaterialMultimapMigration(materialMultimapDirectory)]);
 if(framePreparationDirectory)migrations.push([WORKSPACE_FRAME_PREPARATION_MIGRATION,WORKSPACE_FRAME_PREPARATION_SHA256,await verifyWorkspaceFramePreparationMigration(framePreparationDirectory)]);
 if(hayesOriginalDirectory)migrations.push([HAYES_ORIGINAL_MIGRATION,HAYES_ORIGINAL_SHA256,await verifyHayesOriginalMigration(hayesOriginalDirectory)]);
 if(hayesDispositionDirectory)migrations.push([HAYES_DISPOSITION_MIGRATION,HAYES_DISPOSITION_SHA256,await verifyHayesDispositionMigration(hayesDispositionDirectory)]);
 if(hayesReleaseDirectory)migrations.push([HAYES_RELEASE_MIGRATION,HAYES_RELEASE_SHA256,await verifyHayesReleaseMigration(hayesReleaseDirectory)]);
 if(modelPreparationDirectory)migrations.push([MODEL_PREPARATION_MIGRATION,MODEL_PREPARATION_SHA256,await verifyModelPreparationMigration(modelPreparationDirectory)]);
 if(largeModelDirectory)migrations.push([LARGE_MODEL_MIGRATION,LARGE_MODEL_SHA256,await verifyLargeModelMigration(largeModelDirectory)]);
 if(freshImageDirectory)migrations.push([FRESH_IMAGE_MIGRATION,FRESH_IMAGE_SHA256,await verifyFreshImageMigration(freshImageDirectory)]);
 if(infoStandPreparationDirectory)migrations.push([INFO_STAND_PREPARATION_MIGRATION,INFO_STAND_PREPARATION_SHA256,await verifyInfoStandPreparationMigration(infoStandPreparationDirectory)]);
 if(currentImageThumbnailDirectory)migrations.push([CURRENT_IMAGE_THUMBNAIL_MIGRATION,CURRENT_IMAGE_THUMBNAIL_SHA256,await verifyCurrentImageThumbnailMigration(currentImageThumbnailDirectory)]);
 if(workspaceFurnishingThumbnailDirectory)migrations.push([WORKSPACE_FURNISHING_THUMBNAIL_MIGRATION,WORKSPACE_FURNISHING_THUMBNAIL_SHA256,await verifyWorkspaceFurnishingThumbnailMigration(workspaceFurnishingThumbnailDirectory)]);
 if(!channel.isOpen())throw Error('NATIVE_OWNER_UNAVAILABLE');
 await migrateInTransaction(c,base);
 for(const [name,hash,sql] of migrations){await c.query(sql);await c.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',[name,hash]);}
 if(!await recognizeNormalOexCatalog(c,base,normal,{workspaceImportDirectory:imports,workspaceWallImportDirectory:wall,workspaceFurnishingDirectory:furnishing,...writerOptions})||!channel.isOpen())throw Error('NATIVE_OEX_CATALOG');
 if(writer)await writer.assertLive();
}

/** Fixed, sealed 045 -> 050 helper. Caller owns the transaction and returns from
 * the process after commit/drain; this never opens a workspace/session or worker. */
export async function upgradeWorkspaceFurnishingThumbnailCatalog(c,{mode,ownerUid,writer,ordinaryAdmission,channel,isStopped,catalog}){
 const upgrade='workspace-furnishing-045-to-050-upgrade-v1';
 assertIssuedFurnishingOrdinaryAdmission(ordinaryAdmission);assertIssuedFurnishingWriterLease(writer);
 if(mode!==upgrade||writer.identity.mode!==upgrade||ordinaryAdmission.writer!==writer||ordinaryAdmission.fields.admissionKind!=='catalog-upgrade-045-to-050'||!Number.isSafeInteger(ownerUid)||ownerUid<0||typeof isStopped!=='function')throw Error('FURNISHING_ADMISSION_INVALID');
 const live=async()=>{await writer.assertLive();if(isStopped()||!channel?.isOpen())throw Error('NATIVE_OWNER_UNAVAILABLE');};
 const {base,normal,...options}=catalog;
 if(options.currentImageThumbnailDirectory||!options.modelPreparationDirectory||!options.workspaceFurnishingThumbnailDirectory||options.infoStandPreparationDirectory||options.largeModelDirectory||options.freshImageDirectory)throw Error('NATIVE_OEX_CATALOG');
 const sql=await verifyWorkspaceFurnishingThumbnailMigration(options.workspaceFurnishingThumbnailDirectory);await live();
 // Same lock order as ordinary exclusive furnishing open, without its writes.
 await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
 await c.query('SELECT pg_advisory_xact_lock(82003)');await c.query('SELECT pg_advisory_xact_lock(82002)');await c.query('SELECT pg_advisory_xact_lock(82001)');
 const rows=(await c.query('SELECT name,sha256 FROM public.schema_migrations ORDER BY name')).rows,apply=rows.length===45;
 if(rows.length===45)await assertExactModelPreparationCatalog(c);else if(rows.length===46)await assertExactWorkspaceFurnishingThumbnailCatalog(c);else throw Error('NATIVE_OEX_CATALOG');
 if(!await recognizeNormalOexCatalog(c,base,normal,options))throw Error('NATIVE_OEX_CATALOG');
 const identity=writer.identity,owner=await c.query("SELECT 1 FROM local_workspaces w JOIN memberships m ON m.tenant_id=w.tenant_id AND m.user_id=w.user_id JOIN users u ON u.id=m.user_id JOIN tenants t ON t.id=m.tenant_id WHERE w.id=$1 AND w.tenant_id=$2 AND w.user_id=$3 AND w.mac_uid=$4 AND m.role='admin' AND NOT u.disabled AND t.deleted_at IS NULL FOR SHARE OF w",[identity.workspaceId,identity.tenantId,identity.principalId,ownerUid]);
 if(owner.rowCount!==1)throw Error('LOCAL_WORKSPACE_OWNER_UNAVAILABLE');
 const pending=await c.query('SELECT EXISTS (SELECT 1 FROM workspace_furnishing_intakes WHERE worker_token IS NOT NULL) AS pending');if(pending.rows[0]?.pending!==false)throw Error('FURNISHING_RECOVERY_UNAVAILABLE');
 await live();
 if(apply){await c.query(sql);await c.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',[WORKSPACE_FURNISHING_THUMBNAIL_MIGRATION,WORKSPACE_FURNISHING_THUMBNAIL_SHA256]);}
 await assertExactWorkspaceFurnishingThumbnailCatalog(c);if(!await recognizeNormalOexCatalog(c,base,normal,options))throw Error('NATIVE_OEX_CATALOG');await live();
 return {state:apply?'applied':'already-applied'};
}

export async function upgradeCurrentImageThumbnailCatalog(c,{mode,ownerUid,writer,ordinaryAdmission,channel,isStopped,catalog}){
 const upgrade='workspace-furnishing-045-to-051-upgrade-v1';
 assertIssuedFurnishingOrdinaryAdmission(ordinaryAdmission);assertIssuedFurnishingWriterLease(writer);
 if(mode!==upgrade||writer.identity.mode!==upgrade||ordinaryAdmission.writer!==writer||ordinaryAdmission.fields.admissionKind!=='catalog-upgrade-045-to-051'||!Number.isSafeInteger(ownerUid)||ownerUid<0||typeof isStopped!=='function')throw Error('FURNISHING_ADMISSION_INVALID');
 const live=async()=>{await writer.assertLive();if(isStopped()||!channel?.isOpen())throw Error('NATIVE_OWNER_UNAVAILABLE');};
 const {base,normal,...options}=catalog;
 if(options.workspaceFurnishingThumbnailDirectory||!options.modelPreparationDirectory||!options.currentImageThumbnailDirectory||options.infoStandPreparationDirectory||options.largeModelDirectory||options.freshImageDirectory)throw Error('NATIVE_OEX_CATALOG');
 const sql=await verifyCurrentImageThumbnailMigration(options.currentImageThumbnailDirectory);await live();
 // Same lock order as ordinary exclusive furnishing open, without its writes.
 await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
 await c.query('SELECT pg_advisory_xact_lock(82003)');await c.query('SELECT pg_advisory_xact_lock(82002)');await c.query('SELECT pg_advisory_xact_lock(82001)');
 const rows=(await c.query('SELECT name,sha256 FROM public.schema_migrations ORDER BY name')).rows,apply=rows.length===45;
 if(rows.length===45)await assertExactModelPreparationCatalog(c);else if(rows.length===46)await assertExactCurrentImageThumbnailCatalog(c);else throw Error('NATIVE_OEX_CATALOG');
 if(!await recognizeNormalOexCatalog(c,base,normal,options))throw Error('NATIVE_OEX_CATALOG');
 const identity=writer.identity,owner=await c.query("SELECT 1 FROM local_workspaces w JOIN memberships m ON m.tenant_id=w.tenant_id AND m.user_id=w.user_id JOIN users u ON u.id=m.user_id JOIN tenants t ON t.id=m.tenant_id WHERE w.id=$1 AND w.tenant_id=$2 AND w.user_id=$3 AND w.mac_uid=$4 AND m.role='admin' AND NOT u.disabled AND t.deleted_at IS NULL FOR SHARE OF w",[identity.workspaceId,identity.tenantId,identity.principalId,ownerUid]);
 if(owner.rowCount!==1)throw Error('LOCAL_WORKSPACE_OWNER_UNAVAILABLE');
 const pending=await c.query('SELECT EXISTS (SELECT 1 FROM workspace_furnishing_intakes WHERE worker_token IS NOT NULL) AS pending');if(pending.rows[0]?.pending!==false)throw Error('FURNISHING_RECOVERY_UNAVAILABLE');
 await live();
 if(apply){await c.query(sql);await c.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',[CURRENT_IMAGE_THUMBNAIL_MIGRATION,CURRENT_IMAGE_THUMBNAIL_SHA256]);}
 await assertExactCurrentImageThumbnailCatalog(c);if(!await recognizeNormalOexCatalog(c,base,normal,options))throw Error('NATIVE_OEX_CATALOG');await live();
 return {state:apply?'applied':'already-applied'};
}

/** Sealed current051 -> existing050+051 transition; never replays051 SQL. */
export async function upgradeCombinedThumbnailCatalog(c,{mode,ownerUid,writer,ordinaryAdmission,channel,isStopped,catalog}){
 const upgrade='workspace-furnishing-051-to-050-051-upgrade-v1';
 assertIssuedFurnishingOrdinaryAdmission(ordinaryAdmission);assertIssuedFurnishingWriterLease(writer);
 if(mode!==upgrade||writer.identity.mode!==upgrade||ordinaryAdmission.writer!==writer||ordinaryAdmission.fields.admissionKind!=='catalog-upgrade-051-to-050-051'||!Number.isSafeInteger(ownerUid)||ownerUid<0||typeof isStopped!=='function')throw Error('FURNISHING_ADMISSION_INVALID');
 const live=async()=>{await writer.assertLive();if(isStopped()||!channel?.isOpen())throw Error('NATIVE_OWNER_UNAVAILABLE');};
 const {base,normal,...options}=catalog;
 if(!options.modelPreparationDirectory||!options.currentImageThumbnailDirectory||!options.workspaceFurnishingThumbnailDirectory||options.infoStandPreparationDirectory||options.largeModelDirectory||options.freshImageDirectory)throw Error('NATIVE_OEX_CATALOG');
 const sql=await verifyWorkspaceFurnishingThumbnailMigration(options.workspaceFurnishingThumbnailDirectory);await live();
 // Same lock order as ordinary exclusive furnishing open, without its writes.
 await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
 await c.query('SELECT pg_advisory_xact_lock(82003)');await c.query('SELECT pg_advisory_xact_lock(82002)');await c.query('SELECT pg_advisory_xact_lock(82001)');
 const rows=(await c.query('SELECT name,sha256 FROM public.schema_migrations ORDER BY name')).rows,apply=rows.length===46;
 if(rows.length===46)await assertExactCurrentImageThumbnailCatalog(c);else if(rows.length===47)await assertExactCombinedThumbnailCatalog(c);else throw Error('NATIVE_OEX_CATALOG');
 if(!await recognizeNormalOexCatalog(c,base,normal,options))throw Error('NATIVE_OEX_CATALOG');
 const identity=writer.identity,owner=await c.query("SELECT 1 FROM local_workspaces w JOIN memberships m ON m.tenant_id=w.tenant_id AND m.user_id=w.user_id JOIN users u ON u.id=m.user_id JOIN tenants t ON t.id=m.tenant_id WHERE w.id=$1 AND w.tenant_id=$2 AND w.user_id=$3 AND w.mac_uid=$4 AND m.role='admin' AND NOT u.disabled AND t.deleted_at IS NULL FOR SHARE OF w",[identity.workspaceId,identity.tenantId,identity.principalId,ownerUid]);
 if(owner.rowCount!==1)throw Error('LOCAL_WORKSPACE_OWNER_UNAVAILABLE');
 const pending=await c.query('SELECT EXISTS (SELECT 1 FROM workspace_furnishing_intakes WHERE worker_token IS NOT NULL) AS pending');if(pending.rows[0]?.pending!==false)throw Error('FURNISHING_RECOVERY_UNAVAILABLE');
 await live();
 if(apply){await c.query(sql);await c.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',[WORKSPACE_FURNISHING_THUMBNAIL_MIGRATION,WORKSPACE_FURNISHING_THUMBNAIL_SHA256]);}
 await assertExactCombinedThumbnailCatalog(c);if(!await recognizeNormalOexCatalog(c,base,normal,options))throw Error('NATIVE_OEX_CATALOG');await live();
 return {state:apply?'applied':'already-applied'};
}
