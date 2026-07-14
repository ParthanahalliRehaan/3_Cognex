## `frontend/index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cognex — AI-Powered Repo Intelligence</title>
  <link rel="stylesheet" href="style.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
</head>
<body>
  <div class="app">
    <header class="header">
      <div class="logo">
        <span class="logo-icon">🧠</span>
        <h1>Cognex</h1>
      </div>
      <p class="tagline">Ask anything about any GitHub repository</p>
    </header>

    <main class="main">
      <section class="repo-section" id="repoSection">
        <div class="input-group">
          <input type="text" id="repoUrl" placeholder="https://github.com/vercel/next.js" class="repo-input">
          <button id="ingestBtn" class="btn btn-primary">
            <span class="btn-icon">🔍</span>
            <span class="btn-text">Build Graph</span>
          </button>
        </div>
        <div class="repo-hints">
          <span class="hint">Try:</span>
          <button class="hint-btn" data-repo="https://github.com/vercel/next.js">next.js</button>
          <button class="hint-btn" data-repo="https://github.com/facebook/react">react</button>
          <button class="hint-btn" data-repo="https://github.com/torvalds/linux">linux</button>
        </div>
        <div id="ingestStatus" class="status hidden"></div>
      </section>

      <nav class="tabs" id="tabs">
        <button class="tab active" data-tab="chat">💬 Chat</button>
        <button class="tab" data-tab="graph">🕸️ Graph</button>
        <button class="tab" data-tab="files">📁 Files</button>
      </nav>

      <section class="tab-content active" id="chatTab">
        <div class="chat-container">
          <div id="chatMessages" class="chat-messages">
            <div class="welcome-message">
              <div class="welcome-icon">👋</div>
              <h3>Welcome to Cognex</h3>
              <p>Enter a GitHub repo URL above, then ask me anything about it.</p>
              <div class="suggested-questions">
                <button class="suggestion" data-q="Who are the top contributors?">Who are the top contributors?</button>
                <button class="suggestion" data-q="What are the main dependencies?">What are the main dependencies?</button>
                <button class="suggestion" data-q="Explain the architecture">Explain the architecture</button>
              </div>
            </div>
          </div>
          <div class="chat-input-group">
            <input type="text" id="chatInput" placeholder="Ask about this repo..." class="chat-input" disabled>
            <button id="sendBtn" class="btn btn-send" disabled>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </div>
        </div>
      </section>

      <section class="tab-content" id="graphTab">
        <div class="graph-container">
          <div id="graphViz" class="graph-viz">
            <div class="empty-state">
              <div class="empty-icon">🕸️</div>
              <p>Build a graph first to see the knowledge network</p>
            </div>
          </div>
          <div class="graph-sidebar">
            <h4>Node Types</h4>
            <div class="legend">
              <span class="legend-item"><span class="dot file"></span> File</span>
              <span class="legend-item"><span class="dot function"></span> Function</span>
              <span class="legend-item"><span class="dot contributor"></span> Contributor</span>
              <span class="legend-item"><span class="dot issue"></span> Issue</span>
              <span class="legend-item"><span class="dot pr"></span> PR</span>
              <span class="legend-item"><span class="dot commit"></span> Commit</span>
              <span class="legend-item"><span class="dot dependency"></span> Dependency</span>
            </div>
            <div id="nodeDetails" class="node-details hidden">
              <h4>Details</h4>
              <pre id="nodeJson"></pre>
            </div>
          </div>
        </div>
      </section>

      <section class="tab-content" id="filesTab">
        <div class="files-container">
          <div id="filesList" class="files-list">
            <div class="empty-state">
              <div class="empty-icon">📁</div>
              <p>Build a graph first to see repository files</p>
            </div>
          </div>
        </div>
      </section>
    </main>

    <footer class="footer">
      <p>Powered by Groq · Cohere · Supabase · Cloudflare</p>
    </footer>
  </div>

  <script src="https://unpkg.com/cytoscape@3.26.0/dist/cytoscape.min.js"></script>
  <script src="app.js"></script>
