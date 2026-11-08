// SPDX-License-Identifier: AGPL-3.0-or-later
import { DraftStore } from '../drafts/store';
import type { PrivateSeed } from './model';

export interface PreviousBase {
  publicationId: string;
  revisionSha256: string;
  indexSha256: string;
}

const hash = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

/** The hosted studio entry lists the exact earlier bases it still supports. */
export function previousBases(raw: string | undefined, current: PrivateSeed): PreviousBase[] {
  if (!raw) return [];
  try {
    const rows: unknown = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length > 17) return [];
    const result: PreviousBase[] = [];
    for (const item of rows) {
      if (!item || typeof item !== 'object' || Object.keys(item).sort().join(',') !== 'indexSha256,publicationId,revisionSha256' ||
          typeof item.publicationId !== 'string' || !uuid.test(item.publicationId) ||
          typeof item.revisionSha256 !== 'string' || !hash.test(item.revisionSha256) ||
          typeof item.indexSha256 !== 'string' || !hash.test(item.indexSha256) ||
          item.indexSha256 === current.indexSha256 || result.some(base => base.indexSha256 === item.indexSha256)) return [];
      result.push(item as PreviousBase);
    }
    return result;
  } catch {
    return [];
  }
}

export async function hasPreviousCopy(base: PreviousBase): Promise<boolean> {
  const name = `exhibitos-private-editor-v1-${base.publicationId}-${base.revisionSha256}-${base.indexSha256}`;
  return DraftStore.hasPrivateCopies(name);
}
