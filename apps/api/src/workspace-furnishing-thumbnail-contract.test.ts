// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash,randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {WORKSPACE_FURNISHING_THUMBNAIL_PROFILE as profile,FURNISHING_THUMBNAIL_RECIPE_ID as recipeId,FURNISHING_THUMBNAIL_TOOL_ID as toolId,parseFurnishingThumbnailSubmit,parseFurnishingThumbnailSelection,parseFurnishingThumbnailRenderRequest,parseFurnishingThumbnailReceipt,createFurnishingThumbnailReceipt,furnishingThumbnailCanonicalHash,furnishingThumbnailPngDescriptor} from './workspace-furnishing-thumbnail-contract.ts';
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function fixture(){const png=Buffer.alloc(33);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(13,8);png.write('IHDR',12);png.writeUInt32BE(256,16);png.writeUInt32BE(256,20);const renderRequest={version:1,epoch:randomUUID(),sequence:1,tenantId:randomUUID(),principalId:randomUUID(),requestId:randomUUID(),furnishingId:randomUUID(),furnishingVersion:1,modelBytes:32,modelSha256:'a'.repeat(64),recipeId,toolId};return {png,renderRequest,wire:{kind:profile,requestId:renderRequest.requestId,renderRequest,pngSha256:sha(png),pngBytes:png.length,pngBase64:png.toString('base64')}};}
it('parses only the six-field submit and exact bound render request, detaching normalized metadata',()=>{
 const f=fixture(),r=parseFurnishingThumbnailSubmit(f.wire);expect(r.png).toEqual(f.png);expect(r.renderRequest).toEqual(f.renderRequest);f.renderRequest.modelSha256='b'.repeat(64);expect(r.renderRequest.modelSha256).toBe('a'.repeat(64));
 for(const bad of [{...f.wire,extra:true},{...f.wire,requestId:randomUUID()},{...f.wire,renderRequest:{...f.wire.renderRequest,candidateId:randomUUID()}},{...f.wire,pngBase64:f.wire.pngBase64+'\n'},{...f.wire,pngBase64:'Zh=='},{...f.wire,pngBase64:Buffer.alloc(524289).toString('base64')},{...f.wire,pngBytes:0}])expect(()=>parseFurnishingThumbnailSubmit(bad)).toThrow('INVALID_INPUT');
});
it('rejects every unsupported render identity, version, count and recipe without coercion',()=>{
 const f=fixture();for(const delta of [{version:2},{furnishingVersion:2},{modelBytes:33554433},{modelBytes:'32'},{sequence:0},{sequence:Number.MAX_SAFE_INTEGER+1},{epoch:'invalid'},{modelSha256:'A'.repeat(64)},{recipeId:'other'},{toolId:'other'}])expect(()=>parseFurnishingThumbnailRenderRequest({...f.renderRequest,...delta})).toThrow('INVALID_INPUT');
 expect(parseFurnishingThumbnailRenderRequest({...f.renderRequest,sequence:Number.MAX_SAFE_INTEGER,modelBytes:33554432}).sequence).toBe(Number.MAX_SAFE_INTEGER);
});
it('classifies PNG byte/hash/header/size mismatch as invalid image rather than accepting client claims',()=>{
 const f=fixture();for(const delta of [{pngSha256:'0'.repeat(64)},{pngBytes:f.png.length+1},{pngBase64:Buffer.alloc(33).toString('base64'),pngSha256:sha(Buffer.alloc(33))}])expect(()=>parseFurnishingThumbnailSubmit({...f.wire,...delta})).toThrow('WORKSPACE_FURNISHING_THUMBNAIL_INVALID');
 const wrong=Buffer.from(f.png);wrong.writeUInt32BE(255,16);expect(()=>furnishingThumbnailPngDescriptor(wrong)).toThrow('WORKSPACE_FURNISHING_THUMBNAIL_INVALID');
});
it('requires the exact selection CAS envelope including the non-overflowing version bound',()=>{
 const value={requestId:randomUUID(),candidateId:randomUUID(),receiptSha256:'a'.repeat(64),expectedSelectionVersion:0};expect(parseFurnishingThumbnailSelection(value)).toEqual(value);expect(parseFurnishingThumbnailSelection({...value,expectedSelectionVersion:2147483646}).expectedSelectionVersion).toBe(2147483646);
 for(const delta of [{expectedSelectionVersion:-1},{expectedSelectionVersion:2147483647},{expectedSelectionVersion:.5},{extra:1},{candidateId:'bad'}])expect(()=>parseFurnishingThumbnailSelection({...value,...delta})).toThrow('INVALID_INPUT');
});
it('creates a closed source-bound receipt with a separate canonical digest and rejects mismatched or self-hashed receipts',()=>{
 const f=fixture(),renderRequest=parseFurnishingThumbnailRenderRequest(f.renderRequest),fields={workspaceId:randomUUID(),candidateId:randomUUID(),requestId:renderRequest.requestId,renderRequest,source:{furnishingId:renderRequest.furnishingId,furnishingVersion:1 as const,modelSha256:renderRequest.modelSha256,modelBytes:renderRequest.modelBytes,descriptorSha256:'b'.repeat(64),rightsSha256:'c'.repeat(64)},png:furnishingThumbnailPngDescriptor(f.png)},r=createFurnishingThumbnailReceipt(fields);
 expect(r.receipt).not.toHaveProperty('receiptSha256');expect(r.receiptSha256).toBe(furnishingThumbnailCanonicalHash(r.receipt));expect(parseFurnishingThumbnailReceipt(r.receipt)).toEqual(r.receipt);
 for(const value of [{...r.receipt,receiptSha256:r.receiptSha256},{...r.receipt,source:{...fields.source,modelBytes:33}},{...r.receipt,requestId:randomUUID()},{...r.receipt,png:{...fields.png,width:255}}])expect(()=>parseFurnishingThumbnailReceipt(value)).toThrow('INVALID_INPUT');
 expect(furnishingThumbnailCanonicalHash({...r.receipt,source:{...fields.source,rightsSha256:'d'.repeat(64)}})).not.toBe(r.receiptSha256);
});
it('canonicalizes recursive object keys while preserving array order and rejecting non-JSON collisions',()=>{
 expect(furnishingThumbnailCanonicalHash({b:{z:1,a:2},a:[1,2]})).toBe(furnishingThumbnailCanonicalHash({a:[1,2],b:{a:2,z:1}}));expect(furnishingThumbnailCanonicalHash([1,2])).not.toBe(furnishingThumbnailCanonicalHash([2,1]));const cyclic:Record<string,unknown>={};cyclic.self=cyclic;
 for(const value of [undefined,NaN,Infinity,-0,new Date(),Buffer.alloc(1),cyclic,Array(1),{a:undefined},Object.assign([1],{extra:true})])expect(()=>furnishingThumbnailCanonicalHash(value)).toThrow('INVALID_INPUT');
});
