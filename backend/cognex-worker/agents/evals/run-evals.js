/**
 * Evals: do the agents flag the brute-force burst and the insider mass-delete,
 * and stay quiet on normal traffic?   npm run agents:eval
 * Uses Groq when GROQ_API_KEY is set (mode=llm), otherwise the rule fallback (mode=heuristic).
 * Scores are pushed to Langfuse when its keys are set.
 */
import { runMonitor } from '../graph.js';
import { createGroqLlm } from '../llm.js';
import { createTracer } from '../tracing.js';
import { FIXTURES } from './fixtures.js';

const llm = createGroqLlm();
let failed = 0;
const table = [];

for (const [name, fx] of Object.entries(FIXTURES)) {
  const tracer = createTracer(`eval:${name}`, { fixture: name });
  const res = await runMonitor(fx.build(), { llm, tracer });
  const hit = res.incidents.filter((i) => i.threat_actor === fx.expect && ['high', 'critical'].includes(i.severity));
  const pass = fx.expect === 'none' ? res.incidents.length === 0 : hit.length > 0;
  tracer.score('eval_pass', pass ? 1 : 0, `${name} expected ${fx.expect}`);
  await tracer.finish({ pass, incidents: res.incidents.length });
  table.push({ fixture: name, expected: fx.expect, mode: res.mode, incidents: res.incidents.length, pass: pass ? 'PASS' : 'FAIL' });
  if (!pass) { failed++; console.error(`\n[${name}] FAILED\n`, JSON.stringify(res.classified, null, 2), res.notes); }
}

console.table(table);
if (!llm) console.log('(no GROQ_API_KEY set: this run exercised the rule-based fallback, not the LLM agents)');
process.exit(failed ? 1 : 0);
