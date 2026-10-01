import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { verifyArtifact } from './artifact-integrity.mjs';

const artifact = await verifyArtifact();
const spec = await import('@exhibitos/spec');
const json = async path => JSON.parse(await readFile(spec.fixtureURL(path), 'utf8'));
const expectedCases = [
  'artwork-model-files', 'artwork-image-files', 'exhibition-files', 'publication', 'freeze',
  'oex-binary', 'oed-local', 'oed-ssh', 'reject-unknown-artwork-version', 'reject-zero-scale',
  'reject-publication-rights', 'reject-dangling-room', 'reject-leap-second',
  'reject-corrupted-oex', 'reject-raw-credential-field',
];

test('installed package matches immutable public provenance and has original licenses', async () => {
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve('@exhibitos/spec/package.json');
  const metadata = JSON.parse(await readFile(packagePath, 'utf8'));
  assert.equal(metadata.name, artifact.package);
  assert.equal(metadata.version, artifact.packageVersion);
  assert.equal(metadata.license, 'Apache-2.0');
  assert.match(await readFile(resolve(dirname(packagePath), 'LICENSE'), 'utf8'), /Apache-2\.0/);
});

test('all shared positive and negative cases run from the packaged public fixtures', async () => {
  const result = await spec.runConformance();
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.cases.map(item => item.id).sort(), [...expectedCases].sort());
  assert.ok(result.cases.every(item => item.valid));
});

test('OES fixture validates and unknown version and physical scale mutations are rejected', async () => {
  const sculpture = await json('oes/v1/examples/sculpture.json');
  assert.equal(spec.validateArtwork(sculpture).valid, true);
  assert.equal(spec.validateArtwork({ ...sculpture, schemaVersion: '2.0.0' }).valid, false);
  const invalidScale = structuredClone(sculpture);
  invalidScale.transform.scale[0] = 0;
  assert.equal(spec.validateArtwork(invalidScale).valid, false);
});

test('OEX packaged bytes validate and a byte mutation is rejected', async () => {
  const original = await readFile(spec.fixtureURL('oex/v1/examples/synthetic.oex'));
  assert.equal((await spec.validateOex(original)).valid, true);
  const changed = Buffer.from(original);
  changed[0] ^= 1;
  const invalid = await spec.validateOex(changed);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.length > 0);
});

test('OED public fixture validates and an undeclared field is rejected', async () => {
  const deployment = await json('oed/v1/examples/local.json');
  assert.equal(spec.validateOed(deployment).valid, true);
  assert.equal(spec.validateOed({ ...deployment, undeclaredConsumerField: true }).valid, false);
});

test('packaged CLI runs without spec checkout, private code, or operations files', () => {
  const require = createRequire(import.meta.url);
  const packageRoot = dirname(require.resolve('@exhibitos/spec/package.json'));
  const output = execFileSync(process.execPath, [resolve(packageRoot, 'conformance/cli.mjs')], { encoding: 'utf8' });
  const result = JSON.parse(output);
  assert.equal(result.valid, true);
  assert.deepEqual(result.cases.map(item => item.id).sort(), [...expectedCases].sort());
});


test('tarball byte corruption is rejected by the provenance gate', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'exhibitos-contract-integrity-'));
  try {
    for (const directory of ['scripts', 'contracts', 'vendor']) await mkdir(join(temporary, directory));
    await copyFile(new URL('./artifact-integrity.mjs', import.meta.url), join(temporary, 'scripts/artifact-integrity.mjs'));
    await copyFile(new URL('../contracts/artifact.json', import.meta.url), join(temporary, 'contracts/artifact.json'));
    const corrupted = await readFile(new URL(`../${artifact.file}`, import.meta.url));
    corrupted[0] ^= 1;
    await writeFile(join(temporary, artifact.file), corrupted);
    const target = pathToFileURL(join(temporary, 'scripts/artifact-integrity.mjs')).href;
    assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e',
      `const module = await import(${JSON.stringify(target)}); await module.verifyArtifact();`], { stdio: 'pipe' }),
    error => error.status !== 0 && String(error.stderr).includes('archive SHA-256 mismatch'));
  } finally { await rm(temporary, { recursive: true, force: true }); }
});


test('all documented packaged JSON schema aliases resolve with import attributes', async () => {
  for (const name of ['artwork', 'exhibition', 'lifecycle', 'oex', 'oed']) {
    const imported = await import(`@exhibitos/spec/schemas/${name}.json`, { with: { type: 'json' } });
    const original = JSON.parse(await readFile(spec.schemaURL(name), 'utf8'));
    assert.deepEqual(imported.default, original);
    assert.ok(typeof imported.default.$id === 'string');
  }
});
