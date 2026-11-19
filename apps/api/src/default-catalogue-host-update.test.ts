// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import type {FileBlobStore} from '@exhibitos/storage';
import type {PoolClient} from 'pg';
import {afterEach, expect, it, vi} from 'vitest';
import {githubDefaultCatalogueVerifier, signedDefaultCatalogueAssets} from './default-catalogue-github-attestation.ts';
import {githubDefaultCatalogueSource} from './default-catalogue-github-source.ts';
import {createDefaultCatalogueRuntime} from './default-catalogue-runtime.ts';
import type {DefaultCatalogueFile} from './default-catalogue-update-plan.ts';
import hosts from './installed-workspace-hosts.json' with {type:'json'};

vi.mock('./default-catalogue-github-attestation.ts', () => ({
  DEFAULT_CATALOGUE_REPOSITORY: 'ExhibitOS/default-furnishings',
  githubDefaultCatalogueVerifier: vi.fn(),
  signedDefaultCatalogueAssets: vi.fn(),
}));

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown) => Buffer.from(JSON.stringify(value));
const sourceCommit = 'b'.repeat(40);
const railCapabilities = ['workspace-ceiling-rail-v1', 'source-bound-fit-v1'];
const portalCapabilities = ['workspace-portal-finish-v1', 'modular-portal-v1'];
const frameCapability = 'workspace-artwork-frame-models-v1';
const baselineBody = Buffer.from('retained body');

type BundleRow = {
  catalogId: string; catalogVersion: number; hostKind: string;
  workspaceFurnishing?: unknown; model: DefaultCatalogueFile & {mime: string};
  rights: {licenseId: string; notice: DefaultCatalogueFile};
};
function addedRow(entry: {
  catalogId: string; path: string; descriptor: {model: Omit<BundleRow['model'], 'path'>};
  notice: DefaultCatalogueFile;
}, hostKind: string): BundleRow {
  return {
    catalogId: entry.catalogId, catalogVersion: 1, hostKind,
    workspaceFurnishing: entry.descriptor, model: {path: entry.path, ...entry.descriptor.model},
    rights: {licenseId: 'CC0-1.0', notice: entry.notice},
  };
}

const retained: BundleRow = {
  catalogId: 'retained', catalogVersion: 1, hostKind: 'bench',
  model: {path: 'assets/model.glb', bytes: baselineBody.length, sha256: digest(baselineBody), mime: 'model/gltf-binary'},
  rights: {licenseId: 'CC0-1.0', notice: {path: 'assets/NOTICE.txt', bytes: baselineBody.length, sha256: digest(baselineBody)}},
};
const installedRows = hosts.map(entry => addedRow(entry, entry.hostKind));
const capabilities = [frameCapability, ...railCapabilities, ...portalCapabilities];

function release(version: string, rows: BundleRow[], requiredCapabilities = capabilities) {
  const bundleSchema = 'org.exhibitos.default-furnishings/v1';
  const manifest = json({schema: bundleSchema, bundleVersion: version, assets: rows});
  const metadata = json({
    schema: 'org.exhibitos.default-catalogue-release/v1', bundleSchema, bundleVersion: version,
    minimumManagerVersion: '0.1.0', requiredCapabilities, sourceCommit,
    manifest: {bytes: manifest.length, sha256: digest(manifest)},
    items: rows.map(row => {
      const {mime, ...model} = row.model;
      expect(mime).toBe('model/gltf-binary');
      return {id: row.catalogId, version: row.catalogVersion, descriptorSha256: digest(json(row)),
        files: [model, row.rights.notice]};
    }),
  });
  return {metadata, manifest, tag: 'v' + version, commit: sourceCommit};
}

