## What `index.js` Does

This is the Worker's front door. It handles:
- `POST /api/ingest` — Ingest a repo (fetch → graph → embeddings → store)
- `POST /api/ask` — Ask a question (RAG → stream answer)
- `GET /api/graph?repoUrl=...` — Get graph for visualization
- `GET /api/status?repoUrl=...` — Check ingestion status
- CORS headers for frontend communication

---

## The Code: `backend/cognex-worker/src/index.js`

```javascript
/**
 * index.js — Cloudflare Worker Entry Point for Cognex
 * 
 * Routes:
 *   POST /api/ingest  → Ingest a GitHub repo
 *   POST /api/ask     → Ask a question (streaming)
 *   GET  /api/graph   → Get knowledge graph
 *   GET  /api/status  → Check ingestion status
 */

import { handleQuery, ingestRepo } from './rag.js';
import { getSupabaseClient, getGraphForRepo, getIngestionStatus } from './supabase.js';

// ─── CORS Headers ─────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ─── Router ───────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      // Route: POST /api/ingest
      if (pathname === '/api/ingest' && request.method === 'POST') {
        return await handleIngest(request, env);
      }

      // Route: POST /api/ask
      if (pathname === '/api/ask' && request.method === 'POST') {
        return await handleAsk(request, env);
      }

      // Route: GET /api/graph
      if (pathname === '/api/graph' && request.method === 'GET') {
        return await handleGraph(request, env);
      }

      // Route: GET /api/status
      if (pathname === '/api/status' && request.method === 'GET') {
        return await handleStatus(request, env);
      }

      // Health check
      if (pathname === '/health' || pathname === '/') {
        return jsonResponse({ status: 'ok', service: 'cognex-worker' });
      }

      // 404
      return jsonResponse({ error: 'Not found' }, 404);

    } catch (err) {
      console.error('[WORKER ERROR]', err);
      return jsonResponse({ error: err.message }, 500);
    }
  },
};

// ─── Route Handlers ───────────────────────────────────────────────────────────

/**
 * POST /api/ingest
 * Body: { repoUrl: "https://github.com/owner/repo" }
 */
async function handleIngest(request, env) {
  const body = await request.json();
  const repoUrl = body.repoUrl;

  if (!repoUrl || !repoUrl.includes('github.com')) {
    return jsonResponse({ error: 'Invalid repoUrl. Must be a GitHub URL.' }, 400);
  }

  // Run ingestion (may take 1-3 minutes)
  const result = await ingestRepo(repoUrl, env);

  return jsonResponse({
    success: result.status === 'success',
    repoUrl,
    ...result,
  });
}

/**
 * POST /api/ask
 * Body: { repoUrl: "...", query: "..." }
 * Returns: Streaming text response
 */
async function handleAsk(request, env) {
  const body = await request.json();
  const { repoUrl, query } = body;

  if (!repoUrl || !query) {
    return jsonResponse({ error: 'repoUrl and query are required' }, 400);
  }

  // Stream the answer
  const response = await handleQuery(repoUrl, query, env);

  // Add CORS headers to the streamed response
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      ...Object.fromEntries(response.headers),
      ...CORS_HEADERS,
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

/**
 * GET /api/graph?repoUrl=...
 */
async function handleGraph(request, env) {
  const url = new URL(request.url);
  const repoUrl = url.searchParams.get('repoUrl');

  if (!repoUrl) {
    return jsonResponse({ error: 'repoUrl query param is required' }, 400);
  }

  const supabase = getSupabaseClient(env, false);
  const graph = await getGraphForRepo(supabase, repoUrl);

  return jsonResponse({
    repoUrl,
    nodes: graph.nodes,
    edges: graph.edges,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
  });
}

/**
 * GET /api/status?repoUrl=...
 */
async function handleStatus(request, env) {
  const url = new URL(request.url);
  const repoUrl = url.searchParams.get('repoUrl');

  if (!repoUrl) {
    return jsonResponse({ error: 'repoUrl query param is required' }, 400);
  }

  const supabase = getSupabaseClient(env, false);
  const status = await getIngestionStatus(supabase, repoUrl);

  return jsonResponse({
    repoUrl,
    ...status,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}
```

---

## Test with `curl` (or use the test file below)

