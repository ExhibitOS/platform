// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {qualifyDemoDisplay,qualifyDemoDisplayAsset} from './demo-display-policy.ts';

test('the nine published works retain their exact approved display references',async()=>{
 const root='demos/reference-exhibition/source/';
 const indexBytes=await readFile(root+'static-publication-index.json');
 const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
 expect(sha(indexBytes)).toBe('a0f952673dd65189108b75786a21f94e535996b6a8069ff9c603690ec80182b1');
 const index=JSON.parse(indexBytes.toString()),publicationBytes=await readFile(root+index.publication.path);
 expect(sha(publicationBytes)).toBe(index.publication.sha256);
 const publication=JSON.parse(publicationBytes.toString());expect(publication.exhibition.artworks).toHaveLength(9);
 for(const artwork of publication.exhibition.artworks){
  expect(qualifyDemoDisplay(artwork)).toBeDefined();
  for(const asset of artwork.assets){
   const entry=index.assets.find((x:{assetId:string})=>x.assetId===asset.id);expect(entry).toBeDefined();
   const bytes=await readFile(root+entry.path);expect(bytes.length).toBe(asset.bytes);expect(sha(bytes)).toBe(asset.sha256);
   if(asset.mime==='model/gltf-binary')expect(qualifyDemoDisplay(artwork,bytes)).toBeDefined();
   else expect(qualifyDemoDisplayAsset(artwork,asset.id,bytes)).toBeDefined();
  }
 }
});
