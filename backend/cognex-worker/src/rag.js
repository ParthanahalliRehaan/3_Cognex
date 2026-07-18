/**
 * rag.js — Ultra-Optimized Agentic RAG Orchestrator for Cognex
 *
 * CRITICAL FIXES for Free Tier CPU Limits:
 *   • Ingestion uses ctx.waitUntil() for background processing
 *   • Returns 202 Accepted immediately, streams progress via status endpoint
 *   • Aggressive data reduction (max 10 files, 5 issues, 5 commits)
 *   • Lazy module loading (only import what's needed)
 *   • No heavy regex on large files (>8KB skipped)
 *   • Batched I/O with concurrency limits
 *   • Minimal string operations
 */

// Lazy imports — only load when needed to reduce cold-start CPU
let _github, _graph, _embeddings, _supabase, _groq, _search;

async function getGithub() {
  if (!_github) _github = await import('./github.js');
  return _github;
}
async function getGraph() {
  if (!_graph) _graph = await import('./graph.js');
  return _graph;
}
async function getEmbeddings() {
  if (!_embeddings) _embeddings = await import('./embeddings.js');
  return _embeddings;
}
async function getSupabase() {
  if (!_supabase) _supabase = await import('./supabase.js');
  return _supabase;
}
async function getGroq() {
  if (!_groq) _groq = await import('./groq.js');
  return _groq;
}
async function getSearch() {
  if (!_search) _search = await import('./search.js');
  return _search;
}

// ─── Ingestion Progress Store (in-memory, per-request) ────────────────────────

const progressStore = new Map(); // repoUrl -> { status, progress, error, result }

export function getIngestionProgress(repoUrl) {
  return progressStore.get(repoUrl) || { status: 'unknown', progress: 0 };
}

// ─── Query Handler (Lightweight, no heavy CPU) ────────────────────────────────

export async function handleQuery(repoUrl, userQuery, env, options = {}) {
  const supabaseMod = await getSupabase();
  const embeddingsMod = await getEmbeddings();
  const groqMod = await getGroq();
  const searchMod = await getSearch();

  const supabaseRead = supabaseMod.getSupabaseClient(env, true);

  // 1. Embed query (single API call, minimal CPU)
  const queryEmbedding = await embeddingsMod.prepareQueryEmbedding(userQuery, env.COHERE_API_KEY);

  // 2. Vector search (I/O bound, not CPU)
  const documents = await supabaseMod.matchDocuments(
    supabaseRead,
    queryEmbedding,
    repoUrl,
    options.matchThreshold ?? 0.5,
    options.matchCount ?? 5
  );

  // 3. Graph fetch (I/O bound)
  const graph = await supabaseMod.getGraphForRepo(supabaseRead, repoUrl);

  // 4. Optional web fallback (I/O bound)
  let webResults = [];
  if (documents.length < (options.minDocs ?? 1)) {
    const repoName = extractRepoName(repoUrl);
    webResults = await searchMod.webSearchWithContext(userQuery, repoName, env.WEB_SEARCH_API_KEY);
  }

  // 5. Build prompt + stream (I/O bound)
  const systemPrompt = groqMod.buildSystemPrompt(repoUrl, documents, graph, webResults);
  return groqMod.streamAnswer(userQuery, systemPrompt, env.GROQ_API_KEY, {
    temperature: options.temperature,
    maxTokens: options.maxTokens,
  });
}

// ─── Ingestion Pipeline (Background-Optimized for Free Tier) ────────────────────

export async function ingestRepo(repoUrl, env, ctx = null) {
  // If ctx.waitUntil is available, run ingestion in background
  if (ctx && typeof ctx.waitUntil === 'function') {
    progressStore.set(repoUrl, { status: 'processing', progress: 0, startedAt: Date.now() });

    ctx.waitUntil(
      runIngestion(repoUrl, env)
        .then(result => {
          progressStore.set(repoUrl, { status: 'done', progress: 100, result, finishedAt: Date.now() });
        })
        .catch(err => {
          console.error(`[INGEST ERROR] ${repoUrl}:`, err);
          progressStore.set(repoUrl, { status: 'error', progress: 0, error: err.message, finishedAt: Date.now() });
        })
    );

    // Return immediately — client polls /api/status
    return { status: 'accepted', message: 'Ingestion started in background. Poll /api/status for progress.' };
  }

  // Fallback: synchronous (may hit CPU limits on large repos)
  return runIngestion(repoUrl, env);
}

