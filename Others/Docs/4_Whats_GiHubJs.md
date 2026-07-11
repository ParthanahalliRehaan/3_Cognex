# Code
## What `github.js` Does

This module is your data pipeline's **first stage**. It talks to GitHub's REST API using plain `fetch()` to extract everything you need to build the knowledge graph: repo metadata, README, file tree, source code, issues, PRs, commits, and contributors.

**Key design decisions:**
- **Authentication via header:** `Authorization: token ${token}` — required to hit 5,000 req/hour instead of 60.
- **Pagination handling:** GitHub paginates lists (issues, commits, etc.) with `?page=` and `?per_page=`. We'll fetch all pages for small datasets, or cap at a reasonable limit for huge repos.
- **Error resilience:** If a repo has no README or issues are disabled, we return sensible defaults instead of crashing.

---

## The Code

Paste this into `cognex/backend/cognex-worker/src/github.js`:

```javascript
/**
 * github.js — GitHub REST API client for Cognex
 * Fetches repository data, files, issues, PRs, commits, and contributors.
 */

const GITHUB_API_BASE = 'https://api.github.com';

/**
 * Generic fetch wrapper with auth, error handling, and rate-limit awareness.
 */
async function githubFetch(url, token) {
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Cognex-Knowledge-Graph',
  };

  if (token) {
    headers['Authorization'] = `token ${token}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${errorText}`);
  }

  return response;
}

/**
 * Parse owner/repo from a GitHub URL.
 */
export function parseRepoUrl(repoUrl) {
  const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
  if (!match) throw new Error('Invalid GitHub repository URL');
  return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}

/**
 * Fetch repository metadata (stars, forks, description, topics, language, etc.)
 */
export async function fetchRepoMetadata(owner, repo, token) {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}`;
  const response = await githubFetch(url, token);
  const data = await response.json();

  return {
    name: data.name,
    fullName: data.full_name,
    description: data.description,
    stars: data.stargazers_count,
    forks: data.forks_count,
    openIssues: data.open_issues_count,
    language: data.language,
    topics: data.topics || [],
    defaultBranch: data.default_branch,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    license: data.license?.name || null,
    htmlUrl: data.html_url,
  };
}

/**
 * Fetch README content (decoded from base64).
 */
export async function fetchReadme(owner, repo, token) {
  try {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/readme`;
    const response = await githubFetch(url, token);
    const data = await response.json();

    // GitHub returns content as base64
    const content = typeof Buffer !== 'undefined'
      ? Buffer.from(data.content, 'base64').toString('utf-8')
      : atob(data.content.replace(/\n/g, '')); // Cloudflare Workers have atob

    return {
      name: data.name,
      path: data.path,
      content,
      htmlUrl: data.html_url,
      sha: data.sha,
    };
  } catch (err) {
    // Some repos have no README
    if (err.message.includes('404')) {
      return { name: 'README.md', path: 'README.md', content: '', htmlUrl: null, sha: null };
    }
    throw err;
  }
}

/**
 * Fetch the recursive file tree (all files and directories).
 */
export async function fetchFileTree(owner, repo, token) {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${await getDefaultBranch(owner, repo, token)}?recursive=1`;
  const response = await githubFetch(url, token);
  const data = await response.json();

  return (data.tree || []).map(item => ({
    path: item.path,
    type: item.type, // 'blob' = file, 'tree' = directory
    sha: item.sha,
    size: item.size || 0,
    mode: item.mode,
  }));
}

/**
 * Fetch raw content of a specific file.
 */
export async function fetchFileContent(owner, repo, path, token) {
  const encodedPath = encodeURIComponent(path);
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${encodedPath}`;
  const response = await githubFetch(url, token);
  const data = await response.json();

  if (data.content) {
    const content = typeof Buffer !== 'undefined'
      ? Buffer.from(data.content, 'base64').toString('utf-8')
      : atob(data.content.replace(/\n/g, ''));
    return { path, content, sha: data.sha, size: data.size };
  }

  // If it's a directory or symlink, return metadata only
  return { path, content: null, sha: data.sha, size: data.size, type: data.type };
}

/**
 * Fetch issues with pagination (max 100 per page, cap at 300 total).
 */
export async function fetchIssues(owner, repo, token, state = 'all') {
  const issues = [];
  const perPage = 100;
  const maxPages = 3; // Cap at 300 issues to avoid rate limits

  for (let page = 1; page <= maxPages; page++) {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues?state=${state}&per_page=${perPage}&page=${page}`;
    const response = await githubFetch(url, token);
    const data = await response.json();

    // GitHub returns pull requests as issues too — filter them out
    const filtered = data.filter(item => !item.pull_request);

    issues.push(...filtered.map(issue => ({
      number: issue.number,
      title: issue.title,
      state: issue.state,
      body: issue.body || '',
      labels: issue.labels.map(l => l.name),
      author: issue.user?.login || 'unknown',
      createdAt: issue.created_at,
      updatedAt: issue.updated_at,
      comments: issue.comments,
      htmlUrl: issue.html_url,
    })));

    if (data.length < perPage) break; // Last page
  }

  return issues;
}

