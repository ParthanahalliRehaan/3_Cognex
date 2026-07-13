# 🧠 Cognex — Build Instructions (Steps 7–13)

> **Continue from:** Build Status as of 2026-07-11 19:12  
> **Completed before this:** Project scaffold, Supabase setup, Cloudflare Worker, `github.js` (8 functions, tested)

---

## 📁 Target File Structure (Backend)

```
cognex/backend/cognex-worker/src/
├── index.js          ← Worker entry point (HTTP routes)
├── github.js         ✅ COMPLETE (from previous session)
├── graph.js          ← STEP 7
├── embeddings.js     ← STEP 8
├── supabase.js       ← STEP 9
├── groq.js           ← STEP 10
├── search.js         ← STEP 11
└── rag.js            ← STEP 12
```

---

## STEP 7: `graph.js` — Knowledge Graph Engine

### What It Does
Transforms raw GitHub API data into a structured knowledge graph with **typed nodes** (entities) and **typed edges** (relationships). This is the foundation for the entire RAG system.

### Required Exports
```javascript
export {
  NODE_TYPES,           // { FILE, FUNCTION, CONTRIBUTOR, ISSUE, PR, COMMIT, DEPENDENCY, REPO }
  EDGE_TYPES,           // { CONTAINS, AUTHORED, MODIFIES, REFERENCES, FIXES, DEPENDS_ON, OPENED, CREATED, HAS_FILE, HAS_ISSUE, HAS_PR, HAS_COMMIT, HAS_CONTRIBUTOR }
  classifyFile,         // (filename) → 'code' | 'config' | 'doc' | 'other'
  extractFunctions,     // (content, language) → [{ name, type, line }]
  extractDependencies,  // (filename, content) → [{ name, version, type }]
  buildKnowledgeGraph,  // (data) → { nodes, edges, stats, repoNodeId }
  // + all individual builder functions for testing
  buildFileNodes, buildFunctionNodes, buildContributorNodes,
  buildIssueNodes, buildPRNodes, buildCommitNodes,
  buildDependencyNodes, buildRepoNode,
};
```

### Node Types to Build

| Type | Properties |
|------|-----------|
| `file` | `path`, `fullPath`, `extension`, `size`, `sha`, `classification`, `repo` |
| `function` | `name`, `functionType`, `filePath`, `line`, `repo` |
| `contributor` | `username`, `avatarUrl`, `profileUrl`, `contributions`, `repo` |
| `issue` | `number`, `title`, `state`, `labels`, `body` (trimmed), `url`, `createdAt`, `author`, `repo` |
| `pr` | `number`, `title`, `state`, `body` (trimmed), `url`, `createdAt`, `author`, `merged`, `repo` |
| `commit` | `sha`, `message`, `author`, `authorLogin`, `date`, `url`, `repo` |
| `dependency` | `name`, `version`, `depType`, `repo` |
| `repo` | `owner`, `name`, `fullName` |

### Edge Types to Build

| Edge | Description |
|------|-------------|
| `file CONTAINS function` | Code file contains extracted function |
| `contributor AUTHORED commit` | Contributor wrote commit |
| `commit MODIFIES file` | Commit message mentions file path |
| `issue REFERENCES file` | Issue title/body mentions filename |
| `pr FIXES issue` | PR body mentions issue number |
| `file DEPENDS_ON dependency` | Config file lists package |
| `contributor OPENED issue` | Issue author is known contributor |
| `contributor CREATED pr` | PR author is known contributor |
| `repo HAS_FILE file` | Root relationship |
| `repo HAS_ISSUE issue` | Root relationship |
| `repo HAS_PR pr` | Root relationship |
| `repo HAS_COMMIT commit` | Root relationship |
| `repo HAS_CONTRIBUTOR contributor` | Root relationship |

### Function Extraction Requirements
- Support languages: **JS, TS, Python, Go, Rust, Ruby, Java, C, C++**
- Use regex-based extraction (no AST parsing — keep it lightweight for Workers)
- Extract: `function`, `arrow function`, `class`, `method`, `interface`, `type` (TS), `struct`, `enum`, `trait` (Rust), `module` (Ruby), etc.
- Return: `{ name: string, type: string, line: number }`
- Deduplicate by `name:line`

