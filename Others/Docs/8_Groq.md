## What `groq.js` Does

This module:
- Creates a Groq client using the Vercel AI SDK
- Streams chat completions for fast, low-latency answers
- Uses `llama-3.3-70b-versatile` (fast, capable, cheap)
- Returns a standard `Response` object with a text stream

---

## The Code: `backend/cognex-worker/src/groq.js`

```javascript
/**
 * groq.js — Groq API Client for Streaming LLM Responses
 * 
 * Uses Vercel AI SDK for clean streaming abstractions.
 * Model: llama-3.3-70b-versatile (fast inference via Groq)
 */

import { createGroq } from '@ai-sdk/groq';
import { streamText } from 'ai';

// ─── Configuration ────────────────────────────────────────────────────────────

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_TEMPERATURE = 0.3;  // Low = factual, high = creative
const DEFAULT_MAX_TOKENS = 2048;

// ─── Client Factory ───────────────────────────────────────────────────────────

/**
 * Create a Groq client instance
 * @param {string} apiKey - Groq API key
 * @returns {GroqProvider}
 */
function getGroqClient(apiKey) {
  if (!apiKey) throw new Error('GROQ_API_KEY is required');
  return createGroq({ apiKey });
}

// ─── Streaming Response ───────────────────────────────────────────────────────

/**
 * Stream an LLM answer with full context
 * 
 * @param {string} userPrompt - The user's question
 * @param {string} systemPrompt - System instructions + retrieved context
 * @param {string} apiKey - Groq API key
 * @param {Object} options - Optional overrides
 * @returns {Promise<Response>} - Streaming text response
 */
export async function streamAnswer(userPrompt, systemPrompt, apiKey, options = {}) {
  const groq = getGroqClient(apiKey);
  
  const result = streamText({
    model: groq(options.model || DEFAULT_MODEL),
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
  });
  
  // Returns a standard Web API Response with a text stream
  return result.toTextStreamResponse();
}

/**
 * Stream an answer with message history (for multi-turn chat)
 * 
 * @param {Array} messages - Array of {role, content} objects
 * @param {string} systemPrompt - System context
 * @param {string} apiKey - Groq API key
 * @param {Object} options - Optional overrides
 * @returns {Promise<Response>}
 */
export async function streamChat(messages, systemPrompt, apiKey, options = {}) {
  const groq = getGroqClient(apiKey);
  
  const result = streamText({
    model: groq(options.model || DEFAULT_MODEL),
    system: systemPrompt,
    messages,
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
  });
  
  return result.toTextStreamResponse();
}

// ─── Non-Streaming (for testing/debugging) ────────────────────────────────────

/**
 * Generate a non-streaming response (for testing or simple queries)
 * 
 * @param {string} userPrompt
 * @param {string} systemPrompt
 * @param {string} apiKey
 * @returns {Promise<string>} - Full text response
 */
export async function generateAnswer(userPrompt, systemPrompt, apiKey) {
  const groq = getGroqClient(apiKey);
  
  const { text } = await streamText({
    model: groq(DEFAULT_MODEL),
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: DEFAULT_TEMPERATURE,
    maxTokens: DEFAULT_MAX_TOKENS,
  });
  
  return text;
}

// ─── System Prompt Builder ────────────────────────────────────────────────────

/**
 * Build a rich system prompt for the RAG agent
 * 
 * @param {string} repoUrl - Repository being queried
 * @param {Array} documents - Retrieved document chunks
 * @param {Object} graph - { nodes, edges } from knowledge graph
 * @param {Array} webResults - Optional web search results
 * @returns {string} - Formatted system prompt
 */
export function buildSystemPrompt(repoUrl, documents = [], graph = null, webResults = []) {
  const parts = [
    `You are Cognex, an AI assistant that answers questions about GitHub repositories.`,
    `You have access to the following context about the repository ${repoUrl}:`,
    '',
  ];
  
  // Documents section
  if (documents.length > 0) {
    parts.push('--- RELEVANT DOCUMENTS ---');
    documents.forEach((doc, i) => {
      parts.push(`[${i + 1}] ${doc.metadata?.source_path || 'unknown'} (similarity: ${(doc.similarity || 0).toFixed(3)})`);
      parts.push(doc.content.substring(0, 800)); // Truncate long chunks
      parts.push('');
    });
  }
  
  // Graph section
  if (graph && graph.nodes && graph.nodes.length > 0) {
    parts.push('--- KNOWLEDGE GRAPH CONTEXT ---');
    
    const contributors = graph.nodes.filter(n => n.node_type === 'contributor');
    if (contributors.length > 0) {
      parts.push(`Contributors: ${contributors.map(c => `${c.label} (${c.metadata?.contributions || 0} commits)`).join(', ')}`);
    }
    
    const files = graph.nodes.filter(n => n.node_type === 'file').slice(0, 10);
    if (files.length > 0) {
      parts.push(`Key files: ${files.map(f => f.label).join(', ')}`);
    }
    
    const deps = graph.nodes.filter(n => n.node_type === 'dependency');
    if (deps.length > 0) {
      parts.push(`Dependencies: ${deps.map(d => d.metadata?.name || d.label).join(', ')}`);
    }
    
    parts.push('');
  }
  
  // Web search section
  if (webResults.length > 0) {
    parts.push('--- WEB SEARCH RESULTS ---');
    webResults.forEach((r, i) => {
      parts.push(`[${i + 1}] ${r.title}`);
      parts.push(r.snippet || r.content || '');
      parts.push('');
    });
  }
  
  // Instructions
  parts.push('--- INSTRUCTIONS ---');
  parts.push('Answer the user\'s question based ONLY on the provided context.');
  parts.push('If the context does not contain enough information, say so honestly.');
  parts.push('Cite specific files, contributors, or issues when relevant.');
  parts.push('Be concise but thorough. Use code examples when helpful.');
  
  return parts.join('\n');
}

export default {
  streamAnswer,
  streamChat,
  generateAnswer,
  buildSystemPrompt,
};
```

