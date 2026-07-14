## Updated `backend/cognex-worker/src/supabase.js`(Updated the 001_init.sql function)

```javascript
/**
 * supabase.js — Supabase Client & Database Operations for Cognex
 * 
 * Uses Service Role Key for writes (bypasses RLS)
 * Uses Anon Key for reads (follows RLS)
 */

import { createClient } from '@supabase/supabase-js';

// ─── Client Initialization ────────────────────────────────────────────────────

/**
 * Create a Supabase client
 * @param {Object} env - Environment variables
 * @param {boolean} useServiceKey - Use service_role key (for writes)
 * @returns {SupabaseClient}
 */
export function getSupabaseClient(env, useServiceKey = false) {
  const url = env.SUPABASE_URL || process.env.SUPABASE_URL;
  const key = useServiceKey
    ? (env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)
    : (env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY);
  
  if (!url) throw new Error('SUPABASE_URL is required');
  if (!key) throw new Error(`${useServiceKey ? 'SUPABASE_SERVICE_KEY' : 'SUPABASE_ANON_KEY'} is required`);
  
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// ─── Document Operations ──────────────────────────────────────────────────────

/**
 * Store a document with embedding (uses service key)
 */
export async function storeDocument(supabase, doc) {
  const { data, error } = await supabase
    .from('documents')
    .insert({
      repo_url: doc.repo_url,
      content: doc.content,
      metadata: doc.metadata,
      embedding: doc.embedding,
    })
    .select()
    .single();
  
  if (error) throw new Error(`storeDocument failed: ${error.message}`);
  return data;
}

/**
 * Store multiple documents in batch (uses service key)
 */
export async function storeDocumentsBatch(supabase, docs) {
  if (!docs || docs.length === 0) return [];
  
  const { data, error } = await supabase
    .from('documents')
    .insert(docs.map(d => ({
      repo_url: d.repo_url,
      content: d.content,
      metadata: d.metadata,
      embedding: d.embedding,
    })))
    .select();
  
  if (error) throw new Error(`storeDocumentsBatch failed: ${error.message}`);
  return data || [];
}

/**
 * Find similar documents using pgvector cosine similarity
 */
export async function matchDocuments(supabase, queryEmbedding, repoUrl = null, matchThreshold = 0.5, matchCount = 10) {
  const { data, error } = await supabase.rpc('match_documents', {
    query_embedding: queryEmbedding,
    match_threshold: matchThreshold,
    match_count: matchCount,
    filter_repo_url: repoUrl,
  });
  
  if (error) throw new Error(`matchDocuments failed: ${error.message}`);
  return data || [];
}

/**
 * Delete all documents for a repo
 */
export async function deleteDocumentsForRepo(supabase, repoUrl) {
  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('repo_url', repoUrl);
  
  if (error) throw new Error(`deleteDocumentsForRepo failed: ${error.message}`);
}

// ─── Graph Node Operations ────────────────────────────────────────────────────

export async function storeGraphNode(supabase, node) {
  const { data, error } = await supabase
    .from('graph_nodes')
    .insert({
      repo_url: node.repo_url,
      node_type: node.node_type,
      label: node.label,
      metadata: node.metadata,
    })
    .select()
    .single();
  
  if (error) throw new Error(`storeGraphNode failed: ${error.message}`);
  return data;
}

export async function storeGraphNodesBatch(supabase, nodes) {
  if (!nodes || nodes.length === 0) return [];
  
  const { data, error } = await supabase
    .from('graph_nodes')
    .insert(nodes.map(n => ({
      repo_url: n.repo_url,
      node_type: n.node_type,
      label: n.label,
      metadata: n.metadata,
    })))
    .select();
  
  if (error) throw new Error(`storeGraphNodesBatch failed: ${error.message}`);
  return data || [];
}

export async function getGraphNodes(supabase, repoUrl, nodeType = null) {
  let query = supabase
    .from('graph_nodes')
    .select('*')
    .eq('repo_url', repoUrl);
  
  if (nodeType) query = query.eq('node_type', nodeType);
  
  const { data, error } = await query;
  if (error) throw new Error(`getGraphNodes failed: ${error.message}`);
  return data || [];
}

export async function searchGraphNodesByLabel(supabase, repoUrl, searchLabel) {
  const { data, error } = await supabase
    .from('graph_nodes')
    .select('*')
    .eq('repo_url', repoUrl)
    .ilike('label', `%${searchLabel}%`);
  
  if (error) throw new Error(`searchGraphNodesByLabel failed: ${error.message}`);
  return data || [];
}

// ─── Graph Edge Operations ────────────────────────────────────────────────────

export async function storeGraphEdge(supabase, edge) {
  const { data, error } = await supabase
    .from('graph_edges')
    .insert({
      repo_url: edge.repo_url,
      source_node_id: edge.source_node_id,
      target_node_id: edge.target_node_id,
      relation: edge.relation,
      metadata: edge.metadata || {},
    })
    .select()
    .single();
  
  if (error) throw new Error(`storeGraphEdge failed: ${error.message}`);
  return data;
}

export async function storeGraphEdgesBatch(supabase, edges) {
  if (!edges || edges.length === 0) return [];
  
  const { data, error } = await supabase
    .from('graph_edges')
    .insert(edges.map(e => ({
      repo_url: e.repo_url,
      source_node_id: e.source_node_id,
      target_node_id: e.target_node_id,
      relation: e.relation,
      metadata: e.metadata || {},
    })))
    .select();
  
  if (error) throw new Error(`storeGraphEdgesBatch failed: ${error.message}`);
  return data || [];
}

export async function getGraphEdges(supabase, repoUrl, relation = null) {
  let query = supabase
    .from('graph_edges')
    .select('*')
    .eq('repo_url', repoUrl);
  
  if (relation) query = query.eq('relation', relation);
  
  const { data, error } = await query;
  if (error) throw new Error(`getGraphEdges failed: ${error.message}`);
  return data || [];
}

export async function getEdgesForNode(supabase, nodeId) {
  const [incomingResult, outgoingResult] = await Promise.all([
    supabase.from('graph_edges').select('*').eq('target_node_id', nodeId),
    supabase.from('graph_edges').select('*').eq('source_node_id', nodeId),
  ]);
  
  if (incomingResult.error) throw new Error(`getEdgesForNode incoming failed: ${incomingResult.error.message}`);
  if (outgoingResult.error) throw new Error(`getEdgesForNode outgoing failed: ${outgoingResult.error.message}`);
  
  return {
    incoming: incomingResult.data || [],
    outgoing: outgoingResult.data || [],
  };
}

// ─── Combined Graph Operations ────────────────────────────────────────────────

export async function storeCompleteGraph(supabase, repoUrl, nodes, edges) {
  await deleteGraphForRepo(supabase, repoUrl);
  await deleteDocumentsForRepo(supabase, repoUrl);
  
  const insertedNodes = await storeGraphNodesBatch(supabase, nodes);
  
  const labelToId = new Map();
  for (const node of insertedNodes) {
    labelToId.set(node.label, node.id);
  }
  
  const resolvedEdges = edges
    .map(e => {
      const sourceId = labelToId.get(e.source_label);
      const targetId = labelToId.get(e.target_label);
      
      if (!sourceId || !targetId) {
        console.warn(`Skipping edge: cannot resolve "${e.source_label}" → "${e.target_label}"`);
        return null;
      }
      
      return {
        repo_url: e.repo_url,
        source_node_id: sourceId,
        target_node_id: targetId,
        relation: e.relation,
        metadata: e.metadata,
      };
    })
    .filter(Boolean);
  
  const insertedEdges = await storeGraphEdgesBatch(supabase, resolvedEdges);
  
  return { nodes: insertedNodes, edges: insertedEdges };
}

export async function getGraphForRepo(supabase, repoUrl) {
  const [nodes, edges] = await Promise.all([
    getGraphNodes(supabase, repoUrl),
    getGraphEdges(supabase, repoUrl),
  ]);
  
  return { nodes, edges };
}

export async function deleteGraphForRepo(supabase, repoUrl) {
  const { error: edgeError } = await supabase
    .from('graph_edges')
    .delete()
    .eq('repo_url', repoUrl);
  
  if (edgeError) throw new Error(`deleteGraph edges failed: ${edgeError.message}`);
  
  const { error: nodeError } = await supabase
    .from('graph_nodes')
    .delete()
    .eq('repo_url', repoUrl);
  
  if (nodeError) throw new Error(`deleteGraph nodes failed: ${nodeError.message}`);
}

// ─── Ingestion Status ─────────────────────────────────────────────────────────

export async function getIngestionStatus(supabase, repoUrl) {
  const [{ count: nodeCount }, { count: docCount }] = await Promise.all([
    supabase.from('graph_nodes').select('*', { count: 'exact', head: true }).eq('repo_url', repoUrl),
    supabase.from('documents').select('*', { count: 'exact', head: true }).eq('repo_url', repoUrl),
  ]);
  
  return {
    exists: (nodeCount > 0) || (docCount > 0),
    nodeCount: nodeCount || 0,
    docCount: docCount || 0,
  };
}

export default {
  getSupabaseClient,
  storeDocument,
  storeDocumentsBatch,
  matchDocuments,
  deleteDocumentsForRepo,
  storeGraphNode,
  storeGraphNodesBatch,
  getGraphNodes,
  searchGraphNodesByLabel,
  storeGraphEdge,
  storeGraphEdgesBatch,
  getGraphEdges,
  getEdgesForNode,
  storeCompleteGraph,
  getGraphForRepo,
  deleteGraphForRepo,
  getIngestionStatus,
};
```

