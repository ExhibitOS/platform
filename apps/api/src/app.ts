import Fastify from 'fastify';

// A fresh instance per caller keeps tests isolated and avoids listening on import.
export function buildApp() {
  const app = Fastify({ bodyLimit: 1024 * 1024 });
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
  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).send({ code: 'NOT_FOUND', message: 'Resource not found', requestId: request.id });
  });
  return app;
}
