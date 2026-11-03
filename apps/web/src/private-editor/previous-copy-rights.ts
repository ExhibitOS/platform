// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Exhibition } from '@exhibitos/spec';
import { spaceStillFor } from '@exhibitos/spec/space-still';

function canonical(value: unknown) {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
  });
}

export function copyRightsFingerprint(exhibition: Exhibition) {
  const file = ({sha256, bytes, mime}: {sha256:string; bytes:number; mime:string}) => [sha256, bytes, mime];
  const still = spaceStillFor(exhibition);
  const artworks = exhibition.artworks.map(work => canonical([
    work.rights,
    work.assets.map(asset => canonical([file(asset),asset.role])).sort(),
  ])).sort();
  const media = exhibition.mediaAssets.map(asset => canonical([file(asset),asset.rights])).sort();
  return canonical([artworks, media, still ? [file(still),still.rights] : null]);
}
