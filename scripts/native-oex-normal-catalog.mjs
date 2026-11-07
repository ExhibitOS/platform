// SPDX-License-Identifier: AGPL-3.0-or-later
// Read-only recognition of the exact supplemental catalog of a newly selected
// native OEX workspace. Never migrates or grants authority to start an operation.
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open,readdir} from 'node:fs/promises';
import {join} from 'node:path';
export const NORMAL_OEX_MIGRATION='026_oex_file_profile.sql';
export const NORMAL_OEX_SHA256='9e2a204ef9f24132f25ca2247415604c65f3f301c04e70a6a2a2facbc9122112';
export const NORMAL_OEX_PROVENANCE_MIGRATION='027_oex_exhibition_provenance.sql';
export const NORMAL_OEX_PROVENANCE_SHA256='09bd82b3195e2f54545f6af45173bbab569effac95553a50f573745dab96f2c7';
export const NORMAL_OEX_MATERIAL_MIGRATION='028_oex_material_catalogue.sql';
export const NORMAL_OEX_MATERIAL_SHA256='1f88a8ed07a3814954d11d58ebe9b627f399a39f918e8eb838d94a5df4f5b9af';
export const NORMAL_OEX_FLOOR_MIGRATION='029_oex_quiet_oak_floor.sql';
export const NORMAL_OEX_FLOOR_SHA256='d09e11450cdaa4e64f0b977cc17b1e468543314e6ce733571bc61b6b20deeb8a';
export const NORMAL_OEX_CONCRETE_MIGRATION='030_oex_concrete_surface.sql';
export const NORMAL_OEX_CONCRETE_SHA256='8c42cecb6a90c61eab4c72c4af81af42801db6bac60a567b61e69e7a31e22848';
export const WORKSPACE_MATERIAL_MIGRATION='031_workspace_material.sql';
export const WORKSPACE_MATERIAL_SHA256='2425f4d24859bf1627d1be9bb3d4b0ecc7829d074437a4aebd9e52d57bf45eb5';
export const WORKSPACE_MATERIAL_OEX_MIGRATION='032_oex_workspace_material.sql';
export const WORKSPACE_MATERIAL_OEX_SHA256='bc0017937498f37cfc98acf2851cd70752c76be353208e466aa6a2a5b1808efc';
export const WORKSPACE_MATERIAL_CAPABILITY=JSON.stringify({format:1,kind:'exhibitos-native-workspace-material',protocol:'normal-oex-workspace-v5',ownerChannelVersion:3,baseCapabilityPath:'platform/scripts/native-normal-oex-028-capability-v4.json',baseCapabilitySHA256:'9ffbff5c770be6c70e5bbffd4183006003ed73dabb807e18f496a19af94a58b4',intakeSchemaPath:'platform/database/native-oex-normal/031_workspace_material.sql',intakeSchemaSHA256:WORKSPACE_MATERIAL_SHA256,oexSchemaPath:'platform/database/native-oex-normal/032_oex_workspace_material.sql',oexSchemaSHA256:WORKSPACE_MATERIAL_OEX_SHA256,archiveFormats:['1.0.0-draft.9','1.0.0-draft.10'],freshOnly:true});
// Sealed inventory only. Runtime admission, owner recovery and authenticated
// results remain separate and must be qualified before this can be selected.
export const WORKSPACE_IMPORT_STAGE_MIGRATION='033_workspace_material_import_provenance.sql';
export const WORKSPACE_IMPORT_STAGE_SHA256='f69d3dc12d7b89f1a342daef1d7bca08787667efacdfca3d214d3101b051d1dd';
export const WORKSPACE_IMPORT_PROOF_MIGRATION='034_workspace_material_terminal_proof.sql';
export const WORKSPACE_IMPORT_PROOF_SHA256='ebf2300ef875b635617d82369f4c7cad4cbe6d8fa43677bdbd2e5e21dd74da21';
export const WORKSPACE_IMPORT_CAPABILITY=JSON.stringify({format:1,kind:'exhibitos-native-workspace-oex-import',protocol:'normal-oex-workspace-import-v6',ownerChannelVersion:3,parentCapabilityPath:'platform/scripts/native-workspace-material-capability-v5.json',parentCapabilitySHA256:'8c5f7f44fb7b0a898611977064f95d4988eeff4945093c0df351f7b6baaf217a',stageSchemaPath:'platform/database/native-oex-workspace-import/033_workspace_material_import_provenance.sql',stageSchemaSHA256:WORKSPACE_IMPORT_STAGE_SHA256,proofSchemaPath:'platform/database/native-oex-workspace-import/034_workspace_material_terminal_proof.sql',proofSchemaSHA256:WORKSPACE_IMPORT_PROOF_SHA256,archiveFormat:'1.0.0-draft.12',maxArchiveBytes:536870912,oneShot:true});
export const WORKSPACE_WALL_IMPORT_MIGRATION='035_workspace_material_wall_import.sql';
export const WORKSPACE_WALL_IMPORT_SHA256='c347183b3e58805c46d1dde7ae6e2defc37762af52f585846357181b9635a544';
// Provisional opt-in supplement. Its exact hash must be reviewed before release.
export const WORKSPACE_FURNISHING_MIGRATION='036_workspace_furnishing.sql';
export const WORKSPACE_FURNISHING_SHA256='132ecc276ba18aa173ab0bd1bf8c70167eef5d20783d8de4bc09408de962a3c7';
export const WORKSPACE_FURNISHING_CAPABILITY=JSON.stringify({format:1,kind:'exhibitos-native-workspace-furnishing',parentCapabilityPath:'platform/scripts/native-workspace-oex-import-capability-v7.json',parentCapabilitySHA256:'7229cba9fbf98301960f44d39927c8d528ed55c3eb5e5fbdf203341261f342d5',schemaPath:'platform/database/native-workspace-furnishing/036_workspace_furnishing.sql',schemaSHA256:WORKSPACE_FURNISHING_SHA256,ownerChannelVersion:3,initializeMode:'workspace-furnishing-036-initialize-v1',reopenMode:'workspace-furnishing-036-reopen-v1'});
// Provisional sealed inventory. It grants no runtime or migration authority.
export const WORKSPACE_FURNISHING_WRITER_MIGRATION='037_workspace_furnishing_writer_generation.sql';
export const WORKSPACE_FURNISHING_WRITER_SHA256='a8e861458fcce8336a50b7c94a398555bf6860fbeb20009ea3db6aaaaf068f48';
// Publication binding is separately selected; recognizing it never authorizes migration.
export const WORKSPACE_FURNISHING_PUBLICATION_MIGRATION='038_workspace_furnishing_publication.sql';
export const WORKSPACE_FURNISHING_PUBLICATION_SHA256='cbee8e1f2a7af5daa1aec498d014ad25934b116aa5d578966b23efef2e110a98';
export const WORKSPACE_FURNISHING_SELECTED_OEX_CAPABILITY='{"format":1,"kind":"exhibitos-native-furnishing-selected-oex-import","mode":"workspace-furnishing-038-selected-import-v7","catalog":38,"ownerChannelVersion":3,"archiveFormat":"1.0.0-draft.12","freshOnly":true}';
export const WORKSPACE_FURNISHING_PUBLICATION_CAPABILITY=JSON.stringify({format:1,catalog:38,migration:WORKSPACE_FURNISHING_PUBLICATION_MIGRATION,migrationSHA256:WORKSPACE_FURNISHING_PUBLICATION_SHA256});
export const WORKSPACE_FURNISHING_WRITER_CAPABILITY=JSON.stringify({format:1,kind:'exhibitos-native-workspace-furnishing-writer',parentCapabilityPath:'platform/scripts/native-workspace-furnishing-capability-v1.json',parentCapabilitySHA256:'0f969e6186699ea6107c83c28efad2d8e598b7d316e452b451472f1d5f8c1c0b',schemaPath:'platform/database/native-workspace-furnishing-writer/037_workspace_furnishing_writer_generation.sql',schemaSHA256:WORKSPACE_FURNISHING_WRITER_SHA256,ownerChannelVersion:3,writerLeaseVersion:1,freshOnly:true});
export const WORKSPACE_WALL_IMPORT_CAPABILITY=JSON.stringify({format:1,kind:'exhibitos-native-workspace-wall-import',protocol:'normal-oex-workspace-import-v7',ownerChannelVersion:3,parentCapabilityPath:'platform/scripts/native-workspace-oex-import-capability-v6.json',parentCapabilitySHA256:'1d5177c8c4ddb9dec26ed7724178376ae4ca615e06e64573b132b7c7abfa25e8',wallSchemaPath:'platform/database/native-oex-workspace-import-wall/035_workspace_material_wall_import.sql',wallSchemaSHA256:WORKSPACE_WALL_IMPORT_SHA256,archiveFormat:'1.0.0-draft.12',oneShot:true});
export async function hasWorkspaceWallImportCapability(path){try{const bytes=await regular(path);if(!bytes.equals(Buffer.from(WORKSPACE_WALL_IMPORT_CAPABILITY)))throw Error('NATIVE_OEX_CATALOG');return true;}catch(error){if(error?.code==='ENOENT')return false;throw error;}}
export async function hasWorkspaceFurnishingCapability(path){try{const bytes=await regular(path);if(!bytes.equals(Buffer.from(WORKSPACE_FURNISHING_CAPABILITY)))throw Error('NATIVE_OEX_CATALOG');return true;}catch(error){if(error?.code==='ENOENT')return false;throw error;}}
export async function hasWorkspaceFurnishingWriterCapability(path){try{const bytes=await regular(path);if(!bytes.equals(Buffer.from(WORKSPACE_FURNISHING_WRITER_CAPABILITY)))throw Error('NATIVE_OEX_CATALOG');return true;}catch(error){if(error?.code==='ENOENT')return false;throw error;}}
export async function hasWorkspaceFurnishingPublicationCapability(path){try{const bytes=await regular(path);if(!bytes.equals(Buffer.from(WORKSPACE_FURNISHING_PUBLICATION_CAPABILITY)))throw Error('NATIVE_OEX_CATALOG');return true;}catch(error){if(error?.code==='ENOENT')return false;throw error;}}
export async function verifyWorkspaceWallImportMigration(path){const before=await directory(path),names=(await readdir(path)).filter(n=>/^\d+.*\.sql$/.test(n)).sort();if(JSON.stringify(names)!==JSON.stringify([WORKSPACE_WALL_IMPORT_MIGRATION]))throw Error('NATIVE_OEX_CATALOG');const bytes=await regular(join(path,WORKSPACE_WALL_IMPORT_MIGRATION));if(sha(bytes)!==WORKSPACE_WALL_IMPORT_SHA256||!same(before,await directory(path)))throw Error('NATIVE_OEX_CATALOG');return bytes.toString('utf8');}
export async function verifyWorkspaceFurnishingMigration(path){const before=await directory(path),names=(await readdir(path)).filter(n=>/^\d+.*\.sql$/.test(n)).sort();if(JSON.stringify(names)!==JSON.stringify([WORKSPACE_FURNISHING_MIGRATION]))throw Error('NATIVE_OEX_CATALOG');const bytes=await regular(join(path,WORKSPACE_FURNISHING_MIGRATION));if(sha(bytes)!==WORKSPACE_FURNISHING_SHA256||!same(before,await directory(path)))throw Error('NATIVE_OEX_CATALOG');return bytes.toString('utf8');}
export async function verifyWorkspaceFurnishingWriterMigration(path){const before=await directory(path),names=(await readdir(path)).filter(n=>/^\d+.*\.sql$/.test(n)).sort();if(JSON.stringify(names)!==JSON.stringify([WORKSPACE_FURNISHING_WRITER_MIGRATION]))throw Error('NATIVE_OEX_CATALOG');const bytes=await regular(join(path,WORKSPACE_FURNISHING_WRITER_MIGRATION));if(sha(bytes)!==WORKSPACE_FURNISHING_WRITER_SHA256||!same(before,await directory(path)))throw Error('NATIVE_OEX_CATALOG');return bytes.toString('utf8');}
export async function verifyWorkspaceFurnishingPublicationMigration(path){const before=await directory(path),names=(await readdir(path)).filter(n=>/^\d+.*\.sql$/.test(n)).sort();if(JSON.stringify(names)!==JSON.stringify([WORKSPACE_FURNISHING_PUBLICATION_MIGRATION]))throw Error('NATIVE_OEX_CATALOG');const bytes=await regular(join(path,WORKSPACE_FURNISHING_PUBLICATION_MIGRATION));if(sha(bytes)!==WORKSPACE_FURNISHING_PUBLICATION_SHA256||!same(before,await directory(path)))throw Error('NATIVE_OEX_CATALOG');return bytes.toString('utf8');}
const supplementalCatalog=[[NORMAL_OEX_MIGRATION,NORMAL_OEX_SHA256],[NORMAL_OEX_PROVENANCE_MIGRATION,NORMAL_OEX_PROVENANCE_SHA256],[NORMAL_OEX_MATERIAL_MIGRATION,NORMAL_OEX_MATERIAL_SHA256],[NORMAL_OEX_FLOOR_MIGRATION,NORMAL_OEX_FLOOR_SHA256],[NORMAL_OEX_CONCRETE_MIGRATION,NORMAL_OEX_CONCRETE_SHA256],[WORKSPACE_MATERIAL_MIGRATION,WORKSPACE_MATERIAL_SHA256],[WORKSPACE_MATERIAL_OEX_MIGRATION,WORKSPACE_MATERIAL_OEX_SHA256]];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
async function directory(path){const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink())throw Error('NATIVE_OEX_CATALOG');return info;}
async function regular(path){
 const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>1024*1024)throw Error('NATIVE_OEX_CATALOG');
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const bound=await file.stat();if(!bound.isFile()||!same(bound,info)||bound.size!==info.size)throw Error('NATIVE_OEX_CATALOG');
  const buffer=Buffer.alloc(bound.size+1);let used=0;while(used<buffer.length){const {bytesRead}=await file.read(buffer,used,buffer.length-used,null);if(!bytesRead)break;used+=bytesRead;}
  const after=await file.stat(),named=await lstat(path);if(used!==bound.size||!after.isFile()||!named.isFile()||named.isSymbolicLink()||!same(after,bound)||!same(named,bound)||after.size!==bound.size||named.size!==bound.size)throw Error('NATIVE_OEX_CATALOG');
  return buffer.subarray(0,used);
 }finally{await file.close();}
}
export async function verifyNormalOexMigration(supplementalDirectory){
 const info=await directory(supplementalDirectory);
 const extra=(await readdir(supplementalDirectory)).filter(n=>/^\d+.*\.sql$/.test(n)).sort();
 if(extra.length<1||extra.length>supplementalCatalog.length||extra.some((name,i)=>name!==supplementalCatalog[i][0]))throw Error('NATIVE_OEX_CATALOG');
 for(let i=1;i<extra.length;i++)if(sha(await regular(join(supplementalDirectory,extra[i])))!==supplementalCatalog[i][1])throw Error('NATIVE_OEX_CATALOG');
 const bytes=await regular(join(supplementalDirectory,NORMAL_OEX_MIGRATION));const after=await directory(supplementalDirectory);if(!same(info,after)||sha(bytes)!==NORMAL_OEX_SHA256)throw Error('NATIVE_OEX_CATALOG');return bytes.toString('utf8');
}
export async function verifyNormalOexProvenanceMigration(supplementalDirectory){
 const before=await directory(supplementalDirectory);await verifyNormalOexMigration(supplementalDirectory);
 const bytes=await regular(join(supplementalDirectory,NORMAL_OEX_PROVENANCE_MIGRATION));const after=await directory(supplementalDirectory);
 if(!same(before,after)||sha(bytes)!==NORMAL_OEX_PROVENANCE_SHA256)throw Error('NATIVE_OEX_CATALOG');return bytes.toString('utf8');
}
export async function verifyNormalOexMaterialMigration(supplementalDirectory){
 const before=await directory(supplementalDirectory);await verifyNormalOexProvenanceMigration(supplementalDirectory);
 const bytes=await regular(join(supplementalDirectory,NORMAL_OEX_MATERIAL_MIGRATION)),after=await directory(supplementalDirectory);
 if(!same(before,after)||sha(bytes)!==NORMAL_OEX_MATERIAL_SHA256)throw Error('NATIVE_OEX_CATALOG');return bytes.toString('utf8');
}
export async function verifyNormalOexFloorMigration(supplementalDirectory){
 const before=await directory(supplementalDirectory);await verifyNormalOexMaterialMigration(supplementalDirectory);
 const bytes=await regular(join(supplementalDirectory,NORMAL_OEX_FLOOR_MIGRATION)),after=await directory(supplementalDirectory);
 if(!same(before,after)||sha(bytes)!==NORMAL_OEX_FLOOR_SHA256)throw Error('NATIVE_OEX_CATALOG');return bytes.toString('utf8');
}

