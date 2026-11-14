// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import type {Pool} from 'pg';
import {sha256} from '@exhibitos/storage';
import {buildApp} from './app.ts';
import {Cms} from './cms.ts';
it('keeps primary preview unchanged and limits selected display reads to exact query and live Native owner before/after',async()=>{
 const tenantId=randomUUID(),userId=randomUUID(),artworkId=randomUUID(),assetId=randomUUID(),csrf='csrf',token='a'.repeat(43),queries:string[]=[];
 const session={id:randomUUID(),user_id:userId,tenant_id:tenantId,role:'artist',csrf_hash:sha256(Buffer.from(csrf)),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')};
 const client={query:async(sql:string)=>{queries.push(sql);return sql.includes('SELECT s.*,m.role')?{rows:[session],rowCount:1}:{rows:[],rowCount:0};},release:()=>{}};
 const pool={connect:async()=>client} as unknown as Pool;let available=true;
 const assertDatabase=vi.fn(async()=>{}),owner={tenantId,principalId:userId,workspaceId:randomUUID(),assertDatabase} as never;
 const auth={mode:'local' as const,origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'};
 const app=buildApp({pool,auth,nativeOexWorkspace:owner,nativeBoundedEditing:true,runtimeAvailable:()=>available}),ordinary=buildApp({pool,auth});
 const headers={host:'127.0.0.1:13200',origin:auth.origin,cookie:`exhibitos_local_session=${token}`};
 const root=`/api/v1/tenants/${tenantId}/cms/artworks/${artworkId}/preview`,url=`${root}?expectedRevision=7&assetId=${assetId}`;
 const result={bytes:Buffer.from('selected coarse derivative'),mime:'model/gltf-binary' as const,revision:7,assetId,watermarked:false,watermarkMode:'none' as const};
 const selected=vi.spyOn(Cms.prototype,'displaySelectedVariant').mockResolvedValue(result),primary=vi.spyOn(Cms.prototype,'display').mockResolvedValue({...result,bytes:Buffer.from('primary derivative')});
 try{
  for(const suffix of [`?assetId=${assetId}`,`?expectedRevision=7&assetId=bad`,`?expectedRevision=7&assetId=${assetId}&other=x`,`?expectedRevision=7&assetId=${assetId}&assetId=${assetId}`])expect((await app.inject({url:root+suffix,headers})).statusCode).toBe(400);
  expect((await ordinary.inject({url,headers})).statusCode).toBe(503);available=false;expect((await app.inject({url,headers})).statusCode).toBe(503);available=true;
  expect((await app.inject({url,headers:{...headers,origin:'http://invalid.example'}})).statusCode).toBe(403);
  expect((await app.inject({url,headers:{...headers,cookie:''}})).statusCode).toBe(401);expect(selected).not.toHaveBeenCalled();
  const response=await app.inject({url,headers});expect(response.statusCode,response.body).toBe(200);expect(response.rawPayload).toEqual(result.bytes);
  expect(response.headers).toMatchObject({'x-exhibitos-artwork-asset-id':assetId,'x-exhibitos-artwork-revision':'7','x-exhibitos-display-copy':'true','x-exhibitos-watermarked':'false','x-exhibitos-watermark-mode':'none','cache-control':'no-store','content-type':'model/gltf-binary','x-content-type-options':'nosniff'});
  expect(selected.mock.calls[0]?.slice(2)).toEqual([artworkId,assetId,7]);expect(primary).not.toHaveBeenCalled();
  const old=await ordinary.inject({url:root+'?expectedRevision=7',headers});expect(old.statusCode).toBe(200);expect(old.body).toBe('primary derivative');expect(old.headers).not.toHaveProperty('x-exhibitos-artwork-asset-id');
  selected.mockImplementationOnce(async()=>{available=false;return result;});queries.length=0;
  const closed=await app.inject({url,headers});expect(closed.statusCode).toBe(503);expect(closed.body).not.toContain('selected coarse');expect(queries.at(-1)).toBe('ROLLBACK');
 }finally{selected.mockRestore();primary.mockRestore();await app.close();await ordinary.close();}
});