</body>
</html>
```

---

## `frontend/style.css`

```css
:root {
  --bg-primary: #0a0a0f;
  --bg-secondary: #12121a;
  --bg-tertiary: #1a1a2e;
  --bg-card: #16162a;
  --border: #2a2a4a;
  --border-hover: #3a3a6a;
  --text-primary: #e8e8f0;
  --text-secondary: #a0a0b8;
  --text-muted: #6a6a8a;
  --accent: #6366f1;
  --accent-hover: #818cf8;
  --accent-glow: rgba(99, 102, 241, 0.3);
  --success: #22c55e;
  --warning: #f59e0b;
  --error: #ef4444;
  --radius: 12px;
  --radius-sm: 8px;
  --shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
  --shadow-glow: 0 0 40px var(--accent-glow);
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
  --transition: all 0.2s ease;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: var(--font-sans);
  background: var(--bg-primary);
  color: var(--text-primary);
  min-height: 100vh;
  line-height: 1.6;
}

.app {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.header {
  text-align: center;
  padding: 40px 0 32px;
}

.logo {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.logo-icon { font-size: 36px; }

.logo h1 {
  font-size: 42px;
  font-weight: 700;
  background: linear-gradient(135deg, var(--accent), #a78bfa);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.tagline {
  color: var(--text-secondary);
  font-size: 16px;
}

.repo-section { margin-bottom: 24px; }

.input-group {
  display: flex;
  gap: 12px;
  max-width: 700px;
  margin: 0 auto 16px;
}

.repo-input {
  flex: 1;
  padding: 14px 18px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-primary);
  font-size: 15px;
  font-family: var(--font-mono);
  transition: var(--transition);
}

.repo-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-glow);
}

.repo-input::placeholder { color: var(--text-muted); }

.btn {
  padding: 14px 24px;
  border: none;
  border-radius: var(--radius);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: var(--transition);
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.btn-primary {
  background: var(--accent);
  color: white;
}

.btn-primary:hover {
  background: var(--accent-hover);
  transform: translateY(-1px);
  box-shadow: var(--shadow-glow);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.btn-send {
  padding: 12px;
  background: var(--accent);
  color: white;
  border-radius: var(--radius-sm);
}

.btn-send:hover:not(:disabled) { background: var(--accent-hover); }

.repo-hints {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
}

.hint {
  color: var(--text-muted);
  font-size: 13px;
}

.hint-btn {
  padding: 4px 12px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 20px;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: var(--transition);
}

.hint-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.status {
  text-align: center;
  padding: 16px;
  margin-top: 16px;
  border-radius: var(--radius);
  font-size: 14px;
  animation: fadeIn 0.3s ease;
}

.status.info {
  background: rgba(99, 102, 241, 0.1);
  border: 1px solid var(--accent);
  color: var(--accent);
}

.status.success {
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid var(--success);
  color: var(--success);
}

.status.error {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid var(--error);
  color: var(--error);
}

.hidden { display: none !important; }

.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 1px;
}

.tab {
  padding: 12px 20px;
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: var(--transition);
  position: relative;
  top: 1px;
}

.tab:hover { color: var(--text-secondary); }

.tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

.tab-content {
  display: none;
  flex: 1;
  min-height: 0;
}

.tab-content.active { display: block; }

.chat-container {
  display: flex;
  flex-direction: column;
  height: 600px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.welcome-message {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-secondary);
}

.welcome-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.welcome-message h3 {
  color: var(--text-primary);
  margin-bottom: 8px;
}

.suggested-questions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-top: 20px;
}

.suggestion {
  padding: 8px 16px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 20px;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: var(--transition);
}

.suggestion:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.message {
  max-width: 85%;
  padding: 14px 18px;
  border-radius: var(--radius);
  animation: slideUp 0.3s ease;
}

.message.user {
  align-self: flex-end;
  background: var(--accent);
  color: white;
}

.message.assistant {
  align-self: flex-start;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
}

.message-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
  opacity: 0.7;
}

.message-content {
  line-height: 1.7;
  white-space: pre-wrap;
}

.message-content code {
  background: rgba(0, 0, 0, 0.3);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 13px;
}

.message-content pre {
  background: rgba(0, 0, 0, 0.3);
  padding: 16px;
  border-radius: var(--radius-sm);
  overflow-x: auto;
  margin: 8px 0;
}

.streaming::after {
  content: '▋';
  animation: blink 1s step-end infinite;
  color: var(--accent);
  margin-left: 2px;
}

