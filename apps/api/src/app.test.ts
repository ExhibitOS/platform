import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import type {Pool} from 'pg';
import {FileBlobStore} from '@exhibitos/storage';
import {createSelectedNativeUploadSlot} from './native-bounded-oex-upload.ts';
import {createSelectedStudioPutSlot} from './native-selected-studio-put.ts';

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
describe('public service health contract', () => {
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