---

## Test File: `test/test-groq.js`

```javascript
// test/test-groq.js
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

import { streamAnswer, generateAnswer, buildSystemPrompt } from '../src/groq.js';

const GROQ_KEY = process.env.GROQ_API_KEY;

async function testGroq() {
  if (!GROQ_KEY) {
    console.error('❌ GROQ_API_KEY not found in .env');
    console.error('Get key: https://console.groq.com/keys');
    process.exit(1);
  }

  console.log('🧪 Testing groq.js...\n');

  // Test 1: Non-streaming answer
  console.log('1️⃣  Non-streaming answer:');
  const systemPrompt = buildSystemPrompt(
    'https://github.com/vercel/next.js',
    [
      { content: 'Next.js is a React framework for production.', metadata: { source_path: 'README.md' }, similarity: 0.95 },
      { content: 'The App Router uses React Server Components.', metadata: { source_path: 'docs/app-router.md' }, similarity: 0.88 },
    ],
    {
      nodes: [
        { node_type: 'contributor', label: 'timneutkens', metadata: { contributions: 2450 } },
        { node_type: 'file', label: 'src/app.tsx' },
      ],
      edges: [],
    }
  );
  
  const answer = await generateAnswer(
    'What is Next.js and who maintains it?',
    systemPrompt,
    GROQ_KEY
  );
  console.log('   💬 Answer:', answer.substring(0, 200) + '...');

  // Test 2: System prompt builder
  console.log('\n2️⃣  System prompt builder:');
  const prompt = buildSystemPrompt(
    'https://github.com/facebook/react',
    [],
    { nodes: [], edges: [] },
    [{ title: 'React 19 Release', snippet: 'React 19 introduces new hooks...' }]
  );
  console.log('   📝 Prompt length:', prompt.length, 'chars');
  console.log('   📝 First 200 chars:', prompt.substring(0, 200));

  // Test 3: Streaming response (just verify it returns a Response)
  console.log('\n3️⃣  Streaming response:');
  const response = await streamAnswer(
    'Explain React hooks in one sentence.',
    'You are a helpful coding assistant. Be concise.',
    GROQ_KEY
  );
  console.log('   ✅ Response type:', response.constructor.name);
  console.log('   ✅ Content-Type:', response.headers.get('content-type'));
  console.log('   ✅ Status:', response.status);

  // Read a chunk to verify stream works
  const reader = response.body.getReader();
  const { value } = await reader.read();
  const chunk = new TextDecoder().decode(value);
  console.log('   ✅ First chunk:', chunk.substring(0, 100));

  console.log('\n🎉 All groq.js tests passed!');
}

testGroq().catch(err => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});
```

---

## Package Check

Make sure you have the AI SDK packages installed:

```bash
cd backend/cognex-worker
npm install @ai-sdk/groq ai
```

---

## Run

```bash
cd test
node test-groq.js
```
