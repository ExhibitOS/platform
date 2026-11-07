// SPDX-License-Identifier: AGPL-3.0-or-later
// Called only inside openLocalWorkspace's transaction, before owner/session
// writes. The caller must supply the authenticated inherited owner channel.
import {WORKSPACE_MATERIAL_PUBLICATION_MIGRATION,WORKSPACE_MATERIAL_PUBLICATION_SHA256,verifyWorkspaceMaterialPublicationMigration} from './native-oex-normal-catalog.mjs';
import {migrateInTransaction} from '../packages/storage/dist/index.js';
import {assertIssuedFurnishingWriterLease,assertIssuedFurnishingOrdinaryAdmission} from './native-workspace-furnishing-admission.mjs';
import {verifyWorkspaceFurnishingWriterMigration,WORKSPACE_FURNISHING_WRITER_MIGRATION,WORKSPACE_FURNISHING_WRITER_SHA256,verifyWorkspaceFurnishingPublicationMigration,WORKSPACE_FURNISHING_PUBLICATION_MIGRATION,WORKSPACE_FURNISHING_PUBLICATION_SHA256} from './native-oex-normal-catalog.mjs';
import {recognizeNormalOexCatalog,verifyNormalOexMigration,verifyNormalOexProvenanceMigration,verifyNormalOexMaterialMigration,verifyNormalOexFloorMigration,verifyNormalOexConcreteMigration,verifyWorkspaceMaterialMigrations,verifyWorkspaceImportMigrations,verifyWorkspaceWallImportMigration,verifyWorkspaceFurnishingMigration,NORMAL_OEX_MIGRATION,NORMAL_OEX_SHA256,NORMAL_OEX_PROVENANCE_MIGRATION,NORMAL_OEX_PROVENANCE_SHA256,NORMAL_OEX_MATERIAL_MIGRATION,NORMAL_OEX_MATERIAL_SHA256,NORMAL_OEX_FLOOR_MIGRATION,NORMAL_OEX_FLOOR_SHA256,NORMAL_OEX_CONCRETE_MIGRATION,NORMAL_OEX_CONCRETE_SHA256,WORKSPACE_MATERIAL_MIGRATION,WORKSPACE_MATERIAL_SHA256,WORKSPACE_MATERIAL_OEX_MIGRATION,WORKSPACE_MATERIAL_OEX_SHA256,WORKSPACE_IMPORT_STAGE_MIGRATION,WORKSPACE_IMPORT_STAGE_SHA256,WORKSPACE_IMPORT_PROOF_MIGRATION,WORKSPACE_IMPORT_PROOF_SHA256,WORKSPACE_WALL_IMPORT_MIGRATION,WORKSPACE_WALL_IMPORT_SHA256,WORKSPACE_FURNISHING_MIGRATION,WORKSPACE_FURNISHING_SHA256} from './native-oex-normal-catalog.mjs';

// Only the authenticated, generation-bound Manager lifecycle assertion may
// select these modes. The database's exclusive token check remains mandatory;
// this admission never reclaims an unknown predecessor's retained work.
export async function assertWorkspaceFurnishingRuntimeAdmission(mode,admission){
 const init='workspace-furnishing-036-initialize-v1',reopen='workspace-furnishing-036-reopen-v1',selected='workspace-furnishing-038-selected-import-v7',selected39='workspace-furnishing-039-selected-import-v7';
 if(mode!==init&&mode!==reopen&&mode!==selected&&mode!==selected39)return;
 assertIssuedFurnishingOrdinaryAdmission(admission);
 if(admission.writer.identity.mode!==mode||(mode===init||mode===selected||mode===selected39?admission.fields.admissionKind!=='fresh-empty':!['clean-reopen','verified-restore'].includes(admission.fields.admissionKind)))throw Error('FURNISHING_ADMISSION_INVALID');
 await admission.writer.assertLive();
}

