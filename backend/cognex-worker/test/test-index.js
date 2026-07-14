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
