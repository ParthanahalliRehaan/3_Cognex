/**
 * search.js — Optimized Web Search Integration for Cognex
 *
 * Improvements:
 *   • Result caching (TTL-based)
 *   • Query deduplication (in-flight request coalescing)
 *   • Automatic retry with backoff
 *   • Result ranking and deduplication
 *   • Structured error classification
 */

const SERPER_API_URL = 'https://google.serper.dev/search';
const DEFAULT_SEARCH_COUNT = 5;
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// In-flight request deduplication
const inFlight = new Map();
const cache = new Map();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitter(max) { return Math.floor(Math.random() * max); }

function getCacheKey(query, count) {
  return `${query.toLowerCase().trim()}|${count}`;
}

function isCacheValid(entry) {
  return entry && (Date.now() - entry.timestamp) < CACHE_TTL_MS;
}

// ─── Core Search ──────────────────────────────────────────────────────────────

export async function webSearch(query, apiKey, numResults = DEFAULT_SEARCH_COUNT) {
  if (!apiKey) throw new Error('WEB_SEARCH_API_KEY (Serper) is required');
  if (!query || query.trim().length === 0) return [];

  const trimmed = query.trim().slice(0, 500); // Serper limit
  const cacheKey = getCacheKey(trimmed, numResults);

  // Check cache
  const cached = cache.get(cacheKey);
  if (isCacheValid(cached)) {
    return cached.data;
  }

  // Deduplicate in-flight requests
  if (inFlight.has(cacheKey)) {
    return inFlight.get(cacheKey);
  }

  const promise = executeSearch(trimmed, apiKey, numResults, cacheKey);
  inFlight.set(cacheKey, promise);

  try {
    const result = await promise;
    return result;
  } finally {
    inFlight.delete(cacheKey);
  }
}

async function executeSearch(query, apiKey, numResults, cacheKey) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(SERPER_API_URL, {
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: query,
          num: numResults,
          gl: 'us',
          hl: 'en',
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text();
        if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
          await sleep(BASE_DELAY_MS * (2 ** attempt) + jitter(500));
          continue;
        }
        throw new Error(`Serper API ${response.status}: ${errText}`);
      }

      const data = await response.json();
      const results = parseResults(data, numResults);

      // Cache successful results
      cache.set(cacheKey, { data: results, timestamp: Date.now() });

      return results;

    } catch (err) {
      if (err.name === 'AbortError') {
        if (attempt < MAX_RETRIES) {
          await sleep(BASE_DELAY_MS + jitter(500));
          continue;
        }
        throw new Error('Serper search timed out');
      }
      if (attempt >= MAX_RETRIES) throw err;
      await sleep(BASE_DELAY_MS * (2 ** attempt) + jitter(500));
    }
  }

  return [];
}

function parseResults(data, maxResults) {
  const results = [];
  const seenUrls = new Set();

  // Answer box first
  if (data.answerBox) {
    results.push({
      title: data.answerBox.title || 'Answer Box',
      link: data.answerBox.link || '',
      snippet: data.answerBox.answer || data.answerBox.snippet || '',
      source: 'answer_box',
    });
    if (data.answerBox.link) seenUrls.add(data.answerBox.link);
  }

  // Organic results
  if (data.organic && Array.isArray(data.organic)) {
    for (const item of data.organic) {
      if (results.length >= maxResults) break;
      if (seenUrls.has(item.link)) continue;

      results.push({
        title: item.title || 'No title',
        link: item.link || '',
        snippet: item.snippet || '',
        date: item.date || null,
        source: 'organic',
      });
      seenUrls.add(item.link);
    }
  }

  // People also ask
  if (data.peopleAlsoAsk && Array.isArray(data.peopleAlsoAsk)) {
    for (const item of data.peopleAlsoAsk) {
      if (results.length >= maxResults) break;
      results.push({
        title: item.question || 'Related Question',
        link: item.link || '',
        snippet: item.snippet || item.answer || '',
        source: 'people_also_ask',
      });
    }
  }

  return results;
}

// ─── Context-Aware Search ─────────────────────────────────────────────────────

export async function webSearchWithContext(query, repoName, apiKey) {
  const enhanced = `${query} ${repoName} github`;
  return webSearch(enhanced, apiKey);
}

// ─── Formatting ─────────────────────────────────────────────────────────────

export function formatSearchResults(results) {
  if (!results || results.length === 0) return 'No web search results found.';
  return results
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.link}\n${r.snippet}`)
    .join('\n\n');
}

export default {
  webSearch,
  webSearchWithContext,
  formatSearchResults,
};
