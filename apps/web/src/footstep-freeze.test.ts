// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {fixtureURL,readOex,writeOex,revisionHash} from '@exhibitos/spec';
import {footstepResourcesFor} from '@exhibitos/spec/footstep-resources';
import type {FreezeBundle} from '@exhibitos/studio-contract';
import {decodeFreezeOex,freezeHash} from './freeze-oex';
import {frozenPublication} from './OfflineExhibition';

test('browser furnishing validator is the exact pinned spec module',async()=>{
 const source=await readFile(new URL('../../../node_modules/@exhibitos/spec/validators/furnishings.mjs',import.meta.url));
 const bundled=await readFile(new URL('./vendor/furnishings-v1.mjs',import.meta.url));
 expect(bundled).toEqual(source);
});

test('draft8 freeze resolves only the registered exact audio through the checked offline source',async()=>{
 const original=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),exhibition=structuredClone(original.exhibition);
 exhibition.extensions={...exhibition.extensions,'org.exhibitos.viewer/footstep-resources':{version:1,families:['wood']}};
 const resources=footstepResourcesFor(exhibition),files=new Map(original.manifest.assets.map(item=>[item.artifactPath,original.files.get(item.path)!]));
 for(const item of resources)files.set(item.artifactPath,await readFile(new URL('../public/'+item.artifactPath,import.meta.url)));
 const archive=await writeOex(exhibition,files,{createdAt:original.manifest.createdAt,generator:original.manifest.generator}),revision=revisionHash(exhibition);
 const decoded=await decodeFreezeOex(new Uint8Array(archive),revision,'1.0.0-draft.8');expect(decoded.footstepResources?.size).toBe(4);
 const id='11111111-1111-4111-8111-111111111111',bundle={manifest:{id,createdAt:original.manifest.createdAt,source:{exhibitionHash:revision}}} as unknown as FreezeBundle;
 let checks=0;const publication=frozenPublication(bundle,decoded,async()=>{checks++;});const sample=publication.resources!.find(v=>v.mime==='audio/wav')!;
 const response=await publication.local!.fetcher(sample.url);expect(await freezeHash(new Uint8Array(await response.arrayBuffer()))).toBe(sample.sha256);expect(checks).toBe(2);
 await expect(publication.local!.fetcher(`/api/v1/publications/${id}/resources/${'0'.repeat(64)}`)).rejects.toThrow('OFFLINE_ASSET_URL');
 const corrupted=new Uint8Array(archive);corrupted[corrupted.length-25]=corrupted[corrupted.length-25]!^1;
 await expect(decodeFreezeOex(corrupted,revision,'1.0.0-draft.8')).rejects.toThrow();
});
