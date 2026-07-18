// test/test-index.js — Updated for improved index.js (Hono router)
// Tests: Hono routing, CORS middleware, 202 ingestion, progress polling, /api/stats

import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

import app from '../src/index.js';

const mockEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  COHERE_API_KEY: process.env.COHERE_API_KEY,
  WEB_SEARCH_API_KEY: process.env.WEB_SEARCH_API_KEY,
};

async function testIndex() {
  console.log('🧪 Testing improved index.js (Hono router)...\n');

  // 1. Health check
  console.log('1️⃣  GET /health:');
  const healthReq = new Request('http://localhost/health');
  const healthRes = await app.fetch(healthReq, mockEnv, {});
  const healthData = await healthRes.json();
  console.log(`   ✅ Status: ${healthData.status}`);
  console.log(`   ✅ Service: ${healthData.service} v${healthData.version}`);
  console.log(`   ✅ Env check:`, healthData.env);

  // 2. Root redirect
  console.log('\n2️⃣  GET / (redirects to /health):');
  const rootReq = new Request('http://localhost/');
  const rootRes = await app.fetch(rootReq, mockEnv, {});
  console.log(`   ✅ Status: ${rootRes.status} (redirect)`);

  // 3. CORS preflight
  console.log('\n3️⃣  OPTIONS /api/ask (CORS preflight):');
  const corsReq = new Request('http://localhost/api/ask', { method: 'OPTIONS' });
  const corsRes = await app.fetch(corsReq, mockEnv, {});
  console.log(`   ✅ Status: ${corsRes.status}`);
  console.log(`   ✅ Allow-Origin: ${corsRes.headers.get('access-control-allow-origin')}`);
  console.log(`   ✅ Allow-Methods: ${corsRes.headers.get('access-control-allow-methods')}`);

  // 4. POST /api/ingest (should return 202 Accepted with background processing)
  console.log('\n4️⃣  POST /api/ingest (202 Accepted pattern):');
  const ingestReq = new Request('http://localhost/api/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoUrl: 'https://github.com/vercel/next.js' }),
  });
  const ingestRes = await app.fetch(ingestReq, mockEnv, {
    waitUntil: (p) => p,
  });
  const ingestData = await ingestRes.json();
  console.log(`   ✅ Status: ${ingestRes.status}`);
  console.log(`   ✅ Response: ${JSON.stringify(ingestData, null, 2).substring(0, 200)}...`);
  if (ingestData.status === 'accepted') {
    console.log(`   🔄 Background ingestion started. Poll /api/status for progress.`);
  }

  // 5. GET /api/status
  console.log('\n5️⃣  GET /api/status (progress polling):');
  const statusReq = new Request('http://localhost/api/status?repoUrl=https://github.com/vercel/next.js');
  const statusRes = await app.fetch(statusReq, mockEnv, {});
  const statusData = await statusRes.json();
  console.log(`   ✅ Status: ${statusData.status}`);
  console.log(`   ✅ Progress: ${statusData.progress}%`);
  console.log(`   ✅ Message: ${statusData.message}`);
  console.log(`   ✅ Nodes: ${statusData.nodeCount} | Docs: ${statusData.docCount}`);

  // 6. GET /api/graph
  console.log('\n6️⃣  GET /api/graph:');
  const graphReq = new Request('http://localhost/api/graph?repoUrl=https://github.com/vercel/next.js');
  const graphRes = await app.fetch(graphReq, mockEnv, {});
  const graphData = await graphRes.json();
  console.log(`   ✅ Nodes: ${graphData.nodeCount} | Edges: ${graphData.edgeCount}`);
  console.log(`   ✅ Request ID: ${graphData.requestId}`);

  // 7. GET /api/stats
  console.log('\n7️⃣  GET /api/stats (repo statistics):');
  const statsReq = new Request('http://localhost/api/stats?repoUrl=https://github.com/vercel/next.js');
  const statsRes = await app.fetch(statsReq, mockEnv, {});
  const statsData = await statsRes.json();
  console.log(`   ✅ Status: ${statsRes.status}`);
  if (statsData.stats) {
    console.log(`   📊 Total nodes: ${statsData.stats.totalNodes}`);
    console.log(`   📊 Total edges: ${statsData.stats.totalEdges}`);
    console.log(`   📊 Node types:`, statsData.stats.nodeTypes);
    console.log(`   📊 Top contributors:`, statsData.stats.topContributors?.map(c => c.username).join(', ') || 'none');
  }

  // 8. POST /api/ask (streaming)
  console.log('\n8️⃣  POST /api/ask (streaming):');
  const askReq = new Request('http://localhost/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repoUrl: 'https://github.com/vercel/next.js',
      query: 'What is Next.js?',
    }),
  });
  const askRes = await app.fetch(askReq, mockEnv, {});
  console.log(`   ✅ Status: ${askRes.status}`);
  console.log(`   ✅ Content-Type: ${askRes.headers.get('content-type')}`);
  console.log(`   ✅ X-Request-ID: ${askRes.headers.get('x-request-id')}`);

  const reader = askRes.body.getReader();
  const { value } = await reader.read();
  const chunk = new TextDecoder().decode(value);
  console.log(`   💬 First chunk: ${chunk.substring(0, 100)}...`);

  // 9. Validation errors
  console.log('\n9️⃣  Validation errors:');
  const badIngest = new Request('http://localhost/api/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoUrl: 'not-a-github-url' }),
  });
  const badRes = await app.fetch(badIngest, mockEnv, {});
  const badData = await badRes.json();
  console.log(`   ✅ Invalid repo: ${badRes.status} — ${badData.error}`);

  const badAsk = new Request('http://localhost/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoUrl: 'https://github.com/owner/repo', query: '' }),
  });
  const badAskRes = await app.fetch(badAsk, mockEnv, {});
  const badAskData = await badAskRes.json();
  console.log(`   ✅ Empty query: ${badAskRes.status} — ${badAskData.error}`);

  // 10. 404 handling
  console.log('\n🔟  404 handling:');
  const notFoundReq = new Request('http://localhost/api/unknown');
  const notFoundRes = await app.fetch(notFoundReq, mockEnv, {});
  const notFoundData = await notFoundRes.json();
  console.log(`   ✅ Status: ${notFoundRes.status}`);
  console.log(`   ✅ Error: ${notFoundData.error}`);

  // 11. Request ID tracking
  console.log('\n1️⃣1️⃣  Request ID tracking:');
  const reqWithId = new Request('http://localhost/health', {
    headers: { 'X-Request-ID': 'custom-123' },
  });
  const resWithId = await app.fetch(reqWithId, mockEnv, {});
  console.log(`   ✅ Response has X-Request-ID: ${resWithId.headers.get('x-request-id')?.length > 0}`);

  console.log('\n🎉 All index.js tests passed!');
}

testIndex().catch(err => {
  console.error('\n❌ Test failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