export async function verifyNormalOexConcreteMigration(supplementalDirectory){
 const before=await directory(supplementalDirectory);await verifyNormalOexFloorMigration(supplementalDirectory);
 const bytes=await regular(join(supplementalDirectory,NORMAL_OEX_CONCRETE_MIGRATION)),after=await directory(supplementalDirectory);
 if(!same(before,after)||sha(bytes)!==NORMAL_OEX_CONCRETE_SHA256)throw Error('NATIVE_OEX_CATALOG');return bytes.toString('utf8');
}

/** A payload marker declares installed bytes, not authorization. */
export async function hasWorkspaceMaterialCapability(path){
 try{const bytes=await regular(path);if(!bytes.equals(Buffer.from(WORKSPACE_MATERIAL_CAPABILITY)))throw Error('NATIVE_OEX_CATALOG');return true;}
 catch(error){if(error?.code==='ENOENT')return false;throw error;}
}

/** Read only the pinned pair, after checking the complete supplemental catalog. */
export async function verifyWorkspaceMaterialMigrations(supplementalDirectory){
 const before=await directory(supplementalDirectory);await verifyNormalOexConcreteMigration(supplementalDirectory);
 const pair=[];for(const [name,hash] of supplementalCatalog.slice(5)){
  const bytes=await regular(join(supplementalDirectory,name));if(sha(bytes)!==hash)throw Error('NATIVE_OEX_CATALOG');pair.push(bytes.toString('utf8'));
 }
 if(!same(before,await directory(supplementalDirectory)))throw Error('NATIVE_OEX_CATALOG');return pair;
}