function check(candidate: ReturnType<typeof release>, support = {ceilingRail: true, modularPortal: true}, previous = '2.0.0') {
  const baseline = release(previous, [retained], [frameCapability]);
  const runtime = createDefaultCatalogueRuntime({workspaceId: 'workspace', tenantId: 'tenant'},
    {getBounded: async () => { throw Object.assign(Error('not yet installed'), {code: 'ENOENT'}); }} as unknown as FileBlobStore,
    baseline, '0.1.0', async () => baselineBody, admit => ({
      latest: async () => admit(candidate.metadata, candidate.manifest, candidate.tag, candidate.commit),
      fetch: async () => { throw Error('check must not fetch bodies'); },
      recheck: async () => { throw Error('check must not activate'); },
    }));
  const client = {query: async () => ({rows: []})} as unknown as PoolClient;
  return runtime.updates(client, support).check();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('plans only the exact added model and notice bodies for the current compatible consumer', async () => {
  const candidate = release('2.1.0', [retained, ...installedRows]);
  await expect(check(candidate)).resolves.toMatchObject({
    active: {bundleVersion: '2.0.0'},
    update: {bundleVersion: '2.1.0', added: installedRows.map(({catalogId}) => ({id: catalogId, version: 1})),
      changed: [], downloadBytes: installedRows.reduce((bytes, row) => bytes + row.model.bytes + row.rights.notice.bytes, 0)},
  });
});

it('refuses unavailable hosts, missing declared capability and mismatched source roles', async () => {
  const candidate = release('2.1.0', [retained, ...installedRows]);
  const incompatible = {code: 'DEFAULT_CATALOGUE_INCOMPATIBLE'};
  await expect(check(candidate, {ceilingRail: true, modularPortal: false})).rejects.toMatchObject(incompatible);
  await expect(check(release('2.1.0', [retained, ...installedRows], capabilities.filter(cap => cap !== 'modular-portal-v1'))))
    .rejects.toMatchObject(incompatible);
  const [rail, portal] = installedRows;
  await expect(check(release('2.1.0', [retained, rail!, {...portal!, hostKind: 'ceiling-rail'}])))
    .rejects.toMatchObject(incompatible);
  const wrongNotice = {...rail!.rights.notice, path: portal!.rights.notice.path};
  await expect(check(release('2.1.0', [retained, rail!, {...portal!, rights: {...portal!.rights, notice: wrongNotice}}])))
    .rejects.toMatchObject(incompatible);
});

it('uses the current stable release and rechecks its attested identity', async () => {
  const latest = {tag_name: 'v2.1.0', id: 21, draft: false, prerelease: false, immutable: true};
  const metadata = json({}), manifest = json({version: '2.1.0'});
  const bodies = new Map([['catalogue-release-v1.json', metadata], ['default-furnishings-manifest.json', manifest]]);
  const proof = new Map([...bodies].map(([name, body]) => [name, digest(body)]));
  vi.mocked(signedDefaultCatalogueAssets).mockReturnValue(proof);
  const fetch = vi.fn(async (target: string) => {
    const url = new URL(target);
    const apiPath = '/repos/ExhibitOS/default-furnishings';
    if (url.hostname === 'api.github.com') {
      if (url.pathname === apiPath + '/releases/latest') return Response.json(latest);
      if (url.pathname === apiPath + '/git/ref/tags/v2.1.0') return Response.json({object: {type: 'commit', sha: sourceCommit}});
      if (url.pathname === apiPath + '/attestations/sha1:' + sourceCommit) return Response.json({attestations: []});
      if (url.pathname === apiPath + '/releases/21/assets') return Response.json([...bodies].map(([name, body]) =>
        ({name, size: body.length, digest: 'sha256:' + digest(body), state: 'uploaded'})));
    }
    const body = url.hostname === 'github.com' && url.pathname.startsWith('/ExhibitOS/default-furnishings/releases/download/v2.1.0/')
      && bodies.get(url.pathname.split('/').at(-1)!);
    if (body) return new Response(new Uint8Array(body));
    throw Error('unexpected fetch ' + target);
  });
  vi.stubGlobal('fetch', fetch);
  const admit = vi.fn(() => ({manifestSha256: digest(manifest), catalogue: {
    bundleVersion: '2.1.0', bundleSchema: 'org.exhibitos.default-furnishings/v1', minimumManagerVersion: '0.1.0',
    requiredCapabilities: capabilities, items: [],
  }}));
  const source = githubDefaultCatalogueSource('/unused', admit);
  const candidate = (await source.latest())!;
  expect(admit).toHaveBeenCalledWith(metadata, manifest, 'v2.1.0', sourceCommit);
  expect(githubDefaultCatalogueVerifier).toHaveBeenCalledWith('/unused');
  expect(signedDefaultCatalogueAssets).toHaveBeenCalledWith([], {releaseId: '21', tag: 'v2.1.0', refSha: sourceCommit, immutable: true}, undefined);
  await expect(source.recheck(candidate)).resolves.toBeUndefined();
  latest.immutable = false;
  await expect(source.recheck(candidate)).rejects.toMatchObject({code: 'DEFAULT_CATALOGUE_UNTRUSTED'});
});
