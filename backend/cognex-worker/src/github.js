/**
 * github.js — Optimized GitHub REST API Client for Cognex
 *
 * Improvements:
 *   • Exponential backoff retry with jitter for 403/502/503
 *   • ETag caching to skip unchanged resources
 *   • Worker-safe base64 (no Buffer dependency)
 *   • Parallel batch fetching with concurrency limits
 *   • Timeout handling via AbortController
 *   • Structured error classification
 */

const GITHUB_API_BASE = 'https://api.github.com';
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const FETCH_TIMEOUT_MS = 15000;
const BATCH_CONCURRENCY = 5; // Max parallel file fetches

// ─── Low-level fetch with retry, timeout, and ETag ────────────────────────────

async function githubFetch(url, token, options = {}) {
  const { etag = null, method = 'GET', body = null } = options;
  const retries = options.retries ?? MAX_RETRIES;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Cognex-KG/1.0',
    };
    if (token) headers['Authorization'] = `token ${token}`;
    if (etag) headers['If-None-Match'] = etag;

    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // Return cached response marker
      if (response.status === 304) {
        return { cached: true, etag: response.headers.get('ETag') };
      }

      if (response.ok) {
        const newEtag = response.headers.get('ETag');
        const data = await response.json();
        return { data, etag: newEtag, cached: false, status: response.status };
      }

      // Rate limit — read reset time from header
      if (response.status === 403 || response.status === 429) {
        const resetHeader = response.headers.get('X-RateLimit-Reset');
        const retryAfter = response.headers.get('Retry-After');
        const waitMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : resetHeader
            ? Math.max(0, parseInt(resetHeader, 10) * 1000 - Date.now())
            : BASE_DELAY_MS * (2 ** attempt);

        if (attempt < retries) {
          await sleep(waitMs + jitter(500));
          continue;
        }
      }

      // Server errors — retry
      if (response.status >= 500 && attempt < retries) {
        await sleep(BASE_DELAY_MS * (2 ** attempt) + jitter(500));
        continue;
      }

      // Non-retryable error
      const errorText = await response.text();
      throw new GitHubError(response.status, errorText, url);

    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        if (attempt < retries) {
          await sleep(BASE_DELAY_MS * (2 ** attempt));
          continue;
        }
        throw new GitHubError(408, 'Request timeout', url);
      }
      if (err instanceof GitHubError) throw err;
      if (attempt < retries) {
        await sleep(BASE_DELAY_MS * (2 ** attempt) + jitter(500));
        continue;
      }
      throw new GitHubError(0, err.message, url);
    }
  }

  throw new GitHubError(0, 'Max retries exceeded', url);
}

