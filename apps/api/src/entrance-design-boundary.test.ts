// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {expect,it} from 'vitest';
import {fixtureURL,type Exhibition} from '@exhibitos/spec';
import {ENTRANCE_NAMESPACE,ENTRANCE_THEMES,entranceFor,validateViewerEntrance} from '@exhibitos/studio-contract';
import {checkOexProfile,remapOex} from './oex.ts';
import {projectPublication} from './publication.ts';
it('preserves typed design and UUID-shaped localized prose through OEX and public ID remapping',async()=>{
 const base=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')) as Exhibition,art=base.artworks.find(a=>a.artworkType==='image')!;
 for(const theme of ENTRANCE_THEMES){
  const doc=structuredClone(base),design={version:1 as const,theme:theme.id,translations:[{locale:'en',title:art.primaryAssetId,shortTitle:base.rooms[0]!.id}],ticket:{showTime:false}};
  doc.extensions={...doc.extensions,[ENTRANCE_NAMESPACE]:{version:1,artist:'Artist',introduction:'Public copy',imageAssetId:art.primaryAssetId,imageAlt:'Qualified image',mobilePosition:'center',design}};
  // Prepared bytes are a projection-boundary witness; this does not exercise image decoding.
  const prepared={artwork:art,sourceAssetId:art.primaryAssetId,sourceSha256:art.assets.find(a=>a.id===art.primaryAssetId)!.sha256,bytes:Buffer.from('synthetic prepared image witness'),mime:'image/png' as const};
  const before=JSON.stringify(doc);expect(()=>checkOexProfile(doc)).not.toThrow();
  for(const mapped of [remapOex(doc).exhibition,projectPublication(doc,[prepared],'2026-10-26T00:00:00.000Z').snapshot]){const entrance=entranceFor(mapped);expect(validateViewerEntrance(mapped).valid).toBe(true);expect(entrance.design).toEqual(design);expect(entrance.imageAssetId).not.toBe(art.primaryAssetId);}
  expect(JSON.stringify(doc)).toBe(before);
 }
});
