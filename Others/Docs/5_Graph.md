## What `graph.js` Does(These are older version code)

This module is the heart of Cognex's intelligence. It takes raw data from `github.js` (files, commits, issues, PRs, contributors, code contents) and transforms it into a structured graph of **nodes** (entities) and **edges** (relationships). This graph lets the AI agent answer questions like:
- *"Who wrote the auth feature?"* → traverse `contributor → commit → file → function`
- *"What issues are related to package X?"* → traverse `dependency → file → issue`

---

## The Code: `backend/cognex-worker/src/graph.js`

```javascript
/**
 * graph.js — Knowledge Graph Engine for Cognex
 * 
 * Parses GitHub repo data into nodes and edges for Supabase storage.
 * Nodes: file, function, contributor, issue, pr, commit, dependency
 * Edges: CONTAINS, AUTHORED, MODIFIES, REFERENCES, FIXES, DEPENDS_ON, OPENED
 */

// ─── Node & Edge Builders ─────────────────────────────────────────────────────

/**
 * Create a node object with consistent structure
 */
function createNode(repoUrl, type, label, metadata = {}) {
  return {
    repo_url: repoUrl,
    node_type: type,
    label: label,
    metadata: {
      ...metadata,
      extracted_at: new Date().toISOString(),
    },
  };
}

/**
 * Create an edge object linking two nodes
 */
function createEdge(repoUrl, sourceLabel, targetLabel, relation, metadata = {}) {
  return {
    repo_url: repoUrl,
    source_label: sourceLabel,
    target_label: targetLabel,
    relation: relation,
    metadata: metadata,
  };
}

// ─── File Tree Parsing ────────────────────────────────────────────────────────

const CODE_EXTENSIONS = new Set([
  'js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h',
  'cs', 'php', 'swift', 'kt', 'scala', 'r', 'm', 'mm', 'pl', 'sh', 'bash',
  'zsh', 'ps1', 'lua', 'vim', 'elixir', 'ex', 'exs', 'clj', 'cljs', 'erl',
  'hrl', 'fs', 'fsx', 'ml', 'mli', 'hs', 'lhs', 'jl', 'cr', 'nim', 'dart',
  'groovy', 'gvy', 'gy', 'gsh', 'vue', 'svelte', 'astro', 'sol', 'vy'
]);

const CONFIG_FILES = new Set([
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'requirements.txt', 'Pipfile', 'Pipfile.lock', 'poetry.lock', 'setup.py',
  'setup.cfg', 'pyproject.toml', 'Cargo.toml', 'Cargo.lock', 'go.mod', 'go.sum',
  'Gemfile', 'Gemfile.lock', 'composer.json', 'composer.lock', 'pom.xml',
  'build.gradle', 'gradle.properties', 'settings.gradle', 'CMakeLists.txt',
  'Makefile', 'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  '.env.example', 'tsconfig.json', 'jsconfig.json', 'webpack.config.js',
  'vite.config.js', 'rollup.config.js', 'eslint.config.js', '.eslintrc',
  'tailwind.config.js', 'postcss.config.js', 'babel.config.js', 'jest.config.js',
  'vitest.config.js', 'next.config.js', 'nuxt.config.ts', 'svelte.config.js'
]);

const DOC_EXTENSIONS = new Set(['md', 'mdx', 'rst', 'txt', 'adoc', 'org']);

/**
 * Classify a file path into category and extract metadata
 */
function classifyFile(path) {
  const parts = path.split('/');
  const name = parts[parts.length - 1];
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  
  let category = 'other';
  if (CODE_EXTENSIONS.has(ext)) category = 'source';
  else if (CONFIG_FILES.has(name) || CONFIG_FILES.has(name.toLowerCase())) category = 'config';
  else if (DOC_EXTENSIONS.has(ext)) category = 'doc';
  else if (name.toLowerCase() === 'readme.md' || name.toLowerCase().startsWith('readme')) category = 'readme';
  
  return { path, name, ext, category, size: null };
}

// ─── Code Parsing (Basic Regex) ───────────────────────────────────────────────

/**
 * Extract function/class names from source code using language-specific regex
 */
function extractFunctions(code, extension) {
  const functions = [];
  let regex;
  
  // JavaScript / TypeScript / JSX / TSX / Vue / Svelte / Astro
  if (['js', 'ts', 'jsx', 'tsx', 'vue', 'svelte', 'astro'].includes(extension)) {
    regex = /(?:function|async function)\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?(?:function|\(?[^)]*\)?\s*=>)|class\s+(\w+)|(?:export\s+)?(?:async\s+)?function\s*\*\s*(\w+)|(\w+)\s*=\s*class\s|(?:static\s+)?(\w+)\s*\([^)]*\)\s*\{/g;
  }
  // Python
  else if (extension === 'py') {
    regex = /def\s+(\w+)|class\s+(\w+)|async\s+def\s+(\w+)/g;
  }
  // Go
  else if (extension === 'go') {
    regex = /func\s+(?:\([^)]+\)\s+)?(\w+)|type\s+(\w+)\s+struct|type\s+(\w+)\s+interface/g;
  }
  // Rust
  else if (extension === 'rs') {
    regex = /fn\s+(\w+)|impl\s+(?:\w+\s+for\s+)?(\w+)|struct\s+(\w+)|enum\s+(\w+)|trait\s+(\w+)/g;
  }
  // Ruby
  else if (extension === 'rb') {
    regex = /def\s+(\w+)|class\s+(\w+)|module\s+(\w+)/g;
  }
  // Java / C / C++ / C# / Kotlin / Swift / Scala
  else if (['java', 'c', 'cpp', 'h', 'cs', 'kt', 'swift', 'scala'].includes(extension)) {
    regex = /(?:public|private|protected|static|final|async|override|virtual|inline|export)?\s*(?:[\w<>,\s]+\s+)?(\w+)\s*\([^)]*\)\s*(?:const|throws|override)?\s*\{|class\s+(\w+)|interface\s+(\w+)|struct\s+(\w+)|enum\s+(\w+)/g;
  }
  // PHP
  else if (extension === 'php') {
    regex = /function\s+(\w+)|class\s+(\w+)|interface\s+(\w+)|trait\s+(\w+)/g;
  }
  // Shell scripts
  else if (['sh', 'bash', 'zsh'].includes(extension)) {
    regex = /(\w+)\s*\(\)\s*\{/g;
  }
  // Generic fallback
  else {
    regex = /function\s+(\w+)|def\s+(\w+)|class\s+(\w+)|fn\s+(\w+)/g;
  }
  
  let match;
  while ((match = regex.exec(code)) !== null) {
    const name = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];
    if (name && name.length > 1 && !name.startsWith('_') && !/^\d/.test(name)) {
      // Avoid duplicates and common false positives
      const lower = name.toLowerCase();
      if (!['if', 'for', 'while', 'switch', 'catch', 'return', 'var', 'let', 'const', 'new', 'this', 'super', 'true', 'false', 'null', 'undefined'].includes(lower)) {
        functions.push(name);
      }
    }
  }
  
  return [...new Set(functions)]; // Deduplicate
}

// ─── Dependency Extraction ────────────────────────────────────────────────────

/**
 * Extract package names from package.json content
 */
function extractNpmDependencies(packageJsonText) {
  try {
    const pkg = JSON.parse(packageJsonText);
    const deps = [];
    const sources = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
    
    for (const source of sources) {
      if (pkg[source]) {
        for (const [name, version] of Object.entries(pkg[source])) {
          deps.push({
            name,
            version: String(version),
            source,
            type: 'npm',
          });
        }
      }
    }
    return deps;
  } catch (e) {
    return [];
  }
}

/**
 * Extract package names from requirements.txt content
 */
function extractPythonDependencies(requirementsText) {
  const deps = [];
  const lines = requirementsText.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;
    
    // Match: package==1.0.0, package>=1.0, package~=1.0, package, etc.
    const match = trimmed.match(/^([a-zA-Z0-9_-]+)(?:[<>=!~^].*)?$/);
    if (match) {
      deps.push({
        name: match[1],
        version: trimmed.includes('=') || trimmed.includes('>') || trimmed.includes('<') ? trimmed.split(/[<>=!~^]/)[1]?.trim() || 'latest' : 'latest',
        source: 'requirements.txt',
        type: 'pip',
      });
    }
  }
  return deps;
}

/**
 * Extract dependencies from various config file contents
 */
function extractDependencies(filePath, content) {
  const name = filePath.split('/').pop().toLowerCase();
  
  if (name === 'package.json') return extractNpmDependencies(content);
  if (name === 'requirements.txt') return extractPythonDependencies(content);
  // TODO: Add Cargo.toml, go.mod, Gemfile, etc. as needed
  
  return [];
}

// ─── Main Graph Builder ───────────────────────────────────────────────────────

/**
 * Build a complete knowledge graph from all GitHub data
 * 
 * @param {string} repoUrl - Full GitHub repo URL
 * @param {Object} data - Object containing all fetched GitHub data
 * @returns {Object} { nodes: Array, edges: Array }
 */
export function buildGraph(repoUrl, data) {
  const nodes = [];
  const edges = [];
  const nodeMap = new Map(); // label -> node for deduplication
  
  // Helper to add node and return its label
  function addNode(type, label, metadata) {
    const key = `${type}:${label}`;
    if (nodeMap.has(key)) return label;
    
    const node = createNode(repoUrl, type, label, metadata);
    nodes.push(node);
    nodeMap.set(key, node);
    return label;
  }
  
  // Helper to add edge
  function addEdge(sourceLabel, targetLabel, relation, metadata = {}) {
    edges.push(createEdge(repoUrl, sourceLabel, targetLabel, relation, metadata));
  }
  
  // ─── 1. REPO METADATA NODE ────────────────────────────────────────────────
  
  if (data.metadata) {
    const meta = data.metadata;
    addNode('repo', `${meta.owner}/${meta.repo}`, {
      owner: meta.owner,
      repo: meta.repo,
      description: meta.description,
      stars: meta.stargazers_count,
      forks: meta.forks_count,
      language: meta.language,
      topics: meta.topics,
      created_at: meta.created_at,
      updated_at: meta.updated_at,
      html_url: meta.html_url,
    });
  }
  
  // ─── 2. FILE NODES (from file tree) ───────────────────────────────────────
  
  if (data.fileTree && Array.isArray(data.fileTree)) {
    for (const file of data.fileTree) {
      if (file.type !== 'blob') continue; // Skip directories
      
      const classified = classifyFile(file.path);
      const fileLabel = file.path;
      
      addNode('file', fileLabel, {
        path: file.path,
        name: classified.name,
        extension: classified.ext,
        category: classified.category,
        size: file.size || null,
        sha: file.sha,
      });
      
      // Edge: repo CONTAINS file
      if (data.metadata) {
        addEdge(`${data.metadata.owner}/${data.metadata.repo}`, fileLabel, 'CONTAINS');
      }
      
      // ─── 3. FUNCTION NODES (from file contents) ─────────────────────────
      
      if (classified.category === 'source' && data.fileContents && data.fileContents[file.path]) {
        const content = data.fileContents[file.path];
        const functions = extractFunctions(content, classified.ext);
        
        for (const funcName of functions) {
          addNode('function', `${file.path}::${funcName}`, {
            name: funcName,
            file_path: file.path,
            language: classified.ext,
          });
          
          // Edge: file CONTAINS function
          addEdge(fileLabel, `${file.path}::${funcName}`, 'CONTAINS');
        }
      }
      
      // ─── 4. DEPENDENCY NODES (from config files) ────────────────────────
      
      if (classified.category === 'config' && data.fileContents && data.fileContents[file.path]) {
        const deps = extractDependencies(file.path, data.fileContents[file.path]);
        
        for (const dep of deps) {
          const depLabel = `${dep.type}:${dep.name}`;
          addNode('dependency', depLabel, {
            name: dep.name,
            version: dep.version,
            package_type: dep.type,
            source_file: file.path,
            source_field: dep.source,
          });
          
          // Edge: file DEPENDS_ON dependency
          addEdge(fileLabel, depLabel, 'DEPENDS_ON', {
            version: dep.version,
            source: dep.source,
          });
        }
      }
    }
  }
  
  // ─── 5. CONTRIBUTOR NODES ─────────────────────────────────────────────────
  
  if (data.contributors && Array.isArray(data.contributors)) {
    for (const contributor of data.contributors) {
      const login = contributor.login || contributor.author?.login;
      if (!login) continue;
      
      addNode('contributor', login, {
        username: login,
        avatar_url: contributor.avatar_url,
        html_url: contributor.html_url,
        contributions: contributor.contributions,
      });
    }
  }
  
  // ─── 6. COMMIT NODES & EDGES ─────────────────────────────────────────────
  
  if (data.commits && Array.isArray(data.commits)) {
    for (const commit of data.commits) {
      const sha = commit.sha?.substring(0, 7) || commit.sha;
      const message = commit.commit?.message || commit.message || 'No message';
      const authorName = commit.commit?.author?.name || commit.author?.login || 'unknown';
      const authorEmail = commit.commit?.author?.email;
      const date = commit.commit?.author?.date || commit.commit?.committer?.date;
      const authorLogin = commit.author?.login;
      
      // Use short SHA as label, full message in metadata
      const commitLabel = `commit:${sha}`;
      addNode('commit', commitLabel, {
        sha: commit.sha,
        short_sha: sha,
        message: message.split('\n')[0], // First line only
        full_message: message,
        author_name: authorName,
        author_email: authorEmail,
        author_login: authorLogin,
        date: date,
        url: commit.html_url,
      });
      
      // Edge: contributor AUTHORED commit
      if (authorLogin) {
        addEdge(authorLogin, commitLabel, 'AUTHORED', { date });
      }
      
      // Edge: commit MODIFIES file (from commit.files if available)
      if (commit.files && Array.isArray(commit.files)) {
        for (const file of commit.files) {
          if (file.filename) {
            addEdge(commitLabel, file.filename, 'MODIFIES', {
              status: file.status, // added, removed, modified
              additions: file.additions,
              deletions: file.deletions,
              changes: file.changes,
            });
          }
        }
      }
    }
  }
  
  // ─── 7. ISSUE NODES & EDGES ──────────────────────────────────────────────
  
  if (data.issues && Array.isArray(data.issues)) {
    for (const issue of data.issues) {
      const issueLabel = `issue:#${issue.number}`;
      addNode('issue', issueLabel, {
        number: issue.number,
        title: issue.title,
        state: issue.state,
        labels: issue.labels?.map(l => l.name) || [],
        body: issue.body?.substring(0, 5000) || null, // Truncate long bodies
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        closed_at: issue.closed_at,
        comments_count: issue.comments,
        html_url: issue.html_url,
      });
      
      // Edge: contributor OPENED issue
      if (issue.user?.login) {
        addEdge(issue.user.login, issueLabel, 'OPENED', {
          created_at: issue.created_at,
        });
      }
      
      // Edge: issue REFERENCES file (from body mentions)
      if (issue.body && data.fileTree) {
        const filePaths = data.fileTree
          .filter(f => f.type === 'blob')
          .map(f => f.path);
        
        for (const path of filePaths) {
          // Simple check: does the issue body mention the file path or name?
          const fileName = path.split('/').pop();
          const bodyLower = issue.body.toLowerCase();
          if (bodyLower.includes(path.toLowerCase()) || bodyLower.includes(fileName.toLowerCase())) {
            addEdge(issueLabel, path, 'REFERENCES', {
              mention_type: 'body',
            });
          }
        }
      }
    }
  }
  
  // ─── 8. PULL REQUEST NODES & EDGES ───────────────────────────────────────
  
  if (data.pullRequests && Array.isArray(data.pullRequests)) {
    for (const pr of data.pullRequests) {
      const prLabel = `pr:#${pr.number}`;
      addNode('pr', prLabel, {
        number: pr.number,
        title: pr.title,
        state: pr.state,
        merged: pr.merged,
        draft: pr.draft,
        body: pr.body?.substring(0, 5000) || null,
        created_at: pr.created_at,
        updated_at: pr.updated_at,
        merged_at: pr.merged_at,
        additions: pr.additions,
        deletions: pr.deletions,
        changed_files: pr.changed_files,
        html_url: pr.html_url,
      });
      
      // Edge: contributor OPENED pr
      if (pr.user?.login) {
        addEdge(pr.user.login, prLabel, 'OPENED', {
          created_at: pr.created_at,
        });
      }
      
      // Edge: pr FIXES issue (from title/body mentions like "Fixes #123")
      const textToSearch = `${pr.title} ${pr.body || ''}`;
      const fixMatches = textToSearch.match(/(?:fixes|closes|resolves|fixed|close|resolve)\s+#(\d+)/gi);
      if (fixMatches) {
        for (const match of fixMatches) {
          const issueNum = match.match(/\d+/)[0];
          addEdge(prLabel, `issue:#${issueNum}`, 'FIXES', {
            mention_source: 'title_or_body',
          });
        }
      }
      
      // Edge: pr MODIFIES file (from files if available)
      if (pr.files && Array.isArray(pr.files)) {
        for (const file of pr.files) {
          if (file.filename) {
            addEdge(prLabel, file.filename, 'MODIFIES', {
              status: file.status,
              additions: file.additions,
              deletions: file.deletions,
            });
          }
        }
      }
    }
  }
  
  // ─── 9. README NODE (special handling) ───────────────────────────────────
  
  if (data.readme) {
    addNode('readme', 'README', {
      content_preview: data.readme.substring(0, 2000),
      length: data.readme.length,
    });
    
    if (data.metadata) {
      addEdge(`${data.metadata.owner}/${data.metadata.repo}`, 'README', 'CONTAINS');
    }
  }
  
  return { nodes, edges };
}

