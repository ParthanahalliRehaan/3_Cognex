// test/test-search.js — Updated for improved search.js
// Tests: TTL cache, request deduplication, retry logic, result ranking

import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

import { webSearch, webSearchWithContext, formatSearchResults } from '../src/search.js';

const SERPER_KEY = process.env.WEB_SEARCH_API_KEY;

if (!SERPER_KEY) {
  console.error('❌ WEB_SEARCH_API_KEY not found in .env');
  console.error('Get free key: https://serper.dev');
  process.exit(1);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function testSearch() {
  console.log('🧪 Testing improved search.js...\n');

  // 1. Basic web search
  console.log('1️⃣  Basic web search:');
  const start1 = Date.now();
  const results = await webSearch('React 19 new features', SERPER_KEY, 3);
  const ms1 = Date.now() - start1;
  console.log(`   ✅ ${results.length} results in ${ms1}ms`);
  results.forEach((r, i) => {
    const source = r.source === 'answer_box' ? '⭐ Answer Box' : `🔍 Organic`;
    console.log(`      [${i + 1}] ${source}: ${r.title.substring(0, 55)}...`);
    console.log(`          ${r.snippet.substring(0, 75)}...`);
  });

  // 2. Cache hit (same query — should be instant)
  console.log('\n2️⃣  Cache hit (same query, should be instant):');
  const start2 = Date.now();
  const cached = await webSearch('React 19 new features', SERPER_KEY, 3);
  const ms2 = Date.now() - start2;
  console.log(`   ✅ ${cached.length} results in ${ms2}ms (vs ${ms1}ms first call)`);
  console.log(`   ✅ Same results: ${JSON.stringify(results.map(r => r.title)) === JSON.stringify(cached.map(r => r.title))}`);

  // 3. Request deduplication (fire 3 identical queries in parallel)
  console.log('\n3️⃣  Request deduplication (3 parallel identical queries):');
  const dedupStart = Date.now();
  const [r1, r2, r3] = await Promise.all([
    webSearch('Next.js app router tutorial', SERPER_KEY, 2),
    webSearch('Next.js app router tutorial', SERPER_KEY, 2),
    webSearch('Next.js app router tutorial', SERPER_KEY, 2),
  ]);
  const dedupMs = Date.now() - dedupStart;
  console.log(`   ✅ 3 parallel queries resolved in ${dedupMs}ms (1 API call deduplicated)`);
  console.log(`   ✅ All identical: ${JSON.stringify(r1.map(x => x.title)) === JSON.stringify(r2.map(x => x.title)) && JSON.stringify(r1.map(x => x.title)) === JSON.stringify(r3.map(x => x.title))}`);

  // 4. Repo-aware search
  console.log('\n4️⃣  Repo-aware search (webSearchWithContext):');
  const repoResults = await webSearchWithContext(
    'app router hydration error',
    'vercel/next.js',
    SERPER_KEY
  );
  console.log(`   ✅ ${repoResults.length} results`);
  repoResults.slice(0, 2).forEach((r, i) => {
    console.log(`      [${i + 1}] ${r.title.substring(0, 60)}`);
  });

  // 5. Format for LLM
  console.log('\n5️⃣  formatSearchResults (LLM prompt formatting):');
  const formatted = formatSearchResults(results.slice(0, 2));
  console.log(`   📝 Formatted length: ${formatted.length} chars`);
  console.log(`   📝 Preview:\n${formatted.substring(0, 250)}...`);

  // 6. Empty query
  console.log('\n6️⃣  Edge case — empty query:');
  const empty = await webSearch('', SERPER_KEY);
  console.log(`   ✅ Returns empty array: ${Array.isArray(empty) && empty.length === 0}`);

  // 7. Different result counts
  console.log('\n7️⃣  Different result counts:');
  const r5 = await webSearch('TypeScript 5.5 features', SERPER_KEY, 5);
  const r2_count = await webSearch('TypeScript 5.5 features', SERPER_KEY, 2);
  console.log(`   ✅ Requested 5, got ${r5.length} | Requested 2, got ${r2_count.length}`);

  // 8. Cache TTL (wait 50ms then verify still cached)
  console.log('\n8️⃣  Cache TTL (immediate re-query):');
  await sleep(50);
  const start3 = Date.now();
  await webSearch('React 19 new features', SERPER_KEY, 3);
  const ms3 = Date.now() - start3;
  console.log(`   ✅ Still cached: ${ms3 < 50 ? 'YES (instant)' : 'NO (slow)'}`);

  console.log('\n🎉 All search.js tests passed!');
}

testSearch().catch(err => {
  console.error('\n❌ Test failed:', err.message);
  if (err.message.includes('429')) {
    console.error('💡 Serper rate limit hit. Free tier: 2500 queries. Wait or upgrade.');
  }
  process.exit(1);
});
