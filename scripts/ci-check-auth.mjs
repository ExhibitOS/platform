// SPDX-License-Identifier: AGPL-3.0-or-later
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {basename, join, relative, sep} from 'node:path';

const outputRoots = [
  'packages/studio-contract/dist',
  'packages/storage/dist',
  'apps/web/dist-budget-analysis',
  'apps/api/dist',
  'apps/web/dist',
];
const requiredOutputs = [
  'packages/studio-contract/dist/index.js',
  'packages/storage/dist/index.js',
  'apps/web/dist-budget-analysis/viewer-budget-geometry.mjs',
  'apps/api/dist/app.js',
  'apps/api/dist/auth.js',
  'apps/api/dist/server.js',
  'apps/api/dist/viewer-budget-geometry.mjs',
  'apps/api/dist/viewer-budget-THIRD_PARTY_NOTICES.txt',
  'apps/web/dist/index.html',
  'apps/web/dist/THIRD_PARTY_NOTICES.txt',
];
const dependencyRoots = ['node_modules', ...outputRoots
  .filter(root => !root.endsWith('/dist-budget-analysis'))
  .map(root => join(root, '..', 'node_modules'))];
const command = (file, args) => execFileSync(file, args, {encoding: 'utf8'}).trim();
const run = (file, args) => execFileSync(file, args, {stdio: 'inherit'});

// Include names and exact bytes. Vite's generated caches are outside the npm
// installation identity. The installed package trees themselves stay covered.
function fingerprint(roots, dependencies = false) {
  const digest = createHash('sha256');
  function add(path) {
    const stat = lstatSync(path);
    if (stat.isDirectory()) {
      digest.update(JSON.stringify(['directory', path]));
      for (const name of readdirSync(path).sort()) {
        if (dependencies && basename(path) === 'node_modules' && ['.vite', '.vite-temp'].includes(name)) continue;
        add(join(path, name));
      }
    } else if (dependencies && stat.isSymbolicLink()) {
      const target = relative(process.cwd(), realpathSync(path));
      if (target === '..' || target.startsWith('..' + sep)) throw Error('External npm package link');
      digest.update(JSON.stringify(['link', path, readlinkSync(path)]));
    } else if (stat.isFile()) {
      const bytes = readFileSync(path);
      digest.update(JSON.stringify(['file', path, stat.mode, bytes.length]));
      digest.update(bytes);
    } else {
      throw Error('Unexpected build or npm file type');
    }
  }
  for (const root of roots) add(root);
  return digest.digest('hex');
}

const {GITHUB_ACTIONS, GITHUB_SHA, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_JOB, RUNNER_TEMP} = process.env;
const workflow = GITHUB_ACTIONS === 'true' && GITHUB_SHA && GITHUB_RUN_ID && GITHUB_RUN_ATTEMPT && GITHUB_JOB && RUNNER_TEMP;
const receipt = workflow && join(RUNNER_TEMP, 'exhibitos-platform-check-auth.json');

function inputs() {
  const revision = command('git', ['rev-parse', 'HEAD']);
  if (revision !== GITHUB_SHA || command('git', ['status', '--porcelain', '--untracked-files=all'])) {
    throw Error('CI build inputs differ from the checked-out source');
  }
  const node = process.version;
  const npm = command('npm', ['--version']);
  const pins = JSON.parse(readFileSync('package.json', 'utf8')).engines;
  if (node !== `v${pins.node}` || npm !== pins.npm) throw Error('CI build toolchain differs from the pinned versions');
  return {
    run: GITHUB_RUN_ID,
    attempt: GITHUB_RUN_ATTEMPT,
    job: GITHUB_JOB,
    checkout: realpathSync('.'),
    revision,
    node,
    npm,
    lock: fingerprint(['package-lock.json', 'node_modules/.package-lock.json']),
    dependencies: fingerprint(dependencyRoots.filter(existsSync), true),
  };
}

function outputs() {
  for (const path of requiredOutputs) {
    if (!lstatSync(path).isFile()) throw Error('Required CI build artifact is missing');
  }
  return fingerprint(outputRoots);
}

function collect(read) {
  try {
    return read();
  } catch {
    return undefined;
  }
}

const phase = process.argv[2];
if (phase === 'check') {
  if (receipt) rmSync(receipt, {force: true});
  const before = receipt && outputRoots.every(root => !existsSync(root)) && collect(inputs);
  run('npm', ['run', 'check']);
  const after = before && collect(() => ({inputs: inputs(), outputs: outputs()}));
  if (after && JSON.stringify(before) === JSON.stringify(after.inputs)) {
    writeFileSync(receipt, JSON.stringify(after), {flag: 'wx', mode: 0o600});
    console.log('Recorded this CI check build for auth.');
  }
} else if (phase === 'auth') {
  const recorded = receipt && collect(() => readFileSync(receipt, 'utf8'));
  if (receipt) rmSync(receipt, {force: true});
  const current = recorded && collect(() => JSON.stringify({inputs: inputs(), outputs: outputs()}));
  if (current && current === recorded) {
    console.log('Reusing this CI check build for auth.');
    run(process.execPath, ['scripts/test-auth.mjs']);
  } else {
    console.log('No matching CI check build; running the standalone auth build.');
    run('npm', ['run', 'test:auth']);
  }
} else {
  throw Error('Expected CI phase check or auth');
}
