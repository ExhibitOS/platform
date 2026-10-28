// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import {fixtureURL,validateExhibition,type Exhibition} from '@exhibitos/spec';
import {SPACE_STILL_NAMESPACE as N,spaceStillFor,type SpaceStillAsset} from '@exhibitos/spec/space-still';
import {ENTRANCE_NAMESPACE,entranceFor,validateViewerEntrance} from '@exhibitos/studio-contract';
import {sha256} from '@exhibitos/storage';
import {checkOexProfile,remapOex} from './oex.ts';
import {projectPublication} from './publication.ts';
import {CoverImages,coverImageAsset,type CoverImageRow} from './cover-images.ts';
import {Privacy} from './privacy.ts';
import type {Session} from './auth.ts';
const id='50000000-0000-4000-8000-000000000142',tenant='50000000-0000-4000-8000-000000000143';
async function fixture(){
 const candidate=JSON.parse(await readFile(fixtureURL('oes/v1/examples/exhibition.json'),'utf8')) as Exhibition;
 // Projection tests use opaque qualified bytes; binary decoding is a separate integration check.
 const bytes=Buffer.from('qualified synthetic still boundary witness');
 const asset:SpaceStillAsset={id,path:`space-still/${id}/image.png`,mime:'image/png',bytes:bytes.length,sha256:sha256(bytes),rights:{...structuredClone(candidate.artworks[0]!.rights),creditLine:id}};
 candidate.extensions={...candidate.extensions,[N]:{version:1,asset},[ENTRANCE_NAMESPACE]:{version:1,artist:id,introduction:'Independent space still',imageAssetId:id.toUpperCase(),imageAlt:id,mobilePosition:'center'}};
 return {candidate,bytes,asset};
}
it('OEX admission and remap keep independent still identity and authored UUID prose without audio or artwork aliasing',async()=>{
 const {candidate,asset}=await fixture(),original=structuredClone(candidate);
 expect(validateViewerEntrance(candidate).valid).toBe(true);expect(()=>checkOexProfile(candidate)).not.toThrow();
 const result=remapOex(candidate),still=spaceStillFor(result.exhibition)!;
 expect(still.id).toBe(result.idMap[id]);expect(still.id).not.toBe(id);
 expect(entranceFor(result.exhibition)).toMatchObject({imageAssetId:still.id,artist:id,imageAlt:id});
 expect(still.rights.creditLine).toBe(id);expect(still.path).toBe(asset.path);
 expect(result.assetAliases.some(alias=>alias.sourceAssetId===id)).toBe(false);
 expect(result.exhibition.mediaAssets).toHaveLength(candidate.mediaAssets.length);
 expect(validateExhibition(result.exhibition).valid).toBe(true);expect(candidate).toEqual(original);
 const unknown=structuredClone(candidate);unknown.extensions!['example.org/unsupported']={retained:true};
 expect(()=>checkOexProfile(unknown)).toThrow('OEX_EXTENSION_UNSUPPORTED');expect(unknown.extensions!['example.org/unsupported']).toEqual({retained:true});
 const alias=structuredClone(candidate);(alias.extensions![N] as unknown as {asset:SpaceStillAsset}).asset.id=alias.artworks[0]!.primaryAssetId;
 expect(()=>checkOexProfile(alias)).toThrow('OEX_PROFILE_INVALID');
});
it('public projection requires exact qualified still bytes and remaps only inventory references',async()=>{
 const {candidate,asset,bytes}=await fixture(),original=structuredClone(candidate);
 const prepared=candidate.artworks.map(artwork=>({artwork,sourceAssetId:artwork.primaryAssetId,sourceSha256:artwork.assets[0]!.sha256,bytes:Buffer.from('qualified artwork witness'),mime:artwork.artworkType==='image'?'image/png' as const:'model/gltf-binary' as const}));
 const at='2026-10-03T09:00:00Z',result=projectPublication(candidate,prepared,at,[],{source:asset,bytes}),still=spaceStillFor(result.snapshot)!;
 expect(still.id).toBe(result.cover!.id);expect(still.path).toBe(`space-still/${still.id}/image.png`);expect(still.id).not.toBe(id);
 expect(entranceFor(result.snapshot)).toMatchObject({imageAssetId:still.id,artist:id,imageAlt:id});expect(still.rights.creditLine).toBe(id);
 expect(still.sha256).toBe(sha256(bytes));expect(result.snapshot.mediaAssets).toHaveLength(0);expect(candidate).toEqual(original);
 expect(()=>projectPublication(candidate,prepared,at)).toThrow('PUBLICATION_NOT_READY');
 expect(()=>projectPublication(candidate,prepared,at,[],{source:asset,bytes:Buffer.alloc(bytes.length)})).toThrow('PUBLICATION_NOT_READY');
 expect(()=>projectPublication(candidate,prepared,at,[],{source:{...asset,sha256:'a'.repeat(64)},bytes})).toThrow('PUBLICATION_NOT_READY');
});
it('owner-scoped live cover approval gates distinguish display/export, revocation and exact approval snapshots',async()=>{
 const {asset}=await fixture(),service=new CoverImages(),exhibitionId='50000000-0000-4000-8000-000000000144';
 const session={tenantId:tenant,userId:tenant,role:'admin'} as Session;
 let row:CoverImageRow={tenant_id:tenant,exhibition_id:exhibitionId,id,created_by:tenant,sha256:asset.sha256,bytes:asset.bytes,mime:'image/png',rights:structuredClone(asset.rights),object_key:`${tenant}/cover-images/${id}/${asset.sha256}`,state:'approved',revoked:false};
 let snapshot:unknown=coverImageAsset(row);
 const access=vi.spyOn(service.studio,'access').mockResolvedValue({} as never);
 const query=vi.fn(async(sql:string,parameters:unknown[])=>{
  expect(parameters[0]).toBe(tenant);
  if(sql.startsWith('SELECT * FROM studio_cover_images')){expect(parameters).toEqual([tenant,exhibitionId,id]);return {rows:[row]};}
  if(sql.startsWith('SELECT snapshot FROM cover_image_approvals'))return {rows:[{snapshot}]};
  throw Error('Unexpected query');
 });
 const client={query} as unknown as PoolClient;
 expect((await service.approved(client,session,exhibitionId,id)).id).toBe(id);expect(access).toHaveBeenCalledWith(client,session,exhibitionId);
 row={...row,rights:{...row.rights,permissions:{...row.rights.permissions,display:false,export:true}}};snapshot=coverImageAsset(row);
 await expect(service.approved(client,session,exhibitionId,id)).rejects.toMatchObject({code:'COVER_IMAGE_RIGHTS_DENIED'});
 expect((await service.approved(client,session,exhibitionId,id,'export')).id).toBe(id);
 row={...row,revoked:true};await expect(service.approved(client,session,exhibitionId,id,'export')).rejects.toMatchObject({code:'COVER_IMAGE_RIGHTS_DENIED'});
 row={...row,revoked:false};snapshot={...coverImageAsset(row),sha256:'b'.repeat(64)};
 await expect(service.approved(client,session,exhibitionId,id,'export')).rejects.toMatchObject({code:'COVER_IMAGE_APPROVAL_CHANGED'});
});

it('privacy retention recognizes private and public still blob references before removal',async()=>{
 const key=`${tenant}/cover-images/${id}/retained.png`;
 for(const table of ['studio_cover_images','publication_cover_images']){
  const query=vi.fn(async(sql:string)=>{
   if(sql.startsWith('SELECT c.relname FROM pg_class'))return {rows:[{relname:table}]};
   if(sql.startsWith(`SELECT to_jsonb(t) AS row FROM "${table}"`))return {rows:[{row:{tenant_id:tenant,id,object_key:key,bytes:100,sha256:'a'.repeat(64),state:'approved',revoked:true}}]};
   throw Error('Unexpected query');
  });
  expect(await new Privacy({} as never).referenced({query} as unknown as PoolClient,key)).toBe(true);
 }
});
