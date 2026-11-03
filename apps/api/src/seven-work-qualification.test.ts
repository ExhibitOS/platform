// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {Artwork} from '@exhibitos/spec';
import {artworkDisplayPolicy,artworkThumbnailFor,validateArtworkThumbnail,validateViewerLod,LOD_NAMESPACE} from '@exhibitos/studio-contract';
import {qualifyDemoDisplay,qualifyDemoDisplayAsset} from './demo-display-policy.ts';
import {validateThumbnailBytes} from './artwork-thumbnail.ts';
import {decode} from './imports.ts';
import {allowedRights} from './rights.ts';

test('the twelve published works retain their exact approved display references',async()=>{
 const root='demos/reference-exhibition/source/';
 const indexBytes=await readFile(root+'static-publication-index.json');
 const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
 expect(sha(indexBytes)).toBe('4f31bc7132d6b71bcc7fefe741ebf66ba09512f9bacd1cf4ed261fde78a57c01');
 const index=JSON.parse(indexBytes.toString()),publicationBytes=await readFile(root+index.publication.path);
 expect(sha(publicationBytes)).toBe(index.publication.sha256);
 const publication=JSON.parse(publicationBytes.toString()) as {exhibition:{artworks:Artwork[]}};expect(publication.exhibition.artworks).toHaveLength(12);
 let selected=0,ordinary=0,previews=0;
 for(const artwork of publication.exhibition.artworks){
  expect(allowedRights(artwork.rights,'display')).toBe(true);expect(allowedRights(artwork.rights,'export')).toBe(true);
  expect(validateViewerLod(artwork).valid).toBe(true);expect(validateArtworkThumbnail(artwork).valid).toBe(true);
  const primary=artwork.assets.find(asset=>asset.id===artwork.primaryAssetId)!;
  // This exact registered Sargent is ordinary input, never an inferred selected-file exception.
  const registered=primary.sha256==='c7425d9a2df0ae3dc7839795683324a0d57fbb6b986db72bc8af01671998f45c';
  if(registered){
   ordinary++;expect(artworkDisplayPolicy(artwork)).toBeUndefined();expect(qualifyDemoDisplay(artwork)).toBeUndefined();
   const lod=artwork.extensions?.[LOD_NAMESPACE] as {variants:{assetId:string;detail:string;textureSize:number}[]};
   expect(lod.variants.map(v=>({detail:v.detail,textureSize:v.textureSize,sha256:artwork.assets.find(asset=>asset.id===v.assetId)?.sha256}))).toEqual([
    {detail:'full',textureSize:1900,sha256:'c7425d9a2df0ae3dc7839795683324a0d57fbb6b986db72bc8af01671998f45c'},
    {detail:'coarse',textureSize:512,sha256:'31f792cf07e33dcb6aacf42b9f66c8f02a7d0c7cd368135fa15937fc5203aedd'},
   ]);
   expect(artworkThumbnailFor(artwork)?.sha256).toBe('943422c944d072c186b9279b4a57018528dfd71d5f9dde58cf2d121851caa0aa');
  }else{
   selected++;expect(artworkDisplayPolicy(artwork)).toBeDefined();expect(qualifyDemoDisplay(artwork)).toBeDefined();
  }
  for(const asset of artwork.assets){
   const entry=index.assets.find((x:{assetId:string})=>x.assetId===asset.id);expect(entry).toBeDefined();
   const bytes=await readFile(root+entry.path);expect(bytes.length).toBe(asset.bytes);expect(sha(bytes)).toBe(asset.sha256);
   if(asset.role==='preview'){
    previews++;expect(artworkThumbnailFor(artwork)?.id).toBe(asset.id);await expect(validateThumbnailBytes(bytes)).resolves.toBeDefined();
   }else if(registered){
    expect(asset.role).toBe('image');expect(asset.mime).toBe('image/png');expect(qualifyDemoDisplayAsset(artwork,asset.id,bytes)).toBeUndefined();await expect(decode(bytes,asset.mime)).resolves.toBeUndefined();
   }else if(asset.mime==='model/gltf-binary')expect(qualifyDemoDisplay(artwork,bytes)).toBeDefined();
   else expect(qualifyDemoDisplayAsset(artwork,asset.id,bytes)).toBeDefined();
  }
 }
 expect({selected,ordinary,previews}).toEqual({selected:11,ordinary:1,previews:2});
});