@keyframes blink { 50% { opacity: 0; } }

.chat-input-group {
  display: flex;
  gap: 12px;
  padding: 16px;
  border-top: 1px solid var(--border);
  background: var(--bg-card);
}

.chat-input {
  flex: 1;
  padding: 12px 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 14px;
  transition: var(--transition);
}

.chat-input:focus {
  outline: none;
  border-color: var(--accent);
}

.chat-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.graph-container {
  display: flex;
  height: 600px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.graph-viz {
  flex: 1;
  position: relative;
}

.graph-sidebar {
  width: 240px;
  padding: 20px;
  border-left: 1px solid var(--border);
  background: var(--bg-card);
  overflow-y: auto;
}

.graph-sidebar h4 {
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  margin-bottom: 12px;
}

.legend {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 24px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.dot.file { background: #6366f1; }
.dot.function { background: #8b5cf6; }
.dot.contributor { background: #22c55e; }
.dot.issue { background: #ef4444; }
.dot.pr { background: #f59e0b; }
.dot.commit { background: #3b82f6; }
.dot.dependency { background: #ec4899; }

.node-details {
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.node-details.hidden { display: none; }

#nodeJson {
  background: var(--bg-secondary);
  padding: 12px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.files-container {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  height: 600px;
  overflow: hidden;
}

.files-list {
  padding: 20px;
  overflow-y: auto;
  height: 100%;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  transition: var(--transition);
  cursor: pointer;
}

.file-item:hover { background: var(--bg-tertiary); }

.file-icon { font-size: 16px; }

.file-name {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-primary);
}

.file-meta {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-muted);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  text-align: center;
  padding: 40px;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
  opacity: 0.5;
}

.footer {
  text-align: center;
  padding: 24px;
  color: var(--text-muted);
  font-size: 13px;
  border-top: 1px solid var(--border);
  margin-top: auto;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track { background: transparent; }

::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover { background: var(--border-hover); }

@media (max-width: 768px) {
  .app { padding: 16px; }
  .input-group { flex-direction: column; }
  .graph-container { flex-direction: column; }
  .graph-sidebar {
    width: 100%;
    border-left: none;
    border-top: 1px solid var(--border);
  }
  .chat-container { height: 500px; }
}
```

---

## `frontend/app.js`

```javascript
const API_BASE = 'https://cognex-worker.YOUR_SUBDOMAIN.workers.dev';

let currentRepo = null;
let isIngesting = false;
let cy = null;

const els = {
  repoUrl: document.getElementById('repoUrl'),
  ingestBtn: document.getElementById('ingestBtn'),
  ingestStatus: document.getElementById('ingestStatus'),
  chatInput: document.getElementById('chatInput'),
  sendBtn: document.getElementById('sendBtn'),
  chatMessages: document.getElementById('chatMessages'),
  tabs: document.querySelectorAll('.tab'),
  tabContents: document.querySelectorAll('.tab-content'),
  graphViz: document.getElementById('graphViz'),
  filesList: document.getElementById('filesList'),
  nodeDetails: document.getElementById('nodeDetails'),
  nodeJson: document.getElementById('nodeJson'),
};

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initHints();
  initSuggestions();
  initIngest();
  initChat();
});

function initTabs() {
  els.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      els.tabs.forEach(t => t.classList.remove('active'));
      els.tabContents.forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`${target}Tab`).classList.add('active');
      if (target === 'graph' && currentRepo) loadGraph(currentRepo);
      if (target === 'files' && currentRepo) loadFiles(currentRepo);
    });
  });
}

function initHints() {
  document.querySelectorAll('.hint-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      els.repoUrl.value = btn.dataset.repo;
    });
  });
}

function initSuggestions() {
  document.querySelectorAll('.suggestion').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!els.chatInput.disabled) {
        els.chatInput.value = btn.dataset.q;
        sendMessage();
      }
    });
  });
}

function initIngest() {
  els.ingestBtn.addEventListener('click', ingestRepo);
  els.repoUrl.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') ingestRepo();
  });
}

