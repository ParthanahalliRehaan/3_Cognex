// test/test-graph.js
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

import { buildGraph, getGraphStats, filterNodesByType, getNodeNeighbors } from '../src/graph.js';

// ─── Mock Data (simulating what github.js returns) ───────────────────────────

const mockRepoUrl = 'https://github.com/vercel/next.js';

const mockData = {
  metadata: {
    owner: 'vercel',
    repo: 'next.js',
    description: 'The React Framework for the Web',
    stargazers_count: 123456,
    forks_count: 26000,
    language: 'TypeScript',
    topics: ['react', 'framework', 'ssr', 'nodejs'],
    created_at: '2016-10-05T23:32:51Z',
    updated_at: '2024-01-15T10:30:00Z',
    html_url: 'https://github.com/vercel/next.js',
  },

  readme: '# Next.js\n\nThe React Framework for the Web. Used by some of the world\'s largest companies...',

  fileTree: [
    { path: 'package.json', type: 'blob', size: 2500, sha: 'abc123' },
    { path: 'README.md', type: 'blob', size: 15000, sha: 'def456' },
    { path: 'src/index.ts', type: 'blob', size: 3000, sha: 'ghi789' },
    { path: 'src/app.tsx', type: 'blob', size: 5000, sha: 'jkl012' },
    { path: 'lib/utils.js', type: 'blob', size: 1200, sha: 'mno345' },
    { path: 'docs/api.md', type: 'blob', size: 8000, sha: 'pqr678' },
    { path: 'tests/setup.ts', type: 'blob', size: 900, sha: 'stu901' },
    { path: '.github/workflows/ci.yml', type: 'blob', size: 1500, sha: 'vwx234' },
    { path: 'src/components/Button.tsx', type: 'blob', size: 2000, sha: 'yza567' },
    { path: 'public/favicon.ico', type: 'blob', size: 1500, sha: 'bcd890' },
  ],

  fileContents: {
    'package.json': JSON.stringify({
      name: 'next',
      version: '14.0.0',
      dependencies: {
        react: '^18.2.0',
        'react-dom': '^18.2.0',
        typescript: '^5.0.0',
      },
      devDependencies: {
        jest: '^29.0.0',
        eslint: '^8.0.0',
      },
    }),
    'src/index.ts': `
      export async function initializeApp() {
        console.log('Starting app...');
      }

      export const createServer = async () => {
        return { listen: () => {} };
      };

      class AppRouter {
        constructor() {}
        navigate(path: string) {}
      }

      export function* generateRoutes() {
        yield '/home';
        yield '/about';
      }
    `,
    'src/app.tsx': `
      import React from 'react';

      export default function App() {
        return <div>Hello Next.js</div>;
      }

      const Layout = ({ children }) => {
        return <main>{children}</main>;
      };

      class ErrorBoundary extends React.Component {
        render() {
          return this.props.children;
        }
      }
    `,
    'lib/utils.js': `
      function formatDate(date) {
        return date.toISOString();
      }

      const parseQuery = (query) => {
        return new URLSearchParams(query);
      };

      export function debounce(fn, ms) {
        let timer;
        return (...args) => {
          clearTimeout(timer);
          timer = setTimeout(() => fn(...args), ms);
        };
      }
    `,
    'src/components/Button.tsx': `
      interface ButtonProps {
        label: string;
        onClick: () => void;
      }

      export function Button({ label, onClick }: ButtonProps) {
        return <button onClick={onClick}>{label}</button>;
      }

      export const IconButton = (props) => <Button {...props} />;
    `,
  },

  contributors: [
    { login: 'timneutkens', contributions: 2450, avatar_url: 'https://avatars.githubusercontent.com/u/1', html_url: 'https://github.com/timneutkens' },
    { login: 'ijjk', contributions: 1890, avatar_url: 'https://avatars.githubusercontent.com/u/2', html_url: 'https://github.com/ijjk' },
    { login: 'shuding', contributions: 1200, avatar_url: 'https://avatars.githubusercontent.com/u/3', html_url: 'https://github.com/shuding' },
  ],

  commits: [
    {
      sha: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
      commit: {
        message: 'feat: add new app router\\n\\nThis implements the new app router with support for parallel routes.',
        author: { name: 'Tim Neutkens', email: 'tim@vercel.com', date: '2024-01-10T14:30:00Z' },
      },
      author: { login: 'timneutkens' },
      html_url: 'https://github.com/vercel/next.js/commit/a1b2c3d',
      files: [
        { filename: 'src/app.tsx', status: 'modified', additions: 50, deletions: 10, changes: 60 },
        { filename: 'src/index.ts', status: 'modified', additions: 30, deletions: 5, changes: 35 },
      ],
    },
    {
      sha: 'b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1',
      commit: {
        message: 'fix: resolve hydration mismatch in Button component',
        author: { name: 'JJ Kasper', email: 'jj@vercel.com', date: '2024-01-09T11:20:00Z' },
      },
      author: { login: 'ijjk' },
      html_url: 'https://github.com/vercel/next.js/commit/b2c3d4e',
      files: [
        { filename: 'src/components/Button.tsx', status: 'modified', additions: 12, deletions: 3, changes: 15 },
      ],
    },
  ],

  issues: [
    {
      number: 12345,
      title: 'App Router: hydration error on dynamic routes',
      state: 'open',
      labels: [{ name: 'bug' }, { name: 'app-router' }],
      body: 'When using dynamic routes in `src/app.tsx`, I get a hydration mismatch. The issue seems to be in the `App` function. Also affects `src/index.ts`.',
      created_at: '2024-01-08T09:00:00Z',
      updated_at: '2024-01-08T09:00:00Z',
      comments: 15,
      html_url: 'https://github.com/vercel/next.js/issues/12345',
      user: { login: 'shuding' },
    },
    {
      number: 12346,
      title: 'Feature request: add debounce to search',
      state: 'open',
      labels: [{ name: 'enhancement' }],
      body: 'Would be great to use the existing `debounce` function in `lib/utils.js` for the search input.',
      created_at: '2024-01-07T16:45:00Z',
      updated_at: '2024-01-07T16:45:00Z',
      comments: 3,
      html_url: 'https://github.com/vercel/next.js/issues/12346',
      user: { login: 'timneutkens' },
    },
  ],

  pullRequests: [
    {
      number: 56789,
      title: 'Fixes #12345 — resolve hydration mismatch in app router',
      state: 'closed',
      merged: true,
      draft: false,
      body: 'This PR fixes the hydration issue described in #12345 by updating the App component and server initialization.',
      created_at: '2024-01-09T10:00:00Z',
      updated_at: '2024-01-09T14:00:00Z',
      merged_at: '2024-01-09T14:00:00Z',
      additions: 45,
      deletions: 8,
      changed_files: 2,
      html_url: 'https://github.com/vercel/next.js/pull/56789',
      user: { login: 'ijjk' },
      files: [
        { filename: 'src/app.tsx', status: 'modified', additions: 40, deletions: 5 },
        { filename: 'src/index.ts', status: 'modified', additions: 5, deletions: 3 },
      ],
    },
  ],
};

