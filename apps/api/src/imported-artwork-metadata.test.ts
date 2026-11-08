// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {fixtureURL,readOex,type Artwork} from '@exhibitos/spec';
import {validMetadata} from './cms.ts';
import {importedArtworkMetadata,approvedDimensionsMatch,IMPORTED_DISPLAY_REFERENCE} from './imported-artwork-metadata.ts';
import {requireSupportedOexImport} from './oex.ts';
it('projects an unknown-unit reference without relabelling raw dimensions as metres',async()=>{
 const {exhibition}=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic.oex'))),base=exhibition.artworks.find(a=>a.artworkType==='sculpture')!;
 const reference={version:1,status:'provisional-uncalibrated',assetSha256:base.assets.find(a=>a.id===base.primaryAssetId)!.sha256,rawBounds:{min:[-1,-2,-3],max:[1,2,3]},referenceHeightMeters:.4,catalogueDimensions:{width:.2,height:.4,depth:.3,unit:'m'},axisMapping:'unverified'};
 const artwork={...base,schemaVersion:'1.0.0-draft.2',units:'unknown',dimensions:{width:2,height:4,depth:6},transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[.1,.1,.1]},extensions:{[IMPORTED_DISPLAY_REFERENCE]:reference}} as Artwork;
 const before=structuredClone(artwork),metadata=importedArtworkMetadata(artwork);
 expect(validMetadata(metadata)).toBe(true);expect(metadata.provenance).toMatchObject({sourceUnits:'unknown',scaleApplied:false});expect(metadata.dimensions).toEqual(reference.catalogueDimensions);expect(metadata.displayReference).toMatchObject({assetSha256:reference.assetSha256,rawBounds:reference.rawBounds,pose:artwork.transform});expect(artwork).toEqual(before);expect(approvedDimensionsMatch(artwork,metadata)).toBe(true);
 expect(()=>requireSupportedOexImport({...exhibition,schemaVersion:'1.0.0-draft.2',artworks:[artwork]})).not.toThrow();
 const invalid=structuredClone(artwork);invalid.transform.scale[0]=.2;expect(approvedDimensionsMatch(invalid,metadata)).toBe(false);expect(()=>requireSupportedOexImport({...exhibition,schemaVersion:'1.0.0-draft.2',artworks:[invalid]})).toThrow('OEX_CMS_METADATA_INVALID');
 const absent=structuredClone(artwork);delete (absent.extensions as Record<string,unknown>)[IMPORTED_DISPLAY_REFERENCE];expect(()=>importedArtworkMetadata(absent)).toThrow('OEX_CMS_METADATA_INVALID');
 const known=importedArtworkMetadata(base);expect(known.provenance).toMatchObject({sourceUnits:'m',scaleApplied:true});expect(approvedDimensionsMatch(base,known)).toBe(true);
});
