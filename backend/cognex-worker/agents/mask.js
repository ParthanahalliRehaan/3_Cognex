/**
 * mask.js — data minimisation before anything leaves the machine for Groq.
 * E-mails and IPs become stable pseudonyms (same input -> same token within a run),
 * so agents can still correlate "the same actor" without ever seeing personal data.
 */
import { createHash, randomBytes } from 'node:crypto';

export function createMasker(salt = randomBytes(8).toString('hex')) {
  const h = (v) => createHash('sha256').update(salt + String(v)).digest('hex').slice(0, 6);
  return {
    user: (email) => (email ? `user_${h(email.toLowerCase())}` : null),
    ip: (ip) => (ip && ip !== 'unknown' ? `ip_${h(ip)}` : null),
  };
}
