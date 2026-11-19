// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ApiError} from './api-error.ts';
import type {DefaultCatalogueFile, DefaultCatalogueItem} from './default-catalogue-update-plan.ts';
import type {AdmittedCatalogue} from './default-catalogue-update.ts';

export const DEFAULT_CATALOGUE_BUNDLE_SCHEMA = 'org.exhibitos.default-furnishings/v1';
export const DEFAULT_CATALOGUE_RELEASE_SCHEMA = 'org.exhibitos.default-catalogue-release/v1';
type Row = Record<string, unknown>;
const invalid = () => new ApiError(422, 'DEFAULT_CATALOGUE_INVALID');
const hash = /^[a-f0-9]{64}$/;

function record(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Row;
}

function closed(value: unknown, keys: string[]) {
  const row = record(value);
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) throw invalid();
  return row;
}

function readFile(value: unknown): DefaultCatalogueFile {
  const file = closed(value, ['path', 'bytes', 'sha256']);
  if (typeof file.path !== 'string' || !file.path.startsWith('assets/') ||
      !file.path.split('/').every(part => /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(part)) ||
      typeof file.bytes !== 'number' || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 ||
      typeof file.sha256 !== 'string' || !hash.test(file.sha256)) throw invalid();
  return {path: file.path, bytes: file.bytes, sha256: file.sha256};
}

function parse(data: Buffer) {
  try { return JSON.parse(data.toString('utf8')) as unknown; }
  catch { throw invalid(); }
}

/** Bind the release transport metadata to the original and logical asset
 * roles. The installed consumer supplies its supported row admission rule. */
export function admitDefaultCatalogueRelease(
  metadata: Buffer,
  manifest: Buffer,
  tag: string,
  sourceCommit: string,
  admitItem: (row: Readonly<Row>, normalized: DefaultCatalogueItem) => boolean,
): AdmittedCatalogue {
  const release = closed(parse(metadata), [
    'schema', 'bundleSchema', 'bundleVersion', 'minimumManagerVersion',
    'requiredCapabilities', 'sourceCommit', 'manifest', 'items',
  ]);
  const original = closed(parse(manifest), ['schema', 'bundleVersion', 'assets']);
  const manifestSha256 = createHash('sha256').update(manifest).digest('hex');
  if (release.schema !== DEFAULT_CATALOGUE_RELEASE_SCHEMA ||
      release.bundleSchema !== DEFAULT_CATALOGUE_BUNDLE_SCHEMA || original.schema !== release.bundleSchema ||
      typeof release.bundleVersion !== 'string' || release.bundleVersion !== original.bundleVersion ||
      tag !== 'v' + release.bundleVersion || release.sourceCommit !== sourceCommit ||
      typeof release.minimumManagerVersion !== 'string' ||
      !Array.isArray(release.requiredCapabilities) || !release.requiredCapabilities.length ||
      !release.requiredCapabilities.every(capability => typeof capability === 'string' && /^[a-z0-9-]{1,128}$/.test(capability)) ||
      new Set(release.requiredCapabilities).size !== release.requiredCapabilities.length ||
      !isDeepStrictEqual(release.manifest, {bytes: manifest.length, sha256: manifestSha256}) ||
      !Array.isArray(original.assets) || !Array.isArray(release.items) || original.assets.length !== release.items.length) throw invalid();
  const byId = new Map<string, Row>();
  for (const value of original.assets) {
    const row = record(value);
    if (typeof row.catalogId !== 'string' || byId.has(row.catalogId)) throw invalid();
    byId.set(row.catalogId, row);
  }
  const seen = new Set<string>();
  const items = [];
  for (const value of release.items) {
    const item = closed(value, ['id', 'version', 'descriptorSha256', 'files']);
    if (typeof item.id !== 'string' || !/^[a-z0-9-]{1,128}$/.test(item.id) || typeof item.version !== 'number' ||
        !Number.isSafeInteger(item.version) || item.version < 1 || typeof item.descriptorSha256 !== 'string' ||
        !Array.isArray(item.files)) throw invalid();
    const row = byId.get(item.id);
    if (!row || row.catalogVersion !== item.version ||
        createHash('sha256').update(JSON.stringify(row)).digest('hex') !== item.descriptorSha256) throw invalid();
    byId.delete(item.id);
    const files = item.files.map(readFile);
    for (const file of files) {
      if (seen.has(file.path)) throw invalid();
      seen.add(file.path);
    }
    const rawModel = record(row.model);
    const model = readFile({path: rawModel.path, bytes: rawModel.bytes, sha256: rawModel.sha256});
    const rights = closed(row.rights, ['licenseId', 'notice']);
    const notice = readFile(rights.notice);
    if (!isDeepStrictEqual(files.find(file => file.path === model.path), model) ||
        !isDeepStrictEqual(files.find(file => file.path === notice.path), notice) ||
        rights.licenseId !== 'CC0-1.0' || rawModel.mime !== 'model/gltf-binary') throw invalid();
    const normalized = {id: item.id, version: item.version, descriptorSha256: item.descriptorSha256, files};
    if (!admitItem(row, normalized)) throw new ApiError(409, 'DEFAULT_CATALOGUE_INCOMPATIBLE');
    items.push(normalized);
  }
  return {manifestSha256, catalogue: {
    bundleSchema: release.bundleSchema, bundleVersion: release.bundleVersion,
    minimumManagerVersion: release.minimumManagerVersion, requiredCapabilities: release.requiredCapabilities, items,
  }};
}
