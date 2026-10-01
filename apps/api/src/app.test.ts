import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
describe('public service health contract', () => {
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