export class GitHubError extends Error {
  constructor(status, message, url) {
    super(`GitHub API ${status}: ${message} (${url})`);
    this.status = status;
    this.url = url;
    this.isRateLimit = status === 403 || status === 429;
    this.isNotFound = status === 404;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitter(max) { return Math.floor(Math.random() * max); }

// ─── URL Parsing (memoized) ───────────────────────────────────────────────────

const urlCache = new Map();

export function parseRepoUrl(repoUrl) {
  if (urlCache.has(repoUrl)) return urlCache.get(repoUrl);
  const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
  if (!match) throw new GitHubError(400, 'Invalid GitHub repository URL', repoUrl);
  const result = { owner: match[1], repo: match[2].replace(/\.git$/, '') };
  urlCache.set(repoUrl, result);
  return result;
}

// ─── Worker-safe Base64 decode ────────────────────────────────────────────────

function b64Decode(str) {
  const cleaned = str.replace(/\s/g, '');
  try {
    if (typeof atob !== 'undefined') {
      return atob(cleaned);
    }
  } catch { /* fall through */ }
  // Pure JS fallback for Workers without atob
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  let i = 0;
  while (i < cleaned.length) {
    const e1 = chars.indexOf(cleaned[i++]);
    const e2 = chars.indexOf(cleaned[i++]);
    const e3 = chars.indexOf(cleaned[i++]);
    const e4 = chars.indexOf(cleaned[i++]);
    const c1 = (e1 << 2) | (e2 >> 4);
    const c2 = ((e2 & 15) << 4) | (e3 >> 2);
    const c3 = ((e3 & 3) << 6) | e4;
    output += String.fromCharCode(c1);
    if (e3 !== 64) output += String.fromCharCode(c2);
    if (e4 !== 64) output += String.fromCharCode(c3);
  }
  return output;
}

// ─── Core Data Fetchers ───────────────────────────────────────────────────────

export async function fetchRepoMetadata(owner, repo, token) {
  const { data } = await githubFetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, token);
  return {
    owner: data.owner.login,
    repo: data.name,
    fullName: data.full_name,
    description: data.description || '',
    stars: data.stargazers_count || 0,
    forks: data.forks_count || 0,
    openIssues: data.open_issues_count || 0,
    language: data.language,
    topics: data.topics || [],
    defaultBranch: data.default_branch,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    license: data.license?.name || null,
    htmlUrl: data.html_url,
    size: data.size || 0,
    archived: data.archived || false,
    fork: data.fork || false,
  };
}

export async function fetchReadme(owner, repo, token) {
  try {
    const { data } = await githubFetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/readme`, token);
    return data.content ? b64Decode(data.content) : '';
  } catch (err) {
    if (err.isNotFound) return '';
    throw err;
  }
}

export async function fetchFileTree(owner, repo, token) {
  const meta = await fetchRepoMetadata(owner, repo, token);
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${meta.defaultBranch}?recursive=1`;
  const { data } = await githubFetch(url, token);

  return (data.tree || [])
    .filter(item => item.type === 'blob') // Only files
    .map(item => ({
      path: item.path,
      sha: item.sha,
      size: item.size || 0,
    }));
}

export async function fetchFileContent(owner, repo, path, token) {
  const encodedPath = encodeURIComponent(path).replace(/%2F/g, '/');
  try {
    const { data } = await githubFetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${encodedPath}`,
      token
    );
    return data.content ? b64Decode(data.content) : '';
  } catch (err) {
    if (err.isNotFound) return '';
    throw err;
  }
}

// ─── Paginated Fetchers with Early Termination ────────────────────────────────

async function fetchPaginated(baseUrl, token, options = {}) {
  const { maxItems = 300, perPage = 100, filter = null, mapper } = options;
  const results = [];
  let page = 1;
  const separator = baseUrl.includes('?') ? '&' : '?';

  while (results.length < maxItems) {
    const url = `${baseUrl}${separator}per_page=${perPage}&page=${page}`;
    const { data } = await githubFetch(url, token);

    let items = data;
    if (filter) items = items.filter(filter);
    if (mapper) items = items.map(mapper);

    results.push(...items);
    if (data.length < perPage) break;
    page++;
  }

  return results.slice(0, maxItems);
}

export async function fetchIssues(owner, repo, token, state = 'all', maxItems = 50) {
  return fetchPaginated(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues?state=${state}`,
    token,
    {
      maxItems,
      filter: item => !item.pull_request, // Exclude PRs
      mapper: issue => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        body: issue.body || '',
        labels: (issue.labels || []).map(l => ({ name: l.name, color: l.color })),
        user: issue.user?.login || 'unknown',
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        comments: issue.comments || 0,
        htmlUrl: issue.html_url,
      }),
    }
  );
}