/** The V6 marker and pair identify packaged bytes; they do not grant an
 * owner session or permit a migration. */
export async function hasWorkspaceImportCapability(path){
 try{const bytes=await regular(path);if(!bytes.equals(Buffer.from(WORKSPACE_IMPORT_CAPABILITY)))throw Error('NATIVE_OEX_CATALOG');return true;}
 catch(error){if(error?.code==='ENOENT')return false;throw error;}
}
export async function verifyWorkspaceImportMigrations(importDirectory){
 const before=await directory(importDirectory),pair=[[WORKSPACE_IMPORT_STAGE_MIGRATION,WORKSPACE_IMPORT_STAGE_SHA256],[WORKSPACE_IMPORT_PROOF_MIGRATION,WORKSPACE_IMPORT_PROOF_SHA256]],names=(await readdir(importDirectory)).filter(n=>/^\d+.*\.sql$/.test(n)).sort();
 if(JSON.stringify(names)!==JSON.stringify(pair.map(([name])=>name)))throw Error('NATIVE_OEX_CATALOG');const result=[];
 for(const [name,hash] of pair){const bytes=await regular(join(importDirectory,name));if(sha(bytes)!==hash)throw Error('NATIVE_OEX_CATALOG');result.push(bytes.toString('utf8'));}
 if(!same(before,await directory(importDirectory)))throw Error('NATIVE_OEX_CATALOG');return result;
}

