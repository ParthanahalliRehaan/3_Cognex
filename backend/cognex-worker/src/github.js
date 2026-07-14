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
    owner: data.owner.login,
    repo: data.name,
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
    html_url: data.html_url,
  };
}

/**
 * Fetch README content as a plain string (decoded from base64).
 * Returns empty string if no README exists.
 */
export async function fetchReadme(owner, repo, token) {
  try {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/readme`;
    const response = await githubFetch(url, token);
    const data = await response.json();

    if (data.content) {
      const decoded = typeof Buffer !== 'undefined'
        ? Buffer.from(data.content, 'base64').toString('utf-8')
        : atob(data.content.replace(/\n/g, ''));
      return decoded;
    }

    return '';
  } catch (err) {
    if (err.message.includes('404')) {
      return '';
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
 * Fetch raw content of a specific file as a plain string.
 * Returns empty string if file has no content.
 */
export async function fetchFileContent(owner, repo, path, token) {
  const encodedPath = encodeURIComponent(path);
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${encodedPath}`;
  const response = await githubFetch(url, token);
  const data = await response.json();

  if (data.content) {
    const decoded = typeof Buffer !== 'undefined'
      ? Buffer.from(data.content, 'base64').toString('utf-8')
      : atob(data.content.replace(/\n/g, ''));
    return decoded;
  }

  return '';
}

/**
 * Fetch issues with pagination (max 100 per page, cap at 300 total).
 */
export async function fetchIssues(owner, repo, token, state = 'all') {
  const issues = [];
  const perPage = 100;
  const maxPages = 3;

  for (let page = 1; page <= maxPages; page++) {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues?state=${state}&per_page=${perPage}&page=${page}`;
    const response = await githubFetch(url, token);
    const data = await response.json();

    const filtered = data.filter(item => !item.pull_request);

    issues.push(...filtered.map(issue => ({
      number: issue.number,
      title: issue.title,
      state: issue.state,
      body: issue.body || '',
      labels: issue.labels.map(l => ({ name: l.name, color: l.color })),
      user: issue.user,
      created_at: issue.created_at,
      updated_at: issue.updated_at,
      comments: issue.comments,
      html_url: issue.html_url,
    })));

    if (data.length < perPage) break;
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
      user: pr.user,
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      merged: pr.merged_at !== null,
      draft: pr.draft || false,
      additions: pr.additions || 0,
      deletions: pr.deletions || 0,
      changed_files: pr.changed_files || 0,
      html_url: pr.html_url,
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
  const maxPages = 3;

  for (let page = 1; page <= maxPages; page++) {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/commits?per_page=${perPage}&page=${page}`;
    const response = await githubFetch(url, token);
    const data = await response.json();

    commits.push(...data.map(commit => ({
      sha: commit.sha,
      commit: {
        message: commit.commit?.message || '',
        author: {
          name: commit.commit?.author?.name || 'unknown',
          email: commit.commit?.author?.email,
          date: commit.commit?.author?.date,
        },
      },
      author: commit.author,
      html_url: commit.html_url,
      files: [], // Would need separate API call per commit
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
    avatar_url: contributor.avatar_url,
    html_url: contributor.html_url,
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