### Dependency Extraction Requirements
- **`package.json`** → parse `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`
- **`requirements.txt`** → parse `package==version`, `package>=version`, bare package names
- **`Cargo.toml`** → parse `[dependencies]` section
- **`go.mod`** → parse `require ()` blocks and single-line `require`
- Return: `{ name: string, version: string, type: 'runtime'|'dev'|'peer'|'optional' }`

### File Classification
- **Code extensions:** `.js`, `.ts`, `.jsx`, `.tsx`, `.py`, `.go`, `.rs`, `.rb`, `.java`, `.c`, `.cpp`, and 30+ more
- **Config extensions:** `.json`, `.yaml`, `.yml`, `.toml`, `.ini`, `.env`, `.lock`
- **Doc extensions:** `.md`, `.mdx`, `.rst`, `.txt`, `.adoc`
- Default: `'other'`

### Node ID Format
```javascript
function nodeId(type, key) {
  return `${type}:${key}`;
}
// Examples:
// "file:vercel/next.js:package.json"
// "function:vercel/next.js:src/index.js:fetchData:42"
// "contributor:vercel/next.js:rauchg"
```

### Edge ID Format
```javascript
function buildEdge(sourceId, targetId, type) {
  return {
    id: `edge:${sourceId}->${targetId}:${type}`,
    source: sourceId,
    target: targetId,
    type,
    properties: {},
  };
}
```

### `buildKnowledgeGraph(data)` Input Shape
```javascript
{
  owner: string,           // e.g. "vercel"
  repo: string,            // e.g. "next.js"
  tree: Array,             // from github.getRepoTree() — filter type==='blob'
  contributors: Array,     // from github.getRepoContributors()
  issues: Array,           // from github.getRepoIssues()
  prs: Array,              // from github.getRepoPullRequests()
  commits: Array,          // from github.getRepoCommits()
  fileContents: Object,    // { filePath: contentString } — for code/dep analysis
}
```

### `buildKnowledgeGraph(data)` Output Shape
```javascript
{
  nodes: Array,            // deduplicated by id
  edges: Array,            // deduplicated by id
  stats: {
    totalNodes: number,
    totalEdges: number,
    byNodeType: { [type]: count },
    byEdgeType: { [type]: count },
  },
  repoNodeId: string,      // root repo node id
}
```

### Deduplication Rules
- Nodes: Use `Map` keyed by `node.id`
- Edges: Use `Map` keyed by `edge.id`

---

## STEP 8: `embeddings.js` — Embedding Service

### What It Does
Generates 384-dimensional vector embeddings for text content using Hugging Face's free Inference API with `sentence-transformers/all-MiniLM-L6-v2`.

### Required Exports
```javascript
export {
  EMBEDDING_DIMENSION,    // 384
  generateEmbedding,      // (text, hfApiKey?) → Promise<number[]>
  generateEmbeddingsBatch,// (items, hfApiKey?) → Promise<Array<{id, embedding}>>
  generateNodeEmbeddings, // (nodes, hfApiKey?) → Promise<Array<{nodeId, embedding, text}>>
  generateQueryEmbedding, // (query, hfApiKey?) → Promise<number[]>
  buildNodeEmbeddingText, // (node) → string — builds descriptive text per node type
  cosineSimilarity,       // (a, b) → number
  dotProduct,             // (a, b) → number
  chunkText,              // (text, maxChars?) → string[]
  preprocessText,         // (text) → string
};
```

### API Endpoint
```
POST https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2
Content-Type: application/json
Body: { "inputs": "text to embed" }
```

- API key is **optional** (free tier works without key but rate-limited)
- If provided, send `Authorization: Bearer {hfApiKey}`
- Response: either a single vector `number[]` or batch `number[][]`

### Text Preprocessing
1. Collapse whitespace: `/\s+/g → ' '`
2. Strip non-printable chars (keep ASCII printable + newlines)
3. Trim
4. Hard cap at 5000 chars

