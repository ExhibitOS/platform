// SPDX-License-Identifier: AGPL-3.0-or-later
import {test,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {preparedImageInput,preparedImageHeader} from './prepared-image.ts';
import {Imports} from './imports.ts';
import type {Pool,PoolClient} from 'pg';
import type {BlobStore} from '@exhibitos/storage';
import type {Session} from './auth.ts';
const hex='1'.repeat(64);
const receipt=()=>({mime:'image/png',bytes:123,sha256:hex,recipe:{version:1,role:'baseColor',sampling:'nearest-centre',colourMeaning:'srgb-assumed',recipeSha256:createHash('sha256').update('{"colourMeaning":"srgb-assumed","role":"baseColor","sampling":"nearest-centre","version":1}').digest('hex'),settingsSha256:hex,sourcePixelsSha256:'2'.repeat(64),outputPixelsSha256:'3'.repeat(64),toolVersion:'ExhibitOSManager.ImageIO/1/macOS-27.0.1'}});
test('binds the agreed canonical recipe without promoting client provenance to authority',()=>{
 const input=receipt();expect(preparedImageInput(input)).toBe(input);expect(preparedImageInput(undefined)).toBeUndefined();
 expect(()=>preparedImageInput({...input,verified:true})).toThrow('INVALID_DERIVED_INPUT');
 expect(()=>preparedImageInput({...input,recipe:{...input.recipe,approved:true}})).toThrow('INVALID_DERIVED_INPUT');
 expect(()=>preparedImageInput({...input,recipe:{...input.recipe,colourMeaning:'srgb'}})).toThrow('INVALID_DERIVED_INPUT');
});
test('rejects non-image roles, malformed digests and unbounded producer labels',()=>{
 const input=receipt();
 for(const recipe of [{...input.recipe,role:'normal'},{...input.recipe,sourcePixelsSha256:'x'.repeat(64)},{...input.recipe,toolVersion:'x'.repeat(129)},{...input.recipe,toolVersion:'producer\nother'}])expect(()=>preparedImageInput({...input,recipe})).toThrow('INVALID_DERIVED_INPUT');
 expect(()=>preparedImageInput({...input,bytes:8388609})).toThrow('INVALID_DERIVED_INPUT');
});
test('accepts a closed client-declared ICC conversion and rejects mismatched meaning or malformed evidence',()=>{
 const input=receipt(),recipe={...input.recipe,colourMeaning:'srgb',recipeSha256:createHash('sha256').update('{"colourMeaning":"srgb","role":"baseColor","sampling":"nearest-centre","version":1}').digest('hex')};
 const conversion={version:1,algorithm:'icc-to-srgb-jpeg-rgb8-v1',sourceIccSha256:'a'.repeat(64)},icc={...input,recipe:{...recipe,colourConversion:conversion}};
 expect(preparedImageInput(icc)).toBe(icc);
 for(const bad of [{...conversion,sourceIccSha256:'A'.repeat(64)},{...conversion,algorithm:'other'},{...conversion,version:2},{...conversion,verified:true}])expect(()=>preparedImageInput({...icc,recipe:{...recipe,colourConversion:bad}})).toThrow('INVALID_DERIVED_INPUT');
 expect(()=>preparedImageInput({...input,recipe:{...input.recipe,colourConversion:conversion}})).toThrow('INVALID_DERIVED_INPUT');
 const importer=new Imports({} as Pool,{} as BlobStore),row={mime:'image/jpeg',expected_hash:'b'.repeat(64),derived:icc,model_derivation:null};
 expect(importer.view(row)).toMatchObject({imagePreparation:{provenance:'client-declared',originalSha256:'b'.repeat(64),derivedSha256:icc.sha256,recipe:icc.recipe}});
 expect(importer.view({...row,derived:input})).not.toHaveProperty('imagePreparation');
});
test('same import request reopens the ICC declaration and changed evidence conflicts on retry',async()=>{
 const input=receipt(),recipe={...input.recipe,colourMeaning:'srgb' as const,recipeSha256:createHash('sha256').update('{"colourMeaning":"srgb","role":"baseColor","sampling":"nearest-centre","version":1}').digest('hex'),colourConversion:{version:1 as const,algorithm:'icc-to-srgb-jpeg-rgb8-v1' as const,sourceIccSha256:'a'.repeat(64)}};
 const request={artworkId:'artwork',idempotencyKey:'same-request',mime:'image/jpeg' as const,sha256:'b'.repeat(64),bytes:123,scaleMeters:1,rights:{holder:'Synthetic contributor',ownership:'owner',licenseId:'CC0-1.0',creditLine:'Synthetic',permissions:{display:false,download:true,export:true,commercial:false}},derived:{...input,recipe}};
 let stored:Record<string,unknown>|undefined;
 const c={query:async(sql:string,p:unknown[]=[])=>{
  if(sql.includes('SELECT m.role'))return {rowCount:1,rows:[{role:'admin'}]};
  if(sql.includes('SELECT a.*,r.user_id'))return {rowCount:1,rows:[{owner_user_id:'user'}]};
  if(sql.startsWith('SELECT * FROM import_jobs'))return {rowCount:stored?1:0,rows:stored?[stored]:[]};
  if(sql.startsWith('INSERT INTO import_jobs')){stored={id:p[1],mime:p[6],expected_hash:p[7],request_hash:p[5],derived:p[13],model_derivation:null};return {rowCount:1,rows:[stored]};}
  return {rowCount:0,rows:[]};
 }} as unknown as PoolClient;
 const importer=new Imports({} as Pool,{} as BlobStore),s={tenantId:'tenant',userId:'user',role:'admin'} as Session;
 const first=await importer.create(c,s,request),reopened=await importer.create(c,s,structuredClone(request));expect(reopened).toEqual(first);expect(reopened).toMatchObject({imagePreparation:{originalSha256:request.sha256,recipe:{colourConversion:recipe.colourConversion}}});
 const changed=structuredClone(request);changed.derived.recipe.colourConversion.sourceIccSha256='c'.repeat(64);await expect(importer.create(c,s,changed)).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
});
test('keeps the RGB8 preparation resource boundary independent from legacy PNG admission',()=>{
 const bytes=Buffer.alloc(33);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);bytes.writeUInt32BE(13,8);bytes.write('IHDR',12);bytes.writeUInt32BE(2048,16);bytes.writeUInt32BE(2048,20);bytes[24]=8;bytes[25]=2;
 expect(()=>preparedImageHeader(bytes)).not.toThrow();
 const alpha=Buffer.from(bytes);alpha[25]=6;expect(()=>preparedImageHeader(alpha)).toThrow('FORMAT_REJECTED');
 const oversized=Buffer.from(bytes);oversized.writeUInt32BE(2049,16);expect(()=>preparedImageHeader(oversized)).toThrow('FORMAT_REJECTED');
 // Header checks alone are not a PNG acceptance claim; the worker still performs strict decode.
});
