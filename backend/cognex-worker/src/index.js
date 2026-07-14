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