### Chunking Strategy
- Max chars per chunk: **512**
- Split on sentence boundaries (`/[.!?]+/`)
- If a single sentence exceeds limit, truncate
- For multi-chunk texts, average the embedding vectors element-wise

### Node Embedding Text Builder

Build descriptive text per node type for semantic search:

| Node Type | Embedding Text |
|-----------|---------------|
| `file` | `File: {path}. Type: {classification}.` |
| `function` | `Function {name} in {filePath} (line {line}). Type: {functionType}.` |
| `contributor` | `Contributor {username} with {contributions} contributions.` |
| `issue` | `Issue #{number}: {title}. State: {state}. Labels: {labels}.` |
| `pr` | `PR #{number}: {title}. State: {state}. Merged: {merged}.` |
| `commit` | `Commit by {author}: {message}` (first 200 chars) |
| `dependency` | `Dependency: {name} version {version}. Type: {depType}.` |
| `repo` | `Repository: {fullName}. Owner: {owner}.` |

### Batch Processing
- Process in batches of **5** to avoid rate limits
- Use `Promise.all()` within each batch, sequential batches

---

## STEP 9: `supabase.js` — Database Client

### What It Does
Persistence layer for graph nodes, edges, and document embeddings. Wraps `@supabase/supabase-js` with domain-specific CRUD and search operations.

### Required Exports
```javascript
export {
  createSupabaseClient,   // (url, key) → SupabaseClient
  storeNodes,             // (supabase, nodes, repoFullName) → Promise
  storeEdges,             // (supabase, edges, repoFullName) → Promise
  storeDocuments,         // (supabase, embeddings, repoFullName) → Promise
  searchDocuments,        // (supabase, queryEmbedding, repoFullName, threshold?, count?) → Promise<Array>
  getNodesByRepo,         // (supabase, repoFullName, nodeType?) → Promise<Array>
  getEdgesByRepo,         // (supabase, repoFullName, edgeType?) → Promise<Array>
  getNodeNeighbors,       // (supabase, nodeId) → Promise<{outgoing, incoming}>
  getFullGraph,           // (supabase, repoFullName) → Promise<{nodes, edges}>
  deleteRepoData,         // (supabase, repoFullName) → Promise
};
```

### Supabase Schema (Already Created via 001_init.sql)

#### `graph_nodes` table
| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` | Primary key — node id from graph.js |
| `repo` | `text` | Repository full name |
| `node_type` | `text` | Node type |
| `label` | `text` | Display label |
| `properties` | `jsonb` | Full properties object |
| `created_at` | `timestamptz` | Auto |

#### `graph_edges` table
| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` | Primary key — edge id from graph.js |
| `repo` | `text` | Repository full name |
| `source` | `text` | Source node id |
| `target` | `text` | Target node id |
| `edge_type` | `text` | Edge type |
| `properties` | `jsonb` | Edge properties |
| `created_at` | `timestamptz` | Auto |

