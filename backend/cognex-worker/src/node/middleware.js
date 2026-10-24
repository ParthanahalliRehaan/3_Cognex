/**
 * middleware.js — JWT authentication + role-based access control.
 *
 * requireAuth     : valid *access* token (pre-auth tokens from the password step are rejected)
 * requireRole(...): token's role must be in the allowed list
 * auditMutation   : records a successful update/delete in audit_log
 */
import { verify } from 'hono/jwt';
import { audit } from './audit.js';

export const ROLES = ['admin', 'editor', 'viewer'];

export function requireAuth(store) {
  return async (c, next) => {
    const header = c.req.header('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (!token) {
      await audit(store, c, 'request_rejected', { status: 401, details: { reason: 'no_token' } });
      return c.json({ error: 'Authentication required' }, 401);
    }
    try {
      const payload = await verify(token, c.env.JWT_SECRET, 'HS256');
      if (payload.purpose !== 'access') throw new Error('wrong token purpose');
      c.set('auth', payload);
    } catch (err) {
      await audit(store, c, 'request_rejected', { status: 401, details: { reason: 'invalid_token' } });
      return c.json({ error: 'Invalid or expired token' }, 401);
    }
    await next();
  };
}

export function requireRole(store, ...allowed) {
  return async (c, next) => {
    const auth = c.get('auth');
    if (!auth || !allowed.includes(auth.role)) {
      await audit(store, c, 'request_rejected', {
        status: 403,
        details: { reason: 'insufficient_role', required: allowed, had: auth?.role ?? null },
      });
      return c.json({ error: 'Forbidden: insufficient role', required: allowed }, 403);
    }
    await next();
  };
}

export function auditMutation(store, event) {
  return async (c, next) => {
    await next();
    if (c.res.status < 300) {
      await audit(store, c, event, { status: c.res.status, details: { id: c.req.param('id') } });
    }
  };
}
