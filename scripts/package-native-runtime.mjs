// SPDX-License-Identifier: AGPL-3.0-or-later
// Local macOS validation payload producer; never installs, launches or publishes.
import {spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {cp, mkdir, lstat, readFile, readdir, realpath, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, join, resolve, relative, isAbsolute} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {CATALOG_045_RETAINED_IMAGE_RECOVERY_MARKER,CATALOG_045_RETAINED_IMAGE_RECOVERY_CAPABILITY,CATALOG_045_INTERRUPTED_RECOVERY_CAPABILITY,MODEL_PREPARATION_CAPABILITY,MODEL_PREPARATION_MIGRATION,MODEL_PREPARATION_SHA256,HAYES_RELEASE_CAPABILITY,HAYES_RELEASE_MIGRATION,HAYES_RELEASE_SHA256,HAYES_DISPOSITION_CAPABILITY,HAYES_DISPOSITION_MIGRATION,HAYES_DISPOSITION_SHA256,HAYES_ORIGINAL_CAPABILITY,HAYES_ORIGINAL_MIGRATION,HAYES_ORIGINAL_SHA256,WORKSPACE_PORTAL_FINISH_CAPABILITY,WORKSPACE_FRAME_PREPARATION_CAPABILITY,WORKSPACE_FRAME_PREPARATION_MIGRATION,WORKSPACE_FRAME_PREPARATION_SHA256,WORKSPACE_FURNISHING_ARTWORK_FRAME_MODELS_CAPABILITY,WORKSPACE_FURNISHING_ARTWORK_FRAME_CAPABILITY,WORKSPACE_FURNISHING_ROOM_VISUAL_CAPABILITY,WORKSPACE_FURNISHING_STOOL_CAPABILITY,WORKSPACE_FURNISHING_SELECTED_OEX_040_CAPABILITY,WORKSPACE_MATERIAL_MULTIMAP_CAPABILITY,WORKSPACE_MATERIAL_MULTIMAP_MIGRATION,WORKSPACE_MATERIAL_MULTIMAP_SHA256,WORKSPACE_FURNISHING_SELECTED_OEX_039_CAPABILITY,WORKSPACE_MATERIAL_PUBLICATION_CAPABILITY,WORKSPACE_MATERIAL_PUBLICATION_MIGRATION,WORKSPACE_MATERIAL_PUBLICATION_SHA256,WORKSPACE_FURNISHING_SELECTED_OEX_CAPABILITY,WORKSPACE_MATERIAL_CAPABILITY,WORKSPACE_MATERIAL_MIGRATION,WORKSPACE_MATERIAL_SHA256,WORKSPACE_MATERIAL_OEX_MIGRATION,WORKSPACE_MATERIAL_OEX_SHA256,WORKSPACE_IMPORT_CAPABILITY,WORKSPACE_IMPORT_STAGE_MIGRATION,WORKSPACE_IMPORT_STAGE_SHA256,WORKSPACE_IMPORT_PROOF_MIGRATION,WORKSPACE_IMPORT_PROOF_SHA256,WORKSPACE_WALL_IMPORT_CAPABILITY,WORKSPACE_WALL_IMPORT_MIGRATION,WORKSPACE_WALL_IMPORT_SHA256,WORKSPACE_FURNISHING_CAPABILITY,WORKSPACE_FURNISHING_MIGRATION,WORKSPACE_FURNISHING_SHA256,WORKSPACE_FURNISHING_WRITER_CAPABILITY,WORKSPACE_FURNISHING_WRITER_MIGRATION,WORKSPACE_FURNISHING_WRITER_SHA256,WORKSPACE_FURNISHING_PUBLICATION_CAPABILITY,WORKSPACE_FURNISHING_PUBLICATION_MIGRATION,WORKSPACE_FURNISHING_PUBLICATION_SHA256} from './native-oex-normal-catalog.mjs';
import {SUPPORTED_FURNISHINGS, furnishingCatalogueEntry} from '@exhibitos/studio-contract';
import {NATIVE_DETAIL_CAPABILITY} from './native-detail-capability.mjs';
import {assertNativeJpegPayloadInventory} from './native-jpeg-payload-inventory.mjs';

const source = fileURLToPath(new URL('../', import.meta.url));
const fail = code => { throw Error(code); };
async function hash(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}
async function command(executable, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {cwd: options.cwd, env: options.env ?? process.env, stdio: ['ignore', options.capture ? 'pipe' : 'inherit', 'inherit']});
    let output = '';
    child.stdout?.on('data', bytes => { output += bytes; if (output.length > 65536) child.kill('SIGTERM'); });
    child.once('error', () => reject(Error('NATIVE_PACKAGE_COMMAND_FAILED')));
    child.once('exit', code => code === 0 ? resolve(output.trim()) : reject(Error('NATIVE_PACKAGE_COMMAND_FAILED')));
  });
}
async function checkedSource(path, kind) {
  if (!isAbsolute(path)) fail('NATIVE_PACKAGE_INPUT_INVALID');
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || (kind === 'file' ? !stat.isFile() : !stat.isDirectory())) fail('NATIVE_PACKAGE_INPUT_INVALID');
  return await realpath(path);
}
async function copy(from, to) {
  await mkdir(dirname(to), {recursive: true});
  await cp(from, to, {recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true});
}
async function copyTrackedTree(name, destination, excluded = new Set()) {
  const paths = (await command('/usr/bin/git', ['ls-files', '--', name], {cwd: source, capture: true})).split('\n').filter(Boolean);
  if (!paths.length) fail('NATIVE_PACKAGE_SOURCE_MISSING');
  for (const path of paths) {
    if (!path.startsWith(name + '/') || path.includes('..') || path.includes('\\')) fail('NATIVE_PACKAGE_SOURCE_INVALID');
    if (excluded.has(path)) continue;
    await copy(join(source, path), join(destination, path));
  }
  return new Set(paths.filter(path=>!excluded.has(path)));
}
const OEX_SPEC_PATH='vendor/exhibitos-spec-0.1.0-draft.26.tgz';
const OEX_SPEC_HASH='9ea61a721a9919c6e0d0a15574e994fb820b7bb6db4fd9458b38bcda39bd8a10';
const OEX_MIGRATION_PATH='database/fresh-oex-test/026_oex_bounded.sql';
const OEX_MIGRATION_HASH='103b49144e2a13a6ead4c97826410ae79f7a4b0cf3da9b86222b5b2eb6b27c7f';
const NORMAL_OEX_MIGRATION_PATH='database/native-oex-normal/026_oex_file_profile.sql';
const NORMAL_OEX_MATERIAL_PATH='database/native-oex-normal/028_oex_material_catalogue.sql';
const NORMAL_OEX_MATERIAL_HASH='1f88a8ed07a3814954d11d58ebe9b627f399a39f918e8eb838d94a5df4f5b9af';
const NORMAL_OEX_FLOOR_PATH='database/native-oex-normal/029_oex_quiet_oak_floor.sql';
const NORMAL_OEX_FLOOR_HASH='d09e11450cdaa4e64f0b977cc17b1e468543314e6ce733571bc61b6b20deeb8a';
const NORMAL_OEX_CONCRETE_PATH='database/native-oex-normal/030_oex_concrete_surface.sql';
const NORMAL_OEX_CONCRETE_HASH='8c42cecb6a90c61eab4c72c4af81af42801db6bac60a567b61e69e7a31e22848';
const NORMAL_OEX_PROVENANCE_PATH='database/native-oex-normal/027_oex_exhibition_provenance.sql';
const NORMAL_OEX_PROVENANCE_HASH='09bd82b3195e2f54545f6af45173bbab569effac95553a50f573745dab96f2c7';
const NORMAL_OEX_MIGRATION_HASH='9e2a204ef9f24132f25ca2247415604c65f3f301c04e70a6a2a2facbc9122112';
// The candidate import schema is inert until a future, separately selected capability.
export function nativePackageExcludedFiles(freshOexValidation,normalOexSelected){
  return new Set(['database/native-oex-normal/031_workspace_material.sql','database/native-oex-normal/032_oex_workspace_material.sql','database/native-oex-workspace-import/033_workspace_material_import_provenance.sql','database/native-oex-workspace-import/034_workspace_material_terminal_proof.sql','database/native-oex-workspace-import-wall/035_workspace_material_wall_import.sql','database/native-workspace-furnishing/036_workspace_furnishing.sql','database/native-workspace-furnishing-writer/037_workspace_furnishing_writer_generation.sql','database/native-workspace-furnishing-publication/038_workspace_furnishing_publication.sql','database/native-workspace-material-publication/039_workspace_material_publication.sql','database/native-workspace-material-multimap/040_workspace_material_multimap.sql','database/native-workspace-frame-preparation/041_workspace_frame_preparation.sql','database/native-hayes-original/042_hayes_original_attempt.sql','database/native-hayes-disposition/043_hayes_output_stage.sql','database/native-hayes-release/044_hayes_native_release.sql','database/native-model-preparation/045_required_model_preparation.sql',...(freshOexValidation?[]:[OEX_MIGRATION_PATH]),...(normalOexSelected?[]:[NORMAL_OEX_MIGRATION_PATH,NORMAL_OEX_PROVENANCE_PATH,NORMAL_OEX_MATERIAL_PATH,NORMAL_OEX_FLOOR_PATH,NORMAL_OEX_CONCRETE_PATH])]);
}
/** Copy a fixed checked input if Git did not already copy it. Source/destination
 * validation is point-in-time, not protection from a concurrent same-UID writer. */