async function ingestRepo() {
  const repoUrl = els.repoUrl.value.trim();
  if (!repoUrl || !repoUrl.includes('github.com')) {
    showStatus('Please enter a valid GitHub URL', 'error');
    return;
  }
  if (isIngesting) return;
  isIngesting = true;
  setIngestLoading(true);
  showStatus('🔍 Fetching repository data... This may take 1-2 minutes.', 'info');

  try {
    const response = await fetch(`${API_BASE}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl }),
    });
    const data = await response.json();
    if (data.success) {
      currentRepo = repoUrl;
      showStatus(`✅ Graph built! ${data.nodes} nodes, ${data.edges} edges, ${data.documents} docs in ${data.duration}s`, 'success');
      enableChat();
      loadGraph(repoUrl);
      loadFiles(repoUrl);
    } else if (data.status === 'already_exists') {
      currentRepo = repoUrl;
      showStatus(`ℹ️ Repo already ingested. ${data.nodeCount} nodes, ${data.docCount} docs.`, 'info');
      enableChat();
    } else {
      showStatus(`❌ Error: ${data.error || 'Unknown error'}`, 'error');
    }
  } catch (err) {
    showStatus(`❌ Network error: ${err.message}`, 'error');
  } finally {
    isIngesting = false;
    setIngestLoading(false);
  }
}

function setIngestLoading(loading) {
  els.ingestBtn.disabled = loading;
  els.ingestBtn.innerHTML = loading
    ? '<span class="btn-icon">⏳</span><span class="btn-text">Building...</span>'
    : '<span class="btn-icon">🔍</span><span class="btn-text">Build Graph</span>';
}

function showStatus(message, type) {
  els.ingestStatus.textContent = message;
  els.ingestStatus.className = `status ${type}`;
  els.ingestStatus.classList.remove('hidden');
}

function enableChat() {
  els.chatInput.disabled = false;
  els.sendBtn.disabled = false;
  els.chatInput.placeholder = `Ask about ${currentRepo.split('/').pop()}...`;
}

function initChat() {
  els.sendBtn.addEventListener('click', sendMessage);
  els.chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
}

async function sendMessage() {
  const query = els.chatInput.value.trim();
  if (!query || !currentRepo) return;
  addMessage('user', query);
  els.chatInput.value = '';
  const assistantMsg = addMessage('assistant', '', true);

  try {
    const response = await fetch(`${API_BASE}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: currentRepo, query }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      fullText += chunk;
      assistantMsg.textContent = fullText;
      scrollToBottom();
    }
    assistantMsg.classList.remove('streaming');
  } catch (err) {
    assistantMsg.textContent = `❌ Error: ${err.message}. Make sure the backend is running.`;
    assistantMsg.classList.remove('streaming');
  }
}

function addMessage(role, text, streaming = false) {
  const welcome = els.chatMessages.querySelector('.welcome-message');
  if (welcome) welcome.remove();
  const msg = document.createElement('div');
  msg.className = `message ${role}${streaming ? ' streaming' : ''}`;
  const header = document.createElement('div');
  header.className = 'message-header';
  header.textContent = role === 'user' ? 'You' : '🧠 Cognex';
  const content = document.createElement('div');
  content.className = 'message-content';
  content.textContent = text;
  msg.appendChild(header);
  msg.appendChild(content);
  els.chatMessages.appendChild(msg);
  scrollToBottom();
  return content;
}

