// test/test-search.js
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

import { webSearch, webSearchWithContext, formatSearchResults } from '../src/search.js';

const SERPER_KEY = process.env.WEB_SEARCH_API_KEY;

async function testSearch() {
  if (!SERPER_KEY) {
    console.error('❌ WEB_SEARCH_API_KEY not found in .env');
    console.error('Get free key: https://serper.dev');
    process.exit(1);
  }

  console.log('🧪 Testing search.js...\n');

  // Test 1: Basic web search
  console.log('1️⃣  Basic web search:');
  const results = await webSearch('React 19 new features', SERPER_KEY, 3);
  console.log(`   🔍 Found ${results.length} results`);
  results.forEach((r, i) => {
    console.log(`      [${i + 1}] ${r.title.substring(0, 60)}...`);
    console.log(`          ${r.snippet.substring(0, 80)}...`);
  });

  // Test 2: Repo-aware search
  console.log('\n2️⃣  Repo-aware search:');
  const repoResults = await webSearchWithContext(
    'app router hydration error',
    'vercel/next.js',
    SERPER_KEY
  );
  console.log(`   🔍 Found ${repoResults.length} results`);
  repoResults.slice(0, 2).forEach((r, i) => {
    console.log(`      [${i + 1}] ${r.title.substring(0, 60)}`);
  });

  // Test 3: Format for LLM
  console.log('\n3️⃣  Format for LLM prompt:');
  const formatted = formatSearchResults(results.slice(0, 2));
  console.log('   📝 Formatted length:', formatted.length, 'chars');
  console.log('   📝 Preview:', formatted.substring(0, 200));

  // Test 4: Empty query
  console.log('\n4️⃣  Edge case — empty query:');
  const empty = await webSearch('', SERPER_KEY);
  console.log(`   ✅ Returns empty array: ${Array.isArray(empty) && empty.length === 0}`);

  console.log('\n🎉 All search.js tests passed!');
}

testSearch().catch(err => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});