async function copyCheckedValidationFile(sourceRoot,platformRoot,tracked,path,expected){
  const input = await checkedSource(join(sourceRoot,path),'file');
  if (input !== join(sourceRoot,path) || await hash(input) !== expected) fail('NATIVE_PACKAGE_SOURCE_INVALID');
  if (!tracked.get(path.split('/')[0]).has(path)) await copy(input,join(platformRoot,path));
  const output=await checkedSource(join(platformRoot,path),'file');
  if (output !== join(platformRoot,path) || await hash(output) !== expected) fail('NATIVE_PACKAGE_SOURCE_INVALID');
}
/** Explicit selected supplement; ordinary payloads retain their existing catalog.
 * This writes inventory, never native owner or transition authority. */
export async function copyModelPreparationSelectedFiles(sourceRoot,platformRoot,tracked,selected=false,hayesReleaseSelected=false){
  if(typeof selected!=='boolean'||typeof hayesReleaseSelected!=='boolean'||selected&&!hayesReleaseSelected)fail('NATIVE_PACKAGE_INPUT_INVALID');
  if(!selected)return;
  const parent=join(platformRoot,'scripts/native-hayes-release-capability-v1.json');
  if((await checkedSource(parent,'file'))!==parent||(await readFile(parent,'utf8'))!==HAYES_RELEASE_CAPABILITY)fail('NATIVE_PACKAGE_SOURCE_INVALID');
  await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,'database/native-model-preparation/'+MODEL_PREPARATION_MIGRATION,MODEL_PREPARATION_SHA256);
  await writeFile(join(platformRoot,'scripts/native-model-preparation-capability-v1.json'),MODEL_PREPARATION_CAPABILITY,{flag:'wx',mode:0o600});
}
/** Local validation only: lockfile dependency is included for every mode;
 * the supplemental isolated-test migration requires explicit opt-in. */