export async function fetchPullRequests(owner, repo, token, state = 'all', maxItems = 30) {
  return fetchPaginated(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls?state=${state}`,
    token,
    {
      maxItems,
      mapper: pr => ({
        number: pr.number,
        title: pr.title,
        state: pr.state,
        body: pr.body || '',
        user: pr.user?.login || 'unknown',
        createdAt: pr.created_at,
        merged: pr.merged_at !== null,
        draft: pr.draft || false,
        headBranch: pr.head?.ref,
        baseBranch: pr.base?.ref,
        htmlUrl: pr.html_url,
      }),
    }
  );
}

export async function fetchCommits(owner, repo, token, maxItems = 30) {
  return fetchPaginated(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/commits`,
    token,
    {
      maxItems,
      mapper: commit => ({
        sha: commit.sha,
        shortSha: commit.sha?.substring(0, 7) || '',
        message: commit.commit?.message || '',
        authorName: commit.commit?.author?.name || 'unknown',
        authorLogin: commit.author?.login || null,
        date: commit.commit?.author?.date,
        htmlUrl: commit.html_url,
      }),
    }
  );
}

export async function fetchContributors(owner, repo, token, maxItems = 50) {
  return fetchPaginated(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/contributors`,
    token,
    {
      maxItems,
      mapper: c => ({
        login: c.login,
        avatarUrl: c.avatar_url,
        htmlUrl: c.html_url,
        contributions: c.contributions || 0,
      }),
    }
  );
}

// ─── Batch File Fetcher (concurrency-limited) ─────────────────────────────────

export async function fetchFilesBatch(owner, repo, paths, token, concurrency = BATCH_CONCURRENCY) {
  const results = {};

  for (let i = 0; i < paths.length; i += concurrency) {
    const batch = paths.slice(i, i + concurrency);
    const promises = batch.map(async (path) => {
      const content = await fetchFileContent(owner, repo, path, token).catch(() => '');
      return { path, content };
    });

    const batchResults = await Promise.all(promises);
    for (const { path, content } of batchResults) {
      results[path] = content;
    }
  }

  return results;
}

// ─── Smart File Selector (for CPU-limited ingestion) ──────────────────────────

const PRIORITY_FILES = new Set([
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'requirements.txt', 'pyproject.toml', 'setup.py', 'poetry.lock',
  'cargo.toml', 'cargo.lock', 'go.mod', 'go.sum',
  'gemfile', 'gemfile.lock', 'composer.json',
  'dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  'readme.md', 'readme', 'license', 'license.md',
  'tsconfig.json', 'jsconfig.json', 'vite.config.js',
  'next.config.js', 'nuxt.config.ts', 'svelte.config.js',
  'tailwind.config.js', 'postcss.config.js',
]);

const VALUABLE_EXTS = new Set([
  'js', 'ts', 'jsx', 'tsx', 'py', 'go', 'rs', 'rb', 'java',
  'c', 'cpp', 'h', 'cs', 'php', 'swift', 'kt', 'scala',
]);

export function selectFilesForIngestion(fileTree, maxFiles = 15, maxSizeBytes = 8000) {
  const scored = fileTree
    .filter(f => f.type === 'blob' || !f.type) // blob or from simplified tree
    .map(f => {
      const name = f.path.split('/').pop().toLowerCase();
      const ext = name.includes('.') ? name.split('.').pop() : '';

      let score = 0;
      if (PRIORITY_FILES.has(name)) score += 100;
      if (VALUABLE_EXTS.has(ext)) score += 10;
      if (name.includes('test') || name.includes('spec')) score -= 5;
      if (f.size && f.size > maxSizeBytes) score -= 50;
      if (f.path.split('/').length > 4) score -= 3; // Deep nested files less important

      return { ...f, name, ext, score };
    })
    .sort((a, b) => b.score - a.score);

  // Always include package files
  const priority = scored.filter(f => f.score >= 100).slice(0, 5);
  const remaining = scored.filter(f => f.score < 100).slice(0, maxFiles - priority.length);

  return [...priority, ...remaining];
}

export default {
  parseRepoUrl,
  fetchRepoMetadata,
  fetchReadme,
  fetchFileTree,
  fetchFileContent,
  fetchFilesBatch,
  fetchIssues,
  fetchPullRequests,
  fetchCommits,
  fetchContributors,
  selectFilesForIngestion,
  GitHubError,
};
