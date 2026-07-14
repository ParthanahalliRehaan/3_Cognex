/**
 * rag.js — Agentic RAG Orchestrator for Cognex (Free Tier Optimized)
 *
 * CPU-friendly version: limits data volume, batches I/O, avoids heavy loops
 */

import { prepareQueryEmbedding } from './embeddings.js';
import { matchDocuments, getGraphForRepo, getGraphNodes } from './supabase.js';
import { webSearchWithContext } from './search.js';
import { streamAnswer, buildSystemPrompt } from './groq.js';

// ─── Tight Limits for Free Tier ───────────────────────────────────────────────

const VECTOR_MATCH_THRESHOLD = 0.5;
const VECTOR_MATCH_COUNT = 5;
const MIN_DOCUMENTS_FOR_ANSWER = 1;
const ENABLE_WEB_FALLBACK = true;

// Hard caps to stay under 50ms CPU
const MAX_FILES = 10;        // Was 50
const MAX_ISSUES = 5;        // Was 30
const MAX_COMMITS = 5;       // Was 30
const MAX_DOC_BATCH = 10;    // Was 50
const MAX_FILE_SIZE = 5000;  // Skip files > 5KB

// ─── Main Query Handler ───────────────────────────────────────────────────────

export async function handleQuery(repoUrl, userQuery, env, options = {}) {
  const { getSupabaseClient } = await import('./supabase.js');
  const supabaseRead = getSupabaseClient(env, false);

  const queryEmbedding = await prepareQueryEmbedding(userQuery, env.COHERE_API_KEY);

  const documents = await matchDocuments(
    supabaseRead,
    queryEmbedding,
    repoUrl,
    options.matchThreshold || VECTOR_MATCH_THRESHOLD,
    options.matchCount || VECTOR_MATCH_COUNT
  );

  const graph = await getGraphForRepo(supabaseRead, repoUrl);

  let webResults = [];
  if (ENABLE_WEB_FALLBACK && documents.length < (options.minDocs || MIN_DOCUMENTS_FOR_ANSWER)) {
    const repoName = extractRepoName(repoUrl);
    webResults = await webSearchWithContext(userQuery, repoName, env.WEB_SEARCH_API_KEY);
  }

  const systemPrompt = buildSystemPrompt(repoUrl, documents, graph, webResults);

  return streamAnswer(userQuery, systemPrompt, env.GROQ_API_KEY, {
    temperature: options.temperature,
    maxTokens: options.maxTokens,
  });
}

// ─── Ingestion Pipeline (CPU-Optimized) ───────────────────────────────────────

export async function ingestRepo(repoUrl, env) {
  console.log(`[INGEST] Starting: ${repoUrl}`);

  const startTime = Date.now();

  const { getSupabaseClient, storeCompleteGraph, storeDocumentsBatch, getIngestionStatus } = await import('./supabase.js');
  const { buildGraph } = await import('./graph.js');
  const { prepareDocuments } = await import('./embeddings.js');

  const github = await import('./github.js');
  const { owner, repo } = github.parseRepoUrl(repoUrl);
  const token = env.GITHUB_TOKEN;
  const supabaseService = getSupabaseClient(env, true);

  // Check existing
  const status = await getIngestionStatus(supabaseService, repoUrl);
  if (status.exists && !env.FORCE_REINGEST) {
    return { status: 'already_exists', ...status };
  }

  // Step 1: Fetch GitHub data (parallel I/O, minimal CPU)
  const [metadata, readme, fileTree, issues, pullRequests, commits, contributors] = await Promise.all([
    github.fetchRepoMetadata(owner, repo, token),
    github.fetchReadme(owner, repo, token),
    github.fetchFileTree(owner, repo, token),
    github.fetchIssues(owner, repo, token, 'all'),
    github.fetchPullRequests(owner, repo, token, 'all'),
    github.fetchCommits(owner, repo, token, 30), // Reduced from 100
    github.fetchContributors(owner, repo, token),
  ]);

  // Step 2: Fetch only small, key files
  const fileContents = {};
  const codeFiles = fileTree
    .filter(f => f.type === 'blob')
    .filter(f => {
      const name = f.path.split('/').pop().toLowerCase();
      const ext = f.path.split('.').pop();
      // Prioritize: package.json, then small source files
      if (name === 'package.json' || name === 'requirements.txt') return true;
      if (f.size && f.size > MAX_FILE_SIZE) return false;
      return ['js', 'ts', 'jsx', 'tsx', 'py'].includes(ext);
    })
    .slice(0, MAX_FILES);

  // Fetch files in parallel batches of 3 (reduces API calls)
  for (let i = 0; i < codeFiles.length; i += 3) {
    const batch = codeFiles.slice(i, i + 3);
    const results = await Promise.all(
      batch.map(f => github.fetchFileContent(owner, repo, f.path, token).catch(() => ''))
    );
    batch.forEach((f, idx) => {
      fileContents[f.path] = results[idx];
    });
  }

  const githubData = { metadata, readme, fileTree, fileContents, issues, pullRequests, commits, contributors };

  // Step 3: Build graph (single pass, no heavy regex on large files)
  const { nodes, edges } = buildGraph(repoUrl, githubData);

  // Step 4: Store graph
  const storedGraph = await storeCompleteGraph(supabaseService, repoUrl, nodes, edges);

  // Step 5: Prepare documents — ONLY for README + package.json + a few small files
  // Skip code embedding entirely on free tier (too CPU heavy)
  const allDocs = [];

  if (readme) {
    const docs = await prepareDocuments(repoUrl, 'readme', 'README.md', readme.slice(0, 3000), env.COHERE_API_KEY);
    allDocs.push(...docs);
  }

  // Only embed package.json for dependencies
  const pkgContent = fileContents['package.json'] || fileContents['requirements.txt'];
  if (pkgContent) {
    const docs = await prepareDocuments(repoUrl, 'config', 'package.json', pkgContent.slice(0, 2000), env.COHERE_API_KEY);
    allDocs.push(...docs);
  }

  // Top 3 issues only
  for (const issue of issues.slice(0, MAX_ISSUES)) {
    const body = (issue.body || issue.title || '').slice(0, 1000);
    if (body.length > 20) {
      const docs = await prepareDocuments(repoUrl, 'issue', `issue:#${issue.number}`, body, env.COHERE_API_KEY, {
        title: issue.title,
        state: issue.state,
      });
      allDocs.push(...docs);
    }
  }

  // Top 3 commits only
  for (const commit of commits.slice(0, MAX_COMMITS)) {
    const message = (commit.commit?.message || '').slice(0, 500);
    if (message.length > 10) {
      const docs = await prepareDocuments(repoUrl, 'commit', commit.sha?.substring(0, 7) || 'unknown', message, env.COHERE_API_KEY);
      allDocs.push(...docs);
    }
  }

  // Step 6: Store documents in tiny batches
  for (let i = 0; i < allDocs.length; i += MAX_DOC_BATCH) {
    await storeDocumentsBatch(supabaseService, allDocs.slice(i, i + MAX_DOC_BATCH));
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  return {
    status: 'success',
    duration: parseFloat(duration),
    nodes: storedGraph.nodes.length,
    edges: storedGraph.edges.length,
    documents: allDocs.length,
  };
}

function extractRepoName(repoUrl) {
  const match = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  return match ? match[1] : repoUrl;
}

export default { handleQuery, ingestRepo };
