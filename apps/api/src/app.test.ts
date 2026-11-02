import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import type {Pool} from 'pg';
import {createHash} from 'node:crypto';
import {newDraft} from '../../web/src/drafts/example.ts';
import {etag} from './studio.ts';
import {FileBlobStore} from '@exhibitos/storage';
import {createSelectedNativeUploadSlot} from './native-bounded-oex-upload.ts';
import {createSelectedStudioPutSlot,closeSelectedStudioPutSlot} from './native-selected-studio-put.ts';
import type {NativeOexWorkspaceContext} from './native-oex-provenance.ts';

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
describe('public service health contract', () => {
  it('refuses bounded editing without a local owned context or inside selected import',()=>{
    const context={} as NativeOexWorkspaceContext,pool={} as Pool,local={mode:'local' as const,origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'};
    expect(()=>buildApp({pool,auth:local,nativeBoundedEditing:true})).toThrow('NATIVE_OEX_CONFIGURATION');
    expect(()=>buildApp({pool,auth:local,freshOexTest:true,nativeOexWorkspace:context,nativeBoundedEditing:true})).toThrow('NATIVE_OEX_CONFIGURATION');
    expect(()=>buildApp({pool,auth:{mode:'network',origin:'https://example.org',bindHost:'127.0.0.1'},freshOexTest:true,nativeOexWorkspace:context})).toThrow('NATIVE_OEX_CONFIGURATION');
  });
  it('returns the authenticated saved row policy without changing the Studio response',async()=>{
    const tenant=crypto.randomUUID(),user=crypto.randomUUID(),workspaceId=crypto.randomUUID(),token='a'.repeat(43),draft=newDraft();
    const session={id:crypto.randomUUID(),user_id:user,tenant_id:tenant,role:'artist',csrf_hash:'',csrf_token:'',expires_at:new Date('2099-01-01T00:00:00Z')};
    const client={query:async(sql:string)=>sql.includes('SELECT s.*,m.role')?{rows:[session],rowCount:1}:sql.includes('SELECT id,revision,metadata,studio_owner_user_id')?{rows:[{id:draft.exhibitionId,revision:3,metadata:draft,studio_owner_user_id:user}],rowCount:1}:{rows:[],rowCount:0},release:()=>{}};
    const pool={connect:async()=>client} as unknown as Pool;
    const nativeOexWorkspace={workspaceId,tenantId:tenant,principalId:user,assertDatabase:async()=>{},assertRecord:async()=>{}};
    const app=buildApp({pool,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'},nativeOexWorkspace} as never);apps.push(app);
    const url=`/api/v1/tenants/${tenant}/studio/exhibitions/${draft.exhibitionId}/native-viewport-policy`;
    const result=await app.inject({method:'GET',url,headers:{host:'127.0.0.1:13200',cookie:`exhibitos_local_session=${token}`}});
    expect(result.statusCode).toBe(200);expect(result.headers['cache-control']).toBe('no-store');
    expect(result.json()).toEqual({exhibitionId:draft.exhibitionId,revision:3,etag:etag(3,draft),boundedReadOnly:false,boundedProfile:false,boundedEditRequired:false});
  });
  it('keeps the read-only native viewport check behind origin, session, tenant and CSRF gates',async()=>{
    const tenant=crypto.randomUUID(),user=crypto.randomUUID(),token='a'.repeat(43),csrf='valid-csrf';
    const row={id:crypto.randomUUID(),user_id:user,tenant_id:tenant,role:'artist',csrf_hash:createHash('sha256').update(csrf).digest('hex'),csrf_token:csrf,expires_at:new Date('2099-01-01T00:00:00Z')};
    const client={query:async(sql:string)=>sql.includes('SELECT s.*,m.role')?{rows:[row],rowCount:1}:{rows:[],rowCount:0},release:()=>{}};
    const pool={connect:async()=>client} as unknown as Pool;
    const saveSlot=createSelectedStudioPutSlot(),app=buildApp({pool,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'},freshOexTest:true,blobs:new FileBlobStore('/synthetic-unused'),uploadSlot:createSelectedNativeUploadSlot(),saveSlot,nativeOexWorkspace:{} as never});apps.push(app);
    const draft=newDraft(),url=`/api/v1/tenants/${tenant}/studio/exhibitions/${draft.exhibitionId}/native-viewport-check`,payload={draft,requestId:crypto.randomUUID()},headers={host:'127.0.0.1:13200',origin:'http://127.0.0.1:13200'};
    expect((await app.inject({method:'POST',url,headers:{...headers,origin:'http://example.invalid'},payload})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url,headers,payload})).statusCode).toBe(401);
    const cookie=`exhibitos_local_session=${token}`;
    const noCsrf=await app.inject({method:'POST',url,headers:{...headers,cookie},payload});expect(noCsrf.statusCode).toBe(403);expect(noCsrf.json().code).toBe('CSRF_REJECTED');
    const crossTenant=await app.inject({method:'POST',url:url.replace(tenant,crypto.randomUUID()),headers:{...headers,cookie,'x-csrf-token':csrf},payload});expect(crossTenant.statusCode).toBe(403);expect(crossTenant.json().code).toBe('FORBIDDEN');
    const policy=url.replace('native-viewport-check','native-viewport-policy');
    expect((await app.inject({method:'GET',url:policy,headers:{...headers,origin:'http://example.invalid'}})).statusCode).toBe(403);
    expect((await app.inject({method:'GET',url:policy,headers})).statusCode).toBe(401);
    const foreignPolicy=await app.inject({method:'GET',url:policy.replace(tenant,crypto.randomUUID()),headers:{...headers,cookie}});expect(foreignPolicy.statusCode).toBe(403);expect(foreignPolicy.json().code).toBe('FORBIDDEN');
    closeSelectedStudioPutSlot(saveSlot);
    expect((await app.inject({method:'POST',url,headers,payload})).statusCode).toBe(401);
    for(const path of [url+'/extra',url.replace('native-viewport-check','native-viewport-check-extra')])expect((await app.inject({method:'POST',url:path,headers,payload})).statusCode).toBe(403);
    const ordinary=buildApp({pool,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'},freshOexTest:true,blobs:new FileBlobStore('/synthetic-unused'),uploadSlot:createSelectedNativeUploadSlot(),saveSlot:createSelectedStudioPutSlot()});apps.push(ordinary);
    expect((await ordinary.inject({method:'POST',url,headers:{...headers,cookie,'x-csrf-token':csrf},payload})).statusCode).toBe(403);
    expect((await ordinary.inject({method:'GET',url:policy,headers:{...headers,cookie}})).statusCode).toBe(404);
  });
  it('refuses all client mutations in the private fresh OEX mode',async()=>{
    const app=buildApp({pool:{} as Pool,auth:{mode:'local',origin:'http://127.0.0.1:13200',bindHost:'127.0.0.1'},freshOexTest:true,blobs:new FileBlobStore('/synthetic-unused'),uploadSlot:createSelectedNativeUploadSlot(),saveSlot:createSelectedStudioPutSlot()});apps.push(app);
    expect((await app.inject({method:'GET',url:'/api/v1/health'})).statusCode).toBe(200);expect(app.server.listenerCount('upgrade')).toBe(0);
    for(const method of ['POST','PUT','PATCH','DELETE'] as const){const result=await app.inject({method,url:'/api/v1/auth/login'});expect(result.statusCode).toBe(403);expect(result.json().code).toBe('NATIVE_SELECTED_WRITE_DENIED');}
  });
  it('reports JSON liveness without credentials or private services', async () => {
    const app = buildApp(); apps.push(app);
    const result = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(result.statusCode).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.json()).toEqual({ status: 'ok', service: 'exhibitos-api', version: '0.1.0' });
  });
  it('returns a safe structured error for unknown resources', async () => {
    const app = buildApp(); apps.push(app);
    const result = await app.inject({ method: 'GET', url: '/api/v1/private-artworks' });
    expect(result.statusCode).toBe(404);
    expect(result.json()).toEqual({ code: 'NOT_FOUND', message: 'Resource not found', fieldErrors: [], requestId: expect.any(String) });
  });
});
