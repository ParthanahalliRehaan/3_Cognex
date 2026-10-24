# BACSE344 DA3: Cognex (report skeleton)

GitHub: https://github.com/ParthanahalliRehaan/3_Cognex/tree/assignment-3 · Demo video: <link>

## Q1: Scale
### (a) Peak demand + 3 instances
Paragraph: see `docs/q1-peak-demand.md`.  
Screenshots: `evidence/q1/a-docker-ps.png`, `a-curl-rotation.png`, `a-nginx-log.png`

### (b) Load test (hey, 1,000 requests, concurrency 50, median of 3 runs)
Paste the table printed by `node perf/run.mjs summarize`.  
Note: a shared laptop and Supabase latency cap the speedup, so the gain is below 3x.

### (c) Failover
Paste the failover table. Before = `nginx.3.conf` (default); after = `nginx.3.failover.conf` (`proxy_next_upstream error timeout http_502 http_503`, `max_fails=1 fail_timeout=10s`, `proxy_connect_timeout 1s`).

### (d) Architecture diagram
`docs/q1-architecture.png` + paragraph from `docs/q1-peak-demand.md`.

## Q2: Secure
### (a) Sensitive data + bcrypt: DB screenshots before (`q2a_before_demo.sql`) and after (`users` with `$2b$10$...`)
### (b) MFA + roles: Authenticator screenshot; 401 without token; 403 wrong role; 200 right role. Security tests: `npm run test:security`.
### (c) Trivy: paste `node scripts/trivy.mjs table`; screenshots of both scans.
### (d) Threat agents + GDPR: `docs/q2-threat-model.md`.
### Extra: audit log + security-monitor agents (Langfuse trace screenshot, eval table from `npm run agents:eval`).

## Known limits
`/api/status` keeps progress in memory (inconsistent across 3 instances, excluded from tests) · speedup limited by laptop + Supabase · Worker deployment has no auth · agent monitor is advisory only.