function scrollToBottom() {
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

async function loadGraph(repoUrl) {
  if (!repoUrl) return;
  els.graphViz.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>Loading graph...</p></div>';
  try {
    const response = await fetch(`${API_BASE}/api/graph?repoUrl=${encodeURIComponent(repoUrl)}`);
    const data = await response.json();
    if (data.nodes.length === 0) {
      els.graphViz.innerHTML = '<div class="empty-state"><div class="empty-icon">🕸️</div><p>No graph data yet</p></div>';
      return;
    }
    renderCytoscape(data.nodes, data.edges);
  } catch (err) {
    els.graphViz.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><p>Error: ${err.message}</p></div>`;
  }
}

function renderCytoscape(nodes, edges) {
  const colorMap = {
    file: '#6366f1', function: '#8b5cf6', contributor: '#22c55e',
    issue: '#ef4444', pr: '#f59e0b', commit: '#3b82f6',
    dependency: '#ec4899', repo: '#f97316', readme: '#14b8a6',
  };
  const cyNodes = nodes.map(n => ({
    data: {
      id: n.id,
      label: n.label.length > 30 ? n.label.substring(0, 30) + '...' : n.label,
      fullLabel: n.label,
      type: n.node_type,
      ...n.metadata,
    },
    style: { 'background-color': colorMap[n.node_type] || '#6b7280' },
  }));
  const cyEdges = edges.map(e => ({
    data: {
      id: e.id,
      source: e.source_node_id,
      target: e.target_node_id,
      label: e.relation,
    },
  }));
  if (cy) cy.destroy();
  cy = cytoscape({
    container: els.graphViz,
    elements: [...cyNodes, ...cyEdges],
    style: [
      {
        selector: 'node',
        style: {
          'label': 'data(label)',
          'width': 40,
          'height': 40,
          'font-size': '10px',
          'text-valign': 'bottom',
          'text-halign': 'center',
          'color': '#a0a0b8',
          'text-background-color': '#0a0a0f',
          'text-background-opacity': 0.8,
          'text-background-padding': '2px',
          'border-width': 2,
          'border-color': '#2a2a4a',
        },
      },
      {
        selector: 'edge',
        style: {
          'width': 1,
          'line-color': '#3a3a6a',
          'target-arrow-color': '#3a3a6a',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          'label': 'data(label)',
          'font-size': '8px',
          'color': '#6a6a8a',
          'text-rotation': 'autorotate',
        },
      },
      {
        selector: ':selected',
        style: {
          'border-width': 3,
          'border-color': '#6366f1',
        },
      },
    ],
    layout: {
      name: 'cose',
      padding: 20,
      animate: true,
      animationDuration: 500,
      componentSpacing: 80,
      nodeRepulsion: 400000,
      idealEdgeLength: 100,
    },
    minZoom: 0.2,
    maxZoom: 3,
  });
  cy.on('tap', 'node', (evt) => {
    const node = evt.target;
    const data = node.data();
    els.nodeDetails.classList.remove('hidden');
    els.nodeJson.textContent = JSON.stringify({
      id: data.id,
      type: data.type,
      label: data.fullLabel,
      ...Object.fromEntries(
        Object.entries(data).filter(([k]) => !['id', 'label', 'fullLabel', 'type'].includes(k))
      ),
    }, null, 2);
  });
  cy.on('tap', (evt) => {
    if (evt.target === cy) els.nodeDetails.classList.add('hidden');
  });
}

async function loadFiles(repoUrl) {
  if (!repoUrl) return;
  els.filesList.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>Loading files...</p></div>';
  try {
    const response = await fetch(`${API_BASE}/api/graph?repoUrl=${encodeURIComponent(repoUrl)}`);
    const data = await response.json();
    const files = data.nodes.filter(n => n.node_type === 'file');
    if (files.length === 0) {
      els.filesList.innerHTML = '<div class="empty-state"><div class="empty-icon">📁</div><p>No files found</p></div>';
      return;
    }
    els.filesList.innerHTML = '';
    files.sort((a, b) => a.label.localeCompare(b.label));
    files.forEach(file => {
      const item = document.createElement('div');
      item.className = 'file-item';
      const icon = getFileIcon(file.metadata?.extension || '');
      const size = file.metadata?.size ? formatBytes(file.metadata.size) : '';
      item.innerHTML = `
        <span class="file-icon">${icon}</span>
        <span class="file-name">${file.label}</span>
        <span class="file-meta">${size}</span>
      `;
      els.filesList.appendChild(item);
    });
  } catch (err) {
    els.filesList.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><p>Error: ${err.message}</p></div>`;
  }
}

function getFileIcon(ext) {
  const icons = {
    js: '📜', ts: '📘', jsx: '⚛️', tsx: '⚛️',
    py: '🐍', go: '🔵', rs: '⚙️', java: '☕',
    json: '📋', md: '📝', yml: '⚙️', yaml: '⚙️',
    html: '🌐', css: '🎨', svg: '🖼️',
  };
  return icons[ext] || '📄';
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
```

---

## Deploy Steps

1. **Update `API_BASE`** in `app.js` with your deployed Worker URL
2. **Deploy frontend**:
   ```bash
   cd frontend
   npx wrangler pages deploy .
   ```
   Or upload via Cloudflare Pages dashboard
