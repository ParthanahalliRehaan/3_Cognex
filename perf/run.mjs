// Cross-platform load-test runner (Windows/macOS/Linux). Needs Docker + Node. No local `hey` install:
// hey runs inside a container on the compose network, hitting nginx directly.
//
//   REPO_URL=https://github.com/OWNER/REPO node perf/run.mjs load
//   REPO_URL=...  node perf/run.mjs failover before     # default nginx config
//   REPO_URL=...  node perf/run.mjs failover after      # failover config
//   node perf/run.mjs summarize                         # markdown tables from perf/results/*
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const RESULTS = new URL('./results/', import.meta.url);
mkdirSync(RESULTS, { recursive: true });
const N = 1000, C = 50;
const sh = (cmd, args, env = {}) =>
  execFileSync(cmd, args, { env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = () => {
  if (!process.env.REPO_URL) { console.error('Set REPO_URL to an already-ingested repo, e.g. https://github.com/chalk/chalk'); process.exit(1); }
  return `http://nginx/api/graph?repoUrl=${process.env.REPO_URL}`;
};
const heyArgs = (extra) => ['run', '--rm', '--network', 'cognex_default', 'williamyeh/hey', ...extra, url()];
const useNginx = (conf) => { sh('docker', ['compose', 'up', '-d', '--force-recreate', 'nginx'], { NGINX_CONF: conf }); };

async function waitHealthy(name) {
  for (let i = 0; i < 30; i++) {
    const s = sh('docker', ['inspect', '-f', '{{.State.Health.Status}}', name]).trim();
    if (s === 'healthy') return;
    await sleep(2000);
  }
}

export function parseHey(text) {
  const num = (re) => { const m = text.match(re); return m ? Number(m[1]) : null; };
  const ok = num(/\[200\]\s+(\d+) responses/) || 0;
  return {
    rps: num(/Requests\/sec:\s+([\d.]+)/),
    avg_ms: num(/Average:\s+([\d.]+) secs/) * 1000,
    p95_ms: num(/95% in ([\d.]+) secs/) * 1000,
    ok, failed: N - ok,
  };
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

async function load() {
  for (const inst of [1, 3]) {
    console.log(`\n=== ${inst} instance(s) ===`);
    useNginx(`nginx.${inst}.conf`);
    await sleep(3000);
    sh('docker', heyArgs(['-n', '100', '-c', '10']));            // warm-up (not recorded)
    for (let run = 1; run <= 3; run++) {
      const out = sh('docker', heyArgs(['-n', String(N), '-c', String(C)]));
      writeFileSync(new URL(`load-${inst}inst-run${run}.txt`, RESULTS), out);
      const r = parseHey(out);
      console.log(`run ${run}: ${r.rps} req/s, avg ${r.avg_ms.toFixed(1)} ms, p95 ${r.p95_ms.toFixed(1)} ms, failed ${r.failed}`);
    }
  }
  summarize();
}

async function failover(which) {
  const conf = which === 'after' ? 'nginx.3.failover.conf' : 'nginx.3.conf';
  console.log(`\n=== failover test (${which}) with ${conf} ===`);
  sh('docker', ['start', 'cognex-backend2']); await waitHealthy('cognex-backend2');
  useNginx(conf); await sleep(3000);
  sh('docker', heyArgs(['-n', '100', '-c', '10']));
  // -q 2 per worker x 50 workers = ~100 req/s -> test lasts ~10 s; -t 5 = 5 s client timeout
  const chunks = [];
  const hey = spawn('docker', heyArgs(['-n', String(N), '-c', String(C), '-q', '2', '-t', '5']));
  hey.stdout.on('data', (d) => chunks.push(d));
  await sleep(3000);
  console.log('>>> docker stop cognex-backend2 (mid-test)');
  sh('docker', ['stop', 'cognex-backend2']);
  await new Promise((r) => hey.on('close', r));
  const out = Buffer.concat(chunks).toString();
  writeFileSync(new URL(`failover-${which}.txt`, RESULTS), out);
  const r = parseHey(out);
  console.log(`failed requests: ${r.failed} of ${N}  (ok: ${r.ok})`);
  sh('docker', ['start', 'cognex-backend2']); await waitHealthy('cognex-backend2');
  summarize();
}

function summarize() {
  const files = readdirSync(RESULTS);
  const read = (f) => parseHey(readFileSync(new URL(f, RESULTS), 'utf8'));
  const agg = (inst) => {
    const runs = files.filter((f) => f.startsWith(`load-${inst}inst-run`)).map(read);
    if (!runs.length) return null;
    return { rps: median(runs.map((r) => r.rps)), avg: median(runs.map((r) => r.avg_ms)), p95: median(runs.map((r) => r.p95_ms)), failed: median(runs.map((r) => r.failed)) };
  };
  const a = agg(1), b = agg(3);
  if (a && b) {
    console.log(`\n### Q1(b) load test: ${N} requests, concurrency ${C}, median of 3 runs\n`);
    console.log('| Instances | Requests/sec | Avg latency (ms) | p95 (ms) | Failed |\n|---|---|---|---|---|');
    console.log(`| 1 | ${a.rps.toFixed(1)} | ${a.avg.toFixed(1)} | ${a.p95.toFixed(1)} | ${a.failed} |`);
    console.log(`| 3 | ${b.rps.toFixed(1)} | ${b.avg.toFixed(1)} | ${b.p95.toFixed(1)} | ${b.failed} |`);
    console.log(`\nThroughput improvement: ${((b.rps / a.rps - 1) * 100).toFixed(0)}%  (${(b.rps / a.rps).toFixed(2)}x) · Avg latency change: ${((b.avg / a.avg - 1) * 100).toFixed(0)}%`);
  }
  if (files.includes('failover-before.txt') || files.includes('failover-after.txt')) {
    console.log('\n### Q1(c) failover: backend2 stopped mid-test\n\n| Config | Failed requests | Successful |\n|---|---|---|');
    for (const w of ['before', 'after']) if (files.includes(`failover-${w}.txt`)) { const r = read(`failover-${w}.txt`); console.log(`| ${w} | ${r.failed} / ${N} | ${r.ok} |`); }
  }
}

const cmd = process.argv[2];
if (cmd === 'load') await load();
else if (cmd === 'failover') await failover(process.argv[3] === 'after' ? 'after' : 'before');
else if (cmd === 'summarize') summarize();
else console.log('usage: node perf/run.mjs load | failover before|after | summarize');