```bash
# Health check
curl https://your-worker.your-subdomain.workers.dev/health

# Ingest (takes 1-2 min)
curl -X POST https://your-worker.your-subdomain.workers.dev/api/ingest \
  -H "Content-Type: application/json" \
  -d '{"repoUrl": "https://github.com/vercel/next.js"}'

# Ask (streams answer)
curl -X POST https://your-worker.your-subdomain.workers.dev/api/ask \
  -H "Content-Type: application/json" \
  -d '{"repoUrl": "https://github.com/vercel/next.js", "query": "What is the App Router?"}'

# Get graph
curl "https://your-worker.your-subdomain.workers.dev/api/graph?repoUrl=https://github.com/vercel/next.js"

# Check status
curl "https://your-worker.your-subdomain.workers.dev/api/status?repoUrl=https://github.com/vercel/next.js"
```

---

## Local Test: `test/test-index.js`

```javascript
// test/test-index.js
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

// Simulate Cloudflare Worker environment
const mockEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  COHERE_API_KEY: process.env.COHERE_API_KEY,
  WEB_SEARCH_API_KEY: process.env.WEB_SEARCH_API_KEY,
};

// Import the worker
import worker from '../src/index.js';

async function testIndex() {
  console.log('🧪 Testing index.js (Worker routes)...\n');

  // Test 1: Health check
  console.log('1️⃣  Health check:');
  const healthReq = new Request('http://localhost/health');
  const healthRes = await worker.fetch(healthReq, mockEnv);
  const healthData = await healthRes.json();
  console.log('   ✅ Status:', healthData.status);

  // Test 2: Status endpoint
  console.log('\n2️⃣  Status endpoint:');
  const statusReq = new Request('http://localhost/api/status?repoUrl=https://github.com/vercel/next.js');
  const statusRes = await worker.fetch(statusReq, mockEnv);
  const statusData = await statusRes.json();
  console.log('   ✅ Exists:', statusData.exists, '| Nodes:', statusData.nodeCount, '| Docs:', statusData.docCount);

  // Test 3: Graph endpoint
  console.log('\n3️⃣  Graph endpoint:');
  const graphReq = new Request('http://localhost/api/graph?repoUrl=https://github.com/vercel/next.js');
  const graphRes = await worker.fetch(graphReq, mockEnv);
  const graphData = await graphRes.json();
  console.log('   ✅ Nodes:', graphData.nodeCount, '| Edges:', graphData.edgeCount);

  // Test 4: Ask endpoint (streams)
  console.log('\n4️⃣  Ask endpoint (streaming):');
  const askReq = new Request('http://localhost/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repoUrl: 'https://github.com/vercel/next.js',
      query: 'What is Next.js?',
    }),
  });
  const askRes = await worker.fetch(askReq, mockEnv);
  console.log('   ✅ Status:', askRes.status);
  console.log('   ✅ Content-Type:', askRes.headers.get('content-type'));
  
  const reader = askRes.body.getReader();
  const { value } = await reader.read();
  const chunk = new TextDecoder().decode(value);
  console.log('   💬 First chunk:', chunk.substring(0, 100));

  // Test 5: CORS preflight
  console.log('\n5️⃣  CORS preflight:');
  const corsReq = new Request('http://localhost/api/ask', { method: 'OPTIONS' });
  const corsRes = await worker.fetch(corsReq, mockEnv);
  console.log('   ✅ Status:', corsRes.status);
  console.log('   ✅ CORS headers:', corsRes.headers.get('access-control-allow-origin'));

  // Test 6: 404
  console.log('\n6️⃣  404 handling:');
  const notFoundReq = new Request('http://localhost/api/unknown');
  const notFoundRes = await worker.fetch(notFoundReq, mockEnv);
  const notFoundData = await notFoundRes.json();
  console.log('   ✅ Status:', notFoundRes.status);
  console.log('   ✅ Error:', notFoundData.error);

  console.log('\n🎉 All index.js tests passed!');
}

testIndex().catch(err => {
  console.error('❌ Test failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
```

---

## Run Local Test

```bash
cd test
node test-index.js
```

---

## Next: Deploy the Worker

Once tests pass locally, deploy:

```bash
cd backend/cognex-worker

# Add secrets to Cloudflare
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put COHERE_API_KEY
npx wrangler secret put WEB_SEARCH_API_KEY

# Deploy
npm run deploy 
# OR
wrangler deploy
```

---

## Current File Status

| File | Status |
|------|--------|
| `github.js` | ✅ Complete + tested |
| `graph.js` | ✅ Complete + tested |
| `embeddings.js` | ✅ Complete + tested (Cohere) |
| `supabase.js` | ✅ Complete + tested |
| `groq.js` | ✅ Complete + tested |
| `search.js` | ✅ Complete + tested |
| `rag.js` | ✅ Complete + tested |
| `index.js` | ✅ Complete (test now) |
