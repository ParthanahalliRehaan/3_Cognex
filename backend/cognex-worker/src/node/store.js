/**
 * store.js — persistence for users + audit_log.
 *
 * Two interchangeable implementations with the same interface:
 *   createSupabaseStore(env)  -> real tables from migration 004 (used by server.js)
 *   createMemoryStore()       -> in-memory (used by the vitest security tests)
 */
import { randomUUID } from 'node:crypto';
import { getSupabaseClient } from '../supabase.js';

// ─── In-memory (tests) ─────────────────────────────────────────────────────
export function createMemoryStore() {
  const users = new Map();     // id -> user
  const audit = [];            // rows
  return {
    kind: 'memory',
    users: {
      async findByEmail(email) {
        return [...users.values()].find((u) => u.email === email) || null;
      },
      async create({ email, password_hash, role = 'viewer' }) {
        const u = { id: randomUUID(), email, password_hash, role, totp_secret: null, mfa_enabled: false, created_at: new Date().toISOString() };
        users.set(u.id, u);
        return { ...u };
      },
      async update(id, fields) {
        const u = users.get(id);
        if (!u) return null;
        Object.assign(u, fields);
        return { ...u };
      },
      async setRole(email, role) {
        const u = [...users.values()].find((x) => x.email === email);
        if (u) u.role = role;
      },
      _all: () => [...users.values()],
    },
    audit: {
      async append(evt) {
        const row = { id: randomUUID(), ts: new Date().toISOString(), ...evt };
        audit.push(row);
        return row;
      },
      async countRecent({ event, email = null, ip = null, sinceMs }) {
        const since = Date.now() - sinceMs;
        return audit.filter((r) =>
          r.event === event &&
          new Date(r.ts).getTime() >= since &&
          ((email && r.actor_email === email) || (ip && r.ip === ip))).length;
      },
      async listRecent({ sinceMs, limit = 2000 }) {
        const since = Date.now() - sinceMs;
        return audit.filter((r) => new Date(r.ts).getTime() >= since).slice(-limit);
      },
      _all: () => audit,
    },
  };
}

// ─── Supabase ────────────────────────────────────────────────────────────────
export function createSupabaseStore(env) {
  const db = getSupabaseClient(env, true); // service key: tables have RLS on, no public policies
  const fail = (what, error) => { throw new Error(`${what}: ${error.message}`); };

  return {
    kind: 'supabase',
    users: {
      async findByEmail(email) {
        const { data, error } = await db.from('users').select('*').eq('email', email).maybeSingle();
        if (error) fail('users.findByEmail', error);
        return data;
      },
      async create({ email, password_hash, role = 'viewer' }) {
        const { data, error } = await db.from('users').insert({ email, password_hash, role }).select().single();
        if (error) fail('users.create', error);
        return data;
      },
      async update(id, fields) {
        const { data, error } = await db.from('users').update(fields).eq('id', id).select().single();
        if (error) fail('users.update', error);
        return data;
      },
      async setRole(email, role) {
        const { error } = await db.from('users').update({ role }).eq('email', email);
        if (error) fail('users.setRole', error);
      },
    },
    audit: {
      async append(evt) {
        const { error } = await db.from('audit_log').insert(evt);
        if (error) fail('audit.append', error);
      },
      async countRecent({ event, email = null, ip = null, sinceMs }) {
        const since = new Date(Date.now() - sinceMs).toISOString();
        const ors = [];
        if (email) ors.push(`actor_email.eq.${email}`);
        if (ip) ors.push(`ip.eq.${ip}`);
        if (!ors.length) return 0;
        const { count, error } = await db.from('audit_log')
          .select('*', { count: 'exact', head: true })
          .eq('event', event).gte('ts', since).or(ors.join(','));
        if (error) fail('audit.countRecent', error);
        return count || 0;
      },
      async listRecent({ sinceMs, limit = 2000 }) {
        const since = new Date(Date.now() - sinceMs).toISOString();
        const { data, error } = await db.from('audit_log').select('*')
          .gte('ts', since).order('ts', { ascending: true }).limit(limit);
        if (error) fail('audit.listRecent', error);
        return data || [];
      },
    },
  };
}
