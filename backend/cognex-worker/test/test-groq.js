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
