/**
 * aggregate.js — turns raw audit rows into a small, masked, per-actor feature table.
 * This is the ONLY representation of the log the LLM agents ever see.
 */
import { createMasker } from './mask.js';

const empty = () => ({
  login_failed: 0, mfa_failed: 0, login_success: 0, rate_limited: 0,
  rejected_401: 0, rejected_403: 0, deletes: 0, updates: 0,
  first_ts: null, last_ts: null, peers: new Set(),
});

function bump(map, key, row, fn, peer) {
  if (!key) return;
  const a = map.get(key) || empty();
  fn(a);
  const t = new Date(row.ts).getTime();
  a.first_ts = a.first_ts === null ? t : Math.min(a.first_ts, t);
  a.last_ts = a.last_ts === null ? t : Math.max(a.last_ts, t);
  if (peer) a.peers.add(peer);
  map.set(key, a);
}

const classify = (row) => (a) => {
  switch (row.event) {
    case 'login_failed': a.login_failed++; break;
    case 'mfa_failed': a.mfa_failed++; break;
    case 'login_success': a.login_success++; break;
    case 'login_rate_limited': a.rate_limited++; break;
    case 'request_rejected': (row.status === 403 ? a.rejected_403++ : a.rejected_401++); break;
    default:
      if (row.event?.endsWith('_delete')) a.deletes++;
      else if (row.event?.endsWith('_update')) a.updates++;
  }
};

export function aggregate(rows, { masker = createMasker() } = {}) {
  const byUser = new Map();
  const byIp = new Map();
  for (const r of rows) {
    const u = masker.user(r.actor_email);
    const i = masker.ip(r.ip);
    bump(byUser, u, r, classify(r), i);
    bump(byIp, i, r, classify(r), u);
  }
  const fmt = (kind) => ([id, a]) => ({
    actor: id, kind,
    login_failed: a.login_failed, mfa_failed: a.mfa_failed, login_success: a.login_success,
    rate_limited: a.rate_limited, rejected_401: a.rejected_401, rejected_403: a.rejected_403,
    deletes: a.deletes, updates: a.updates,
    active_seconds: Math.round((a.last_ts - a.first_ts) / 1000),
    distinct_counterparts: a.peers.size,
  });
  const interesting = (x) =>
    x.login_failed + x.mfa_failed + x.rate_limited + x.rejected_401 + x.rejected_403 + x.deletes > 0;
  const actors = [
    ...[...byUser].map(fmt('account')),
    ...[...byIp].map(fmt('ip')),
  ].filter(interesting)
   .sort((a, b) => (b.login_failed + b.deletes + b.rejected_403) - (a.login_failed + a.deletes + a.rejected_403))
   .slice(0, 15);

  const times = rows.map((r) => new Date(r.ts).getTime());
  return {
    total_events: rows.length,
    window_seconds: rows.length ? Math.round((Math.max(...times) - Math.min(...times)) / 1000) : 0,
    actors,
  };
}
