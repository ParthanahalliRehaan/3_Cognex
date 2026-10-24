// Grant a role to an existing user (self-registration only creates viewers).
// Usage:  node --env-file=.env scripts/set-role.mjs someone@example.com admin
import { createSupabaseStore } from '../src/node/store.js';

const [email, role] = process.argv.slice(2);
if (!email || !['admin', 'editor', 'viewer'].includes(role)) {
  console.error('Usage: node --env-file=.env scripts/set-role.mjs <email> <admin|editor|viewer>');
  process.exit(1);
}
const store = createSupabaseStore(process.env);
if (!(await store.users.findByEmail(email.toLowerCase()))) { console.error('No such user. Register first.'); process.exit(1); }
await store.users.setRole(email.toLowerCase(), role);
console.log(`${email} is now ${role}`);
