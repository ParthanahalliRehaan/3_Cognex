/**
 * index.js — Optimized Cloudflare Worker Entry Point for Cognex
 *
 * Improvements:
 *   • Hono router for clean, maintainable routing
 *   • CORS preflight handled at edge (no CPU overhead)
 *   • Background ingestion via ctx.waitUntil() (fixes CPU limit)
 *   • Request validation with Zod-like lightweight checks
 *   • Structured logging with timing metrics
 *   • Graceful error responses with request IDs
 *   • Health check endpoint with dependency status
 *   • Rate limiting via Cloudflare's built-in
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

// Lazy imports for heavy modules
let _rag, _supabase;

async function getRag() {
  if (!_rag) _rag = await import('./rag.js');
  return _rag;
}
async function getSupabase() {
  if (!_supabase) _supabase = await import('./supabase.js');
  return _supabase;
}

// ─── App Setup ────────────────────────────────────────────────────────────────

const app = new Hono({ strict: false });

// CORS — allow all origins (restrict in production)
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  exposeHeaders: ['X-Request-ID', 'X-Ingestion-Status'],
  maxAge: 86400,
}));

// Lightweight request logging
app.use('*', async (c, next) => {
  const start = Date.now();
  c.set('requestId', crypto.randomUUID().slice(0, 8));
  await next();
  const duration = Date.now() - start;
  console.log(`[${c.get('requestId')}] ${c.req.method} ${c.req.path} ${c.res.status} ${duration}ms`);
});

// ─── Middleware: Request Validation ───────────────────────────────────────────

function validateRepoUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return url.includes('github.com') && /^https?:\/\/github\.com\/[^\/]+\/[^\/]+/.test(url);
}

function validateQuery(query) {
  return query && typeof query === 'string' && query.trim().length > 0 && query.length < 2000;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health check
app.get('/health', async (c) => {
  const health = {
    status: 'ok',
    service: 'cognex-worker',
    version: '1.1.0',
    timestamp: new Date().toISOString(),
    env: {
      hasSupabaseUrl: !!c.env.SUPABASE_URL,
      hasGroqKey: !!c.env.GROQ_API_KEY,
      hasGithubToken: !!c.env.GITHUB_TOKEN,
      hasCohereKey: !!c.env.COHERE_API_KEY,
      hasSearchKey: !!c.env.WEB_SEARCH_API_KEY,
    },
  };
  return c.json(health);
});

app.get('/', (c) => c.redirect('/health'));

// ─── POST /api/ingest ─────────────────────────────────────────────────────────

app.post('/api/ingest', async (c) => {
  const reqId = c.get('requestId');

  try {
    const body = await c.req.json();
    const repoUrl = body.repoUrl?.trim();

    if (!validateRepoUrl(repoUrl)) {
      return c.json({ error: 'Invalid repoUrl. Must be a valid GitHub URL (https://github.com/owner/repo).' }, 400);
    }

    const rag = await getRag();

    // CRITICAL: Use ctx.waitUntil for background processing
    // This returns immediately to the client, avoiding CPU time limits
    const result = await rag.ingestRepo(repoUrl, c.env, c.executionCtx);

    // If background mode, return 202 Accepted
    if (result.status === 'accepted') {
      return c.json({
        success: true,
        status: 'accepted',
        repoUrl,
        message: result.message,
        requestId: reqId,
        pollEndpoint: `/api/status?repoUrl=${encodeURIComponent(repoUrl)}`,
      }, 202);
    }

    // Synchronous completion (small repos only)
    return c.json({
      success: result.status === 'success',
      status: result.status,
      repoUrl,
      requestId: reqId,
      ...result,
    });

  } catch (err) {
    console.error(`[${reqId}] INGEST ERROR:`, err);
    return c.json({
      error: err.message || 'Ingestion failed',
      requestId: reqId,
    }, 500);
  }
});

// ─── POST /api/ask ────────────────────────────────────────────────────────────

app.post('/api/ask', async (c) => {
  const reqId = c.get('requestId');

  try {
    const body = await c.req.json();
    const { repoUrl, query } = body;

    if (!validateRepoUrl(repoUrl)) {
      return c.json({ error: 'Invalid repoUrl' }, 400);
    }
    if (!validateQuery(query)) {
      return c.json({ error: 'Query must be 1-2000 characters' }, 400);
    }

    const rag = await getRag();
    const response = await rag.handleQuery(repoUrl, query.trim(), c.env);

    // Copy streaming response with CORS headers already applied by middleware
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        ...Object.fromEntries(response.headers),
        'X-Request-ID': reqId,
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });

  } catch (err) {
    console.error(`[${reqId}] ASK ERROR:`, err);
    return c.json({
      error: err.message || 'Query failed',
      requestId: reqId,
    }, 500);
  }
});

// ─── GET /api/graph ───────────────────────────────────────────────────────────

app.get('/api/graph', async (c) => {
  const reqId = c.get('requestId');
  const repoUrl = c.req.query('repoUrl')?.trim();

  if (!validateRepoUrl(repoUrl)) {
    return c.json({ error: 'repoUrl query param must be a valid GitHub URL' }, 400);
  }

  try {
    const supabase = await getSupabase();
    const client = supabase.getSupabaseClient(c.env, true);
    const graph = await supabase.getGraphForRepo(client, repoUrl);

    return c.json({
      repoUrl,
      nodes: graph.nodes,
      edges: graph.edges,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      requestId: reqId,
    });

  } catch (err) {
    console.error(`[${reqId}] GRAPH ERROR:`, err);
    return c.json({ error: err.message, requestId: reqId }, 500);
  }
});

// ─── GET /api/status ──────────────────────────────────────────────────────────

app.get('/api/status', async (c) => {
  const reqId = c.get('requestId');
  const repoUrl = c.req.query('repoUrl')?.trim();

  if (!repoUrl) {
    return c.json({ error: 'repoUrl query param is required' }, 400);
  }

  try {
    const supabase = await getSupabase();
    const client = supabase.getSupabaseClient(c.env, true);

    // Check database status
    const dbStatus = await supabase.getIngestionStatus(client, repoUrl);

    // Check in-memory progress (for background ingestion)
    const rag = await getRag();
    const progress = rag.getIngestionProgress(repoUrl);

    const status = dbStatus.exists
      ? (progress.status === 'processing' ? 'processing' : 'done')
      : (progress.status === 'processing' ? 'processing' : 'not_found');

    return c.json({
      repoUrl,
      status,
      progress: progress.progress || 0,
      message: progress.message || (dbStatus.exists ? 'Repository ingested' : 'Not found'),
      nodeCount: dbStatus.nodeCount,
      docCount: dbStatus.docCount,
      requestId: reqId,
      lastUpdated: progress.updatedAt || null,
    });

  } catch (err) {
    console.error(`[${reqId}] STATUS ERROR:`, err);
    return c.json({ error: err.message, requestId: reqId }, 500);
  }
});

// ─── GET /api/stats ───────────────────────────────────────────────────────────

app.get('/api/stats', async (c) => {
  const reqId = c.get('requestId');
  const repoUrl = c.req.query('repoUrl')?.trim();

  if (!repoUrl) {
    return c.json({ error: 'repoUrl query param is required' }, 400);
  }

  try {
    const supabase = await getSupabase();
    const client = supabase.getSupabaseClient(c.env, true);
    const graph = await supabase.getGraphForRepo(client, repoUrl);

    // Compute stats
    const stats = {
      totalNodes: graph.nodes.length,
      totalEdges: graph.edges.length,
      nodeTypes: {},
      edgeRelations: {},
      topContributors: [],
      topFiles: [],
      dependencies: [],
    };

    for (const n of graph.nodes) {
      stats.nodeTypes[n.node_type] = (stats.nodeTypes[n.node_type] || 0) + 1;
    }
    for (const e of graph.edges) {
      stats.edgeRelations[e.relation] = (stats.edgeRelations[e.relation] || 0) + 1;
    }

    stats.topContributors = graph.nodes
      .filter(n => n.node_type === 'contributor')
      .sort((a, b) => (b.metadata?.contributions || 0) - (a.metadata?.contributions || 0))
      .slice(0, 5)
      .map(c => ({ username: c.label, contributions: c.metadata?.contributions || 0 }));

    stats.topFiles = graph.nodes
      .filter(n => n.node_type === 'file')
      .slice(0, 10)
      .map(f => f.label);

    stats.dependencies = graph.nodes
      .filter(n => n.node_type === 'dependency')
      .slice(0, 15)
      .map(d => d.metadata?.name || d.label);

    return c.json({ repoUrl, stats, requestId: reqId });

  } catch (err) {
    console.error(`[${reqId}] STATS ERROR:`, err);
    return c.json({ error: err.message, requestId: reqId }, 500);
  }
});

// ─── 404 Handler ────────────────────────────────────────────────────────────────

app.notFound((c) => {
  return c.json({ error: 'Not found', path: c.req.path }, 404);
});

// ─── Error Handler ────────────────────────────────────────────────────────────

app.onError((err, c) => {
  const reqId = c.get('requestId') || 'unknown';
  console.error(`[${reqId}] UNHANDLED ERROR:`, err);
  return c.json({
    error: 'Internal server error',
    message: err.message,
    requestId: reqId,
  }, 500);
});

// ─── Export ───────────────────────────────────────────────────────────────────

export default app;
// For Cloudflare Workers compatibility
export const fetch = app.fetch;
