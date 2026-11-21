// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import {validateCoverVariantDescriptor} from '../apps/web/src/cover-variant-descriptor.mjs';

/** Bind already verified cover bytes to the derived scene's revision. The
 * caller still pins both publication inventories and verifies its scene delta. */
export function bindDerivedStaticCover(approved, derived) {
  if (approved.coverVariants === undefined && derived.coverVariants === undefined) return derived;
  if (!validateCoverVariantDescriptor(approved) ||
      approved.publication.id !== derived.publication.id ||
      !isDeepStrictEqual(approved.coverVariants, derived.coverVariants)) {
    throw Error('DERIVED_STATIC_COVER_SOURCE');
  }
  const result = {
    ...derived,
    coverVariants: {...derived.coverVariants, revisionSha256: derived.publication.revisionSha256},
  };
  if (!validateCoverVariantDescriptor(result)) throw Error('DERIVED_STATIC_COVER_BINDING');
  return result;
}
