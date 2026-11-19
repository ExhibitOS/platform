// SPDX-License-Identifier: AGPL-3.0-or-later
import {ApiError} from './api-error.ts';
import {matchesDefaultCatalogueFile, type DefaultCatalogueFile} from './default-catalogue-update-plan.ts';
import type {AdmittedCatalogue, DefaultCatalogueSource} from './default-catalogue-update.ts';
import {DEFAULT_CATALOGUE_REPOSITORY, githubDefaultCatalogueVerifier, signedDefaultCatalogueAssets} from './default-catalogue-github-attestation.ts';

const api = `https://api.github.com/repos/${DEFAULT_CATALOGUE_REPOSITORY}`;
const releaseHost = `https://github.com/${DEFAULT_CATALOGUE_REPOSITORY}/releases/download/`;
const allowedRedirectHosts = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const metadataName = 'catalogue-release-v1.json';
const manifestName = 'default-furnishings-manifest.json';
const fileName = (sha256: string) => 'catalogue-body-' + sha256;
const catalogueTag = /^v(?:0|[1-9][0-9]{0,7})\.(?:0|[1-9][0-9]{0,7})\.(?:0|[1-9][0-9]{0,7})$/;
const untrusted = () => new ApiError(403, 'DEFAULT_CATALOGUE_UNTRUSTED');

type JSONObject = Record<string, unknown>;
function object(value: unknown): JSONObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw untrusted();
  return value as JSONObject;
}

async function readResponse(response: Response, limit: number) {
  if (!response.ok || !response.body) throw untrusted();
  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  let length = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) return Buffer.concat(chunks, length);
      length += value.length;
      if (length > limit) throw untrusted();
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

const timeout = () => AbortSignal.timeout(15000);
async function getJsonValue(path: string): Promise<unknown> {
  const response = await fetch(api + path, {
    redirect: 'error', signal: timeout(), headers: {accept: 'application/vnd.github+json'},
  });
  return JSON.parse((await readResponse(response, 2 * 1024 * 1024)).toString('utf8'));
}

const getJson = async (path: string) => object(await getJsonValue(path));

type Asset = DefaultCatalogueFile & {name: string};
type VerifiedRelease = {
  tag: string;
  refSha: string;
  id: string;
  assets: Map<string, Asset>;
};

async function fetchAsset(release: VerifiedRelease, asset: Asset) {
  const signal = timeout();
  let response = await fetch(releaseHost + encodeURIComponent(release.tag) + '/' + encodeURIComponent(asset.name), {
    redirect: 'manual', signal,
  });
  if (response.status === 302 || response.status === 307) {
    const location = response.headers.get('location');
    if (!location) throw untrusted();
    const redirect = new URL(location);
    if (redirect.protocol !== 'https:' || !allowedRedirectHosts.has(redirect.hostname) ||
        redirect.username || redirect.password || redirect.port) throw untrusted();
    await response.body?.cancel();
    response = await fetch(redirect, {redirect: 'error', signal});
  }
  const data = await readResponse(response, asset.bytes);
  if (!matchesDefaultCatalogueFile(asset, data)) throw new ApiError(409, 'DEFAULT_CATALOGUE_INTEGRITY');
  return data;
}

/** The runtime's admission function binds the signed compatibility manifest
 * to independently supported model, host, rights and asset producer roles. */
