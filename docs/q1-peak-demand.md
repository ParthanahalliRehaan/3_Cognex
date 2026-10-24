# Q1(a): Peak demand (rewrite in your own words if you like)

**Situation.** Cognex lets students explore a GitHub repository as a knowledge graph. Just before a class assignment deadline, hundreds of students open the same course repository's graph within a few minutes: a short, spiky rush.

**Hardest-hit API.** `GET /api/graph?repoUrl=...`. The frontend calls it on every page load and refresh; each call runs two parallel Supabase reads (nodes and edges). It is read-heavy and identical across users. `/api/ask` is bounded by Groq quotas and `/api/ingest` is a one-off per repository, so the graph endpoint is what grows with the number of students.

# Q1(d): Why cloud bursting

The rush is short and spiky. Sizing three local containers for the *normal* day and sending only the overflow to the already-deployed Cloudflare Worker means we pay for burst capacity only while the spike lasts, reuse a deployment that exists since Assignment 1, and keep the local stack small. Implemented in `nginx/nginx.burst.conf`: `limit_conn` caps concurrent local requests (503 beyond that) and `error_page 502 503 504 = @burst` replays them against the Worker (`X-Served-By: cloud-burst` header shows which path answered). Failover also falls through to the Worker if all three local backends are down.
