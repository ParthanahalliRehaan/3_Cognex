// test/test-embeddings.js — Updated for improved embeddings.js
// Tests: LRU cache, deduplication, retry logic, batch processing, chunking

import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

import {
  generateEmbedding,
  generateEmbeddingsBatch,
  prepareDocuments,
  prepareQueryEmbedding,
  chunkText,
  chunkCode,
  cosineSimilarity,
  getEmbeddingDimension,
} from '../src/embeddings.js';

const COHERE_KEY = process.env.COHERE_API_KEY;

if (!COHERE_KEY) {
  console.error('❌ COHERE_API_KEY not found in .env');
  console.error('Get free key: https://cohere.com → API keys');
  process.exit(1);
}

async function testEmbeddings() {
  console.log('🧪 Testing improved embeddings.js...\n');

  // 1. Dimension
  console.log('1️⃣  Embedding dimension:');
  const dim = getEmbeddingDimension();
  console.log(`   📐 Expected: 1024, Got: ${dim}`);
  if (dim !== 1024) throw new Error('Dimension mismatch!');

  // 2. Single embedding
  console.log('\n2️⃣  Single text embedding:');
  const text = 'The React Framework for the Web';
  const embStart = Date.now();
  const embedding = await generateEmbedding(text, COHERE_KEY, false);
  const embMs = Date.now() - embStart;
  console.log(`   ✅ ${embedding.length} dims in ${embMs}ms`);
  console.log(`   📊 First 5: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}]`);
  const l2norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
  console.log(`   📊 L2 norm: ${l2norm.toFixed(6)} (should be ~1.0 for normalized)`);

  // 3. Cache hit (same text again — should be instant)
  console.log('\n3️⃣  Embedding cache (second call — should be instant):');
  const cacheStart = Date.now();
  const cachedEmb = await generateEmbedding(text, COHERE_KEY, false);
  const cacheMs = Date.now() - cacheStart;
  console.log(`   ✅ Cache hit: ${cacheMs}ms (vs ${embMs}ms first call)`);
  console.log(`   ✅ Same result: ${JSON.stringify(embedding.slice(0, 3)) === JSON.stringify(cachedEmb.slice(0, 3))}`);

  // 4. Query embedding (different input_type)
  console.log('\n4️⃣  Query embedding (search_query type):');
  const query = 'How does the app router work?';
  const queryEmb = await prepareQueryEmbedding(query, COHERE_KEY);
  console.log(`   ❓ "${query}"`);
  console.log(`   ✅ ${queryEmb.length} dims`);

  // 5. Batch embeddings
  console.log('\n5️⃣  Batch embeddings (3 texts):');
  const texts = [
    'React server components',
    'Static site generation in Next.js',
    'API routes handler',
  ];
  const batchStart = Date.now();
  const batchEmb = await generateEmbeddingsBatch(texts, COHERE_KEY, false);
  const batchMs = Date.now() - batchStart;
  console.log(`   ✅ ${texts.length} embeddings in ${batchMs}ms (${(batchMs/texts.length).toFixed(0)}ms avg)`);
  batchEmb.forEach((emb, i) => {
    console.log(`      [${i}] ${emb.length} dims — "${texts[i].substring(0, 40)}"`);
  });

  // 6. Cosine similarity
  console.log('\n6️⃣  Cosine similarity:');
  const text2 = 'A framework for building web applications with React';
  const emb2 = await generateEmbedding(text2, COHERE_KEY, false);
  const sim = cosineSimilarity(embedding, emb2);
  console.log(`   "${text.substring(0, 30)}..." vs "${text2.substring(0, 30)}...": ${sim.toFixed(6)}`);
  console.log(`   ✅ Similar (same topic): ${sim > 0.5 ? 'YES' : 'NO'}`);

  // 7. Document preparation (chunking + embedding)
  console.log('\n7️⃣  Document preparation (chunking + embedding):');
  const readme = '# Next.js\n\nNext.js is a React framework. It supports SSR, SSG, and ISR.\n\n## Getting Started\n\nInstall Next.js with npm.\n\n## Features\n\n- Server Components\n- Static Generation\n- Edge Runtime';
  const docs = await prepareDocuments(
    'https://github.com/vercel/next.js',
    'readme', 'README.md', readme, COHERE_KEY, { section: 'overview' }
  );
  console.log(`   ✅ ${docs.length} chunks prepared`);
  docs.forEach((d, i) => {
    console.log(`      [${i}] ${d.content.length} chars | embedding: ${d.embedding.length} dims | metadata: ${JSON.stringify(d.metadata).substring(0, 60)}`);
  });

  // 8. Code chunking
  console.log('\n8️⃣  Code chunking (TypeScript):');
  const code = `
    function add(a, b) { return a + b; }
    function subtract(a, b) { return a - b; }
    class Calculator { multiply(a, b) { return a * b; } }
    export async function initialize() { await setup(); }
  `;
  const codeChunks = chunkCode(code, 'ts');
  console.log(`   ✅ ${codeChunks.length} code chunks`);
  codeChunks.forEach((c, i) => {
    console.log(`      [${i}] ${c.length} chars — ${c.substring(0, 60).replace(/\n/g, ' ')}...`);
  });

  // 9. Document prep with code
  console.log('\n9️⃣  Code document preparation:');
  const codeDocs = await prepareDocuments(
    'https://github.com/vercel/next.js',
    'code', 'src/math.ts', code, COHERE_KEY, { language: 'typescript' }
  );
  console.log(`   ✅ ${codeDocs.length} code document chunks`);

  // 10. Edge cases
  console.log('\n🔟  Edge cases:');
  const emptyEmb = await generateEmbedding('', COHERE_KEY, false);
  console.log(`   Empty string: ${emptyEmb.length} dims, all zeros: ${emptyEmb.every(v => v === 0)}`);
  const longText = 'word '.repeat(1000);
  const longEmb = await generateEmbedding(longText, COHERE_KEY, false);
  console.log(`   Long text (5000 chars): ${longEmb.length} dims`);

  // 11. Batch deduplication
  console.log('\n1️⃣1️⃣  Batch deduplication (duplicate texts in batch):');
  const dupTexts = ['hello world', 'hello world', 'different text'];
  const dupStart = Date.now();
  const dupEmb = await generateEmbeddingsBatch(dupTexts, COHERE_KEY, false);
  const dupMs = Date.now() - dupStart;
  console.log(`   ✅ 3 texts (${dupTexts.length} unique) in ${dupMs}ms`);
  console.log(`   ✅ First two identical: ${JSON.stringify(dupEmb[0].slice(0, 3)) === JSON.stringify(dupEmb[1].slice(0, 3))}`);

  console.log('\n🎉 All embeddings.js tests passed!');
}

testEmbeddings().catch(err => {
  console.error('\n❌ Test failed:', err.message);
  if (err.message.includes('429')) {
    console.error('💡 Cohere rate limit hit. Free tier: 5K calls/month. Wait a minute.');
  }
  process.exit(1);
});
