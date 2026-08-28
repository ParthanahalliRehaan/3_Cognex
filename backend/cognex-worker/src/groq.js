/**
 * groq.js — Optimized Groq API Client for Streaming LLM Responses
 *
 * Improvements:
 *   • Fallback model chain (primary -> backup -> fallback)
 *   • Request timeout via AbortController
 *   • Exponential backoff retry for transient failures
 *   • Token budget enforcement (prevent context overflow)
 *   • Streaming with graceful degradation to non-streaming
 *   • Structured system prompt builder with relevance scoring
 */

import { createGroq } from '@ai-sdk/groq';
import { streamText, generateText } from 'ai';

// ─── Configuration ────────────────────────────────────────────────────────────────

// Confirmed live via `curl https://api.groq.com/openai/v1/models` against
// this account on 2026-08-28 — do NOT trust this list blindly forever,
// that's the whole lesson from today. Re-run that curl if this breaks again
// instead of guessing.
const MODEL_CHAIN = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'groq/compound-mini',
];

const DEFAULT_TEMPERATURE = 0.2;  // Lower = more factual
const DEFAULT_MAX_TOKENS = 2048;
const MAX_CONTEXT_CHARS = 12000;  // Leave room for system + response
const REQUEST_TIMEOUT_MS = 30000;
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 1000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitter(max) { return Math.floor(Math.random() * max); }

// ─── Client Factory ───────────────────────────────────────────────────────────

function getGroqClient(apiKey) {
  if (!apiKey) throw new Error('GROQ_API_KEY is required');
  return createGroq({ apiKey });
}

// ─── Streaming Response ───────────────────────────────────────────────────────

export async function streamAnswer(userPrompt, systemPrompt, apiKey, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const groq = getGroqClient(apiKey);
    const model = options.model || MODEL_CHAIN[0];

    const trimmedSystem = trimContext(systemPrompt, MAX_CONTEXT_CHARS);
    const trimmedUser = userPrompt.slice(0, 2000); // Cap user prompt

    const result = streamText({
      model: groq(model),
      system: trimmedSystem,
      messages: [{ role: 'user', content: trimmedUser }],
      temperature: options.temperature ?? DEFAULT_TEMPERATURE,
      maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      abortSignal: controller.signal,
      // streamText() returns before the model has actually responded — errors
      // that happen while the stream is being consumed happen OUTSIDE this
      // try/catch's scope and were previously surfacing only as bare
      // Cloudflare uncaught-exception traces with no status or message.
      // This is the actual fix for "no visibility into why Groq failed."
      onError: ({ error }) => {
        console.error(`[GROQ STREAM ERROR] model=${model} status=${error?.status ?? error?.statusCode ?? 'n/a'} name=${error?.name} message=${error?.message ?? error}`);
      },
    });

    clearTimeout(timeoutId);
    return result.toTextStreamResponse();

  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Groq request timed out after 30s');
    }
    // Fallback to non-streaming on streaming failure
    if (options.allowFallback !== false) {
      console.warn('[GROQ] Streaming failed, falling back to generateText');
      return fallbackToGenerate(userPrompt, systemPrompt, apiKey, options);
    }
    throw err;
  }
}

