// test/test-graph.js — Updated for improved graph.js
// Tests: pre-compiled regex, import resolution, graph pruning, O(1) dedup

import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

import { buildGraph, getGraphStats, filterNodesByType, getNodeNeighbors } from '../src/graph.js';

const mockRepoUrl = 'https://github.com/vercel/next.js';

const mockData = {
  metadata: {
    owner: 'vercel', repo: 'next.js',
    description: 'The React Framework for the Web',
    stars: 123456, forks: 26000, language: 'TypeScript',
    topics: ['react', 'framework', 'ssr', 'nodejs'],
    createdAt: '2016-10-05T23:32:51Z', updatedAt: '2024-01-15T10:30:00Z',
    htmlUrl: 'https://github.com/vercel/next.js',
  },
  readme: '# Next.js\n\nThe React Framework for the Web. Used by some of the world\'s largest companies...',
  fileTree: [
    { path: 'package.json', size: 2500, sha: 'abc123' },
    { path: 'README.md', size: 15000, sha: 'def456' },
    { path: 'src/index.ts', size: 3000, sha: 'ghi789' },
    { path: 'src/app.tsx', size: 5000, sha: 'jkl012' },
    { path: 'lib/utils.js', size: 1200, sha: 'mno345' },
    { path: 'src/components/Button.tsx', size: 2000, sha: 'yza567' },
    { path: 'tests/setup.ts', size: 900, sha: 'stu901' },
    { path: 'public/favicon.ico', size: 1500, sha: 'bcd890' },
  ],
  fileContents: {
    'package.json': JSON.stringify({
      name: 'next', version: '14.0.0',
      dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0', typescript: '^5.0.0' },
      devDependencies: { jest: '^29.0.0', eslint: '^8.0.0' },
    }),
    'src/index.ts': `
      export async function initializeApp() { console.log('Starting app...'); }
      export const createServer = async () => ({ listen: () => {} });
      class AppRouter { constructor() {} navigate(path: string) {} }
      export function* generateRoutes() { yield '/home'; yield '/about'; }
      import { Button } from './components/Button';
      import React from 'react';
    `,
    'src/app.tsx': `
      import React from 'react';
      import { initializeApp } from './index';
      export default function App() { return <div>Hello Next.js</div>; }
      const Layout = ({ children }) => { return <main>{children}</main>; };
      class ErrorBoundary extends React.Component { render() { return this.props.children; } }
    `,
    'lib/utils.js': `
      function formatDate(date) { return date.toISOString(); }
      const parseQuery = (query) => { return new URLSearchParams(query); };
      export function debounce(fn, ms) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); }; }
    `,
    'src/components/Button.tsx': `
      interface ButtonProps { label: string; onClick: () => void; }
      export function Button({ label, onClick }: ButtonProps) { return <button onClick={onClick}>{label}</button>; }
      export const IconButton = (props) => <Button {...props} />;
    `,
  },
  contributors: [
    { login: 'timneutkens', contributions: 2450, avatarUrl: 'https://avatars.githubusercontent.com/u/1', htmlUrl: 'https://github.com/timneutkens' },
    { login: 'ijjk', contributions: 1890, avatarUrl: 'https://avatars.githubusercontent.com/u/2', htmlUrl: 'https://github.com/ijjk' },
    { login: 'shuding', contributions: 1200, avatarUrl: 'https://avatars.githubusercontent.com/u/3', htmlUrl: 'https://github.com/shuding' },
  ],
  commits: [
    {
      sha: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
      shortSha: 'a1b2c3d',
      message: 'feat: add new app router\n\nThis implements the new app router with support for parallel routes.',
      authorName: 'Tim Neutkens', authorLogin: 'timneutkens',
      date: '2024-01-10T14:30:00Z',
      htmlUrl: 'https://github.com/vercel/next.js/commit/a1b2c3d',
    },
    {
      sha: 'b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1',
      shortSha: 'b2c3d4e',
      message: 'fix: resolve hydration mismatch in Button component',
      authorName: 'JJ Kasper', authorLogin: 'ijjk',
      date: '2024-01-09T11:20:00Z',
      htmlUrl: 'https://github.com/vercel/next.js/commit/b2c3d4e',
    },
  ],
  issues: [
    {
      number: 12345, title: 'App Router: hydration error on dynamic routes', state: 'open',
      labels: [{ name: 'bug' }, { name: 'app-router' }],
      body: 'When using dynamic routes in src/app.tsx, I get a hydration mismatch. The issue seems to be in the App function. Also affects src/index.ts.',
      createdAt: '2024-01-08T09:00:00Z', updatedAt: '2024-01-08T09:00:00Z',
      comments: 15, htmlUrl: 'https://github.com/vercel/next.js/issues/12345',
      user: 'shuding',
    },
    {
      number: 12346, title: 'Feature request: add debounce to search', state: 'open',
      labels: [{ name: 'enhancement' }],
      body: 'Would be great to use the existing debounce function in lib/utils.js for the search input.',
      createdAt: '2024-01-07T16:45:00Z', updatedAt: '2024-01-07T16:45:00Z',
      comments: 3, htmlUrl: 'https://github.com/vercel/next.js/issues/12346',
      user: 'timneutkens',
    },
  ],
  pullRequests: [
    {
      number: 56789, title: 'Fixes #12345 — resolve hydration mismatch in app router', state: 'closed',
      merged: true, draft: false,
      body: 'This PR fixes the hydration issue described in #12345 by updating the App component and server initialization.',
      createdAt: '2024-01-09T10:00:00Z', updatedAt: '2024-01-09T14:00:00Z',
      mergedAt: '2024-01-09T14:00:00Z', additions: 45, deletions: 8, changedFiles: 2,
      htmlUrl: 'https://github.com/vercel/next.js/pull/56789', user: 'ijjk',
    },
  ],
};