export async function copyFreshOexValidationFiles(sourceRoot, platformRoot, tracked, freshOexValidation, requireOexSpec = freshOexValidation) {
  const lock=JSON.parse(await readFile(join(sourceRoot,'package-lock.json'),'utf8'));
  const spec=lock?.packages?.['']?.dependencies?.['@exhibitos/spec'];
  if (spec === `file:${OEX_SPEC_PATH}`) await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,OEX_SPEC_PATH,OEX_SPEC_HASH);
  else if (requireOexSpec) fail('NATIVE_PACKAGE_SOURCE_INVALID');
  if (freshOexValidation) await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,OEX_MIGRATION_PATH,OEX_MIGRATION_HASH);
}
export async function copyNormalOexSelectedFile(sourceRoot,platformRoot,tracked,normalOexSelected,workspaceMaterialSelected=false,workspaceImportSelected=false,workspaceWallImportSelected=false,workspaceFurnishingSelected=false,workspaceFurnishingWriterSelected=false,workspaceFurnishingPublicationSelected=false,workspaceMaterialPublicationSelected=false,workspaceMaterialMultimapSelected=false,workspaceFramePreparationSelected=false,hayesOriginalSelected=false,hayesDispositionSelected=false,hayesReleaseSelected=false){
  if(hayesReleaseSelected&&!hayesDispositionSelected||hayesDispositionSelected&&!hayesOriginalSelected||hayesOriginalSelected&&!workspaceFramePreparationSelected||workspaceFramePreparationSelected&&!workspaceMaterialMultimapSelected||workspaceMaterialMultimapSelected&&!workspaceMaterialPublicationSelected||workspaceMaterialPublicationSelected&&!workspaceFurnishingPublicationSelected||workspaceFurnishingPublicationSelected&&!workspaceFurnishingWriterSelected||workspaceFurnishingWriterSelected&&!workspaceFurnishingSelected||workspaceFurnishingSelected&&!workspaceWallImportSelected||workspaceWallImportSelected&&!workspaceImportSelected||workspaceImportSelected&&!workspaceMaterialSelected||workspaceMaterialSelected&&!normalOexSelected)fail('NATIVE_PACKAGE_INPUT_INVALID');
  if (normalOexSelected) {await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,NORMAL_OEX_MIGRATION_PATH,NORMAL_OEX_MIGRATION_HASH);await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,NORMAL_OEX_PROVENANCE_PATH,NORMAL_OEX_PROVENANCE_HASH);await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,NORMAL_OEX_MATERIAL_PATH,NORMAL_OEX_MATERIAL_HASH);await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,NORMAL_OEX_FLOOR_PATH,NORMAL_OEX_FLOOR_HASH);await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,NORMAL_OEX_CONCRETE_PATH,NORMAL_OEX_CONCRETE_HASH);}
  if(workspaceMaterialSelected){if(!normalOexSelected)fail('NATIVE_PACKAGE_INPUT_INVALID');for(const [name,digest] of [[WORKSPACE_MATERIAL_MIGRATION,WORKSPACE_MATERIAL_SHA256],[WORKSPACE_MATERIAL_OEX_MIGRATION,WORKSPACE_MATERIAL_OEX_SHA256]])await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,'database/native-oex-normal/'+name,digest);}
  if(workspaceImportSelected){if(!workspaceMaterialSelected||!normalOexSelected)fail('NATIVE_PACKAGE_INPUT_INVALID');for(const [name,digest] of [[WORKSPACE_IMPORT_STAGE_MIGRATION,WORKSPACE_IMPORT_STAGE_SHA256],[WORKSPACE_IMPORT_PROOF_MIGRATION,WORKSPACE_IMPORT_PROOF_SHA256]])await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,'database/native-oex-workspace-import/'+name,digest);}
  if(workspaceWallImportSelected)await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,'database/native-oex-workspace-import-wall/'+WORKSPACE_WALL_IMPORT_MIGRATION,WORKSPACE_WALL_IMPORT_SHA256);
  if(workspaceFurnishingSelected)await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,'database/native-workspace-furnishing/'+WORKSPACE_FURNISHING_MIGRATION,WORKSPACE_FURNISHING_SHA256);
  if(workspaceFurnishingWriterSelected)await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,'database/native-workspace-furnishing-writer/'+WORKSPACE_FURNISHING_WRITER_MIGRATION,WORKSPACE_FURNISHING_WRITER_SHA256);
  if(workspaceFurnishingPublicationSelected)await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,'database/native-workspace-furnishing-publication/'+WORKSPACE_FURNISHING_PUBLICATION_MIGRATION,WORKSPACE_FURNISHING_PUBLICATION_SHA256);
  if(workspaceMaterialPublicationSelected)await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,'database/native-workspace-material-publication/'+WORKSPACE_MATERIAL_PUBLICATION_MIGRATION,WORKSPACE_MATERIAL_PUBLICATION_SHA256);
  if(workspaceMaterialMultimapSelected)await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,'database/native-workspace-material-multimap/'+WORKSPACE_MATERIAL_MULTIMAP_MIGRATION,WORKSPACE_MATERIAL_MULTIMAP_SHA256);
  if(workspaceFramePreparationSelected)await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,'database/native-workspace-frame-preparation/'+WORKSPACE_FRAME_PREPARATION_MIGRATION,WORKSPACE_FRAME_PREPARATION_SHA256);
  if(hayesOriginalSelected)await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,'database/native-hayes-original/'+HAYES_ORIGINAL_MIGRATION,HAYES_ORIGINAL_SHA256);
  if(hayesDispositionSelected)await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,'database/native-hayes-disposition/'+HAYES_DISPOSITION_MIGRATION,HAYES_DISPOSITION_SHA256);
  if(hayesReleaseSelected)await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,'database/native-hayes-release/'+HAYES_RELEASE_MIGRATION,HAYES_RELEASE_SHA256);
}
// A sealed-inventory declaration, never authority to select or run an operation.
// oneShot means one selected operation in a newly provisioned empty workspace/session.
export async function writeNormalOexCapability(platformRoot, normalOexSelected, workspaceMaterialSelected=false, workspaceImportSelected=false, workspaceWallImportSelected=false,workspaceFurnishingSelected=false,workspaceFurnishingWriterSelected=false,workspaceFurnishingPublicationSelected=false,workspaceMaterialPublicationSelected=false,workspaceMaterialMultimapSelected=false) {
  if(workspaceMaterialMultimapSelected&&!workspaceMaterialPublicationSelected||workspaceMaterialPublicationSelected&&!workspaceFurnishingPublicationSelected||workspaceFurnishingPublicationSelected&&!workspaceFurnishingWriterSelected||workspaceFurnishingWriterSelected&&!workspaceFurnishingSelected||workspaceFurnishingSelected&&!workspaceWallImportSelected||workspaceWallImportSelected&&!workspaceImportSelected||workspaceMaterialSelected&&!normalOexSelected||workspaceImportSelected&&!workspaceMaterialSelected)fail('NATIVE_PACKAGE_INPUT_INVALID');
  if (!normalOexSelected) return;
  const bytes = '{"format":1,"kind":"exhibitos-native-normal-oex","protocol":"normal-oex-v1","ownerChannelVersion":2,"schemaPath":"platform/database/native-oex-normal/026_oex_file_profile.sql","schemaSHA256":"9e2a204ef9f24132f25ca2247415604c65f3f301c04e70a6a2a2facbc9122112","archiveFormat":"1.0.0-draft.9","maxArchiveBytes":536870912,"oneShot":true}';
  await writeFile(join(platformRoot,'scripts/native-normal-oex-capability-v1.json'),bytes,{flag:'wx',mode:0o600});
  const v3='{"format":1,"kind":"exhibitos-native-normal-oex-027","protocol":"normal-oex-027-v3","ownerChannelVersion":3,"baseSchemaPath":"platform/database/native-oex-normal/026_oex_file_profile.sql","baseSchemaSHA256":"9e2a204ef9f24132f25ca2247415604c65f3f301c04e70a6a2a2facbc9122112","schemaPath":"platform/database/native-oex-normal/027_oex_exhibition_provenance.sql","schemaSHA256":"09bd82b3195e2f54545f6af45173bbab569effac95553a50f573745dab96f2c7","archiveFormat":"1.0.0-draft.9","maxArchiveBytes":536870912,"oneShot":true}';
  await writeFile(join(platformRoot,'scripts/native-normal-oex-027-capability-v3.json'),v3,{flag:'wx',mode:0o600});
  const v4="{\"format\":1,\"kind\":\"exhibitos-native-normal-oex-028\",\"protocol\":\"normal-oex-028-v4\",\"ownerChannelVersion\":3,\"baseSchemaPath\":\"platform/database/native-oex-normal/026_oex_file_profile.sql\",\"baseSchemaSHA256\":\"9e2a204ef9f24132f25ca2247415604c65f3f301c04e70a6a2a2facbc9122112\",\"provenanceSchemaPath\":\"platform/database/native-oex-normal/027_oex_exhibition_provenance.sql\",\"provenanceSchemaSHA256\":\"09bd82b3195e2f54545f6af45173bbab569effac95553a50f573745dab96f2c7\",\"schemaPath\":\"platform/database/native-oex-normal/028_oex_material_catalogue.sql\",\"schemaSHA256\":\"1f88a8ed07a3814954d11d58ebe9b627f399a39f918e8eb838d94a5df4f5b9af\",\"archiveFormats\":[\"1.0.0-draft.9\",\"1.0.0-draft.10\"],\"formatHintScript\":\"platform/apps/api/dist/oex-selected-format.js\",\"maxArchiveBytes\":536870912,\"oneShot\":true}";
  await writeFile(join(platformRoot,'scripts/native-normal-oex-028-capability-v4.json'),v4,{flag:'wx',mode:0o600});
  // Additional sealed inventory identity; existing v4 capability bytes stay historical.
  const floor=JSON.stringify({format:1,kind:'exhibitos-native-normal-oex-floor-supplement',protocol:'normal-oex-028-v4',ownerChannelVersion:3,parentCapabilityPath:'platform/scripts/native-normal-oex-028-capability-v4.json',parentCapabilitySHA256:'9ffbff5c770be6c70e5bbffd4183006003ed73dabb807e18f496a19af94a58b4',schemaPath:'platform/'+NORMAL_OEX_FLOOR_PATH,schemaSHA256:NORMAL_OEX_FLOOR_HASH,packId:'quiet-oak-herringbone',packVersion:1,freshOnly:true});
  await writeFile(join(platformRoot,'scripts/native-normal-oex-029-floor-capability-v4.json'),floor,{flag:'wx',mode:0o600});
  const concrete=JSON.stringify({format:1,kind:'exhibitos-native-normal-oex-concrete-supplement',protocol:'normal-oex-028-v4',ownerChannelVersion:3,parentCapabilityPath:'platform/scripts/native-normal-oex-028-capability-v4.json',parentCapabilitySHA256:'9ffbff5c770be6c70e5bbffd4183006003ed73dabb807e18f496a19af94a58b4',schemaPath:'platform/'+NORMAL_OEX_CONCRETE_PATH,schemaSHA256:NORMAL_OEX_CONCRETE_HASH,packId:'fine-gallery-concrete',packVersion:1,roles:['notice','color','roughness','normal'],freshOnly:true});
  await writeFile(join(platformRoot,'scripts/native-normal-oex-030-concrete-capability-v4.json'),concrete,{flag:'wx',mode:0o600});
  if(workspaceMaterialSelected)await writeFile(join(platformRoot,'scripts/native-workspace-material-capability-v5.json'),WORKSPACE_MATERIAL_CAPABILITY,{flag:'wx',mode:0o600});
  if(workspaceImportSelected)await writeFile(join(platformRoot,'scripts/native-workspace-oex-import-capability-v6.json'),WORKSPACE_IMPORT_CAPABILITY,{flag:'wx',mode:0o600});
  if(workspaceWallImportSelected)await writeFile(join(platformRoot,'scripts/native-workspace-oex-import-capability-v7.json'),WORKSPACE_WALL_IMPORT_CAPABILITY,{flag:'wx',mode:0o600});
  if(workspaceFurnishingSelected)await writeFile(join(platformRoot,'scripts/native-workspace-furnishing-capability-v1.json'),WORKSPACE_FURNISHING_CAPABILITY,{flag:'wx',mode:0o600});
  if(workspaceFurnishingWriterSelected)await writeFile(join(platformRoot,'scripts/native-workspace-furnishing-writer-capability-v1.json'),WORKSPACE_FURNISHING_WRITER_CAPABILITY,{flag:'wx',mode:0o600});
  if(workspaceFurnishingPublicationSelected)await writeFile(join(platformRoot,'scripts/native-workspace-furnishing-publication-capability-v1.json'),WORKSPACE_FURNISHING_PUBLICATION_CAPABILITY,{flag:'wx',mode:0o600});
  if(workspaceMaterialPublicationSelected)await writeFile(join(platformRoot,'scripts/native-workspace-material-publication-capability-v1.json'),WORKSPACE_MATERIAL_PUBLICATION_CAPABILITY,{flag:'wx',mode:0o600});
  if(workspaceMaterialMultimapSelected)await writeFile(join(platformRoot,'scripts/native-workspace-material-multimap-capability-v1.json'),WORKSPACE_MATERIAL_MULTIMAP_CAPABILITY,{flag:'wx',mode:0o600});
}
// Only the four already-qualified catalogue pairs are part of this native
// runtime. Verify the existing catalogue's exact bytes and notices before and
// after copying; do not copy the broader authored-asset library.
const DEFAULT_FURNISHINGS_RELEASES={
  '1.0.0':{commit:'4ac7d23c1b557d8e303ad04d78379bcefab50b40',manifestSHA256:'f11ba6f4407e31531230cdb94921d7d7baef3caca49b1859f8696fa1a39c4530',bytes:3562},
  '1.1.0':{commit:'90fb64d44b9c9fd91bb5c09045f92077484d1030',manifestSHA256:'b0173c3e8c5e0b85b66ca2e4a1f569fc1f5ca811d501b35cccd70739e5c6588f',bytes:4460},
};
const DEFAULT_FURNISHINGS_HOSTS={'backless-oak-bench':'bench','museum-track-spot':'light','gallery-open-portal':'opening','rectangular-plinth':'pedestal'};
const DEFAULT_FRAME_ID='black-aluminum-frame';
const DEFAULT_FRAME_ROOT='assets/furnishings/user-authored-20261027/black-aluminum-frame';
const DEFAULT_FRAME_ENTRY={
  version:1,path:DEFAULT_FRAME_ROOT+'/model.glb',mime:'model/gltf-binary',bytes:101720,
  sha256:'2fb941a9f6ed030638512e917e348a0a3000e29c1133fe3f9670268ff1c4169c',
  rights:{licenseId:'CC0-1.0',noticePath:DEFAULT_FRAME_ROOT+'/LICENSE-NOTICE.txt',noticeBytes:1073,noticeSha256:'4420382c9c355d1b175b76020d96d59ba8e95b44c8a4444c15f20ce8555b20b9'},
  provenance:{sourceSha256:'17c571accc4ed2554731d4ce89f3cad4faa66cf2bca83321ecd92ad2537093d9',recipe:'omit-unused-invalid-tangent-r1'},
};
/** Validate the immutable public release against the already-qualified runtime catalogue. */
export async function verifyDefaultFurnishingsManifest(root){
  const manifestPath=join(root,'manifest.json');
  if(await checkedSource(manifestPath,'file')!==manifestPath)fail('NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID');
  const manifestSize=(await lstat(manifestPath)).size;
  if(!Object.values(DEFAULT_FURNISHINGS_RELEASES).some(release=>release.bytes===manifestSize))fail('NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID');
  const bytes=await readFile(manifestPath),digest=createHash('sha256').update(bytes).digest('hex');
  const match=Object.entries(DEFAULT_FURNISHINGS_RELEASES).find(([,release])=>release.manifestSHA256===digest&&release.bytes===bytes.length);
  if(!match)fail('NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID');
  const [version,release]=match;
  const manifest=JSON.parse(bytes.toString('utf8'));
  const hosts=version==='1.1.0'?{...DEFAULT_FURNISHINGS_HOSTS,[DEFAULT_FRAME_ID]:'artwork-frame'}:DEFAULT_FURNISHINGS_HOSTS;
  if(manifest.schema!=='org.exhibitos.default-furnishings/v1'||manifest.bundleVersion!==version||!Array.isArray(manifest.assets)||manifest.assets.length!==Object.keys(hosts).length)fail('NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID');
  const seen=new Set();
  for(const item of manifest.assets){
    const id=item.catalogId;
    if(!Object.hasOwn(hosts,id)||seen.has(id))fail('NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID');
    seen.add(id);
    const entry=id===DEFAULT_FRAME_ID?DEFAULT_FRAME_ENTRY:furnishingCatalogueEntry(id),model=item.model,notice=item.rights?.notice;
    if(item.catalogVersion!==entry.version||item.hostKind!==hosts[id]||model?.path!==entry.path||model.mime!==entry.mime||model.bytes!==entry.bytes||model.sha256!==entry.sha256||item.rights?.licenseId!==entry.rights.licenseId||notice?.path!==entry.rights.noticePath||notice.bytes!==entry.rights.noticeBytes||notice.sha256!==entry.rights.noticeSha256||item.provenance?.sourceSha256!==entry.provenance.sourceSha256||item.provenance?.recipe!==entry.provenance.recipe)fail('NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID');
  }
  return {commit:release.commit,manifestSHA256:release.manifestSHA256};
}
export async function checkedDefaultFurnishingsRoot(root){
  if(typeof root!=='string'||!isAbsolute(root)||resolve(root)!==root)fail('NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID');
  const canonical=await checkedSource(root,'directory');if(canonical!==root)fail('NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID');
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
  let top,commit;try{top=await command('/usr/bin/git',['--no-replace-objects','rev-parse','--show-toplevel'],{cwd:root,capture:true,env});commit=await command('/usr/bin/git',['--no-replace-objects','rev-parse','HEAD^{commit}'],{cwd:root,capture:true,env});}catch{fail('NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID');}
  const release=await verifyDefaultFurnishingsManifest(root);
  if(top!==root||commit!==release.commit)fail('NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID');
  return {root:canonical,...release};
}
export async function copyNativeFurnishings(sourceRoot, platformRoot, release) {
  const ids = ['backless-oak-bench', 'museum-track-spot', 'gallery-open-portal', 'rectangular-plinth'];
  if (Object.keys(SUPPORTED_FURNISHINGS).length !== ids.length || ids.some(id => !Object.hasOwn(SUPPORTED_FURNISHINGS, id))) fail('NATIVE_PACKAGE_FURNISHING_UNSUPPORTED');
  if(release?.manifestSHA256===DEFAULT_FURNISHINGS_RELEASES['1.1.0'].manifestSHA256)ids.push(DEFAULT_FRAME_ID);
  const seen = new Set();
  for (const id of ids) {
    const entry = id===DEFAULT_FRAME_ID?DEFAULT_FRAME_ENTRY:furnishingCatalogueEntry(id);
    if (entry.rights.licenseId !== 'CC0-1.0') fail('NATIVE_PACKAGE_FURNISHING_INVALID');
    const files = [[entry.path, entry.bytes, entry.sha256], [entry.rights.noticePath, entry.rights.noticeBytes, entry.rights.noticeSha256]];
    // Seal the acquired source separately. The frame API resolves model.glb only.
    if(id===DEFAULT_FRAME_ID)files.push([DEFAULT_FRAME_ROOT+'/source.glb',101768,entry.provenance.sourceSha256]);
    for (const [path, bytes, sha256] of files) {
      if (typeof path !== 'string' || !path.startsWith(`assets/furnishings/user-authored-20261027/${id}/`)
          || (!['model.glb','LICENSE-NOTICE.txt'].includes(path.split('/').at(-1))&&path!==DEFAULT_FRAME_ROOT+'/source.glb') || path.includes('..') || path.includes('\\')
          || seen.has(path) || !Number.isSafeInteger(bytes) || bytes <= 0 || !/^[a-f0-9]{64}$/.test(sha256)) fail('NATIVE_PACKAGE_FURNISHING_INVALID');
      seen.add(path);
      const input = join(sourceRoot, path), canonical = await checkedSource(input, 'file');
      const stat = await lstat(input);
      if (canonical !== input || stat.size !== bytes || await hash(input) !== sha256) fail('NATIVE_PACKAGE_FURNISHING_INVALID');
      const output = join(platformRoot, path);
      await copy(input, output);
      const copied = await lstat(output);
      if (!copied.isFile() || copied.isSymbolicLink() || copied.size !== bytes || await hash(output) !== sha256) fail('NATIVE_PACKAGE_FURNISHING_INVALID');
    }
  }
}
async function inventory(root, path = root) {
  const entries = [];
  for (const name of (await readdir(path)).sort()) {
    const full = join(path, name), stat = await lstat(full), key = relative(root, full);
    if (stat.isSymbolicLink()) {
      // npm workspace aliases and vendor dylib aliases must remain internal.
      const target = await realpath(full);
      if (target !== root && !target.startsWith(root + '/')) fail('NATIVE_PACKAGE_EXTERNAL_LINK');
      entries.push({path: key, link: relative(dirname(full), target)});
    } else if (stat.isDirectory()) entries.push(...await inventory(root, full));
    else if (stat.isFile()) entries.push({path: key, bytes: stat.size, sha256: await hash(full), executable: Boolean(stat.mode & 0o111)});
    else fail('NATIVE_PACKAGE_FILE_INVALID');
  }
  return entries;
}

