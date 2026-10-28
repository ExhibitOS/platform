// SPDX-License-Identifier: AGPL-3.0-or-later
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {expect,test} from 'vitest';
import {readFile} from 'node:fs/promises';
import {fixtureURL,readOex} from '@exhibitos/spec';
import {LOD_NAMESPACE,NEAR_TEXTURE_PAIR_PROFILE,validateViewerLod} from '@exhibitos/studio-contract';
import {projectPublication,approvedPublicationSource} from './publication.ts';
test('public snapshot keeps both model metrics/profile and exact approved reduced source identity',async()=>{
 const {exhibition}=await readOex(await readFile(fixtureURL('oex/v1/examples/synthetic-media.oex'))),a=exhibition.artworks.find(a=>a.artworkType==='sculpture')!;
 const full=a.assets.find(v=>v.id===a.primaryAssetId)!,low={...full,id:crypto.randomUUID(),bytes:50,sha256:'b'.repeat(64)};full.bytes=100;full.sha256='a'.repeat(64);a.assets=[full,low];
 a.extensions={[LOD_NAMESPACE]:{version:1,profile:NEAR_TEXTURE_PAIR_PROFILE,variants:[{assetId:full.id,detail:'full',triangles:150000,textureSize:2048},{assetId:low.id,detail:'coarse',triangles:150000,textureSize:512}]}};
 const pairSource={asset:full,modelPair:{version:1,profileId:NEAR_TEXTURE_PAIR_PROFILE,full:{...full,triangles:150000,textureSize:2048},reduced:{...low,triangles:150000,textureSize:512}}};
 expect(approvedPublicationSource(pairSource,low,full.id)).toBe(true);expect(approvedPublicationSource(pairSource,{...low,sha256:'c'.repeat(64)},full.id)).toBe(false);
 const source={asset:full,importedArtwork:a};expect(approvedPublicationSource(source,low,full.id)).toBe(true);expect(approvedPublicationSource(source,{...low,sha256:'c'.repeat(64)},full.id)).toBe(false);
 exhibition.artworks=[a];exhibition.placements=exhibition.placements.filter(p=>p.artworkRevisionId===a.revisionId);exhibition.annotations=exhibition.annotations.filter(v=>exhibition.placements.some(p=>p.id===v.placementId));exhibition.mediaAssets=[];exhibition.audioZones=[];exhibition.scripts=[];exhibition.accessibility.artworkDescriptions=exhibition.accessibility.artworkDescriptions.filter(d=>exhibition.placements.some(p=>p.id===d.placementId));
 const projected=projectPublication(exhibition,[{artwork:a,sourceAssetId:full.id,sourceSha256:full.sha256,bytes:Buffer.alloc(100),mime:'model/gltf-binary',coarseSource:{id:low.id,sha256:low.sha256},variants:{profile:NEAR_TEXTURE_PAIR_PROFILE,full:{triangles:150000,textureSize:2048},coarse:{triangles:150000,textureSize:512},bytes:Buffer.alloc(50)}}],'2026-10-28T00:00:00Z');
 const output=projected.snapshot.artworks[0]!;
 const schema=JSON.parse(await readFile(new URL('../../../contracts/viewer-lod.schema.json',import.meta.url),'utf8'));
 const Ajv=Ajv2020 as unknown as typeof import('ajv/dist/2020.js').default;
 const ajv=new Ajv({strict:false});const formats=addFormats as unknown as (a:typeof ajv)=>void;formats(ajv);const validate=ajv.compile(schema);
 expect(validate(output.extensions?.[LOD_NAMESPACE])).toBe(true);
 const legacy={version:1,variants:[{assetId:full.id,detail:'full',triangles:150000}]};expect(validate(legacy)).toBe(true);
 expect(validate({...legacy,profile:NEAR_TEXTURE_PAIR_PROFILE})).toBe(false);
expect(validateViewerLod(output).valid).toBe(true);expect(output.extensions?.[LOD_NAMESPACE]).toMatchObject({profile:NEAR_TEXTURE_PAIR_PROFILE,variants:[{detail:'full',triangles:150000,textureSize:2048},{detail:'coarse',triangles:150000,textureSize:512}]});
});
