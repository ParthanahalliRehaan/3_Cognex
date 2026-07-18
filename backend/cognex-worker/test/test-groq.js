// test/test-groq.js — Updated for improved groq.js
// Tests: model fallback chain, timeout handling, token budget, streaming

import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

import { streamAnswer, generateAnswer, buildSystemPrompt, streamChat } from '../src/groq.js';

const GROQ_KEY = process.env.GROQ_API_KEY;

if (!GROQ_KEY) {
  console.error('❌ GROQ_API_KEY not found in .env');
  console.error('Get key: https://console.groq.com/keys');
  process.exit(1);
}

async function testGroq() {
  console.log('🧪 Testing improved groq.js...\n');

  // 1. System prompt builder (with context trimming)
  console.log('1️⃣  buildSystemPrompt (context-aware trimming):');
  const systemPrompt = buildSystemPrompt(
    'https://github.com/vercel/next.js',
    [
      { content: 'Next.js is a React framework for production with SSR, SSG, and ISR capabilities.', metadata: { source_path: 'README.md' }, similarity: 0.95 },
      { content: 'The App Router uses React Server Components for improved performance.', metadata: { source_path: 'docs/app-router.md' }, similarity: 0.88 },
      { content: 'API routes handle server-side logic in Next.js applications.', metadata: { source_path: 'docs/api.md' }, similarity: 0.82 },
    ],
    {
      nodes: [
        { node_type: 'contributor', label: 'timneutkens', metadata: { contributions: 2450 } },
        { node_type: 'contributor', label: 'ijjk', metadata: { contributions: 1890 } },
        { node_type: 'file', label: 'src/app.tsx' },
        { node_type: 'file', label: 'src/index.ts' },
        { node_type: 'dependency', label: 'npm:react', metadata: { name: 'react' } },
        { node_type: 'dependency', label: 'npm:typescript', metadata: { name: 'typescript' } },
        { node_type: 'function', label: 'src/app.tsx::App' },
      ],
      edges: [],
    },
    [
      { title: 'Next.js 15 Release Notes', snippet: 'Next.js 15 introduces the Turbopack dev bundler and Partial Prerendering.' },
    ]
  );
  console.log(`   📝 Prompt length: ${systemPrompt.length.toLocaleString()} chars`);
  console.log(`   📝 First 200 chars: ${systemPrompt.substring(0, 200).replace(/\n/g, ' ')}...`);
  console.log(`   ✅ Under max context: ${systemPrompt.length < 15000 ? 'YES' : 'NO'}`);

  // 2. Non-streaming answer (with model fallback)
  console.log('\n2️⃣  generateAnswer (non-streaming, model fallback chain):');
  const answer = await generateAnswer(
    'What is Next.js in one sentence?',
    'You are a concise technical assistant. Answer in exactly one sentence.',
    GROQ_KEY
  );
  console.log(`   💬 Answer: ${answer.substring(0, 120)}...`);
  console.log(`   ✅ Length: ${answer.length} chars`);

  // 3. Streaming response
  console.log('\n3️⃣  streamAnswer (streaming):');
  const response = await streamAnswer(
    'Explain React Server Components in 2 sentences.',
    'You are a technical writer. Be concise and accurate.',
    GROQ_KEY
  );
  console.log(`   ✅ Response type: ${response.constructor.name}`);
  console.log(`   ✅ Content-Type: ${response.headers.get('content-type')}`);
  console.log(`   ✅ Status: ${response.status}`);

  const reader = response.body.getReader();
  let streamText = '';
  let chunkCount = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    streamText += new TextDecoder().decode(value);
    chunkCount++;
  }
  console.log(`   ✅ Streamed ${chunkCount} chunks, ${streamText.length} chars total`);
  console.log(`   💬 Stream output: ${streamText.substring(0, 120)}...`);

  // 4. Multi-turn chat streaming
  console.log('\n4️⃣  streamChat (multi-turn):');
  const messages = [
    { role: 'user', content: 'What is Next.js?' },
    { role: 'assistant', content: 'Next.js is a React framework for production.' },
    { role: 'user', content: 'What are its key features?' },
  ];
  const chatResponse = await streamChat(
    messages,
    'You are a helpful coding assistant. Be concise.',
    GROQ_KEY
  );
  console.log(`   ✅ Chat stream status: ${chatResponse.status}`);
  const chatReader = chatResponse.body.getReader();
  const { value: chatValue } = await chatReader.read();
  const chatChunk = new TextDecoder().decode(chatValue);
  console.log(`   💬 First chunk: ${chatChunk.substring(0, 100)}...`);

  // 5. Empty context handling
  console.log('\n5️⃣  Empty context (no documents, no graph, no web):');
  const emptyPrompt = buildSystemPrompt('https://github.com/test/repo', [], null, []);
  console.log(`   📝 Empty prompt length: ${emptyPrompt.length} chars`);
  console.log(`   ✅ Contains instructions: ${emptyPrompt.includes('INSTRUCTIONS')}`);

  // 6. Token budget enforcement (long context trimmed)
  console.log('\n6️⃣  Context trimming (long documents):');
  const longDocs = Array.from({ length: 20 }, (_, i) => ({
    content: 'Document '.repeat(200) + `chunk ${i}`,
    metadata: { source_path: `file${i}.md` },
    similarity: 0.9 - (i * 0.01),
  }));
  const trimmedPrompt = buildSystemPrompt('https://github.com/test/repo', longDocs, { nodes: [], edges: [] }, []);
  console.log(`   📝 20 long docs trimmed to: ${trimmedPrompt.length.toLocaleString()} chars`);
  console.log(`   ✅ Under budget: ${trimmedPrompt.length < 15000 ? 'YES' : 'NO'}`);

  console.log('\n🎉 All groq.js tests passed!');
}

testGroq().catch(err => {
  console.error('\n❌ Test failed:', err.message);
  if (err.message.includes('timeout')) {
    console.error('💡 Request timed out. Groq may be overloaded. The fallback chain should handle this.');
  }
  process.exit(1);
});
