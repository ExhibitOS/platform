// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Exhibition } from '@exhibitos/spec';
import { spaceStillFor } from '@exhibitos/spec/space-still';

function canonical(value: unknown) {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
  });
}

function copyRights(exhibition: Exhibition) {
  const file = ({sha256, bytes, mime}: {sha256:string; bytes:number; mime:string}) => [sha256, bytes, mime];
  const still = spaceStillFor(exhibition);
  const artworks = exhibition.artworks.map(work => canonical([
    work.rights,
    work.assets.map(asset => canonical([file(asset),asset.role])).sort(),
  ])).sort();
  const media = exhibition.mediaAssets.map(asset => canonical([file(asset),asset.rights])).sort();
  return { artworks, media, still: canonical(still ? [file(still),still.rights] : null) };
}

function retainsRows(previous: string[], current: string[]) {
  const counts = new Map<string, number>();
  for (const row of current) counts.set(row, (counts.get(row) ?? 0) + 1);
  return previous.every(row => {
    const count = counts.get(row) ?? 0;
    if (!count) return false;
    counts.set(row, count - 1);
    return true;
  });
}

export function retainsCopyRights(previous: Exhibition, current: Exhibition) {
  const old = copyRights(previous), active = copyRights(current);
  return old.still === active.still &&
    retainsRows(old.artworks, active.artworks) && retainsRows(old.media, active.media);
}

type CopyFile = {path:string; sha256:string; bytes:number; mime:string};
type CopyIndex = {version:number; assets:CopyFile[]; resources?:CopyFile[]; furnishingNotices?:CopyFile[]};

export function retainsCopyInventory(previous: CopyIndex, current: CopyIndex) {
  if (previous.version !== current.version) return false;
  const rows = (entries: CopyFile[] = []) => entries.map(e => JSON.stringify([e.path,e.sha256,e.bytes,e.mime]));
  // Old UUIDs remain in their own snapshot. Bytes must still exist at the
  // same content-addressed path and in the same resource category.
  return retainsRows(rows(previous.assets), rows(current.assets)) &&
    retainsRows(rows(previous.resources), rows(current.resources)) &&
    retainsRows(rows(previous.furnishingNotices), rows(current.furnishingNotices));
}
