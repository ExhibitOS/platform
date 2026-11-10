// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import type {Pool} from 'pg';
import {FileBlobStore,sha256} from '@exhibitos/storage';
import {buildApp} from './app.ts';
import {ArtworkThumbnailReceipts} from './artwork-thumbnail-receipts.ts';
import {ApiError} from './auth.ts';
it('advertises and accepts rendered persistence only with live native owner, bounded durable store and protected mutation',async()=>{
 const tenantId=randomUUID(),userId=randomUUID(),csrf='csrf',token='a'.repeat(43),queries:string[]=[];
 const session={id:randomUUID(),user_id:userId,tenant_id:tenantId,role:'admin',csrf_hash:sha256(Buffer.from(csrf)),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')};
 const client={query:async(sql:string)=>{queries.push(sql);return sql.includes('SELECT s.*,m.role')?{rows:[session],rowCount:1}:{rows:[],rowCount:0};},release:()=>{}};
 const pool={connect:async()=>client} as unknown as Pool,blobs=new FileBlobStore('/synthetic-unused');
 let available=true,bound=true;
 const assertDatabase=vi.fn(async()=>{}),owner={tenantId,principalId:userId,workspaceId:randomUUID(),assertDatabase,matchesBlobRoot:(root:string)=>bound&&root===blobs.root} as never;
 const auth={mode:'local' as const,origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'};
 const app=buildApp({pool,auth,blobs,nativeOexWorkspace:owner,nativeBoundedEditing:true,runtimeAvailable:()=>available}),ordinary=buildApp({pool,auth,blobs});
 const headers={host:'127.0.0.1:13200',origin:auth.origin,cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf};
 const url=`/api/v1/tenants/${tenantId}/cms/artworks/${randomUUID()}/thumbnail-selection`,payload={kind:'rendered-display-preview-v1'};
 const operation=vi.spyOn(ArtworkThumbnailReceipts.prototype,'selectRendered').mockResolvedValue({id:randomUUID(),thumbnailAssetId:randomUUID(),thumbnailSha256:'b'.repeat(64),selectionVersion:1,selected:true});
 const legacy=vi.spyOn(ArtworkThumbnailReceipts.prototype,'select').mockResolvedValue({id:randomUUID(),selectionVersion:1,selected:true});
 const profile=async()=> (await app.inject({method:'GET',url:'/api/v1/auth/session',headers})).json().nativeRenderedArtworkThumbnailProfile;
 const post=(override:Record<string,string>={})=>app.inject({method:'POST',url,headers:{...headers,...override},payload});
 try{
  expect(await profile()).toBe('rendered-display-preview-v1');
  expect((await ordinary.inject({method:'GET',url:'/api/v1/auth/session',headers})).json()).not.toHaveProperty('nativeRenderedArtworkThumbnailProfile');
  expect((await ordinary.inject({method:'POST',url,headers,payload})).statusCode).toBe(503);
  expect((await post({origin:'http://invalid.example'})).statusCode).toBe(403);
  expect((await post({'x-csrf-token':''})).statusCode).toBe(403);
  expect(operation).not.toHaveBeenCalled();
  available=false;expect(await profile()).toBeUndefined();expect((await post()).statusCode).toBe(503);
  available=true;bound=false;expect(await profile()).toBeUndefined();expect((await post()).statusCode).toBe(503);
  bound=true;queries.length=0;const result=await post();expect(result.statusCode,result.body).toBe(200);expect(result.json()).toMatchObject({selected:true,selectionVersion:1});
  expect(queries).toContain('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');expect(queries.at(-1)).toBe('COMMIT');
  operation.mockImplementationOnce(async()=>{available=false;return {id:randomUUID(),thumbnailAssetId:randomUUID(),thumbnailSha256:'b'.repeat(64),selectionVersion:1,selected:true};});
  queries.length=0;expect((await post()).statusCode).toBe(503);expect(queries.at(-1)).toBe('ROLLBACK');available=true;
  assertDatabase.mockRejectedValueOnce(new ApiError(403,'FORBIDDEN'));expect(await profile()).toBeUndefined();
  expect((await app.inject({method:'POST',url,headers,payload:{requestId:randomUUID()}})).statusCode).toBe(200);expect(legacy).toHaveBeenCalledOnce();
 }finally{operation.mockRestore();legacy.mockRestore();await app.close();await ordinary.close();}
});
