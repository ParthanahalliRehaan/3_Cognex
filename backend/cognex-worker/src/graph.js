/**
 * graph.js — Optimized Knowledge Graph Engine for Cognex
 *
 * Improvements:
 *   • Pre-compiled regex cache (no recompilation per file)
 *   • Memoized file classification
 *   • Single-pass node/edge building
 *   • Graph pruning (removes isolated nodes)
 *   • Import/require extraction for cross-file edges
 *   • Reduced memory allocations
 */

// ─── Pre-compiled Regex Cache ─────────────────────────────────────────────────

const REGEX_CACHE = new Map();

function getFunctionRegex(ext) {
  if (REGEX_CACHE.has(ext)) return REGEX_CACHE.get(ext);

  let regex;
  switch (ext) {
    case 'js': case 'ts': case 'jsx': case 'tsx': case 'vue': case 'svelte': case 'astro':
      regex = /(?:^|\s)(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?(?:function|\([^)]*\))?\s*=>|class\s+(\w+)|(?:static\s+)?(\w+)\s*\([^)]*\)\s*\{)/gm;
      break;
    case 'py':
      regex = /(?:^|\s)(?:async\s+)?def\s+(\w+)|class\s+(\w+)/gm;
      break;
    case 'go':
      regex = /(?:^|\s)func\s+(?:\([^)]*\)\s+)?(\w+)|type\s+(\w+)\s+(?:struct|interface)/gm;
      break;
    case 'rs':
      regex = /(?:^|\s)fn\s+(\w+)|impl\s+(?:\w+\s+for\s+)?(\w+)|(?:struct|enum|trait)\s+(\w+)/gm;
      break;
    case 'rb':
      regex = /(?:^|\s)def\s+(\w+)|class\s+(\w+)|module\s+(\w+)/gm;
      break;
    case 'java': case 'kt': case 'swift': case 'scala':
      regex = /(?:^|\s)(?:public|private|protected|static|final|async)?\s*(?:[\w<>,\s]+\s+)?(\w+)\s*\([^)]*\)\s*(?:const|throws|override)?\s*\{|class\s+(\w+)|interface\s+(\w+)/gm;
      break;
    case 'php':
      regex = /(?:^|\s)function\s+(\w+)|class\s+(\w+)|interface\s+(\w+)|trait\s+(\w+)/gm;
      break;
    case 'c': case 'cpp': case 'h': case 'cs':
      regex = /(?:^|\s)(?:[\w*\s]+)\s+(\w+)\s*\([^)]*\)\s*\{|(?:struct|class|enum)\s+(\w+)/gm;
      break;
    default:
      regex = /(?:^|\s)(?:function|def|fn|class)\s+(\w+)/gm;
  }

  REGEX_CACHE.set(ext, regex);
  return regex;
}

