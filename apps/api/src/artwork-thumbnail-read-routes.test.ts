// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {expect,it,vi} from 'vitest';
import {FileBlobStore,sha256} from '@exhibitos/storage';
import {buildApp} from './app.ts';
import {ArtworkThumbnailReceipts} from './artwork-thumbnail-receipts.ts';
import {ApiError} from './auth.ts';
const mocks=vi.hoisted(()=>({lineage:vi.fn()}));
vi.mock('./image-preparation-lineage.ts',()=>({imagePreparationLineage:mocks.lineage}));
function fixture(){
 const tenantId=randomUUID(),userId=randomUUID(),artworkId=randomUUID(),bindingId=randomUUID(),assetId=randomUUID(),csrf='csrf',token='a'.repeat(43),queries:string[]=[];
 const session={id:randomUUID(),user_id:userId,tenant_id:tenantId,role:'admin',csrf_hash:sha256(Buffer.from(csrf)),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')};
 const client={query:async(sql:string)=>{queries.push(sql);return sql.includes('SELECT s.*,m.role')?{rows:[session],rowCount:1}:{rows:[],rowCount:0};},release:()=>{}};
 const pool={connect:async()=>client} as unknown as Pool,blobs=new FileBlobStore('/synthetic-unused'),auth={mode:'local' as const,origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'};
 const owner={tenantId,principalId:userId,workspaceId:randomUUID(),assertDatabase:async()=>{}} as never;
 const app=buildApp({pool,auth,blobs,nativeOexWorkspace:owner,nativeBoundedEditing:true}),ordinary=buildApp({pool,auth,blobs});
 const headers={host:'127.0.0.1:13200',origin:auth.origin,cookie:`exhibitos_local_session=${token}`};
 const base=`/api/v1/tenants/${tenantId}/cms/artworks/${artworkId}`;
 return {app,ordinary,headers,base,tenantId,artworkId,bindingId,assetId,queries};
}
it('serves exact selected PNG bytes with private cache, integrity and selection headers through the authenticated read route',async()=>{
 const f=fixture(),bytes=Buffer.from('synthetic decoded PNG body'),hash=sha256(bytes);
 const operation=vi.spyOn(ArtworkThumbnailReceipts.prototype,'selectedPreview').mockResolvedValue({id:f.bindingId,assetId:f.assetId,sha256:hash,bytes,revision:2,selectionVersion:1});
 try{
  const url=`${f.base}/thumbnail-selection/${f.bindingId}/image?expectedRevision=2&expectedSelectionVersion=1`,result=await f.app.inject({method:'GET',url,headers:f.headers});
  expect(result.statusCode,result.body).toBe(200);expect(result.rawPayload).toEqual(bytes);
  expect(result.headers).toMatchObject({'content-type':'image/png','content-length':String(bytes.length),'cache-control':'no-store','x-exhibitos-sha256':hash,'x-exhibitos-artwork-revision':'2','x-exhibitos-thumbnail-selection-version':'1','x-exhibitos-thumbnail-binding-id':f.bindingId});
  expect(operation.mock.calls[0]?.slice(2,6)).toEqual([f.artworkId,2,f.bindingId,1]);
  operation.mockClear();expect((await f.app.inject({method:'GET',url:url+'&path=private',headers:f.headers})).statusCode).toBe(400);expect(operation).not.toHaveBeenCalled();
  const foreign=url.replace(f.tenantId,randomUUID());expect((await f.app.inject({method:'GET',url:foreign,headers:f.headers})).statusCode).toBe(403);expect(operation).not.toHaveBeenCalled();
  operation.mockRejectedValueOnce(new ApiError(409,'SELECTION_CONFLICT'));const stale=await f.app.inject({method:'GET',url,headers:f.headers});expect(stale.statusCode).toBe(409);expect(stale.json()).toMatchObject({code:'SELECTION_CONFLICT'});
  expect(f.queries.some(sql=>/^(UPDATE|INSERT|DELETE)/.test(sql))).toBe(false);
 }finally{operation.mockRestore();await f.app.close();await f.ordinary.close();}
});
it('exposes only the native owner lineage read, preserves query pins and rejects unknown or foreign scope before discovery',async()=>{
 const f=fixture(),cursor=randomUUID(),result={scope:'current-owner-current-approved-full',artworkId:f.artworkId,revision:2,full:{assetId:f.assetId},items:[],nextCursor:null};mocks.lineage.mockResolvedValue(result);
 try{
  const url=`${f.base}/image-preparation-lineage?expectedRevision=2&approvedAssetId=${f.assetId}&cursor=${cursor}`;
  expect((await f.ordinary.inject({method:'GET',url,headers:f.headers})).statusCode).toBe(404);
  expect((await f.app.inject({method:'GET',url:url+'&sha256='+ 'a'.repeat(64),headers:f.headers})).statusCode).toBe(400);expect(mocks.lineage).not.toHaveBeenCalled();
  expect((await f.app.inject({method:'GET',url:url.replace(f.tenantId,randomUUID()),headers:f.headers})).statusCode).toBe(403);expect(mocks.lineage).not.toHaveBeenCalled();
  const response=await f.app.inject({method:'GET',url,headers:f.headers});expect(response.statusCode,response.body).toBe(200);expect(response.json()).toEqual(result);
  expect(mocks.lineage.mock.calls[0]?.[2]).toBe(f.artworkId);expect(mocks.lineage.mock.calls[0]?.[3]).toEqual({expectedRevision:2,approvedAssetId:f.assetId,cursor});
  expect(f.queries.some(sql=>/^(UPDATE|INSERT|DELETE)/.test(sql))).toBe(false);
 }finally{mocks.lineage.mockReset();await f.app.close();await f.ordinary.close();}
});
