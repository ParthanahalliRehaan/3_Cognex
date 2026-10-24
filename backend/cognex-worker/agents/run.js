/**
 * CLI: run the security monitor over the real audit_log (read-only) or a fixture.
 *   node --env-file=.env agents/run.js --window-min 60
 *   node --env-file=.env agents/run.js --fixture brute_force
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { runMonitor } from './graph.js';
import { createGroqLlm } from './llm.js';
import { createTracer } from './tracing.js';
import { createSupabaseStore } from '../src/node/store.js';
import { FIXTURES } from './evals/fixtures.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const fixture = arg('fixture');
const windowMin = Number(arg('window-min', 60));

let rows;
if (fixture) {
  if (!FIXTURES[fixture]) { console.error(`Unknown fixture. Options: ${Object.keys(FIXTURES).join(', ')}`); process.exit(1); }
  rows = FIXTURES[fixture].build();
} else {
  // READ-ONLY: only the listRecent function is handed over; the monitor never sees the store.
  const store = createSupabaseStore(process.env);
  rows = await store.audit.listRecent({ sinceMs: windowMin * 60_000 });
}

const llm = createGroqLlm();
const tracer = createTracer('security-monitor-run', { source: fixture || `audit_log:${windowMin}m`, events: rows.length });
const res = await runMonitor(rows, { llm, tracer });
await tracer.finish({ incidents: res.incidents.length, mode: res.mode });

console.log(`mode=${res.mode}  events=${rows.length}  incidents=${res.incidents.length}${tracer.url ? `  trace=${tracer.url}` : ''}\n`);
console.log(res.report);
mkdirSync(new URL('./reports/', import.meta.url), { recursive: true });
const file = new URL(`./reports/${new Date().toISOString().replace(/[:.]/g, '-')}.md`, import.meta.url);
writeFileSync(file, `${res.report}\n\n<!-- mode=${res.mode} -->\n`);
console.log(`\nSaved ${file.pathname.split('/').pop()}`);