#### `documents` table
| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` | Primary key — maps to node id |
| `repo` | `text` | Repository full name |
| `content` | `text` | Text content |
| `embedding` | `vector(384)` | pgvector — 384 dimensions |
| `metadata` | `jsonb` | Extra metadata |
| `created_at` | `timestamptz` | Auto |

#### `match_documents` RPC Function
```sql
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(384),
  match_threshold float,
  match_count int,
  repo_filter text
)
RETURNS TABLE(
  id text,
  content text,
  similarity float,
  metadata jsonb
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id,
    content,
    1 - (documents.embedding <=> query_embedding) AS similarity,
    metadata
  FROM documents
  WHERE repo = repo_filter
    AND 1 - (documents.embedding <=> query_embedding) > match_threshold
  ORDER BY documents.embedding <=> query_embedding
  LIMIT match_count;
$$;
```

### Upsert Strategy
- Use `.upsert(rows, { onConflict: 'id' })` for all tables
- This allows re-ingesting the same repo without duplicates

### Neighbor Query
- **Outgoing:** `graph_edges.source = nodeId`, join `graph_nodes` on `target`
- **Incoming:** `graph_edges.target = nodeId`, join `graph_nodes` on `source`

### Delete Strategy
- Delete in order: `graph_edges` → `graph_nodes` → `documents`
- All filtered by `repo = repoFullName`

---

## STEP 10: `groq.js` — LLM Inference Client

### What It Does
Thin wrapper around Groq API for fast LLM inference. Handles chat completions with streaming, configurable parameters, and context assembly from retrieved graph data.

### Required Exports
```javascript
export {
  createGroqClient,       // (apiKey) → Groq client
  DEFAULT_MODEL,           // 'llama-3.1-8b-instant'
  FALLBACK_MODEL,        // 'llama-3.1-70b-versatile'
  buildSystemPrompt,      // (repoFullName, extraContext?) → string
  assembleContext,        // (retrievedNodes, retrievedDocs, maxChars?) → string
  chatCompletion,         // (groq, messages, config?) → Promise<string>
  streamChatCompletion,   // (groq, messages, config?) → AsyncGenerator<string>
  answerQuestion,         // (groq, query, repoFullName, contextData, config?) → Promise<string>
  streamAnswer,           // (groq, query, repoFullName, contextData, config?) → AsyncGenerator<string>
};
```

### Default Config
```javascript
{
  temperature: 0.3,      // Low creativity for factual answers
  top_p: 0.9,
  max_tokens: 2048,
  stream: true,
  model: 'llama-3.1-8b-instant',
}
```

### Base System Prompt
```
You are Cognex, an AI assistant that answers questions about GitHub repositories by analyzing their knowledge graph, code, issues, and documentation.

You have access to:
- Repository file structure and contents
- Function definitions and their relationships
- Contributors and their activity
- Issues, pull requests, and commits
- Dependencies and package information

Answer concisely but thoroughly. When referencing code, use backticks. When referencing contributors, use @mentions. When referencing issues/PRs, use #number format.

If you don't have enough context to answer confidently, say so clearly.
```

### Context Assembly Rules
1. **Graph nodes section** first — formatted per type:
   - `FILE: {path} ({classification}, {size} bytes)`
   - `FUNCTION: {name} in {filePath}:{line} ({functionType})`
   - `CONTRIBUTOR: @{username} — {contributions} contributions`
   - `ISSUE #{number}: {title} [{state}] — {body}` (first 300 chars)
   - `PR #{number}: {title} [{state}] — {body}` (first 300 chars)
   - `COMMIT {sha}: {message}` (first 200 chars) `by {author}`
   - `DEPENDENCY: {name}@{version} ({depType})`

2. **Documents section** second — joined with `

---

`

3. **Trimming priority:** If context > `maxChars` (default 12000):
   - Keep all graph data
   - Trim documents section
   - If still too long, trim graph data itself

### Streaming Format
- Use `async function*` generator
- Yield each `chunk.choices[0]?.delta?.content` string
- Non-streaming: collect all chunks and join

---

## STEP 11: `search.js` — Web Search Augmentation

### What It Does
External web search using Serper.dev (Google Search API). Falls back to web search when RAG context is insufficient.

### Required Exports
```javascript
export {
  webSearch,              // (query, apiKey, config?) → Promise<Array<{title, link, snippet, source, date}>>
  searchRepoInfo,         // (repoFullName, apiKey, query?) → Promise<Array>
  searchPackageInfo,      // (packageName, apiKey) → Promise<Array>
  searchIssueSolutions,   // (issueTitle, repoFullName, apiKey) → Promise<Array>
  formatSearchContext,    // (results, maxResults?) → string
};
```

### API Details
```
POST https://google.serper.dev/search
Headers:
  X-API-KEY: {apiKey}
  Content-Type: application/json
Body:
  { "q": query, "num": 5, "gl": "us", "hl": "en" }
```

### Response Parsing
- Read `data.organic` array
- Map each result to: `{ title, link, snippet, source: domain, date }`

### Context Formatting
```
## External Web Search Results
[1] {title}
Source: {source}
{snippet}

[2] {title}
Source: {source}
{snippet}
```
- Default `maxResults`: 3
- Join with `

`

---

## STEP 12: `rag.js` — Agentic RAG Orchestrator

### What It Does
Central pipeline that orchestrates the entire retrieval and generation flow. Makes decisions about retrieval strategy based on query intent.

### Required Exports
```javascript
export {
  runRAG,                 // (deps) → AsyncGenerator<string> — streaming answer
  runRAGSync,             // (deps) → Promise<string> — non-streaming
  detectIntent,           // (query) → string[] — e.g. ['contributor', 'dependency']
  retrieveGraphNodes,     // (supabase, query, repoFullName, intents) → Promise<Array>
  retrieveDocuments,      // (supabase, query, repoFullName, hfApiKey) → Promise<Array>
  retrieveNeighbors,      // (supabase, nodes, maxNeighbors?) → Promise<Array>
  prioritizeContext,      // (nodes, docs, query, maxNodes?, maxDocs?) → { nodes, docs }
  buildFinalContext,      // (nodes, docs, webResults?) → context object
  summarizeText,          // (text, maxLength?) → string
};
```

### Intent Detection Patterns

| Intent | Regex Pattern |
|--------|--------------|
| `contributor` | `/contributor\|author\|who.*wrote\|who.*made\|who.*created/i` |
| `dependency` | `/depend\|package\|library\|npm\|requirement\|import/i` |
| `issue` | `/issue\|bug\|problem\|error\|fix/i` |
| `pr` | `/pull request\|pr\|merge/i` |
| `commit` | `/commit\|change\|history\|when.*added\|when.*removed/i` |
| `file` | `/file\|where.*located\|path\|directory\|folder/i` |
| `function` | `/function\|method\|class\|definition\|how.*work/i` |
| `overview` | `/what.*is\|overview\|summary\|about\|describe/i` |

- Default intent: `['general']`
- Multiple intents can match

### Retrieval Strategy

1. **Graph nodes by intent:**
   - Map intent → node type (`contributor` → `contributor`, etc.)
   - Fetch only matching types via `getNodesByRepo(supabase, repo, type)`
   - General queries: fetch mix of files (30), contributors (10), issues (10)

2. **Semantic documents:**
   - Generate query embedding → call `match_documents` RPC
   - Threshold: 0.5, Count: 10

3. **Multi-hop neighbors:**
   - For top 5 nodes, fetch neighbors (outgoing + incoming)
   - Deduplicate, limit to 20 total

### Context Prioritization
1. Score nodes/docs by keyword overlap with query words (>2 chars)
2. Sort by score descending
3. Keep top `maxNodes` (default 15) and `maxDocs` (default 5)

### Web Search Fallback
- Trigger when: `nodes.length < 3 && docs.length < 2`
- Only if `config.useWebSearch !== false`
- Query format: `{query} {repoFullName}`
- Wrap in try/catch — don't fail if search errors

### Context Engineering
- Summarize `body` fields to 300 chars
- Summarize `message` fields to 200 chars
- Summarize document content to 400 chars
- Use extractive summarization: first sentence + key sentences up to limit

### `runRAG(deps)` Input Shape
```javascript
{
  supabase: SupabaseClient,
  groq: GroqClient,
  query: string,           // User question
  repoFullName: string,    // e.g. "vercel/next.js"
  hfApiKey: string|null,   // Hugging Face key (optional)
  serperApiKey: string|null, // Serper key (optional)
  config: {                // Optional overrides
    temperature?: number,
    top_p?: number,
    max_tokens?: number,
    model?: string,
    useWebSearch?: boolean,  // default true
  }
}
```

---

## STEP 13: `index.js` — Worker Entry Point

### What It Does
Cloudflare Worker HTTP API. Defines routes, wires all modules together, handles CORS and error boundaries.

### Required Routes

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `POST` | `/api/ingest` | `handleIngest` | Build & store graph from GitHub repo |
| `POST` | `/api/ask` | `handleAsk` | Stream AI answer via SSE |
| `GET` | `/api/graph/:repo` | `handleGraph` | Get full graph JSON |
| `GET` | `/api/health` | `handleHealth` | Health check |
| `OPTIONS` | `*` | CORS preflight | Handle CORS |

### CORS Headers
```javascript
{
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}
```

### Environment Variables (Secrets)

| Variable | Required | Source |
|----------|----------|--------|
| `SUPABASE_URL` | ✅ | Supabase Project Settings → API |
| `SUPABASE_ANON_KEY` | ✅ | Supabase Project Settings → API |
| `GROQ_API_KEY` | ✅ | Groq Console |
| `GITHUB_TOKEN` | ✅ | GitHub Settings → PAT (classic) with `repo`, `read:user` |
| `WEB_SEARCH_API_KEY` | ✅ | Serper.dev |
| `HF_API_KEY` | ❌ | Hugging Face (optional, free tier works without) |

Set via: `wrangler secret put <NAME>`

For local dev: create `.dev.vars` file in worker root.

### Ingest Pipeline (`POST /api/ingest`)

1. Parse body: `{ owner, repo }`
2. Dynamic import `github.js`
3. Parallel fetch: `tree`, `contributors`, `issues`, `prs`, `commits`
4. Fetch file contents for key files:
   - `package.json`, `requirements.txt`, `Cargo.toml`, `go.mod`
   - Top 50 code files by extension (`.js`, `.ts`, `.py`, `.go`, `.rs`, `.rb`, `.java`)
   - Limit to 50 to avoid rate limits
5. Build knowledge graph via `buildKnowledgeGraph()`
6. Generate embeddings via `generateNodeEmbeddings()`
7. Create Supabase client
8. Delete existing repo data via `deleteRepoData()`
9. Store: `storeNodes()` → `storeEdges()` → `storeDocuments()`
10. Return `{ success, repo, stats, message }`

### Ask Pipeline (`POST /api/ask`)

1. Parse body: `{ repo, query, config? }`
2. Create Supabase + Groq clients
3. Set up SSE stream (`ReadableStream` with `text/event-stream`)
4. Call `runRAG()` with all dependencies
5. Yield each chunk as: `data: {"text": "..."}\n\n`
6. End with: `data: {"done": true}\n\n`
7. Error handling: yield `data: {"error": "..."}\n\n`

### Response Format
- Success: `{ status: 200, ...data }`
- Error: `{ status: 400/404/500, error: "message" }`
- All JSON responses include CORS headers

### Error Handling
- Top-level try/catch in `fetch()` handler
- Log errors with `[Worker Error]` prefix
- Return 500 with `{ error: error.message }`

---

## Updated `wrangler.jsonc`

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "cognex-worker",
  "main": "src/index.js",
  "compatibility_date": "2026-07-13",
  "compatibility_flags": ["nodejs_compat"],
  "vars": {
    // Public vars only — secrets set via wrangler secret put
  }
}
```

> **Note:** `compatibility_flags: ["nodejs_compat"]` is required for `createClient` from `@supabase/supabase-js` to work in Workers.

---

## Updated `package.json`

```json
{
  "name": "cognex-worker",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "scripts": {
    "deploy": "wrangler deploy",
    "dev": "wrangler dev",
    "start": "wrangler dev",
    "test": "node test/test-github.js && node test/test-graph.js",
    "test:graph": "node test/test-graph.js"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.39.0",
    "ai": "^3.0.0",
    "groq-sdk": "^0.3.0"
  },
  "devDependencies": {
    "dotenv": "^16.3.0",
    "wrangler": "^3.0.0"
  }
}
```

---

## Test File: `test/test-graph.js`

### Test Coverage Required

1. **`classifyFile()`**
   - Test: `src/index.js` → `'code'`
   - Test: `package.json` → `'config'`
   - Test: `README.md` → `'doc'`
   - Test: `Dockerfile` → `'other'`

2. **`extractFunctions()`**
   - JS code: detect `function`, `arrow function`, `class`, methods
   - Python code: detect `def`, `class`, `async def`
   - Verify: returns `{ name, type, line }[]`
   - Verify: deduplication works

3. **`extractDependencies()`**
   - `package.json`: parse all dependency sections
   - `requirements.txt`: parse various version specifiers
   - Verify: returns `{ name, version, type }[]`

4. **`buildKnowledgeGraph()`**
   - Use mock data with all node types
   - Verify: all expected node types present
   - Verify: all expected edge types present
   - Verify: stats object correct
   - Verify: deduplication (no duplicate ids)

### Mock Data Structure
```javascript
{
  owner: 'vercel',
  repo: 'next.js',
  tree: [
    { type: 'blob', path: 'package.json', size: 1500, sha: 'abc' },
    { type: 'blob', path: 'src/index.js', size: 2000, sha: 'def' },
    { type: 'blob', path: 'README.md', size: 3000, sha: 'ghi' },
    { type: 'tree', path: 'src', sha: 'mno' }, // filtered out
  ],
  contributors: [
    { login: 'rauchg', contributions: 500, avatar_url: '...', html_url: '...' },
  ],
  issues: [
    { number: 1, title: 'Bug', state: 'open', labels: [{name:'bug'}], body: '...', created_at: '...', user: {login:'rauchg'}, html_url: '...' },
  ],
  prs: [
    { number: 42, title: 'Fix', state: 'closed', body: 'Closes #1', created_at: '...', user: {login:'leerob'}, merged: true, html_url: '...' },
  ],
  commits: [
    { sha: 'abc123', commit: { message: 'Fix...', author: {name:'Guillermo', date:'...'} }, author: {login:'rauchg'}, html_url: '...' },
  ],
  fileContents: {
    'package.json': '{...}',
    'src/index.js': 'function fetchData() {...}',
  },
}
```

---

## Build Checklist

- [ ] STEP 7: `graph.js` — all node/edge builders, extraction functions, `buildKnowledgeGraph()`
- [ ] STEP 8: `embeddings.js` — HF API calls, chunking, batching, vector utilities
- [ ] STEP 9: `supabase.js` — CRUD operations, semantic search, graph traversal
- [ ] STEP 10: `groq.js` — streaming, context assembly, system prompts
- [ ] STEP 11: `search.js` — Serper API, formatting, repo-aware queries
- [ ] STEP 12: `rag.js` — intent detection, multi-hop retrieval, context engineering
- [ ] STEP 13: `index.js` — HTTP routes, ingest pipeline, SSE streaming, error handling
- [ ] `wrangler.jsonc` — update compatibility_date, add nodejs_compat flag
- [ ] `package.json` — add `"type": "module"`, test scripts
- [ ] `test/test-graph.js` — unit tests for graph module
- [ ] `.dev.vars` — local environment variables for testing
- [ ] Set wrangler secrets for production

---

## Deployment Commands

```bash
# Navigate to worker directory
cd cognex/backend/cognex-worker