export async function prepareWorkspaceFurnishingCatalog(c,{mode,base,normal,imports,wall,furnishing,writerDirectory,publicationDirectory,materialPublicationDirectory,writer,channel,ordinaryAdmission}){
 if(!['workspace-furnishing-036-initialize-v1','workspace-furnishing-036-reopen-v1','workspace-furnishing-038-selected-import-v7','workspace-furnishing-039-selected-import-v7'].includes(mode)||!channel?.isOpen())throw Error('NATIVE_OWNER_UNAVAILABLE');
 if(['workspace-furnishing-038-selected-import-v7','workspace-furnishing-039-selected-import-v7'].includes(mode)&&(!publicationDirectory||!writer||!ordinaryAdmission)||mode==='workspace-furnishing-039-selected-import-v7'&&!materialPublicationDirectory||mode==='workspace-furnishing-038-selected-import-v7'&&materialPublicationDirectory)throw Error('FURNISHING_ADMISSION_INVALID');
 if(ordinaryAdmission!==undefined){assertIssuedFurnishingOrdinaryAdmission(ordinaryAdmission);if(ordinaryAdmission.writer!==writer||(ordinaryAdmission.fields.admissionKind==='fresh-empty')!==(['workspace-furnishing-036-initialize-v1','workspace-furnishing-038-selected-import-v7','workspace-furnishing-039-selected-import-v7'].includes(mode)))throw Error('FURNISHING_ADMISSION_INVALID');}
 if(writerDirectory!==undefined||writer!==undefined){assertIssuedFurnishingWriterLease(writer);if(!writerDirectory||writer.identity.mode!==mode)throw Error('FURNISHING_LEASE_INVALID');await writer.assertLive();}
 if(publicationDirectory&&!writerDirectory||materialPublicationDirectory&&!publicationDirectory)throw Error('NATIVE_OEX_CATALOG');
 const writerOptions={...(writerDirectory?{workspaceFurnishingWriterDirectory:writerDirectory}:{}),...(publicationDirectory?{workspaceFurnishingPublicationDirectory:publicationDirectory}:{}),...(materialPublicationDirectory?{workspaceMaterialPublicationDirectory:materialPublicationDirectory}:{})};
 await c.query('SELECT pg_advisory_xact_lock(82001)');
 const occupied=(await c.query("SELECT EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND (n.nspname<>'public' OR EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace=n.oid AND c.relkind IN ('r','p','v','m','S','f')) OR EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace=n.oid) OR EXISTS(SELECT 1 FROM pg_type t WHERE t.typnamespace=n.oid AND t.typtype IN ('e','d','c')))) AS occupied")).rows[0]?.occupied;
 if(occupied!==false){
  if(ordinaryAdmission?.fields.admissionKind==='fresh-empty')throw Error('FRESH_DATABASE_OCCUPIED');
  if(occupied!==true||(await c.query("SELECT to_regclass('public.schema_migrations') AS name")).rows[0]?.name==null)throw Error('FRESH_DATABASE_OCCUPIED');
  const rows=(await c.query('SELECT name,sha256 FROM public.schema_migrations ORDER BY name')).rows;
  if(rows.length!==(materialPublicationDirectory?39:publicationDirectory?38:writerDirectory?37:36)||!await recognizeNormalOexCatalog(c,base,normal,{workspaceImportDirectory:imports,workspaceWallImportDirectory:wall,workspaceFurnishingDirectory:furnishing,...writerOptions})||!channel.isOpen())throw Error('NATIVE_OEX_CATALOG');
  if(writer)await writer.assertLive();
  // A committed first boot includes its owner in the same transaction. Never
  // create one when reopening or recovering an already occupied catalog.
  return {requireExisting:true};
 }
 if(!['workspace-furnishing-036-initialize-v1','workspace-furnishing-038-selected-import-v7','workspace-furnishing-039-selected-import-v7'].includes(mode))throw Error('FRESH_DATABASE_OCCUPIED');
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
 if(!channel.isOpen())throw Error('NATIVE_OWNER_UNAVAILABLE');
 await migrateInTransaction(c,base);
 for(const [name,hash,sql] of migrations){await c.query(sql);await c.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',[name,hash]);}
 if(!await recognizeNormalOexCatalog(c,base,normal,{workspaceImportDirectory:imports,workspaceWallImportDirectory:wall,workspaceFurnishingDirectory:furnishing,...writerOptions})||!channel.isOpen())throw Error('NATIVE_OEX_CATALOG');
 if(writer)await writer.assertLive();
}
