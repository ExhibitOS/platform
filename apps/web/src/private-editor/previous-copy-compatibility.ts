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

// The two published Wheat display preparations are distinct, independently
// approved derivatives of the same exact Met source. This narrow continuity
// is not a generic rule for works with the same title or image rights.
const wheat = {
 old:{approval:'9e57417c-72a7-557e-af97-2935ef654733',full:'2d202bfa522a54dd6e0a73063ff2eabdb7f90aae246ba9322d6505019c5bda9f',fullBytes:7503560,coarse:'e246eae77c461d0c3aed5949fe24ff1805f175e44aacf1752f2143cd2b9fbc0b',coarseBytes:633155,edge:1792,recipe:'fe002ad256885d6c1899025aa2a07910faaf6eca9055bd87880a2b3b43a8ef24'},
 current:{approval:'ce328328-97fa-56cf-8fc1-6bafd4573153',full:'cde67c823c0fed9574d94d4a95facbcc7e3b7782af8424d55fb41c8a53c250b7',fullBytes:8103573,coarse:'0b0ff85114f13554a7b122a9a50cf73130f056dffa0220f7463d7ffbecd7f304',coarseBytes:509458,edge:2048,recipe:'5206824d01e36782dbdd9dc9d0872f64c5e17990000495e511bc80d11bb979fd'},
 raw:'b46d02a42fd3bb13b022cefc5beaa997b1d7a28cd7b53e4413d940aa0dc4014d',rights:'8c89d1cc6dc07d25e11f8ba084472a3aa8db2fce882dfa78970a034156d3e215',
} as const;
function wheatIdentity(work:Artwork,variant:'old'|'current') {
 const expected=wheat[variant],policy=work.extensions?.['org.exhibitos.viewer/display-policy'] as {version?:number;profile?:string;approvalId?:string;sourceAssetSha256?:string;rightsEvidenceSha256?:string}|undefined;
 if(work.artworkType!=='image'||work.assets.length!==2||work.rights.licenseId!=='CC0-1.0'||!work.rights.permissions.display||!work.rights.permissions.export||!work.rights.permissions.download||!policy||canonical(policy)!==canonical({version:1,profile:'approved-open-access-demo-v1',approvalId:expected.approval,sourceAssetSha256:expected.full,rightsEvidenceSha256:wheat.rights}))return undefined;
 const full=work.assets.find(a=>a.id===work.primaryAssetId),low=work.assets.find(a=>a.id!==work.primaryAssetId);
 if(!full||!low||full.sha256!==expected.full||full.bytes!==expected.fullBytes||full.mime!=='image/png'||full.role!=='image'||low.sha256!==expected.coarse||low.bytes!==expected.coarseBytes||low.mime!=='image/png'||low.role!=='image')return undefined;
 try{const variants=lodVariantsFor(work);if(variants.length!==2||!variants.some(v=>v.assetId===full.id&&v.detail==='full'&&v.textureSize===expected.edge)||!variants.some(v=>v.assetId===low.id&&v.detail==='coarse'&&v.textureSize===512))return undefined;}catch{return undefined;}
 const description=`Approved exact selected open-access display. Object https://www.metmuseum.org/art/collection/search/436535; raw SHA256 ${wheat.raw}; canonical SHA256 ${expected.full}; recipe SHA256 ${expected.recipe}; rights evidence SHA256 ${wheat.rights}.`;
 const {authorship,events,scaleConversion}=work.provenance;
 if(events.length!==1||events[0]?.type!=='exhibited'||events[0].description!==description||events[0].tool!==undefined||events[0].sourceAssetIds!==undefined)return undefined;
 return canonical([work.rights,work.metadata,work.dimensions,work.transform,work.units,work.coordinates,authorship,scaleConversion]);
}

/** Historical data are eligible only when the entire previous rights inventory
 * matches and this exact independently approved Wheat lineage is present. */
export function retainedWheatCopyFiles(previous:Exhibition,current:Exhibition) {
 if(!retainsCopyRights(previous,current))return [];
 const active=current.artworks.map(a=>wheatIdentity(a,'current')).filter(Boolean);
 const old=previous.artworks.find(a=>{const identity=wheatIdentity(a,'old');return identity!==undefined&&active.includes(identity);});
 return old?old.assets.map(a=>({path:`data/${a.sha256}.bin`,sha256:a.sha256,bytes:a.bytes,mime:a.mime})):[];
}

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
    wheat:wheatIdentity(work,hasCoarse?'current':'old'),
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
      if(seen.has(index)||work.exact!==old.exact&&(!old.additive||work.additive!==old.additive)&&(!old.wheat||work.wheat!==old.wheat))return false;
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
