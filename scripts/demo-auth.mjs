// Interactive evidence helper for Q2(b): register -> login -> MFA (QR image saved) -> role checks.
//   node scripts/demo-auth.mjs                 (BASE defaults to http://localhost, i.e. through Nginx)
//   $env:BASE="http://localhost:3001"; $env:EMAIL="viewer@example.com"; $env:PASSWORD="StrongPass123"; node scripts/demo-auth.mjs
import { createInterface } from 'node:readline/promises';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost';
const EMAIL = process.env.EMAIL || 'viewer@example.com';
const PASSWORD = process.env.PASSWORD || 'StrongPass123';
const FAKE_ID = '11111111-1111-4111-8111-111111111111';

const call = async (path, { method = 'GET', body, token } = {}) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json, instance: r.headers.get('x-instance-id') };
};
const show = (label, r) => console.log(`${label.padEnd(46)} -> HTTP ${r.status}  ${JSON.stringify(r.json)?.slice(0, 110)}`);

console.log(`Target: ${BASE}   user: ${EMAIL}\n`);
show('register', await call('/api/auth/register', { method: 'POST', body: { email: EMAIL, password: PASSWORD } }));
const login = await call('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
show('login (password step)', { ...login, json: { ...login.json, pre_auth_token: '<hidden>' } });
if (login.status !== 200) process.exit(1);
const pre = login.json.pre_auth_token;

if (!login.json.mfa_enabled) {
  const setup = await call('/api/auth/mfa/setup', { method: 'POST', token: pre });
  mkdirSync('docs/evidence/q2', { recursive: true });
  writeFileSync('docs/evidence/q2/mfa-qr.png', Buffer.from(setup.json.qr_data_url.split(',')[1], 'base64'));
  console.log('\nQR saved to docs/evidence/q2/mfa-qr.png: open it, scan it with Google/Microsoft Authenticator.');
  console.log(`(manual entry key: ${setup.json.secret})\n`);
}
const rl = createInterface({ input: process.stdin, output: process.stdout });
const wrong = await call('/api/auth/mfa/verify', { method: 'POST', token: pre, body: { code: '000000' } });
show('mfa/verify with a WRONG code', wrong);
const code = await rl.question('Enter the 6-digit code from the app: ');
rl.close();
const ok = await call('/api/auth/mfa/verify', { method: 'POST', token: pre, body: { code: code.trim() } });
show('mfa/verify with the right code', { ...ok, json: { ...ok.json, token: ok.json?.token ? '<jwt hidden>' : undefined } });
if (ok.status !== 200) process.exit(1);
const token = ok.json.token;

console.log(`\nYour role: ${ok.json.role}\n`);
show('PUT    /api/nodes/:id  with NO token', await call(`/api/nodes/${FAKE_ID}`, { method: 'PUT', body: { label: 'x' } }));
show('DELETE /api/nodes/:id  with NO token', await call(`/api/nodes/${FAKE_ID}`, { method: 'DELETE' }));
show(`PUT    /api/nodes/:id  as ${ok.json.role}`, await call(`/api/nodes/${FAKE_ID}`, { method: 'PUT', token, body: { label: 'x' } }));
show(`DELETE /api/nodes/:id  as ${ok.json.role}`, await call(`/api/nodes/${FAKE_ID}`, { method: 'DELETE', token }));
console.log('\n401 = no token, 403 = wrong role, 404 "Node not found" = passed the guard (the fake id does not exist).');
