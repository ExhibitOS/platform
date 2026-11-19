// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {ApiError} from '../apps/api/src/api-error.ts';
import {planDefaultCatalogueUpdate} from '../apps/api/src/default-catalogue-update-plan.ts';
import {DefaultCatalogueUpdates} from '../apps/api/src/default-catalogue-update.ts';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const frameCapability = 'workspace-artwork-frame-models-v1';
const bodies = new Map();
function file(path, content) {
  const body = Buffer.from(content);
  bodies.set(path, body);
  return {path, bytes: body.length, sha256: digest(body)};
}
const retained = {id: 'retained', version: 1, descriptorSha256: 'a'.repeat(64),
  files: [file('assets/retained/model.glb', 'retained model')]};
const added = {id: 'new', version: 1, descriptorSha256: 'b'.repeat(64),
  files: [file('assets/new/model.glb', 'new model'), file('assets/new/NOTICE.txt', 'new notice')]};
const active = {bundleVersion: '2.0.0', bundleSchema: 'org.exhibitos.default-furnishings/v1',
  minimumManagerVersion: '0.1.0', requiredCapabilities: [frameCapability], items: [retained]};
const candidate = {...active, bundleVersion: '2.1.0', items: [retained, added]};
const consumer = {managerVersion: '0.1.0', supportedSchemas: new Set([active.bundleSchema]),
  capabilities: new Set([frameCapability])};
const readLocal = async ({path}) => path === retained.files[0].path ? Buffer.from(bodies.get(path)) : undefined;

test('binds current catalogue compatibility and retained file identities before planning', async () => {
  const plan = await planDefaultCatalogueUpdate(active, candidate, consumer, readLocal);
  assert.deepEqual(plan.reuse, retained.files);
  assert.deepEqual(plan.download, added.files);
  for (const request of [
    {...candidate, minimumManagerVersion: '9.0.0'},
    {...candidate, requiredCapabilities: ['unknown']},
    {...candidate, bundleSchema: 'unsupported'},
  ]) await assert.rejects(planDefaultCatalogueUpdate(active, request, consumer, readLocal),
    {code: 'DEFAULT_CATALOGUE_INCOMPATIBLE'});
  const rebound = {...candidate, items: [{...retained, descriptorSha256: '0'.repeat(64)}, added]};
  await assert.rejects(planDefaultCatalogueUpdate(active, rebound, consumer, readLocal),
    {code: 'DEFAULT_CATALOGUE_INVALID'});
  const damaged = await planDefaultCatalogueUpdate(active, candidate, consumer, async () => Buffer.from('tampered'));
  assert.deepEqual(damaged.download, [...retained.files, ...added.files]);
});

test('activates once after full verification and retains the current generation on refusal', async () => {
  const baseline = {manifestSha256: '1'.repeat(64), catalogue: active};
  const next = {manifestSha256: '2'.repeat(64), catalogue: candidate};
  let current = baseline;
  let activationCount = 0;
  let failure;
  const staged = new Map();
  const updates = new DefaultCatalogueUpdates(consumer, {
    latest: async () => next,
    async fetch(release, file) {
      assert.equal(release, next);
      if (failure === 'interrupted') throw Error('interrupted body');
      const body = Buffer.from(bodies.get(file.path));
      if (failure === 'corrupt') body[0] ^= 1;
      return body;
    },
    async recheck() {
      if (failure === 'untrusted') throw new ApiError(403, 'DEFAULT_CATALOGUE_UNTRUSTED');
    },
  }, {
    active: async () => current,
    readBody: async file => staged.get(file.sha256) ?? readLocal(file),
    async putBody(file, body) { staged.set(file.sha256, body); },
    async activate(previous, release) {
      if (failure === 'stale' || current !== previous) return false;
      current = release;
      activationCount += 1;
      return true;
    },
  });
  const reviewed = async () => {
    const check = await updates.check();
    return {activeManifestSha256: check.active.manifestSha256,
      candidateManifestSha256: check.update.manifestSha256, planSha256: check.update.planSha256};
  };
  for (const [mode, error] of [
    ['corrupt', {code: 'DEFAULT_CATALOGUE_INTEGRITY'}],
    ['interrupted', /interrupted body/],
    ['untrusted', {code: 'DEFAULT_CATALOGUE_UNTRUSTED'}],
    ['stale', {code: 'DEFAULT_CATALOGUE_STALE'}],
  ]) {
    staged.clear();
    failure = mode;
    await assert.rejects(updates.install(await reviewed()), error);
    assert.equal(current, baseline);
    assert.equal(activationCount, 0);
  }
  staged.clear();
  failure = undefined;
  const selection = await reviewed();
  const installed = await updates.install(selection);
  assert.equal(activationCount, 1);
  assert.equal(installed.downloadedBytes, added.files.reduce((size, file) => size + file.bytes, 0));
  assert.equal(installed.active.manifestSha256, next.manifestSha256);
  assert.equal(installed.previous.manifestSha256, baseline.manifestSha256);
  assert.deepEqual(staged.get(retained.files[0].sha256), bodies.get(retained.files[0].path));
  await assert.rejects(updates.install(selection), {code: 'DEFAULT_CATALOGUE_STALE'});
  assert.equal((await updates.check()).update, null);
});