const IMPORT_REGEX = {
  js: /(?:import|require)\s*\(?['"`]([^'"`]+)['"`]/g,
  ts: /(?:import|require)\s*\(?['"`]([^'"`]+)['"`]/g,
  py: /(?:^|\s)(?:import|from)\s+([\w.]+)/gm,
  go: /import\s+(?:\(\s*([\s\S]*?)\)|"([^"]+)")/gm,
  rs: /use\s+([\w:]+)/gm,
};

// ─── Fast File Classification ─────────────────────────────────────────────────

const CODE_EXTS = new Set([
  'js','ts','jsx','tsx','py','rb','go','rs','java','c','cpp','h','cs','php',
  'swift','kt','scala','r','sh','bash','lua','elixir','ex','exs','clj','erl',
  'fs','ml','hs','jl','dart','vue','svelte','astro','sol',
]);

const CONFIG_NAMES = new Set([
  'package.json','package-lock.json','yarn.lock','pnpm-lock.yaml',
  'requirements.txt','pyproject.toml','setup.py','poetry.lock',
  'cargo.toml','cargo.lock','go.mod','go.sum',
  'gemfile','gemfile.lock','composer.json','composer.lock',
  'pom.xml','build.gradle','cmakelists.txt','makefile',
  'dockerfile','docker-compose.yml','docker-compose.yaml',
  'tsconfig.json','jsconfig.json','.env.example',
]);

const DOC_EXTS = new Set(['md','mdx','rst','txt','adoc','org']);
const CLASSIFY_CACHE = new Map();

function classifyFile(path) {
  if (CLASSIFY_CACHE.has(path)) return CLASSIFY_CACHE.get(path);

  const parts = path.split('/');
  const name = parts[parts.length - 1].toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : '';

  let category = 'other';
  if (CODE_EXTS.has(ext)) category = 'source';
  else if (CONFIG_NAMES.has(name)) category = 'config';
  else if (DOC_EXTS.has(ext)) category = 'doc';
  else if (name.startsWith('readme')) category = 'readme';

  const result = { path, name, ext, category };
  CLASSIFY_CACHE.set(path, result);
  return result;
}

// ─── Node & Edge Factories ────────────────────────────────────────────────────

function createNode(repoUrl, type, label, metadata) {
  return { repo_url: repoUrl, node_type: type, label, metadata };
}

function createEdge(repoUrl, source, target, relation, metadata = {}) {
  return { repo_url: repoUrl, source_label: source, target_label: target, relation, metadata };
}

// ─── Optimized Function Extraction ────────────────────────────────────────────

const FALSE_POSITIVES = new Set([
  'if','for','while','switch','catch','return','var','let','const','new',
  'this','super','true','false','null','undefined','typeof','instanceof',
  'function','class','async','await','static','public','private','protected',
]);

function extractFunctions(code, ext) {
  const regex = getFunctionRegex(ext);
  const functions = [];
  let match;

  while ((match = regex.exec(code)) !== null) {
    const name = match[1] || match[2] || match[3] || match[4];
    if (!name || name.length <= 1 || name.startsWith('_')) continue;
    if (FALSE_POSITIVES.has(name.toLowerCase())) continue;
    if (/^\d/.test(name)) continue;
    functions.push(name);
  }

  // Deduplicate while preserving order
  return [...new Set(functions)];
}

function extractImports(code, ext) {
  const regex = IMPORT_REGEX[ext];
  if (!regex) return [];
  const imports = [];
  let match;
  while ((match = regex.exec(code)) !== null) {
    const raw = match[1] || match[2];
    if (raw) imports.push(raw.trim());
  }
  return [...new Set(imports)];
}

// ─── Dependency Extraction ────────────────────────────────────────────────────

function extractNpmDeps(text) {
  try {
    const pkg = JSON.parse(text);
    const deps = [];
    for (const source of ['dependencies','devDependencies','peerDependencies']) {
      const obj = pkg[source];
      if (!obj) continue;
      for (const [name, version] of Object.entries(obj)) {
        deps.push({ name, version: String(version), source, type: 'npm' });
      }
    }
    return deps;
  } catch { return []; }
}

function extractPythonDeps(text) {
  const deps = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t[0] === '#' || t[0] === '-') continue;
    const m = t.match(/^([a-zA-Z0-9_-]+)(?:[<>=!~^].*)?$/);
    if (m) deps.push({ name: m[1], version: 'latest', source: 'requirements.txt', type: 'pip' });
  }
  return deps;
}

function extractGoDeps(text) {
  const deps = [];
  const modRegex = /require\s+\(\s*([\s\S]*?)\)/m;
  const match = text.match(modRegex);
  if (match) {
    for (const line of match[1].split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        deps.push({ name: parts[0], version: parts[1], source: 'go.mod', type: 'go' });
      }
    }
  }
  return deps;
}

function extractDependencies(filePath, content) {
  const name = filePath.split('/').pop().toLowerCase();
  if (name === 'package.json') return extractNpmDeps(content);
  if (name === 'requirements.txt') return extractPythonDeps(content);
  if (name === 'go.mod') return extractGoDeps(content);
  return [];
}

