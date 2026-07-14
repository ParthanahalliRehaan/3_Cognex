// test/test-rag.js
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

import { handleQuery, ingestRepo } from '../src/rag.js';

async function testRag() {
  console.log('🧪 Testing rag.js...\n');

  const env = process.env;
  const repoUrl = 'https://github.com/vercel/next.js';

  // Test 1: Query (requires pre-ingested data or will have thin context)
  console.log('1️⃣  Testing query handler:');
  try {
    const response = await handleQuery(
      repoUrl,
      'What is the App Router in Next.js?',
      env,
      { matchCount: 3, minDocs: 1 }
    );
    console.log('   ✅ Response received');
    console.log('   📊 Status:', response.status);
    console.log('   📊 Content-Type:', response.headers.get('content-type'));

    // Read first chunk
    const reader = response.body.getReader();
    const { value } = await reader.read();
    const chunk = new TextDecoder().decode(value);
    console.log('   💬 First chunk:', chunk.substring(0, 150));
  } catch (err) {
    console.log('   ⚠️  Query test skipped (no ingested data):', err.message);
  }

  // Test 2: Ingestion (commented out to avoid long runtime — uncomment to test)
  /*
  console.log('\n2️⃣  Testing ingestion (this takes 1-2 minutes):');
  const result = await ingestRepo(repoUrl, env);
  console.log('   ✅ Ingestion complete');
  console.log('   📊 Result:', JSON.stringify(result, null, 2));
  */

  console.log('\n🎉 RAG tests completed!');
}

testRag().catch(err => {
  console.error('❌ Test failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
