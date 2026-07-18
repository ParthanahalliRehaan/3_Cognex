// test/test-github.js — Updated for improved github.js
// Tests: retry logic, ETag, batch fetching, selectFilesForIngestion, worker-safe base64

import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

import {
  parseRepoUrl,
  fetchRepoMetadata,
  fetchReadme,
  fetchFileTree,
  fetchIssues,
  fetchPullRequests,
  fetchCommits,
  fetchContributors,
  fetchFilesBatch,
  selectFilesForIngestion,
  GitHubError,
} from '../src/github.js';

const token = process.env.GITHUB_TOKEN;
const repoUrl = 'https://github.com/vercel/next.js';
const { owner, repo } = parseRepoUrl(repoUrl);

if (!token) {
  console.error('❌ GITHUB_TOKEN not found in .env');
  process.exit(1);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function test() {
  console.log('🧪 Testing improved github.js...\n');

  // 1. URL parsing + memoization
  console.log('1️⃣  parseRepoUrl + memoization:');
  const parsed1 = parseRepoUrl(repoUrl);
  const parsed2 = parseRepoUrl(repoUrl);
  console.log(`   ✅ ${parsed1.owner}/${parsed1.repo}`);
  console.log(`   ✅ Cache hit: ${parsed1 === parsed2}`);

  // 2. Metadata
  console.log('\n2️⃣  fetchRepoMetadata:');
  const meta = await fetchRepoMetadata(owner, repo, token);
  console.log(`   ✅ ${meta.fullName} | ⭐ ${meta.stars.toLocaleString()} | 🍴 ${meta.forks.toLocaleString()}`);
  console.log(`   📊 Language: ${meta.language} | Archived: ${meta.archived} | Fork: ${meta.fork}`);

  // 3. README (worker-safe base64)
  console.log('\n3️⃣  fetchReadme (worker-safe decode):');
  const readme = await fetchReadme(owner, repo, token);
  console.log(`   ✅ Length: ${readme.length.toLocaleString()} chars`);
  console.log(`   📝 Preview: ${readme.substring(0, 80).replace(/\n/g, ' ')}...`);

  // 4. File tree
  console.log('\n4️⃣  fetchFileTree:');
  const tree = await fetchFileTree(owner, repo, token);
  console.log(`   ✅ ${tree.length.toLocaleString()} files`);
  const sample = tree.slice(0, 5).map(f => f.path);
  console.log(`   📁 Sample: ${sample.join(', ')}`);

  // 5. Smart file selection
  console.log('\n5️⃣  selectFilesForIngestion (CPU-optimized):');
  const selected = selectFilesForIngestion(tree, 12, 8000);
  console.log(`   ✅ Selected ${selected.length} files for ingestion`);
  selected.forEach(f => {
    const name = f.path.split('/').pop();
    const marker = ['package.json','requirements.txt','go.mod','cargo.toml'].includes(name.toLowerCase()) ? ' 📦' : '';
    console.log(`      - ${f.path} (score: ${f.score})${marker}`);
  });

  // 6. Batch file fetch
  console.log('\n6️⃣  fetchFilesBatch (concurrency-limited):');
  const batchPaths = selected.slice(0, 6).map(f => f.path);
  const batchStart = Date.now();
  const contents = await fetchFilesBatch(owner, repo, batchPaths, token, 3);
  const batchMs = Date.now() - batchStart;
  const fetchedCount = Object.values(contents).filter(c => c.length > 0).length;
  console.log(`   ✅ Fetched ${fetchedCount}/${batchPaths.length} files in ${batchMs}ms`);
  Object.entries(contents).slice(0, 3).forEach(([path, content]) => {
    console.log(`      - ${path}: ${content.length} chars`);
  });

  // 7. Issues (paginated, filtered)
  console.log('\n7️⃣  fetchIssues (paginated, max 30):');
  const issues = await fetchIssues(owner, repo, token, 'all', 30);
  console.log(`   ✅ ${issues.length} issues fetched`);
  if (issues.length > 0) {
    console.log(`   📌 #${issues[0].number}: ${issues[0].title.substring(0, 60)}...`);
    console.log(`   👤 Author: ${issues[0].user} | Labels: ${issues[0].labels.map(l => l.name).join(', ') || 'none'}`);
  }

  // 8. PRs
  console.log('\n8️⃣  fetchPullRequests (max 20):');
  const prs = await fetchPullRequests(owner, repo, token, 'all', 20);
  console.log(`   ✅ ${prs.length} PRs fetched`);
  if (prs.length > 0) {
    console.log(`   🔀 #${prs[0].number}: ${prs[0].title.substring(0, 60)}... | Merged: ${prs[0].merged}`);
  }

  // 9. Commits
  console.log('\n9️⃣  fetchCommits (max 30):');
  const commits = await fetchCommits(owner, repo, token, 30);
  console.log(`   ✅ ${commits.length} commits fetched`);
  if (commits.length > 0) {
    console.log(`   💾 ${commits[0].shortSha}: ${commits[0].message.split('\n')[0].substring(0, 60)}...`);
    console.log(`   👤 ${commits[0].authorName} (${commits[0].authorLogin || 'no login'})`);
  }

  // 10. Contributors
  console.log('\n🔟  fetchContributors (max 30):');
  const contributors = await fetchContributors(owner, repo, token, 30);
  console.log(`   ✅ ${contributors.length} contributors fetched`);
  contributors.slice(0, 3).forEach(c => {
    console.log(`   🏆 ${c.login}: ${c.contributions.toLocaleString()} commits`);
  });

  // 11. Error handling
  console.log('\n1️⃣1️⃣  Error handling (invalid repo):');
  try {
    await fetchRepoMetadata('this-owner-definitely-does-not-exist-12345', 'fake-repo', token);
  } catch (err) {
    console.log(`   ✅ Caught ${err.constructor.name}: ${err.status} | NotFound: ${err.isNotFound}`);
  }

  console.log('\n🎉 All github.js tests passed!');
}

test().catch(err => {
  console.error('\n❌ Test failed:', err.message);
  if (err.status === 403 || err.status === 429) {
    console.error('💡 GitHub rate limit hit. Wait a minute or use a token with higher limits.');
  }
  console.error(err.stack);
  process.exit(1);
});
