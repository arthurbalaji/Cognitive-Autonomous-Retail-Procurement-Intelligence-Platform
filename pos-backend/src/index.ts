import Fastify from 'fastify';
import cors from '@fastify/cors';
import { cfg } from './config.js';
import { waitForDb } from './db.js';
import { migrate } from './migrate.js';
import { startWorker } from './webhooks.js';
import { registerShopify } from './shopify.js';
import { registerInternal } from './internal.js';
import { registerAdmin } from './admin.js';
import { registerLegacy } from './legacy.js';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' }, bodyLimit: 5 * 1024 * 1024 });

// keep raw bytes: CARPIP-signed callbacks are verified over the exact request body
app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body: Buffer, done) => {
  (req as any).rawBody = body;
  if (!body.length) return done(null, {});
  try {
    done(null, JSON.parse(body.toString('utf8')));
  } catch (e: any) {
    e.statusCode = 400;
    done(e, undefined);
  }
});

await app.register(cors, { origin: true });

app.get('/healthz', async () => ({ status: 'UP', service: 'pos-backend' }));

registerShopify(app);
registerInternal(app);
registerAdmin(app);
registerLegacy(app);

app.setErrorHandler((err: any, _req, reply) => {
  const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
  if (status >= 500) app.log.error(err);
  reply.code(status).send({ code: status === 500 ? 'INTERNAL' : 'BAD_REQUEST', detail: err.message });
});

await waitForDb();
await migrate();
startWorker();
await app.listen({ port: cfg.port, host: '0.0.0.0' });
console.log(`pos-backend listening on :${cfg.port}`);
