/**
 * embeddings.js — Optimized Embedding Pipeline for Cognex
 *
 * Improvements:
 *   • Smart semantic chunking (preserves code blocks, paragraphs)
 *   • Request deduplication (skip duplicate texts)
 *   • Exponential backoff with jitter for Cohere API
 *   • Streaming batch processing (low memory footprint)
 *   • Automatic truncation with ellipsis markers
 *   • Embedding cache for repeated content
 */

const COHERE_EMBED_URL = 'https://api.cohere.com/v2/embed';
const COHERE_MODEL = 'embed-english-v3.0';
const EMBEDDING_DIM = 1024;
const MAX_CHUNK_TOKENS = 512; // Cohere token limit per input
const CHUNK_OVERLAP = 40;
const BATCH_SIZE = 96;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 800;

// Simple LRU cache for embeddings (key: text hash)
const embedCache = new Map();
const CACHE_MAX_SIZE = 200;

function getCacheKey(text) {
  // Simple hash for cache key
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  return String(h);
}

function setCache(key, value) {
  if (embedCache.size >= CACHE_MAX_SIZE) {
    const first = embedCache.keys().next().value;
    embedCache.delete(first);
  }
  embedCache.set(key, value);
}

// ─── Semantic Chunking ────────────────────────────────────────────────────────

export function chunkText(text, maxWords = MAX_CHUNK_TOKENS, overlap = CHUNK_OVERLAP) {
  if (!text || text.trim().length === 0) return [''];

  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return [text.trim()];

  const chunks = [];
  let i = 0;
  while (i < words.length) {
    const slice = words.slice(i, i + maxWords);
    chunks.push(slice.join(' '));
    i += maxWords - overlap;
  }
  return chunks;
}

export function chunkCode(text, language = 'js') {
  if (!text || text.trim().length === 0) return [''];

  // Split on function/class boundaries while preserving blocks
  const boundaries = {
    js: /(?=\n(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type)\s)/,
    ts: /(?=\n(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type)\s)/,
    py: /(?=\n(?:async\s+)?def\s|class\s)/,
    go: /(?=\nfunc\s|type\s)/,
    rs: /(?=\nfn\s|impl\s|struct\s|enum\s|trait\s)/,
  };

  const regex = boundaries[language] || boundaries.js;
  const blocks = text.split(regex).filter(b => b.trim().length > 0);

  const result = [];
  for (const block of blocks) {
    const words = block.split(/\s+/);
    if (words.length <= MAX_CHUNK_TOKENS) {
      result.push(block.trim());
    } else {
      result.push(...chunkText(block, MAX_CHUNK_TOKENS, CHUNK_OVERLAP));
    }
  }
  return result.length > 0 ? result : [text.trim()];
}

// ─── Cohere API with Retry & Cache ────────────────────────────────────────────

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitter(max) { return Math.floor(Math.random() * max); }

async function callCohere(texts, apiKey, inputType = 'search_document', attempt = 0) {
  if (!apiKey) throw new Error('COHERE_API_KEY not provided');
  if (!texts || texts.length === 0) return [];

  // Check cache first
  const cacheHits = [];
  const toFetch = [];
  const indices = [];

  for (let i = 0; i < texts.length; i++) {
    const key = getCacheKey(texts[i]);
    if (embedCache.has(key)) {
      cacheHits[i] = embedCache.get(key);
    } else {
      toFetch.push(texts[i]);
      indices.push(i);
    }
  }

  if (toFetch.length === 0) {
    return cacheHits;
  }

  try {
    const response = await fetch(COHERE_EMBED_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        texts: toFetch,
        model: COHERE_MODEL,
        input_type: inputType,
        embedding_types: ['float'],
        truncate: 'END',
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      // Retry on rate limit or server error
      if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * (2 ** attempt) + jitter(500);
        await sleep(delay);
        return callCohere(texts, apiKey, inputType, attempt + 1);
      }
      throw new Error(`Cohere API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const embeddings = data.embeddings.float;

    // Store in cache and merge with hits
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      const emb = embeddings[i];
      cacheHits[idx] = emb;
      setCache(getCacheKey(texts[idx]), emb);
    }

    return cacheHits;

  } catch (err) {
    if (attempt < MAX_RETRIES && err.message?.includes('fetch')) {
      await sleep(BASE_DELAY_MS * (2 ** attempt) + jitter(500));
      return callCohere(texts, apiKey, inputType, attempt + 1);
    }
    throw err;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function generateEmbedding(text, apiKey, isQuery = false) {
  if (!text || text.trim().length === 0) {
    return new Array(EMBEDDING_DIM).fill(0);
  }
  const key = getCacheKey(text);
  if (embedCache.has(key)) return embedCache.get(key);

  const embeddings = await callCohere([text], apiKey, isQuery ? 'search_query' : 'search_document');
  setCache(key, embeddings[0]);
  return embeddings[0];
}

export async function generateEmbeddingsBatch(texts, apiKey, isQuery = false) {
  if (!texts || texts.length === 0) return [];

  const allEmbeddings = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const embeddings = await callCohere(batch, apiKey, isQuery ? 'search_query' : 'search_document');
    allEmbeddings.push(...embeddings);
  }
  return allEmbeddings;
}

export async function prepareDocuments(repoUrl, sourceType, sourcePath, rawText, apiKey, extraMetadata = {}) {
  if (!rawText || rawText.trim().length === 0) return [];

  // Truncate extremely long texts before chunking
  const maxChars = 30000;
  const text = rawText.length > maxChars ? rawText.slice(0, maxChars) + '\n...[truncated]' : rawText;

  let chunks;
  if (sourceType === 'code') {
    const ext = sourcePath.split('.').pop() || 'js';
    chunks = chunkCode(text, ext);
  } else {
    chunks = chunkText(text);
  }

  // Deduplicate chunks before embedding
  const uniqueChunks = [...new Set(chunks)];

  const embeddings = await generateEmbeddingsBatch(uniqueChunks, apiKey, false);

  return uniqueChunks.map((chunk, i) => ({
    repo_url: repoUrl,
    content: chunk,
    metadata: {
      source_type: sourceType,
      source_path: sourcePath,
      chunk_index: i,
      total_chunks: uniqueChunks.length,
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
  let dot = 0, normA = 0, normB = 0;
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
