// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {expect,it,vi} from 'vitest';
import {FileBlobStore,sha256} from '@exhibitos/storage';
import {buildApp} from './app.ts';
import type {ModelPreparationExecution} from './model-preparation-import.ts';
const create=vi.hoisted(()=>vi.fn());
// Route-only fixture; never fabricate an issued native producer lease.
vi.mock('./imports.ts',async original=>{const actual=await original<typeof import('./imports.ts')>();return {...actual,Imports:class extends actual.Imports{constructor(...args:ConstructorParameters<typeof actual.Imports>){super(args[0],args[1],args[2]);} async createCurrentThumbnail(...args:Parameters<InstanceType<typeof actual.Imports>['createCurrentThumbnail']>){return create(this,...args);}}};});
it('exposes a native authenticated CSRF-protected current-source job request and rejects caller pixels or source overrides',async()=>{
 const tenantId=randomUUID(),userId=randomUUID(),artworkId=randomUUID(),csrf='test-csrf',token='a'.repeat(43);
 const settings={mode:'local' as const,origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'};
 const session={id:randomUUID(),user_id:userId,tenant_id:tenantId,role:'admin',csrf_hash:sha256(Buffer.from(csrf)),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')};
 const client={query:async(sql:string)=>sql.includes('SELECT s.*,m.role')?{rows:[session],rowCount:1}:{rows:[],rowCount:0},release:()=>{}},pool={connect:async()=>client} as unknown as Pool;
 const owner={tenantId,principalId:userId,workspaceId:randomUUID(),matchesBlobRoot:()=>true,assertDatabase:async()=>{}} as never;
 const input={pool,auth:settings,blobs:new FileBlobStore('/synthetic-unused'),nativeOexWorkspace:owner,nativeBoundedEditing:true,runtimeAvailable:()=>true};
 const app=buildApp({...input,modelPreparationExecution:{} as ModelPreparationExecution}),unavailable=buildApp(input),ordinary=buildApp({pool,auth:settings,blobs:input.blobs});
 const url=`/api/v1/tenants/${tenantId}/cms/artworks/${artworkId}/image-thumbnail-preparations`,payload={requestId:randomUUID(),expectedRevision:2};
 const headers={host:'127.0.0.1:13200',origin:settings.origin,cookie:`exhibitos_local_session=${token}`,'x-csrf-token':csrf};
 const result={id:randomUUID(),state:'queued',thumbnailPreparation:{status:'pending'}};create.mockResolvedValue(result);
 try{
  expect((await ordinary.inject({method:'POST',url,headers,payload})).statusCode).toBe(404);
  expect((await unavailable.inject({method:'POST',url,headers,payload})).statusCode).toBe(404);
  for(const extra of [{sourceAssetId:randomUUID()},{sha256:'a'.repeat(64)},{pngBase64:'AAAA'},{full:{assetId:randomUUID()}}])expect((await app.inject({method:'POST',url,headers,payload:{...payload,...extra}})).statusCode).toBe(400);
  expect((await app.inject({method:'POST',url,headers:{...headers,'x-csrf-token':''},payload})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url,headers:{...headers,origin:'http://foreign.invalid'},payload})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url:url.replace(tenantId,randomUUID()),headers,payload})).statusCode).toBe(403);
  expect(create).not.toHaveBeenCalled();
  const response=await app.inject({method:'POST',url,headers,payload});expect(response.statusCode,response.body).toBe(201);expect(response.headers['cache-control']).toBe('no-store');expect(response.json()).toEqual(result);
  expect(create.mock.calls[0]?.slice(3)).toEqual([artworkId,payload]);
 }finally{create.mockReset();await app.close();await unavailable.close();await ordinary.close();}
});