async function runIngestion(repoUrl, env) {
  const startTime = Date.now();
  console.log(`[INGEST] Starting: ${repoUrl}`);

  const github = await getGithub();
  const graphMod = await getGraph();
  const embeddingsMod = await getEmbeddings();
  const supabaseMod = await getSupabase();

  const { owner, repo } = github.parseRepoUrl(repoUrl);
  const token = env.GITHUB_TOKEN;
  const supabaseService = supabaseMod.getSupabaseClient(env, true);

  // Check existing
  const status = await supabaseMod.getIngestionStatus(supabaseService, repoUrl);
  if (status.exists && !env.FORCE_REINGEST) {
    return { status: 'already_exists', ...status };
  }

  updateProgress(repoUrl, 10, 'Fetching GitHub data...');

  // Step 1: Parallel fetch of lightweight metadata (I/O bound)
  const [metadata, readme, fileTree, issues, pullRequests, commits, contributors] = await Promise.all([
    github.fetchRepoMetadata(owner, repo, token),
    github.fetchReadme(owner, repo, token),
    github.fetchFileTree(owner, repo, token),
    github.fetchIssues(owner, repo, token, 'all', 30),
    github.fetchPullRequests(owner, repo, token, 'all', 20),
    github.fetchCommits(owner, repo, token, 30),
    github.fetchContributors(owner, repo, token, 30),
  ]);

  updateProgress(repoUrl, 25, 'Selecting & fetching key files...');

  // Step 2: Select only the most valuable files (CPU: O(n) sort)
  const selectedFiles = github.selectFilesForIngestion(fileTree, 12, 8000);
  const filePaths = selectedFiles.map(f => f.path);

  // Step 3: Fetch file contents in small batches (I/O bound)
  const fileContents = await github.fetchFilesBatch(owner, repo, filePaths, token, 3);

  updateProgress(repoUrl, 40, 'Building knowledge graph...');

  // Step 4: Build graph (single pass, pre-compiled regex)
  const githubData = { metadata, readme, fileTree, fileContents, issues, pullRequests, commits, contributors };
  const { nodes, edges } = graphMod.buildGraph(repoUrl, githubData);

  updateProgress(repoUrl, 55, 'Storing graph...');

  // Step 5: Store graph (I/O bound)
  const storedGraph = await supabaseMod.storeCompleteGraph(supabaseService, repoUrl, nodes, edges);

  updateProgress(repoUrl, 70, 'Generating embeddings...');

  // Step 6: Prepare documents — ONLY high-value content (CPU: chunking only)
  const allDocs = [];

  // README (most important)
  if (readme) {
    const docs = await embeddingsMod.prepareDocuments(
      repoUrl, 'readme', 'README.md',
      readme.slice(0, 4000),  // Hard cap README
      env.COHERE_API_KEY
    );
    allDocs.push(...docs);
  }

  // Config files (package.json, requirements.txt, etc.)
  for (const path of filePaths) {
    const name = path.split('/').pop().toLowerCase();
    if (name === 'package.json' || name === 'requirements.txt' || name === 'go.mod' || name === 'cargo.toml') {
      const content = fileContents[path];
      if (content && content.length < 5000) {
        const docs = await embeddingsMod.prepareDocuments(
          repoUrl, 'config', path,
          content.slice(0, 3000),
          env.COHERE_API_KEY
        );
        allDocs.push(...docs);
      }
    }
  }

  // Top 5 issues (titles + truncated bodies)
  for (const issue of issues.slice(0, 5)) {
    const text = `${issue.title}\n${(issue.body || '').slice(0, 800)}`;
    if (text.length > 30) {
      const docs = await embeddingsMod.prepareDocuments(
        repoUrl, 'issue', `issue:#${issue.number}`,
        text,
        env.COHERE_API_KEY,
        { state: issue.state, labels: issue.labels?.map(l => l.name) || [] }
      );
      allDocs.push(...docs);
    }
  }

  // Top 5 commits (messages only)
  for (const commit of commits.slice(0, 5)) {
    const msg = (commit.message || '').slice(0, 400);
    if (msg.length > 10) {
      const docs = await embeddingsMod.prepareDocuments(
        repoUrl, 'commit', commit.shortSha || 'unknown',
        msg,
        env.COHERE_API_KEY
      );
      allDocs.push(...docs);
    }
  }

  // Small source files only (skip large files to save CPU)
  let sourceFilesProcessed = 0;
  for (const path of filePaths) {
    const content = fileContents[path];
    if (!content || content.length > 5000 || content.length < 50) continue;

    const ext = path.split('.').pop();
    if (!['js','ts','jsx','tsx','py','go','rs'].includes(ext)) continue;
    if (sourceFilesProcessed >= 3) break; // Max 3 source files

    const docs = await embeddingsMod.prepareDocuments(
      repoUrl, 'code', path,
      content.slice(0, 4000),
      env.COHERE_API_KEY
    );
    allDocs.push(...docs);
    sourceFilesProcessed++;
  }

  updateProgress(repoUrl, 85, 'Storing documents...');

  // Step 7: Store documents in batches (I/O bound)
  await supabaseMod.storeDocumentsBatch(supabaseService, allDocs);

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  updateProgress(repoUrl, 100, 'Complete');

  console.log(`[INGEST] Done: ${repoUrl} in ${duration}s | ${nodes.length} nodes, ${edges.length} edges, ${allDocs.length} docs`);

  return {
    status: 'success',
    duration: parseFloat(duration),
    nodes: nodes.length,
    edges: edges.length,
    documents: allDocs.length,
  };
}

function updateProgress(repoUrl, progress, message) {
  const existing = progressStore.get(repoUrl) || {};
  progressStore.set(repoUrl, { ...existing, progress, message, updatedAt: Date.now() });
}

function extractRepoName(repoUrl) {
  const match = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  return match ? match[1] : repoUrl;
}

export default { handleQuery, ingestRepo, getIngestionProgress };
