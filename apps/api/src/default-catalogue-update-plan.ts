// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {ApiError} from './api-error.ts';

export type DefaultCatalogueFile = {
  path: string;
  bytes: number;
  sha256: string;
};

export type DefaultCatalogueItem = {
  id: string;
  version: number;
  descriptorSha256: string;
  files: readonly DefaultCatalogueFile[];
};

// Inputs come from the release verifier and the existing admitted catalogue.
// This contract carries no credentials, arbitrary URL, or filesystem root.
export type VerifiedDefaultCatalogue = {
  bundleVersion: string;
  bundleSchema: string;
  minimumManagerVersion: string;
  requiredCapabilities: readonly string[];
  items: readonly DefaultCatalogueItem[];
};

export type DefaultCatalogueConsumer = {
  managerVersion: string;
  supportedSchemas: ReadonlySet<string>;
  capabilities: ReadonlySet<string>;
};

function invalid(): never {
  throw new ApiError(422, 'DEFAULT_CATALOGUE_INVALID');
}

function versionParts(value: string) {
  if (!/^\d{1,8}\.\d{1,8}\.\d{1,8}$/.test(value)) return invalid();
  const parts = value.split('.').map(Number);
  if (parts.join('.') !== value) return invalid();
  return parts;
}

function compareVersions(left: string, right: string) {
  const a = versionParts(left), b = versionParts(right);
  return a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
}

const digest = /^[a-f0-9]{64}$/;
const segment = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;

function inventory(catalogue: VerifiedDefaultCatalogue) {
  const items = new Map<string, DefaultCatalogueItem>();
  const paths = new Set<string>();
  const hashes = new Map<string, DefaultCatalogueFile>();
  for (const item of catalogue.items) {
    if (!/^[a-z0-9-]{1,128}$/.test(item.id) || items.has(item.id) ||
        !Number.isSafeInteger(item.version) || item.version < 1 ||
        !digest.test(item.descriptorSha256) || !item.files.length) return invalid();
    items.set(item.id, item);
    for (const file of item.files) {
      if (!file.path.startsWith('assets/') || file.path.length > 512 ||
          !file.path.split('/').every(part => segment.test(part)) || paths.has(file.path) ||
          !Number.isSafeInteger(file.bytes) || file.bytes < 1 || !digest.test(file.sha256)) return invalid();
      paths.add(file.path);
      const previous = hashes.get(file.sha256);
      if (previous && previous.bytes !== file.bytes) return invalid();
      if (!previous) hashes.set(file.sha256, file);
    }
  }
  return {items, hashes};
}

export function matchesDefaultCatalogueFile(file: DefaultCatalogueFile, body: Uint8Array): boolean {
  return body.byteLength === file.bytes && createHash('sha256').update(body).digest('hex') === file.sha256;
}

/** The local lookup may return a cached or packaged body. Only verified bytes
 * count as reusable. One complete download supplies each missing content hash. */
export async function planDefaultCatalogueUpdate(
  active: VerifiedDefaultCatalogue,
  candidate: VerifiedDefaultCatalogue,
  consumer: DefaultCatalogueConsumer,
  readLocalBody: (file: DefaultCatalogueFile) => Promise<Uint8Array | undefined>,
) {
  if (compareVersions(candidate.bundleVersion, active.bundleVersion) <= 0 ||
      compareVersions(consumer.managerVersion, candidate.minimumManagerVersion) < 0 ||
      !consumer.supportedSchemas.has(candidate.bundleSchema) ||
      !candidate.requiredCapabilities.every(capability => consumer.capabilities.has(capability))) {
    throw new ApiError(409, 'DEFAULT_CATALOGUE_INCOMPATIBLE');
  }

  const previous = inventory(active);
  const next = inventory(candidate);
  const added: {id: string; version: number}[] = [];
  const changed: {id: string; version: number}[] = [];
  for (const [id, item] of next.items) {
    const old = previous.items.get(id);
    if (!old) {
      added.push({id, version: item.version});
      continue;
    }
    if (item.version < old.version) return invalid();
    if (item.version > old.version) {
      changed.push({id, version: item.version});
      continue;
    }
    // A version already used by authored documents must retain its exact
    // descriptor and every role-filtered file, including provenance and notices.
    const sortedFiles = (entry: DefaultCatalogueItem) =>
      [...entry.files].sort((left, right) => left.path.localeCompare(right.path));
    const nextFiles = sortedFiles(item), oldFiles = sortedFiles(old);
    if (item.descriptorSha256 !== old.descriptorSha256 || nextFiles.length !== oldFiles.length ||
        nextFiles.some((file, index) => {
          const prior = oldFiles[index]!;
          return file.path !== prior.path || file.bytes !== prior.bytes || file.sha256 !== prior.sha256;
        })) return invalid();
  }

  const download: DefaultCatalogueFile[] = [];
  const reuse: DefaultCatalogueFile[] = [];
  let downloadBytes = 0;
  for (const [sha256, file] of next.hashes) {
    const local = await readLocalBody(previous.hashes.get(sha256) ?? file);
    if (local && matchesDefaultCatalogueFile(file, local)) {
      reuse.push(file);
    } else {
      download.push(file);
      downloadBytes += file.bytes;
      if (!Number.isSafeInteger(downloadBytes)) return invalid();
    }
  }

  return {bundleVersion: candidate.bundleVersion, added, changed, download, reuse, downloadBytes};
}
