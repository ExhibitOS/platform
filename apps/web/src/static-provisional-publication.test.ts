// SPDX-License-Identifier: AGPL-3.0-or-later
import {afterEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fixtureURL,readOex,type ExhibitionV2} from '@exhibitos/spec';
import {freezeCanonical} from '@exhibitos/studio-contract';
import {loadStaticPublication} from './static-publication-source';
import {createGeometryState} from './geometry/model';
import {newDraft} from './drafts/example';
import {validateDraft} from './drafts/validator';

const digest=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('loads a qualified v2 publication from the actual static source and admits its editing geometry',async()=>{
 const original=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic.oex'))),legacy=original.exhibition,base=legacy.artworks.find(a=>a.artworkType==='sculpture')!;
 const ref={version:1,status:'provisional-uncalibrated',assetSha256:base.assets.find(a=>a.id===base.primaryAssetId)!.sha256,rawBounds:{min:[-1,-2,-3],max:[1,2,3]},referenceHeightMeters:.4,catalogueDimensions:{width:.2,height:.4,depth:.3,unit:'m'},axisMapping:'unverified'};
 const art={...base,schemaVersion:'1.0.0-draft.2',units:'unknown',dimensions:{width:2,height:4,depth:6},transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[.1,.1,.1]},extensions:{...base.extensions,'org.exhibitos.studio/display-reference':ref}};
 const exhibition={...legacy,schemaVersion:'1.0.0-draft.2',artworks:legacy.artworks.map(a=>a.id===base.id?art:a)} as ExhibitionV2;
 const id='10000000-0000-4000-8000-000000000001',assets=original.manifest.assets.map(a=>({assetId:a.id,mime:a.mime,bytes:a.bytes,sha256:a.sha256}));
 const value={publication:{id,status:'published',revisionSha256:digest(freezeCanonical(exhibition))},exhibition,assets:assets.map(a=>({assetId:a.assetId,mime:a.mime,url:`/api/v1/publications/${id}/assets/${a.assetId}`}))};
 const publication=Buffer.from(JSON.stringify(value)),publicationHash=digest(publication),publicationPath=`data/${publicationHash}.json`;
 const index=Buffer.from(JSON.stringify({version:1,publication:{path:publicationPath,bytes:publication.length,sha256:publicationHash,mime:'application/json'},assets:assets.map(a=>({...a,path:`data/${a.sha256}.bin`}))}));
 vi.stubGlobal('document',{querySelector:()=>({content:digest(index)})});
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{const path=String(input),body=path==='/static-publication-index.json'?index:path==='/'+publicationPath?publication:undefined;return body?new Response(new Uint8Array(body)):new Response(null,{status:404});}));
 const mismatch={...newDraft(),schemaVersion:'1.0.0-draft.1',exhibitionId:exhibition.id,candidate:exhibition};expect(validateDraft(mismatch).valid).toBe(false);
 const legacyDraft={...newDraft(),schemaVersion:'1.0.0-draft.1',exhibitionId:legacy.id,candidate:legacy};expect(validateDraft(legacyDraft).valid).toBe(true);
 const loaded=await loadStaticPublication();expect(loaded.exhibition).toEqual(exhibition);expect(loaded.exhibition.artworks.find(a=>a.id===base.id)?.extensions?.['org.exhibitos.studio/display-reference']).toEqual(ref);
 expect(createGeometryState(loaded.exhibition).present).toEqual(exhibition);
});
