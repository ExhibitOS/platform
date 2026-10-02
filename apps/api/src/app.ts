import Fastify from 'fastify';
import type { Pool } from 'pg';
import { registerAuth } from './routes.ts';
import type { AuthConfig } from './auth.ts';
import { readiness, type LifecycleConfig } from './lifecycle.ts';

// A fresh instance per caller keeps tests isolated and avoids listening on import.
export function buildApp(options?: {pool:Pool;auth:AuthConfig;blobs?:import('@exhibitos/storage').BlobStore;oexWorker?:boolean;freeze?:import('./freeze.ts').FreezeConfig;lifecycle?:LifecycleConfig}) {
  const app = Fastify({ bodyLimit: 1024 * 1024, trustProxy: false, ajv: {customOptions:{removeAdditional:false,coerceTypes:false}} });
  app.get('/api/v1/health', {
    schema: { response: { 200: {
      type: 'object', additionalProperties: false,
      required: ['status', 'service', 'version'],
      properties: { status: { const: 'ok' }, service: { const: 'exhibitos-api' }, version: { type: 'string' } },
    } } },
  }, async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return { status: 'ok', service: 'exhibitos-api', version: '0.1.0' };
  });
  if (options) registerAuth(app,options.pool,options.auth,options.blobs,options.oexWorker,options.freeze);
  if (options?.lifecycle) app.get('/api/v1/readiness', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    const result = await readiness(options.pool, options.lifecycle!);
    return reply.code(result.ready ? 200 : 503).send(result);
  });
  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).send({ code: 'NOT_FOUND', message: 'Resource not found', fieldErrors: [], requestId: request.id });
  });
  return app;
}
