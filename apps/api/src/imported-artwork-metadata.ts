// SPDX-License-Identifier: AGPL-3.0-or-later
import {isDeepStrictEqual} from 'node:util';
import type {Artwork} from '@exhibitos/spec';
import {creationYearFor} from '@exhibitos/studio-contract';
import type {ArtworkMetadata} from './cms.ts';
import {ApiError} from './api-error.ts';
export const IMPORTED_DISPLAY_REFERENCE='org.exhibitos.studio/display-reference';
/** Project supported portable artwork into CMS without changing source units,
 * coordinates or its immutable portable snapshot. Catalogue size is not raw size. */
export function importedArtworkMetadata(a:Artwork):ArtworkMetadata {
 const reference=a.extensions?.[IMPORTED_DISPLAY_REFERENCE] as unknown as undefined|{version:1;status:'provisional-uncalibrated';assetSha256:string;rawBounds:NonNullable<ArtworkMetadata['displayReference']>['rawBounds'];referenceHeightMeters:number;catalogueDimensions:ArtworkMetadata['dimensions'];axisMapping:'unverified'};
 if(a.units==='unknown'&&(a.schemaVersion!=='1.0.0-draft.2'||!reference)||a.units!=='unknown'&&reference)throw new ApiError(422,'OEX_CMS_METADATA_INVALID');
 return {title:a.metadata.title,description:a.metadata.description??'',...(a.metadata.medium===undefined?{}:{medium:a.metadata.medium}),...(creationYearFor(a)===undefined?{}:{creationYear:creationYearFor(a)}),
  dimensions:reference?structuredClone(reference.catalogueDimensions):{width:a.dimensions.width,height:a.dimensions.height,...(a.dimensions.depth===undefined?{}:{depth:a.dimensions.depth}),unit:'m'},
  rights:structuredClone(a.rights),provenance:{source:a.provenance.authorship,sourceUnits:reference?'unknown':'m',scaleApplied:!reference,notes:'Imported from an integrity-checked OEX package; source provenance remains in the exhibition snapshot.'},
  ...(reference?{displayReference:{version:reference.version,status:reference.status,assetSha256:reference.assetSha256,rawBounds:structuredClone(reference.rawBounds),referenceHeightMeters:reference.referenceHeightMeters,pose:structuredClone(a.transform)}}:{})};
}
/** Shared import/reopen/export comparison: metre metadata and provisional display
 * metadata have different dimension meanings; neither is inferred from the other. */
export function approvedDimensionsMatch(a:Artwork,m:ArtworkMetadata){
 const r=m.displayReference;
 if(!r)return a.units==='meter'&&!a.extensions?.[IMPORTED_DISPLAY_REFERENCE]&&a.dimensions.width===m.dimensions.width&&a.dimensions.height===m.dimensions.height&&a.dimensions.depth===m.dimensions.depth;
 return a.schemaVersion==='1.0.0-draft.2'&&a.units==='unknown'&&m.provenance.sourceUnits==='unknown'&&!m.provenance.scaleApplied&&isDeepStrictEqual(a.dimensions,{width:r.rawBounds.max[0]-r.rawBounds.min[0],height:r.rawBounds.max[1]-r.rawBounds.min[1],depth:r.rawBounds.max[2]-r.rawBounds.min[2]})&&isDeepStrictEqual(a.transform,r.pose)&&isDeepStrictEqual(a.extensions?.[IMPORTED_DISPLAY_REFERENCE],{version:1,status:r.status,assetSha256:r.assetSha256,rawBounds:r.rawBounds,referenceHeightMeters:r.referenceHeightMeters,catalogueDimensions:m.dimensions,axisMapping:'unverified'});
}