export function githubDefaultCatalogueSource(
  cachePath: string,
  admit: (metadata: Buffer, manifest: Buffer, tag: string, sourceCommit: string) => AdmittedCatalogue,
): DefaultCatalogueSource {
  async function release(): Promise<VerifiedRelease | undefined> {
    const latest = await getJson('/releases/latest');
    const tag = latest.tag_name;
    if (latest.draft !== false || latest.prerelease !== false || latest.immutable !== true ||
        typeof tag !== 'string' || !catalogueTag.test(tag) ||
        typeof latest.id !== 'number' || !Number.isSafeInteger(latest.id) || latest.id < 1) throw untrusted();
    const ref = object((await getJson('/git/ref/tags/' + tag)).object);
    if (typeof ref.sha !== 'string' || !/^[a-f0-9]{40}$/.test(ref.sha) || ref.type !== 'commit') throw untrusted();
    const refSha = ref.sha, id = String(latest.id);
    const {attestations} = await getJson('/attestations/sha1:' + refSha + '?predicate_type=release&initiator=github');
    const proof = signedDefaultCatalogueAssets(attestations, {
      releaseId: id, tag, refSha, immutable: true,
    }, await githubDefaultCatalogueVerifier(cachePath));
    // GitHub paginates the release asset collection and caps it at 1000.
    if (proof.size > 1000) throw untrusted();
    const rows: unknown[] = [];
    const pageSize = 100;
    for (let page = 1; page <= Math.floor(proof.size / pageSize) + 1; page += 1) {
      const values = await getJsonValue(`/releases/${id}/assets?per_page=${pageSize}&page=${page}`);
      if (!Array.isArray(values) || values.length > pageSize) throw untrusted();
      rows.push(...values);
      if (values.length < pageSize) break;
    }
    if (rows.length !== proof.size) throw untrusted();
    const assets = new Map<string, Asset>();
    for (const raw of rows) {
      const asset = object(raw);
      const name = asset.name, bytes = asset.size;
      const sha256 = typeof name === 'string' && proof.get(name);
      if (typeof name !== 'string' || !sha256 || asset.digest !== 'sha256:' + sha256 ||
          assets.has(name) || asset.state !== 'uploaded' || typeof bytes !== 'number' ||
          !Number.isSafeInteger(bytes) || bytes < 1 || bytes > 32 * 1024 * 1024) throw untrusted();
      assets.set(name, {name, path: name, bytes, sha256});
    }
    if (!assets.size) return;
    if (!assets.has(metadataName) || !assets.has(manifestName)) throw untrusted();
    return {tag, refSha, id, assets};
  }

  const verified = new WeakMap<AdmittedCatalogue, VerifiedRelease>();
  return {
    async latest() {
      const candidate = await release();
      if (!candidate) return;
      const metadata = candidate.assets.get(metadataName)!, manifest = candidate.assets.get(manifestName)!;
      if (metadata.bytes > 1024 * 1024 || manifest.bytes > 1024 * 1024) throw untrusted();
      const [metadataBytes, manifestBytes] = await Promise.all([fetchAsset(candidate, metadata), fetchAsset(candidate, manifest)]);
      const admitted = admit(metadataBytes, manifestBytes, candidate.tag, candidate.refSha);
      if (admitted.manifestSha256 !== manifest.sha256 ||
          'v' + admitted.catalogue.bundleVersion !== candidate.tag) throw untrusted();
      const expected = new Set([metadataName, manifestName]);
      for (const item of admitted.catalogue.items) {
        for (const file of item.files) {
          const name = fileName(file.sha256);
          const asset = candidate.assets.get(name);
          if (!asset || asset.bytes !== file.bytes || asset.sha256 !== file.sha256) throw untrusted();
          expected.add(name);
        }
      }
      if (expected.size !== candidate.assets.size) throw untrusted();
      verified.set(admitted, candidate);
      return admitted;
    },
    async fetch(admitted, file) {
      const candidate = verified.get(admitted);
      const asset = candidate?.assets.get(fileName(file.sha256));
      if (!candidate || !asset || asset.bytes !== file.bytes || asset.sha256 !== file.sha256) throw untrusted();
      return fetchAsset(candidate, asset);
    },
    async recheck(admitted) {
      const previous = verified.get(admitted);
      const current = await release();
      const same = previous && current && previous.id === current.id && previous.tag === current.tag &&
        previous.refSha === current.refSha && previous.assets.size === current.assets.size &&
        [...previous.assets].every(([key, old]) => {
          const next = current.assets.get(key);
          return next?.sha256 === old.sha256 && next.bytes === old.bytes;
        });
      if (!same) throw untrusted();
    },
  };
}
