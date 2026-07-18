# Cognex Architecture (Story, Analogies & Code)

> Built for learning by doing. Every concept explained with real-world stories.

---

## Table of Contents

1. [The Story: Rehaan Ingests Next.js](#1-the-story-rehaan-ingests-nextjs)
2. [Real-World Analogies](#2-real-world-analogies)
3. [Hierarchical Function Trees](#3-hierarchical-function-trees)
4. [API Endpoints Quick Reference](#4-api-endpoints-quick-reference)
5. [Key Concepts Decoded](#5-key-concepts-decoded)
6. [The Three Problems You Raised](#6-the-three-problems-you-raised)

---

## 1. The Story: Rehaan Ingests Next.js

### Step 1: Paste the GitHub URL

Rehaan opens Cognex and types:

```
github.com/vercel/next.js
```

He clicks **"Ingest"**.

---

### Step 2: The Front Door (`index.js`) — The Hotel Receptionist

**What happens:** `POST /api/ingest` hits the Hono router.

```javascript
// index.js
app.post('/api/ingest', async (c) => {
  const { repoUrl } = await c.req.json();
  // Validate URL regex
  // Generate request ID
  // Return 202 Accepted in ~50ms
  c.executionCtx.waitUntil(ingestRepo(repoUrl, env, c.executionCtx));
  return c.json({ status: "accepted", pollEndpoint: "/api/status?repoUrl=" + repoUrl });
});
```

**Analogy:** You drop off your clothes at a dry cleaner. They give you a receipt instantly (**202 Accepted**). The actual cleaning happens while you go shopping.

**Key point:** The browser gets a response in 50ms. The Worker keeps processing in the **background**.

---

### Step 3: The Brain (`rag.js`) Wakes Up

**What happens:** `ingestRepo()` starts running via `ctx.waitUntil()`.

```javascript
// rag.js
async function ingestRepo(repoUrl, env, ctx) {
  updateProgress(repoUrl, 5, "Fetching metadata...");

  // LAZY LOAD: Only import github.js when we actually need it
  const { fetchRepoMetadata, fetchReadme, fetchFileTree, 
          fetchIssues, fetchPullRequests, fetchCommits, 
          fetchContributors, selectFilesForIngestion, fetchFilesBatch } = 
          await import('./github.js');

  // ... fetch everything
  // ... build graph
  // ... embed and store
}
```

**Analogy:** A project manager gets a new project. They don't do the work themselves — they delegate to specialists (GitHub fetcher, graph builder, embedder, DB storer).

---

### Step 4: The Research Assistant (`github.js`) Goes to the Library

**What happens:** Multiple parallel fetches from GitHub API.

```javascript
// github.js
const metadata = await fetchRepoMetadata(repoUrl, token);     // stars, forks, language
const readme = await fetchReadme(repoUrl, token);              // README.md decoded
const fileTree = await fetchFileTree(repoUrl, token);          // all files
const issues = await fetchIssues(repoUrl, token);              // paginated, capped at 100
const prs = await fetchPullRequests(repoUrl, token);           // paginated, capped at 100
const commits = await fetchCommits(repoUrl, token);            // paginated, capped at 100
const contributors = await fetchContributors(repoUrl, token);  // top 30
```

Then the **critical bottleneck**:

```javascript
// github.js — selectFilesForIngestion()
function scoreFile(file) {
  let score = 0;
  if (file.name === 'package.json') score += 100;   // MUST HAVE
  if (file.path.startsWith('src/')) score += 10;    // source code
  if (file.path.includes('test')) score -= 5;       // skip tests
  if (file.size > 8192) return -Infinity;           // 🚨 SKIP FILES >8KB
  return score;
}

// Only top 12 files are selected
const selectedFiles = files.sort((a,b) => scoreFile(b) - scoreFile(a)).slice(0, 12);
```

**Analogy:** A student has 2 hours to study for an exam. They skip the 500-page textbook and only read the syllabus + 3 short articles. They miss the deep stuff.

**🚨 YOUR PROBLEM:** Large files like `next.js` core bundles are skipped entirely. You lose critical code context.

---

### Step 5: The Detective's Evidence Board (`graph.js`)

**What happens:** Raw data is parsed into a structured graph.

```javascript
// graph.js
function buildGraph(rawData) {
  const nodes = [];
  const edges = [];

  // Create nodes
  nodes.push({ type: 'repo', label: rawData.repo.name });
  rawData.files.forEach(f => nodes.push({ type: 'file', label: f.path }));
  rawData.functions.forEach(fn => nodes.push({ type: 'function', label: fn.name }));
  rawData.contributors.forEach(c => nodes.push({ type: 'contributor', label: c.login }));
  rawData.issues.forEach(i => nodes.push({ type: 'issue', label: `#${i.number}` }));
  rawData.prs.forEach(p => nodes.push({ type: 'pr', label: `#${p.number}` }));
  rawData.commits.forEach(c => nodes.push({ type: 'commit', label: c.sha.slice(0,7) }));

  // Create edges
  edges.push({ from: 'repo', to: 'file', relation: 'CONTAINS' });
  edges.push({ from: 'file', to: 'function', relation: 'CONTAINS' });
  edges.push({ from: 'contributor', to: 'commit', relation: 'AUTHORED' });
  edges.push({ from: 'commit', to: 'file', relation: 'MODIFIES' });
  edges.push({ from: 'function', to: 'otherFile', relation: 'IMPORTS' });
  edges.push({ from: 'issue', to: 'file', relation: 'REFERENCES' });
  edges.push({ from: 'pr', to: 'issue', relation: 'FIXES' });
  edges.push({ from: 'contributor', to: 'pr', relation: 'OPENED' });

  // Remove isolated nodes (no connections)
  pruneIsolatedNodes(nodes, edges);

  return { nodes, edges };
}
```

**Analogy:** A detective's evidence board. Photos (nodes) connected by red strings (edges) showing who talked to whom, who wrote what, and what depends on what.

---

### Step 6: The Librarian (`supabase.js`) Files Everything

**What happens:** Atomic replace of old data + storing new vectors.

```javascript
// supabase.js
async function storeCompleteGraph(repoUrl, nodes, edges) {
  const supabase = getSupabaseClient(env, true); // service key = write access

  // 1. Delete old data for this repo
  await supabase.from('graph_edges').delete().eq('repo_url', repoUrl);
  await supabase.from('graph_nodes').delete().eq('repo_url', repoUrl);
  await supabase.from('documents').delete().eq('repo_url', repoUrl);

  // 2. Insert nodes → get back UUIDs
  const { data: insertedNodes } = await supabase.from('graph_nodes')
    .insert(nodes.map(n => ({ ...n, repo_url: repoUrl })))
    .select('id, label');

  // 3. Map edge connections to UUIDs
  const nodeIdMap = new Map(insertedNodes.map(n => [n.label, n.id]));
  const resolvedEdges = edges.map(e => ({
    repo_url: repoUrl,
    source_node_id: nodeIdMap.get(e.from),
    target_node_id: nodeIdMap.get(e.to),
    relation: e.relation
  }));

  // 4. Insert edges
  await supabase.from('graph_edges').insert(resolvedEdges);
}
```

Then embeddings:

```javascript
// embeddings.js → prepareDocuments() → generateEmbeddingsBatch()
const chunks = [
  "Next.js is a React framework...",
  "The App Router uses file-based routing...",
  "useEffect is a React hook...",
  // ... up to 96 chunks per batch
];

// Calls Cohere API: turns text → 1024-dimension vector
const embeddings = await generateEmbeddingsBatch(chunks, cohereApiKey);
// Returns: [{ embedding: [0.023, -0.156, ... 1024 numbers] }, ...]

// Store in Supabase
await storeDocumentsBatch(documents); // auto-splits into 500-row chunks
```

**Analogy:** A librarian throws out old index cards, writes new ones, and files them in the right cabinets. Then they digitize book summaries into a searchable database.

---

### Step 7: Polling — "Is My Pizza Ready Yet?"

After the 202 response, the frontend doesn't know when ingestion finishes. So it asks every 2 seconds:

```javascript
// frontend/app.js
async function pollStatus(repoUrl) {
  while (true) {
    const res = await fetch(`${API_BASE}/api/status?repoUrl=${repoUrl}`);
    const data = await res.json();
    // { status: "processing", progress: 45, nodeCount: 0, docCount: 0 }

    updateProgressBar(data.progress);

    if (data.status === "done") {
      showReadyMessage();
      break; // Stop polling
    }

    await sleep(2000); // Wait 2 seconds, ask again
  }
}
```

**Analogy:** You order a pizza. Every 2 minutes you ask: "Is it ready?" "Is it ready?" "Is it ready?" Until they say "Yes!" Then you stop asking and eat.

---

### Step 8: Rehaan Asks a Question

Rehaan types: **"How does useEffect work in Next.js?"**

**What happens:** `POST /api/ask` → `handleQuery()` runs **synchronously** (not background).

```javascript
// rag.js
async function handleQuery(repoUrl, query, env) {
  // 1. Turn the question into a vector
  const { generateEmbedding } = await import('./embeddings.js');
  const queryEmbedding = await generateEmbedding(query, env.COHERE_API_KEY, true);

  // 2. Search vector DB for similar chunks
  const { matchDocuments } = await import('./supabase.js');
  const similarDocs = await matchDocuments(queryEmbedding, 0.5, 10, repoUrl);
  // Uses HNSW index → O(log n) search, ~50ms

  // 3. Fetch the knowledge graph for context
  const { getGraphForRepo } = await import('./supabase.js');
  const graph = await getGraphForRepo(repoUrl);

  // 4. Fallback to web search if no docs found
  let webResults = [];
  if (similarDocs.length < 1) {
    const { webSearchWithContext } = await import('./search.js');
    webResults = await webSearchWithContext(query, "next.js");
  }

  // 5. Build the system prompt
  const { buildSystemPrompt } = await import('./groq.js');
  const systemPrompt = buildSystemPrompt(similarDocs, graph, webResults);
  // Trimmed to 12K characters max

  // 6. Stream the answer
  const { streamAnswer } = await import('./groq.js');
  return streamAnswer(systemPrompt, query, env);
  // Returns ReadableStream → "The" "useEffect" "hook" "allows" ...
}
```

**Analogy:** You ask a librarian a question. They check their notes (vectors), look at the evidence board (graph), maybe Google if stuck (web fallback), then explain it to you live (streaming).

**⏱️ Total time: 2-5 seconds.** Ingestion took 30-120 seconds, but each question is fast because the hard work was already done.

---

### Step 9: The Visual Graph (`GET /api/graph`)

Rehaan clicks **"Visualize Graph"**. The frontend calls:

```javascript
// GET /api/graph?repoUrl=github.com/vercel/next.js
// Returns:
{
  nodes: [
    { id: "uuid-1", node_type: "repo", label: "next.js" },
    { id: "uuid-2", node_type: "file", label: "src/app.tsx" },
    { id: "uuid-3", node_type: "function", label: "handleQuery" },
    { id: "uuid-4", node_type: "contributor", label: "timneutkens" },
    { id: "uuid-5", node_type: "issue", label: "#42" },
    // ...
  ],
  edges: [
    { source_node_id: "uuid-1", target_node_id: "uuid-2", relation: "CONTAINS" },
    { source_node_id: "uuid-2", target_node_id: "uuid-3", relation: "CONTAINS" },
    { source_node_id: "uuid-4", target_node_id: "uuid-3", relation: "AUTHORED" },
    // ...
  ],
  nodeCount: 156,
  edgeCount: 342
}
```

The frontend feeds this into **Cytoscape.js** — a 2D graph renderer.

| Feature | Reality |
|---------|---------|
| Layout | 2D force-directed (springy physics) |
| Nodes | Colored circles (different colors per type) |
| Edges | Lines with arrows showing relationships |
| Interactive | ✅ Drag nodes, zoom with scroll, click for details |
| 3D? | ❌ No. Flat 2D canvas/SVG only |

**Analogy:** It's like a subway map. Stations (nodes) connected by lines (edges). You can trace routes, see hubs, and understand the network layout.

---

## 2. Real-World Analogies

| Component | Real-World Role | What It Actually Does |
|-----------|----------------|----------------------|
| `index.js` | **Hotel Receptionist** | Takes your request, checks if valid, routes you to the right department. Doesn't do the actual work — just directs traffic. |
| `rag.js` | **Project Manager / Brain** | Decides WHO needs to do WHAT and WHEN. Delegates to specialists. |
| `github.js` | **Research Assistant** | Goes to the library (GitHub API), photocopies everything, brings it back. Smart about what to bring (scores files). |
| `graph.js` | **Detective's Evidence Board** | Pins photos on a board with red strings showing connections. "This function imports that file." |
| `embeddings.js` | **Translator** | Converts text into "meaning numbers" (1024-dim vectors). Similar meanings = similar numbers. |
| `supabase.js` | **Librarian / Filing Cabinet** | Stores everything neatly. Has a special "vector cabinet" where similar items sit close together. |
| `groq.js` | **Expert Speaker / Professor** | Takes all the research and explains it in plain English. Streams word-by-word like thinking out loud. |
| `search.js` | **Emergency Google Search** | Only used when local knowledge is empty. "I don't know, let me Google it." |
| Lazy Loading | **Just-in-Time Delivery** | Only grab the hammer when you need to hammer. Don't carry everything in your backpack all the time. |
| Polling | **"Is my pizza ready yet?"** | Ask every 2 seconds until the answer is "yes." Then stop asking. |
| `ctx.waitUntil()` | **Drop-off Laundry** | Give receipt instantly. Actual work happens while customer goes shopping. |
| HNSW Vector Search | **Library Dewey Decimal System** | Books on similar topics are shelved near each other. Find related books in milliseconds. |

---

## 3. Hierarchical Function Trees

### 📥 INGESTION PIPELINE (Background — runs once per repo)

```
ingestRepo(repoUrl, env, ctx)
│
├─► 1. index.js POST /api/ingest
│      └─► Returns 202 Accepted in ~50ms
│
├─► 2. await import('./github.js')  [LAZY LOAD]
│      │
│      ├─► fetchRepoMetadata(repoUrl, token)
│      │      └─► Returns: { stars, forks, language, topics, description }
│      │
│      ├─► fetchReadme(repoUrl, token)
│      │      └─► Returns: decoded README.md content
│      │
│      ├─► fetchFileTree(repoUrl, token)
│      │      └─► Returns: recursive file listing
│      │
│      ├─► fetchIssues(repoUrl, token)
│      │      └─► Returns: paginated issues (capped at 100)
│      │
│      ├─► fetchPullRequests(repoUrl, token)
│      │      └─► Returns: paginated PRs (capped at 100)
│      │
│      ├─► fetchCommits(repoUrl, token)
│      │      └─► Returns: paginated commits (capped at 100)
│      │
│      ├─► fetchContributors(repoUrl, token)
│      │      └─► Returns: top 30 contributors
│      │
│      ├─► selectFilesForIngestion(fileTree)
│      │      ├─► package.json = 100 pts (highest priority)
│      │      ├─► src files = 10 pts
│      │      ├─► tests = -5 pts (ignored)
│      │      ├─► files >8KB = SKIPPED ❌
│      │      └─► Returns: top 12 files
│      │
│      └─► fetchFilesBatch(paths, concurrency=5)
│             └─► Parallel download (max 5 at once)
│
├─► 3. await import('./graph.js')  [LAZY LOAD]
│      │
│      └─► buildGraph(rawData)
│             ├─► createNodes()
│             │      ├─► repo node
│             │      ├─► file nodes
│             │      ├─► function nodes
│             │      ├─► contributor nodes
│             │      ├─► issue nodes
│             │      ├─► pr nodes
│             │      ├─► commit nodes
│             │      └─► dependency nodes
│             │
│             ├─► createEdges()
│             │      ├─► CONTAINS (repo→file, file→function)
│             │      ├─► AUTHORED (contributor→commit)
│             │      ├─► MODIFIES (commit→file)
│             │      ├─► REFERENCES (issue→file)
│             │      ├─► FIXES (pr→issue)
│             │      ├─► DEPENDS_ON (dependency→repo)
│             │      ├─► OPENED (contributor→pr/issue)
│             │      └─► IMPORTS (file→file, function→file)
│             │
│             ├─► resolveImports()
│             │      └─► Detects import/require across files
│             │
│             └─► pruneIsolatedNodes()
│                    └─► Removes nodes with zero edges
│
├─► 4. await import('./supabase.js')  [LAZY LOAD]
│      │
│      └─► storeCompleteGraph(repoUrl, nodes, edges)
│             ├─► DELETE old graph_nodes for repo
│             ├─► DELETE old graph_edges for repo
│             ├─► DELETE old documents for repo
│             ├─► INSERT nodes → get UUIDs back
│             ├─► resolveEdgeNodeIds() → map labels to UUIDs
│             └─► INSERT edges
│
├─► 5. await import('./embeddings.js')  [LAZY LOAD]
│      │
│      ├─► prepareDocuments(rawTexts)
│      │      ├─► chunkText(readme, chunkSize=512, overlap=50)
│      │      └─► chunkCode(sourceCode, chunkSize=512, overlap=50)
│      │
│      ├─► generateEmbeddingsBatch(chunks, apiKey)
│      │      ├─► LRU cache check (200 items)
│      │      ├─► Deduplicate identical chunks
│      │      └─► Cohere API call (max 96 texts per batch)
│      │
│      └─► storeDocumentsBatch(documents)
│             └─► Auto-split into 500-row chunks (Supabase limit)
│
└─► 6. Progress updated in-memory Map
       └─► getIngestionProgress(repoUrl) → { status, progress, nodeCount, docCount }
```

### ❓ QUERY PIPELINE (Real-time — runs every question)

```
handleQuery(repoUrl, query, env)
│
├─► 1. index.js POST /api/ask
│      └─► Returns ReadableStream (text/plain)
│
├─► 2. prepareQueryEmbedding(query)
│      ├─► await import('./embeddings.js')  [LAZY LOAD]
│      ├─► generateEmbedding(query, apiKey, isQuery=true)
│      └─► Returns: 1024-dim vector
│
├─► 3. matchDocuments(queryEmbedding, threshold=0.5, count=10, filterRepoUrl=repoUrl)
│      ├─► await import('./supabase.js')  [LAZY LOAD]
│      ├─► Calls RPC: match_documents() in Supabase
│      ├─► HNSW index search (O(log n))
│      ├─► Cosine similarity: 1 - (embedding <=> query_embedding)
│      └─► Returns: top 5-10 similar document chunks
│
├─► 4. getGraphForRepo(repoUrl)
│      ├─► SELECT * FROM graph_nodes WHERE repo_url = ...
│      └─► SELECT * FROM graph_edges WHERE repo_url = ...
│
├─► 5. [CONDITIONAL] webSearchWithContext(query, repoName)
│      ├─► ONLY if similarDocs.length < 1
│      ├─► await import('./search.js')  [LAZY LOAD]
│      ├─► webSearch() → Serper.dev Google Search API
│      ├─► TTL cache (5 minutes)
│      └─► formatSearchResults() → for LLM prompt
│
├─► 6. buildSystemPrompt(docs, graph, webResults)
│      ├─► await import('./groq.js')  [LAZY LOAD]
│      ├─► Combines: vector results + graph context + web results
│      └─► Trimmed to 12K characters max
│
└─► 7. streamAnswer(systemPrompt, userQuery, env)
       ├─► Groq API call
       ├─► Model fallback chain:
       │      1. llama-3.3-70b
       │      2. llama-3.1-70b
       │      3. llama-3.1-8b
       │      4. mixtral-8x7b
       ├─► AbortController timeout (30s)
       └─► Returns ReadableStream → chunks flow to browser
```

### 🕸️ GRAPH VISUALIZATION PIPELINE (Read-only)

```
GET /api/graph?repoUrl=...
│
├─► index.js validates repoUrl
├─► rag.js → getGraphForRepo(repoUrl)
│      ├─► supabase.js → getSupabaseClient(env, useServiceKey=false)
│      ├─► SELECT * FROM graph_nodes WHERE repo_url = ...
│      └─► SELECT * FROM graph_edges WHERE repo_url = ...
│
└─► Returns JSON: { nodes, edges, nodeCount, edgeCount }
       │
       └─► Frontend Cytoscape.js renders 2D interactive network
              ├─► Force-directed layout (springy physics)
              ├─► Colored nodes by type
              ├─► Drag to rearrange
              ├─► Scroll to zoom
              └─► Click for details
```

---

## 4. API Endpoints Quick Reference

| Method | Endpoint | Body/Query | Response | Description | Analogy |
|--------|----------|-----------|----------|-------------|---------|
| `GET` | `/health` | — | `{status, service, version, env}` | Health check + key validation | **Doctor's checkup** — quick pulse check |
| `POST` | `/api/ingest` | `{repoUrl}` | `{status: "accepted", pollEndpoint}` | Start background ingestion | **Drop off laundry** — receipt now, cleaning later |
| `POST` | `/api/ask` | `{repoUrl, query}` | `ReadableStream` (text/plain) | Streaming LLM answer | **Ask a professor** — they explain live |
| `GET` | `/api/graph` | `?repoUrl=` | `{nodes, edges, nodeCount, edgeCount}` | Full knowledge graph JSON | **Subway map** — see the network |
| `GET` | `/api/status` | `?repoUrl=` | `{status, progress, nodeCount, docCount}` | Ingestion progress | **"Is my pizza ready?"** |
| `GET` | `/api/stats` | `?repoUrl=` | `{stats: {...}}` | Aggregated metrics | **Dashboard** — summary numbers |

### Response Codes

| Code | Meaning | When |
|------|---------|------|
| `200` | Success | Health check, graph fetch, stats |
| `202` | Accepted | Ingestion started in background |
| `400` | Bad request | Invalid repo URL, empty query |
| `404` | Not found | Unknown endpoint |
| `500` | Server error | Something broke (check requestId) |

### 🧠 Memory Rule

- **Write happens ONCE:** `/api/ingest` writes to DB.
- **Read happens MANY times:** `/api/ask`, `/api/graph`, `/api/status`, `/api/stats` all read from DB.
- **Health is FREE:** `/health` touches nothing. It's just a ping.

---

## 5. Key Concepts Decoded

### What is Lazy Loading?

**Normal (Eager):**
```javascript
// ❌ Loads ALL modules on EVERY cold start
import { fetchRepoMetadata } from './github.js';
import { buildGraph } from './graph.js';
import { generateEmbeddingsBatch } from './embeddings.js';
import { streamAnswer } from './groq.js';
// Even for /health, all 4 modules load into memory
```

**Lazy:**
```javascript
// ✅ Only loads when that code path actually runs
async function ingestRepo() {
  const { fetchRepoMetadata } = await import('./github.js');
  // github.js only loads during ingestion, not during /health
}

async function handleQuery() {
  const { streamAnswer } = await import('./groq.js');
  // groq.js only loads during queries, not during ingestion
}
```

**Why it matters:**

| Scenario | Eager Loading | Lazy Loading |
|----------|--------------|--------------|
| Hit `/health` | Loads ALL 8 modules (~500ms CPU) | Loads only `index.js` (~5ms) |
| Hit `/api/ingest` | Already loaded (wasted earlier) | Loads GitHub, Graph, Embeddings, Supabase |
| Hit `/api/ask` | Already loaded (wasted earlier) | Loads Supabase, Groq, Search |
| Cold start cost | High — pay for modules you don't use | Low — pay only for what you use |

### What is Polling?

After ordering (202 Accepted), the frontend asks every 2 seconds:

```
Frontend: "Done yet?"          Worker: "processing, 25%"
Frontend: "Done yet?"          Worker: "processing, 60%"
Frontend: "Done yet?"          Worker: "processing, 90%"
Frontend: "Done yet?"          Worker: "done, 100%"
Frontend: "Great!" [stops asking]
```

### What is `ctx.waitUntil()`?

Cloudflare Workers have a CPU time limit (50ms on free tier). But `waitUntil()` lets you do work **after** sending the response:

```javascript
app.post('/api/ingest', async (c) => {
  // Send response immediately
  c.json({ status: "accepted" }); // Browser gets this in 50ms

  // But keep working in the background for 30-120 seconds
  c.executionCtx.waitUntil(ingestRepo(repoUrl, env, c.executionCtx));
});
```

**Analogy:** A restaurant takes your order, brings bread immediately (202), but the main course (ingestion) takes 30 minutes to cook in the kitchen.

### What is a Vector / Embedding?

Text → Numbers that capture **meaning**.

```
"How does useEffect work?"     → [0.023, -0.156, 0.891, ..., 0.442]  (1024 numbers)
"useEffect is a React hook"    → [0.019, -0.142, 0.885, ..., 0.438]  (very similar!)
"The weather is nice today"    → [-0.334, 0.712, -0.123, ..., 0.001] (very different)
```

Vector search finds the closest numbers → closest meaning. It's NOT keyword matching.

### What is HNSW?

A special index that makes vector search fast:

| Without HNSW | With HNSW |
|-------------|-----------|
| Compare query against EVERY vector (O(n)) | Jump to the nearest region instantly (O(log n)) |
| 10,000 docs = scan all 10,000 | 10,000 docs = check ~20 |
| ~500ms | ~50ms |

---

## 6. The Three Problems You Raised

### Problem 1: Large Files Are Skipped

**Current behavior:**
```javascript
if (file.size > 8192) return -Infinity; // SKIP
```

**Why this hurts:** Next.js core files are often 20KB-100KB. You miss the actual implementation details.

**Suggested fix — Stream-chunk large files:**
```javascript
// github.js
async function fetchAndChunkLargeFile(filePath, repoUrl, token) {
  const content = await fetchFileContent(filePath, repoUrl, token);

  if (content.length > 8000) {
    // Don't skip — chunk it!
    const { chunkCode } = await import('./embeddings.js');
    return chunkCode(content, chunkSize = 512, overlap = 50);
    // Returns array of chunks instead of single file
  }

  return [content];
}

// Then in prepareDocuments(), flatten all chunks:
const allChunks = files.flatMap(f => f.chunks || [f.content]);
```

**Trade-off:** More API calls to Cohere, but you get the full picture.

---

### Problem 2: Does `/api/ask` Re-Ingest?

**Answer: NO.** `handleQuery()` is read-only.

```javascript
// handleQuery() NEVER calls ingestRepo()
// It ONLY:
// 1. matchDocuments() → READ from DB
// 2. getGraphForRepo() → READ from DB
// 3. webSearchWithContext() → call external API
// 4. streamAnswer() → call external API
```

**If you WANT auto-ingest on first query**, add this:
```javascript
// Inside handleQuery():
const existingDocs = await matchDocuments(queryEmbedding, 0.5, 1, repoUrl);
if (existingDocs.length === 0) {
  // Option A: Just web search (current behavior)
  webResults = await webSearchWithContext(query, repoName);

  // Option B: Trigger background ingest (if you want)
  // ctx.waitUntil(ingestRepo(repoUrl, env, ctx));
  // return { status: "ingesting", message: "Indexing repo, try again in 2 min" };
}
```

---

### Problem 3: Is the Graph 3D?

**Answer: NO. It's 2D.**

| What you might expect | What actually exists |
|----------------------|----------------------|
| Three.js 3D spinning graph | Cytoscape.js 2D force-directed layout |
| VR/AR visualization | Drag, zoom, pan, click nodes |
| Unity/WebGL 3D | SVG/Canvas 2D renderer |

**The `GET /api/graph` endpoint** returns flat JSON. The frontend uses Cytoscape.js:

```javascript
// frontend/app.js
const cy = cytoscape({
  container: document.getElementById('graph-container'),
  elements: [
    // Nodes
    { data: { id: 'n1', label: 'next.js', type: 'repo' } },
    { data: { id: 'n2', label: 'src/app.tsx', type: 'file' } },
    // Edges
    { data: { source: 'n1', target: 'n2', label: 'CONTAINS' } }
  ],
  layout: { name: 'cose', animate: true } // force-directed
});

// Interactive features
cy.on('tap', 'node', (evt) => {
  const node = evt.target;
  showNodeDetails(node.data()); // Click to see info
});
```

**If you WANT 3D**, you'd need to switch to a library like **Force Graph 3D** or **Three.js**. The backend doesn't need to change — it already returns the raw graph data. Only the frontend renderer changes.

---

## Summary Cheat Sheet

| Question | Answer |
|----------|--------|
| Does `ingestRepo()` run when I ask a question? | **No.** Only when you call `/api/ingest`. |
| Does `handleQuery()` re-download the repo? | **No.** It only reads from the DB you already populated. |
| Can I ask questions before ingesting? | **Yes, but** it will only use web search fallback — no repo-specific knowledge. |
| What if I ingest the same repo twice? | `storeCompleteGraph()` **deletes old data first**, then inserts new. So it refreshes. |
| Why lazy load? | Faster cold starts. Don't pay CPU for modules you don't use on that request. |
| What is polling? | Frontend asks "done yet?" every 2s until the answer is "yes." |
| What is the graph for? | Visual exploration of how files, functions, contributors, issues, and PRs connect. |
| Is the graph 3D? | **No.** 2D interactive network map via Cytoscape.js. |

---

*Generated for Cognex Architecture Learning — July 2026*

