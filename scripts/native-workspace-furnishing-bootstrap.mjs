// SPDX-License-Identifier: AGPL-3.0-or-later
// Called only inside openLocalWorkspace's transaction, before owner/session
// writes. The caller must supply the authenticated inherited owner channel.
import {HAYES_RELEASE_MIGRATION,HAYES_RELEASE_SHA256,verifyHayesReleaseMigration,assertExactHayesReleaseCatalog} from './native-oex-normal-catalog.mjs';
import {HAYES_DISPOSITION_MIGRATION,HAYES_DISPOSITION_SHA256,verifyHayesDispositionMigration,assertExactHayesDispositionCatalog} from './native-oex-normal-catalog.mjs';
import {HAYES_ORIGINAL_MIGRATION,HAYES_ORIGINAL_SHA256,verifyHayesOriginalMigration,assertExactHayesOriginalCatalog,WORKSPACE_FRAME_PREPARATION_MIGRATION,WORKSPACE_FRAME_PREPARATION_SHA256,verifyWorkspaceFramePreparationMigration,assertExactWorkspaceFramePreparationCatalog} from './native-oex-normal-catalog.mjs';
import {WORKSPACE_MATERIAL_PUBLICATION_MIGRATION,WORKSPACE_MATERIAL_PUBLICATION_SHA256,verifyWorkspaceMaterialPublicationMigration} from './native-oex-normal-catalog.mjs';
import {WORKSPACE_MATERIAL_MULTIMAP_MIGRATION,WORKSPACE_MATERIAL_MULTIMAP_SHA256,verifyWorkspaceMaterialMultimapMigration} from './native-oex-normal-catalog.mjs';
import {migrateInTransaction} from '../packages/storage/dist/index.js';
import {assertIssuedFurnishingWriterLease,assertIssuedFurnishingOrdinaryAdmission} from './native-workspace-furnishing-admission.mjs';
import {verifyWorkspaceFurnishingWriterMigration,WORKSPACE_FURNISHING_WRITER_MIGRATION,WORKSPACE_FURNISHING_WRITER_SHA256,verifyWorkspaceFurnishingPublicationMigration,WORKSPACE_FURNISHING_PUBLICATION_MIGRATION,WORKSPACE_FURNISHING_PUBLICATION_SHA256} from './native-oex-normal-catalog.mjs';
import {assertExactWorkspaceMaterialPublicationCatalog,assertExactWorkspaceMaterialMultimapCatalog,recognizeNormalOexCatalog,verifyNormalOexMigration,verifyNormalOexProvenanceMigration,verifyNormalOexMaterialMigration,verifyNormalOexFloorMigration,verifyNormalOexConcreteMigration,verifyWorkspaceMaterialMigrations,verifyWorkspaceImportMigrations,verifyWorkspaceWallImportMigration,verifyWorkspaceFurnishingMigration,NORMAL_OEX_MIGRATION,NORMAL_OEX_SHA256,NORMAL_OEX_PROVENANCE_MIGRATION,NORMAL_OEX_PROVENANCE_SHA256,NORMAL_OEX_MATERIAL_MIGRATION,NORMAL_OEX_MATERIAL_SHA256,NORMAL_OEX_FLOOR_MIGRATION,NORMAL_OEX_FLOOR_SHA256,NORMAL_OEX_CONCRETE_MIGRATION,NORMAL_OEX_CONCRETE_SHA256,WORKSPACE_MATERIAL_MIGRATION,WORKSPACE_MATERIAL_SHA256,WORKSPACE_MATERIAL_OEX_MIGRATION,WORKSPACE_MATERIAL_OEX_SHA256,WORKSPACE_IMPORT_STAGE_MIGRATION,WORKSPACE_IMPORT_STAGE_SHA256,WORKSPACE_IMPORT_PROOF_MIGRATION,WORKSPACE_IMPORT_PROOF_SHA256,WORKSPACE_WALL_IMPORT_MIGRATION,WORKSPACE_WALL_IMPORT_SHA256,WORKSPACE_FURNISHING_MIGRATION,WORKSPACE_FURNISHING_SHA256} from './native-oex-normal-catalog.mjs';

