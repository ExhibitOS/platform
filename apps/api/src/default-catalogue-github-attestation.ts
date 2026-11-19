// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundleFromJSON,type Bundle} from '@sigstore/bundle';
import {getTrustedRoot} from '@sigstore/tuf';
import {Verifier, toSignedEntity, toTrustMaterial} from '@sigstore/verify';
import {ApiError} from './api-error.ts';

export const DEFAULT_CATALOGUE_REPOSITORY = 'ExhibitOS/default-furnishings';
const repositoryId = '1448069407';
const ownerId = '336286594';
const rootSha256 = '98cba97be9075bc98b2322de3de85fbd1b70ec7392991dfd2f53d215bede1a8d';
const predicateType = 'https://in-toto.io/attestation/release/v0.2';
const releaseSigner = 'https://dotcom.releases.github.com';
const sha256 = /^[a-f0-9]{64}$/;

type JSONObject = Record<string, unknown>;
export type GitHubReleaseBinding = {
  releaseId: string;
  tag: string;
  refSha: string;
  immutable: boolean;
};

const untrusted = () => new ApiError(403, 'DEFAULT_CATALOGUE_UNTRUSTED');
function object(value: unknown): JSONObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw untrusted();
  return value as JSONObject;
}

export async function githubDefaultCatalogueVerifier(cachePath: string) {
  // Exact GitHub CLI v2.101.0 GitHub-domain TUF bootstrap. The root rotates
  // only via signed TUF updates from the GitHub trust-domain mirror.
  const rootPath = fileURLToPath(new URL('../trust/github-release-tuf-root.json', import.meta.url));
  let bootstrapDirectory: string | undefined;
  try {
    const rootBytes = await readFile(rootPath);
    if (createHash('sha256').update(rootBytes).digest('hex') !== rootSha256) throw untrusted();
    // The TUF client copies the seed mode into its writable rotation cache.
    // Keep the installed seed sealed and stage only its verified public bytes.
    bootstrapDirectory = await mkdtemp(join(tmpdir(), 'exhibitos-catalogue-tuf-'));
    const bootstrapRoot = join(bootstrapDirectory, 'root.json');
    await writeFile(bootstrapRoot, rootBytes, {flag:'wx',mode:0o600});
    const root = await getTrustedRoot({rootPath:bootstrapRoot, cachePath, mirrorURL: 'https://tuf-repo.github.com', timeout: 5000});
    // GitHub immutable release certificates have a signed RFC3161 timestamp
    // rather than public-good Rekor/SCT entries. Match the GitHub CLI policy.
    return new Verifier(toTrustMaterial(root), {ctlogThreshold: 0, tlogThreshold: 0, timestampThreshold: 1});
  } catch {
    throw untrusted();
  } finally {
    if (bootstrapDirectory) await rm(bootstrapDirectory, {recursive:true,force:true});
  }
}

export function signedDefaultCatalogueAssets(attestations: unknown, binding: GitHubReleaseBinding, verifier: Verifier) {
  if (!binding.immutable || !/^v[0-9]{1,8}\.[0-9]{1,8}\.[0-9]{1,8}$/.test(binding.tag) ||
      !/^[0-9]{1,20}$/.test(binding.releaseId) || !/^[a-f0-9]{40}$/.test(binding.refSha) ||
      !Array.isArray(attestations) || attestations.length > 100) throw untrusted();
  const purl = `pkg:github/${DEFAULT_CATALOGUE_REPOSITORY}@${binding.tag}`;
  let verified: Map<string, string> | undefined;
  for (const raw of attestations) {
    const entry = object(raw);
    if (entry.initiator !== 'github') continue;
    let bundle: Bundle;
    let statement: JSONObject;
    try {
      bundle = bundleFromJSON(entry.bundle);
      if (bundle.content?.$case !== 'dsseEnvelope') continue;
      statement = object(JSON.parse(Buffer.from(bundle.content.dsseEnvelope.payload).toString('utf8')));
    } catch {
      throw untrusted();
    }
    if (statement.predicateType !== predicateType) continue;
    const predicate = object(statement.predicate);
    if (predicate.tag !== binding.tag) continue;
    if (verified || predicate.repository !== DEFAULT_CATALOGUE_REPOSITORY ||
        predicate.databaseId !== binding.releaseId || predicate.ownerId !== ownerId ||
        predicate.repositoryId !== repositoryId || predicate.packageId !== repositoryId ||
        predicate.purl !== purl || statement._type !== 'https://in-toto.io/Statement/v1' ||
        !Array.isArray(statement.subject) || statement.subject.length > 2000 ||
        !bundle.verificationMaterial?.timestampVerificationData?.rfc3161Timestamps.length) throw untrusted();
    try {
      const signer = verifier.verify(toSignedEntity(bundle));
      if (signer.identity?.subjectAlternativeName !== releaseSigner) throw untrusted();
    } catch {
      throw untrusted();
    }

    const assets = new Map<string, string>();
    let hasTag = false;
    for (const rawSubject of statement.subject) {
      const subject = object(rawSubject);
      const digest = object(subject.digest);
      if (subject.uri === purl && !subject.name && !hasTag &&
          Object.keys(digest).length === 1 && digest.sha1 === binding.refSha) {
        hasTag = true;
        continue;
      }
      if (subject.uri || typeof subject.name !== 'string' ||
          !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(subject.name) ||
          typeof digest.sha256 !== 'string' || !sha256.test(digest.sha256) ||
          Object.keys(digest).length !== 1 || assets.has(subject.name)) throw untrusted();
      assets.set(subject.name, digest.sha256);
    }
    if (!hasTag) throw untrusted();
    verified = assets;
  }
  if (!verified) throw untrusted();
  return verified;
}
