// SPDX-License-Identifier: AGPL-3.0-or-later
import {expect,it} from 'vitest';
import {validateCoverVariantDescriptor} from './cover-variant-descriptor.mjs';
const primary='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',coarse='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',pid='cccccccc-cccc-4ccc-8ccc-cccccccccccc',revision='c'.repeat(64);
const one=(id:string,sha:string,bytes:number,width:number,height:number)=>({assetId:id,mime:'image/png',sha256:sha.repeat(64),bytes,width,height});
const sample=()=>{const p=one(primary,'a',1000,2048,1024),v=one(coarse,'b',100,512,256);return {publication:{id:pid,revisionSha256:revision},exhibition:{extensions:{'org.exhibitos.viewer/entrance':{imageAssetId:primary}},artworks:[{artworkType:'image',primaryAssetId:primary,assets:[p,v].map(x=>({id:x.assetId,role:'image',mime:x.mime,bytes:x.bytes,sha256:x.sha256}))}]},assets:[p,v].map(x=>({assetId:x.assetId,mime:x.mime,url:`/api/v1/publications/${pid}/assets/${x.assetId}`})),coverVariants:{version:1,revisionSha256:revision,primary:p,variants:[v]}};};
it('accepts only a bounded descriptor tied to the selected artwork and exact public inventory',()=>{
 expect(validateCoverVariantDescriptor(sample())).toBe(true);
 const mutations:Array<(s:ReturnType<typeof sample>)=>void>=[s=>{s.coverVariants.revisionSha256='d'.repeat(64);},s=>{s.coverVariants.variants[0]!.sha256='e'.repeat(64);},s=>{s.coverVariants.variants[0]!.width=10;},s=>{s.coverVariants.variants[0]!.assetId=primary;},s=>{s.exhibition.extensions['org.exhibitos.viewer/entrance'].imageAssetId=coarse;},s=>{s.assets[1]!.url='/other';},s=>{Object.assign(s.coverVariants,{extra:true});}];for(const mutate of mutations){const s=sample();mutate(s);expect(validateCoverVariantDescriptor(s)).toBe(false);}
 expect(validateCoverVariantDescriptor({})).toBe(false);
 const malformed=sample();(malformed.coverVariants.primary as unknown as {assetId:unknown}).assetId=[primary];expect(validateCoverVariantDescriptor(malformed)).toBe(false);
 const malformedHash=sample();(malformedHash.coverVariants.primary as unknown as {sha256:unknown}).sha256=['a'.repeat(64)];expect(validateCoverVariantDescriptor(malformedHash)).toBe(false);
});