// ─── Main Graph Builder (Single-Pass, CPU-Optimized) ──────────────────────────

export function buildGraph(repoUrl, data) {
  const nodes = [];
  const edges = [];
  const nodeSet = new Set(); // For O(1) dedup
  const edgeSet = new Set(); // For O(1) dedup
  const filePathSet = new Set(); // For fast lookup

  function addNode(type, label, metadata) {
    const key = `${type}:${label}`;
    if (nodeSet.has(key)) return label;
    nodeSet.add(key);
    nodes.push(createNode(repoUrl, type, label, metadata));
    return label;
  }

  function addEdge(src, tgt, rel, meta) {
    const key = `${src}|${rel}|${tgt}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push(createEdge(repoUrl, src, tgt, rel, meta));
  }

  const meta = data.metadata;
  const repoLabel = meta ? `${meta.owner}/${meta.repo}` : repoUrl;

  // 1. Repo node
  if (meta) {
    addNode('repo', repoLabel, {
      owner: meta.owner, repo: meta.repo,
      description: meta.description, stars: meta.stars,
      forks: meta.forks, language: meta.language,
      topics: meta.topics, html_url: meta.htmlUrl,
    });
  }

  // 2. Files + build path set
  const fileNodes = [];
  if (data.fileTree) {
    for (const file of data.fileTree) {
      if (file.type && file.type !== 'blob') continue;
      const c = classifyFile(file.path);
      filePathSet.add(file.path);
      addNode('file', file.path, {
        path: file.path, name: c.name, extension: c.ext,
        category: c.category, size: file.size || 0,
      });
      fileNodes.push({ path: file.path, ...c });
      addEdge(repoLabel, file.path, 'CONTAINS');
    }
  }

  // 3. Functions, dependencies, imports (process only files we have content for)
  if (data.fileContents) {
    for (const { path, ext, category } of fileNodes) {
      const content = data.fileContents[path];
      if (!content) continue;

      // Functions
      if (category === 'source') {
        const funcs = extractFunctions(content, ext);
        for (const fn of funcs) {
          const fnLabel = `${path}::${fn}`;
          addNode('function', fnLabel, { name: fn, file_path: path, language: ext });
          addEdge(path, fnLabel, 'CONTAINS');
        }

        // Cross-file imports
        const imports = extractImports(content, ext);
        for (const imp of imports) {
          // Try to resolve import to a file in the tree
          const resolved = resolveImport(imp, path, filePathSet);
          if (resolved && resolved !== path) {
            addEdge(path, resolved, 'IMPORTS');
          }
        }
      }

      // Dependencies
      if (category === 'config') {
        const deps = extractDependencies(path, content);
        for (const dep of deps) {
          const depLabel = `${dep.type}:${dep.name}`;
          addNode('dependency', depLabel, {
            name: dep.name, version: dep.version,
            package_type: dep.type, source_file: path,
          });
          addEdge(path, depLabel, 'DEPENDS_ON', { version: dep.version });
        }
      }
    }
  }

  // 4. Contributors
  if (data.contributors) {
    for (const c of data.contributors) {
      if (!c.login) continue;
      addNode('contributor', c.login, {
        username: c.login, avatar_url: c.avatarUrl,
        html_url: c.htmlUrl, contributions: c.contributions,
      });
    }
  }

  // 5. Commits
  if (data.commits) {
    for (const commit of data.commits) {
      const sha = commit.shortSha || commit.sha?.substring(0, 7);
      if (!sha) continue;
      const label = `commit:${sha}`;
      addNode('commit', label, {
        sha: commit.sha, short_sha: sha,
        message: (commit.message || '').split('\n')[0],
        full_message: commit.message || '',
        author_login: commit.authorLogin,
        author_name: commit.authorName,
        date: commit.date,
      });
      if (commit.authorLogin) {
        addEdge(commit.authorLogin, label, 'AUTHORED', { date: commit.date });
      }
    }
  }

  // 6. Issues
  if (data.issues) {
    for (const issue of data.issues) {
      const label = `issue:#${issue.number}`;
      addNode('issue', label, {
        number: issue.number, title: issue.title,
        state: issue.state, labels: issue.labels || [],
        body: (issue.body || '').substring(0, 3000),
        user: issue.user, created_at: issue.createdAt,
        comments_count: issue.comments,
      });
      if (issue.user) addEdge(issue.user, label, 'OPENED');

      // Reference files mentioned in body
      if (issue.body && filePathSet.size > 0) {
        const bodyLower = issue.body.toLowerCase();
        for (const fp of filePathSet) {
          const fname = fp.split('/').pop().toLowerCase();
          if (bodyLower.includes(fp.toLowerCase()) || bodyLower.includes(fname)) {
            addEdge(label, fp, 'REFERENCES');
          }
        }
      }
    }
  }

  // 7. PRs
  if (data.pullRequests) {
    for (const pr of data.pullRequests) {
      const label = `pr:#${pr.number}`;
      addNode('pr', label, {
        number: pr.number, title: pr.title,
        state: pr.state, merged: pr.merged, draft: pr.draft,
        body: (pr.body || '').substring(0, 3000),
        user: pr.user, created_at: pr.createdAt,
      });
      if (pr.user) addEdge(pr.user, label, 'OPENED');

      // Fixes references
      const text = `${pr.title} ${pr.body || ''}`;
      const matches = text.match(/(?:fixes|closes|resolves|fixed|close|resolve)\s+#(\d+)/gi);
      if (matches) {
        for (const m of matches) {
          const num = m.match(/\d+/)[0];
          addEdge(label, `issue:#${num}`, 'FIXES');
        }
      }
    }
  }

  // 8. README
  if (data.readme) {
    addNode('readme', 'README', {
      content_preview: data.readme.substring(0, 1500),
      length: data.readme.length,
    });
    addEdge(repoLabel, 'README', 'CONTAINS');
  }

  // 9. Prune isolated nodes (no edges, not repo/readme)
  const connected = new Set();
  for (const e of edges) {
    connected.add(e.source_label);
    connected.add(e.target_label);
  }
  const prunedNodes = nodes.filter(n =>
    n.node_type === 'repo' ||
    n.node_type === 'readme' ||
    connected.has(n.label)
  );

  return { nodes: prunedNodes, edges };
}