# Install dependencies
npm install

# Set secrets (one by one, paste values when prompted)
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put GROQ_API_KEY
wrangler secret put GITHUB_TOKEN
wrangler secret put WEB_SEARCH_API_KEY
wrangler secret put HF_API_KEY  # optional

# Deploy
wrangler deploy

# Test ingest
curl -X POST https://your-worker.workers.dev/api/ingest \
  -H "Content-Type: application/json" \
  -d '{"owner":"vercel","repo":"next.js"}'

# Test Q&A (streaming)
curl -X POST https://your-worker.workers.dev/api/ask \
  -H "Content-Type: application/json" \
  -d '{"repo":"vercel/next.js","query":"What are the main dependencies?"}'

# Get graph data
curl https://your-worker.workers.dev/api/graph/vercel%2Fnext.js
```

---

## Next Phase: Frontend

After backend is deployed and tested, build the Cloudflare Pages frontend with:

1. **Repo Input Form** — URL input, ingest button with progress
2. **Graph Visualization** — D3.js force-directed or Cytoscape.js
   - Color nodes by type
   - Click to inspect properties
   - Zoom/pan controls
3. **Chat Interface** — Question input, streaming response display
   - Markdown rendering for answers
   - Code syntax highlighting
   - Source citations (which nodes were used)
4. **Stats Dashboard** — Node counts, contributor leaderboard, dependency tree

---

*End of Instructions — Build one file at a time, test as you go, commit after each step.*