// Only the authenticated, generation-bound Manager lifecycle assertion may
// select these modes. The database's exclusive token check remains mandatory;
// this admission never reclaims an unknown predecessor's retained work.
export async function assertWorkspaceFurnishingRuntimeAdmission(mode,admission){
 const upgrade='workspace-furnishing-039-to-040-upgrade-v1',init='workspace-furnishing-036-initialize-v1',reopen='workspace-furnishing-036-reopen-v1',selected='workspace-furnishing-038-selected-import-v7',selected39='workspace-furnishing-039-selected-import-v7',selected40='workspace-furnishing-040-selected-import-v7';
 if(mode!==init&&mode!==reopen&&mode!==upgrade&&mode!==selected&&mode!==selected39&&mode!==selected40)return;
 assertIssuedFurnishingOrdinaryAdmission(admission);
 if(admission.writer.identity.mode!==mode||(mode===upgrade?admission.fields.admissionKind!=='catalog-upgrade-039-to-040':mode===init||mode===selected||mode===selected39||mode===selected40?admission.fields.admissionKind!=='fresh-empty':!['clean-reopen','verified-restore'].includes(admission.fields.admissionKind)))throw Error('FURNISHING_ADMISSION_INVALID');
 await admission.writer.assertLive();
}

/** Recheck the ledger before the last asynchronous writer/payload fence. */
export async function assertFurnishingBeforeCommit(c,{mode,ordinaryAdmission,writer,channel,isStopped,framePreparation=false,hayesOriginal=false,hayesDisposition=false,hayesRelease=false}){
 assertIssuedFurnishingOrdinaryAdmission(ordinaryAdmission);
 if(ordinaryAdmission.writer!==writer||writer.identity.mode!==mode)throw Error('FURNISHING_ADMISSION_INVALID');
 if(mode==='workspace-furnishing-039-to-040-upgrade-v1')await assertExactWorkspaceMaterialMultimapCatalog(c);
 if(hayesRelease)await assertExactHayesReleaseCatalog(c);else if(hayesDisposition)await assertExactHayesDispositionCatalog(c);else if(hayesOriginal)await assertExactHayesOriginalCatalog(c);else if(framePreparation)await assertExactWorkspaceFramePreparationCatalog(c);
 await writer.assertLive();
 if(isStopped()||!channel?.isOpen())throw Error('NATIVE_OWNER_UNAVAILABLE');
}

