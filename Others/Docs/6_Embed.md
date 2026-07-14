## Fixed `embeddings.js` (Cohere — Correct Model, Earlier was HF Model)

```javascript
/**
 * embeddings.js — Embedding Generation Pipeline for Cognex
 * 
 * Uses Cohere Embed API (free tier: 5K calls/month)
 * Model: embed-english-v3.0 → 1024 dimensions
 */

// ─── Configuration ────────────────────────────────────────────────────────────

const COHERE_EMBED_URL = 'https://api.cohere.com/v2/embed';
const COHERE_MODEL = 'embed-english-v3.0';  // ✅ Correct model ID
const EMBEDDING_DIM = 1024;
const MAX_CHUNK_LENGTH = 512;
const CHUNK_OVERLAP = 50;

// ─── Text Chunking ───────────────────────────────────────────────────────────

export function chunkText(text, maxLength = MAX_CHUNK_LENGTH, overlap = CHUNK_OVERLAP) {
  if (!text || text.trim().length === 0) return [''];
  
  const words = text.split(/\s+/);
  if (words.length <= maxLength) return [text];
  
  const chunks = [];
  let i = 0;
  
  while (i < words.length) {
    const chunk = words.slice(i, i + maxLength).join(' ');
    chunks.push(chunk);
    i += maxLength - overlap;
  }
  
  return chunks;
}

export function chunkCode(text, language = 'js') {
  if (!text || text.trim().length === 0) return [''];
  
  let splitRegex;
  
  switch (language) {
    case 'js':
    case 'ts':
    case 'jsx':
    case 'tsx':
      splitRegex = /(?=\n(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type)\s)/;
      break;
    case 'py':
      splitRegex = /(?=\n(?:async\s+)?def\s|class\s)/;
      break;
    case 'go':
      splitRegex = /(?=\nfunc\s|type\s)/;
      break;
    case 'rs':
      splitRegex = /(?=\nfn\s|impl\s|struct\s|enum\s|trait\s)/;
      break;
    default:
      splitRegex = /(?=\n(?:function|def|fn|class)\s)/;
  }
  
  const blocks = text.split(splitRegex).filter(b => b.trim().length > 0);
  
  const result = [];
  for (const block of blocks) {
    const words = block.split(/\s+/);
    if (words.length <= MAX_CHUNK_LENGTH) {
      result.push(block);
    } else {
      result.push(...chunkText(block, MAX_CHUNK_LENGTH, CHUNK_OVERLAP));
    }
  }
  
  return result.length > 0 ? result : [text];
}

// ─── Cohere Embedding API ─────────────────────────────────────────────────────

async function callCohere(texts, apiKey, inputType = 'search_document') {
  if (!apiKey) throw new Error('COHERE_API_KEY not provided');
  if (!texts || texts.length === 0) return [];
  
  const BATCH_SIZE = 96;
  const allEmbeddings = [];
  
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    
    const response = await fetch(COHERE_EMBED_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        texts: batch,
        model: COHERE_MODEL,
        input_type: inputType,
        embedding_types: ['float'],
        truncate: 'END',
      }),
    });
    
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Cohere API error ${response.status}: ${err}`);
    }
    
    const data = await response.json();
    allEmbeddings.push(...data.embeddings.float);
  }
  
  return allEmbeddings;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function generateEmbedding(text, apiKey, isQuery = false) {
  if (!text || text.trim().length === 0) {
    return new Array(EMBEDDING_DIM).fill(0);
  }
  const embeddings = await callCohere([text], apiKey, isQuery ? 'search_query' : 'search_document');
  return embeddings[0];
}

export async function generateEmbeddingsBatch(texts, apiKey, isQuery = false) {
  if (!texts || texts.length === 0) return [];
  return callCohere(texts, apiKey, isQuery ? 'search_query' : 'search_document');
}

export async function prepareDocuments(repoUrl, sourceType, sourcePath, rawText, apiKey, extraMetadata = {}) {
  if (!rawText || rawText.trim().length === 0) return [];
  
  let chunks;
  if (sourceType === 'code') {
    const ext = sourcePath.split('.').pop() || 'js';
    chunks = chunkCode(rawText, ext);
  } else {
    chunks = chunkText(rawText);
  }
  
  const embeddings = await generateEmbeddingsBatch(chunks, apiKey, false);
  
  return chunks.map((chunk, i) => ({
    repo_url: repoUrl,
    content: chunk,
    metadata: {
      source_type: sourceType,
      source_path: sourcePath,
      chunk_index: i,
      total_chunks: chunks.length,
      ...extraMetadata,
    },
    embedding: embeddings[i],
  }));
}

export async function prepareQueryEmbedding(query, apiKey) {
  return generateEmbedding(query, apiKey, true);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function cosineSimilarity(a, b) {
  if (a.length !== b.length) throw new Error('Dimension mismatch');
  
  let dot = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function getEmbeddingDimension() {
  return EMBEDDING_DIM;
}

export default {
  generateEmbedding,
  generateEmbeddingsBatch,
  prepareDocuments,
  prepareQueryEmbedding,
  chunkText,
  chunkCode,
  cosineSimilarity,
  getEmbeddingDimension,
};
```

---

## Full Test: `test/test-embeddings.js`

```javascript
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
```

---

Run it:

```bash
cd test
node test-embeddings.js
```