import { buildApp } from './app.ts';

const app = buildApp();
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}
// Local-only default. Network deployments need an explicit host and later auth gates.
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
console.info(`ExhibitOS API listening on port ${port}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => { await app.close(); });
}
