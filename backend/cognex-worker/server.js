/**
 * server.js — runs the Cognex Hono app on Node (Docker) with:
 *   • auth + RBAC wrapper (src/node/app.js), the Worker's src/index.js is untouched
 *   • X-Instance-ID header (which of the 3 containers answered)
 *   • /metrics for Prometheus, JSON logs via pino
 */
import { serve } from '@hono/node-server';
import client from 'prom-client';
import pino from 'pino';
import { buildSecureApp } from './src/node/app.js';
import { createSupabaseStore, createMemoryStore } from './src/node/store.js';

const INSTANCE_ID = process.env.INSTANCE_ID || 'local';
const PORT = Number(process.env.PORT) || 3000;
const log = pino({ base: { instance_id: INSTANCE_ID } });

for (const k of ['JWT_SECRET', 'TOTP_ENC_KEY']) {
  if (!process.env[k]) { log.fatal(`${k} is not set (see .env.example)`); process.exit(1); }
}

let store;
if (process.env.SUPABASE_URL) store = createSupabaseStore(process.env);
else { log.warn('SUPABASE_URL not set: using in-memory auth store (dev only)'); store = createMemoryStore(); }

const app = buildSecureApp({ store });

client.register.setDefaultLabels({ instance_id: INSTANCE_ID });
client.collectDefaultMetrics();
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// Workers hand the app an ExecutionContext; Node doesn't. Keeps c.executionCtx.waitUntil() (/api/ingest) working.
const executionCtx = {
  waitUntil: (p) => { Promise.resolve(p).catch((e) => log.error({ err: String(e) }, 'waitUntil error')); },
  passThroughOnException: () => {},
};

async function handle(req) {
  const { pathname } = new URL(req.url);
  if (pathname === '/metrics') {
    return new Response(await client.register.metrics(), { headers: { 'Content-Type': client.register.contentType } });
  }
  const start = process.hrtime.bigint();
  const res = await app.fetch(req, process.env, executionCtx);
  const out = new Response(res.body, res);
  out.headers.set('X-Instance-ID', INSTANCE_ID);

  const seconds = Number(process.hrtime.bigint() - start) / 1e9;
  httpDuration.observe({ method: req.method, route: pathname.replace(UUID, ':id'), status: String(out.status) }, seconds);
  if (pathname !== '/health') {
    log.info({ method: req.method, path: pathname, status: out.status, ms: Math.round(seconds * 1000) });
  }
  return out;
}

const server = serve({ fetch: handle, port: PORT }, (info) => log.info({ port: info.port, store: store.kind }, 'listening'));
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { log.info({ sig }, 'shutting down'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
}
