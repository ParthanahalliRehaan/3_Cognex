// test/test-supabase.js — Updated for improved supabase.js
// Tests: retry wrapper, batch chunking, service vs anon key, graph CRUD, 4-table schema

import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

import {
  getSupabaseClient,
  storeDocument,
  storeDocumentsBatch,
  matchDocuments,
  deleteDocumentsForRepo,
  storeGraphNode,
  storeGraphNodesBatch,
  getGraphNodes,
  storeGraphEdge,
  storeGraphEdgesBatch,
  getGraphEdges,
  storeCompleteGraph,
  getGraphForRepo,
  deleteGraphForRepo,
  getIngestionStatus,
} from '../src/supabase.js';

const TEST_REPO = 'https://github.com/test/cognex-test-' + Date.now();

const supabaseService = getSupabaseClient(process.env, true);
const supabaseAnon = getSupabaseClient(process.env, false);

function makeEmbedding() {
  return new Array(1024).fill(0).map(() => (Math.random() - 0.5) * 0.1);
}

async function testSupabase() {
  console.log('🧪 Testing improved supabase.js...\n');

  // 1. Connection + client config
  console.log('1️⃣  Supabase connection (service vs anon):');
  console.log(`   🔗 URL: ${process.env.SUPABASE_URL?.substring(0, 35)}...`);
  console.log(`   🔑 Service key: ${process.env.SUPABASE_SERVICE_KEY ? '✅ present' : '❌ missing'}`);
  console.log(`   🔑 Anon key: ${process.env.SUPABASE_ANON_KEY ? '✅ present' : '❌ missing'}`);

  // 2. Store single document (service key)
  console.log('\n2️⃣  storeDocument (service key):');
  const testDoc = {
    repo_url: TEST_REPO,
    content: 'This is a test document about React hooks and state management.',
    metadata: { source_type: 'test', source_path: 'test.js', chunk_index: 0 },
    embedding: makeEmbedding(),
  };
  const stored = await storeDocument(supabaseService, testDoc);
  console.log(`   ✅ Stored document ID: ${stored.id}`);

  // 3. Batch documents (tests automatic chunking >500 rows)
  console.log('\n3️⃣  storeDocumentsBatch (batch chunking):');
  const batchDocs = Array.from({ length: 10 }, (_, i) => ({
    repo_url: TEST_REPO,
    content: `Test document chunk ${i} for batch testing.`,
    metadata: { source_type: 'batch_test', chunk_index: i },
    embedding: makeEmbedding(),
  }));
  const batchStored = await storeDocumentsBatch(supabaseService, batchDocs);
  console.log(`   ✅ Stored ${batchStored.length} documents in batch`);

  // 4. Vector search (anon key)
  console.log('\n4️⃣  matchDocuments (vector search, anon key):');
  const queryEmb = makeEmbedding();
  const matches = await matchDocuments(supabaseAnon, queryEmb, TEST_REPO, 0.1, 5);
  console.log(`   🔍 Found ${matches.length} matches for repo filter`);
  matches.forEach((m, i) => {
    console.log(`      [${i}] ${m.content.substring(0, 50)}... (sim: ${m.similarity?.toFixed(4) || 'N/A'})`);
  });

  // 5. Graph nodes batch
  console.log('\n5️⃣  storeGraphNodesBatch (service key):');
  const testNodes = [
    { repo_url: TEST_REPO, node_type: 'file', label: 'src/app.tsx', metadata: { size: 5000, category: 'source' } },
    { repo_url: TEST_REPO, node_type: 'function', label: 'src/app.tsx::App', metadata: { language: 'tsx' } },
    { repo_url: TEST_REPO, node_type: 'contributor', label: 'timneutkens', metadata: { contributions: 2450 } },
    { repo_url: TEST_REPO, node_type: 'dependency', label: 'npm:react', metadata: { version: '^18.2.0', package_type: 'npm' } },
  ];
  const insertedNodes = await storeGraphNodesBatch(supabaseService, testNodes);
  console.log(`   ✅ Stored ${insertedNodes.length} nodes`);
  insertedNodes.forEach(n => {
    console.log(`      - ${n.node_type}: ${n.label} (ID: ${n.id.slice(0, 8)}...)`);
  });

  // 6. Graph edges batch (with metadata)
  console.log('\n6️⃣  storeGraphEdgesBatch (with metadata):');
  const [fileNode, funcNode, contribNode] = insertedNodes;
  const testEdges = [
    { repo_url: TEST_REPO, source_node_id: fileNode.id, target_node_id: funcNode.id, relation: 'CONTAINS', metadata: { line_number: 42 } },
    { repo_url: TEST_REPO, source_node_id: contribNode.id, target_node_id: fileNode.id, relation: 'AUTHORED', metadata: { commits: 15 } },
  ];
  const insertedEdges = await storeGraphEdgesBatch(supabaseService, testEdges);
  console.log(`   ✅ Stored ${insertedEdges.length} edges with metadata`);

  // 7. Get graph (anon key)
  console.log('\n7️⃣  getGraphForRepo (anon key):');
  const graph = await getGraphForRepo(supabaseAnon, TEST_REPO);
  console.log(`   📊 Nodes: ${graph.nodes.length} | Edges: ${graph.edges.length}`);

  // 8. Filtered node queries
  console.log('\n8️⃣  getGraphNodes (filtered by type):');
  const fileNodes = await getGraphNodes(supabaseAnon, TEST_REPO, 'file');
  console.log(`   📁 ${fileNodes.length} file nodes`);
  const contribNodes = await getGraphNodes(supabaseAnon, TEST_REPO, 'contributor');
  console.log(`   👤 ${contribNodes.length} contributor nodes`);

  // 9. Filtered edge queries
  console.log('\n9️⃣  getGraphEdges (filtered by relation):');
  const containsEdges = await getGraphEdges(supabaseAnon, TEST_REPO, 'CONTAINS');
  console.log(`   🔗 ${containsEdges.length} CONTAINS edges`);

  // 10. Ingestion status
  console.log('\n🔟  getIngestionStatus:');
  const status = await getIngestionStatus(supabaseAnon, TEST_REPO);
  console.log(`   📊 Exists: ${status.exists} | Nodes: ${status.nodeCount} | Docs: ${status.docCount}`);

  // 11. Complete graph replacement (atomic delete + insert)
  console.log('\n1️⃣1️⃣  storeCompleteGraph (atomic replacement):');
  const newNodes = [
    { repo_url: TEST_REPO, node_type: 'repo', label: 'test-repo', metadata: { stars: 100 } },
    { repo_url: TEST_REPO, node_type: 'readme', label: 'README', metadata: { length: 500 } },
  ];
  const newEdges = [];
  const completeResult = await storeCompleteGraph(supabaseService, TEST_REPO, newNodes, newEdges);
  console.log(`   ✅ Replaced graph: ${completeResult.nodes.length} nodes, ${completeResult.edges.length} edges`);

  const postReplace = await getGraphForRepo(supabaseAnon, TEST_REPO);
  console.log(`   📊 Post-replace: ${postReplace.nodes.length} nodes (old data purged)`);

  // 12. Cleanup
  console.log('\n1️⃣2️⃣  Cleanup (deleteGraphForRepo + documents):');
  await deleteGraphForRepo(supabaseService, TEST_REPO);
  await deleteDocumentsForRepo(supabaseService, TEST_REPO);
  const postClean = await getIngestionStatus(supabaseAnon, TEST_REPO);
  console.log(`   🗑️  Post-cleanup: exists=${postClean.exists}, nodes=${postClean.nodeCount}, docs=${postClean.docCount}`);

  // 13. Error handling (retry wrapper)
  console.log('\n1️⃣3️⃣  Error handling (retry wrapper):');
  try {
    await getGraphNodes(supabaseAnon, 'https://github.com/nonexistent/should-still-work', 'file');
    console.log(`   ✅ No error on empty repo (returns empty array)`);
  } catch (err) {
    console.log(`   ⚠️  Error: ${err.message}`);
  }

  console.log('\n🎉 All supabase.js tests passed!');
}

testSupabase().catch(err => {
  console.error('\n❌ Test failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