// ─── Tests ───────────────────────────────────────────────────────────────────

async function testGraph() {
  console.log('🧪 Testing graph.js with mock data...\n');

  // Test 1: Build graph
  console.log('1️⃣  Building knowledge graph...');
  const { nodes, edges } = buildGraph(mockRepoUrl, mockData);
  console.log(`   ✅ Generated ${nodes.length} nodes, ${edges.length} edges`);

  // Test 2: Stats
  console.log('\n2️⃣  Graph statistics:');
  const stats = getGraphStats(nodes, edges);
  console.log('   📊 Total nodes:', stats.totalNodes);
  console.log('   📊 Total edges:', stats.totalEdges);
  console.log('   📊 Node types:', stats.nodeTypes);
  console.log('   📊 Edge relations:', stats.edgeRelations);

  // Test 3: File nodes
  console.log('\n3️⃣  File nodes:');
  const fileNodes = filterNodesByType(nodes, 'file');
  console.log(`   📁 Found ${fileNodes.length} files`);
  fileNodes.slice(0, 5).forEach(f => {
    console.log(`      - ${f.label} (${f.metadata.category}, ${f.metadata.extension})`);
  });

  // Test 4: Function extraction
  console.log('\n4️⃣  Function nodes:');
  const funcNodes = filterNodesByType(nodes, 'function');
  console.log(`   ⚙️  Found ${funcNodes.length} functions`);
  funcNodes.forEach(f => {
    console.log(`      - ${f.metadata.name} in ${f.metadata.file_path}`);
  });

  // Test 5: Dependency extraction
  console.log('\n5️⃣  Dependency nodes:');
  const depNodes = filterNodesByType(nodes, 'dependency');
  console.log(`   📦 Found ${depNodes.length} dependencies`);
  depNodes.forEach(d => {
    console.log(`      - ${d.metadata.name} (${d.metadata.package_type}@${d.metadata.version})`);
  });

  // Test 6: Contributor nodes
  console.log('\n6️⃣  Contributor nodes:');
  const contribNodes = filterNodesByType(nodes, 'contributor');
  contribNodes.forEach(c => {
    console.log(`      - ${c.label}: ${c.metadata.contributions} contributions`);
  });

  // Test 7: Commit nodes
  console.log('\n7️⃣  Commit nodes:');
  const commitNodes = filterNodesByType(nodes, 'commit');
  commitNodes.forEach(c => {
    console.log(`      - ${c.label}: ${c.metadata.message}`);
  });

  // Test 8: Issue nodes with file references
  console.log('\n8️⃣  Issue nodes & file references:');
  const issueNodes = filterNodesByType(nodes, 'issue');
  issueNodes.forEach(i => {
    console.log(`      - ${i.label}: ${i.metadata.title}`);
  });
  const refEdges = edges.filter(e => e.relation === 'REFERENCES');
  console.log(`   🔗 Found ${refEdges.length} issue→file references`);
  refEdges.forEach(e => {
    console.log(`      - ${e.source_label} → ${e.target_label}`);
  });

  // Test 9: PR→Issue FIXES edges
  console.log('\n9️⃣  PR → Issue FIXES edges:');
  const fixEdges = edges.filter(e => e.relation === 'FIXES');
  console.log(`   🔗 Found ${fixEdges.length} PR→Issue fixes`);
  fixEdges.forEach(e => {
    console.log(`      - ${e.source_label} fixes ${e.target_label}`);
  });

  // Test 10: Neighbor lookup
  console.log('\n🔟  Neighbor lookup for "timneutkens":');
  const neighbors = getNodeNeighbors('timneutkens', edges);
  console.log('   Incoming:', neighbors.incoming.length);
  console.log('   Outgoing:', neighbors.outgoing.length);
  neighbors.outgoing.slice(0, 3).forEach(e => {
    console.log(`      → ${e.to} (${e.relation})`);
  });

  // Test 11: Edge verification
  console.log('\n1️⃣1️⃣  Key edge verification:');
  const containsEdges = edges.filter(e => e.relation === 'CONTAINS');
  console.log(`   file CONTAINS function: ${containsEdges.length} edges`);

  const authoredEdges = edges.filter(e => e.relation === 'AUTHORED');
  console.log(`   contributor AUTHORED commit: ${authoredEdges.length} edges`);

  const modifiesEdges = edges.filter(e => e.relation === 'MODIFIES');
  console.log(`   commit MODIFIES file: ${modifiesEdges.length} edges`);

  const dependsEdges = edges.filter(e => e.relation === 'DEPENDS_ON');
  console.log(`   file DEPENDS_ON dependency: ${dependsEdges.length} edges`);

  const openedEdges = edges.filter(e => e.relation === 'OPENED');
  console.log(`   contributor OPENED issue/pr: ${openedEdges.length} edges`);

  console.log('\n🎉 All graph.js tests passed!');
}

testGraph().catch(err => {
  console.error('❌ Graph test failed:', err);
  console.error(err.stack);
  process.exit(1);
});
