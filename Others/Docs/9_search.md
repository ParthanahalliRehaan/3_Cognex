## What `search.js` Does

This module provides a fallback when the knowledge graph + embeddings don't have enough context. It queries Serper.dev (Google Search API) and returns structured results.

---

## The Code: `backend/cognex-worker/src/search.js`

```javascript
/**
 * search.js — Web Search Integration for Cognex
 * 
 * Uses Serper.dev (Google Search API, 2500 free queries)
 * Falls back when repo context is insufficient.
 */

// ─── Configuration ────────────────────────────────────────────────────────────

const SERPER_API_URL = 'https://google.serper.dev/search';
const DEFAULT_SEARCH_COUNT = 5;

// ─── Serper.dev Search ────────────────────────────────────────────────────────

/**
 * Perform a web search via Serper.dev
 * 
 * @param {string} query - Search query
 * @param {string} apiKey - Serper API key
 * @param {number} numResults - Max results (default 5)
 * @returns {Promise<Array>} - Array of { title, link, snippet, date }
 */
export async function webSearch(query, apiKey, numResults = DEFAULT_SEARCH_COUNT) {
  if (!apiKey) throw new Error('WEB_SEARCH_API_KEY (Serper) is required');
  if (!query || query.trim().length === 0) return [];
  
  const response = await fetch(SERPER_API_URL, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: query,
      num: numResults,
      gl: 'us',      // Country: US
      hl: 'en',      // Language: English
    }),
  });
  
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Serper API error ${response.status}: ${err}`);
  }
  
  const data = await response.json();
  
  // Parse organic search results
  const results = [];
  
  if (data.organic && Array.isArray(data.organic)) {
    for (const item of data.organic.slice(0, numResults)) {
      results.push({
        title: item.title || 'No title',
        link: item.link || '',
        snippet: item.snippet || '',
        date: item.date || null,
        source: 'organic',
      });
    }
  }
  
  // Include answer box if present (featured snippet)
  if (data.answerBox) {
    results.unshift({
      title: data.answerBox.title || 'Answer Box',
      link: data.answerBox.link || '',
      snippet: data.answerBox.answer || data.answerBox.snippet || '',
      date: null,
      source: 'answer_box',
    });
  }
  
  return results;
}

/**
 * Search with a repo-aware query prefix
 * Automatically prepends repo name for better context
 * 
 * @param {string} query - User's raw query
 * @param {string} repoName - e.g., "vercel/next.js"
 * @param {string} apiKey - Serper API key
 * @returns {Promise<Array>}
 */
export async function webSearchWithContext(query, repoName, apiKey) {
  const enhancedQuery = `${query} ${repoName} github`;
  return webSearch(enhancedQuery, apiKey);
}

// ─── Result Formatting ────────────────────────────────────────────────────────

/**
 * Format search results for inclusion in LLM prompt
 * 
 * @param {Array} results - From webSearch()
 * @returns {string} - Formatted text block
 */
export function formatSearchResults(results) {
  if (!results || results.length === 0) return 'No web search results found.';
  
  return results
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.link}\n${r.snippet}`)
    .join('\n\n');
}

// ─── Default Export ───────────────────────────────────────────────────────────

export default {
  webSearch,
  webSearchWithContext,
  formatSearchResults,
};
```

---

## Test File: `test/test-search.js`

```javascript
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
```

---

## `.env` Checklist

```bash
WEB_SEARCH_API_KEY=your-serper-key  # From serper.dev
```

---

## Run

```bash
cd test
node test-search.js
```
