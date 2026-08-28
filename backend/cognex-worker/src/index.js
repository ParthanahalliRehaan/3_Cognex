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
 *   • FULL CRUD: Create, Read, Update, Delete for nodes, edges, and documents
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
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
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

function validateUUID(id) {
  return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health check
app.get('/health', async (c) => {
  const health = {
    status: 'ok',
    service: 'cognex-worker',
    version: '1.2.0',
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

// ═══════════════════════════════════════════════════════════════════════════════
//  CRUD — GRAPH NODES  (Create, Read, Update, Delete)
// ═══════════════════════════════════════════════════════════════════════════════

// CREATE — POST /api/nodes
app.post('/api/nodes', async (c) => {
  const reqId = c.get('requestId');
  try {
    const body = await c.req.json();
    const { repo_url, node_type, label, metadata = {} } = body;

    if (!validateRepoUrl(repo_url)) return c.json({ error: 'Invalid repo_url' }, 400);
    if (!node_type || typeof node_type !== 'string') return c.json({ error: 'node_type required' }, 400);
    if (!label || typeof label !== 'string') return c.json({ error: 'label required' }, 400);

    const supabase = await getSupabase();
    const client = supabase.getSupabaseClient(c.env, true);
    const node = await supabase.storeGraphNode(client, { repo_url, node_type, label, metadata });

    return c.json({ success: true, data: node, requestId: reqId }, 201);
  } catch (err) {
    console.error(`[${reqId}] CREATE NODE ERROR:`, err);
    return c.json({ error: err.message, requestId: reqId }, 500);
  }
});

// READ — GET /api/nodes (list by repo)
app.get('/api/nodes', async (c) => {
  const reqId = c.get('requestId');
  const repoUrl = c.req.query('repoUrl')?.trim();
  const nodeType = c.req.query('nodeType')?.trim() || null;

  if (!repoUrl) return c.json({ error: 'repoUrl query param required' }, 400);

  try {
    const supabase = await getSupabase();
    const client = supabase.getSupabaseClient(c.env, true);
    const nodes = await supabase.getGraphNodes(client, repoUrl, nodeType);

    return c.json({ success: true, count: nodes.length, data: nodes, requestId: reqId });
  } catch (err) {
    console.error(`[${reqId}] LIST NODES ERROR:`, err);
    return c.json({ error: err.message, requestId: reqId }, 500);
  }
});

// READ — GET /api/nodes/:id
app.get('/api/nodes/:id', async (c) => {
  const reqId = c.get('requestId');
  const id = c.req.param('id');
  if (!validateUUID(id)) return c.json({ error: 'Invalid UUID' }, 400);

  try {
    const supabase = await getSupabase();
    const client = supabase.getSupabaseClient(c.env, true);
    const { data, error } = await client.from('graph_nodes').select('*').eq('id', id).single();
    if (error || !data) return c.json({ error: 'Node not found', requestId: reqId }, 404);

    return c.json({ success: true, data, requestId: reqId });
  } catch (err) {
    console.error(`[${reqId}] GET NODE ERROR:`, err);
    return c.json({ error: err.message, requestId: reqId }, 500);
  }
});

// UPDATE — PUT /api/nodes/:id
app.put('/api/nodes/:id', async (c) => {
  const reqId = c.get('requestId');
  const id = c.req.param('id');
  if (!validateUUID(id)) return c.json({ error: 'Invalid UUID' }, 400);

  try {
    const body = await c.req.json();
    const updates = {};
    if (body.label !== undefined) updates.label = body.label;
    if (body.node_type !== undefined) updates.node_type = body.node_type;
    if (body.metadata !== undefined) updates.metadata = body.metadata;

    if (Object.keys(updates).length === 0) {
      return c.json({ error: 'No fields to update. Provide label, node_type, or metadata.' }, 400);
    }

    const supabase = await getSupabase();
    const client = supabase.getSupabaseClient(c.env, true);
    const { data, error } = await client.from('graph_nodes').update(updates).eq('id', id).select().single();

    if (error) throw new Error(error.message);
    if (!data) return c.json({ error: 'Node not found', requestId: reqId }, 404);

    return c.json({ success: true, data, requestId: reqId });
  } catch (err) {
    console.error(`[${reqId}] UPDATE NODE ERROR:`, err);
    return c.json({ error: err.message, requestId: reqId }, 500);
  }
});

// DELETE — DELETE /api/nodes/:id
app.delete('/api/nodes/:id', async (c) => {
  const reqId = c.get('requestId');
  const id = c.req.param('id');
  if (!validateUUID(id)) return c.json({ error: 'Invalid UUID' }, 400);

  try {
    const supabase = await getSupabase();
    const client = supabase.getSupabaseClient(c.env, true);
    const { data, error } = await client.from('graph_nodes').delete().eq('id', id).select().single();

    if (error) throw new Error(error.message);
    if (!data) return c.json({ error: 'Node not found', requestId: reqId }, 404);

    return c.json({ success: true, message: 'Node deleted', data, requestId: reqId });
  } catch (err) {
    console.error(`[${reqId}] DELETE NODE ERROR:`, err);
    return c.json({ error: err.message, requestId: reqId }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  CRUD — GRAPH EDGES  (Create, Read, Update, Delete)
// ═══════════════════════════════════════════════════════════════════════════════

// CREATE — POST /api/edges
app.post('/api/edges', async (c) => {
  const reqId = c.get('requestId');
  try {
    const body = await c.req.json();
    const { repo_url, source_node_id, target_node_id, relation, metadata = {} } = body;

    if (!validateRepoUrl(repo_url)) return c.json({ error: 'Invalid repo_url' }, 400);
    if (!validateUUID(source_node_id)) return c.json({ error: 'Invalid source_node_id' }, 400);
    if (!validateUUID(target_node_id)) return c.json({ error: 'Invalid target_node_id' }, 400);
    if (!relation || typeof relation !== 'string') return c.json({ error: 'relation required' }, 400);

    const supabase = await getSupabase();
    const client = supabase.getSupabaseClient(c.env, true);
    const edge = await supabase.storeGraphEdge(client, { repo_url, source_node_id, target_node_id, relation, metadata });

    return c.json({ success: true, data: edge, requestId: reqId }, 201);
  } catch (err) {
    console.error(`[${reqId}] CREATE EDGE ERROR:`, err);
    return c.json({ error: err.message, requestId: reqId }, 500);
  }
});

// READ — GET /api/edges (list by repo)
app.get('/api/edges', async (c) => {
  const reqId = c.get('requestId');
  const repoUrl = c.req.query('repoUrl')?.trim();
  const relation = c.req.query('relation')?.trim() || null;

  if (!repoUrl) return c.json({ error: 'repoUrl query param required' }, 400);

  try {
    const supabase = await getSupabase();
    const client = supabase.getSupabaseClient(c.env, true);
    const edges = await supabase.getGraphEdges(client, repoUrl, relation);

    return c.json({ success: true, count: edges.length, data: edges, requestId: reqId });
  } catch (err) {
    console.error(`[${reqId}] LIST EDGES ERROR:`, err);
    return c.json({ error: err.message, requestId: reqId }, 500);
  }
});

// READ — GET /api/edges/:id
app.get('/api/edges/:id', async (c) => {
  const reqId = c.get('requestId');
  const id = c.req.param('id');
  if (!validateUUID(id)) return c.json({ error: 'Invalid UUID' }, 400);

  try {
    const supabase = await getSupabase();
    const client = supabase.getSupabaseClient(c.env, true);
    const { data, error } = await client.from('graph_edges').select('*').eq('id', id).single();
    if (error || !data) return c.json({ error: 'Edge not found', requestId: reqId }, 404);

    return c.json({ success: true, data, requestId: reqId });
  } catch (err) {
    console.error(`[${reqId}] GET EDGE ERROR:`, err);
    return c.json({ error: err.message, requestId: reqId }, 500);
  }
});

// UPDATE — PUT /api/edges/:id
app.put('/api/edges/:id', async (c) => {
  const reqId = c.get('requestId');
  const id = c.req.param('id');
  if (!validateUUID(id)) return c.json({ error: 'Invalid UUID' }, 400);

  try {
    const body = await c.req.json();
    const updates = {};
    if (body.relation !== undefined) updates.relation = body.relation;
    if (body.metadata !== undefined) updates.metadata = body.metadata;

    if (Object.keys(updates).length === 0) {
      return c.json({ error: 'No fields to update. Provide relation or metadata.' }, 400);
    }

    const supabase = await getSupabase();
    const client = supabase.getSupabaseClient(c.env, true);
    const { data, error } = await client.from('graph_edges').update(updates).eq('id', id).select().single();

    if (error) throw new Error(error.message);
    if (!data) return c.json({ error: 'Edge not found', requestId: reqId }, 404);

    return c.json({ success: true, data, requestId: reqId });
  } catch (err) {
    console.error(`[${reqId}] UPDATE EDGE ERROR:`, err);
    return c.json({ error: err.message, requestId: reqId }, 500);
  }
});

// DELETE — DELETE /api/edges/:id
app.delete('/api/edges/:id', async (c) => {
  const reqId = c.get('requestId');
  const id = c.req.param('id');
  if (!validateUUID(id)) return c.json({ error: 'Invalid UUID' }, 400);

  try {
    const supabase = await getSupabase();
    const client = supabase.getSupabaseClient(c.env, true);
    const { data, error } = await client.from('graph_edges').delete().eq('id', id).select().single();

    if (error) throw new Error(error.message);
    if (!data) return c.json({ error: 'Edge not found', requestId: reqId }, 404);

    return c.json({ success: true, message: 'Edge deleted', data, requestId: reqId });
  } catch (err) {
    console.error(`[${reqId}] DELETE EDGE ERROR:`, err);
    return c.json({ error: err.message, requestId: reqId }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  CRUD — DOCUMENTS  (Create, Read, Update, Delete)
// ═══════════════════════════════════════════════════════════════════════════════

// CREATE — POST /api/documents
app.post('/api/documents', async (c) => {
  const reqId = c.get('requestId');
  try {
    const body = await c.req.json();
    const { repo_url, content, metadata = {}, embedding } = body;

    if (!validateRepoUrl(repo_url)) return c.json({ error: 'Invalid repo_url' }, 400);
    if (!content || typeof content !== 'string') return c.json({ error: 'content required' }, 400);
    if (!embedding || !Array.isArray(embedding)) return c.json({ error: 'embedding array required' }, 400);

    const supabase = await getSupabase();
    const client = supabase.getSupabaseClient(c.env, true);
    const doc = await supabase.storeDocument(client, { repo_url, content, metadata, embedding });

    return c.json({ success: true, data: doc, requestId: reqId }, 201);
  } catch (err) {
    console.error(`[${reqId}] CREATE DOCUMENT ERROR:`, err);
    return c.json({ error: err.message, requestId: reqId }, 500);
  }
});

// READ — GET /api/documents (list by repo)
app.get('/api/documents', async (c) => {
  const reqId = c.get('requestId');
  const repoUrl = c.req.query('repoUrl')?.trim();

  if (!repoUrl) return c.json({ error: 'repoUrl query param required' }, 400);

  try {
    const supabase = await getSupabase();
    const client = supabase.getSupabaseClient(c.env, true);
    const { data, error } = await client.from('documents').select('*').eq('repo_url', repoUrl);
    if (error) throw new Error(error.message);

    return c.json({ success: true, count: data.length, data, requestId: reqId });
  } catch (err) {
    console.error(`[${reqId}] LIST DOCUMENTS ERROR:`, err);
    return c.json({ error: err.message, requestId: reqId }, 500);
  }
});

// READ — GET /api/documents/:id
app.get('/api/documents/:id', async (c) => {
  const reqId = c.get('requestId');
  const id = c.req.param('id');
  if (!validateUUID(id)) return c.json({ error: 'Invalid UUID' }, 400);

  try {
    const supabase = await getSupabase();
    const client = supabase.getSupabaseClient(c.env, true);
    const { data, error } = await client.from('documents').select('*').eq('id', id).single();
    if (error || !data) return c.json({ error: 'Document not found', requestId: reqId }, 404);

    return c.json({ success: true, data, requestId: reqId });
  } catch (err) {
    console.error(`[${reqId}] GET DOCUMENT ERROR:`, err);
    return c.json({ error: err.message, requestId: reqId }, 500);
  }
});

// UPDATE — PUT /api/documents/:id
app.put('/api/documents/:id', async (c) => {
  const reqId = c.get('requestId');
  const id = c.req.param('id');
  if (!validateUUID(id)) return c.json({ error: 'Invalid UUID' }, 400);

  try {
    const body = await c.req.json();
    const updates = {};
    if (body.content !== undefined) updates.content = body.content;
    if (body.metadata !== undefined) updates.metadata = body.metadata;
    if (body.embedding !== undefined) updates.embedding = body.embedding;

    if (Object.keys(updates).length === 0) {
      return c.json({ error: 'No fields to update. Provide content, metadata, or embedding.' }, 400);
    }

    const supabase = await getSupabase();
    const client = supabase.getSupabaseClient(c.env, true);
    const { data, error } = await client.from('documents').update(updates).eq('id', id).select().single();

    if (error) throw new Error(error.message);
    if (!data) return c.json({ error: 'Document not found', requestId: reqId }, 404);

    return c.json({ success: true, data, requestId: reqId });
  } catch (err) {
    console.error(`[${reqId}] UPDATE DOCUMENT ERROR:`, err);
    return c.json({ error: err.message, requestId: reqId }, 500);
  }
});

// DELETE — DELETE /api/documents/:id
app.delete('/api/documents/:id', async (c) => {
  const reqId = c.get('requestId');
  const id = c.req.param('id');
  if (!validateUUID(id)) return c.json({ error: 'Invalid UUID' }, 400);

  try {
    const supabase = await getSupabase();
    const client = supabase.getSupabaseClient(c.env, true);
    const { data, error } = await client.from('documents').delete().eq('id', id).select().single();

    if (error) throw new Error(error.message);
    if (!data) return c.json({ error: 'Document not found', requestId: reqId }, 404);

    return c.json({ success: true, message: 'Document deleted', data, requestId: reqId });
  } catch (err) {
    console.error(`[${reqId}] DELETE DOCUMENT ERROR:`, err);
    return c.json({ error: err.message, requestId: reqId }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  EXISTING APPLICATION ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

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
    const result = await rag.ingestRepo(repoUrl, c.env, c.executionCtx);

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

    return c.json({
      success: result.status === 'success',
      status: result.status,
      repoUrl,
      requestId: reqId,
      ...result,
    });

  } catch (err) {
    console.error(`[${reqId}] INGEST ERROR:`, err);
    return c.json({ error: err.message || 'Ingestion failed', requestId: reqId }, 500);
  }
});

// ─── POST /api/ask ────────────────────────────────────────────────────────────
app.post('/api/ask', async (c) => {
  const reqId = c.get('requestId');

  try {
    const body = await c.req.json();
    const { repoUrl, query } = body;

    if (!validateRepoUrl(repoUrl)) return c.json({ error: 'Invalid repoUrl' }, 400);
    if (!validateQuery(query)) return c.json({ error: 'Query must be 1-2000 characters' }, 400);

    const rag = await getRag();
    const response = await rag.handleQuery(repoUrl, query.trim(), c.env);

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
    return c.json({ error: err.message || 'Query failed', requestId: reqId }, 500);
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

  if (!repoUrl) return c.json({ error: 'repoUrl query param is required' }, 400);

  try {
    const supabase = await getSupabase();
    const client = supabase.getSupabaseClient(c.env, true);
    const dbStatus = await supabase.getIngestionStatus(client, repoUrl);

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

  if (!repoUrl) return c.json({ error: 'repoUrl query param is required' }, 400);

  try {
    const supabase = await getSupabase();
    const client = supabase.getSupabaseClient(c.env, true);
    const graph = await supabase.getGraphForRepo(client, repoUrl);

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
export const fetch = app.fetch;