// The managed app uses UTF-8 PostgreSQL, PL/pgSQL and built-in text search.
// Keep the supplier tree intact. Selection affects only a NEW package, and is
// explicit so older full validation copies retain their original behavior.
export function postgresRuntimeSelection(profile = 'validation-full') {
  if (profile === 'validation-full') return {profile, files: [], trees: [], supportedExtensions: null};
  if (profile !== 'managed-core-v1') fail('NATIVE_PACKAGE_POSTGRES_PROFILE_INVALID');
  const libraries = [
    'libpq.5.dylib', 'libpq.dylib', 'libcrypto.3.dylib', 'libcrypto.dylib',
    'libssl.3.dylib', 'libssl.dylib',
    ...['icudata', 'icui18n', 'icuuc'].flatMap(name => [`lib${name}.77.1.dylib`, `lib${name}.77.dylib`, `lib${name}.dylib`]),
    'liblz4.1.10.0.dylib', 'liblz4.1.dylib', 'liblz4.dylib',
    'libzstd.1.5.7.dylib', 'libzstd.1.dylib', 'libzstd.dylib',
    'libxml2.16.dylib', 'libxml2.dylib'
  ];
  const data = ['errcodes.txt', 'information_schema.sql', 'pg_hba.conf.sample',
    'pg_ident.conf.sample', 'pg_service.conf.sample', 'postgres.bki',
    'postgresql.conf.sample', 'psqlrc.sample', 'snowball_create.sql',
    'sql_features.txt', 'system_constraints.sql', 'system_functions.sql', 'system_views.sql'];
  return {profile, supportedExtensions: ['plpgsql'], files: [
    ...['postgres', 'initdb', 'pg_isready', 'psql', 'createdb', 'pg_dump', 'pg_restore'].map(name => `bin/${name}`),
    ...libraries.map(name => `lib/${name}`),
    'lib/postgresql/plpgsql.dylib', 'lib/postgresql/dict_snowball.dylib',
    ...data.map(name => `share/postgresql/${name}`),
    'share/postgresql/extension/plpgsql.control', 'share/postgresql/extension/plpgsql--1.0.sql',
    'share/doc/postgresql/html/legalnotice.html', 'share/icu/77.1/LICENSE',
    'include/lz4.h', 'include/unicode/uvernum.h'
  ], trees: ['share/postgresql/tsearch_data', 'share/postgresql/timezone', 'share/postgresql/timezonesets']};
}
async function copyPostgres(postgresRoot, root, selection) {
  if (selection.profile === 'validation-full') return copy(postgresRoot, join(root, 'postgres'));
  const selected = new Set(selection.files);
  for (const path of selection.files) {
    const from = join(postgresRoot, path), stat = await lstat(from), target = await realpath(from);
    if ((!stat.isFile() && !stat.isSymbolicLink()) || !target.startsWith(postgresRoot + '/')) fail('NATIVE_PACKAGE_POSTGRES_PROFILE_INVALID');
    if (stat.isSymbolicLink() && !selected.has(relative(postgresRoot, target))) fail('NATIVE_PACKAGE_POSTGRES_PROFILE_INVALID');
    await copy(from, join(root, 'postgres', path));
  }
  for (const path of selection.trees) {
    await checkedSource(join(postgresRoot, path), 'directory');
    await copy(join(postgresRoot, path), join(root, 'postgres', path));
  }
}

