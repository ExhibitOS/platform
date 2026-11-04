// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Artwork, Exhibition } from '@exhibitos/spec';
import { spaceStillFor } from '@exhibitos/spec/space-still';
// The static build imports this guard before workspace packages are compiled.
import { lodVariantsFor } from '../../../../packages/studio-contract/src/viewer.ts';

function canonical(value: unknown) {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
  });
}

const file = ({sha256, bytes, mime}: {sha256:string; bytes:number; mime:string}) => [sha256, bytes, mime];
const artworkFile = (asset:Artwork['assets'][number]) => [file(asset),asset.role];

function additiveImageIdentity(work:Artwork, hasCoarse:boolean) {
  if(work.artworkType!=='image'||work.assets.length!==(hasCoarse?2:1))return undefined;
  try {
    // This also checks that the variants bind the primary and the declared
    // PNG inventory, and that coarse reduces the declared edge and bytes.
    const variants=lodVariantsFor(work);
    if(variants.length!==work.assets.length)return undefined;
    const full=variants.find(variant=>variant.detail==='full');
    const coarse=variants.find(variant=>variant.detail==='coarse');
    const primary=work.assets.find(asset=>asset.id.toLowerCase()===full?.assetId.toLowerCase());
    if(!primary||!full?.textureSize||hasCoarse&&(!coarse?.textureSize||coarse.textureSize>512))return undefined;
    const {authorship,events,scaleConversion}=work.provenance;
    // Published snapshots generate new event IDs and timestamps. Retain the
    // publication statement and all other provenance details as evidence.
    const source=events.map(event=>event.type==='exhibited'?{type:event.type,description:event.description,tool:event.tool,sourceAssetIds:event.sourceAssetIds}:event);
    return canonical([artworkFile(primary),full.textureSize,work.rights,work.metadata,authorship,scaleConversion,source]);
  }catch{return undefined;}
}

function copyRights(exhibition: Exhibition, hasCoarse:boolean) {
  const still = spaceStillFor(exhibition);
  const artworks = exhibition.artworks.map(work => ({
    exact:canonical([work.rights,work.assets.map(asset=>canonical(artworkFile(asset))).sort()]),
    additive:additiveImageIdentity(work,hasCoarse),
  }));
  const media = exhibition.mediaAssets.map(asset => canonical([file(asset),asset.rights])).sort();
  return { artworks, media, still: canonical(still ? [file(still),still.rights] : null) };
}

type ArtworkIdentity=ReturnType<typeof copyRights>['artworks'][number];
function retainsArtworks(previous:ArtworkIdentity[],current:ArtworkIdentity[]) {
  // A current work may match an exact old row or a full-only row. Reassign
  // earlier matches when necessary so no row is counted twice.
  const matches=new Map<number,ArtworkIdentity>();
  function match(old:ArtworkIdentity,seen:Set<number>):boolean {
    return current.some((work,index)=>{
      if(seen.has(index)||work.exact!==old.exact&&(!old.additive||work.additive!==old.additive))return false;
      seen.add(index);
      const prior=matches.get(index);
      if(prior&&!match(prior,seen))return false;
      matches.set(index,old);
      return true;
    });
  }
  return previous.every(work=>match(work,new Set()));
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
  const old = copyRights(previous,false), active = copyRights(current,true);
  return old.still === active.still &&
    retainsArtworks(old.artworks, active.artworks) && retainsRows(old.media, active.media);
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
