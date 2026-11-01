import Fastify from 'fastify';
import type { Pool } from 'pg';
import { registerAuth } from './routes.ts';
import type { AuthConfig } from './auth.ts';
import { readiness, type LifecycleConfig } from './lifecycle.ts';

// A fresh instance per caller keeps tests isolated and avoids listening on import.
export function buildApp(options?: {pool:Pool;auth:AuthConfig;blobs?:import('@exhibitos/storage').BlobStore;oexWorker?:boolean;freeze?:import('./freeze.ts').FreezeConfig;lifecycle?:LifecycleConfig;federation?:import('./federation.ts').FederationConfig;publicationSource?:import('./publication.ts').PublicationSource;freshOexTest?:true;uploadSlot?:import('./native-bounded-oex-upload.ts').NativeBoundedUploadSlot;saveSlot?:import('./native-selected-studio-put.ts').SelectedStudioPutSlot}) {
  if(options?.freshOexTest&&options.oexWorker)throw Error('OEX_TEST_WORKER_UNAVAILABLE');
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
  if (options?.auth.clientOrigin) {
    const allowed = options.auth.clientOrigin;
    app.addHook('onRequest', async (request, reply) => {
      // One explicitly configured Pages origin; credentials never use wildcard CORS.
      if (request.headers.origin !== allowed) return;
      reply.header('access-control-allow-origin', allowed).header('vary', 'Origin').header('access-control-allow-credentials', 'true');
      if (request.method === 'OPTIONS') {
        const method = request.headers['access-control-request-method'];
        const headers = String(request.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map(h => h.trim()).filter(Boolean);
        if (!['GET','POST','PUT','PATCH','DELETE','HEAD'].includes(String(method)) || headers.some(h => !['content-type','x-csrf-token','if-match'].includes(h))) return reply.code(403).send({code:'ORIGIN_REJECTED'});
        return reply.header('access-control-allow-methods','GET, POST, PUT, PATCH, DELETE, HEAD').header('access-control-allow-headers','content-type, x-csrf-token, if-match').code(204).send();
      }
    });
  }
  if (options) registerAuth(app,options.pool,options.auth,options.blobs,options.oexWorker,options.freeze,options.federation,options.publicationSource,options.freshOexTest,options.uploadSlot,options.saveSlot);
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
