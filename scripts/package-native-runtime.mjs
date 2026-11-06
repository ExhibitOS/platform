// SPDX-License-Identifier: AGPL-3.0-or-later
// Local macOS validation payload producer; never installs, launches or publishes.
import {spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {cp, mkdir, lstat, readFile, readdir, realpath, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, join, resolve, relative, isAbsolute} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {WORKSPACE_MATERIAL_CAPABILITY,WORKSPACE_MATERIAL_MIGRATION,WORKSPACE_MATERIAL_SHA256,WORKSPACE_MATERIAL_OEX_MIGRATION,WORKSPACE_MATERIAL_OEX_SHA256,WORKSPACE_IMPORT_CAPABILITY,WORKSPACE_IMPORT_STAGE_MIGRATION,WORKSPACE_IMPORT_STAGE_SHA256,WORKSPACE_IMPORT_PROOF_MIGRATION,WORKSPACE_IMPORT_PROOF_SHA256,WORKSPACE_WALL_IMPORT_CAPABILITY,WORKSPACE_WALL_IMPORT_MIGRATION,WORKSPACE_WALL_IMPORT_SHA256,WORKSPACE_FURNISHING_CAPABILITY,WORKSPACE_FURNISHING_MIGRATION,WORKSPACE_FURNISHING_SHA256} from './native-oex-normal-catalog.mjs';
import {SUPPORTED_FURNISHINGS, furnishingCatalogueEntry} from '@exhibitos/studio-contract';

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
const OEX_SPEC_PATH='vendor/exhibitos-spec-0.1.0-draft.17.tgz';
const OEX_SPEC_HASH='e207eded0ab59f3d0aafa72b5842c2dee1a01fe620d03b9963594f21d5550088';
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
  return new Set(['database/native-oex-normal/031_workspace_material.sql','database/native-oex-normal/032_oex_workspace_material.sql','database/native-oex-workspace-import/033_workspace_material_import_provenance.sql','database/native-oex-workspace-import/034_workspace_material_terminal_proof.sql','database/native-oex-workspace-import-wall/035_workspace_material_wall_import.sql','database/native-workspace-furnishing/036_workspace_furnishing.sql','database/native-workspace-furnishing-writer/037_workspace_furnishing_writer_generation.sql',...(freshOexValidation?[]:[OEX_MIGRATION_PATH]),...(normalOexSelected?[]:[NORMAL_OEX_MIGRATION_PATH,NORMAL_OEX_PROVENANCE_PATH,NORMAL_OEX_MATERIAL_PATH,NORMAL_OEX_FLOOR_PATH,NORMAL_OEX_CONCRETE_PATH])]);
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
/** Local validation only: lockfile dependency is included for every mode;
 * the supplemental isolated-test migration requires explicit opt-in. */
export async function copyFreshOexValidationFiles(sourceRoot, platformRoot, tracked, freshOexValidation, requireOexSpec = freshOexValidation) {
  const lock=JSON.parse(await readFile(join(sourceRoot,'package-lock.json'),'utf8'));
  const spec=lock?.packages?.['']?.dependencies?.['@exhibitos/spec'];
  if (spec === `file:${OEX_SPEC_PATH}`) await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,OEX_SPEC_PATH,OEX_SPEC_HASH);
  else if (requireOexSpec) fail('NATIVE_PACKAGE_SOURCE_INVALID');
  if (freshOexValidation) await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,OEX_MIGRATION_PATH,OEX_MIGRATION_HASH);
}
export async function copyNormalOexSelectedFile(sourceRoot,platformRoot,tracked,normalOexSelected,workspaceMaterialSelected=false,workspaceImportSelected=false,workspaceWallImportSelected=false,workspaceFurnishingSelected=false){
  if(workspaceFurnishingSelected&&!workspaceWallImportSelected||workspaceWallImportSelected&&!workspaceImportSelected||workspaceImportSelected&&!workspaceMaterialSelected||workspaceMaterialSelected&&!normalOexSelected)fail('NATIVE_PACKAGE_INPUT_INVALID');
  if (normalOexSelected) {await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,NORMAL_OEX_MIGRATION_PATH,NORMAL_OEX_MIGRATION_HASH);await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,NORMAL_OEX_PROVENANCE_PATH,NORMAL_OEX_PROVENANCE_HASH);await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,NORMAL_OEX_MATERIAL_PATH,NORMAL_OEX_MATERIAL_HASH);await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,NORMAL_OEX_FLOOR_PATH,NORMAL_OEX_FLOOR_HASH);await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,NORMAL_OEX_CONCRETE_PATH,NORMAL_OEX_CONCRETE_HASH);}
  if(workspaceMaterialSelected){if(!normalOexSelected)fail('NATIVE_PACKAGE_INPUT_INVALID');for(const [name,digest] of [[WORKSPACE_MATERIAL_MIGRATION,WORKSPACE_MATERIAL_SHA256],[WORKSPACE_MATERIAL_OEX_MIGRATION,WORKSPACE_MATERIAL_OEX_SHA256]])await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,'database/native-oex-normal/'+name,digest);}
  if(workspaceImportSelected){if(!workspaceMaterialSelected||!normalOexSelected)fail('NATIVE_PACKAGE_INPUT_INVALID');for(const [name,digest] of [[WORKSPACE_IMPORT_STAGE_MIGRATION,WORKSPACE_IMPORT_STAGE_SHA256],[WORKSPACE_IMPORT_PROOF_MIGRATION,WORKSPACE_IMPORT_PROOF_SHA256]])await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,'database/native-oex-workspace-import/'+name,digest);}
  if(workspaceWallImportSelected)await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,'database/native-oex-workspace-import-wall/'+WORKSPACE_WALL_IMPORT_MIGRATION,WORKSPACE_WALL_IMPORT_SHA256);
  if(workspaceFurnishingSelected)await copyCheckedValidationFile(sourceRoot,platformRoot,tracked,'database/native-workspace-furnishing/'+WORKSPACE_FURNISHING_MIGRATION,WORKSPACE_FURNISHING_SHA256);
}
// A sealed-inventory declaration, never authority to select or run an operation.
// oneShot means one selected operation in a newly provisioned empty workspace/session.
export async function writeNormalOexCapability(platformRoot, normalOexSelected, workspaceMaterialSelected=false, workspaceImportSelected=false, workspaceWallImportSelected=false,workspaceFurnishingSelected=false) {
  if(workspaceFurnishingSelected&&!workspaceWallImportSelected||workspaceWallImportSelected&&!workspaceImportSelected||workspaceMaterialSelected&&!normalOexSelected||workspaceImportSelected&&!workspaceMaterialSelected)fail('NATIVE_PACKAGE_INPUT_INVALID');
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
}
// Only the four already-qualified catalogue pairs are part of this native
// runtime. Verify the existing catalogue's exact bytes and notices before and
// after copying; do not copy the broader authored-asset library.
const DEFAULT_FURNISHINGS_COMMIT='4ac7d23c1b557d8e303ad04d78379bcefab50b40';
const DEFAULT_FURNISHINGS_MANIFEST='f11ba6f4407e31531230cdb94921d7d7baef3caca49b1859f8696fa1a39c4530';
const DEFAULT_FURNISHINGS_HOSTS={'backless-oak-bench':'bench','museum-track-spot':'light','gallery-open-portal':'opening','rectangular-plinth':'pedestal'};
/** Validate the immutable public release against the already-qualified runtime catalogue. */
export async function verifyDefaultFurnishingsManifest(root){
  const manifestPath=join(root,'manifest.json');
  if(await checkedSource(manifestPath,'file')!==manifestPath||(await lstat(manifestPath)).size!==3562)fail('NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID');
  const bytes=await readFile(manifestPath);if(createHash('sha256').update(bytes).digest('hex')!==DEFAULT_FURNISHINGS_MANIFEST)fail('NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID');
  const manifest=JSON.parse(bytes.toString('utf8'));
  if(manifest.schema!=='org.exhibitos.default-furnishings/v1'||manifest.bundleVersion!=='1.0.0'||!Array.isArray(manifest.assets)||manifest.assets.length!==4)fail('NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID');
  const seen=new Set();
  for(const item of manifest.assets){
    const id=item.catalogId;if(!Object.hasOwn(DEFAULT_FURNISHINGS_HOSTS,id)||seen.has(id))fail('NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID');seen.add(id);
    const entry=furnishingCatalogueEntry(id),model=item.model,notice=item.rights?.notice;
    if(item.catalogVersion!==entry.version||item.hostKind!==DEFAULT_FURNISHINGS_HOSTS[id]||model?.path!==entry.path||model.mime!==entry.mime||model.bytes!==entry.bytes||model.sha256!==entry.sha256||item.rights?.licenseId!==entry.rights.licenseId||notice?.path!==entry.rights.noticePath||notice.bytes!==entry.rights.noticeBytes||notice.sha256!==entry.rights.noticeSha256||item.provenance?.sourceSha256!==entry.provenance.sourceSha256||item.provenance?.recipe!==entry.provenance.recipe)fail('NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID');
  }
  return {commit:DEFAULT_FURNISHINGS_COMMIT,manifestSHA256:DEFAULT_FURNISHINGS_MANIFEST};
}
export async function checkedDefaultFurnishingsRoot(root){
  if(typeof root!=='string'||!isAbsolute(root)||resolve(root)!==root)fail('NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID');
  const canonical=await checkedSource(root,'directory');if(canonical!==root)fail('NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID');
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
  let top,commit;try{top=await command('/usr/bin/git',['--no-replace-objects','rev-parse','--show-toplevel'],{cwd:root,capture:true,env});commit=await command('/usr/bin/git',['--no-replace-objects','rev-parse','HEAD^{commit}'],{cwd:root,capture:true,env});}catch{fail('NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID');}
  if(top!==root||commit!==DEFAULT_FURNISHINGS_COMMIT)fail('NATIVE_PACKAGE_FURNISHING_RELEASE_INVALID');
  await verifyDefaultFurnishingsManifest(root);return canonical;
}
export async function copyNativeFurnishings(sourceRoot, platformRoot) {
  const ids = ['backless-oak-bench', 'museum-track-spot', 'gallery-open-portal', 'rectangular-plinth'];
  if (Object.keys(SUPPORTED_FURNISHINGS).length !== ids.length || ids.some(id => !Object.hasOwn(SUPPORTED_FURNISHINGS, id))) fail('NATIVE_PACKAGE_FURNISHING_UNSUPPORTED');
  const seen = new Set();
  for (const id of ids) {
    const entry = furnishingCatalogueEntry(id);
    if (entry.rights.licenseId !== 'CC0-1.0') fail('NATIVE_PACKAGE_FURNISHING_INVALID');
    for (const [path, bytes, sha256] of [[entry.path, entry.bytes, entry.sha256], [entry.rights.noticePath, entry.rights.noticeBytes, entry.rights.noticeSha256]]) {
      if (typeof path !== 'string' || !path.startsWith(`assets/furnishings/user-authored-20261027/${id}/`)
          || !['model.glb','LICENSE-NOTICE.txt'].includes(path.split('/').at(-1)) || path.includes('..') || path.includes('\\')
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

export async function packageNativeRuntime(destination, {nodeBinary, nodeLicense, npmCLI, postgresRoot, postgresSourceReceipt, postgresProfile = 'validation-full', freshOexValidation = false, normalOexSelected = false, privateStaticEditor = false, workspaceMaterialSelected = false, workspaceImportSelected = false, workspaceWallImportSelected = false, workspaceFurnishingSelected = false, defaultFurnishingsRoot}) {
  if (typeof freshOexValidation !== 'boolean' || typeof normalOexSelected !== 'boolean' || typeof privateStaticEditor !== 'boolean' || typeof workspaceMaterialSelected !== 'boolean' || typeof workspaceImportSelected !== 'boolean' || typeof workspaceWallImportSelected !== 'boolean' || typeof workspaceFurnishingSelected !== 'boolean' || workspaceFurnishingSelected && !workspaceWallImportSelected || workspaceWallImportSelected && !workspaceImportSelected || workspaceImportSelected && !workspaceMaterialSelected || workspaceMaterialSelected && !normalOexSelected || freshOexValidation && normalOexSelected) fail('NATIVE_PACKAGE_INPUT_INVALID');
  const selection = postgresRuntimeSelection(postgresProfile);
  if (process.platform !== 'darwin' || process.arch !== 'arm64' || process.version !== 'v24.21.0') fail('NATIVE_PACKAGE_TOOLCHAIN_INVALID');
  if (!isAbsolute(destination) || resolve(destination) !== destination) fail('NATIVE_PACKAGE_DESTINATION_INVALID');
  nodeBinary = await checkedSource(nodeBinary, 'file'); nodeLicense = await checkedSource(nodeLicense, 'file');
  npmCLI = await checkedSource(npmCLI, 'file'); postgresRoot = await checkedSource(postgresRoot, 'directory');
  const furnishingsRoot=defaultFurnishingsRoot===undefined?source:await checkedDefaultFurnishingsRoot(defaultFurnishingsRoot);
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
  await copyNormalOexSelectedFile(source,platform,tracked,normalOexSelected,workspaceMaterialSelected,workspaceImportSelected,workspaceWallImportSelected,workspaceFurnishingSelected);
  await copyNativeFurnishings(furnishingsRoot, platform);
  await copy(join(source,'scripts/local-runtime.mjs'),join(platform,'scripts/local-runtime.mjs'));
  await copy(join(source,'scripts/native-workspace-channel.mjs'),join(platform,'scripts/native-workspace-channel.mjs'));
  await copy(join(source,'scripts/native-owner-channel.mjs'),join(platform,'scripts/native-owner-channel.mjs'));
  await copy(join(source,'scripts/native-workspace-furnishing-bootstrap.mjs'),join(platform,'scripts/native-workspace-furnishing-bootstrap.mjs'));
  for(const name of ['native-workspace-furnishing-lease.mjs','native-workspace-furnishing-fd.mjs','native-workspace-furnishing-admission.mjs','native-workspace-furnishing-recovery.mjs'])await copy(join(source,'scripts',name),join(platform,'scripts',name));
  await writeNormalOexCapability(platform,normalOexSelected,workspaceMaterialSelected,workspaceImportSelected,workspaceWallImportSelected,workspaceFurnishingSelected);
  await copy(join(source,'scripts/native-oex-normal-catalog.mjs'),join(platform,'scripts/native-oex-normal-catalog.mjs'));
  await copy(join(source,'scripts/native-owner-frames.mjs'),join(platform,'scripts/native-owner-frames.mjs'));
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
  await copy(join(source,'apps/web/src/cover-variant-descriptor.mjs'),join(platform,'apps/web/src/cover-variant-descriptor.mjs'));
  await copy(join(source,'scripts/export-static-publication.mjs'),join(platform,'scripts/export-static-publication.mjs'));
  await copy(join(source,'scripts/native-static-export.mjs'),join(platform,'scripts/native-static-export.mjs'));
  await copy(join(source,'LICENSE'),join(platform,'LICENSE'));
  // Install exact production dependencies into the NEW payload; never prune the
  // developer checkout. No npm/tsc/vite/Homebrew executable is shipped or needed.
  await command(nodeBinary,[npmCLI,'ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:platform});
  const files = await inventory(root);
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
  return {directory:root,files:files.length,manifestSHA256:await hash(join(root,'manifest.json')),redistributionQualified:false,...(defaultFurnishingsRoot===undefined?{}:{defaultFurnishings:{commit:DEFAULT_FURNISHINGS_COMMIT,manifestSHA256:DEFAULT_FURNISHINGS_MANIFEST}})};
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
