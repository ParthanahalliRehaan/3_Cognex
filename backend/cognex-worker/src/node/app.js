/**
 * app.js — the Node deployment's *secured* app.
 *
 * src/index.js (the Cloudflare Worker app) is NOT modified. This file wraps it:
 *
 *   root
 *    ├─ cors
 *    ├─ /api/auth/*                 register, login, mfa/setup, mfa/verify, me
 *    ├─ PUT    nodes|edges|documents/:id   -> requireAuth + role editor|admin
 *    ├─ DELETE nodes|edges|documents/:id   -> requireAuth + role admin
 *    └─ everything else             -> original Cognex app (reads stay public)
 *
 * Role model:  admin = delete (and update) · editor = update · viewer = read only
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import baseAppDefault from '../index.js';
import { createAuthRoutes } from './auth.js';
import { requireAuth, requireRole, auditMutation } from './middleware.js';

const RESOURCES = ['nodes', 'edges', 'documents'];

export function buildSecureApp({ store, baseApp = baseAppDefault }) {
  const root = new Hono({ strict: false });

  root.use('*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposeHeaders: ['X-Request-ID', 'X-Instance-ID', 'X-Ingestion-Status'],
    maxAge: 86400,
  }));

  root.route('/', createAuthRoutes(store));

  for (const r of RESOURCES) {
    const path = `/api/${r}/:id`;
    root.put(path, requireAuth(store), requireRole(store, 'editor', 'admin'), auditMutation(store, `${r}_update`));
    root.delete(path, requireAuth(store), requireRole(store, 'admin'), auditMutation(store, `${r}_delete`));
  }

  root.route('/', baseApp);
  return root;
}