export async function copyNativeOwnerSupport(sourceRoot,platformRoot){
 for(const name of ['native-owner-channel.mjs','native-hayes-owner-channel.mjs','native-owner-frames.mjs'])await copy(join(sourceRoot,'scripts',name),join(platformRoot,'scripts',name));
}
export async function copyNativeFurnishingSupport(sourceRoot,platformRoot){
 for(const name of ['native-workspace-furnishing-lease.mjs','native-workspace-furnishing-fd.mjs','native-workspace-furnishing-admission.mjs','native-workspace-furnishing-ordinary-assertion.mjs','native-workspace-furnishing-recovery.mjs'])await copy(join(sourceRoot,'scripts',name),join(platformRoot,'scripts',name));
}
export async function packageNativeRuntime(destination, {nodeBinary, nodeLicense, npmCLI, postgresRoot, postgresSourceReceipt, postgresProfile = 'validation-full', freshOexValidation = false, normalOexSelected = false, privateStaticEditor = false, workspaceMaterialSelected = false, workspaceImportSelected = false, workspaceWallImportSelected = false, workspaceFurnishingSelected = false, workspaceFurnishingWriterSelected = false, workspaceFurnishingPublicationSelected = false, workspaceFurnishingSelectedImport = false, workspaceMaterialPublicationSelected = false, workspaceMaterialSelectedImport = false, workspaceMaterialMultimapSelected = false, workspaceMaterialMultimapSelectedImport = false, workspaceFurnishingStoolSelected = false, workspaceFurnishingRoomVisualSelected = false, workspaceFurnishingArtworkFrameSelected = false, workspaceFurnishingArtworkFrameModelsSelected = false, workspaceArtworkFramePreparationSelected = false, workspacePortalFinishSelected = false, hayesOriginalSelected = false, hayesDispositionSelected = false, hayesReleaseSelected = false, modelPreparationSelected = false, catalog045InterruptedRecovery = false, catalog045RetainedImageRecovery = false, catalog045StartupCancelRecovery = false, hayesReleaseProbeSelected = false, hayesDispositionProbeSelected = false, hayesSessionProbeSelected = false, defaultFurnishingsRoot, privateWheatQualification}) {
  if(typeof catalog045StartupCancelRecovery!=='boolean'||catalog045StartupCancelRecovery&&!catalog045RetainedImageRecovery)fail('NATIVE_PACKAGE_INPUT_INVALID');
  if(typeof catalog045InterruptedRecovery!=='boolean'||typeof catalog045RetainedImageRecovery!=='boolean'||catalog045InterruptedRecovery&&catalog045RetainedImageRecovery||(catalog045InterruptedRecovery||catalog045RetainedImageRecovery)&&(!modelPreparationSelected||freshOexValidation||workspaceFurnishingSelectedImport||workspaceMaterialSelectedImport||workspaceMaterialMultimapSelectedImport))fail('NATIVE_PACKAGE_INPUT_INVALID');
  if(typeof modelPreparationSelected!=='boolean'||modelPreparationSelected&&(!hayesReleaseSelected||!privateStaticEditor||hayesReleaseProbeSelected||hayesDispositionProbeSelected||hayesSessionProbeSelected||workspaceFurnishingSelectedImport||workspaceMaterialSelectedImport||workspaceMaterialMultimapSelectedImport))fail('NATIVE_PACKAGE_INPUT_INVALID');
  if(privateWheatQualification!==undefined&&(privateWheatQualification!=='2152f40102fc904b971a66fbedacaf6a157706c507ae59cb04c4ff6a886a6082'||postgresProfile!=='validation-full'||!privateStaticEditor||!workspacePortalFinishSelected||!hayesReleaseSelected||hayesReleaseProbeSelected||hayesDispositionProbeSelected||hayesSessionProbeSelected))fail('NATIVE_PACKAGE_INPUT_INVALID');
  if (typeof hayesReleaseProbeSelected !== 'boolean' || hayesReleaseProbeSelected && (!hayesReleaseSelected || hayesDispositionProbeSelected || hayesSessionProbeSelected) || typeof hayesReleaseSelected !== 'boolean' || hayesReleaseSelected && !hayesDispositionSelected || typeof hayesDispositionProbeSelected !== 'boolean' || hayesDispositionProbeSelected && (!hayesDispositionSelected || hayesSessionProbeSelected) || typeof hayesDispositionSelected !== 'boolean' || hayesDispositionSelected && !hayesOriginalSelected || typeof hayesSessionProbeSelected !== 'boolean' || hayesSessionProbeSelected && !hayesOriginalSelected || typeof hayesOriginalSelected !== 'boolean' || hayesOriginalSelected && !workspaceArtworkFramePreparationSelected || typeof workspacePortalFinishSelected !== 'boolean' || workspacePortalFinishSelected && !workspaceFurnishingArtworkFrameModelsSelected || typeof workspaceArtworkFramePreparationSelected !== 'boolean' || workspaceArtworkFramePreparationSelected && (!workspaceFurnishingArtworkFrameModelsSelected || workspaceMaterialMultimapSelectedImport) || typeof workspaceFurnishingArtworkFrameModelsSelected !== 'boolean' || workspaceFurnishingArtworkFrameModelsSelected && !workspaceFurnishingArtworkFrameSelected || typeof workspaceFurnishingArtworkFrameSelected !== 'boolean' || workspaceFurnishingArtworkFrameSelected && !workspaceFurnishingRoomVisualSelected || typeof workspaceFurnishingRoomVisualSelected !== 'boolean' || workspaceFurnishingRoomVisualSelected && !workspaceFurnishingStoolSelected || typeof workspaceFurnishingStoolSelected !== 'boolean' || workspaceFurnishingStoolSelected && !workspaceMaterialMultimapSelected || typeof freshOexValidation !== 'boolean' || typeof normalOexSelected !== 'boolean' || typeof privateStaticEditor !== 'boolean' || typeof workspaceMaterialSelected !== 'boolean' || typeof workspaceImportSelected !== 'boolean' || typeof workspaceWallImportSelected !== 'boolean' || typeof workspaceFurnishingSelected !== 'boolean' || typeof workspaceFurnishingWriterSelected !== 'boolean' || typeof workspaceFurnishingPublicationSelected !== 'boolean' || typeof workspaceFurnishingSelectedImport !== 'boolean' || typeof workspaceMaterialPublicationSelected !== 'boolean' || typeof workspaceMaterialSelectedImport !== 'boolean' || typeof workspaceMaterialMultimapSelected !== 'boolean' || typeof workspaceMaterialMultimapSelectedImport !== 'boolean' || workspaceMaterialMultimapSelectedImport && (!workspaceMaterialMultimapSelected || workspaceMaterialSelectedImport || workspaceFurnishingSelectedImport) || workspaceMaterialMultimapSelected && (!workspaceMaterialPublicationSelected || workspaceMaterialSelectedImport || workspaceFurnishingSelectedImport) || workspaceMaterialSelectedImport && (!workspaceMaterialPublicationSelected || workspaceFurnishingSelectedImport) || workspaceMaterialPublicationSelected && !workspaceFurnishingPublicationSelected || workspaceFurnishingSelectedImport && !workspaceFurnishingPublicationSelected || workspaceFurnishingPublicationSelected && !workspaceFurnishingWriterSelected || workspaceFurnishingWriterSelected && !workspaceFurnishingSelected || workspaceFurnishingSelected && !workspaceWallImportSelected || workspaceWallImportSelected && !workspaceImportSelected || workspaceImportSelected && !workspaceMaterialSelected || workspaceMaterialSelected && !normalOexSelected || freshOexValidation && normalOexSelected) fail('NATIVE_PACKAGE_INPUT_INVALID');
  const selection = postgresRuntimeSelection(postgresProfile);
  if (process.platform !== 'darwin' || process.arch !== 'arm64' || process.version !== 'v24.21.0') fail('NATIVE_PACKAGE_TOOLCHAIN_INVALID');
  if (!isAbsolute(destination) || resolve(destination) !== destination) fail('NATIVE_PACKAGE_DESTINATION_INVALID');
  nodeBinary = await checkedSource(nodeBinary, 'file'); nodeLicense = await checkedSource(nodeLicense, 'file');
  npmCLI = await checkedSource(npmCLI, 'file'); postgresRoot = await checkedSource(postgresRoot, 'directory');
  const furnishingsRelease=defaultFurnishingsRoot===undefined?undefined:await checkedDefaultFurnishingsRoot(defaultFurnishingsRoot);
  if(furnishingsRelease?.manifestSHA256===DEFAULT_FURNISHINGS_RELEASES['1.1.0'].manifestSHA256&&!workspaceFurnishingArtworkFrameModelsSelected)fail('NATIVE_PACKAGE_FURNISHING_UNSUPPORTED');
  const provenance = JSON.parse(await readFile(postgresSourceReceipt, 'utf8'));
  if (provenance.release !== 'v2.9.6' || provenance.assetID !== 512422981 || provenance.sha256 !== '9fc7d0dc08cf46dfd94bb32cbaaad81b41b37847a42d6dcb2f9fbd292813defb') fail('NATIVE_PACKAGE_POSTGRES_SOURCE_INVALID');
  const noticeRoot = join(source, 'notices/native-runtime');
  const noticeRecords = JSON.parse(await readFile(join(noticeRoot, 'provenance.json'), 'utf8'));
  if (!Array.isArray(noticeRecords.files) || noticeRecords.files.length > 64) fail('NATIVE_PACKAGE_NOTICE_INVALID');
  for (const record of noticeRecords.files) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(record.file) || !/^[a-f0-9]{64}$/.test(record.sha256)) fail('NATIVE_PACKAGE_NOTICE_INVALID');
    const path = await checkedSource(join(noticeRoot, record.file), 'file');
    if (await hash(path) !== record.sha256) fail('NATIVE_PACKAGE_NOTICE_INVALID');
  }
  if (await command(nodeBinary, ['--version'], {capture:true}) !== 'v24.21.0') fail('NATIVE_PACKAGE_NODE_INVALID');
  if (await command(nodeBinary, [npmCLI, '--version'], {capture:true}) !== '11.19.0') fail('NATIVE_PACKAGE_NPM_INVALID');
  if (!/^postgres \(PostgreSQL\) 18\.6 \(Postgres\.app\)$/.test(await command(join(postgresRoot, 'bin/postgres'), ['--version'], {capture:true,env:{PATH:'/usr/bin:/bin',LANG:'C'}}))) fail('NATIVE_PACKAGE_POSTGRES_INVALID');
  // mkdir without recursive refuses an existing destination and preserves failures.
  await mkdir(destination, {mode:0o700});
  const root = await realpath(destination), platform = join(root, 'platform');
  await mkdir(platform, {mode:0o700});
  await copy(nodeBinary, join(root, 'bin/node'));
  await copy(nodeLicense, join(root, 'notices/Node-LICENSE'));
  await copy(join(source, 'LICENSE'), join(root, 'notices/Platform-LICENSE'));
  // Preserve the original upstream texts for the supplier's zstd/OpenSSL/libxml2
  // versions. This does not qualify the whole payload for redistribution.
  await copy(join(source, 'notices/native-runtime'), join(root, 'notices/native-runtime'));
  await copyPostgres(postgresRoot, root, selection);
  // This inventory-covered capability record lets native restore reject an
  // unsupported archive before pg_restore touches even the isolated candidate.
  await writeFile(join(root, 'notices/native-runtime/postgres-selection.json'), JSON.stringify({
    format: 'exhibitos-native-postgres-selection-v1', ...selection,
    supplierRelease: provenance.release, supplierAssetID: provenance.assetID,
    supplierArchiveSHA256: provenance.sha256, qualification: 'not-qualified'
  }, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  for (const name of ['package.json','package-lock.json']) await copy(join(source,name),join(platform,name));
  for (const workspace of ['apps/api','apps/web','packages/storage','packages/studio-contract']) {
    await copy(join(source,workspace,'package.json'),join(platform,workspace,'package.json'));
    await copy(join(source,workspace,'dist'),join(platform,workspace,'dist'));
  }
  const tracked = new Map();
  const excluded = nativePackageExcludedFiles(freshOexValidation,normalOexSelected);
  for (const name of ['database','contracts','vendor']) tracked.set(name,await copyTrackedTree(name,platform,excluded));
  await copyFreshOexValidationFiles(source,platform,tracked,freshOexValidation,freshOexValidation||normalOexSelected);
  await copyNormalOexSelectedFile(source,platform,tracked,normalOexSelected,workspaceMaterialSelected,workspaceImportSelected,workspaceWallImportSelected,workspaceFurnishingSelected,workspaceFurnishingWriterSelected,workspaceFurnishingPublicationSelected,workspaceMaterialPublicationSelected,workspaceMaterialMultimapSelected,workspaceArtworkFramePreparationSelected,hayesOriginalSelected,hayesDispositionSelected,hayesReleaseSelected);
  await copyNativeFurnishings(furnishingsRelease?.root??source, platform, furnishingsRelease);
  await copy(join(source,'scripts/local-runtime.mjs'),join(platform,'scripts/local-runtime.mjs'));
  if(hayesSessionProbeSelected){const probe='scripts/native-hayes-session-probe.mjs';await command('/usr/bin/git',['ls-files','--error-unmatch','--',probe],{cwd:source,capture:true});const path=await checkedSource(join(source,probe),'file');await copy(path,join(platform,probe));if(await hash(path)!==await hash(join(platform,probe)))fail('NATIVE_PACKAGE_SOURCE_INVALID');}
  if(hayesDispositionProbeSelected){const probe='scripts/native-hayes-disposition-probe.mjs';await command('/usr/bin/git',['ls-files','--error-unmatch','--',probe],{cwd:source,capture:true});const path=await checkedSource(join(source,probe),'file');await copy(path,join(platform,probe));if(await hash(path)!==await hash(join(platform,probe)))fail('NATIVE_PACKAGE_SOURCE_INVALID');}
  if(hayesReleaseProbeSelected){const probe='scripts/native-hayes-release-probe.mjs';await command('/usr/bin/git',['ls-files','--error-unmatch','--',probe],{cwd:source,capture:true});const path=await checkedSource(join(source,probe),'file');await copy(path,join(platform,probe));if(await hash(path)!==await hash(join(platform,probe)))fail('NATIVE_PACKAGE_SOURCE_INVALID');}

  await copy(join(source,'scripts/native-workspace-channel.mjs'),join(platform,'scripts/native-workspace-channel.mjs'));
  await copyNativeOwnerSupport(source,platform);
  await copy(join(source,'scripts/native-workspace-furnishing-bootstrap.mjs'),join(platform,'scripts/native-workspace-furnishing-bootstrap.mjs'));
  await copyNativeFurnishingSupport(source,platform);
  await writeNormalOexCapability(platform,normalOexSelected,workspaceMaterialSelected,workspaceImportSelected,workspaceWallImportSelected,workspaceFurnishingSelected,workspaceFurnishingWriterSelected,workspaceFurnishingPublicationSelected,workspaceMaterialPublicationSelected,workspaceMaterialMultimapSelected);
  if(workspaceFurnishingSelectedImport)await writeFile(join(platform,'scripts/native-workspace-furnishing-selected-oex-v1.json'),WORKSPACE_FURNISHING_SELECTED_OEX_CAPABILITY,{flag:'wx',mode:0o600});
  if(workspaceMaterialSelectedImport)await writeFile(join(platform,'scripts/native-workspace-furnishing-selected-oex-039-v1.json'),WORKSPACE_FURNISHING_SELECTED_OEX_039_CAPABILITY,{flag:'wx',mode:0o600});
  if(workspaceFurnishingStoolSelected)await writeFile(join(platform,'scripts/native-workspace-furnishing-stool-capability-v1.json'),WORKSPACE_FURNISHING_STOOL_CAPABILITY,{flag:'wx',mode:0o600});
  if(workspaceFurnishingRoomVisualSelected)await writeFile(join(platform,'scripts/native-workspace-furnishing-room-visual-capability-v1.json'),WORKSPACE_FURNISHING_ROOM_VISUAL_CAPABILITY,{flag:'wx',mode:0o600});
  if(workspaceFurnishingArtworkFrameSelected)await writeFile(join(platform,'scripts/native-workspace-furnishing-artwork-frame-capability-v1.json'),WORKSPACE_FURNISHING_ARTWORK_FRAME_CAPABILITY,{flag:'wx',mode:0o600});
  if(workspaceFurnishingArtworkFrameModelsSelected)await writeFile(join(platform,'scripts/native-workspace-furnishing-artwork-frame-models-capability-v1.json'),WORKSPACE_FURNISHING_ARTWORK_FRAME_MODELS_CAPABILITY,{flag:'wx',mode:0o600});
  if(workspaceArtworkFramePreparationSelected)await writeFile(join(platform,'scripts/native-workspace-frame-preparation-capability-v1.json'),WORKSPACE_FRAME_PREPARATION_CAPABILITY,{flag:'wx',mode:0o600});
  if(hayesOriginalSelected)await writeFile(join(platform,'scripts/native-hayes-original-capability-v1.json'),HAYES_ORIGINAL_CAPABILITY,{flag:'wx',mode:0o600});
  if(hayesDispositionSelected)await writeFile(join(platform,'scripts/native-hayes-disposition-capability-v1.json'),HAYES_DISPOSITION_CAPABILITY,{flag:'wx',mode:0o600});
  if(hayesReleaseSelected)await writeFile(join(platform,'scripts/native-hayes-release-capability-v1.json'),HAYES_RELEASE_CAPABILITY,{flag:'wx',mode:0o600});
  await copyModelPreparationSelectedFiles(source,platform,tracked,modelPreparationSelected,hayesReleaseSelected);
  if(catalog045InterruptedRecovery)await writeFile(join(platform,'scripts/native-catalog-045-interrupted-recovery-capability-v2.json'),CATALOG_045_INTERRUPTED_RECOVERY_CAPABILITY,{flag:'wx',mode:0o600});
  if(catalog045RetainedImageRecovery)await writeFile(join(platform,'scripts',CATALOG_045_RETAINED_IMAGE_RECOVERY_MARKER),CATALOG_045_RETAINED_IMAGE_RECOVERY_CAPABILITY,{flag:'wx',mode:0o600});
  if(catalog045StartupCancelRecovery)await writeFile(
    join(platform,'scripts/native-catalog-045-startup-cancel-recovery-capability-v1.json'),
    '{"format":1,"kind":"exhibitos-native-catalog-045-startup-cancel-recovery","catalog":45,"admissionKind":"interrupted-reopen","wireVersion":1}',
    {flag:'wx',mode:0o600},
  );
  if(workspacePortalFinishSelected)await writeFile(join(platform,'scripts/native-workspace-portal-finish-capability-v1.json'),WORKSPACE_PORTAL_FINISH_CAPABILITY,{flag:'wx',mode:0o600});
  if(workspaceMaterialMultimapSelectedImport)await writeFile(join(platform,'scripts/native-workspace-furnishing-selected-oex-040-v1.json'),WORKSPACE_FURNISHING_SELECTED_OEX_040_CAPABILITY,{flag:'wx',mode:0o600});
  await copy(join(source,'scripts/native-oex-normal-catalog.mjs'),join(platform,'scripts/native-oex-normal-catalog.mjs'));
  // Producer capability declaration only; Manager must still admit the exact
  // inventory and runtime source, not infer compatibility from this marker.
  await writeFile(join(platform,'scripts/native-owner-channel-v1.json'),'{"format":1,"kind":"exhibitos-native-owner-channel","version":1}',{flag:'wx',mode:0o600});
  await copy(join(source,'scripts/native-workspace-session.mjs'),join(platform,'scripts/native-workspace-session.mjs'));
  // Reuse the authenticated service-backup codec and PostgreSQL adapter. The
  // native controller supplies admitted pg_dump/pg_restore absolute paths;
  // maintenance must never depend on the user's PATH or a container engine.
  await copy(join(source,'scripts/service-backup.mjs'),join(platform,'scripts/service-backup.mjs'));
  await copy(join(source,'scripts/native-service-backup.mjs'),join(platform,'scripts/native-service-backup.mjs'));
  // The native publication worker uses the existing public-projection exporter
  // and static build. Neither npm nor a developer checkout is needed
  // on the user's Mac; these files join the exact runtime inventory below.
  const staticRoot = join(source,'apps/web/dist-static');
  const staticEntry = await lstat(join(staticRoot,'static.html'));
  if (!staticEntry.isFile() || staticEntry.isSymbolicLink()) fail('NATIVE_PACKAGE_STATIC_VIEWER_INVALID');
  const studioEntry = await lstat(join(staticRoot,'static-studio.html')).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (privateStaticEditor ? !studioEntry?.isFile() || studioEntry.isSymbolicLink() : studioEntry !== null) {
    fail('NATIVE_PACKAGE_STATIC_VIEWER_INVALID');
  }
  await copy(staticRoot,join(platform,'apps/web/dist-static'));
  // Authored entrance themes use this trusted build-time companion, never code
  // from a caller-provided runtime directory or a public exhibition payload.
  await copy(join(source,'apps/web/dist-cover-shell'),join(platform,'apps/web/dist-cover-shell'));
  await copy(join(source,'apps/web/src/static-json.mjs'),join(platform,'apps/web/src/static-json.mjs'));
  await copy(join(source,'apps/web/src/cover-variant-descriptor.mjs'),join(platform,'apps/web/src/cover-variant-descriptor.mjs'));
  await mkdir(join(platform,'apps/web/src/workspace-furnishing'),{recursive:true});
  await copy(join(source,'apps/web/src/workspace-furnishing/public-rights.mjs'),join(platform,'apps/web/src/workspace-furnishing/public-rights.mjs'));
  await copy(join(source,'apps/web/src/workspace-material-public-rights.mjs'),join(platform,'apps/web/src/workspace-material-public-rights.mjs'));
  await copy(join(source,'apps/web/src/workspace-material-resources.mjs'),join(platform,'apps/web/src/workspace-material-resources.mjs'));
  await copy(join(source,'apps/web/src/workspace-material-batch.mjs'),join(platform,'apps/web/src/workspace-material-batch.mjs'));
  await copy(join(source,'scripts/export-static-publication.mjs'),join(platform,'scripts/export-static-publication.mjs'));
  await copy(join(source,'scripts/native-detail-plan.mjs'),join(platform,'scripts/native-detail-plan.mjs'));
  for(const name of ['pages-publication-source.mjs','local-static-publication-source.mjs','refresh-static-publication.mjs']) await copy(join(source,'scripts',name),join(platform,'scripts',name));
  await copy(join(source,'scripts/native-static-export.mjs'),join(platform,'scripts/native-static-export.mjs'));
  await copy(join(source,'scripts/native-detail-capability.mjs'),join(platform,'scripts/native-detail-capability.mjs'));
  // Preserve only the previously qualified exact-owner Wheat capability.
  if(typeof modelPreparationSelected!=='boolean'||modelPreparationSelected&&(!hayesReleaseSelected||!privateStaticEditor||hayesReleaseProbeSelected||hayesDispositionProbeSelected||hayesSessionProbeSelected||workspaceFurnishingSelectedImport||workspaceMaterialSelectedImport||workspaceMaterialMultimapSelectedImport))fail('NATIVE_PACKAGE_INPUT_INVALID');
  if(privateWheatQualification!==undefined)await writeFile(join(platform,'scripts/native-detail-static-export-capability-v1.json'),NATIVE_DETAIL_CAPABILITY,{flag:'wx',mode:0o600});
  await copy(join(source,'scripts/native-detail-pipe.mjs'),join(platform,'scripts/native-detail-pipe.mjs'));
  await copy(join(source,'scripts/native-detail-control.mjs'),join(platform,'scripts/native-detail-control.mjs'));
  await copy(join(source,'scripts/native-detail-export-runner.mjs'),join(platform,'scripts/native-detail-export-runner.mjs'));
  await copy(join(source,'LICENSE'),join(platform,'LICENSE'));
  // Install exact production dependencies into the NEW payload; never prune the
  // developer checkout. No npm/tsc/vite/Homebrew executable is shipped or needed.
  await command(nodeBinary,[npmCLI,'ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:platform});
  const files = await inventory(root);
  assertNativeJpegPayloadInventory(files);
  const sourceCommit = await command('/usr/bin/git',['rev-parse','HEAD'],{cwd:source,capture:true});
  const sourceModified = Boolean(await command('/usr/bin/git',['status','--porcelain','--untracked-files=normal'],{cwd:source,capture:true}));
  const manifest = {
    format:'exhibitos-native-runtime-v1',mode:'local-validation',platform:'darwin-arm64',
    nodeVersion:'24.21.0',postgresVersion:'18.6',platformVersion:'0.1.0',protocolVersion:'1',
    sourceCommit,producerSHA256:await hash(fileURLToPath(import.meta.url)),
    entry:{node:'bin/node',script:'platform/scripts/local-runtime.mjs',postgres:'postgres/bin/postgres',initdb:'postgres/bin/initdb'},
    files,redistributionQualified:false,officialSigned:false,
    remaining:(selection.profile === 'validation-full'
      ? 'Full PostgreSQL validation copy includes optional modules: release payload minimization/complete third-party notices and final application signing/distribution are not qualified.'
      : 'Managed PostgreSQL core candidate: actual selected-file/dependency/notice and supported-backup restore qualification plus final owning-app/helper signing remain required. Optional extension support is not implied.')
      + (sourceModified ? ' Source commit is the checkout baseline; uncommitted source changes are present and are not identified by that commit.' : '')
  };
  await writeFile(join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  return {directory:root,files:files.length,manifestSHA256:await hash(join(root,'manifest.json')),redistributionQualified:false,...(furnishingsRelease?{defaultFurnishings:{commit:furnishingsRelease.commit,manifestSHA256:furnishingsRelease.manifestSHA256}}:{})};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [destination, configPath, ...extra] = process.argv.slice(2);
    if (!destination || !configPath || extra.length) fail('NATIVE_PACKAGE_USAGE');
    const config = JSON.parse(await readFile(configPath,'utf8'));
    console.info(JSON.stringify(await packageNativeRuntime(destination,config)));
  } catch (error) {
    console.error(/^NATIVE_PACKAGE_[A-Z_]+$/.test(error.message) ? error.message : 'NATIVE_PACKAGE_FAILED');
    process.exitCode = 1;
  }
}
