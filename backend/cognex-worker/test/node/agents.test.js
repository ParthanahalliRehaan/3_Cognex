import { describe, it, expect } from 'vitest';
import { runMonitor } from '../../agents/graph.js';
import { aggregate } from '../../agents/aggregate.js';
import { FIXTURES } from '../../agents/evals/fixtures.js';

const IPV4 = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;

describe('security-monitor agents', () => {
  it('masks e-mails and IPs before anything reaches the model', async () => {
    const seen = [];
    const llm = { model: 'fake', complete: async (system, user) => { seen.push(user); return { text: '[]', usage: null }; } };
    for (const fx of Object.values(FIXTURES)) await runMonitor(fx.build(), { llm });
    expect(seen.length).toBeGreaterThan(0);
    for (const prompt of seen) {
      expect(prompt).not.toContain('@');
      expect(prompt).not.toMatch(IPV4);
      expect(prompt).not.toContain('university.edu');
    }
  });

  it('flags the brute-force burst', async () => {
    const r = await runMonitor(FIXTURES.brute_force.build());
    expect(r.incidents.some((i) => i.threat_actor === 'brute_force_attacker' && i.severity === 'high')).toBe(true);
  });

  it('flags the insider mass-delete', async () => {
    const r = await runMonitor(FIXTURES.insider_mass_delete.build());
    expect(r.incidents.some((i) => i.threat_actor === 'malicious_insider')).toBe(true);
  });

  it('stays quiet on normal traffic', async () => {
    const r = await runMonitor(FIXTURES.normal.build());
    expect(r.incidents).toHaveLength(0);
    expect(r.report).toMatch(/No incidents/);
  });

  it('drops hallucinated actors and invalid enums from the LLM', async () => {
    const llm = {
      model: 'fake',
      complete: async (system) => {
        if (system.includes('log-analyst')) return { text: JSON.stringify([{ actor: 'user_ghost', pattern: 'mass_delete', evidence: 'x' }]), usage: null };
        return { text: '[]', usage: null };
      },
    };
    const r = await runMonitor(FIXTURES.normal.build(), { llm });
    expect(r.findings).toHaveLength(0);
  });

  it('aggregate() output contains no raw identifiers', () => {
    const s = JSON.stringify(aggregate(FIXTURES.brute_force.build()));
    expect(s).not.toContain('@');
    expect(s).not.toMatch(IPV4);
  });
});
