/**
 * auth.js — register / login (password step) / MFA setup / MFA verify.
 *
 *  1. POST /api/auth/register     {email, password}      -> creates a *viewer*
 *  2. POST /api/auth/login        {email, password}      -> pre_auth token (5 min, useless on the API)
 *  3. POST /api/auth/mfa/setup    Bearer pre_auth        -> secret + QR (first time only)
 *  4. POST /api/auth/mfa/verify   Bearer pre_auth {code} -> access JWT (1 h) carrying the role
 *
 * There is no way to obtain an access token without a valid TOTP code.
 */
import { Hono } from 'hono';
import { sign, verify } from 'hono/jwt';
import bcrypt from 'bcryptjs';
import { generateSecret, generateURI, verifySync } from 'otplib';
import QRCode from 'qrcode';
import { encryptSecret, decryptSecret } from './crypto.js';
import { audit, clientIp } from './audit.js';
import { requireAuth } from './middleware.js';

const BCRYPT_COST = 10;
const PRE_AUTH_TTL_S = 5 * 60;
const ACCESS_TTL_S = 60 * 60;
// Compared against when the e-mail is unknown, so response time doesn't reveal which e-mails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const limits = (env) => ({
  max: Number(env.LOGIN_MAX_FAILS) || 5,
  windowMs: (Number(env.LOGIN_WINDOW_MIN) || 15) * 60_000,
});

const now = () => Math.floor(Date.now() / 1000);
const token = (env, user, purpose, ttl) =>
  sign({ sub: user.id, email: user.email, role: user.role, purpose, iat: now(), exp: now() + ttl }, env.JWT_SECRET, 'HS256');

async function readJson(c) {
  try { return await c.req.json(); } catch { return {}; }
}

async function preAuthUser(c, store) {
  const header = c.req.header('authorization') || '';
  const tok = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!tok) return null;
  try {
    const p = await verify(tok, c.env.JWT_SECRET, 'HS256');
    if (p.purpose !== 'pre_auth') return null;
    return await store.users.findByEmail(p.email);
  } catch { return null; }
}

export function createAuthRoutes(store) {
  const app = new Hono({ strict: false });

  app.post('/api/auth/register', async (c) => {
    const { email, password } = await readJson(c);
    if (typeof email !== 'string' || !EMAIL_RE.test(email)) return c.json({ error: 'Valid email required' }, 400);
    if (typeof password !== 'string' || password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400);
    const normalised = email.trim().toLowerCase();

    if (await store.users.findByEmail(normalised)) return c.json({ error: 'Email already registered' }, 409);
    const password_hash = await bcrypt.hash(password, BCRYPT_COST); // salted automatically
    // Self-registration is always 'viewer'. Elevated roles are granted by an admin (scripts/set-role.mjs).
    const user = await store.users.create({ email: normalised, password_hash, role: 'viewer' });
    await audit(store, c, 'register', { actor_id: user.id, actor_email: user.email, actor_role: user.role, status: 201 });
    return c.json({ success: true, user: { id: user.id, email: user.email, role: user.role } }, 201);
  });

  app.post('/api/auth/login', async (c) => {
    const { email, password } = await readJson(c);
    if (typeof email !== 'string' || typeof password !== 'string') return c.json({ error: 'email and password required' }, 400);
    const normalised = email.trim().toLowerCase();
    const ip = clientIp(c);
    const { max, windowMs } = limits(c.env);

    const recentFails = await store.audit.countRecent({ event: 'login_failed', email: normalised, ip, sinceMs: windowMs });
    if (recentFails >= max) {
      await audit(store, c, 'login_rate_limited', { actor_email: normalised, status: 429 });
      c.header('Retry-After', String(Math.ceil(windowMs / 1000)));
      return c.json({ error: 'Too many failed attempts. Try again later.' }, 429);
    }

    const user = await store.users.findByEmail(normalised);
    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) {
      await audit(store, c, 'login_failed', { actor_email: normalised, status: 401, details: { step: 'password' } });
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    await audit(store, c, 'login_password_ok', { actor_id: user.id, actor_email: user.email, actor_role: user.role, status: 200 });
    return c.json({
      pre_auth_token: await token(c.env, user, 'pre_auth', PRE_AUTH_TTL_S),
      mfa_enabled: !!user.mfa_enabled,
      next: user.mfa_enabled ? 'POST /api/auth/mfa/verify' : 'POST /api/auth/mfa/setup, then /api/auth/mfa/verify',
    });
  });

  app.post('/api/auth/mfa/setup', async (c) => {
    const user = await preAuthUser(c, store);
    if (!user) return c.json({ error: 'Valid pre-auth token required (log in first)' }, 401);
    if (user.mfa_enabled) return c.json({ error: 'MFA already enabled' }, 409);

    const secret = generateSecret();
    await store.users.update(user.id, { totp_secret: encryptSecret(secret, c.env.TOTP_ENC_KEY) });
    const uri = generateURI({ issuer: 'Cognex', label: user.email, secret });
    await audit(store, c, 'mfa_setup_started', { actor_id: user.id, actor_email: user.email, actor_role: user.role, status: 200 });
    return c.json({ secret, otpauth_uri: uri, qr_data_url: await QRCode.toDataURL(uri) });
  });

  app.post('/api/auth/mfa/verify', async (c) => {
    const user = await preAuthUser(c, store);
    if (!user) return c.json({ error: 'Valid pre-auth token required (log in first)' }, 401);
    const { max, windowMs } = limits(c.env);

    if ((await store.audit.countRecent({ event: 'mfa_failed', email: user.email, sinceMs: windowMs })) >= max) {
      await audit(store, c, 'login_rate_limited', { actor_email: user.email, status: 429, details: { step: 'mfa' } });
      return c.json({ error: 'Too many failed attempts. Try again later.' }, 429);
    }

    const { code } = await readJson(c);
    let valid = false;
    if (user.totp_secret && typeof code === 'string' && /^\d{6}$/.test(code)) {
      const secret = decryptSecret(user.totp_secret, c.env.TOTP_ENC_KEY);
      valid = verifySync({ secret, token: code, epochTolerance: 30 }).valid;
    }
    if (!valid) {
      await audit(store, c, 'mfa_failed', { actor_id: user.id, actor_email: user.email, actor_role: user.role, status: 401 });
      return c.json({ error: 'Invalid MFA code' }, 401);
    }

    if (!user.mfa_enabled) {
      await store.users.update(user.id, { mfa_enabled: true });
      await audit(store, c, 'mfa_enabled', { actor_id: user.id, actor_email: user.email, actor_role: user.role, status: 200 });
    }
    await audit(store, c, 'login_success', { actor_id: user.id, actor_email: user.email, actor_role: user.role, status: 200 });
    return c.json({
      token: await token(c.env, user, 'access', ACCESS_TTL_S),
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_S,
      role: user.role,
    });
  });

  app.get('/api/auth/me', requireAuth(store), (c) => {
    const { sub, email, role, exp } = c.get('auth');
    return c.json({ id: sub, email, role, exp });
  });

  return app;
}