/** Selected owner mode must match the applied ledger; ordinary reopen has no
 * selected mode and is handled by exact catalog recognition. */
export function assertWorkspaceImportOwnerMode(mode,wallApplied){
 if(mode==='normal-oex-workspace-import-v7'&&!wallApplied||mode==='normal-oex-workspace-import-v6'&&wallApplied)throw Error('NATIVE_OEX_CATALOG');
}

/** Return the supplemental directory only for an exact full catalog. Missing,
 * unknown, drifted, or duplicate rows never cause a supplemental migration. */
export async function recognizeNormalOexCatalog(pool,migrationDirectory,supplementalDirectory,{workspaceImportDirectory,workspaceWallImportDirectory,workspaceFurnishingDirectory,workspaceFurnishingWriterDirectory,workspaceFurnishingPublicationDirectory}={}){
 const rows=(await pool.query('SELECT name,sha256 FROM public.schema_migrations ORDER BY name')).rows;
 if(!Array.isArray(rows)||!rows.some(row=>row?.name===NORMAL_OEX_MIGRATION))return undefined;
 const base=await directory(migrationDirectory);const names=(await readdir(migrationDirectory)).filter(n=>/^\d+.*\.sql$/.test(n)).sort();
 const importing=rows.length>=34,wall=rows.length>=35,furnishing=rows.length>=36,writer=rows.length>=37,publication=rows.length===38;if(names.length!==25||rows.length<26||rows.length>38||publication&&!workspaceFurnishingPublicationDirectory||writer&&!workspaceFurnishingWriterDirectory||furnishing&&!workspaceFurnishingDirectory||wall&&!workspaceWallImportDirectory||rows.length===31||rows.length===33||importing&&!workspaceImportDirectory||names.some((name,i)=>name!==rows[i]?.name)||supplementalCatalog.slice(0,Math.min(rows.length-25,7)).some(([name,hash],i)=>rows[25+i]?.name!==name||rows[25+i]?.sha256!==hash))throw Error('NATIVE_OEX_CATALOG');
 if(importing){const expected=[[WORKSPACE_IMPORT_STAGE_MIGRATION,WORKSPACE_IMPORT_STAGE_SHA256],[WORKSPACE_IMPORT_PROOF_MIGRATION,WORKSPACE_IMPORT_PROOF_SHA256]];if(expected.some(([name,hash],i)=>rows[32+i]?.name!==name||rows[32+i]?.sha256!==hash))throw Error('NATIVE_OEX_CATALOG');await verifyWorkspaceImportMigrations(workspaceImportDirectory);}
 if(wall){if(rows[34]?.name!==WORKSPACE_WALL_IMPORT_MIGRATION||rows[34]?.sha256!==WORKSPACE_WALL_IMPORT_SHA256)throw Error('NATIVE_OEX_CATALOG');await verifyWorkspaceWallImportMigration(workspaceWallImportDirectory);}
 if(furnishing){if(rows[35]?.name!==WORKSPACE_FURNISHING_MIGRATION||rows[35]?.sha256!==WORKSPACE_FURNISHING_SHA256)throw Error('NATIVE_OEX_CATALOG');await verifyWorkspaceFurnishingMigration(workspaceFurnishingDirectory);}
 if(writer){if(rows[36]?.name!==WORKSPACE_FURNISHING_WRITER_MIGRATION||rows[36]?.sha256!==WORKSPACE_FURNISHING_WRITER_SHA256)throw Error('NATIVE_OEX_CATALOG');await verifyWorkspaceFurnishingWriterMigration(workspaceFurnishingWriterDirectory);}
 if(publication){if(rows[37]?.name!==WORKSPACE_FURNISHING_PUBLICATION_MIGRATION||rows[37]?.sha256!==WORKSPACE_FURNISHING_PUBLICATION_SHA256)throw Error('NATIVE_OEX_CATALOG');await verifyWorkspaceFurnishingPublicationMigration(workspaceFurnishingPublicationDirectory);}
 await verifyNormalOexMigration(supplementalDirectory);
 for(const [name,hash] of supplementalCatalog.slice(0,Math.min(rows.length-25,7)))if(sha(await regular(join(supplementalDirectory,name)))!==hash)throw Error('NATIVE_OEX_CATALOG');
 for(let i=0;i<names.length;i++)if(sha(await regular(join(migrationDirectory,names[i])))!==rows[i]?.sha256)throw Error('NATIVE_OEX_CATALOG');
 const after=await directory(migrationDirectory),again=(await readdir(migrationDirectory)).filter(n=>/^\d+.*\.sql$/.test(n)).sort();if(!same(base,after)||JSON.stringify(again)!==JSON.stringify(names))throw Error('NATIVE_OEX_CATALOG');
 return supplementalDirectory;
}