/**
 * Fetch pull requests with pagination (max 100 per page, cap at 300 total).
 */
export async function fetchPullRequests(owner, repo, token, state = 'all') {
  const prs = [];
  const perPage = 100;
  const maxPages = 3;

  for (let page = 1; page <= maxPages; page++) {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls?state=${state}&per_page=${perPage}&page=${page}`;
    const response = await githubFetch(url, token);
    const data = await response.json();

    prs.push(...data.map(pr => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      body: pr.body || '',
      author: pr.user?.login || 'unknown',
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      merged: pr.merged_at !== null,
      htmlUrl: pr.html_url,
      headBranch: pr.head?.ref,
      baseBranch: pr.base?.ref,
    })));

    if (data.length < perPage) break;
  }

  return prs;
}

/**
 * Fetch recent commits with pagination.
 */
export async function fetchCommits(owner, repo, token, perPage = 100) {
  const commits = [];
  const maxPages = 3; // Cap at 300 commits

  for (let page = 1; page <= maxPages; page++) {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/commits?per_page=${perPage}&page=${page}`;
    const response = await githubFetch(url, token);
    const data = await response.json();

    commits.push(...data.map(commit => ({
      sha: commit.sha,
      message: commit.commit?.message || '',
      author: commit.commit?.author?.name || commit.author?.login || 'unknown',
      authorLogin: commit.author?.login || null,
      date: commit.commit?.author?.date,
      htmlUrl: commit.html_url,
      stats: null, // Would need separate API call per commit for stats
    })));

    if (data.length < perPage) break;
  }

  return commits;
}

/**
 * Fetch contributors list with commit counts.
 */
export async function fetchContributors(owner, repo, token) {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contributors?per_page=100`;
  const response = await githubFetch(url, token);
  const data = await response.json();

  return data.map(contributor => ({
    login: contributor.login,
    avatarUrl: contributor.avatar_url,
    htmlUrl: contributor.html_url,
    contributions: contributor.contributions,
  }));
}

// ─── Helpers ─────────────────────────────────────────────────────────

async function getDefaultBranch(owner, repo, token) {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}`;
  const response = await githubFetch(url, token);
  const data = await response.json();
  return data.default_branch;
}
```

---

## How to Test It (Locally)

You can test this module in isolation before wiring it into the Worker. Create a quick test script:

```bash
cd cognex/backend/cognex-worker
node --input-type=module <<'EOF'
import { parseRepoUrl, fetchRepoMetadata, fetchReadme, fetchFileTree, fetchIssues, fetchContributors } from './src/github.js';

const repoUrl = 'https://github.com/vercel/next.js';
const { owner, repo } = parseRepoUrl(repoUrl);
const token = process.env.GITHUB_TOKEN; // Or paste your token here

async function test() {
  console.log('Testing with:', owner, repo);
  
  const meta = await fetchRepoMetadata(owner, repo, token);
  console.log('✅ Metadata:', meta.name, '⭐', meta.stars);

  const readme = await fetchReadme(owner, repo, token);
  console.log('✅ README length:', readme.content.length, 'chars');

  const tree = await fetchFileTree(owner, repo, token);
  console.log('✅ File tree:', tree.length, 'items');

  const issues = await fetchIssues(owner, repo, token, 'open');
  console.log('✅ Issues:', issues.length);

  const contributors = await fetchContributors(owner, repo, token);
  console.log('✅ Contributors:', contributors.slice(0, 3).map(c => c.login));
}

