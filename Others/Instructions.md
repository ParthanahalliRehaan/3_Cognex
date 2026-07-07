# 🧠 Cognex — Build Your Own Knowledge Graph + Agentic RAG System

> **Role:** You are a student developer. I am your teacher. I will tell you **what** to build and **why**, but **not how**. Every time you need to write code, I will point you to the official documentation. You read it, understand it, and build it yourself. That is how real developers grow.

---

## 🎯 What You Will Build

A full-stack application that:
1. Takes a GitHub repository URL as input.
2. Extracts the repo's README, code files, issues, PRs, and commits.
3. Builds a **Knowledge Graph** (nodes = files, functions, contributors, issues; edges = relationships like "function calls", "contributor committed to").
4. Generates **embeddings** using the free `BAAI/bge-large-en-v1.5` model and stores them in **Supabase pgvector**.
5. Lets users ask questions ("doubts") about the repo.
6. Uses **Agentic RAG** to retrieve relevant graph nodes + embeddings, optionally searches the web, and generates a streaming answer via **Groq API**.
7. Displays everything on a clean frontend hosted on **Cloudflare Pages**.

---

## 🏗️ Tech Stack (Non-Negotiable)

| Layer          | Technology                          |
|----------------|-------------------------------------|
| **Frontend**   | Cloudflare Pages (HTML, CSS, JS)    |
| **Backend**    | Cloudflare Workers (Node.js)        |
| **Database**   | Supabase (Postgres + pgvector)      |
| **Embeddings** | BAAI/bge-large-en-v1.5              |
| **Inference**  | Groq API                            |
| **Search**     | Web Search integration              |

---

## 📁 Project Folder Structure

Create this exact structure. Every file has a purpose. Do not skip any.

```
cognex/
├── frontend/                    # Cloudflare Pages site
│   ├── index.html               # Main page: input repo URL + chat UI
│   ├── style.css                # All your styles
│   ├── app.js                   # Frontend logic: fetch API, render graph, stream answers
│   └── assets/                  # Any images or icons
│
├── backend/                     # Cloudflare Worker
│   ├── src/
│   │   ├── index.js             # Worker entry point — routes all requests
│   │   ├── github.js            # GitHub API client: fetch repo data
│   │   ├── graph.js             # Knowledge Graph builder: nodes + edges
│   │   ├── embeddings.js        # Embedding generation via Transformers.js
│   │   ├── supabase.js          # Supabase client: store/fetch vectors + graph
│   │   ├── rag.js               # Agentic RAG orchestrator
│   │   ├── groq.js              # Groq API client: streaming chat completions
│   │   └── search.js            # Web search integration
│   ├── wrangler.toml            # Cloudflare Worker config
│   └── package.json             # Worker dependencies
│
├── supabase/
│   └── migrations/
│       └── 001_init.sql         # Database schema: tables, pgvector, functions
│
└── README.md                    # Your project notes
```

---

## 🔧 Step-by-Step Build Instructions

---

### ✅ STEP 1: Initialize the Root Project Folder

**What to do:**

```bash
mkdir cognex
cd cognex
```

**Why:** This is your monorepo. Everything lives here. Keeping frontend and backend separate but in one root folder makes deployment and mental model clean.

---

### ✅ STEP 2: Set Up the Cloudflare Worker (Backend)

**What to do:**

```bash
mkdir backend
cd backend
```

Now you need to scaffold a Cloudflare Worker project. Do not guess the commands.

