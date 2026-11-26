// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash} from 'node:crypto';
import {ApiError} from './api-error.ts';
import {
  matchesDefaultCatalogueFile, planDefaultCatalogueUpdate,
  type DefaultCatalogueConsumer, type DefaultCatalogueFile, type VerifiedDefaultCatalogue,
} from './default-catalogue-update-plan.ts';

export const DEFAULT_CATALOGUE_UPDATE_PROFILE = 'default-catalogue-update-v1';

export type AdmittedCatalogue = {
  manifestSha256: string;
  catalogue: VerifiedDefaultCatalogue;
};

export type DefaultCatalogueActivation = {
  activeManifestSha256: string;
  candidateManifestSha256: string;
  planSha256: string;
};

/** The configured issuer verifies the authoritative release metadata before
 * returning a candidate. A body fetch is scoped to that exact admitted release. */
export type DefaultCatalogueSource = {
  latest(): Promise<AdmittedCatalogue | undefined>;
  fetch(release: AdmittedCatalogue, file: DefaultCatalogueFile): Promise<Uint8Array>;
  recheck(release: AdmittedCatalogue): Promise<void>;
};

export type DefaultCataloguePersistence = {
  active(): Promise<AdmittedCatalogue>;
  readBody(file: DefaultCatalogueFile): Promise<Uint8Array | undefined>;
  putBody(file: DefaultCatalogueFile, bytes: Uint8Array): Promise<void>;
  /** Publish one generation by comparing the currently active manifest. All
   * file references must already be durable; retain older admitted generations. */
  activate(previous: AdmittedCatalogue, next: AdmittedCatalogue): Promise<boolean>;
};

const identity = (release: AdmittedCatalogue) => ({
  bundleVersion: release.catalogue.bundleVersion,
  manifestSha256: release.manifestSha256,
});

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stale = () => new ApiError(409, 'DEFAULT_CATALOGUE_STALE');

export class DefaultCatalogueUpdates {
  private readonly consumer: DefaultCatalogueConsumer;
  private readonly source: DefaultCatalogueSource;
  private readonly persistence: DefaultCataloguePersistence;
  private readonly verifyCandidate?: (release:AdmittedCatalogue,stage:'plan'|'install')=>Promise<void>;

  constructor(consumer: DefaultCatalogueConsumer, source: DefaultCatalogueSource, persistence: DefaultCataloguePersistence,
    verifyCandidate?: (release:AdmittedCatalogue,stage:'plan'|'install')=>Promise<void>) {
    this.consumer = consumer;
    this.source = source;
    this.persistence = persistence;
    this.verifyCandidate = verifyCandidate;
  }

  private async plan(active: AdmittedCatalogue, candidate: AdmittedCatalogue) {
    await this.verifyCandidate?.(candidate,'plan');
    const plan = await planDefaultCatalogueUpdate(
      active.catalogue, candidate.catalogue, this.consumer,
      file => this.persistence.readBody(file),
    );
    const planSha256 = digest({active: identity(active), candidate: identity(candidate), plan});
    return {plan, planSha256};
  }

  async check() {
    const active = await this.persistence.active();
    const candidate = await this.source.latest();
    if (!candidate || active.manifestSha256 === candidate.manifestSha256) {
      return {profile: DEFAULT_CATALOGUE_UPDATE_PROFILE, active: identity(active), update: null};
    }
    const {plan, planSha256} = await this.plan(active, candidate);
    const {added, changed, downloadBytes} = plan;
    return {profile: DEFAULT_CATALOGUE_UPDATE_PROFILE, active: identity(active),
      update: {...identity(candidate), planSha256, added, changed, downloadBytes}};
  }

  async install(expected: DefaultCatalogueActivation) {
    const active = await this.persistence.active();
    const candidate = await this.source.latest();
    if (!candidate || expected.activeManifestSha256 !== active.manifestSha256 ||
        expected.candidateManifestSha256 !== candidate.manifestSha256) throw stale();
    const {plan, planSha256} = await this.plan(active, candidate);
    if (planSha256 !== expected.planSha256) throw stale();

    for (const file of plan.download) {
      const bytes = await this.source.fetch(candidate, file);
      if (!matchesDefaultCatalogueFile(file, bytes)) throw new ApiError(409, 'DEFAULT_CATALOGUE_INTEGRITY');
      await this.persistence.putBody(file, bytes);
    }
    const retained = new Map(active.catalogue.items.flatMap(item => item.files).map(file => [file.sha256, file]));
    for (const file of [...plan.reuse, ...plan.download]) retained.set(file.sha256, file);
    for (const file of retained.values()) {
      const bytes = await this.persistence.readBody(file);
      if (!bytes || !matchesDefaultCatalogueFile(file, bytes)) {
        throw new ApiError(409, 'DEFAULT_CATALOGUE_INTEGRITY');
      }
      // A later compatible Manager can replace its bundled baseline. Preserve
      // these exact admitted bodies in the existing content-addressed store.
      await this.persistence.putBody(file, bytes);
    }
    await this.verifyCandidate?.(candidate,'install');
    await this.source.recheck(candidate);
    if (!await this.persistence.activate(active, candidate)) throw stale();
    return {profile: DEFAULT_CATALOGUE_UPDATE_PROFILE, active: identity(candidate),
      previous: identity(active), downloadedBytes: plan.downloadBytes};
  }
}
