/** Fake attack logs (relative to "now") used by evals and tests. No real data. */
const T = (secondsAgo) => new Date(Date.now() - secondsAgo * 1000).toISOString();
const row = (secondsAgo, event, o = {}) => ({ ts: T(secondsAgo), event, actor_email: null, actor_role: null, ip: '192.0.2.1', status: null, ...o });

export function bruteForce() {
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push(row(300 - i * 2, 'login_failed', { actor_email: 'victim@university.edu', ip: '203.0.113.50', status: 401 }));
  rows.push(row(200, 'login_rate_limited', { actor_email: 'victim@university.edu', ip: '203.0.113.50', status: 429 }));
  rows.push(...normalNoise(3));
  return rows;
}

export function insiderMassDelete() {
  const rows = [row(900, 'login_success', { actor_email: 'bob@university.edu', actor_role: 'admin', ip: '198.51.100.7', status: 200 })];
  for (let i = 0; i < 30; i++) rows.push(row(240 - i * 6, 'nodes_delete', { actor_email: 'bob@university.edu', actor_role: 'admin', ip: '198.51.100.7', status: 200 }));
  for (let i = 0; i < 3; i++) rows.push(row(40 - i * 5, 'documents_delete', { actor_email: 'bob@university.edu', actor_role: 'admin', ip: '198.51.100.7', status: 200 }));
  rows.push(...normalNoise(3));
  return rows;
}

export function normalNoise(n = 8) {
  const rows = [];
  for (let i = 0; i < n; i++) rows.push(row(800 - i * 90, 'login_success', { actor_email: `student${i}@university.edu`, actor_role: 'viewer', ip: `198.18.0.${10 + i}`, status: 200 }));
  return rows;
}

export function normalTraffic() {
  return [
    ...normalNoise(8),
    row(500, 'login_failed', { actor_email: 'student1@university.edu', ip: '198.18.0.11', status: 401 }),   // typo
    row(480, 'login_failed', { actor_email: 'student4@university.edu', ip: '198.18.0.14', status: 401 }),   // typo
    row(400, 'request_rejected', { actor_email: 'student2@university.edu', actor_role: 'viewer', ip: '198.18.0.12', status: 403 }),
    row(300, 'nodes_update', { actor_email: 'editor@university.edu', actor_role: 'editor', ip: '198.18.0.50', status: 200 }),
    row(200, 'nodes_delete', { actor_email: 'admin@university.edu', actor_role: 'admin', ip: '198.18.0.60', status: 200 }),
  ];
}

export const FIXTURES = {
  brute_force: { build: bruteForce, expect: 'brute_force_attacker' },
  insider_mass_delete: { build: insiderMassDelete, expect: 'malicious_insider' },
  normal: { build: normalTraffic, expect: 'none' },
};