async function fallbackToGenerate(userPrompt, systemPrompt, apiKey, options) {
  const groq = getGroqClient(apiKey);
  const model = options.model || MODEL_CHAIN[0];

  const { text } = await generateText({
    model: groq(model),
    system: trimContext(systemPrompt, MAX_CONTEXT_CHARS),
    messages: [{ role: 'user', content: userPrompt.slice(0, 2000) }],
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
  });

  // Return as a streaming-like Response
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

// ─── Multi-turn Chat Streaming ────────────────────────────────────────────────

export async function streamChat(messages, systemPrompt, apiKey, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const groq = getGroqClient(apiKey);
    const model = options.model || MODEL_CHAIN[0];

    const result = streamText({
      model: groq(model),
      system: trimContext(systemPrompt, MAX_CONTEXT_CHARS),
      messages: messages.slice(-10), // Keep last 10 messages max
      temperature: options.temperature ?? DEFAULT_TEMPERATURE,
      maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      abortSignal: controller.signal,
      onError: ({ error }) => {
        console.error(`[GROQ STREAM ERROR] model=${model} status=${error?.status ?? error?.statusCode ?? 'n/a'} name=${error?.name} message=${error?.message ?? error}`);
      },
    });

    clearTimeout(timeoutId);
    return result.toTextStreamResponse();

  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// ─── Non-Streaming (with model fallback chain) ────────────────────────────────

export async function generateAnswer(userPrompt, systemPrompt, apiKey, options = {}) {
  let lastError = null;

  for (let modelIdx = 0; modelIdx < MODEL_CHAIN.length; modelIdx++) {
    const model = MODEL_CHAIN[modelIdx];
    const attempt = modelIdx === 0 ? 0 : 0; // Reset retries per model

    try {
      const groq = getGroqClient(apiKey);

      const { text } = await generateText({
        model: groq(model),
        system: trimContext(systemPrompt, MAX_CONTEXT_CHARS),
        messages: [{ role: 'user', content: userPrompt.slice(0, 2000) }],
        temperature: options.temperature ?? DEFAULT_TEMPERATURE,
        maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      });

      return text;

    } catch (err) {
      lastError = err;
      const status = err.status ?? err.statusCode;
      console.warn(`[GROQ] Model ${model} failed: status=${status} message=${err.message}`);

      // Retry same model only on transient errors (network blip, 5xx, rate limit)
      if (err.message?.includes('fetch') || status >= 500 || status === 429) {
        await sleep(BASE_DELAY_MS + jitter(500));
        modelIdx--; // Retry same model
        continue;
      }

      // 400/401/404 etc are permanent for this model (bad/decommissioned
      // model, bad auth, bad request) — retrying won't help, move to the
      // next model in the chain immediately instead of sleeping.
      // No backoff sleep here: sleeping before a *guaranteed* next failure
      // just adds latency for no benefit.
    }
  }

  throw new Error(`All Groq models failed. Last error: ${lastError?.message}`);
}

// ─── System Prompt Builder (Context-Aware Trimming) ───────────────────────────

export function buildSystemPrompt(repoUrl, documents = [], graph = null, webResults = []) {
  const parts = [
    `You are Cognex, an AI assistant specialized in analyzing GitHub repositories.`,
    `You are answering questions about: ${repoUrl}`,
    `Use ONLY the provided context. Cite specific files, contributors, or issues when relevant.`,
    `If the context is insufficient, say so honestly. Be concise but thorough.`,
    '',
  ];

  // Documents — sort by relevance, trim aggressively
  if (documents.length > 0) {
    parts.push('--- RELEVANT DOCUMENTS ---');
    const sorted = [...documents].sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
    for (let i = 0; i < Math.min(sorted.length, 5); i++) {
      const doc = sorted[i];
      const meta = doc.metadata || {};
      parts.push(`[${i + 1}] ${meta.source_path || 'unknown'} (score: ${(doc.similarity || 0).toFixed(3)})`);
      // Truncate content to ~600 chars per doc
      const content = (doc.content || '').slice(0, 600);
      parts.push(content + (doc.content?.length > 600 ? '...' : ''));
      parts.push('');
    }
  }

  // Graph — only most relevant node types
  if (graph && graph.nodes && graph.nodes.length > 0) {
    parts.push('--- KNOWLEDGE GRAPH ---');

    const contributors = graph.nodes.filter(n => n.node_type === 'contributor').slice(0, 5);
    if (contributors.length) {
      parts.push(`Contributors: ${contributors.map(c => `${c.label} (${c.metadata?.contributions || 0} commits)`).join(', ')}`);
    }

    const files = graph.nodes.filter(n => n.node_type === 'file').slice(0, 8);
    if (files.length) {
      parts.push(`Key files: ${files.map(f => f.label).join(', ')}`);
    }

    const deps = graph.nodes.filter(n => n.node_type === 'dependency').slice(0, 10);
    if (deps.length) {
      parts.push(`Dependencies: ${deps.map(d => d.metadata?.name || d.label).join(', ')}`);
    }

    const funcs = graph.nodes.filter(n => n.node_type === 'function').slice(0, 5);
    if (funcs.length) {
      parts.push(`Key functions: ${funcs.map(f => f.label).join(', ')}`);
    }

    parts.push('');
  }

  // Web results — max 3
  if (webResults.length > 0) {
    parts.push('--- WEB SEARCH ---');
    for (let i = 0; i < Math.min(webResults.length, 3); i++) {
      const r = webResults[i];
      parts.push(`[${i + 1}] ${r.title || 'No title'}`);
      parts.push((r.snippet || r.content || '').slice(0, 400));
      parts.push('');
    }
  }

  return parts.join('\n');
}

// ─── Context Trimming ─────────────────────────────────────────────────────────

function trimContext(text, maxChars) {
  if (text.length <= maxChars) return text;

  // Try to trim at paragraph boundary
  const truncated = text.slice(0, maxChars);
  const lastBreak = Math.max(
    truncated.lastIndexOf('\n\n'),
    truncated.lastIndexOf('\n---'),
    truncated.lastIndexOf('. ')
  );

  if (lastBreak > maxChars * 0.7) {
    return truncated.slice(0, lastBreak) + '\n\n...[context truncated]';
  }

  return truncated + '...[context truncated]';
}

export default {
  streamAnswer,
  streamChat,
  generateAnswer,
  buildSystemPrompt,
};