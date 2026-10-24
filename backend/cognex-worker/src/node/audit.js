/**
 * audit.js — append-only audit trail. Never throws: a logging failure must not
 * break a login or a request (but it is reported on stderr).
 */
export function clientIp(c) {
  const xff = c.req.header('x-forwarded-for');
  return (xff ? xff.split(',')[0].trim() : c.req.header('x-real-ip')) || 'unknown';
}

export async function audit(store, c, event, extra = {}) {
  try {
    const a = c.get?.('auth') || null;
    await store.audit.append({
      event,
      actor_id: extra.actor_id ?? a?.sub ?? null,
      actor_email: extra.actor_email ?? a?.email ?? null,
      actor_role: extra.actor_role ?? a?.role ?? null,
      ip: clientIp(c),
      method: c.req.method,
      path: c.req.path,
      status: extra.status ?? null,
      details: extra.details ?? {},
    });
  } catch (err) {
    console.error('audit write failed:', err.message);
  }
}