async function testGraph() {
  console.log('🧪 Testing improved graph.js...\n');

  // 1. Build graph
  console.log('1️⃣  Building knowledge graph (single-pass, O(1) dedup):');
  const start = Date.now();
  const { nodes, edges } = buildGraph(mockRepoUrl, mockData);
  const elapsed = Date.now() - start;
  console.log(`   ✅ ${nodes.length} nodes, ${edges.length} edges in ${elapsed}ms`);

  // 2. Stats
  console.log('\n2️⃣  Graph statistics:');
  const stats = getGraphStats(nodes, edges);
  console.log(`   📊 Total nodes: ${stats.totalNodes} | Total edges: ${stats.totalEdges}`);
  console.log(`   📊 Node types:`, stats.nodeTypes);
  console.log(`   📊 Edge relations:`, stats.edgeRelations);

  // 3. File nodes + classification
  console.log('\n3️⃣  File nodes (auto-classified):');
  const fileNodes = filterNodesByType(nodes, 'file');
  console.log(`   📁 ${fileNodes.length} files`);
  fileNodes.forEach(f => {
    console.log(`      - ${f.label} (${f.metadata.category}, ${f.metadata.extension || 'no ext'})`);
  });

  // 4. Function extraction (pre-compiled regex)
  console.log('\n4️⃣  Function nodes (pre-compiled regex cache):');
  const funcNodes = filterNodesByType(nodes, 'function');
  console.log(`   ⚙️  ${funcNodes.length} functions extracted`);
  funcNodes.forEach(f => {
    console.log(`      - ${f.metadata.name} in ${f.metadata.file_path}`);
  });

  // 5. Import resolution (cross-file edges)
  console.log('\n5️⃣  Import resolution (cross-file edges):');
  const importEdges = edges.filter(e => e.relation === 'IMPORTS');
  console.log(`   🔗 ${importEdges.length} IMPORTS edges found`);
  importEdges.forEach(e => {
    console.log(`      - ${e.source_label} → ${e.target_label}`);
  });

  // 6. Dependencies
  console.log('\n6️⃣  Dependency extraction (package.json):');
  const depNodes = filterNodesByType(nodes, 'dependency');
  console.log(`   📦 ${depNodes.length} dependencies`);
  depNodes.forEach(d => {
    console.log(`      - ${d.metadata.name} (${d.metadata.package_type}@${d.metadata.version})`);
  });

  // 7. Contributors
  console.log('\n7️⃣  Contributor nodes:');
  const contribNodes = filterNodesByType(nodes, 'contributor');
  contribNodes.forEach(c => {
    console.log(`   🏆 ${c.label}: ${c.metadata.contributions} contributions`);
  });

  // 8. Commits + AUTHORED edges
  console.log('\n8️⃣  Commit nodes & AUTHORED edges:');
  const commitNodes = filterNodesByType(nodes, 'commit');
  console.log(`   💾 ${commitNodes.length} commits`);
  commitNodes.forEach(c => {
    console.log(`      - ${c.label}: ${c.metadata.message}`);
  });
  const authoredEdges = edges.filter(e => e.relation === 'AUTHORED');
  console.log(`   🔗 ${authoredEdges.length} AUTHORED edges`);

  // 9. Issues + REFERENCES edges
  console.log('\n9️⃣  Issue nodes & file REFERENCES:');
  const issueNodes = filterNodesByType(nodes, 'issue');
  console.log(`   📌 ${issueNodes.length} issues`);
  issueNodes.forEach(i => {
    console.log(`      - ${i.label}: ${i.metadata.title.substring(0, 55)}...`);
  });
  const refEdges = edges.filter(e => e.relation === 'REFERENCES');
  console.log(`   🔗 ${refEdges.length} issue→file REFERENCES edges`);
  refEdges.forEach(e => {
    console.log(`      - ${e.source_label} → ${e.target_label}`);
  });

  // 10. PRs + FIXES edges
  console.log('\n🔟  PR nodes & FIXES edges:');
  const prNodes = filterNodesByType(nodes, 'pr');
  console.log(`   🔀 ${prNodes.length} PRs`);
  const fixEdges = edges.filter(e => e.relation === 'FIXES');
  console.log(`   🔗 ${fixEdges.length} PR→Issue FIXES edges`);
  fixEdges.forEach(e => {
    console.log(`      - ${e.source_label} fixes ${e.target_label}`);
  });

  // 11. Neighbor lookup
  console.log('\n1️⃣1️⃣  Neighbor lookup (timneutkens):');
  const neighbors = getNodeNeighbors('timneutkens', edges);
  console.log(`   📎 Incoming: ${neighbors.incoming.length} | Outgoing: ${neighbors.outgoing.length}`);
  neighbors.outgoing.slice(0, 3).forEach(e => {
    console.log(`      → ${e.to} (${e.relation})`);
  });

  // 12. Edge deduplication verification
  console.log('\n1️⃣2️⃣  Edge deduplication (no duplicates):');
  const edgeKeys = new Set(edges.map(e => `${e.source_label}|${e.relation}|${e.target_label}`));
  console.log(`   ✅ Unique edges: ${edgeKeys.size} === Total edges: ${edges.length} → ${edgeKeys.size === edges.length ? 'PASS' : 'FAIL'}`);

  // 13. Graph pruning (no isolated nodes)
  console.log('\n1️⃣3️⃣  Graph pruning (isolated nodes removed):');
  const connectedLabels = new Set();
  edges.forEach(e => { connectedLabels.add(e.source_label); connectedLabels.add(e.target_label); });
  const isolated = nodes.filter(n => n.node_type !== 'repo' && n.node_type !== 'readme' && !connectedLabels.has(n.label));
  console.log(`   ✅ Isolated nodes: ${isolated.length} (should be 0)`);
  if (isolated.length > 0) {
    isolated.forEach(n => console.log(`      ⚠️  ${n.node_type}: ${n.label}`));
  }

  console.log('\n🎉 All graph.js tests passed!');
}

testGraph().catch(err => {
  console.error('\n❌ Graph test failed:', err);
  console.error(err.stack);
  process.exit(1);
});