---

## Updated Test: `test/test-supabase.js`

```javascript
// test/test-supabase.js
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

import { getSupabaseClient, storeDocument, matchDocuments, getIngestionStatus, storeGraphNodesBatch, getGraphForRepo, deleteGraphForRepo } from '../src/supabase.js';

// Use service key for writes
const supabaseService = getSupabaseClient(process.env, true);
// Use anon key for reads
const supabaseAnon = getSupabaseClient(process.env, false);

async function testSupabase() {
  console.log('🧪 Testing supabase.js...\n');

  // Test 1: Connection
  console.log('1️⃣  Supabase connection:');
  console.log(`   🔗 URL: ${process.env.SUPABASE_URL?.substring(0, 35)}...`);
  console.log(`   🔑 Service key: ${process.env.SUPABASE_SERVICE_KEY ? '✅ present' : '❌ missing'}`);

  // Test 2: Store document with service key
  console.log('\n2️⃣  Storing test document (service key):');
  const testDoc = {
    repo_url: 'https://github.com/test/repo',
    content: 'This is a test document about React hooks and state management.',
    metadata: { source_type: 'test', source_path: 'test.js' },
    embedding: new Array(1024).fill(0).map(() => (Math.random() - 0.5) * 0.1),
  };
  const stored = await storeDocument(supabaseService, testDoc);
  console.log(`   ✅ Stored document ID: ${stored.id}`);

  // Test 3: Vector search with anon key
  console.log('\n3️⃣  Vector similarity search (anon key):');
  const queryEmb = new Array(1024).fill(0).map(() => (Math.random() - 0.5) * 0.1);
  const matches = await matchDocuments(supabaseAnon, queryEmb, null, 0.1, 5);
  console.log(`   🔍 Found ${matches.length} matches`);

  // Test 4: Store graph nodes
  console.log('\n4️⃣  Storing graph nodes (service key):');
  const testNodes = [
    { repo_url: 'https://github.com/test/repo', node_type: 'file', label: 'src/app.tsx', metadata: { size: 5000 } },
    { repo_url: 'https://github.com/test/repo', node_type: 'function', label: 'src/app.tsx::App', metadata: { language: 'tsx' } },
    { repo_url: 'https://github.com/test/repo', node_type: 'contributor', label: 'timneutkens', metadata: { contributions: 2450 } },
  ];
  const insertedNodes = await storeGraphNodesBatch(supabaseService, testNodes);
  console.log(`   ✅ Stored ${insertedNodes.length} nodes`);
  insertedNodes.forEach(n => {
    console.log(`      - ${n.node_type}: ${n.label} (ID: ${n.id.slice(0, 8)}...)`);
  });

  // Test 5: Get graph
  console.log('\n5️⃣  Retrieving graph (anon key):');
  const graph = await getGraphForRepo(supabaseAnon, 'https://github.com/test/repo');
  console.log(`   📊 Nodes: ${graph.nodes.length}, Edges: ${graph.edges.length}`);

  // Test 6: Ingestion status
  console.log('\n6️⃣  Ingestion status:');
  const status = await getIngestionStatus(supabaseAnon, 'https://github.com/test/repo');
  console.log(`   📊 Exists: ${status.exists}, Nodes: ${status.nodeCount}, Docs: ${status.docCount}`);

  // Test 7: Cleanup
  console.log('\n7️⃣  Cleaning up test data:');
  await deleteGraphForRepo(supabaseService, 'https://github.com/test/repo');
  await supabaseService.from('documents').delete().eq('repo_url', 'https://github.com/test/repo');
  console.log('   🗑️  Test data deleted');

  console.log('\n🎉 All supabase.js tests passed!');
}

testSupabase().catch(err => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});
```

---

## `.env` Update

Add your **Service Role Key** (from Supabase → Project Settings → API → `service_role`):

```bash
SUPABASE_URL=https://zvdgqyehjfxozxrzybtb.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...  # <-- Add this (starts with eyJ, labeled "service_role")
COHERE_API_KEY=your-cohere-key
GROQ_API_KEY=your-groq-key
GITHUB_TOKEN=ghp_...
WEB_SEARCH_API_KEY=your-serper-key
```

---

## Run

```bash
cd test
node test-supabase.js
```