test().catch(console.error);
EOF
```

> **Note:** You'll need to set `GITHUB_TOKEN` in your shell or hardcode it for this test. In the Worker, it comes from `env.GITHUB_TOKEN`.

# Doubts
## 1. Authentication via Header

### What It Is
Instead of putting your API key in the URL (like `?api_key=abc123`), you send it in the **HTTP request headers** — a separate section of the request that isn't visible in browser history or server logs.

### Why It Matters

| Approach | Problem |
|----------|---------|
| `?token=abc123` in URL | Exposed in browser history, server logs, referrer headers, shared links |
| `Authorization: token abc123` in header | Hidden from URLs, more secure, standard practice |

### How It Works in `github.js`

```javascript
const headers = {
  'Accept': 'application/vnd.github.v3+json',  // Tell GitHub we want JSON
  'User-Agent': 'Cognex-Knowledge-Graph',         // Identify our app
};

if (token) {
  headers['Authorization'] = `token ${token}`;    // 🔐 The magic line
}
```

**The `fetch()` call then sends these headers with every request:**
```
GET /repos/vercel/next.js HTTP/1.1
Host: api.github.com
Accept: application/vnd.github.v3+json
User-Agent: Cognex-Knowledge-Graph
Authorization: token ghp_xxxxxxxxxxxx
```

### GitHub's Rate Limits

| Authentication | Requests/Hour | Real-World Impact |
|----------------|---------------|-------------------|
| No token (anonymous) | 60 | You hit the limit in ~1 minute of fetching |
| With token | 5,000 | Enough for most repos; still need pagination for huge ones |

> **Pro tip:** If you see `403 Forbidden` or `rate limit exceeded`, check `response.headers.get('X-RateLimit-Remaining')` to see how many requests you have left.

---

## 2. Pagination Handling

### What It Is
APIs don't return *everything* at once. Imagine asking GitHub for all issues in React — there are 12,000+. Sending that in one response would crash both servers and clients. So APIs **paginate**: they return data in chunks (pages).

### How GitHub Does It

GitHub uses **query parameters** for pagination:
- `?per_page=100` — How many items per page (max 100)
- `?page=1`, `?page=2`, `?page=3` — Which page to fetch

### The Pattern in `github.js`

```javascript
export async function fetchIssues(owner, repo, token, state = 'all') {
  const issues = [];
  const perPage = 100;      // Max allowed by GitHub
  const maxPages = 3;       // Safety cap: 300 issues max

  for (let page = 1; page <= maxPages; page++) {
    // Build URL with page number
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues?state=${state}&per_page=${perPage}&page=${page}`;
    
    const response = await githubFetch(url, token);
    const data = await response.json();

    // Filter out pull requests (GitHub returns PRs as issues too)
    const filtered = data.filter(item => !item.pull_request);
    issues.push(...filtered);

    // 🛑 STOP condition: if we got fewer items than perPage, 
    // we've reached the last page. No more to fetch.
    if (data.length < perPage) break;
  }

  return issues;
}
```

### Visual Walkthrough

```
Page 1: ?per_page=100&page=1  →  Returns 100 items  →  Continue
Page 2: ?per_page=100&page=2  →  Returns 100 items  →  Continue
Page 3: ?per_page=100&page=3  →  Returns 100 items  →  Continue
Page 4: ?per_page=100&page=4  →  Returns 47 items   →  STOP (47 < 100)
```

### Why We Cap at `maxPages = 3`

| Without Cap | With Cap (300 items) |
|-------------|----------------------|
| Could make 120 requests for a huge repo | Max 3 requests |
| Risk hitting rate limit | Safe and fast |
| Worker might timeout (30s limit) | Finishes quickly |
| LLM context window would overflow anyway | Still enough context for RAG |

> **Trade-off:** We sacrifice completeness for reliability. For a knowledge graph, the *recent* 300 issues/commits are usually more relevant than ancient ones.

---

## Summary Table

| Concept | Purpose | Where It's Used |
|---------|---------|---------------|
| **Auth Header** | Securely identify yourself to the API | Every single API call |
| **Pagination** | Fetch large datasets in manageable chunks | List endpoints (issues, commits, PRs, file tree) |
| **Per-page limit** | Control chunk size | `?per_page=100` |
| **Stop condition** | Know when to stop fetching | `if (data.length < perPage) break` |
| **Max pages cap** | Prevent runaway requests/timeouts | `maxPages = 3` |