// ─── Graph Utilities ──────────────────────────────────────────────────────────

/**
 * Get statistics about the built graph
 */
export function getGraphStats(nodes, edges) {
  const stats = {
    totalNodes: nodes.length,
    totalEdges: edges.length,
    nodeTypes: {},
    edgeRelations: {},
  };
  
  for (const node of nodes) {
    stats.nodeTypes[node.node_type] = (stats.nodeTypes[node.node_type] || 0) + 1;
  }
  
  for (const edge of edges) {
    stats.edgeRelations[edge.relation] = (stats.edgeRelations[edge.relation] || 0) + 1;
  }
  
  return stats;
}

/**
 * Filter nodes by type
 */
export function filterNodesByType(nodes, type) {
  return nodes.filter(n => n.node_type === type);
}

/**
 * Get neighbors of a node (both incoming and outgoing edges)
 */
export function getNodeNeighbors(nodeLabel, edges) {
  const incoming = edges.filter(e => e.target_label === nodeLabel).map(e => ({ from: e.source_label, relation: e.relation }));
  const outgoing = edges.filter(e => e.source_label === nodeLabel).map(e => ({ to: e.target_label, relation: e.relation }));
  return { incoming, outgoing };
}

export default buildGraph;
```

---

## What This File Does (Summary)

| Feature | Implementation |
|--------|----------------|
| **File Classification** | Categorizes files into `source`, `config`, `doc`, `readme`, `other` based on extension/filename |
| **Function Extraction** | Language-specific regex parsers for JS/TS, Python, Go, Rust, Ruby, Java, C/C++, PHP, and shell |
| **Dependency Parsing** | Parses `package.json` (npm) and `requirements.txt` (pip) |
| **Node Types** | `repo`, `file`, `function`, `contributor`, `commit`, `issue`, `pr`, `dependency`, `readme` |
| **Edge Types** | `CONTAINS`, `AUTHORED`, `MODIFIES`, `REFERENCES`, `FIXES`, `DEPENDS_ON`, `OPENED` |
| **Deduplication** | Uses a `Map` to prevent duplicate nodes |
| **Issue→File Linking** | Scans issue bodies for file path mentions |
| **PR→Issue Linking** | Detects "Fixes #123", "Closes #456" patterns in PR titles/bodies |
| **Utilities** | `getGraphStats`, `filterNodesByType`, `getNodeNeighbors` for analysis |