/** Before ordinary native startup writes anything, reject unknown catalog rows.
 * Caller holds migration 82001 in the surrounding transaction. */
export async function preflightNormalOexCatalog(client,migrationDirectory,supplementalDirectory,{allowWorkspaceMaterial=false,workspaceImportDirectory,workspaceWallImportDirectory,workspaceFurnishingDirectory,workspaceFurnishingWriterDirectory,workspaceFurnishingPublicationDirectory}={}){
 const relation=(await client.query("SELECT to_regclass('public.schema_migrations') AS name")).rows[0]?.name;
 if(!relation)return undefined;
 const rows=(await client.query('SELECT name,sha256 FROM public.schema_migrations ORDER BY name')).rows;
 // Runtime activation is not wired yet. Never write or start against the new ledger.
 if(!allowWorkspaceMaterial&&rows.some(row=>row?.name===WORKSPACE_MATERIAL_MIGRATION||row?.name===WORKSPACE_MATERIAL_OEX_MIGRATION)||workspaceImportDirectory&&!allowWorkspaceMaterial)throw Error('NATIVE_OEX_CATALOG');
 const names=new Set((await readdir(migrationDirectory)).filter(n=>/^\d+.*\.sql$/.test(n)));
 if(!rows.some(row=>!names.has(row.name)))return undefined;
 const selected=await recognizeNormalOexCatalog(client,migrationDirectory,supplementalDirectory,{workspaceImportDirectory,workspaceWallImportDirectory,workspaceFurnishingDirectory,workspaceFurnishingWriterDirectory,workspaceFurnishingPublicationDirectory});
 if(!selected)throw Error('NATIVE_OEX_CATALOG');return selected;
}