export async function prepareWorkspaceFurnishingCatalog(c,{mode,base,normal,imports,wall,furnishing,writerDirectory,publicationDirectory,materialPublicationDirectory,materialMultimapDirectory,framePreparationDirectory,hayesOriginalDirectory,hayesDispositionDirectory,hayesReleaseDirectory,ownerUid,writer,channel,ordinaryAdmission}){
 const selected=['workspace-furnishing-038-selected-import-v7','workspace-furnishing-039-selected-import-v7','workspace-furnishing-040-selected-import-v7'];
 const upgrade=mode==='workspace-furnishing-039-to-040-upgrade-v1';
 if(!['workspace-furnishing-036-initialize-v1','workspace-furnishing-036-reopen-v1','workspace-furnishing-039-to-040-upgrade-v1',...selected].includes(mode)||!channel?.isOpen())throw Error('NATIVE_OWNER_UNAVAILABLE');
 if(hayesReleaseDirectory&&!hayesDispositionDirectory)throw Error('FURNISHING_ADMISSION_INVALID');
 if(hayesDispositionDirectory&&!hayesOriginalDirectory)throw Error('FURNISHING_ADMISSION_INVALID');
 if(hayesOriginalDirectory&&(!framePreparationDirectory||upgrade||selected.includes(mode)))throw Error('FURNISHING_ADMISSION_INVALID');
 if(framePreparationDirectory&&(!materialMultimapDirectory||upgrade||selected.includes(mode)))throw Error('FURNISHING_ADMISSION_INVALID');
 if(upgrade&&(!ordinaryAdmission||!writer||!writerDirectory||!publicationDirectory||!materialPublicationDirectory||!materialMultimapDirectory||!Number.isSafeInteger(ownerUid)||ownerUid<0))throw Error('FURNISHING_ADMISSION_INVALID');
 if(selected.includes(mode)&&(!publicationDirectory||!writer||!ordinaryAdmission)||mode==='workspace-furnishing-039-selected-import-v7'&&(!materialPublicationDirectory||materialMultimapDirectory)||mode==='workspace-furnishing-040-selected-import-v7'&&(!materialPublicationDirectory||!materialMultimapDirectory)||mode==='workspace-furnishing-038-selected-import-v7'&&(materialPublicationDirectory||materialMultimapDirectory))throw Error('FURNISHING_ADMISSION_INVALID');
 if(ordinaryAdmission!==undefined){assertIssuedFurnishingOrdinaryAdmission(ordinaryAdmission);if((ordinaryAdmission.fields.admissionKind==='catalog-upgrade-039-to-040')!==upgrade||ordinaryAdmission.writer!==writer||(ordinaryAdmission.fields.admissionKind==='fresh-empty')!==(['workspace-furnishing-036-initialize-v1',...selected].includes(mode)))throw Error('FURNISHING_ADMISSION_INVALID');}
 if(writerDirectory!==undefined||writer!==undefined){assertIssuedFurnishingWriterLease(writer);if(!writerDirectory||writer.identity.mode!==mode)throw Error('FURNISHING_LEASE_INVALID');await writer.assertLive();}
 if(publicationDirectory&&!writerDirectory||materialPublicationDirectory&&!publicationDirectory||materialMultimapDirectory&&!materialPublicationDirectory)throw Error('NATIVE_OEX_CATALOG');
 const writerOptions={...(writerDirectory?{workspaceFurnishingWriterDirectory:writerDirectory}:{}),...(publicationDirectory?{workspaceFurnishingPublicationDirectory:publicationDirectory}:{}),...(materialPublicationDirectory?{workspaceMaterialPublicationDirectory:materialPublicationDirectory}:{}),...(materialMultimapDirectory?{workspaceMaterialMultimapDirectory:materialMultimapDirectory}:{}),...(framePreparationDirectory?{workspaceFramePreparationDirectory:framePreparationDirectory}:{}),...(hayesOriginalDirectory?{hayesOriginalDirectory}:{}),...(hayesDispositionDirectory?{hayesDispositionDirectory}:{}),...(hayesReleaseDirectory?{hayesReleaseDirectory}:{})};
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
  }else if(rows.length!==(hayesReleaseDirectory?44:hayesDispositionDirectory?43:hayesOriginalDirectory?42:framePreparationDirectory?41:materialMultimapDirectory?40:materialPublicationDirectory?39:publicationDirectory?38:writerDirectory?37:36)||!await recognizeNormalOexCatalog(c,base,normal,{workspaceImportDirectory:imports,workspaceWallImportDirectory:wall,workspaceFurnishingDirectory:furnishing,...writerOptions})||!channel.isOpen())throw Error('NATIVE_OEX_CATALOG');
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
 if(!channel.isOpen())throw Error('NATIVE_OWNER_UNAVAILABLE');
 await migrateInTransaction(c,base);
 for(const [name,hash,sql] of migrations){await c.query(sql);await c.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',[name,hash]);}
 if(!await recognizeNormalOexCatalog(c,base,normal,{workspaceImportDirectory:imports,workspaceWallImportDirectory:wall,workspaceFurnishingDirectory:furnishing,...writerOptions})||!channel.isOpen())throw Error('NATIVE_OEX_CATALOG');
 if(writer)await writer.assertLive();
}
