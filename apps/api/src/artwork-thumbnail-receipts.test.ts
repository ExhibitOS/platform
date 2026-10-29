// SPDX-License-Identifier: AGPL-3.0-or-later
import {describe,it,expect,vi} from 'vitest';
import {sha256,type BlobStore} from '@exhibitos/storage';
import type {PoolClient} from 'pg';
import type {Session} from './auth.ts';
import {ArtworkThumbnailReceipts} from './artwork-thumbnail-receipts.ts';
vi.mock('./artwork-thumbnail.ts',async importOriginal=>{const original=await importOriginal<typeof import('./artwork-thumbnail.ts')>();return {...original,validateThumbnailBytes:vi.fn(async()=>({width:1,height:1}))};});
const tenant='10000000-0000-4000-8000-000000000001',artwork='10000000-0000-4000-8000-000000000002',source='10000000-0000-4000-8000-000000000003',preview='10000000-0000-4000-8000-000000000004',user='10000000-0000-4000-8000-000000000005';
const rights={holder:'Synthetic owner',ownership:'owner',licenseId:'CC0-1.0',permissions:{display:true,download:false,export:false,commercial:false},creditLine:'Synthetic'};
const metadata={title:'Synthetic',description:'',dimensions:{width:1,height:1,unit:'m'},rights,provenance:{source:'synthetic',sourceUnits:'m',scaleApplied:true,notes:''}};
const sourceBytes=Buffer.from('source'),previewBytes=Buffer.from('preview');
const input={requestId:'10000000-0000-4000-8000-000000000006',expectedRevision:1,sourceAssetId:source,sourceSha256:sha256(sourceBytes),thumbnailAssetId:preview,thumbnailSha256:sha256(previewBytes),expectedSelectionVersion:0,view:{kind:'default'}};
function fixture(){
 const row={revision:1,approved_revision:1,approved_asset_id:source,metadata};
 const primary={id:source,sha256:input.sourceSha256,bytes:sourceBytes.length,mime:'image/png',object_key:'source',rights};
 const thumbnail={id:preview,sha256:input.thumbnailSha256,bytes:previewBytes.length,mime:'image/png',object_key:'preview',rights};
 const query=vi.fn(async(sql:string,args:unknown[])=>{
  if(sql.startsWith('SELECT snapshot FROM artwork_approvals'))return {rows:[{snapshot:{metadata,asset:primary}}]};
  if(sql.startsWith('SELECT a.*,r.metadata AS rights'))return {rows:[args[2]===source?primary:thumbnail]};
  if(sql.startsWith('SELECT id,payload_sha256'))return {rows:[]};
  if(sql.startsWith('SELECT binding_id,version'))return {rows:[]};
  return {rows:[],rowCount:1};
 });
 const blobs={get:vi.fn(async(key:string)=>key==='source'?sourceBytes:previewBytes)} as unknown as BlobStore,service=new ArtworkThumbnailReceipts(blobs);
 vi.spyOn(service.cms,'ownArtwork').mockResolvedValue(row);
 return {service,query,c:{query} as unknown as PoolClient,row,primary,thumbnail,session:{tenantId:tenant,userId:user,role:'artist'} as Session};
}
describe('representative image receipt authority',()=>{
 it('binds exact current source and preview, then records immutable receipt and selection',async()=>{
  const f=fixture(),result=await f.service.select(f.c,f.session,artwork,input);
  expect(result).toMatchObject({selectionVersion:1,selected:true});
  expect(f.query.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO artwork_thumbnail_bindings'))).toBe(true);
  expect(f.query.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO artwork_thumbnail_selections'))).toBe(true);
 });
 it('rejects stale source, denied preview rights and stale selection before a receipt',async()=>{
  const f=fixture();await expect(f.service.select(f.c,f.session,artwork,{...input,sourceSha256:'c'.repeat(64)})).rejects.toMatchObject({code:'APPROVAL_INVALID'});
  await expect(f.service.select(f.c,f.session,artwork,{...input,expectedSelectionVersion:1})).rejects.toMatchObject({code:'SELECTION_CONFLICT'});
  f.thumbnail.rights={...rights,permissions:{...rights.permissions,display:false}};await expect(f.service.select(f.c,f.session,artwork,input)).rejects.toMatchObject({code:'RIGHTS_DENIED'});
  expect(f.query.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO artwork_thumbnail_bindings'))).toBe(false);
 });
});
