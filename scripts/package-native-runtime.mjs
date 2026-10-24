// SPDX-License-Identifier: AGPL-3.0-or-later
// Local macOS validation payload producer; never installs, launches or publishes.
import {spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {cp, mkdir, lstat, readFile, readdir, realpath, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, join, resolve, relative, isAbsolute} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

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
async function copyTrackedTree(name, destination) {
  const paths = (await command('/usr/bin/git', ['ls-files', '--', name], {cwd: source, capture: true})).split('\n').filter(Boolean);
  if (!paths.length) fail('NATIVE_PACKAGE_SOURCE_MISSING');
  for (const path of paths) {
    if (!path.startsWith(name + '/') || path.includes('..') || path.includes('\\')) fail('NATIVE_PACKAGE_SOURCE_INVALID');
    await copy(join(source, path), join(destination, path));
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

export async function packageNativeRuntime(destination, {nodeBinary, nodeLicense, npmCLI, postgresRoot, postgresSourceReceipt, postgresProfile = 'validation-full'}) {
  const selection = postgresRuntimeSelection(postgresProfile);
  if (process.platform !== 'darwin' || process.arch !== 'arm64' || process.version !== 'v24.21.0') fail('NATIVE_PACKAGE_TOOLCHAIN_INVALID');
  if (!isAbsolute(destination) || resolve(destination) !== destination) fail('NATIVE_PACKAGE_DESTINATION_INVALID');
  nodeBinary = await checkedSource(nodeBinary, 'file'); nodeLicense = await checkedSource(nodeLicense, 'file');
  npmCLI = await checkedSource(npmCLI, 'file'); postgresRoot = await checkedSource(postgresRoot, 'directory');
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
  for (const name of ['database','contracts','vendor']) await copyTrackedTree(name,platform);
  await copy(join(source,'scripts/local-runtime.mjs'),join(platform,'scripts/local-runtime.mjs'));
  await copy(join(source,'scripts/native-workspace-channel.mjs'),join(platform,'scripts/native-workspace-channel.mjs'));
  // Reuse the authenticated service-backup codec and PostgreSQL adapter. The
  // native controller supplies admitted pg_dump/pg_restore absolute paths;
  // maintenance must never depend on the user's PATH or a container engine.
  await copy(join(source,'scripts/service-backup.mjs'),join(platform,'scripts/service-backup.mjs'));
  await copy(join(source,'scripts/native-service-backup.mjs'),join(platform,'scripts/native-service-backup.mjs'));
  // The native publication worker uses the existing public-projection exporter
  // and Viewer-only static build. Neither npm nor a developer checkout is needed
  // on the user's Mac; these files join the exact runtime inventory below.
  const staticRoot = join(source,'apps/web/dist-static');
  const staticEntry = await lstat(join(staticRoot,'static.html'));
  if (!staticEntry.isFile() || staticEntry.isSymbolicLink()) fail('NATIVE_PACKAGE_STATIC_VIEWER_INVALID');
  try { await lstat(join(staticRoot,'static-studio.html')); fail('NATIVE_PACKAGE_STATIC_VIEWER_INVALID'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await copy(staticRoot,join(platform,'apps/web/dist-static'));
  await copy(join(source,'scripts/export-static-publication.mjs'),join(platform,'scripts/export-static-publication.mjs'));
  await copy(join(source,'scripts/native-static-export.mjs'),join(platform,'scripts/native-static-export.mjs'));
  await copy(join(source,'LICENSE'),join(platform,'LICENSE'));
  // Install exact production dependencies into the NEW payload; never prune the
  // developer checkout. No npm/tsc/vite/Homebrew executable is shipped or needed.
  await command(nodeBinary,[npmCLI,'ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:platform});
  const files = await inventory(root);
  const sourceCommit = await command('/usr/bin/git',['rev-parse','HEAD'],{cwd:source,capture:true});
  const manifest = {
    format:'exhibitos-native-runtime-v1',mode:'local-validation',platform:'darwin-arm64',
    nodeVersion:'24.21.0',postgresVersion:'18.6',platformVersion:'0.1.0',protocolVersion:'1',
    sourceCommit,producerSHA256:await hash(fileURLToPath(import.meta.url)),
    entry:{node:'bin/node',script:'platform/scripts/local-runtime.mjs',postgres:'postgres/bin/postgres',initdb:'postgres/bin/initdb'},
    files,redistributionQualified:false,officialSigned:false,
    remaining:selection.profile === 'validation-full'
      ? 'Full PostgreSQL validation copy includes optional modules: release payload minimization/complete third-party notices and final application signing/distribution are not qualified.'
      : 'Managed PostgreSQL core candidate: actual selected-file/dependency/notice and supported-backup restore qualification plus final owning-app/helper signing remain required. Optional extension support is not implied.'
  };
  await writeFile(join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  return {directory:root,files:files.length,manifestSHA256:await hash(join(root,'manifest.json')),redistributionQualified:false};
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