**Go read this first:**
- 📖 [Cloudflare Workers — Get Started Guide (CLI)](https://developers.cloudflare.com/workers/get-started/guide/) citeweb_search:1#4

**Then run:**

```bash
npm create cloudflare@latest -- cognex-worker
```

During setup, choose:
- **What would you like to start with?** → `Hello World example`
- **Which template?** → `Worker only`
- **Which language?** → `JavaScript`
- **Use git?** → `Yes`
- **Deploy now?** → `No`

```bash
cd cognex-worker
```

**Why:** Cloudflare Workers run your backend logic at the edge (close to users). They are serverless, cheap, and fast. You will host your API here.

---

### ✅ STEP 3: Configure Your Worker (`wrangler.toml`)

**What to do:**

Open `wrangler.toml` (or `wrangler.jsonc`) in your backend folder.

Add these bindings. You will fill in the actual values later after creating accounts.

```toml
name = "cognex-worker"
main = "src/index.js"
compatibility_date = "2026-07-08"

# Node.js compatibility (needed for some npm packages)
compatibility_flags = ["nodejs_compat"]

[vars]
# These will be injected as env vars
# SUPABASE_URL = "your-supabase-url"
# SUPABASE_ANON_KEY = "your-supabase-anon-key"
# GROQ_API_KEY = "your-groq-api-key"
# GITHUB_TOKEN = "your-github-personal-access-token"

# For secrets, use: wrangler secret put <KEY_NAME>
```

**Why:** `wrangler.toml` is the single source of truth for your Worker's configuration. The `nodejs_compat` flag is critical because some npm packages (like crypto, buffer, stream) need Node.js APIs to run inside Workers. citeweb_search:1#7

---

### ✅ STEP 4: Install Backend Dependencies

**What to do:**

```bash
cd backend/cognex-worker
npm install @supabase/supabase-js ai groq-sdk
```

**Why:**
- `@supabase/supabase-js` → Talk to your Supabase database from the Worker.
- `ai` → Vercel AI SDK. It handles streaming LLM responses with minimal boilerplate.
- `groq-sdk` → Official Groq API client for fast inference.

**How to use each package? I will not tell you. Go read:**
- 📖 [Supabase JavaScript Client Docs](https://supabase.com/docs/reference/javascript/)
- 📖 [Vercel AI SDK — Streaming Quickstart](https://vercel.com/docs/functions/streaming-functions) citeweb_search:1#11
- 📖 [Groq API Quickstart](https://console.groq.com/docs/quickstart) citeweb_search:1#12

---

### ✅ STEP 5: Set Up Supabase + pgvector (Database)

**What to do:**

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. Once created, go to the **SQL Editor** in the dashboard.
3. Run the migration file you are about to create.

Create this file:

```bash
mkdir -p ../../supabase/migrations
touch ../../supabase/migrations/001_init.sql
```

**Why:** Supabase gives you a Postgres database with a built-in REST API. The `pgvector` extension lets you store high-dimensional embeddings and do similarity search directly in SQL. This is cheaper and simpler than a separate vector database. citeweb_search:1#0

**Go read this first to understand pgvector:**
- 📖 [Supabase pgvector — Embeddings and Vector Similarity](https://supabase.com/docs/guides/database/extensions/pgvector) citeweb_search:1#0
- 📖 [Supabase Vector Columns Guide](https://supabase.com/docs/guides/ai/vector-columns) citeweb_search:1#1

**Then write your `001_init.sql` to create:**

1. Enable the `vector` extension.
2. A `documents` table with:
   - `id` (uuid, primary key)
   - `repo_url` (text)
   - `content` (text) — the raw text (README chunk, code snippet, issue body, etc.)
   - `metadata` (jsonb) — type, path, author, etc.
   - `embedding` (vector(1024)) — BAAI/bge-large-en-v1.5 outputs 1024 dimensions.
3. A `graph_nodes` table with:
   - `id` (uuid, primary key)
   - `repo_url` (text)
   - `node_type` (text) — file, function, contributor, issue, pr, commit
   - `label` (text) — human-readable name
   - `metadata` (jsonb)
4. A `graph_edges` table with:
   - `id` (uuid, primary key)
   - `repo_url` (text)
   - `source_node_id` (uuid) → references graph_nodes
   - `target_node_id` (uuid) → references graph_nodes
   - `relation` (text) — "calls", "authored_by", "depends_on", etc.
5. A Postgres function `match_documents` that takes a query embedding and returns the top-N most similar documents using cosine similarity.

**How to write the SQL? Read:**
- 📖 [Semantic Search using Supabase Vector — OpenAI Cookbook](https://developers.openai.com/cookbook/examples/vector_databases/supabase/semantic-search) citeweb_search:1#8
- 📖 [A Guide to Embeddings and pgvector](https://dev.to/googleai/a-guide-to-embeddings-and-pgvector-df0) citeweb_search:1#5

**After creating the tables, grab your Supabase URL and Anon Key** from Project Settings → API. You will need them in Step 8.

---

### ✅ STEP 6: Build the GitHub Data Extractor (`github.js`)

**What to do:**

Create `backend/cognex-worker/src/github.js`.

**Why:** Your system needs raw data from GitHub to build the knowledge graph. You will fetch:
- Repository metadata (stars, forks, description, topics)
- README content
- File tree (list of all files)
- Contents of key files (`package.json`, `requirements.txt`, source code)
- Issues (open + closed)
- Pull requests
- Commits (recent history)
- Contributors

**How?** Use the GitHub REST API. No library needed — just `fetch()`.

**Go read this first:**
- 📖 [GitHub API — Repos, Issues, Users & Code](https://parse.bot/marketplace/12c98c7f-483d-4bf3-955d-c4ce8218aedf/github-com-api) citeweb_search:1#2
- 📖 [GitHub REST API Docs](https://docs.github.com/en/rest)

**Your `github.js` must expose these functions:**

```javascript
export async function fetchRepoMetadata(owner, repo, token) { ... }
export async function fetchReadme(owner, repo, token) { ... }
export async function fetchFileTree(owner, repo, token) { ... }
export async function fetchFileContent(owner, repo, path, token) { ... }
export async function fetchIssues(owner, repo, token, state = 'all') { ... }
export async function fetchPullRequests(owner, repo, token, state = 'all') { ... }
export async function fetchCommits(owner, repo, token, perPage = 100) { ... }
export async function fetchContributors(owner, repo, token) { ... }
```

**Important:** GitHub API has rate limits (60 requests/hour for unauthenticated, 5000/hour with a token). Generate a **Personal Access Token** at GitHub Settings → Developer settings → Personal access tokens → Tokens (classic). Give it `repo` and `read:user` scopes.

---

### ✅ STEP 7: Build the Knowledge Graph Engine (`graph.js`)

**What to do:**

Create `backend/cognex-worker/src/graph.js`.

**Why:** A knowledge graph is not just a list of files. It is a structured network that an AI agent can traverse. For example:
- "Which contributor wrote the most code for the auth feature?"
- The agent needs to know: contributor → commits → files → functions → issue labels.

**Your `graph.js` must:**

1. **Parse the file tree** and identify:
   - Source code files (`.js`, `.ts`, `.py`, etc.)
   - Config files (`package.json`, `requirements.txt`)
   - Documentation files (`.md`)

2. **Extract nodes:**
   - `file` nodes: path, extension, size
   - `function` nodes: function names (do basic regex extraction from code)
   - `contributor` nodes: username, avatar, commit count
   - `issue` nodes: title, number, state, labels
   - `pr` nodes: title, number, state, author
   - `commit` nodes: sha, message, author, date
   - `dependency` nodes: packages from `package.json` / `requirements.txt`

3. **Extract edges (relationships):**
   - `file CONTAINS function`
   - `contributor AUTHORED commit`
   - `commit MODIFIES file`
   - `issue REFERENCES file`
   - `pr FIXES issue`
   - `file DEPENDS_ON dependency`
   - `contributor OPENED issue`

4. **Store nodes and edges** in Supabase using the tables you created in Step 5.

**How to parse code for function names?** Use simple regex. Do not over-engineer. For JS/TS: `/function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?\(|class\s+(\w+)/g`. For Python: `/def\s+(\w+)|class\s+(\w+)/g`.

**How to store in Supabase?** Use the Supabase JS client. Read the docs you already read in Step 4.

---

### ✅ STEP 8: Build the Embedding Pipeline (`embeddings.js`)

**What to do:**

Create `backend/cognex-worker/src/embeddings.js`.

**Why:** Every chunk of text (README section, code snippet, issue body, commit message) needs to be turned into a 1024-dimensional vector so you can do semantic search later. `BAAI/bge-large-en-v1.5` is a free, high-quality model.

**How?** You have two options. Pick one:

**Option A: Transformers.js (runs inside the Worker)**
- Use `@xenova/transformers` or `@huggingface/transformers`.
- This runs the model directly in the Worker using ONNX Runtime Web.
- **Pros:** No external service needed.
- **Cons:** Cold start can be slow; model size is ~1.3GB.

**Option B: Python Microservice (recommended for this project)**
- Create a small Python service (or use a serverless function) that loads the model via `sentence-transformers`.
- Your Cloudflare Worker calls this service via HTTP.
- **Pros:** Faster, cleaner separation.
- **Cons:** You need another host (e.g., Hugging Face Spaces, Render, or a VPS).

**For this project, use Option A (Transformers.js) to keep everything on Cloudflare.**

**Go read this first:**
- 📖 [Supabase pgvector — Storing vectors with Transformers.js](https://supabase.com/docs/guides/database/extensions/pgvector) citeweb_search:1#0
- 📖 [Hugging Face Transformers.js Docs](https://huggingface.co/docs/transformers.js/)

**Your `embeddings.js` must expose:**

```javascript
export async function generateEmbedding(text) { ... }
// Returns a 1024-dimensional float array
```

**Implementation notes:**
- Use `pipeline('feature-extraction', 'BAAI/bge-large-en-v1.5')` from Transformers.js.
- Pass `pooling: 'mean'` and `normalize: true`.
- Convert the output to a plain JavaScript array.
- Prepend `"Represent this sentence for searching relevant passages: "` to the text before embedding (this is the BGE model's recommended query prefix for retrieval tasks).

**After generating embeddings, store them in Supabase.** Use the `documents` table you created.

---

### ✅ STEP 9: Build the Supabase Client Module (`supabase.js`)

**What to do:**

Create `backend/cognex-worker/src/supabase.js`.

**Why:** You will talk to Supabase from multiple places (graph storage, embedding storage, RAG retrieval). Centralize the client initialization and common queries here.

**Your `supabase.js` must expose:**

```javascript
import { createClient } from '@supabase/supabase-js';

export function getSupabaseClient(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
}

export async function storeDocument(supabase, repoUrl, content, metadata, embedding) { ... }
export async function storeGraphNode(supabase, repoUrl, nodeType, label, metadata) { ... }
export async function storeGraphEdge(supabase, repoUrl, sourceId, targetId, relation) { ... }
export async function matchDocuments(supabase, queryEmbedding, matchThreshold = 0.5, matchCount = 10) { ... }
export async function getGraphForRepo(supabase, repoUrl) { ... }
```

**How?** Read the Supabase JS client docs from Step 4. Use `.insert()`, `.select()`, and `.rpc()` for the `match_documents` function.

---

### ✅ STEP 10: Build the Groq API Client (`groq.js`)

**What to do:**

Create `backend/cognex-worker/src/groq.js`.

**Why:** Groq provides extremely fast LLM inference. You will use it to generate answers to user questions. The Vercel AI SDK makes streaming trivial.

**Go read this first:**
- 📖 [Groq API Quickstart](https://console.groq.com/docs/quickstart) citeweb_search:1#12
- 📖 [Vercel AI SDK Streaming](https://vercel.com/docs/functions/streaming-functions) citeweb_search:1#11

**Your `groq.js` must expose:**

```javascript
import { createGroq } from '@ai-sdk/groq';
import { streamText } from 'ai';

export async function streamAnswer(prompt, systemPrompt, env) {
  const groq = createGroq({ apiKey: env.GROQ_API_KEY });

  const result = streamText({
    model: groq('llama-3.3-70b-versatile'), // or mixtral-8x7b-32768
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    maxTokens: 2048,
  });

  return result.toTextStreamResponse();
}
```

**Why `temperature: 0.3`?** You want factual, grounded answers — not creative hallucinations. Keep it low.

**Note:** The exact import path for `@ai-sdk/groq` may vary. Check the latest Vercel AI SDK docs for the correct package name and API.

---

### ✅ STEP 11: Build the Web Search Module (`search.js`)

**What to do:**

Create `backend/cognex-worker/src/search.js`.

**Why:** Sometimes the knowledge graph + embeddings do not have enough context (e.g., "What is the latest version of React?"). Your agent should fall back to web search.

**How?** Use a free search API. Options:
- **Serper.dev** (Google Search API, 2500 free queries)
- **Brave Search API** (2000 free queries/month)
- **DuckDuckGo** (no official API, but you can scrape or use `duck-duck-scrape` npm package)

**Your `search.js` must expose:**

```javascript
export async function webSearch(query, apiKey) { ... }
// Returns an array of { title, link, snippet }
```

**Go read:**
- 📖 [Serper.dev API Docs](https://serper.dev/)
- 📖 [Brave Search API Docs](https://api.search.brave.com/)

---

### ✅ STEP 12: Build the Agentic RAG Orchestrator (`rag.js`)

**What to do:**

Create `backend/cognex-worker/src/rag.js`.

**Why:** This is the brain of your application. When a user asks a question, the agent must:
1. Parse the query.
2. Decide if it needs graph data, vector search, or web search (or all three).
3. Retrieve relevant context.
4. Assemble a system prompt with the context.
5. Stream the answer via Groq.

**Your `rag.js` must expose:**

```javascript
export async function handleQuery(repoUrl, userQuery, env) {
  // 1. Generate embedding for the user query
  // 2. Search Supabase for similar documents
  // 3. Fetch relevant graph nodes/edges
  // 4. Optionally call webSearch()
  // 5. Build a rich system prompt with all context
  // 6. Call streamAnswer() from groq.js
  // 7. Return the streaming response
}
```

**Context Engineering (this is critical):**

Your system prompt should look like this:

```
You are Cognex, an AI assistant that answers questions about GitHub repositories.
You have access to the following context about the repository {repoUrl}:

--- RELEVANT DOCUMENTS ---
[Insert top-N matching document chunks here]

--- KNOWLEDGE GRAPH CONTEXT ---
[Insert relevant graph nodes and edges here]

--- WEB SEARCH RESULTS ---
[Insert web search results if used]

Answer the user's question based ONLY on the provided context.
If the context does not contain enough information, say so honestly.
Cite specific files, contributors, or issues when relevant.
```

**Why context engineering matters:** LLMs have limited context windows. You must prioritize the most relevant chunks, summarize long documents, and trim code snippets to the most important lines. Read about RAG best practices online.

---

### ✅ STEP 13: Wire Up the Worker Entry Point (`index.js`)

**What to do:**

Create `backend/cognex-worker/src/index.js`.

**Why:** This is the front door of your backend. Every request from the frontend hits this file first.

**Your `index.js` must handle these routes:**

```javascript
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Route: POST /api/ingest
    // Body: { repoUrl: "https://github.com/owner/repo" }
    // Action: Fetch repo data, build graph, generate embeddings, store in Supabase

    // Route: POST /api/ask
    // Body: { repoUrl: "...", query: "..." }
    // Action: Run Agentic RAG, stream answer back

    // Route: GET /api/graph?repoUrl=...
    // Action: Return graph nodes + edges for visualization

    // Route: GET /api/status?repoUrl=...
    // Action: Return ingestion status (pending, processing, done)
  }
};
```

**How to route in a Worker?** You can use a simple `if/else` on `url.pathname`, or use a lightweight router like **Hono**.

**If you want Hono (cleaner routing), read:**
- 📖 [Hono — Cloudflare Workers](https://hono.dev/docs/getting-started/cloudflare-workers) citeweb_search:1#3

---

### ✅ STEP 14: Set Up Environment Secrets

**What to do:**

Your API keys must NEVER be hardcoded. Use Wrangler secrets:

```bash
cd backend/cognex-worker
npx wrangler secret put SUPABASE_URL
# Paste your Supabase URL

npx wrangler secret put SUPABASE_ANON_KEY
# Paste your Supabase anon key

npx wrangler secret put GROQ_API_KEY
# Paste your Groq API key

npx wrangler secret put GITHUB_TOKEN
# Paste your GitHub personal access token

npx wrangler secret put WEB_SEARCH_API_KEY
# Paste your Serper/Brave API key
```

**Why:** Secrets are encrypted and only available at runtime. They are not visible in your code or git history.

---

### ✅ STEP 15: Set Up the Frontend (Cloudflare Pages)

**What to do:**

```bash
cd ../..  # back to cognex root
mkdir frontend
cd frontend
```

Create three files:

**`index.html`** — The main page with:
- An input field for the GitHub repo URL.
- A "Build Graph" button that calls `POST /api/ingest`.
- A chat interface (input + message history) for asking questions.
- A canvas or div area for visualizing the knowledge graph.

**`style.css`** — Make it look clean and modern. Use CSS Grid/Flexbox. Dark mode is a plus.

**`app.js`** — All frontend logic:
- Fetch the backend API.
- Handle streaming responses (Server-Sent Events or ReadableStream).
- Render the graph using a library like **Cytoscape.js** or **D3.js**.
- Show loading states, errors, and progress.

**Why Cloudflare Pages?** It is free, fast, and pairs perfectly with Cloudflare Workers. You can deploy static sites with a single command.

**Go read:**
- 📖 [Cloudflare Workers — Static Assets](https://blog.openreplay.com/beginners-guide-cloudflare-workers/) citeweb_search:1#7
- 📖 [Cytoscape.js Docs](https://js.cytoscape.org/)

---

### ✅ STEP 16: Deploy the Backend

**What to do:**

```bash
cd backend/cognex-worker
npm run deploy
```

**Why:** This pushes your Worker to Cloudflare's global edge network. You will get a URL like `https://cognex-worker.your-subdomain.workers.dev`.

**Test it:**

```bash
curl -X POST https://cognex-worker.your-subdomain.workers.dev/api/ingest \
  -H "Content-Type: application/json" \
  -d '{"repoUrl": "https://github.com/vercel/next.js"}'
```

---

### ✅ STEP 17: Deploy the Frontend

**What to do:**

Cloudflare Pages can deploy from a git repo or directly from a folder.

```bash
cd frontend
npx wrangler pages deploy .
```

**Why:** Your frontend is now live at `https://cognex-frontend.pages.dev`.

**Update your frontend `app.js`** to point to your deployed Worker URL.

---

### ✅ STEP 18: Test End-to-End

**What to do:**

1. Open your frontend URL.
2. Paste `https://github.com/facebook/react` in the repo input.
3. Click "Build Graph". Wait (this may take 1-3 minutes for large repos).
4. Once done, ask: *"Who are the top 3 contributors to React?"*
5. Ask: *"What are the main dependencies of React?"*
6. Ask: *"Explain how the useEffect hook works based on the codebase."*

**Debug tips:**
- Check Cloudflare Worker logs: `npx wrangler tail`
- Check Supabase Table Editor for inserted data.
- Check browser Network tab for API errors.

---



## 🧠 What You Will Learn (The Real Value)

By building this project, you will master:

1. **Serverless architecture** — Cloudflare Workers + Pages.
2. **Vector databases** — How pgvector stores and searches embeddings at scale.
3. **RAG pipelines** — How to ground LLM answers in real data.
4. **Graph theory basics** — Nodes, edges, and traversals for knowledge representation.
5. **Streaming APIs** — How Server-Sent Events and ReadableStreams work.
6. **API integration** — GitHub REST API, Groq API, web search APIs.
7. **Context engineering** — How to fit the right context into an LLM's window.
8. **Security** — Managing secrets, CORS, and row-level security in Supabase.

---

## ⚠️ Common Pitfalls (Read Before You Start)

1. **GitHub API Rate Limits** — Always use a token. For large repos, implement pagination and delays.
2. **Worker Cold Starts** — Transformers.js models are heavy. Consider warming up or using a Python microservice.
3. **Context Window Limits** — Groq models have token limits. Summarize long READMEs and trim code snippets.
4. **CORS Errors** — Your frontend and backend are on different domains. Always return CORS headers from the Worker.
5. **Supabase RLS** — Enable Row Level Security on your tables so users cannot read other users' repo data.
6. **Embedding Dimensions** — `BAAI/bge-large-en-v1.5` outputs **1024** dimensions. Your Supabase vector column MUST match this exactly.

---

## 🚀 Next Steps (After You Finish)

- Add **D3.js** or **Cytoscape.js** graph visualization to the frontend.
- Add **authentication** (Clerk, Auth0, or Supabase Auth) so users can save their repo graphs.
- Add **caching** with Cloudflare KV to avoid re-ingesting the same repo.
- Add **multi-repo comparison** — ask questions across multiple repos.
- Deploy a **landing page** explaining what Cognex does.

---

# Universal Learning Role Prompt
> **Teacher's Note**: I have given Rehaan the map, the compass, and the destination. The path is of Rehaan's to walk. All the time Rehaan gets stuck, do not ask "what code should I write?" — ask "what does the documentation tell?" That is the mindset of a senior developer. Now go build.