// ─── Import Resolution ────────────────────────────────────────────────────────

function resolveImport(importPath, currentFile, filePathSet) {
  // Relative imports
  if (importPath.startsWith('.')) {
    const dir = currentFile.split('/').slice(0, -1).join('/');
    const candidates = [
      `${dir}/${importPath}`,
      `${dir}/${importPath}.js`,
      `${dir}/${importPath}.ts`,
      `${dir}/${importPath}.jsx`,
      `${dir}/${importPath}.tsx`,
      `${dir}/${importPath}/index.js`,
      `${dir}/${importPath}/index.ts`,
    ];
    for (const c of candidates) {
      const normalized = c.replace(/\/\//g, '/');
      if (filePathSet.has(normalized)) return normalized;
    }
  }
  return null;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function getGraphStats(nodes, edges) {
  const stats = { totalNodes: nodes.length, totalEdges: edges.length, nodeTypes: {}, edgeRelations: {} };
  for (const n of nodes) stats.nodeTypes[n.node_type] = (stats.nodeTypes[n.node_type] || 0) + 1;
  for (const e of edges) stats.edgeRelations[e.relation] = (stats.edgeRelations[e.relation] || 0) + 1;
  return stats;
}

export function filterNodesByType(nodes, type) {
  return nodes.filter(n => n.node_type === type);
}

export function getNodeNeighbors(label, edges) {
  const incoming = [];
  const outgoing = [];
  for (const e of edges) {
    if (e.target_label === label) incoming.push({ from: e.source_label, relation: e.relation });
    if (e.source_label === label) outgoing.push({ to: e.target_label, relation: e.relation });
  }
  return { incoming, outgoing };
}

export default buildGraph;
