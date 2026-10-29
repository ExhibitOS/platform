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

describe('historical thumbnail receipt lookup',()=>{
 it('uses the pinned receipt independent of the current selection and fails closed on changes or revoked rights',async()=>{
  const f=fixture(), exportRights={...rights,permissions:{...rights.permissions,export:true}}, exportMetadata={...metadata,rights:exportRights};
  f.row.metadata=exportMetadata;Object.assign(f.row,{cms_managed:true});
  const binding='10000000-0000-4000-8000-000000000007';
  const pin={artworkId:artwork,revision:1,bindingId:binding,sourceAssetId:source,sourceSha256:input.sourceSha256,thumbnailAssetId:preview,thumbnailSha256:input.thumbnailSha256,bytes:previewBytes.length};
  const row={artwork_revision:1,source_asset_id:source,source_sha256:pin.sourceSha256,thumbnail_asset_id:preview,sha256:pin.thumbnailSha256,bytes:pin.bytes,object_key:'preview',current_key:'preview',current_hash:pin.thumbnailSha256,current_bytes:pin.bytes,mime:'image/png',state:'approved',deleted_at:null,rights_deleted:null,rights:exportRights,approval:{asset:f.primary,metadata:exportMetadata}};
  const query=vi.fn(async(sql:string)=>{if(sql.includes('FROM artwork_thumbnail_bindings b JOIN artwork_approvals'))return {rows:[row]};throw Error('unexpected query');});
  const client={query} as unknown as PoolClient;
  await expect(f.service.pinnedForExport(client,f.session,pin)).resolves.toMatchObject({rights:[exportRights,exportRights,exportRights]});
  expect(query.mock.calls.every(([sql])=>!sql.includes('artwork_thumbnail_selections'))).toBe(true);
  await expect(f.service.pinnedForExport(client,f.session,{...pin,thumbnailSha256:'a'.repeat(64)})).rejects.toMatchObject({code:'OEX_SOURCE_CHANGED'});
  row.rights={...exportRights,permissions:{...exportRights.permissions,export:false}};
  await expect(f.service.pinnedForExport(client,f.session,pin)).rejects.toMatchObject({code:'RIGHTS_DENIED'});
  const extraPin={...pin,extra:true};await expect(f.service.pinnedForExport(client,f.session,extraPin)).rejects.toMatchObject({code:'OEX_SOURCE_CHANGED'});
 });
});
