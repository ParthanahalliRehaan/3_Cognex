/**
 * Security tests (Q2): no token -> 401, wrong role -> 403, bad MFA -> 401, valid flow -> 200.
 * Runs fully offline against the in-memory store; a stub app stands in for Supabase-backed routes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { generateSync } from 'otplib';
import { buildSecureApp } from '../../src/node/app.js';
import { createMemoryStore } from '../../src/node/store.js';
import { decryptSecret } from '../../src/node/crypto.js';

const ENV = {
  JWT_SECRET: 'test-jwt-secret-test-jwt-secret-1234',
  TOTP_ENC_KEY: 'a'.repeat(64),
  LOGIN_MAX_FAILS: '5',
};
const ID = '11111111-1111-4111-8111-111111111111';
const PASSWORD = 'correct horse battery';

// Stand-in for the original Cognex app: succeeds on PUT/DELETE so we test only the guards.
const stubBase = new Hono();
stubBase.put('/api/nodes/:id', (c) => c.json({ success: true, op: 'update' }));
stubBase.delete('/api/nodes/:id', (c) => c.json({ success: true, op: 'delete' }));
stubBase.put('/api/documents/:id', (c) => c.json({ success: true }));
stubBase.get('/api/graph', (c) => c.json({ nodes: [], edges: [] }));

let store, app;
const call = (path, { method = 'GET', body, token, ip = '10.0.0.1' } = {}) =>
  app.request(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': ip,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }, ENV);

async function register(email, role = 'viewer') {
  const r = await call('/api/auth/register', { method: 'POST', body: { email, password: PASSWORD } });
  expect(r.status).toBe(201);
  if (role !== 'viewer') await store.users.setRole(email, role);
}

/** Full login: password -> (setup if first time) -> TOTP -> access token */
async function loginFully(email) {
  const login = await (await call('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } })).json();
  let secret;
  if (!login.mfa_enabled) {
    const setup = await (await call('/api/auth/mfa/setup', { method: 'POST', token: login.pre_auth_token })).json();
    secret = setup.secret;
  } else {
    secret = decryptSecret((await store.users.findByEmail(email)).totp_secret, ENV.TOTP_ENC_KEY);
  }
  const res = await call('/api/auth/mfa/verify', { method: 'POST', token: login.pre_auth_token, body: { code: generateSync({ secret }) } });
  expect(res.status).toBe(200);
  return (await res.json());
}

beforeEach(() => {
  store = createMemoryStore();
  app = buildSecureApp({ store, baseApp: stubBase });
});

describe('Q2(a) passwords', () => {
  it('stores a salted bcrypt hash, never the plain password', async () => {
    await register('a@example.com');
    const u = await store.users.findByEmail('a@example.com');
    expect(u.password_hash).not.toContain(PASSWORD);
    expect(u.password_hash).toMatch(/^\$2[aby]\$10\$/);
  });

  it('gives the same password a different hash for each user (salt)', async () => {
    await register('a@example.com');
    await register('b@example.com');
    const [a, b] = [await store.users.findByEmail('a@example.com'), await store.users.findByEmail('b@example.com')];
    expect(a.password_hash).not.toBe(b.password_hash);
  });

  it('ignores a client-supplied role on registration', async () => {
    const r = await call('/api/auth/register', { method: 'POST', body: { email: 'x@example.com', password: PASSWORD, role: 'admin' } });
    expect((await r.json()).user.role).toBe('viewer');
  });
});

describe('Q2(b) login + MFA', () => {
  it('wrong password -> 401', async () => {
    await register('a@example.com');
    const r = await call('/api/auth/login', { method: 'POST', body: { email: 'a@example.com', password: 'nope-nope-nope' } });
    expect(r.status).toBe(401);
  });

  it('bad MFA code -> 401', async () => {
    await register('a@example.com');
    const login = await (await call('/api/auth/login', { method: 'POST', body: { email: 'a@example.com', password: PASSWORD } })).json();
    await call('/api/auth/mfa/setup', { method: 'POST', token: login.pre_auth_token });
    const r = await call('/api/auth/mfa/verify', { method: 'POST', token: login.pre_auth_token, body: { code: '000000' } });
    expect(r.status).toBe(401);
  });

  it('encrypts the TOTP secret at rest', async () => {
    await register('a@example.com');
    const login = await (await call('/api/auth/login', { method: 'POST', body: { email: 'a@example.com', password: PASSWORD } })).json();
    const setup = await (await call('/api/auth/mfa/setup', { method: 'POST', token: login.pre_auth_token })).json();
    expect(setup.qr_data_url).toMatch(/^data:image\/png;base64,/);
    const u = await store.users.findByEmail('a@example.com');
    expect(u.totp_secret).not.toContain(setup.secret);
    expect(u.totp_secret.startsWith('v1:')).toBe(true);
  });

  it('a pre-auth token (password only) cannot call protected APIs', async () => {
    await register('a@example.com', 'admin');
    const login = await (await call('/api/auth/login', { method: 'POST', body: { email: 'a@example.com', password: PASSWORD } })).json();
    const r = await call(`/api/nodes/${ID}`, { method: 'DELETE', token: login.pre_auth_token });
    expect(r.status).toBe(401);
  });

  it('locks out after repeated failed logins -> 429', async () => {
    await register('a@example.com');
    for (let i = 0; i < 5; i++) {
      const r = await call('/api/auth/login', { method: 'POST', body: { email: 'a@example.com', password: 'wrong-wrong-1' }, ip: '203.0.113.9' });
      expect(r.status).toBe(401);
    }
    const blocked = await call('/api/auth/login', { method: 'POST', body: { email: 'a@example.com', password: PASSWORD }, ip: '203.0.113.9' });
    expect(blocked.status).toBe(429);
  });
});

describe('Q2(b) role-based access on update/delete', () => {
  it('no token -> 401 on PUT and DELETE', async () => {
    expect((await call(`/api/nodes/${ID}`, { method: 'PUT', body: { label: 'x' } })).status).toBe(401);
    expect((await call(`/api/nodes/${ID}`, { method: 'DELETE' })).status).toBe(401);
  });

  it('garbage token -> 401', async () => {
    expect((await call(`/api/nodes/${ID}`, { method: 'DELETE', token: 'not.a.jwt' })).status).toBe(401);
  });

  it('viewer -> 403 on PUT and DELETE', async () => {
    await register('v@example.com', 'viewer');
    const { token } = await loginFully('v@example.com');
    expect((await call(`/api/nodes/${ID}`, { method: 'PUT', token, body: { label: 'x' } })).status).toBe(403);
    expect((await call(`/api/nodes/${ID}`, { method: 'DELETE', token })).status).toBe(403);
  });

  it('editor -> 200 on PUT, 403 on DELETE', async () => {
    await register('e@example.com', 'editor');
    const { token } = await loginFully('e@example.com');
    expect((await call(`/api/nodes/${ID}`, { method: 'PUT', token, body: { label: 'x' } })).status).toBe(200);
    expect((await call(`/api/nodes/${ID}`, { method: 'DELETE', token })).status).toBe(403);
  });

  it('admin -> 200 on DELETE (valid flow)', async () => {
    await register('ad@example.com', 'admin');
    const { token, role } = await loginFully('ad@example.com');
    expect(role).toBe('admin');
    expect((await call(`/api/nodes/${ID}`, { method: 'DELETE', token })).status).toBe(200);
  });

  it('reads stay public', async () => {
    expect((await call('/api/graph')).status).toBe(200);
  });
});

describe('audit log', () => {
  it('records failures, rejections and deletes', async () => {
    await register('ad@example.com', 'admin');
    await call('/api/auth/login', { method: 'POST', body: { email: 'ad@example.com', password: 'bad-bad-bad' } });
    await call(`/api/nodes/${ID}`, { method: 'DELETE' });
    const { token } = await loginFully('ad@example.com');
    await call(`/api/nodes/${ID}`, { method: 'DELETE', token });
    const events = store.audit._all().map((r) => r.event);
    expect(events).toEqual(expect.arrayContaining(['register', 'login_failed', 'request_rejected', 'login_success', 'nodes_delete']));
  });
});

describe('real app wiring', () => {
  it('rejects an unauthenticated DELETE before touching the database', async () => {
    const real = buildSecureApp({ store }); // default baseApp = src/index.js
    const r = await real.request(`/api/edges/${ID}`, { method: 'DELETE' }, ENV);
    expect(r.status).toBe(401);
  });
});
