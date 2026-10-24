// Scan a local image with Trivy (runs Trivy in Docker, nothing to install) and count CRITICAL/HIGH.
//   node scripts/trivy.mjs cognex-backend:before before
//   node scripts/trivy.mjs cognex-backend:hardened after
//   node scripts/trivy.mjs table
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const OUT = new URL('../docs/evidence/q2/', import.meta.url);
mkdirSync(OUT, { recursive: true });

function count(report) {
  const seen = new Map();
  for (const r of report.Results || []) for (const v of r.Vulnerabilities || []) {
    seen.set(`${v.VulnerabilityID}|${v.PkgName}|${v.InstalledVersion}`, v.Severity);
  }
  const c = { CRITICAL: 0, HIGH: 0 };
  for (const s of seen.values()) if (s in c) c[s]++;
  return c;
}

const [a, b] = process.argv.slice(2);
if (a === 'table') {
  console.log('| Image | CRITICAL | HIGH |\n|---|---|---|');
  for (const label of ['before', 'after']) {
    const f = new URL(`trivy-${label}.json`, OUT);
    if (existsSync(f)) { const c = count(JSON.parse(readFileSync(f, 'utf8'))); console.log(`| ${label} | ${c.CRITICAL} | ${c.HIGH} |`); }
  }
} else if (a && b) {
  const json = execFileSync('docker', ['run', '--rm', '-v', '/var/run/docker.sock:/var/run/docker.sock', '-v', 'cognex-trivy-cache:/root/.cache/',
    'aquasec/trivy:latest', 'image', '--quiet', '--scanners', 'vuln', '--severity', 'CRITICAL,HIGH', '--format', 'json', a],
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  writeFileSync(new URL(`trivy-${b}.json`, OUT), json);
  console.log(`${a}:`, count(JSON.parse(json)));
  console.log('For the screenshot, also run:  docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:latest image --severity CRITICAL,HIGH ' + a);
} else console.log('usage: node scripts/trivy.mjs <image> <before|after>   |   node scripts/trivy.mjs table');
