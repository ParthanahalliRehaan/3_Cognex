# Using CURL
I'll set you up with both **immediate curl commands** you can copy-paste right now, and a **downloadable Python test runner** that exercises every endpoint. For a small repo, I recommend **`https://github.com/chalk/chalk`** — it's tiny (~5 source files + package.json) but has enough structure to actually build a meaningful graph.

---

### Quick Copy-Paste Test (curl)

```bash
# 1. Health check
curl http://127.0.0.1:8787/health | jq .

# 2. Ingest a small repo
curl -X POST http://127.0.0.1:8787/api/ingest \
  -H "Content-Type: application/json" \
  -d '{"repoUrl":"https://github.com/chalk/chalk"}' | jq .

# 3. Poll status until done (run every 2s)
curl "http://127.0.0.1:8787/api/status?repoUrl=https://github.com/chalk/chalk" | jq .

# 4. Fetch the graph
curl "http://127.0.0.1:8787/api/graph?repoUrl=https://github.com/chalk/chalk" | jq '.nodeCount, .edgeCount'

# 5. Fetch stats
curl "http://127.0.0.1:8787/api/stats?repoUrl=https://github.com/chalk/chalk" | jq .

# 6. Ask a question (streams back text)
curl -N -X POST http://127.0.0.1:8787/api/ask \
  -H "Content-Type: application/json" \
  -d '{"repoUrl":"https://github.com/chalk/chalk","query":"What are the main dependencies?"}'
```

---

### Automated Test Script

Here's a Python script that runs the full flow automatically — health → ingest → poll → graph → stats → ask:
Download the test runner here: **[test_cognex_api.py](sandbox:///mnt/agents/output/test_cognex_api.py)**

```bash
# Install requests if you haven't
pip install requests

# Run it
python test_cognex_api.py
```

---

### What the script does (step by step)

| Step | Endpoint | What it checks |
|------|----------|----------------|
| 1 | `GET /health` | Backend is alive, env vars loaded |
| 2 | `POST /api/ingest` | Kicks off ingestion for `chalk/chalk` |
| 3 | `GET /api/status` (polls) | Waits until background ingestion finishes |
| 4 | `GET /api/graph` | Verifies nodes & edges were stored |
| 5 | `GET /api/stats` | Checks contributors, deps, file counts |
| 6 | `POST /api/ask` | Streams an answer to a real question |

---

### Even smaller alternatives

If `chalk/chalk` still feels too heavy for a first test, swap the `REPO` variable to one of these:

| Repo | Why |
|------|-----|
| `https://github.com/octocat/Hello-World` | 1 file, instant ingest |
| `https://github.com/sindresorhus/is` | Tiny JS util, has `package.json` |
| `https://github.com/ai/nanoid` | Small, has deps & tests |

Just change the `REPO` line at the top of the script.

---

### If you don't have Python handy

Use this one-liner bash loop instead:

```bash
REPO="https://github.com/chalk/chalk"

# Ingest
curl -s -X POST http://127.0.0.1:8787/api/ingest \
  -H "Content-Type: application/json" \
  -d "{\"repoUrl\":\"$REPO\"}" | jq .

# Poll until done
while true; do
  STATUS=$(curl -s "http://127.0.0.1:8787/api/status?repoUrl=$REPO" | jq -r '.status')
  echo "Status: $STATUS"
  [[ "$STATUS" == "done" ]] && break
  sleep 2
done

# Graph summary
curl -s "http://127.0.0.1:8787/api/graph?repoUrl=$REPO" | jq '{nodes: .nodeCount, edges: .edgeCount}'
```
# POSTMAN
Yes — Postman has a **web version** that runs entirely in your browser. No download needed.

**URL:** [https://web.postman.com](https://web.postman.com)

---

### Quick setup for your Cognex backend

**Step 1 — Create a free account** (Google/GitHub login works)

**Step 2 — Create a Workspace**
- Click **Workspaces** → **Create Workspace** → name it `Cognex` → **Create Workspace**

**Step 3 — Create a Collection**
- Click **Collections** → **+** (Create Collection) → name it `Cognex API`

**Step 4 — Add your requests**

Click **Add Request** inside the collection. Set these up:

| Request | Method | URL |
|---------|--------|-----|
| `Health` | `GET` | `http://127.0.0.1:8787/health` |
| `Ingest` | `POST` | `http://127.0.0.1:8787/api/ingest` |
| `Status` | `GET` | `http://127.0.0.1:8787/api/status?repoUrl=https://github.com/chalk/chalk` |
| `Graph` | `GET` | `http://127.0.0.1:8787/api/graph?repoUrl=https://github.com/chalk/chalk` |
| `Stats` | `GET` | `http://127.0.0.1:8787/api/stats?repoUrl=https://github.com/chalk/chalk` |
| `Ask` | `POST` | `http://127.0.0.1:8787/api/ask` |

**For POST requests** (`Ingest` and `Ask`):
- Click the **Body** tab → select **raw** → pick **JSON** from the dropdown
- Paste your JSON:
  ```json
  // For Ingest
  {"repoUrl": "https://github.com/chalk/chalk"}

  // For Ask
  {"repoUrl": "https://github.com/chalk/chalk", "query": "What are the main dependencies?"}
  ```

**Step 5 — Hit Send**

Click the blue **Send** button on any request. The response appears in the bottom panel.

---

### ⚠️ One catch with the web version

Since Postman Web runs in your browser, calling `http://127.0.0.1:8787` (your local backend) might be blocked by **CORS** or browser security policies.

**If you get a "Network Error" or CORS error:**

1. **Use the Postman Desktop app instead** ([postman.com/downloads](https://www.postman.com/downloads)) — it has no CORS restrictions
2. **Or** install the **Postman Agent** — a tiny bridge app that the web version uses to talk to localhost. Postman will prompt you to install it automatically when you try a localhost URL.

---

### Bottom line

- **Postman Web:** [web.postman.com](https://web.postman.com) — works in browser, may need Agent for localhost
- **Postman Desktop:** [postman.com/downloads](https://www.postman.com/downloads) — no CORS issues, recommended for local backends like yours

I'd go with the **desktop app** since your backend is running locally. It's the same interface, just without the localhost headaches.