// test/test-github.js
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' }); // Load .env from parent directory

import { parseRepoUrl, fetchRepoMetadata, fetchReadme, fetchFileTree, fetchIssues, fetchContributors } from '../src/github.js';

const repoUrl = 'https://github.com/vercel/next.js';
const { owner, repo } = parseRepoUrl(repoUrl);

// ✅ Load token from .env — no hardcoding
const token = process.env.GITHUB_TOKEN;

if (!token) {
  console.error('❌ GITHUB_TOKEN not found in .env file');
  console.error('Make sure your .env file has: GITHUB_TOKEN=ghp_xxxxxxxx');
  process.exit(1);
}

async function test() {
  console.log('🧪 Testing github.js with:', owner, repo);

  const meta = await fetchRepoMetadata(owner, repo, token);
  console.log('✅ Metadata:', meta.name, '| ⭐', meta.stars, '| 🍴', meta.forks);

  const readme = await fetchReadme(owner, repo, token);
  console.log('✅ README:', readme.content.length, 'chars');

  const tree = await fetchFileTree(owner, repo, token);
  console.log('✅ File tree:', tree.length, 'items');
  console.log('   Sample files:', tree.slice(0, 5).map(f => f.path));

  const issues = await fetchIssues(owner, repo, token, 'open');
  console.log('✅ Open issues:', issues.length);

  const contributors = await fetchContributors(owner, repo, token);
  console.log('✅ Contributors:', contributors.slice(0, 3).map(c => `${c.login} (${c.contributions})`));

  console.log('\n🎉 All tests passed!');
}

test().catch(err => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});
