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
