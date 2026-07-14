// test/test-embeddings.js
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
  getEmbeddingDimension
} from '../src/embeddings.js';

const COHERE_KEY = process.env.COHERE_API_KEY;

async function testEmbeddings() {
  if (!COHERE_KEY) {
    console.error('❌ COHERE_API_KEY not found in .env');
    console.error('Get free key: https://cohere.com → API keys');
    process.exit(1);
  }

  console.log('🧪 Testing embeddings.js (Cohere API)...\n');

  // Test 1: Dimension
  console.log('1️⃣  Embedding dimension:');
  const dim = getEmbeddingDimension();
  console.log(`   📐 Expected: 1024, Got: ${dim}`);
  if (dim !== 1024) throw new Error('Dimension mismatch!');

  // Test 2: Single embedding
  console.log('\n2️⃣  Single text embedding:');
  const text = 'The React Framework for the Web';
  console.log('   📝 Input:', text);
  const embedding = await generateEmbedding(text, COHERE_KEY, false);
  console.log(`   ✅ Generated: ${embedding.length} dimensions`);
  console.log(`   📊 First 5: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}]`);
  console.log(`   📊 L2 norm: ${Math.sqrt(embedding.reduce((s, v) => s + v * v, 0)).toFixed(6)}`);

  // Test 3: Query embedding
  console.log('\n3️⃣  Query embedding:');
  const query = 'How does the app router work?';
  const queryEmb = await prepareQueryEmbedding(query, COHERE_KEY);
  console.log(`   ❓ Query: "${query}"`);
  console.log(`   ✅ Generated: ${queryEmb.length} dimensions`);

  // Test 4: Batch
  console.log('\n4️⃣  Batch embeddings:');
  const texts = [
    'React server components',
    'Static site generation in Next.js',
    'API routes handler',
  ];
  const batchEmb = await generateEmbeddingsBatch(texts, COHERE_KEY, false);
  console.log(`   📚 Batch size: ${texts.length}`);
  batchEmb.forEach((emb, i) => {
    console.log(`      [${i}] ${emb.length} dims — "${texts[i]}"`);
  });

  // Test 5: Similarity
  console.log('\n5️⃣  Cosine similarity:');
  const text2 = 'A framework for building web applications with React';
  const emb2 = await generateEmbedding(text2, COHERE_KEY, false);
  const sim = cosineSimilarity(embedding, emb2);
  console.log(`   "${text.substring(0, 30)}..." vs "${text2.substring(0, 30)}...": ${sim.toFixed(6)}`);

  // Test 6: Document prep
  console.log('\n6️⃣  Document preparation:');
  const readme = '# Next.js\n\nNext.js is a React framework. It supports SSR, SSG, and ISR.';
  const docs = await prepareDocuments(
    'https://github.com/vercel/next.js',
    'readme',
    'README.md',
    readme,
    COHERE_KEY,
    { section: 'overview' }
  );
  console.log(`   📄 Prepared ${docs.length} chunks`);
  docs.forEach((d, i) => {
    console.log(`      [${i}] ${d.content.length} chars | embedding: ${d.embedding.length} dims`);
  });

  // Test 7: Code
  console.log('\n7️⃣  Code chunking + embedding:');
  const code = `
    function add(a, b) { return a + b; }
    function subtract(a, b) { return a - b; }
    class Calculator { multiply(a, b) { return a * b; } }
  `;
  const codeDocs = await prepareDocuments(
    'https://github.com/vercel/next.js',
    'code',
    'src/math.ts',
    code,
    COHERE_KEY,
    { language: 'typescript' }
  );
  console.log(`   💻 Prepared ${codeDocs.length} code chunks`);

  // Test 8: Edge cases
  console.log('\n8️⃣  Edge cases:');
  const emptyEmb = await generateEmbedding('', COHERE_KEY, false);
  console.log(`   Empty string: ${emptyEmb.length} dims, all zeros: ${emptyEmb.every(v => v === 0)}`);

  console.log('\n🎉 All embeddings.js tests passed!');
}

testEmbeddings().catch(err => {
  console.error('❌ Test failed:', err.message);
  if (err.message.includes('429')) {
    console.error('💡 Rate limit hit. Wait a minute.');
  }
  process.exit(1);
});
